"""
APScheduler that runs refresh_all() every 15 minutes.
Uses AsyncIOScheduler so jobs run within the FastAPI event loop.
"""
from __future__ import annotations

import asyncio
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.data.store import refresh_all
from app.intelligence import pattern_engine, regime_detector
from app.intelligence.ic_monitor import run_ic_monitor

logger = logging.getLogger(__name__)

_scheduler = AsyncIOScheduler()


async def _async_refresh_all() -> None:
    logger.info("Scheduled data refresh starting…")
    try:
        await asyncio.to_thread(refresh_all)
        await asyncio.to_thread(pattern_engine.scan_all)
        await asyncio.to_thread(regime_detector.detect_and_store)
        # Regenerate live signals with fresh data
        from app.agents.runner import compute_live_signals
        sigs = await asyncio.to_thread(compute_live_signals)
        logger.info("Scheduled refresh + intelligence + %d signals complete.", len(sigs))
    except Exception as exc:
        logger.error("Scheduled data refresh failed: %s", exc)


async def _nightly_ic_monitor() -> None:
    from app.api.ws import manager
    logger.info("Nightly IC monitor starting…")
    try:
        await run_ic_monitor(broadcast_fn=manager.broadcast)
        logger.info("Nightly IC monitor complete.")
    except Exception as exc:
        logger.error("Nightly IC monitor failed: %s", exc)


async def start_scheduler() -> None:
    _scheduler.add_job(
        _async_refresh_all,
        trigger="interval",
        minutes=15,
        id="refresh_all",
        replace_existing=True,
        max_instances=1,
    )
    _scheduler.add_job(
        _nightly_ic_monitor,
        trigger="cron",
        hour=2,
        minute=0,
        id="ic_monitor",
        replace_existing=True,
        max_instances=1,
    )
    _scheduler.start()
    logger.info("Scheduler started — data refresh every 15 min, IC monitor nightly at 02:00.")


async def stop_scheduler() -> None:
    _scheduler.shutdown(wait=False)
    logger.info("Scheduler stopped.")
