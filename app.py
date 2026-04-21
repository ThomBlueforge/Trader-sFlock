#!/usr/bin/env python3
"""
XAUUSD Full-Year Tick Downloader → 5-Minute OHLCV
══════════════════════════════════════════════════
Phase 1  Download tick data from Dukascopy (resume-safe, concurrent)
Phase 2  Resample ticks → 5-min OHLCV bars → backend price_data table

Usage
─────
  python3 app.py                          # last 365 days, 8 threads
  python3 app.py --start 2024-01-01       # custom window
  python3 app.py --concurrency 16         # more threads
  python3 app.py --phase2-only            # just resample already-downloaded ticks
  python3 app.py --phase1-only            # download only, skip resample
  python3 app.py --symbol XAUUSD          # store as XAUUSD instead of GC=F

Bugs fixed vs original app.py
──────────────────────────────
  ✓  Dukascopy months are 0-indexed in the URL  (Jan → /00/)
  ✓  bi5 time-offset is milliseconds, not seconds
  ✓  XAUUSD price divisor is 1 000, not 100 000
"""
from __future__ import annotations

import argparse
import lzma
import logging
import signal
import sqlite3
import struct
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Event, Lock

import pandas as pd
import requests
from tqdm import tqdm

# ── Config ────────────────────────────────────────────────────────────────────

BASE_URL   = "https://datafeed.dukascopy.com/datafeed/XAUUSD"
PRICE_DIV  = 1_000          # XAUUSD raw integer / 1000 = USD spot price
TICK_BYTES = 20             # bytes per bi5 record (fixed-width)

TICK_DB    = Path(__file__).with_name("xauusd_ticks.db")
BACKEND_DB = Path(__file__).parent / "backend" / "db" / "startgold.db"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ── SQLite helpers ────────────────────────────────────────────────────────────

def init_tick_db(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA cache_size=-32000")  # 32 MB page cache
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


def get_done_hours(conn: sqlite3.Connection) -> set[tuple[int, int, int, int]]:
    rows = conn.execute(
        "SELECT year, month, day, hour FROM progress WHERE status IN ('done','empty')"
    ).fetchall()
    return {tuple(r) for r in rows}


def mark_hour(
    conn: sqlite3.Connection,
    lock: Lock,
    y: int, m: int, d: int, h: int,
    status: str,
    n: int,
) -> None:
    with lock:
        conn.execute(
            "INSERT INTO progress(year,month,day,hour,status,n_ticks) VALUES(?,?,?,?,?,?)"
            " ON CONFLICT(year,month,day,hour)"
            " DO UPDATE SET status=excluded.status, n_ticks=excluded.n_ticks",
            (y, m, d, h, status, n),
        )
        conn.commit()


def insert_ticks(conn: sqlite3.Connection, lock: Lock, rows: list[tuple]) -> None:
    if not rows:
        return
    with lock:
        conn.executemany(
            "INSERT OR IGNORE INTO ticks(ts_ms,bid,ask,bid_vol,ask_vol) VALUES(?,?,?,?,?)",
            rows,
        )
        conn.commit()


# ── Dukascopy bi5 decoder ─────────────────────────────────────────────────────

def decode_bi5(raw: bytes, hour_start_ms: int) -> list[tuple]:
    """
    Decode a decompressed bi5 blob into (ts_ms, bid, ask, bid_vol, ask_vol) tuples.

    Record layout (20 bytes, big-endian):
      [0:4]   uint32  milliseconds offset from start of hour
      [4:8]   uint32  ask price * PRICE_DIV
      [8:12]  uint32  bid price * PRICE_DIV
      [12:16] float32 ask volume (lots)
      [16:20] float32 bid volume (lots)
    """
    n = len(raw) // TICK_BYTES
    out: list[tuple] = []
    for i in range(n):
        off = i * TICK_BYTES
        ms_off, ask_i, bid_i, ask_v, bid_v = struct.unpack_from(">IIIff", raw, off)
        out.append((
            hour_start_ms + ms_off,
            round(bid_i / PRICE_DIV, 3),
            round(ask_i / PRICE_DIV, 3),
            float(bid_v),
            float(ask_v),
        ))
    return out


# ── HTTP fetch ────────────────────────────────────────────────────────────────

_session = requests.Session()
_session.headers["User-Agent"] = "Mozilla/5.0 (compatible; research/backtesting)"


def fetch_hour(y: int, m: int, d: int, h: int, retries: int = 3) -> list[tuple]:
    """
    Download one hour of XAUUSD ticks from Dukascopy.
    Returns [] for weekend/holiday hours (404 or empty file).
    NOTE: Dukascopy URL months are 0-indexed (Jan=00, Dec=11).
    """
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
        except (requests.RequestException, lzma.LZMAError, OSError) as exc:
            if attempt < retries - 1:
                time.sleep(1.5 ** attempt)
                continue
            log.warning("Failed %d-%02d-%02d %02dh — %s", y, m, d, h, exc)
            return []

    hour_start_ms = int(datetime(y, m, d, h, tzinfo=timezone.utc).timestamp() * 1000)
    return decode_bi5(raw, hour_start_ms)


# ── Hour enumeration ──────────────────────────────────────────────────────────

def all_hours(start: datetime, end: datetime) -> list[tuple[int, int, int, int]]:
    out: list[tuple[int, int, int, int]] = []
    cur = start.replace(minute=0, second=0, microsecond=0)
    while cur < end:
        out.append((cur.year, cur.month, cur.day, cur.hour))
        cur += timedelta(hours=1)
    return out


# ── Phase 1: Parallel download ────────────────────────────────────────────────

def phase1_download(
    conn: sqlite3.Connection,
    start: datetime,
    end: datetime,
    concurrency: int,
    stop: Event,
) -> None:
    lock = Lock()
    done = get_done_hours(conn)
    pending = [h for h in all_hours(start, end) if tuple(h) not in done]

    n_total = len(all_hours(start, end))
    log.info(
        "Hours  total=%d | already_done=%d | to_fetch=%d | threads=%d",
        n_total, len(done), len(pending), concurrency,
    )
    if not pending:
        log.info("All hours already downloaded — skipping Phase 1.")
        return

    total_ticks = 0

    def worker(args: tuple[int, int, int, int]) -> int:
        if stop.is_set():
            return 0
        y, m, d, h = args
        rows = fetch_hour(y, m, d, h)
        if rows:
            insert_ticks(conn, lock, rows)
        mark_hour(conn, lock, y, m, d, h, "done" if rows else "empty", len(rows))
        return len(rows)

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = {pool.submit(worker, h): h for h in pending}
        with tqdm(total=len(pending), unit="h", desc="Phase 1 download") as bar:
            for fut in as_completed(futures):
                if stop.is_set():
                    log.info("Interrupted — progress saved, re-run to resume.")
                    pool.shutdown(wait=False, cancel_futures=True)
                    break
                n = fut.result() or 0
                total_ticks += n
                bar.update(1)
                bar.set_postfix(ticks=f"{total_ticks:,}")

    row = conn.execute(
        "SELECT COUNT(*), SUM(n_ticks) FROM progress WHERE status='done'"
    ).fetchone()
    log.info(
        "Phase 1 complete — %d hours with data, %d total ticks stored.",
        row[0], row[1] or 0,
    )


# ── Phase 2: Resample ticks → 5m OHLCV ───────────────────────────────────────

def phase2_resample(
    tick_conn: sqlite3.Connection,
    backend_db: Path,
    symbol: str,
    start: datetime,
    end: datetime,
) -> None:
    """
    Load ticks month-by-month, resample to 5-minute OHLCV using mid price,
    and write to the backend's price_data table.
    Uses mid = (bid+ask)/2, which is standard for ML feature engineering.
    """
    if not backend_db.exists():
        log.error("Backend DB not found at %s — skipping Phase 2.", backend_db)
        return

    bconn = sqlite3.connect(str(backend_db))
    bconn.execute("PRAGMA journal_mode=WAL")

    total_bars = 0
    cur = start.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    # Count how many months we'll process
    months = []
    tmp = cur
    while tmp < end:
        months.append(tmp)
        tmp = (tmp.replace(month=tmp.month + 1) if tmp.month < 12
               else tmp.replace(year=tmp.year + 1, month=1))

    with tqdm(total=len(months), desc="Phase 2 resample", unit="mo") as bar:
        for cur in months:
            nxt = (cur.replace(month=cur.month + 1) if cur.month < 12
                   else cur.replace(year=cur.year + 1, month=1))

            ts_lo = int(cur.timestamp() * 1000)
            ts_hi = int(nxt.timestamp() * 1000)

            df = pd.read_sql_query(
                "SELECT ts_ms, bid, ask, bid_vol FROM ticks "
                "WHERE ts_ms >= ? AND ts_ms < ? ORDER BY ts_ms",
                tick_conn, params=(ts_lo, ts_hi),
            )

            if not df.empty:
                df["dt"] = (
                    pd.to_datetime(df["ts_ms"], unit="ms", utc=True)
                    .dt.tz_localize(None)
                )
                df = df.set_index("dt")
                mid = (df["bid"] + df["ask"]) / 2

                ohlcv = mid.resample("5min").ohlc()
                ohlcv["volume"] = df["bid_vol"].resample("5min").sum()
                ohlcv = ohlcv.dropna(subset=["close"])
                ohlcv = ohlcv[ohlcv["close"] > 0]

                rows = [
                    (
                        symbol, "5m",
                        int(idx.timestamp() * 1000),
                        float(r["open"]), float(r["high"]),
                        float(r["low"]),  float(r["close"]),
                        float(r["volume"]),
                    )
                    for idx, r in ohlcv.iterrows()
                ]

                bconn.executemany(
                    "INSERT OR IGNORE INTO price_data"
                    " (symbol,timeframe,ts,open,high,low,close,volume)"
                    " VALUES (?,?,?,?,?,?,?,?)",
                    rows,
                )
                bconn.commit()
                total_bars += len(rows)

            bar.update(1)
            bar.set_postfix(month=cur.strftime("%Y-%m"), bars=f"{total_bars:,}")

    bconn.close()
    log.info(
        "Phase 2 complete — %d 5-min bars written to %s  symbol=%s/5m",
        total_bars, backend_db, symbol,
    )


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(
        description="Download XAUUSD tick history and build 5-min OHLCV for ML training",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    ap.add_argument("--start",       default=None,       help="Start date YYYY-MM-DD")
    ap.add_argument("--end",         default=None,       help="End date YYYY-MM-DD")
    ap.add_argument("--concurrency", type=int, default=8, help="Download threads")
    ap.add_argument("--tick-db",     default=str(TICK_DB), help="Tick SQLite path")
    ap.add_argument("--symbol",      default="GC=F",     help="Symbol name in backend price_data")
    ap.add_argument("--phase1-only", action="store_true", help="Download only, skip resample")
    ap.add_argument("--phase2-only", action="store_true", help="Resample only, skip download")
    args = ap.parse_args()

    now   = datetime.now(tz=timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    end   = now
    start = now - timedelta(days=365)

    if args.start:
        start = datetime.strptime(args.start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    if args.end:
        end = datetime.strptime(args.end, "%Y-%m-%d").replace(tzinfo=timezone.utc)

    log.info("XAUUSD tick downloader")
    log.info("  Window : %s → %s  (%d days)", start.date(), end.date(), (end - start).days)
    log.info("  Tick DB: %s", args.tick_db)
    log.info("  Symbol : %s/5m → %s", args.symbol, BACKEND_DB)

    conn = init_tick_db(Path(args.tick_db))

    # Graceful CTRL+C
    stop = Event()
    def _sigint(sig, frame):  # noqa: ANN001
        log.warning("SIGINT — finishing current batch, then stopping cleanly…")
        stop.set()
    signal.signal(signal.SIGINT, _sigint)

    if not args.phase2_only:
        phase1_download(conn, start, end, args.concurrency, stop)

    if not args.phase1_only and not stop.is_set():
        phase2_resample(conn, BACKEND_DB, args.symbol, start, end)

    conn.close()
    log.info("Done.")


if __name__ == "__main__":
    main()
