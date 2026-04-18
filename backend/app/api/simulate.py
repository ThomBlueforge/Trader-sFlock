"""
Simulation endpoints:
  POST /api/simulate/monte_carlo
  POST /api/simulate/scenario
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException

from app.agents.registry import get_agent
from app.core.config import settings
from app.intelligence.monte_carlo import run_simulation
from app.models.logreg import LogRegModel
from app.models.xgb_model import XGBModel
from app.models.lgbm_model import LGBMModel
from app.paper_trading.backtest import run_walkforward
from app.schemas import MonteCarloRequest, MonteCarloResult

router = APIRouter()

_MODEL_CLS = {"logreg": LogRegModel, "xgboost": XGBModel, "lgbm": LGBMModel}

# Pre-defined historical stress test windows (unix-ms)
SCENARIOS: dict[str, dict] = {
    "covid_crash":    {"name": "COVID Crash",         "start": 1580515200000, "end": 1585699200000},
    "gfc_2008":       {"name": "GFC 2008",             "start": 1220227200000, "end": 1230768000000},
    "gold_rally_2020":{"name": "Gold Rally 2020",      "start": 1591920000000, "end": 1598918400000},
    "rate_shock_2022":{"name": "Rate Shock 2022",      "start": 1640995200000, "end": 1661990400000},
}


@router.post("/monte_carlo")
async def monte_carlo(body: MonteCarloRequest) -> MonteCarloResult:
    agent = await asyncio.to_thread(get_agent, body.agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    if not agent.features:
        raise HTTPException(status_code=400, detail="Agent has no features")

    model_cls = _MODEL_CLS.get(agent.model_type, XGBModel)

    def _run():
        try:
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
            )
        except ValueError as exc:
            raise ValueError(str(exc))

        trades = result.get("trades", [])
        closed = [t for t in trades if t.get("pnl") is not None]
        if len(closed) < 5:
            raise ValueError(
                f"Not enough closed trades to simulate ({len(closed)} found, need at least 5). "
                f"Try a shorter train_window, lower threshold, or check that data exists for '{agent.timeframe}'."
            )

        return run_simulation(
            trades=closed,
            initial_capital=10_000.0,
            n_runs=body.n_runs,
            block_size=body.block_size,
        )

    try:
        sim = await asyncio.to_thread(_run)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return MonteCarloResult(**sim)


@router.get("/scenarios")
async def list_scenarios() -> list[dict]:
    return [{"id": k, **v} for k, v in SCENARIOS.items()]


@router.post("/scenario/{scenario_id}")
async def run_scenario(scenario_id: str, agent_id: str) -> dict:
    if scenario_id not in SCENARIOS:
        raise HTTPException(status_code=404, detail=f"Unknown scenario: {scenario_id!r}")

    agent = await asyncio.to_thread(get_agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    if not agent.features:
        raise HTTPException(status_code=400, detail="Agent has no features")

    sc = SCENARIOS[scenario_id]
    model_cls = _MODEL_CLS.get(agent.model_type, XGBModel)

    def _run():
        return run_walkforward(
            model_cls=model_cls,
            model_kwargs=agent.hyperparams,
            features=agent.features,
            symbol=settings.gold_symbol,
            timeframe=agent.timeframe,
            target_horizon=agent.target_horizon,
            target_threshold=agent.target_threshold,
            train_window=agent.train_window,
            position_size_pct=agent.position_size_pct,
            start_ts_ms=sc["start"],
            end_ts_ms=sc["end"],
        )

    result = await asyncio.to_thread(_run)
    result["scenario"] = sc
    return result
