"""
yfinance data fetcher.
No API key required — uses public Yahoo Finance endpoints.
Macro symbols are only fetched for the daily timeframe.
"""
from __future__ import annotations

import logging
import pandas as pd
import yfinance as yf

from app.core.config import settings

logger = logging.getLogger(__name__)


def fetch_ohlcv(symbol: str, timeframe: str, period: str | None = None) -> pd.DataFrame:
    """
    Fetch OHLCV data via yfinance.
    Returns DataFrame(open, high, low, close, volume) with UTC-naive datetime index.
    Returns empty DataFrame on failure.
    """
    yf_period = period or settings.yf_periods.get(timeframe, "60d")

    try:
        raw = yf.download(
            symbol,
            period=yf_period,
            interval=timeframe,
            auto_adjust=True,
            progress=False,
            threads=False,
        )
    except Exception as exc:
        logger.warning("yfinance download failed for %s/%s: %s", symbol, timeframe, exc)
        return pd.DataFrame()

    if raw.empty:
        logger.warning("Empty response for %s/%s", symbol, timeframe)
        return pd.DataFrame()

    # Flatten MultiIndex columns present in yfinance >= 0.2.x
    if isinstance(raw.columns, pd.MultiIndex):
        raw.columns = raw.columns.get_level_values(0)

    df = raw[["Open", "High", "Low", "Close", "Volume"]].copy()
    df.columns = ["open", "high", "low", "close", "volume"]
    df.index.name = "datetime"

    if df.index.tz is not None:
        df.index = df.index.tz_convert("UTC").tz_localize(None)

    df = df.dropna(subset=["close"])
    df = df[df["close"] > 0]
    return df


def fetch_all_symbols(timeframe: str) -> dict[str, pd.DataFrame]:
    """Fetch gold + macro symbols for the given timeframe."""
    results: dict[str, pd.DataFrame] = {}

    symbols = [settings.gold_symbol]
    if timeframe == "1d":
        symbols += settings.macro_symbols

    for symbol in symbols:
        df = fetch_ohlcv(symbol, timeframe)
        if not df.empty:
            results[symbol] = df
            logger.info("Fetched %d bars  %s/%s", len(df), symbol, timeframe)

    return results
