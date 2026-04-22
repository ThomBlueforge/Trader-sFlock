"""
Data endpoints:
  GET  /api/data/candles/{symbol}/{timeframe}?limit=500
  GET  /api/data/features?timeframe=1d
  GET  /api/data/symbols
  POST /api/data/refresh
  POST /api/data/historical/start
  GET  /api/data/historical/status
  POST /api/data/historical/cancel
  GET  /api/data/historical/summary
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.core.config import settings
from app.data import historical
from app.data.features import FEATURE_REGISTRY, features_for_timeframe
from app.data.store import bar_count, load_ohlcv, refresh_all
from app.schemas import Candle, CandlesResponse, FeatureMeta

router = APIRouter()


class HistoricalStartRequest(BaseModel):
    start_date:  Optional[str]       = None   # YYYY-MM-DD, default 1 year ago
    end_date:    Optional[str]       = None   # YYYY-MM-DD, default today
    symbol:      str                 = "GC=F"
    concurrency: int                 = 12
    timeframes:  Optional[list[str]] = None   # default: all 7 timeframes


@router.get("/candles/{symbol}/{timeframe}")
async def get_candles(
    symbol: str,
    timeframe: str,
    limit: int = Query(500, ge=1, le=5000),
) -> CandlesResponse:
    df = await asyncio.to_thread(load_ohlcv, symbol, timeframe, limit)
    candles = [
        Candle(
            ts=int(idx.timestamp() * 1000),
            open=float(row["open"]),
            high=float(row["high"]),
            low=float(row["low"]),
            close=float(row["close"]),
            volume=float(row["volume"]),
        )
        for idx, row in df.iterrows()
    ]
    return CandlesResponse(symbol=symbol, timeframe=timeframe, candles=candles)


@router.get("/features")
async def get_features(
    timeframe: str = Query("1d"),
) -> list[FeatureMeta]:
    features = features_for_timeframe(timeframe)
    return [FeatureMeta(**f) for f in features]


@router.get("/symbols")
async def get_symbols() -> dict:
    result: dict = {}
    for sym in settings.all_symbols:
        counts: dict = {}
        for tf in settings.timeframes:
            counts[tf] = await asyncio.to_thread(bar_count, sym, tf)
        result[sym] = counts
    return result


@router.post("/refresh")
async def refresh_data() -> dict:
    await asyncio.to_thread(refresh_all)
    return {"status": "ok"}


# ── Historical import ─────────────────────────────────────────────────────────

@router.post("/historical/start")
async def historical_start(body: HistoricalStartRequest) -> dict:
    """Launch a full tick-download + resample job in the background."""
    now  = datetime.now(tz=timezone.utc)
    end  = body.end_date   or now.strftime("%Y-%m-%d")
    start = body.start_date or (now - timedelta(days=365)).strftime("%Y-%m-%d")
    try:
        loop = asyncio.get_running_loop()
        historical.start_job(
            start_date  = start,
            end_date    = end,
            symbol      = body.symbol,
            concurrency = body.concurrency,
            timeframes  = body.timeframes,
            loop        = loop,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return historical.get_state()


@router.get("/historical/status")
async def historical_status() -> dict:
    """Return the current job state (status, progress, logs)."""
    return historical.get_state()


@router.post("/historical/cancel")
async def historical_cancel() -> dict:
    """Signal the running job to stop after its current batch."""
    historical.cancel_job()
    return historical.get_state()


@router.get("/historical/summary")
async def historical_summary(symbol: str = Query("GC=F")) -> dict:
    """Bar counts, date ranges, and coverage % per timeframe. No job state."""
    return await asyncio.to_thread(historical.get_summary, symbol)
