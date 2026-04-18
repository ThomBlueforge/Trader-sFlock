import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "StartGold"
    database_path: str = os.getenv("DATABASE_PATH", "./db/startgold.db")

    gold_symbol: str = "GC=F"
    macro_symbols: list[str] = ["DX-Y.NYB", "^TNX", "^VIX", "^GSPC", "CL=F", "SI=F", "EURUSD=X"]
    all_symbols: list[str] = ["GC=F", "DX-Y.NYB", "^TNX", "^VIX", "^GSPC", "CL=F", "SI=F", "EURUSD=X"]

    timeframes: list[str] = ["5m", "15m", "30m", "1h", "2h", "4h", "1d"]

    # yfinance max period per timeframe
    yf_periods: dict[str, str] = {
        "5m":  "60d",
        "15m": "60d",
        "30m": "60d",
        "1h":  "730d",
        "2h":  "730d",
        "4h":  "730d",
        "1d":  "max",
    }

    # Intraday-only features (excluded from 2h/4h/1d)
    intraday_timeframes: list[str] = ["5m", "15m", "30m", "1h"]

    # Bars per year for annualisation (based on ~6.5h trading session)
    bars_per_year: dict[str, int] = {
        "5m":  252 * 78,
        "15m": 252 * 26,
        "30m": 252 * 13,
        "1h":  252 * 6,
        "2h":  252 * 3,
        "4h":  252 * 2,
        "1d":  252,
    }

    data_refresh_interval_minutes: int = 15

    model_config = {"env_file": ".env"}


settings = Settings()
