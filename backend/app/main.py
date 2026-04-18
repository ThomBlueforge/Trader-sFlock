"""
StartGold API — main application entry point.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import agents, data, intelligence, portfolio, simulate, training, ws
from app.core.database import init_db
from app.core.scheduler import start_scheduler, stop_scheduler
from app.data.store import refresh_all

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # ── Startup ──────────────────────────────────────────────────
    logger.info("StartGold API starting up…")
    init_db()
    logger.info("Database initialised.")

    logger.info("Fetching initial market data (this may take a moment)…")
    try:
        await asyncio.to_thread(refresh_all)
        logger.info("Initial data load complete.")

        # Run intelligence scans on startup
        from app.intelligence import pattern_engine, regime_detector
        await asyncio.to_thread(regime_detector.detect_and_store)
        await asyncio.to_thread(pattern_engine.scan_all)
        # Backfill confirmation for ALL existing patterns (one-time catch-up)
        await asyncio.to_thread(pattern_engine.backfill_all)
        logger.info("Intelligence scans + pattern backfill complete.")

        # Generate fresh signals for all active agents immediately
        from app.agents.runner import compute_live_signals
        sigs = await asyncio.to_thread(compute_live_signals)
        logger.info("Startup signals generated: %d", len(sigs))
    except Exception as exc:
        logger.warning("Startup data load incomplete: %s", exc)

    await start_scheduler()
    try:
        yield
    except (asyncio.CancelledError, KeyboardInterrupt):
        pass  # Normal on Ctrl+C — do not propagate
    finally:
        # ── Shutdown ────────────────────────────────────────────────
        await stop_scheduler()
        logger.info("StartGold API shut down cleanly.")


app = FastAPI(
    title="StartGold API",
    description="Multi-timeframe gold signal platform",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ──────────────────────────────────────────────────────────────
app.include_router(data.router,         prefix="/api/data",         tags=["data"])
app.include_router(agents.router,       prefix="/api/agents",       tags=["agents"])
app.include_router(training.router,     prefix="/api/training",     tags=["training"])
app.include_router(portfolio.router,    prefix="/api/portfolio",    tags=["portfolio"])
app.include_router(intelligence.router, prefix="/api/intelligence", tags=["intelligence"])
app.include_router(simulate.router,     prefix="/api/simulate",     tags=["simulate"])
app.include_router(ws.router,           prefix="/api",              tags=["websocket"])
