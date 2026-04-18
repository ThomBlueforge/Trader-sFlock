"""
Optuna-based hyperparameter optimisation.
A separate ./db/optuna.db SQLite file is used so optimisation trials do not
block the main application database.

optimize_agent() runs 50 Optuna TPE trials, each performing a reduced
walk-forward backtest on 60% of available data.  On completion the best
hyperparams are used to train the full final model via builder.train_agent().
"""
from __future__ import annotations

import logging
import os

import optuna

from app.agents.builder import train_agent
from app.agents.registry import get_agent, set_agent_status
from app.core.config import settings
from app.models.logreg import LogRegModel
from app.models.xgb_model import XGBModel
from app.models.lgbm_model import LGBMModel
from app.paper_trading.backtest import run_walkforward

logger = logging.getLogger(__name__)
optuna.logging.set_verbosity(optuna.logging.WARNING)

# Where Optuna stores its study (separate from the main app DB)
_OPTUNA_DB_PATH = os.getenv("OPTUNA_DB_PATH", "./db/optuna.db")


def _get_study_storage() -> str:
    os.makedirs(os.path.dirname(os.path.abspath(_OPTUNA_DB_PATH)), exist_ok=True)
    return f"sqlite:///{_OPTUNA_DB_PATH}"


def _build_search_space(trial: optuna.Trial, model_type: str) -> dict:
    if model_type == "logreg":
        return {
            "C":        trial.suggest_float("C", 0.01, 10.0, log=True),
            "max_iter": trial.suggest_int("max_iter", 200, 3000, step=100),
        }
    if model_type == "xgboost":
        return {
            "n_estimators":    trial.suggest_int("n_estimators", 100, 600, step=50),
            "max_depth":       trial.suggest_int("max_depth", 2, 8),
            "learning_rate":   trial.suggest_float("learning_rate", 0.01, 0.2, log=True),
            "subsample":       trial.suggest_float("subsample", 0.6, 1.0),
            "colsample_bytree": trial.suggest_float("colsample_bytree", 0.6, 1.0),
        }
    if model_type == "lgbm":
        return {
            "n_estimators":      trial.suggest_int("n_estimators", 100, 600, step=50),
            "max_depth":         trial.suggest_int("max_depth", 3, 8),
            "learning_rate":     trial.suggest_float("learning_rate", 0.01, 0.2, log=True),
            "num_leaves":        trial.suggest_int("num_leaves", 15, 63),
            "subsample":         trial.suggest_float("subsample", 0.6, 1.0),
            "colsample_bytree":  trial.suggest_float("colsample_bytree", 0.6, 1.0),
            "min_child_samples": trial.suggest_int("min_child_samples", 5, 50),
        }
    raise ValueError(f"Unknown model_type: {model_type!r}")


def _model_cls(model_type: str):
    return {"logreg": LogRegModel, "xgboost": XGBModel, "lgbm": LGBMModel}[model_type]


def optimize_agent(
    agent_id:   str,
    n_trials:   int  = 20,
    timeout_s:  int  = 300,    # hard stop after 5 minutes if not converged
    progress_cb = None,
) -> dict:
    """
    Run Optuna HPO for the given agent.
    Features are pre-computed ONCE before any trial starts (key speed-up).
    Each trial only runs the model-fit loop, not feature engineering.
    Returns the best hyperparams dict.
    """
    from app.data.features import compute_features
    from app.data.store import bar_count, load_macro, load_ohlcv
    from app.paper_trading.backtest import _build_target, COMMISSION
    import numpy as np
    import pandas as pd

    agent = get_agent(agent_id)
    if agent is None:
        raise ValueError(f"Agent {agent_id!r} not found")
    if not agent.features:
        raise ValueError("Agent has no features — cannot optimise")

    model_type  = agent.model_type
    model_cls_  = _model_cls(model_type)
    bpy         = settings.bars_per_year.get(agent.timeframe, 252)

    # ── Limit HPO data to last train_window*5 bars (speed vs coverage trade-off) ──
    max_trial_bars = max(agent.train_window * 5, 800)

    # ── Pre-compute features ONCE ───────────────────────────────────────────
    logger.info("Pre-computing features for agent %s HPO (%s bars)", agent_id, max_trial_bars)
    df_raw  = load_ohlcv(settings.gold_symbol, agent.timeframe, limit=max_trial_bars)
    if df_raw.empty or len(df_raw) < agent.train_window + 50:
        raise ValueError(
            f"Insufficient data for optimisation — only {len(df_raw)} bars available, "
            f"need at least {agent.train_window + 50}."
        )

    macro   = load_macro("1d") if agent.timeframe == "1d" else None
    df      = compute_features(df_raw.copy(), agent.features, macro)
    df      = df.dropna(subset=agent.features)
    df["_target"] = _build_target(df["close"], agent.target_horizon, agent.target_threshold)
    df      = df.dropna(subset=["_target"])

    if len(df) < agent.train_window + 50:
        raise ValueError(
            f"After feature computation only {len(df)} usable bars — "
            f"try fewer features or a shorter train_window."
        )

    features    = agent.features
    train_window = agent.train_window
    test_window  = max(30, train_window // 10)
    pos_pct     = agent.position_size_pct
    n           = len(df)
    close_map   = df["close"].to_dict()
    logger.info("Features ready: %d usable bars, running %d trials", n, n_trials)

    # ── Fast walk-forward on pre-computed DataFrame ────────────────────────
    def _fast_wf(hp: dict) -> float:
        """Walk-forward using pre-computed df. Returns Sharpe (or -99 on failure)."""
        equity    = [10_000.0]
        capital   = 10_000.0
        position  = 0
        entry_px  = 0.0

        for start in range(train_window, n, test_window):
            train = df.iloc[:start]
            test  = df.iloc[start: start + test_window]
            if test.empty or train["_target"].nunique() < 2:
                continue
            try:
                model = model_cls_(**hp)
                model.fit(train[features], train["_target"])
                proba   = model.predict_proba_bull(test[features])
                signals = ["BULL" if p >= 0.5 else "SHORT" for p in proba]
            except Exception:
                continue

            for idx, sig in zip(test.index, signals):
                price = close_map.get(idx)
                if price is None:
                    continue
                direction = 1 if sig == "BULL" else -1
                if position != direction:
                    if position != 0:
                        pnl = position * (price - entry_px) / (entry_px + 1e-9) * capital * pos_pct
                        pnl -= abs(capital * pos_pct) * COMMISSION
                        capital += pnl
                    capital -= capital * pos_pct * COMMISSION
                    position  = direction
                    entry_px  = price
                open_pnl = position * (price - entry_px) / (entry_px + 1e-9) * capital * pos_pct
                equity.append(capital + open_pnl)

        if len(equity) < 5:
            return -99.0
        eq  = np.array(equity, dtype=float)
        ret = np.diff(eq) / (eq[:-1] + 1e-9)
        return float(ret.mean() / (ret.std() + 1e-9) * np.sqrt(bpy))

    # ── Optuna study ─────────────────────────────────────────────────────
    def objective(trial: optuna.Trial) -> float:
        hp = _build_search_space(trial, model_type)
        try:
            return _fast_wf(hp)
        except Exception:
            return -99.0

    study = optuna.create_study(
        study_name=f"agent_{agent_id}",
        storage=_get_study_storage(),
        direction="maximize",
        load_if_exists=True,
        sampler=optuna.samplers.TPESampler(seed=42),
    )

    completed = [0]

    def callback(study, trial):
        completed[0] += 1
        if progress_cb:
            pct = int(completed[0] / n_trials * 90)
            progress_cb(pct)

    study.optimize(
        objective,
        n_trials=n_trials,
        timeout=timeout_s,
        callbacks=[callback],
        n_jobs=1,
    )

    if not study.trials or study.best_value <= -99:
        raise ValueError("All Optuna trials failed. Check your features and data.")

    best_hp = study.best_params
    logger.info(
        "Optuna best for agent %s: %s (Sharpe=%.3f)",
        agent_id, best_hp, study.best_value,
    )

    from app.agents.registry import update_agent
    from app.schemas import AgentUpdate
    update_agent(agent_id, AgentUpdate(hyperparams=best_hp))

    if progress_cb:
        progress_cb(90)

    return best_hp
