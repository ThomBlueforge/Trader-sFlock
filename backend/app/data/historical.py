"""
Historical XAUUSD tick downloader — in-process worker for the FastAPI server.

Wraps the Dukascopy download logic in a thread-safe singleton so the server
can start, monitor, and cancel downloads via HTTP/WebSocket.

Phase 1 — Download hourly bi5 tick files → xauusd_ticks.db  (resumable)
Phase 2 — Resample ticks → 5m/15m/30m/1h/2h/4h/1d → price_data  (all TFs)
"""
from __future__ import annotations

import asyncio
import lzma
import logging
import sqlite3
import struct
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Event, Lock, Thread
from typing import Any

import pandas as pd
import requests

from app.core.config import settings
from app.core.database import get_connection

log = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

BASE_URL   = "https://datafeed.dukascopy.com/datafeed/XAUUSD"
PRICE_DIV  = 1_000          # raw int / 1000 = USD spot price
TICK_BYTES = 20

# Tick database lives next to the project root (same file app.py uses)
TICK_DB = Path(__file__).parents[3] / "xauusd_ticks.db"

# pandas resample frequency aliases (pandas 2.x)
_PD_FREQ: dict[str, str] = {
    "5m": "5min", "15m": "15min", "30m": "30min",
    "1h": "1h",   "2h":  "2h",   "4h":  "4h",   "1d": "1D",
}

# Timeframe → minutes (for coverage calculation)
_TF_MIN: dict[str, int] = {
    "5m": 5, "15m": 15, "30m": 30,
    "1h": 60, "2h": 120, "4h": 240, "1d": 1440,
}

# Approximate trading minutes per weekday (gold trades ~22.5 h/day Mon-Fri)
_TRADE_MIN_PER_DAY = 22.5 * 60  # 1350 min

# ── Singleton job state ───────────────────────────────────────────────────────

_lock = Lock()
_stop = Event()
_loop: asyncio.AbstractEventLoop | None = None

_state: dict[str, Any] = {
    "status":      "idle",    # idle | running | done | error
    "phase":       None,      # download | resample | None
    "pct":         0.0,
    "done_hours":  0,
    "total_hours": 0,
    "ticks":       0,
    "rate":        0.0,       # hours/second
    "eta_s":       None,
    "resample_tf": None,      # TF currently being resampled
    "bars_per_tf": {},        # {tf: bars_written}
    "started_at":  None,
    "finished_at": None,
    "elapsed_s":   0,
    "error":       None,
    "params":      {},        # last job params (for UI retry)
    "logs":        deque(maxlen=200),
}


def get_state() -> dict[str, Any]:
    """Return a JSON-serialisable snapshot of the current job state."""
    with _lock:
        s = {k: v for k, v in _state.items() if k != "logs"}
        s["logs"] = list(_state["logs"])
    return s


# ── Internal helpers ──────────────────────────────────────────────────────────

def _add_log(level: str, msg: str) -> None:
    entry = {
        "ts":    datetime.now(tz=timezone.utc).strftime("%H:%M:%S"),
        "level": level,
        "msg":   msg,
    }
    with _lock:
        _state["logs"].append(entry)
    getattr(log, level.lower(), log.info)("[historical] %s", msg)
    _broadcast("historical_log", entry)


def _broadcast(event: str, data: dict) -> None:
    """Fire-and-forget WS broadcast from a background thread."""
    if _loop and _loop.is_running():
        try:
            from app.api.ws import manager  # lazy import avoids circular at module level
            asyncio.run_coroutine_threadsafe(manager.broadcast(event, data), _loop)
        except Exception:
            pass


def _update(**kw: Any) -> None:
    with _lock:
        _state.update(kw)
        if _state.get("started_at"):
            _state["elapsed_s"] = round(time.time() - _state["started_at"], 1)


# ── Dukascopy fetch & decode ──────────────────────────────────────────────────

_session = requests.Session()
_session.headers["User-Agent"] = "Mozilla/5.0 (compatible; research/backtesting)"


def _decode_bi5(raw: bytes, hour_ms: int) -> list[tuple]:
    n = len(raw) // TICK_BYTES
    out: list[tuple] = []
    for i in range(n):
        off = i * TICK_BYTES
        ms_off, ask_i, bid_i, ask_v, bid_v = struct.unpack_from(">IIIff", raw, off)
        out.append((
            hour_ms + ms_off,
            round(bid_i / PRICE_DIV, 3),
            round(ask_i / PRICE_DIV, 3),
            float(bid_v),
            float(ask_v),
        ))
    return out


def _fetch_hour(y: int, m: int, d: int, h: int, retries: int = 3) -> list[tuple]:
    """Download one hour of ticks ([] = weekend / holiday)."""
    url = f"{BASE_URL}/{y:04d}/{m-1:02d}/{d:02d}/{h:02d}h_ticks.bi5"
    for attempt in range(retries):
        try:
            r = _session.get(url, timeout=20)
            if r.status_code == 404 or len(r.content) == 0:
                return []
            if r.status_code != 200:
                if attempt < retries - 1:
                    time.sleep(1.5 ** attempt)
                    continue
                return []
            raw = lzma.decompress(r.content)
            break
        except Exception as exc:
            if attempt < retries - 1:
                time.sleep(1.5 ** attempt)
                continue
            _add_log("WARN", f"{y}-{m:02d}-{d:02d} {h:02d}h failed: {exc}")
            return []
    hour_ms = int(datetime(y, m, d, h, tzinfo=timezone.utc).timestamp() * 1000)
    return _decode_bi5(raw, hour_ms)


def _all_hours(start: datetime, end: datetime) -> list[tuple[int, int, int, int]]:
    out: list[tuple[int, int, int, int]] = []
    cur = start.replace(minute=0, second=0, microsecond=0)
    while cur < end:
        out.append((cur.year, cur.month, cur.day, cur.hour))
        cur += timedelta(hours=1)
    return out


# ── Tick SQLite helpers ───────────────────────────────────────────────────────

def _init_tick_db(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA cache_size=-32000")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS ticks (
            ts_ms   INTEGER NOT NULL PRIMARY KEY,
            bid     REAL    NOT NULL,
            ask     REAL    NOT NULL,
            bid_vol REAL    NOT NULL,
            ask_vol REAL    NOT NULL
        );
        CREATE TABLE IF NOT EXISTS progress (
            year    INTEGER NOT NULL,
            month   INTEGER NOT NULL,
            day     INTEGER NOT NULL,
            hour    INTEGER NOT NULL,
            status  TEXT    NOT NULL DEFAULT 'pending',
            n_ticks INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (year, month, day, hour)
        );
    """)
    conn.commit()
    return conn


def _get_done(conn: sqlite3.Connection) -> set[tuple]:
    rows = conn.execute(
        "SELECT year,month,day,hour FROM progress WHERE status IN ('done','empty')"
    ).fetchall()
    return {tuple(r) for r in rows}


def _mark_hour(conn: sqlite3.Connection, db_lock: Lock,
               y: int, m: int, d: int, h: int, status: str, n: int) -> None:
    with db_lock:
        conn.execute(
            "INSERT INTO progress(year,month,day,hour,status,n_ticks) VALUES(?,?,?,?,?,?)"
            " ON CONFLICT(year,month,day,hour) DO UPDATE"
            " SET status=excluded.status, n_ticks=excluded.n_ticks",
            (y, m, d, h, status, n),
        )
        conn.commit()


def _insert_ticks(conn: sqlite3.Connection, db_lock: Lock, rows: list[tuple]) -> None:
    if not rows:
        return
    with db_lock:
        conn.executemany(
            "INSERT OR IGNORE INTO ticks(ts_ms,bid,ask,bid_vol,ask_vol) VALUES(?,?,?,?,?)",
            rows,
        )
        conn.commit()


# ── Phase 1: Parallel download ────────────────────────────────────────────────

def _phase1(tick_conn: sqlite3.Connection, start: datetime, end: datetime,
            concurrency: int) -> None:
    db_lock = Lock()
    all_h   = _all_hours(start, end)
    done    = _get_done(tick_conn)
    pending = [h for h in all_h if tuple(h) not in done]
    total   = len(all_h)

    _update(phase="download", total_hours=total,
            done_hours=len(done), ticks=0,
            pct=round(len(done) / total * 100, 1) if total else 100)

    _add_log("INFO", f"Phase 1 — {len(pending):,} hours to fetch"
                     f" ({len(done):,} already cached, {concurrency} threads)")

    if not pending:
        _add_log("INFO", "All hours already cached — skipping Phase 1.")
        return

    total_ticks = 0
    done_count  = len(done)
    t0          = time.time()

    def worker(args: tuple) -> int:
        if _stop.is_set():
            return 0
        y, m, d, h = args
        rows = _fetch_hour(y, m, d, h)
        if rows:
            _insert_ticks(tick_conn, db_lock, rows)
        _mark_hour(tick_conn, db_lock, y, m, d, h,
                   "done" if rows else "empty", len(rows))
        return len(rows)

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = {pool.submit(worker, h): h for h in pending}
        for fut in as_completed(futures):
            if _stop.is_set():
                pool.shutdown(wait=False, cancel_futures=True)
                _add_log("WARN", "Download cancelled — progress saved.")
                break
            n           = fut.result() or 0
            total_ticks += n
            done_count  += 1
            elapsed     = time.time() - t0
            rate        = done_count / elapsed if elapsed > 0 else 0
            remaining   = total - done_count
            eta         = int(remaining / rate) if rate > 0 else None
            pct         = round(done_count / total * 100, 1)

            _update(done_hours=done_count, ticks=total_ticks,
                    rate=round(rate, 1), eta_s=eta, pct=pct)

            if done_count % 20 == 0 or done_count == total:
                _broadcast("historical_progress", {
                    "phase": "download", "pct": pct,
                    "done_hours": done_count, "total_hours": total,
                    "ticks": total_ticks, "rate": round(rate, 1), "eta_s": eta,
                })

    _add_log("INFO", f"Phase 1 complete — {total_ticks:,} ticks stored.")


# ── Phase 2: Resample all timeframes ─────────────────────────────────────────

def _phase2(tick_conn: sqlite3.Connection, symbol: str,
            start: datetime, end: datetime, timeframes: list[str]) -> dict[str, int]:

    # Build month list
    months: list[datetime] = []
    cur = start.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    while cur < end:
        months.append(cur)
        cur = (cur.replace(month=cur.month + 1)
               if cur.month < 12 else cur.replace(year=cur.year + 1, month=1))

    bars_per_tf: dict[str, int] = {}
    done_tf = 0

    _update(phase="resample", pct=0, resample_tf=None)
    _add_log("INFO",
             f"Phase 2 — {len(months)} months × {len(timeframes)} timeframes → {symbol}")

    backend_conn = get_connection()
    backend_conn.execute("PRAGMA journal_mode=WAL")

    try:
        for tf in timeframes:
            if _stop.is_set():
                break

            freq   = _PD_FREQ.get(tf, tf)
            tf_bars = 0
            _update(resample_tf=tf)
            _add_log("INFO", f"  Resampling → {tf}")

            for mo in months:
                if _stop.is_set():
                    break
                nxt   = (mo.replace(month=mo.month + 1) if mo.month < 12
                         else mo.replace(year=mo.year + 1, month=1))
                ts_lo = int(mo.timestamp() * 1000)
                ts_hi = int(nxt.timestamp() * 1000)

                df = pd.read_sql_query(
                    "SELECT ts_ms, bid, ask, bid_vol FROM ticks"
                    " WHERE ts_ms >= ? AND ts_ms < ? ORDER BY ts_ms",
                    tick_conn, params=(ts_lo, ts_hi),
                )
                if df.empty:
                    continue

                df["dt"] = (pd.to_datetime(df["ts_ms"], unit="ms", utc=True)
                            .dt.tz_localize(None))
                df = df.set_index("dt")
                mid   = (df["bid"] + df["ask"]) / 2
                ohlcv = mid.resample(freq).ohlc()
                ohlcv["volume"] = df["bid_vol"].resample(freq).sum()
                ohlcv = ohlcv.dropna(subset=["close"])
                ohlcv = ohlcv[ohlcv["close"] > 0]

                rows = [
                    (symbol, tf,
                     int(idx.timestamp() * 1000),
                     float(r["open"]), float(r["high"]),
                     float(r["low"]),  float(r["close"]),
                     float(r["volume"]))
                    for idx, r in ohlcv.iterrows()
                ]
                if rows:
                    backend_conn.executemany(
                        "INSERT OR IGNORE INTO price_data"
                        " (symbol,timeframe,ts,open,high,low,close,volume)"
                        " VALUES (?,?,?,?,?,?,?,?)",
                        rows,
                    )
                    backend_conn.commit()
                    tf_bars += len(rows)

            bars_per_tf[tf] = tf_bars
            done_tf += 1
            pct = round(done_tf / len(timeframes) * 100, 1)
            _update(pct=pct, bars_per_tf=dict(bars_per_tf))
            _add_log("INFO", f"    {tf} → {tf_bars:,} bars ✓")
            _broadcast("historical_tf_done", {"tf": tf, "bars": tf_bars, "pct": pct})
    finally:
        backend_conn.close()

    _add_log("INFO", f"Phase 2 complete — {sum(bars_per_tf.values()):,} total bars written.")
    return bars_per_tf


# ── Public API ────────────────────────────────────────────────────────────────

def start_job(
    start_date:  str,
    end_date:    str,
    symbol:      str       = "GC=F",
    concurrency: int       = 12,
    timeframes:  list[str] = None,
    loop: asyncio.AbstractEventLoop = None,
) -> None:
    """
    Launch the download + resample job in a daemon thread.
    Raises ValueError if a job is already running.
    """
    global _loop
    tfs = timeframes or list(settings.timeframes)

    with _lock:
        if _state["status"] == "running":
            raise ValueError("A job is already running.")
        _stop.clear()
        _loop = loop
        _state.update({
            "status":      "running",
            "phase":       "download",
            "pct":         0.0,
            "done_hours":  0,
            "total_hours": 0,
            "ticks":       0,
            "rate":        0.0,
            "eta_s":       None,
            "resample_tf": None,
            "bars_per_tf": {},
            "started_at":  time.time(),
            "finished_at": None,
            "elapsed_s":   0,
            "error":       None,
            "logs":        deque(maxlen=200),
            "params": {
                "start_date":  start_date,
                "end_date":    end_date,
                "symbol":      symbol,
                "concurrency": concurrency,
                "timeframes":  tfs,
            },
        })

    start = datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    end   = datetime.strptime(end_date,   "%Y-%m-%d").replace(tzinfo=timezone.utc)

    def _run() -> None:
        try:
            _add_log("INFO",
                     f"Import started: {start_date} → {end_date} | "
                     f"symbol={symbol} | threads={concurrency} | "
                     f"timeframes={','.join(tfs)}")
            tick_conn = _init_tick_db(TICK_DB)
            _phase1(tick_conn, start, end, concurrency)
            bars: dict[str, int] = {}
            if not _stop.is_set():
                bars = _phase2(tick_conn, symbol, start, end, tfs)
            tick_conn.close()

            final = "done" if not _stop.is_set() else "idle"
            _update(status=final, phase=None, finished_at=time.time(),
                    pct=100 if final == "done" else _state["pct"])
            _add_log("INFO", f"Import {'complete' if final == 'done' else 'cancelled'}.")
            _broadcast("historical_done", {"status": final, "bars_per_tf": bars})
        except Exception as exc:
            _update(status="error", error=str(exc), finished_at=time.time())
            _add_log("ERROR", f"Import failed: {exc}")
            _broadcast("historical_done", {"status": "error", "error": str(exc)})

    Thread(target=_run, daemon=True, name="historical_worker").start()


def cancel_job() -> None:
    """Signal the worker to stop after its current batch."""
    _stop.set()
    _add_log("WARN", "Cancellation requested — draining current batch…")


def get_summary(symbol: str = "GC=F") -> dict[str, Any]:
    """
    Return bar counts, date ranges, and estimated coverage % per timeframe.
    Coverage is estimated against ~22.5 trading hours / weekday.
    """
    conn = get_connection()
    result: dict[str, Any] = {}
    try:
        for tf in settings.timeframes:
            row = conn.execute(
                "SELECT COUNT(*), MIN(ts), MAX(ts)"
                " FROM price_data WHERE symbol=? AND timeframe=?",
                (symbol, tf),
            ).fetchone()
            count, ts_min, ts_max = row if row else (0, None, None)

            if count and ts_min and ts_max:
                dt_from  = datetime.fromtimestamp(ts_min / 1000, tz=timezone.utc)
                dt_to    = datetime.fromtimestamp(ts_max / 1000, tz=timezone.utc)
                days     = max((dt_to - dt_from).days, 1)
                weekdays = days * 5 / 7
                expected = weekdays * _TRADE_MIN_PER_DAY / _TF_MIN.get(tf, 60)
                coverage = round(min(count / expected, 1.0) * 100, 1) if expected > 0 else 0.0
            else:
                dt_from = dt_to = None
                coverage = 0.0

            result[tf] = {
                "bar_count": count or 0,
                "date_from": dt_from.strftime("%Y-%m-%d") if dt_from else None,
                "date_to":   dt_to.strftime("%Y-%m-%d")   if dt_to   else None,
                "coverage":  coverage,
            }
    finally:
        conn.close()
    return result
