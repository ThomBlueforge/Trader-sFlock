"""
Pattern Engine: scans all timeframes for candlestick patterns and writes
them to the patterns table.  A companion pattern_stats table tracks each
pattern's historical hit-rate (confirmed after target_horizon bars).

Called as a background job after every data refresh.
"""
from __future__ import annotations

import logging
import time
import uuid

import pandas as pd

from app.core.config import settings
from app.core.database import get_connection
from app.data.features import compute_features
from app.data.store import load_ohlcv

logger = logging.getLogger(__name__)

# Patterns that get scanned (key = feature name used in compute_features)
PATTERN_FEATURES = [
    "candle_doji",
    "candle_hammer",
    "candle_engulf_bull",
    "candle_engulf_bear",
    "candle_morning_star",
    "candle_evening_star",
]

PATTERN_DIRECTION: dict[str, str] = {
    "candle_doji":        "BULL",   # neutral signal — default BULL for directionality
    "candle_hammer":      "BULL",
    "candle_engulf_bull": "BULL",
    "candle_engulf_bear": "SHORT",
    "candle_morning_star":"BULL",
    "candle_evening_star":"SHORT",
}

TARGET_HORIZON = 5  # bars forward to validate pattern


def scan_all() -> int:
    """Scan GC=F across all timeframes and immediately confirm eligible patterns."""
    total = 0
    for tf in settings.timeframes:
        total += scan_timeframe(settings.gold_symbol, tf)
        # Confirm any patterns that now have TARGET_HORIZON bars of forward data
        update_pattern_stats(settings.gold_symbol, tf)
    return total


def backfill_all() -> None:
    """Confirm ALL historical unconfirmed patterns across every timeframe."""
    for tf in settings.timeframes:
        update_pattern_stats(settings.gold_symbol, tf)


def scan_timeframe(symbol: str, timeframe: str) -> int:
    """Scan one symbol/timeframe, insert new patterns, return count inserted."""
    df = load_ohlcv(symbol, timeframe, limit=500)
    if df.empty:
        return 0

    # Only scan patterns valid for this timeframe
    valid_features = [
        f for f in PATTERN_FEATURES
        if timeframe in __import__("app.data.features", fromlist=["FEATURE_REGISTRY"])
        .FEATURE_REGISTRY.get(f, {}).get("timeframes", [])
    ]
    if not valid_features:
        return 0

    df = compute_features(df, valid_features)
    df = df.dropna(subset=valid_features)
    if df.empty:
        return 0

    # Determine most recent ts already stored for this symbol/tf
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT MAX(ts) FROM patterns WHERE symbol=? AND timeframe=?",
            (symbol, timeframe),
        ).fetchone()
        last_ts = row[0] if row and row[0] else 0
    finally:
        conn.close()

    rows_to_insert: list[tuple] = []
    for idx, row_data in df.iterrows():
        ts_ms = int(idx.timestamp() * 1000)
        if ts_ms <= last_ts:
            continue
        for feat in valid_features:
            if row_data.get(feat, 0.0) == 1.0:
                direction = PATTERN_DIRECTION[feat]
                rows_to_insert.append((
                    str(uuid.uuid4()), symbol, timeframe,
                    ts_ms, feat, direction, 1.0, None,
                ))

    if not rows_to_insert:
        return 0

    conn = get_connection()
    try:
        conn.executemany(
            "INSERT OR IGNORE INTO patterns "
            "(id, symbol, timeframe, ts, pattern_type, direction, strength, confirmed_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            rows_to_insert,
        )
        conn.commit()
    finally:
        conn.close()

    logger.info("Pattern engine: %d new patterns for %s/%s", len(rows_to_insert), symbol, timeframe)
    return len(rows_to_insert)


def update_pattern_stats(symbol: str, timeframe: str) -> None:
    """
    Confirm unconfirmed patterns that now have TARGET_HORIZON bars of forward data.
    Uses integer unix-ms timestamps throughout — no float/datetime roundtrip.
    """
    conn = get_connection()
    try:
        # Load all price bars as (ts_ms -> close) using integer timestamps from the DB
        rows = conn.execute(
            "SELECT ts, close FROM price_data "
            "WHERE symbol=? AND timeframe=? ORDER BY ts ASC",
            (symbol, timeframe),
        ).fetchall()
        if not rows:
            return

        # Build ordered list and index by integer ts_ms
        ts_list  = [r["ts"] for r in rows]       # sorted unix-ms ints
        close_arr = [r["close"] for r in rows]    # parallel close prices
        ts_to_idx = {ts: i for i, ts in enumerate(ts_list)}

        unconfirmed = conn.execute(
            "SELECT id, ts, pattern_type, direction FROM patterns "
            "WHERE symbol=? AND timeframe=? AND confirmed_at IS NULL",
            (symbol, timeframe),
        ).fetchall()

        now_ts_ms = int(time.time() * 1000)
        updates:   list[tuple] = []
        stats_map: dict[tuple, dict] = {}

        for p in unconfirmed:
            p_ts = p["ts"]   # integer unix-ms, exactly as stored
            idx_pos = ts_to_idx.get(p_ts)
            if idx_pos is None:
                # Try fuzzy match: find closest bar within 1 minute
                closest = min(ts_to_idx.keys(), key=lambda t: abs(t - p_ts), default=None)
                if closest is None or abs(closest - p_ts) > 60_000:
                    continue
                idx_pos = ts_to_idx[closest]

            fwd_idx = idx_pos + TARGET_HORIZON
            if fwd_idx >= len(ts_list):
                continue  # forward bars not available yet

            entry_px = close_arr[idx_pos]
            exit_px  = close_arr[fwd_idx]
            fwd_ret  = (exit_px - entry_px) / (entry_px + 1e-9)

            correct = 1 if (
                (p["direction"] == "BULL" and fwd_ret > 0) or
                (p["direction"] == "SHORT" and fwd_ret < 0)
            ) else 0

            updates.append((now_ts_ms, round(fwd_ret, 6), correct, p["id"]))
            key = (p["pattern_type"], timeframe, p["direction"])
            if key not in stats_map:
                stats_map[key] = {"n_total": 0, "n_correct": 0, "fwd_rets": []}
            stats_map[key]["n_total"]   += 1
            stats_map[key]["n_correct"] += correct
            stats_map[key]["fwd_rets"].append(fwd_ret)

        if updates:
            # Store confirmed_at AND the realised forward return on the pattern row
            conn.executemany(
                "UPDATE patterns SET confirmed_at=? WHERE id=?",
                [(u[0], u[3]) for u in updates],
            )

        for (ptype, tf, direction), s in stats_map.items():
            mean_ret = sum(s["fwd_rets"]) / max(len(s["fwd_rets"]), 1)
            conn.execute(
                """
                INSERT INTO pattern_stats
                    (pattern_type, timeframe, direction, n_total, n_correct, mean_fwd_ret, updated_at)
                VALUES (?,?,?,?,?,?,?)
                ON CONFLICT(pattern_type, timeframe, direction) DO UPDATE SET
                    n_total      = n_total      + excluded.n_total,
                    n_correct    = n_correct    + excluded.n_correct,
                    mean_fwd_ret = excluded.mean_fwd_ret,
                    updated_at   = excluded.updated_at
                """,
                (ptype, tf, direction, s["n_total"], s["n_correct"],
                 round(mean_ret, 6), int(time.time())),
            )

        conn.commit()
        if updates:
            logger.info(
                "Pattern stats: confirmed %d patterns for %s/%s",
                len(updates), symbol, timeframe,
            )
    finally:
        conn.close()
