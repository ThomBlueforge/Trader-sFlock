"""
Agent management endpoints.
Route ordering is intentional: /signals/latest must precede /{agent_id}
so FastAPI's router doesn't treat 'signals' as an agent_id.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query

from app.agents import registry
from app.agents.runner import _is_ensemble, get_latest_signals
from app.core.database import get_connection
from app.paper_trading.portfolio import get_or_create_portfolio
from app.schemas import AgentCreate, AgentOut, AgentUpdate, LatestSignals, SignalOut

router = APIRouter()


# ── Collection routes ──────────────────────────────────────────────────────────────

@router.get("/")
async def list_agents() -> list[AgentOut]:
    return await asyncio.to_thread(registry.list_agents)


@router.post("/")
async def create_agent(data: AgentCreate) -> AgentOut:
    return await asyncio.to_thread(registry.create_agent, data)


# MUST be declared before /{agent_id} — quick-start one-click baseline agent
@router.post("/baseline")
async def create_baseline_agent(background_tasks: BackgroundTasks) -> AgentOut:
    from app.api.training import _do_train
    baseline = AgentCreate(
        name="BaselineBot",
        color="#d4af37",
        timeframe="1d",
        features=["rsi_14", "macd_hist", "bb_pct", "atr_pct",
                  "return_5", "ema_ratio", "volume_ratio",
                  "close_position", "body_ratio", "dxy_return_5"],
        model_type="xgboost",
        hyperparams={"n_estimators": 200, "max_depth": 4,
                     "learning_rate": 0.05, "subsample": 0.8,
                     "colsample_bytree": 0.8},
        target_horizon=5,
        target_threshold=0.003,
        train_window=500,
        position_size_pct=0.1,
    )
    agent = await asyncio.to_thread(registry.create_agent, baseline)
    background_tasks.add_task(_do_train, agent.id)
    return agent


@router.post("/presets")
async def create_preset_agents() -> list[AgentOut]:
    """
    Create 5 diverse pre-configured agents covering different strategies.
    Existing agents are NOT removed. Returns the newly created agents.
    """
    PRESETS = [
        AgentCreate(
            name="MacroGold",
            color="#d4af37",
            timeframe="1d",
            features=[
                "dxy_return_5", "vix_level", "vix_return_5",
                "tnx_return_5", "spx_return_5",
                "gold_dxy_corr_21", "gold_vix_corr_21",
                "real_yield_proxy",
            ],
            model_type="xgboost",
            hyperparams={"n_estimators": 300, "max_depth": 4,
                         "learning_rate": 0.05, "subsample": 0.8,
                         "colsample_bytree": 0.8},
            target_horizon=5, target_threshold=0.003,
            train_window=500, position_size_pct=0.1,
        ),
        AgentCreate(
            name="TechMomentum",
            color="#3b82f6",
            timeframe="4h",
            features=[
                "ema_ratio", "rsi_14", "macd_hist", "return_5",
                "adx_14", "volume_ratio", "close_position",
                "body_ratio", "atr_pct",
            ],
            model_type="lgbm",
            hyperparams={"n_estimators": 300, "max_depth": 5,
                         "learning_rate": 0.05, "num_leaves": 31,
                         "subsample": 0.8, "colsample_bytree": 0.8},
            target_horizon=3, target_threshold=0.002,
            train_window=400, position_size_pct=0.1,
        ),
        AgentCreate(
            name="VolBreakout",
            color="#8b5cf6",
            timeframe="1h",
            features=[
                "bb_squeeze", "bb_width", "atr_ratio",
                "volume_spike", "volume_ratio",
                "return_3", "macd_hist", "adx_14",
            ],
            model_type="xgboost",
            hyperparams={"n_estimators": 200, "max_depth": 4,
                         "learning_rate": 0.05, "subsample": 0.8,
                         "colsample_bytree": 0.8},
            target_horizon=6, target_threshold=0.003,
            train_window=400, position_size_pct=0.1,
        ),
        AgentCreate(
            name="SafeHaven",
            color="#ec4899",
            timeframe="1d",
            features=[
                "vix_level", "vix_return_5", "gold_vix_corr_21",
                "spx_return_5", "real_yield_proxy",
                "regime_volatility", "candle_engulf_bull",
                "candle_morning_star",
            ],
            model_type="logreg",
            hyperparams={"C": 1.0, "max_iter": 1000},
            target_horizon=7, target_threshold=0.004,
            train_window=600, position_size_pct=0.1,
        ),
        AgentCreate(
            name="PriceAction",
            color="#14b8a6",
            timeframe="1d",
            features=[
                "candle_hammer", "candle_engulf_bull", "candle_morning_star",
                "momentum_quintile", "regime_trend",
                "return_5", "volume_ratio", "body_ratio",
                "close_position", "hl_range_pct",
            ],
            model_type="xgboost",
            hyperparams={"n_estimators": 250, "max_depth": 4,
                         "learning_rate": 0.05, "subsample": 0.8,
                         "colsample_bytree": 0.8},
            target_horizon=5, target_threshold=0.003,
            train_window=500, position_size_pct=0.1,
        ),
        AgentCreate(
            name="IntraScalper15m",
            color="#f97316",
            timeframe="15m",
            features=[
                "rsi_7", "rsi_14", "macd_hist", "ema_ratio",
                "vwap_pct", "session_open", "volume_ratio", "volume_spike",
                "return_3", "close_position", "body_ratio", "candle_hammer",
            ],
            model_type="lgbm",
            hyperparams={"n_estimators": 300, "max_depth": 5,
                         "learning_rate": 0.05, "num_leaves": 31,
                         "subsample": 0.8, "colsample_bytree": 0.8},
            target_horizon=4, target_threshold=0.0015,
            train_window=300, position_size_pct=0.08,
        ),
        AgentCreate(
            name="UltraScalp5m",
            color="#a855f7",
            timeframe="5m",
            features=[
                "rsi_7", "return_1", "return_3",
                "hl_range_pct", "volume_ratio", "volume_spike",
                "close_position", "body_ratio", "vwap_pct",
                "macd_hist", "bb_pct", "candle_engulf_bull",
            ],
            model_type="xgboost",
            hyperparams={"n_estimators": 200, "max_depth": 3,
                         "learning_rate": 0.05, "subsample": 0.8,
                         "colsample_bytree": 0.8},
            target_horizon=3, target_threshold=0.001,
            train_window=250, position_size_pct=0.05,
        ),
    ]
    created = []
    for preset in PRESETS:
        agent = await asyncio.to_thread(registry.create_agent, preset)
        created.append(agent)
    return created


# MUST be before /{agent_id} — generate live signals for all active agents
@router.post("/signals/generate")
async def generate_signals() -> dict:
    """
    Immediately compute live signals for all active agents.
    Call this after activating an agent or to force a fresh prediction.
    """
    from app.agents.runner import compute_live_signals
    signals = await asyncio.to_thread(compute_live_signals)
    return {"generated": len(signals), "signals": signals}


# ── This MUST be declared before /{agent_id} ─────────────────────────────────

@router.get("/signals/latest")
async def get_latest() -> LatestSignals:
    signals = await asyncio.to_thread(get_latest_signals)
    return LatestSignals(signals=[SignalOut(**s) for s in signals])


# ── Per-agent routes ──────────────────────────────────────────────────────────

@router.get("/{agent_id}")
async def get_agent(agent_id: str) -> AgentOut:
    agent = await asyncio.to_thread(registry.get_agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.patch("/{agent_id}")
async def update_agent(agent_id: str, data: AgentUpdate) -> AgentOut:
    agent = await asyncio.to_thread(registry.update_agent, agent_id, data)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.delete("/{agent_id}")
async def delete_agent(agent_id: str) -> dict:
    deleted = await asyncio.to_thread(registry.delete_agent, agent_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Agent not found")
    return {"deleted": True}


@router.post("/{agent_id}/activate")
async def activate_agent(agent_id: str, background_tasks: BackgroundTasks) -> AgentOut:
    agent = await asyncio.to_thread(registry.get_agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    # EnsembleBot never trains — skip the trained-status check and skip portfolio
    is_ens = _is_ensemble(agent.name)
    if not is_ens and agent.status not in ("trained", "active"):
        raise HTTPException(status_code=400, detail="Agent must be trained before activation.")

    if not is_ens:
        await asyncio.to_thread(
            get_or_create_portfolio, agent_id, agent.position_size_pct
        )

    await asyncio.to_thread(registry.set_agent_status, agent_id, "active")
    agent_out = await asyncio.to_thread(registry.get_agent, agent_id)

    # Generate a signal immediately so the user sees it instantly on the Chart tab
    async def _gen_now():
        from app.agents.runner import compute_live_signals
        await asyncio.to_thread(compute_live_signals)
    background_tasks.add_task(_gen_now)

    return agent_out  # type: ignore[return-value]


@router.post("/{agent_id}/deactivate")
async def deactivate_agent(agent_id: str) -> AgentOut:
    agent = await asyncio.to_thread(registry.get_agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    # EnsembleBot → back to 'created'; trained agents → back to 'trained'
    target = "created" if _is_ensemble(agent.name) else "trained"
    await asyncio.to_thread(registry.set_agent_status, agent_id, target)
    return await asyncio.to_thread(registry.get_agent, agent_id)  # type: ignore[return-value]


@router.get("/{agent_id}/signals")
async def get_agent_signals(
    agent_id: str,
    limit: int = 100,
) -> list[SignalOut]:
    def _fetch(aid: str, lim: int) -> list[SignalOut]:
        conn = get_connection()
        try:
            rows = conn.execute(
                "SELECT * FROM signals WHERE agent_id=? ORDER BY ts DESC LIMIT ?",
                (aid, lim),
            ).fetchall()
            return [SignalOut(**dict(r)) for r in rows]
        finally:
            conn.close()

    return await asyncio.to_thread(_fetch, agent_id, limit)
