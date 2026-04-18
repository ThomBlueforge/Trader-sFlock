"""
Market regime detector.
Runs on the daily GC=F data after each refresh.
Uses a quantile-threshold approach on the 21-day ATR to label each bar as
LOW / MED / HIGH volatility and persists to market_regimes.
"""
from __future__ import annotations

import logging
import time

import ta

from app.core.config import settings
from app.core.database import get_connection
from app.data.store import load_ohlcv

logger = logging.getLogger(__name__)

REGIME_LABELS = {0: "LOW", 1: "MED", 2: "HIGH"}


def detect_and_store() -> int:
    """Compute regimes for the full daily history and upsert into market_regimes."""
    df = load_ohlcv(settings.gold_symbol, "1d")
    if df.empty or len(df) < 63:
        return 0

    atr   = ta.volatility.AverageTrueRange(
        df["high"], df["low"], df["close"], window=14
    ).average_true_range()
    atr_21 = atr.rolling(21).mean()

    # Normalise to rolling median so absolute gold price doesn't matter
    atr_norm = atr_21 / (atr_21.rolling(252, min_periods=63).mean() + 1e-9)

    # Find most recent ts already written
    conn = get_connection()
    try:
        row = conn.execute("SELECT MAX(ts) FROM market_regimes").fetchone()
        last_ts = row[0] if row and row[0] else 0
    finally:
        conn.close()

    rows: list[tuple] = []
    for idx, norm_val in atr_norm.items():
        if atr_21[idx] != atr_21[idx]:  # NaN check
            continue
        ts_ms = int(idx.timestamp() * 1000)
        if ts_ms <= last_ts:
            continue

        if norm_val < 0.75:
            regime = "LOW"
        elif norm_val > 1.25:
            regime = "HIGH"
        else:
            regime = "MED"

        rows.append((ts_ms, regime, round(float(atr_21[idx]), 4)))

    if not rows:
        return 0

    conn = get_connection()
    try:
        conn.executemany(
            "INSERT OR REPLACE INTO market_regimes (ts, regime, atr_21) VALUES (?,?,?)",
            rows,
        )
        conn.commit()
    finally:
        conn.close()

    logger.info("Regime detector: %d rows upserted", len(rows))
    return len(rows)


def get_current_regime() -> str:
    """Return the most recent daily regime label."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT regime FROM market_regimes ORDER BY ts DESC LIMIT 1"
        ).fetchone()
        return row["regime"] if row else "MED"
    finally:
        conn.close()


def load_regimes(limit: int = 500) -> list[dict]:
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT ts, regime, atr_21 FROM market_regimes ORDER BY ts DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [{"ts": r["ts"], "regime": r["regime"], "atr_21": r["atr_21"]}
                for r in reversed(rows)]
    finally:
        conn.close()
