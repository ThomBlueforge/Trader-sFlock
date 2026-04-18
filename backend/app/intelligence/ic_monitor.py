"""
Nightly IC monitor.
For each active agent: computes rolling 7-day and 21-day Information Coefficient
from the signals table vs actual price movements.  Writes to performance_log.
If ic_7d < 0.02 for 3 consecutive days, broadcasts agent_degraded and inserts a
notification.
"""
from __future__ import annotations

import logging
import time
import uuid

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

from app.core.database import get_connection

logger = logging.getLogger(__name__)

# Duration in seconds for each timeframe bar
TF_SECONDS: dict[str, int] = {
    "15m": 900,
    "30m": 1800,
    "1h":  3600,
    "2h":  7200,
    "4h":  14400,
    "1d":  86400,
}

IC_DEGRADATION_THRESHOLD = 0.02
DEGRADATION_DAYS = 3


async def run_ic_monitor(broadcast_fn=None) -> None:
    """
    Main entry point called by the nightly scheduler job.
    broadcast_fn: async callable(event_name: str, data: dict)
    """
    conn = get_connection()
    try:
        agents = conn.execute(
            "SELECT id, name, timeframe FROM agents WHERE status = 'active'"
        ).fetchall()
    finally:
        conn.close()

    now_sec = int(time.time())

    for agent in agents:
        try:
            ic_7d, ic_21d, n_sigs = _compute_ic(
                agent["id"], agent["timeframe"], now_sec
            )

            _write_perf_log(agent["id"], now_sec, ic_7d, ic_21d, n_sigs)

            if ic_7d is not None and ic_7d < IC_DEGRADATION_THRESHOLD:
                if _count_recent_degraded_days(agent["id"]) >= DEGRADATION_DAYS - 1:
                    msg = (
                        f"Agent '{agent['name']}' IC-7d dropped to {ic_7d:.3f} "
                        f"(threshold {IC_DEGRADATION_THRESHOLD}) for "
                        f"{DEGRADATION_DAYS} consecutive days."
                    )
                    _insert_notification(agent["id"], "agent_degraded", msg)
                    if broadcast_fn:
                        await broadcast_fn(
                            "agent_degraded",
                            {"agent_id": agent["id"], "ic_7d": ic_7d, "message": msg},
                        )
                    logger.warning(msg)
        except Exception as exc:
            logger.error("IC monitor error for agent %s: %s", agent["id"], exc)


def _compute_ic(agent_id: str, timeframe: str, now_sec: int):
    """
    Compute rolling IC over 7d and 21d windows.
    Returns (ic_7d, ic_21d, n_signals) — values may be None if insufficient data.
    """
    tf_sec  = TF_SECONDS.get(timeframe, 86400)
    horizon = 5  # default horizon in bars

    cutoff_7d  = now_sec - 7  * 86400
    cutoff_21d = now_sec - 21 * 86400

    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT ts, signal, confidence FROM signals "
            "WHERE agent_id = ? AND ts >= ? ORDER BY ts",
            (agent_id, cutoff_21d),
        ).fetchall()
        if not rows:
            return None, None, 0

        # Build series
        sigs = pd.DataFrame([dict(r) for r in rows])
        sigs["p_bull"] = sigs.apply(
            lambda r: r["confidence"] if r["signal"] == "BULL" else 1 - r["confidence"],
            axis=1,
        )

        # Load prices
        from app.data.store import load_ohlcv
        from app.core.config import settings
        df = load_ohlcv(settings.gold_symbol, timeframe)
        if df.empty:
            return None, None, 0

        close_ts = {int(idx.timestamp()): float(v) for idx, v in df["close"].items()}

        def _ic_for_window(cutoff_sec: int):
            mask = sigs["ts"] >= cutoff_sec
            s    = sigs[mask]
            if len(s) < 10:
                return None
            fwd_rets = []
            proba    = []
            for _, row in s.iterrows():
                entry_sec = int(row["ts"])
                exit_sec  = entry_sec + horizon * tf_sec
                entry_px  = close_ts.get(entry_sec)
                exit_px   = close_ts.get(exit_sec)
                if entry_px and exit_px:
                    fwd_rets.append((exit_px - entry_px) / (entry_px + 1e-9))
                    proba.append(row["p_bull"])
            if len(fwd_rets) < 10:
                return None
            ic, _ = spearmanr(proba, fwd_rets)
            return round(float(ic), 4)

        ic_7d  = _ic_for_window(cutoff_7d)
        ic_21d = _ic_for_window(cutoff_21d)
        return ic_7d, ic_21d, len(sigs)
    finally:
        conn.close()


def _write_perf_log(agent_id: str, ts: int, ic_7d, ic_21d, n_sigs: int) -> None:
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO performance_log (id, agent_id, ts, ic_7d, ic_21d, n_signals) "
            "VALUES (?,?,?,?,?,?)",
            (str(uuid.uuid4()), agent_id, ts, ic_7d, ic_21d, n_sigs),
        )
        conn.commit()
    finally:
        conn.close()


def _count_recent_degraded_days(agent_id: str) -> int:
    """Count consecutive trailing days where ic_7d < threshold."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT ic_7d FROM performance_log WHERE agent_id=? ORDER BY ts DESC LIMIT ?",
            (agent_id, DEGRADATION_DAYS),
        ).fetchall()
        return sum(
            1 for r in rows
            if r["ic_7d"] is not None and r["ic_7d"] < IC_DEGRADATION_THRESHOLD
        )
    finally:
        conn.close()


def _insert_notification(agent_id: str, ntype: str, message: str) -> None:
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO notifications (id, agent_id, type, message, is_read, created_at) "
            "VALUES (?,?,?,?,0,?)",
            (str(uuid.uuid4()), agent_id, ntype, message, int(time.time())),
        )
        conn.commit()
    finally:
        conn.close()
