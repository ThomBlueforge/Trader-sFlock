"""
Data endpoints:
  GET /api/data/candles/{symbol}/{timeframe}?limit=500
  GET /api/data/features?timeframe=1d
  GET /api/data/symbols
  POST /api/data/refresh
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Query

from app.core.config import settings
from app.data.features import FEATURE_REGISTRY, features_for_timeframe
from app.data.store import bar_count, load_ohlcv, refresh_all
from app.schemas import Candle, CandlesResponse, FeatureMeta

router = APIRouter()


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
