"""
Feature Store: caches the last computed feature matrix for each agent.
Cache key = hash(sorted(feature_list) + str(latest_price_bar_ts)).

On each live signal cycle, if the hash matches the stored entry the full
O(N*features) recomputation is skipped entirely.
"""
from __future__ import annotations

import hashlib
import io
import logging
import pickle
import time
from typing import Optional

import pandas as pd

from app.core.database import get_connection
from app.data.features import compute_features
from app.data.store import load_macro, load_ohlcv, latest_bar_ts
from app.core.config import settings

logger = logging.getLogger(__name__)


def _make_hash_key(feature_names: list[str], latest_ts: int) -> str:
    payload = ",".join(sorted(feature_names)) + f"|{latest_ts}"
    return hashlib.sha256(payload.encode()).hexdigest()[:24]


def _serialize(df: pd.DataFrame) -> bytes:
    return pickle.dumps(df, protocol=pickle.HIGHEST_PROTOCOL)


def _deserialize(data: bytes) -> pd.DataFrame:
    return pickle.loads(data)


# ── Public API ─────────────────────────────────────────────────────────────────

def get_or_compute(
    agent_id:      str,
    feature_names: list[str],
    symbol:        str,
    timeframe:     str,
    limit:         int = 200,
) -> Optional[pd.DataFrame]:
    """
    Return a feature-computed DataFrame for the last `limit` bars.
    Uses cached result if the hash matches; recomputes and caches otherwise.
    Returns None if data is unavailable.
    """
    ts = latest_bar_ts(symbol, timeframe)
    if ts is None:
        return None

    hash_key = _make_hash_key(feature_names, ts)
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT features_blob FROM feature_cache WHERE agent_id = ? AND hash_key = ?",
            (agent_id, hash_key),
        ).fetchone()
        if row is not None:
            logger.debug("Feature cache HIT for agent %s (key=%s)", agent_id, hash_key)
            return _deserialize(bytes(row["features_blob"]))
    finally:
        conn.close()

    logger.debug("Feature cache MISS for agent %s — recomputing…", agent_id)
    t0 = time.perf_counter()

    df = load_ohlcv(symbol, timeframe, limit=limit)
    if df is None or df.empty:
        return None

    macro = load_macro("1d") if timeframe == "1d" else None
    df    = compute_features(df, feature_names, macro)
    df    = df.dropna(subset=feature_names)
    if df.empty:
        return None

    blob = _serialize(df)

    conn = get_connection()
    try:
        # Invalidate old cache entry for this agent before inserting new one
        conn.execute("DELETE FROM feature_cache WHERE agent_id = ?", (agent_id,))
        conn.execute(
            """
            INSERT OR REPLACE INTO feature_cache
                (agent_id, hash_key, features_blob, index_blob, computed_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (agent_id, hash_key, blob, b"", int(time.time())),
        )
        conn.commit()
    finally:
        conn.close()

    logger.debug(
        "Feature cache computed for agent %s in %.2fs", agent_id, time.perf_counter() - t0
    )
    return df


def invalidate(agent_id: str) -> None:
    """Explicitly invalidate the cache entry for an agent."""
    conn = get_connection()
    try:
        conn.execute("DELETE FROM feature_cache WHERE agent_id = ?", (agent_id,))
        conn.commit()
    finally:
        conn.close()
