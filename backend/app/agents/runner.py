"""
Live signal engine.
compute_live_signals() iterates active ML agents, runs predict_single on the
latest bar, persists to the signals table, then computes an EnsembleBot
majority-vote signal.
"""
from __future__ import annotations

import logging
import time
import uuid

from app.agents.registry import list_agents
from app.core.config import settings
from app.core.database import get_connection
from app.data.features import compute_features
from app.data.store import latest_bar_ts, load_macro, load_ohlcv
from app.ml import model_registry
from app.ml.feature_store import get_or_compute
from app.models.base import BaseSignalModel

logger = logging.getLogger(__name__)

_ENSEMBLE_NAMES = {"ensemblebot", "ensemble bot", "ensemble"}


def _is_ensemble(name: str) -> bool:
    return name.strip().lower() in _ENSEMBLE_NAMES


def _save_signal(agent_id: str, ts: int, timeframe: str, signal: str, confidence: float) -> None:
    sig_id = str(uuid.uuid4())
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO signals (id, agent_id, ts, timeframe, signal, confidence) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (sig_id, agent_id, ts, timeframe, signal, confidence),
        )
        conn.commit()
    finally:
        conn.close()


def compute_live_signals() -> list[dict]:
    """
    For each active non-ensemble agent: load model, compute features on the
    last 200 bars, run predict_single on the latest bar, save signal to DB.
    EnsembleBot (name-based): majority vote over the non-ensemble results.
    Returns list of {agent_id, signal, confidence, ts, timeframe}.
    """
    agents = list_agents()
    active = [a for a in agents if a.status == "active"]
    ml_agents = [a for a in active if not _is_ensemble(a.name)]
    ensemble_agents = [a for a in active if _is_ensemble(a.name)]

    ml_results: list[dict] = []

    for agent in ml_agents:
        try:
            blob = model_registry.load_active_model(agent.id)
            if blob is None:
                logger.warning("No active model for agent %s — skipping.", agent.id)
                continue

            model_bytes, feature_names = blob
            model: BaseSignalModel = BaseSignalModel.from_bytes(model_bytes)

            df = get_or_compute(
                agent.id, feature_names, settings.gold_symbol, agent.timeframe, limit=200
            )
            if df is None or df.empty:
                continue

            latest = df.iloc[[-1]][feature_names]
            signal, confidence = model.predict_single(latest)

            # Use the latest candle's bar timestamp so the chart marker
            # lands on an actual candle rather than the current wall-clock time
            latest_ms = latest_bar_ts(settings.gold_symbol, agent.timeframe)
            ts = int(latest_ms / 1000) if latest_ms else int(time.time())

            _save_signal(agent.id, ts, agent.timeframe, signal, confidence)
            ml_results.append(
                dict(agent_id=agent.id, signal=signal,
                     confidence=confidence, ts=ts, timeframe=agent.timeframe)
            )
        except Exception as exc:
            logger.error("Signal computation failed for agent %s: %s", agent.id, exc)

    all_results = list(ml_results)

    # ── EnsembleBot majority vote ─────────────────────────────────────────────
    if ensemble_agents and ml_results:
        bull_count   = sum(1 for r in ml_results if r["signal"] == "BULL")
        short_count  = len(ml_results) - bull_count
        majority     = "BULL" if bull_count >= short_count else "SHORT"
        confidence   = max(bull_count, short_count) / len(ml_results)
        ts = int(time.time())

        for ea in ensemble_agents:
            _save_signal(ea.id, ts, ea.timeframe, majority, confidence)
            all_results.append(
                dict(agent_id=ea.id, signal=majority,
                     confidence=confidence, ts=ts, timeframe=ea.timeframe)
            )

    return all_results


def get_latest_signals(agent_ids: list[str] | None = None) -> list[dict]:
    """Return the most recent signal record per agent_id."""
    conn = get_connection()
    try:
        if agent_ids:
            placeholders = ",".join("?" * len(agent_ids))
            query = f"""
                SELECT s.*
                FROM signals s
                INNER JOIN (
                    SELECT agent_id, MAX(ts) AS max_ts
                    FROM signals
                    WHERE agent_id IN ({placeholders})
                    GROUP BY agent_id
                ) latest ON s.agent_id = latest.agent_id AND s.ts = latest.max_ts
            """
            rows = conn.execute(query, agent_ids).fetchall()
        else:
            query = """
                SELECT s.*
                FROM signals s
                INNER JOIN (
                    SELECT agent_id, MAX(ts) AS max_ts
                    FROM signals
                    GROUP BY agent_id
                ) latest ON s.agent_id = latest.agent_id AND s.ts = latest.max_ts
            """
            rows = conn.execute(query).fetchall()

        return [dict(r) for r in rows]
    finally:
        conn.close()
