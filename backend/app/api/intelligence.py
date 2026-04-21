"""
Intelligence endpoints:
  GET  /api/intelligence/regimes?limit=500
  GET  /api/intelligence/patterns?symbol=GC=F&timeframe=1d&limit=100
  POST /api/intelligence/sweep
  POST /api/intelligence/mine_correlations
  GET  /api/intelligence/model_versions/{agent_id}
  POST /api/intelligence/rollback/{agent_id}/{version}
  GET  /api/intelligence/notifications?unread_only=true
  POST /api/intelligence/notifications/{id}/read
"""
from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query

from app.core.config import settings
from app.core.database import get_connection
from app.intelligence import edge_validator, regime_detector
from app.ml import model_registry
from app.models.logreg import LogRegModel
from app.models.xgb_model import XGBModel
from app.models.lgbm_model import LGBMModel
from app.paper_trading.backtest import run_walkforward
from app.schemas import (
    ModelVersionOut, NotificationOut, PatternOut, PatternStatsOut,
    RegimePoint, SweepCell, SweepRequest,
)

router = APIRouter()

_MODEL_CLS = {"logreg": LogRegModel, "xgboost": XGBModel, "lgbm": LGBMModel}


# ── Regimes ────────────────────────────────────────────────────────────────────

@router.get("/regimes")
async def get_regimes(limit: int = Query(500)) -> list[RegimePoint]:
    regimes = await asyncio.to_thread(regime_detector.load_regimes, limit)
    return [RegimePoint(**r) for r in regimes]


# ── Patterns ───────────────────────────────────────────────────────────────────

@router.get("/patterns")
async def get_patterns(
    symbol:    str = Query("GC=F"),
    timeframe: str = Query("1d"),
    limit:     int = Query(100),
) -> list[PatternOut]:
    def _fetch():
        conn = get_connection()
        try:
            rows = conn.execute(
                "SELECT * FROM patterns WHERE symbol=? AND timeframe=? "
                "ORDER BY ts DESC LIMIT ?",
                (symbol, timeframe, limit),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    rows = await asyncio.to_thread(_fetch)
    return [PatternOut(**r) for r in rows]


@router.get("/pattern_stats")
async def get_pattern_stats(timeframe: str = Query("1d")) -> list[PatternStatsOut]:
    def _fetch():
        conn = get_connection()
        try:
            rows = conn.execute(
                "SELECT * FROM pattern_stats WHERE timeframe=? ORDER BY n_total DESC",
                (timeframe,),
            ).fetchall()
            out = []
            for r in rows:
                d = dict(r)
                d["hit_rate"] = round(d["n_correct"] / max(d["n_total"], 1), 4)
                out.append(d)
            return out
        finally:
            conn.close()

    rows = await asyncio.to_thread(_fetch)
    return [PatternStatsOut(**r) for r in rows]


# ── Parameter sweep ────────────────────────────────────────────────────────────

@router.post("/sweep")
async def parameter_sweep(
    body: SweepRequest,
    background_tasks: BackgroundTasks,
) -> dict:
    from app.agents.registry import get_agent
    from app.api.ws import manager

    agent = await asyncio.to_thread(get_agent, body.agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    model_cls = _MODEL_CLS.get(agent.model_type, XGBModel)

    combos = [
        (h, t, tw)
        for h  in body.horizons
        for t  in body.thresholds
        for tw in body.train_windows
    ]
    total = len(combos)

    def _run_one(horizon: int, threshold: float, train_window: int) -> SweepCell:
        try:
            result = run_walkforward(
                model_cls=model_cls,
                model_kwargs=agent.hyperparams,
                features=agent.features,
                symbol=settings.gold_symbol,
                timeframe=agent.timeframe,
                target_horizon=horizon,
                target_threshold=threshold,
                train_window=train_window,
                position_size_pct=agent.position_size_pct,
            )
            m = result.get("metrics", {})
            return SweepCell(
                horizon=horizon, threshold=threshold, train_window=train_window,
                sharpe=m.get("sharpe"),
                win_rate=m.get("win_rate"),
                total_return=m.get("total_return"),
                n_trades=m.get("n_trades"),
            )
        except Exception as exc:
            return SweepCell(
                horizon=horizon, threshold=threshold, train_window=train_window,
                error=str(exc),
            )

    async def _run_sweep() -> None:
        loop = asyncio.get_running_loop()
        completed = 0
        lock = asyncio.Lock()

        with ThreadPoolExecutor(max_workers=4) as pool:
            async def _run_and_report(combo: tuple) -> SweepCell:
                nonlocal completed
                h, t, tw = combo
                cell = await loop.run_in_executor(pool, _run_one, h, t, tw)
                async with lock:
                    completed += 1
                    pct = round(completed / total * 100)
                await manager.broadcast(
                    "sweep_progress",
                    {"pct": pct, "completed": completed, "total": total},
                )
                return cell

            cells = list(await asyncio.gather(*[_run_and_report(c) for c in combos]))

        await manager.broadcast(
            "sweep_complete",
            {"cells": [c.model_dump() for c in cells]},
        )

    background_tasks.add_task(_run_sweep)
    return {"status": "started", "total": total}


# ── Correlation miner ──────────────────────────────────────────────────────────

@router.post("/mine_correlations")
async def mine_correlations(
    timeframe: str = Query("1d"),
    horizon:   int = Query(5),
    threshold: float = Query(0.003),
) -> dict:
    result = await asyncio.to_thread(
        edge_validator.mine_correlations, timeframe, horizon, threshold
    )
    return result


# ── Model versions ─────────────────────────────────────────────────────────────

@router.get("/model_versions/{agent_id}")
async def list_versions(agent_id: str) -> list[ModelVersionOut]:
    versions = await asyncio.to_thread(model_registry.list_model_versions, agent_id)
    return [ModelVersionOut(**v) for v in versions]


@router.post("/rollback/{agent_id}/{version}")
async def rollback(agent_id: str, version: int) -> dict:
    ok = await asyncio.to_thread(model_registry.rollback_to_version, agent_id, version)
    if not ok:
        raise HTTPException(status_code=404, detail="Version not found")
    return {"status": "rolled_back", "version": version}


# ── Notifications ──────────────────────────────────────────────────────────────

@router.get("/notifications")
async def get_notifications(unread_only: bool = Query(False)) -> list[NotificationOut]:
    def _fetch():
        conn = get_connection()
        try:
            if unread_only:
                rows = conn.execute(
                    "SELECT * FROM notifications WHERE is_read=0 ORDER BY created_at DESC LIMIT 50"
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50"
                ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    rows = await asyncio.to_thread(_fetch)
    return [NotificationOut(**{**r, "is_read": bool(r["is_read"])}) for r in rows]


@router.post("/notifications/{notif_id}/read")
async def mark_read(notif_id: str) -> dict:
    def _update():
        conn = get_connection()
        try:
            conn.execute("UPDATE notifications SET is_read=1 WHERE id=?", (notif_id,))
            conn.commit()
        finally:
            conn.close()

    await asyncio.to_thread(_update)
    return {"status": "ok"}
