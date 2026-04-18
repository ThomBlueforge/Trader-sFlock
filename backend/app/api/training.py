"""
Training endpoints.
  POST /api/training/{agent_id}/train    — async background training
  POST /api/training/{agent_id}/backtest — synchronous backtest
"""
from __future__ import annotations

import asyncio
import logging
import threading

from fastapi import APIRouter, BackgroundTasks, HTTPException

from app.agents.builder import train_agent
from app.agents.registry import get_agent
from app.api.ws import manager
from app.core.config import settings
from app.intelligence.setup_tester import run_setup_sweep, run_setup_test
from app.models.logreg import LogRegModel
from app.models.xgb_model import XGBModel
from app.paper_trading.backtest import run_walkforward
from app.schemas import SetupSweepRequest, SetupTestRequest

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Per-agent cancellation flags ─────────────────────────────────────────────
# A threading.Event is used because progress callbacks run in worker threads.
_cancel_events: dict[str, threading.Event] = {}

def _get_cancel_event(agent_id: str) -> threading.Event:
    if agent_id not in _cancel_events:
        _cancel_events[agent_id] = threading.Event()
    return _cancel_events[agent_id]

def _request_cancel(agent_id: str) -> None:
    _get_cancel_event(agent_id).set()

def _clear_cancel(agent_id: str) -> None:
    ev = _cancel_events.pop(agent_id, None)
    if ev:
        ev.clear()


async def _do_train(agent_id: str) -> None:
    """Background task: trains the agent and broadcasts progress over WebSocket."""
    loop        = asyncio.get_running_loop()
    cancel_ev   = _get_cancel_event(agent_id)
    cancel_ev.clear()   # reset any previous cancel request

    def sync_progress_cb(pct: int) -> None:
        if cancel_ev.is_set():
            raise InterruptedError(f"Training cancelled by user")
        asyncio.run_coroutine_threadsafe(
            manager.broadcast("training_progress", {"agent_id": agent_id, "pct": pct}),
            loop,
        )

    try:
        metrics = await asyncio.to_thread(train_agent, agent_id, sync_progress_cb)
        await manager.broadcast("training_complete", {"agent_id": agent_id, "metrics": metrics})
    except asyncio.CancelledError:
        logger.info("Training cancelled (shutdown) for agent %s", agent_id)
    except InterruptedError:
        logger.info("Training cancelled (user) for agent %s", agent_id)
        await manager.broadcast("training_error", {"agent_id": agent_id, "error": "Cancelled"})
    except Exception as exc:
        logger.error("Training failed for agent %s: %s", agent_id, exc)
        await manager.broadcast("training_error", {"agent_id": agent_id, "error": str(exc)})
    finally:
        _clear_cancel(agent_id)


@router.post("/{agent_id}/train")
async def train(agent_id: str, background_tasks: BackgroundTasks) -> dict:
    agent = await asyncio.to_thread(get_agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    background_tasks.add_task(_do_train, agent_id)
    return {"status": "training_started"}


@router.post("/{agent_id}/cancel")
async def cancel_training(agent_id: str) -> dict:
    """Request cancellation of a running train or optimize task for this agent."""
    agent = await asyncio.to_thread(get_agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    _request_cancel(agent_id)
    logger.info("Cancellation requested for agent %s", agent_id)
    return {"status": "cancel_requested"}


@router.post("/{agent_id}/optimize")
async def optimize(
    agent_id:       str,
    background_tasks: BackgroundTasks,
    n_trials:       int = 20,
) -> dict:
    """Run Optuna HPO then full training. n_trials controls search depth (default 20, max 5 min)."""
    agent = await asyncio.to_thread(get_agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    async def _do_optimize(aid: str):
        from app.intelligence.optimizer import optimize_agent
        loop = asyncio.get_running_loop()

        def sync_cb(pct: int):
            asyncio.run_coroutine_threadsafe(
                manager.broadcast("training_progress", {"agent_id": aid, "pct": pct}),
                loop,
            )

        try:
            # Allow ~12 seconds per trial, minimum 5 minutes
            timeout = max(300, n_trials * 12)
            best_hp = await asyncio.to_thread(optimize_agent, aid, n_trials, timeout, sync_cb)
            await asyncio.to_thread(train_agent, aid, sync_cb)
            await manager.broadcast("training_complete", {"agent_id": aid, "best_hyperparams": best_hp})
        except asyncio.CancelledError:
            logger.info("Optimization cancelled for agent %s (server shutting down)", aid)
        except Exception as exc:
            logger.error("Optimization failed for agent %s: %s", aid, exc)
            await manager.broadcast("training_error", {"agent_id": aid, "error": str(exc)})

    background_tasks.add_task(_do_optimize, agent_id)
    return {"status": "optimization_started"}


@router.post("/{agent_id}/backtest")
async def backtest(agent_id: str) -> dict:
    agent = await asyncio.to_thread(get_agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    if not agent.features:
        raise HTTPException(status_code=400, detail="Agent has no features selected.")

    model_cls = LogRegModel if agent.model_type == "logreg" else XGBModel

    result = await asyncio.to_thread(
        run_walkforward,
        model_cls,
        agent.hyperparams,
        agent.features,
        settings.gold_symbol,
        agent.timeframe,
        agent.target_horizon,
        agent.target_threshold,
        agent.train_window,
        agent.position_size_pct,
    )
    return result


@router.post("/{agent_id}/setup_test")
async def setup_test(agent_id: str, body: SetupTestRequest) -> dict:
    """
    Simulate the agent's signals with explicit SL / TP / hold-duration exits.
    Returns equity curve, per-trade log, and summary metrics.
    """
    agent = await asyncio.to_thread(get_agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    try:
        result = await asyncio.to_thread(
            run_setup_test,
            agent_id,
            body.hold_bars,
            body.stop_loss_pct,
            body.take_profit_pct,
            body.start_date,
            body.end_date,
            body.initial_capital,
            body.position_size_pct,
            body.min_confidence,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return result


@router.post("/{agent_id}/setup_sweep")
async def setup_sweep(agent_id: str, body: SetupSweepRequest) -> list:
    """
    Test a grid of hold_bars × stop_loss × take_profit combinations.
    Returns results sorted descending by Sharpe ratio.
    """
    agent = await asyncio.to_thread(get_agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    try:
        results = await asyncio.to_thread(
            run_setup_sweep,
            agent_id,
            body.hold_bars_list,
            body.sl_pcts,
            body.tp_pcts,
            body.start_date,
            body.end_date,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return results
