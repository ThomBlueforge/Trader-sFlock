"""
SQLite persistence for OHLCV price data.
Accumulates data over time — new fetches only insert rows that don't exist yet.
Provides DataFrame reads for feature engineering and ML training.
"""
from __future__ import annotations

import logging
import pandas as pd

from app.core.database import get_connection
from app.data.fetcher import fetch_all_symbols, fetch_ohlcv
from app.core.config import settings

logger = logging.getLogger(__name__)


# ── Write ─────────────────────────────────────────────────────────────────────

def upsert_ohlcv(symbol: str, timeframe: str, df: pd.DataFrame) -> int:
    """Insert new rows, skip duplicates. Returns number of rows inserted."""
    if df.empty:
        return 0

    rows = [
        (
            symbol,
            timeframe,
            int(idx.timestamp() * 1000),
            float(row["open"]),
            float(row["high"]),
            float(row["low"]),
            float(row["close"]),
            float(row["volume"]),
        )
        for idx, row in df.iterrows()
    ]

    conn = get_connection()
    try:
        c = conn.cursor()
        c.executemany(
            "INSERT OR IGNORE INTO price_data "
            "(symbol, timeframe, ts, open, high, low, close, volume) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        conn.commit()
        return c.rowcount
    finally:
        conn.close()


def refresh_all() -> None:
    """Fetch gold + macro for all configured timeframes and persist (parallel)."""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    def _fetch_and_store(tf: str) -> int:
        data = fetch_all_symbols(tf)
        total = 0
        for sym, df in data.items():
            inserted = upsert_ohlcv(sym, tf, df)
            logger.info("Upserted %d rows  %s/%s", inserted, sym, tf)
            total += inserted
        return total

    with ThreadPoolExecutor(max_workers=1) as pool:
        futures = {pool.submit(_fetch_and_store, tf): tf for tf in settings.timeframes}
        for fut in as_completed(futures):
            tf = futures[fut]
            try:
                fut.result()
            except Exception as exc:
                logger.error("refresh_all failed for %s: %s", tf, exc)


def refresh_symbol(symbol: str, timeframe: str) -> int:
    df = fetch_ohlcv(symbol, timeframe)
    return upsert_ohlcv(symbol, timeframe, df)


# ── Read ──────────────────────────────────────────────────────────────────────

def load_ohlcv(
    symbol: str,
    timeframe: str,
    limit: int | None = None,
    start_ts_ms: int | None = None,
) -> pd.DataFrame:
    """
    Load OHLCV rows as a DataFrame with datetime index.
    limit: most-recent N bars (applied before start_ts_ms filter).
    start_ts_ms: unix-ms lower bound (inclusive).
    """
    conn = get_connection()
    try:
        conditions = ["symbol = ?", "timeframe = ?"]
        params: list = [symbol, timeframe]

        if start_ts_ms is not None:
            conditions.append("ts >= ?")
            params.append(start_ts_ms)

        where = " AND ".join(conditions)

        if limit and start_ts_ms is None:
            query = (
                f"SELECT ts, open, high, low, close, volume "
                f"FROM price_data WHERE {where} ORDER BY ts DESC LIMIT {limit}"
            )
            df = pd.read_sql_query(query, conn, params=params)
            df = df.iloc[::-1].reset_index(drop=True)
        else:
            query = (
                f"SELECT ts, open, high, low, close, volume "
                f"FROM price_data WHERE {where} ORDER BY ts ASC"
            )
            df = pd.read_sql_query(query, conn, params=params)

        if df.empty:
            return df

        df["datetime"] = pd.to_datetime(df["ts"], unit="ms")
        return df.set_index("datetime").drop(columns=["ts"])
    finally:
        conn.close()


def load_macro(timeframe: str = "1d") -> dict[str, pd.DataFrame]:
    """Load all macro symbol DataFrames (for daily feature computation)."""
    result: dict[str, pd.DataFrame] = {}
    for sym in settings.macro_symbols:
        df = load_ohlcv(sym, timeframe)
        if not df.empty:
            result[sym] = df
    return result


def bar_count(symbol: str, timeframe: str) -> int:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT COUNT(*) FROM price_data WHERE symbol = ? AND timeframe = ?",
            (symbol, timeframe),
        ).fetchone()
        return row[0] if row else 0
    finally:
        conn.close()


def latest_bar_ts(symbol: str, timeframe: str) -> int | None:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT MAX(ts) FROM price_data WHERE symbol = ? AND timeframe = ?",
            (symbol, timeframe),
        ).fetchone()
        return row[0] if row and row[0] is not None else None
    finally:
        conn.close()
