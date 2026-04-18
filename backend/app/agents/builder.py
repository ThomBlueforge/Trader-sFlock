"""
Agent model creation and training.
train_agent() runs a walk-forward backtest, then retrains a final model
on the full dataset and persists the blob.
"""
from __future__ import annotations

import logging

from app.agents.registry import get_agent, set_agent_status
from app.core.config import settings
from app.data.features import compute_features
from app.data.store import load_macro, load_ohlcv
from app.ml import model_registry
from app.ml.feature_store import invalidate as invalidate_cache
from app.models.base import BaseSignalModel
from app.models.lgbm_model import LGBMModel
from app.models.logreg import LogRegModel
from app.models.xgb_model import XGBModel
from app.paper_trading.backtest import _build_target, run_walkforward

logger = logging.getLogger(__name__)


def create_model(model_type: str, hyperparams: dict) -> BaseSignalModel:
    """Instantiate a LogRegModel, XGBModel, or LGBMModel."""
    if model_type == "logreg":
        return LogRegModel(**hyperparams)
    if model_type == "xgboost":
        return XGBModel(**hyperparams)
    if model_type == "lgbm":
        return LGBMModel(**hyperparams)
    raise ValueError(f"Unknown model_type: {model_type!r}. Expected 'logreg', 'xgboost', or 'lgbm'.")


def train_agent(agent_id: str, progress_cb=None) -> dict:
    """
    Full training pipeline for one agent:
      1. Set status = 'training'
      2. run_walkforward() (backtest + classification metrics)
      3. Retrain final model on full dataset
      4. save_model_blob()
      5. Set status = 'trained', persist metrics
      6. Return metrics dict

    On any error: revert status to 'created' and re-raise.
    """
    agent = get_agent(agent_id)
    if agent is None:
        raise ValueError(f"Agent {agent_id!r} not found.")
    if not agent.features:
        raise ValueError("Agent has no features selected — cannot train.")

    set_agent_status(agent_id, "training")
    logger.info("Training agent %s (%s / %s)", agent.name, agent.model_type, agent.timeframe)

    try:
        _cls_map = {"logreg": LogRegModel, "xgboost": XGBModel, "lgbm": LGBMModel}
        model_cls = _cls_map.get(agent.model_type, XGBModel)

        # ── Walk-forward backtest ─────────────────────────────────────────────
        result = run_walkforward(
            model_cls=model_cls,
            model_kwargs=agent.hyperparams,
            features=agent.features,
            symbol=settings.gold_symbol,
            timeframe=agent.timeframe,
            target_horizon=agent.target_horizon,
            target_threshold=agent.target_threshold,
            train_window=agent.train_window,
            position_size_pct=agent.position_size_pct,
            progress_cb=progress_cb,
        )
        metrics: dict = result.get("metrics", {})

        # ── Final model retrain on full dataset ───────────────────────────────
        gold_df = load_ohlcv(settings.gold_symbol, agent.timeframe)
        macro   = load_macro("1d") if agent.timeframe == "1d" else None
        df      = compute_features(gold_df.copy(), agent.features, macro)
        df      = df.dropna(subset=agent.features)
        df["_target"] = _build_target(df["close"], agent.target_horizon, agent.target_threshold)
        df      = df.dropna(subset=["_target"])

        if df.empty or df["_target"].nunique() < 2:
            raise ValueError("Insufficient data for final model training.")

        final_model = model_cls(**agent.hyperparams)
        final_model.fit(df[agent.features], df["_target"])

        # Attach XGBoost feature importances to metrics if available
        if agent.model_type == "xgboost" and hasattr(final_model, "feature_importances"):
            fi = final_model.feature_importances
            if fi:
                metrics["feature_importances"] = fi

        model_registry.save_model_version(
            agent_id,
            final_model.to_bytes(),
            agent.features,
            agent.hyperparams,
            metrics,
        )
        invalidate_cache(agent_id)
        set_agent_status(agent_id, "trained", metrics)
        logger.info("Agent %s training complete. Metrics: %s", agent.name, metrics)
        return metrics

    except Exception as exc:
        logger.error("Training agent %s failed: %s", agent_id, exc)
        set_agent_status(agent_id, "created")
        raise
