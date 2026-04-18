"""
Feature engineering pipeline.
All features are computed from OHLCV DataFrames.
FEATURE_REGISTRY is the single source of truth consumed by the API and the agent builder UI.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import ta


# ── Registry ──────────────────────────────────────────────────────────────────

FEATURE_REGISTRY: dict[str, dict] = {
    # Price
    "return_1": {"name": "Return 1-bar", "category": "price", "timeframes": ["5m", "15m", "1h", "1d"],
        "description": "% change from the previous bar's close to the current bar's close. E.g. +0.5% means gold rose 0.5% in one bar. Captures immediate momentum: the model learns whether a strong single-bar move tends to continue or reverse."},
    "return_3": {"name": "Return 3-bar", "category": "price", "timeframes": ["5m", "15m", "1h", "1d"],
        "description": "% change over the last 3 bars (3 days on 1d, 45 min on 15m). Smooths single-bar noise while still being short-term. Positive = gold has been rising recently; negative = falling. Helps detect whether a single-bar move is part of a multi-bar trend."},
    "return_5": {"name": "Return 5-bar", "category": "price", "timeframes": ["5m", "15m", "1h", "1d"],
        "description": "% change over 5 bars (one week on 1d, ~1.25h on 15m). A key medium-term momentum signal. Sustained moves over 5 bars indicate a real trend rather than noise. One of the most predictive features for gold momentum."},
    "return_10": {"name": "Return 10-bar", "category": "price", "timeframes": ["5m", "15m", "1h", "1d"],
        "description": "% change over 10 bars (two weeks on 1d). Helps the model understand whether today's move is part of a larger directional sequence or a short-term retracement inside a longer counter-move."},
    "return_20": {"name": "Return 20-bar", "category": "price", "timeframes": ["5m", "15m", "1h", "1d"],
        "description": "% change over 20 bars (~one month on 1d). Long-context momentum: is gold in a month-long uptrend or downtrend? The model uses this as a macro background context against which shorter signals are interpreted."},
    "log_return_1": {"name": "Log Return 1-bar", "category": "price", "timeframes": ["5m", "15m", "1h", "1d"],
        "description": "Natural log of (current close / previous close). Nearly identical to return_1 for small moves but mathematically better: log returns are additive across bars, which makes them more stable as a feature for ML models."},
    "hl_range_pct": {"name": "H-L Range %", "category": "price", "timeframes": ["5m", "15m", "1h", "1d"],
        "description": "(High - Low) / Close. How wide was this bar? A 1% range means gold swung ~1% within the bar. Wide bars = high uncertainty or a news-driven spike. Narrow bars = consolidation and low conviction. Wide ranges after a trend can signal exhaustion."},
    # Oscillators
    "rsi_7": {"name": "RSI 7", "category": "oscillator", "timeframes": ["5m", "15m", "1h", "1d"],
        "description": "Relative Strength Index over 7 bars (0-100 scale). Above 70 = gold has risen sharply and may be overbought (potential pullback). Below 30 = sold off hard and may be oversold (potential bounce). The 7-period version reacts quickly to new moves \u2014 useful for short-term timing but generates more false signals than RSI 14."},
    "rsi_14": {"name": "RSI 14", "category": "oscillator", "timeframes": ["5m", "15m", "1h", "1d"],
        "description": "The standard RSI. Reads 0-100: above 70 = overbought, below 30 = oversold, ~50 = neutral. 14 bars = two weeks on 1d. More reliable than RSI 7 with fewer false signals. One of the most widely used indicators for gold by professional traders."},
    "rsi_21": {"name": "RSI 21", "category": "oscillator", "timeframes": ["5m", "15m", "1h", "1d"],
        "description": "Smoothed RSI over 21 bars (~one month on 1d). Slower to react but gives cleaner signals for major turning points. Best for detecting structural overbought/oversold conditions rather than short-term wiggles."},
    "macd_line": {"name": "MACD Line", "category": "trend", "timeframes": ["5m", "15m", "1h", "1d"],
        "description": "12-period EMA minus 26-period EMA. Positive = short-term average is above long-term = upward momentum. Negative = downward momentum. When it crosses zero from below, a new uptrend may be starting. The larger the value, the stronger the current trend."},
    "macd_signal": {"name": "MACD Signal", "category": "trend", "timeframes": ["5m", "15m", "1h", "1d"],
        "description": "A 9-bar EMA of the MACD Line, used as a trigger. When the MACD Line crosses above this signal line = bullish signal. When it crosses below = bearish signal. The signal line smooths out MACD noise so crossovers are more reliable."},
    "macd_hist": {"name": "MACD Histogram", "category": "trend", "timeframes": ["5m", "15m", "1h", "1d"],
        "description": "MACD Line minus Signal Line. Positive and rising = momentum accelerating upward. Positive but shrinking = upward momentum fading (potential reversal warning). Crossing from negative to positive is a classic buy signal. Very useful for early detection of trend changes."},
    "adx_14": {"name": "ADX 14", "category": "trend", "timeframes": ["5m", "15m", "1h", "1d"],
        "description": "Average Directional Index \u2014 measures trend STRENGTH, not direction. 0-25 = choppy, no trend (mean-reversion strategies work better). 25-50 = strong trend in place. Above 50 = very strong trend. A high ADX confirms other signals; a low ADX means breakouts are likely to fail."},
    "ema_ratio": {"name": "EMA 9/21 ratio", "category": "trend", "timeframes": ["5m", "15m", "1h", "1d"],
        "description": "EMA(9) divided by EMA(21). Above 1.0 = the fast 9-bar average is above the slow 21-bar average = short-term uptrend. Below 1.0 = short-term downtrend. The further from 1.0, the stronger the trend. Crossing 1.0 signals a potential trend change."},
    # Volatility
    "bb_pct": {"name": "BB %B", "category": "volatility", "timeframes": ["5m", "15m", "1h", "1d"],
        "description": "Where is price within its Bollinger Bands? 0.0 = price is at the lower band (often oversold in ranging markets). 1.0 = at the upper band (overbought). Above 1.0 or below 0.0 = price has broken outside the bands, signalling exceptional momentum or an extreme move."},
    "bb_width": {"name": "BB Width", "category": "volatility", "timeframes": ["5m", "15m", "1h", "1d"],
        "description": "Width of the Bollinger Bands divided by the middle band. Low = tight range, market is consolidating. High = high-volatility phase. Traders watch for the \u2018Bollinger Squeeze\u2019 \u2014 very narrow bands followed by an explosive breakout in either direction."},
    "bb_squeeze": {"name": "BB Squeeze z-score", "category": "volatility", "timeframes": ["5m", "15m", "1h", "1d"],
        "description": "How unusually tight are the Bollinger Bands right now compared to recent history? A very negative value = bands are historically narrow = energy coiling before a big move. The model uses this to predict upcoming volatility expansion, even though direction is unknown."},
    "atr_pct": {"name": "ATR %", "category": "volatility", "timeframes": ["5m", "15m", "1h", "1d"],
        "description": "Average True Range as a % of price (ATR includes gaps between sessions). On daily gold, an ATR% of 1.0% means gold moves ~$20 per day on average. High ATR% = volatile market. Low ATR% = quiet market. Useful context for the model to understand current market conditions."},
    "atr_ratio": {"name": "ATR Ratio", "category": "volatility", "timeframes": ["5m", "15m", "1h", "1d"],
        "description": "Current ATR divided by its own 20-bar average. Above 1 = volatility is higher than usual (potentially news-driven spike or breakdown). Below 1 = calmer than usual. An ATR ratio above 1.5 often indicates an extreme event \u2014 the model learns whether these tend to continue or snap back."},
    "vol_zscore": {"name": "Volatility z-score", "category": "volatility", "timeframes": ["5m", "15m", "1h", "1d"],
        "description": "Z-score of price return volatility over 20 bars. +2.0 means volatility is 2 standard deviations above its recent mean \u2014 an unusual spike. Near 0 = normal conditions. Extreme positive values often precede mean reversion as the volatility shock fades."},
    # Volume
    "volume_ratio": {"name": "Volume Ratio", "category": "volume", "timeframes": ["5m", "15m", "1h", "1d"],
        "description": "Today\u2019s volume divided by its 20-bar average. 2.0 = twice the usual volume = a high-conviction move. 0.5 = low volume = weak signal. High volume on an UP bar = confirmed buying. High volume on a DOWN bar = confirmed selling. Low volume on any move = likely to reverse."},
    "volume_spike": {"name": "Volume Spike", "category": "volume", "timeframes": ["5m", "15m", "1h", "1d"],
        "description": "Binary flag: 1 = volume is more than 2x the 20-bar average, 0 = normal. Marks exceptional volume events often tied to news (Fed decisions, geopolitical events, CPI prints). The model learns whether these high-volume surges tend to continue or reverse for gold specifically."},
    "obv_slope": {"name": "OBV Slope", "category": "volume", "timeframes": ["5m", "15m", "1h", "1d"],
        "description": "On-Balance-Volume adds volume on up bars and subtracts on down bars, creating a cumulative total. The 5-bar slope tells you if money is flowing INTO gold (rising OBV = accumulation) or OUT of gold (falling OBV = distribution). OBV rising while price is flat = bullish divergence."},
    # Intraday
    "vwap_pct": {"name": "VWAP deviation %", "category": "intraday", "timeframes": ["5m", "15m", "30m", "1h"],
        "description": "How far is the current price from the Volume-Weighted Average Price of the session? VWAP is the average price weighted by volume \u2014 institutions often buy below it and sell above it. Positive = price is above VWAP (currently \u2018expensive\u2019 vs today\u2019s average). Negative = below VWAP (\u2018discount\u2019). Mean reversion to VWAP is one of the most common intraday patterns."},
    "session_open": {"name": "Session Open", "category": "intraday", "timeframes": ["5m", "15m", "30m", "1h"],
        "description": "1 = we are in the first 2 hours of the trading session, 0 = we are not. The opening range is often more volatile as overnight orders are filled. Breakouts in the first 2 hours have a statistically higher chance of setting the direction for the rest of the day."},
    "session_close": {"name": "Session Close", "category": "intraday", "timeframes": ["5m", "15m", "30m", "1h"],
        "description": "1 = we are in the last 2 hours of the trading session, 0 = we are not. End-of-session moves are often driven by institutions squaring positions before the close. The model learns whether late-session moves tend to continue into the next open or reverse."},
    # Macro (daily)
    "dxy_return_5": {"name": "DXY 5-day return", "category": "macro", "timeframes": ["1d"],
        "description": "How much has the US Dollar Index (DXY) moved over the last 5 days? Gold and the USD have a strong inverse relationship \u2014 when the dollar strengthens, gold usually falls, and vice versa. If DXY rose +1.5%, expect headwinds for gold. One of the most important macro drivers for gold prices."},
    "vix_level": {"name": "VIX level", "category": "macro", "timeframes": ["1d"],
        "description": "The VIX \u2018Fear Index\u2019 \u2014 the market\u2019s expectation of 30-day stock market volatility. VIX below 15 = calm markets. Above 20 = elevated fear. Above 30 = crisis/panic. Gold is a safe-haven: when investors are scared (high VIX), money flows into gold. Low VIX = risk appetite = gold may underperform growth assets."},
    "vix_return_5": {"name": "VIX 5-day return", "category": "macro", "timeframes": ["1d"],
        "description": "How much has the VIX changed over the last 5 days? Rising VIX (positive value) = fear increasing = gold tailwind. Falling VIX = calming markets = gold may lag. Rate-of-change captures the SHIFT in sentiment faster than the raw level, often giving an earlier signal."},
    "tnx_return_5": {"name": "10Y Yield 5-day change", "category": "macro", "timeframes": ["1d"],
        "description": "How much has the 10-Year US Treasury yield changed over 5 days? Rising real yields are BEARISH for gold (bonds become more attractive vs non-yielding gold). Falling yields are BULLISH for gold. This is the single most important fundamental driver for gold: the opportunity cost of holding gold vs bonds."},
    "spx_return_5": {"name": "S&P 500 5-day return", "category": "macro", "timeframes": ["1d"],
        "description": "How much has the S&P 500 moved over 5 days? Gold\u2019s relationship with equities is complex: it can move OPPOSITE to stocks during crises (safe-haven demand) but can also rise WITH stocks during inflationary regimes. The model learns which regime is currently active."},
    "gold_dxy_corr_21": {"name": "Gold/DXY 21-day correlation", "category": "macro", "timeframes": ["1d"],
        "description": "Rolling 21-day correlation between gold daily returns and USD Index returns. Normally around -0.5 to -0.8 (they move opposite). When this weakens toward 0 or turns positive, an unusual driver is at work (e.g. geopolitical risk, central bank buying). The correlation itself is a signal about the current macro regime."},
    "gold_vix_corr_21": {"name": "Gold/VIX 21-day correlation", "category": "macro", "timeframes": ["1d"],
        "description": "Rolling 21-day correlation between gold daily returns and VIX daily returns. Normally positive \u2014 gold and fear move together. When this breaks down, the safe-haven narrative is currently inactive. Regime changes in this correlation often precede large directional gold moves."},
    # Calendar
    "day_of_week": {"name": "Day of week", "category": "calendar", "timeframes": ["5m", "15m", "30m", "1h", "2h", "4h", "1d"],
        "description": "0=Monday, 1=Tuesday, 2=Wednesday, 3=Thursday, 4=Friday. Gold has documented day-of-week patterns: Mondays often see positioning after weekend geopolitical news; Fridays see position squaring before the weekend. The model learns which days have statistically different behavior."},
    "month": {"name": "Month", "category": "calendar", "timeframes": ["1h", "2h", "4h", "1d"],
        "description": "Current month (1=Jan to 12=Dec). Gold has seasonal tendencies: often weak in March\u2013May, stronger in September\u2013October (Indian/Asian jewelry demand cycle ahead of the wedding and festival season). The model uses this to filter signals by historical seasonal context."},
    "quarter_end": {"name": "Quarter-end flag", "category": "calendar", "timeframes": ["1d"],
        "description": "1 = within 5 trading days of the end of March, June, September, or December. 0 = otherwise. Institutional fund managers rebalance portfolios at quarter-end, creating unusual order flows. Gold often sees outsized moves during this window as large funds buy/sell to hit target allocations."},
    # Candlestick patterns
    "candle_doji": {"name": "Doji", "category": "pattern", "timeframes": ["5m", "15m", "30m", "1h", "2h", "4h", "1d"],
        "description": "The bar\u2019s body (|Close - Open|) is less than 10% of its total range. Buyers and sellers finished the bar at essentially the same price \u2014 complete indecision. A doji at the end of a strong trend often signals exhaustion and a potential reversal. Especially powerful at key price levels (support/resistance)."},
    "candle_hammer": {"name": "Hammer", "category": "pattern", "timeframes": ["5m", "15m", "30m", "1h", "2h", "4h", "1d"],
        "description": "Lower shadow (wick below body) is at least 2x the body size, with minimal upper shadow. Sellers pushed gold down hard during the bar, but buyers stepped in and drove price back up to close near the open. This is a bullish reversal pattern \u2014 especially reliable after a sustained downtrend."},
    "candle_engulf_bull": {"name": "Bullish Engulf", "category": "pattern", "timeframes": ["5m", "15m", "30m", "1h", "2h", "4h", "1d"],
        "description": "Current bar is bullish AND its body completely covers the prior bar\u2019s bearish body (opens at or below prior close, closes at or above prior open). The bulls completely reversed the prior bar\u2019s move in one shot \u2014 a strong reversal signal. Most reliable at support levels after a downtrend."},
    "candle_engulf_bear": {"name": "Bearish Engulf", "category": "pattern", "timeframes": ["5m", "15m", "30m", "1h", "2h", "4h", "1d"],
        "description": "Current bar is bearish AND its body completely covers the prior bar\u2019s bullish body. The bears completely reversed the prior bar\u2019s move. A strong reversal signal, most reliable at resistance levels after a gold rally. Often appears before sharp pullbacks."},
    "candle_morning_star": {"name": "Morning Star", "category": "pattern", "timeframes": ["1h", "2h", "4h", "1d"],
        "description": "3-bar bullish reversal: (1) large bearish bar, (2) small-body \u2018star\u2019 bar where buyers and sellers balanced, (3) large bullish bar that reverses bar 1. Signals a downtrend is losing steam and buyers are taking control. One of the most reliable reversal patterns in candlestick analysis."},
    "candle_evening_star": {"name": "Evening Star", "category": "pattern", "timeframes": ["1h", "2h", "4h", "1d"],
        "description": "3-bar bearish reversal: (1) large bullish bar, (2) small-body \u2018star\u2019 bar, (3) large bearish bar that reverses bar 1. Signals an uptrend is exhausted and sellers are taking over. The opposite of morning star \u2014 look for this at tops after a sustained gold rally."},
    # Microstructure
    "gap_pct": {"name": "Gap %", "category": "price", "timeframes": ["5m", "15m", "30m", "1h", "2h", "4h", "1d"],
        "description": "(Open - Previous Close) / Previous Close. Did gold open higher or lower than where it closed last bar? Positive = gap up (bullish overnight sentiment). Negative = gap down. Gaps on futures like GC=F often occur between sessions. Large gaps frequently get \u2018filled\u2019 (price returns to the gap level) \u2014 the model learns which gaps hold and which get filled."},
    "close_position": {"name": "Close Position", "category": "price", "timeframes": ["5m", "15m", "30m", "1h", "2h", "4h", "1d"],
        "description": "(Close - Low) / (High - Low). Where did this bar close within its range? 1.0 = closed at the high (bulls in full control). 0.0 = closed at the low (bears dominant). 0.5 = neutral. A strong close position (>0.7 on an up bar) confirms the bulls\u2019 conviction and suggests continuation."},
    "body_ratio": {"name": "Body Ratio", "category": "price", "timeframes": ["5m", "15m", "30m", "1h", "2h", "4h", "1d"],
        "description": "|Close - Open| / (High - Low). What fraction of the bar\u2019s range was actual directional price movement vs indecisive wicks? High value (0.8) = strong, clean directional candle with few wicks. Low value (0.1) = lots of indecision, price went up and down but barely moved net. High body ratio in the signal direction = conviction."},
    "consec_bullish": {"name": "Consecutive Bullish Bars", "category": "price", "timeframes": ["5m", "15m", "30m", "1h", "2h", "4h", "1d"],
        "description": "How many bars in a row have closed HIGHER than their open (bullish bars). E.g., 3 = three consecutive up-closes = sustained buying pressure with no counter-bar. High counts (5+) signal strong momentum but can also indicate overbought conditions heading into a pullback."},
    "consec_bearish": {"name": "Consecutive Bearish Bars", "category": "price", "timeframes": ["5m", "15m", "30m", "1h", "2h", "4h", "1d"],
        "description": "How many bars in a row have closed LOWER than their open (bearish bars). E.g., 4 = four consecutive down-closes = sustained selling pressure. High counts signal strong downward momentum but can also indicate oversold conditions where a bounce is due."},
    # Gold-specific macro (daily)
    "gold_silver_ratio_z": {"name": "Gold/Silver Ratio z-score", "category": "macro", "timeframes": ["1d"],
        "description": "Z-score of (gold price / silver price) over 20 bars. The gold/silver ratio measures how many ounces of silver equal one ounce of gold. Historically ~70-80. Very high z-score = gold is expensive vs silver (potential relative underperformance ahead). Very low = gold is cheap vs silver."},
    "real_yield_proxy": {"name": "Real Yield Proxy", "category": "macro", "timeframes": ["1d"],
        "description": "10-Year Treasury Yield minus VIX. A composite proxy for the real return on safe assets adjusted for fear. When yields are HIGH and fear is LOW (high value), gold is unattractive \u2014 you can earn a real return in bonds. When yields fall OR fear rises (low/negative value), gold becomes the preferred store of value."},
    "oil_gold_ratio_chg": {"name": "Oil/Gold Ratio 5-day change", "category": "macro", "timeframes": ["1d"],
        "description": "5-day % change in the ratio of crude oil to gold (WTI / GC=F). When oil rises faster than gold, it signals inflationary pressure building \u2014 gold often follows. When gold outperforms oil, safe-haven demand dominates over inflation concerns. Divergences often precede major gold moves."},
    # Regime (daily only)
    "regime_volatility": {"name": "Volatility Regime", "category": "regime", "timeframes": ["1d"],
        "description": "Current market volatility regime: 0 = LOW (calm, ATR below normal \u2014 range-bound, mean-reversion works), 1 = MEDIUM (normal conditions), 2 = HIGH (volatile, ATR above normal \u2014 trend-following works better). Computed from the 21-day ATR vs its 1-year average. The model can behave very differently in each regime."},
    "regime_trend": {"name": "Trend Regime", "category": "regime", "timeframes": ["1d"],
        "description": "Is gold currently in a trending market? 1 = YES (ADX > 25, strong directional movement). 0 = NO (ADX < 25, choppy/ranging). Trend-following features (MACD, EMA ratio) produce better signals when this is 1. Mean-reversion features (RSI extremes, BB %B) produce better signals when this is 0."},
    "momentum_quintile": {"name": "Momentum Quintile", "category": "regime", "timeframes": ["1d"],
        "description": "Where does gold\u2019s 3-month return rank within the past year? 1 = bottom 20% (worst recent performer). 5 = top 20% (best recent performer). High quintile = strong 3-month momentum = historically tends to continue. Low quintile = poor recent performer = potential reversal candidate. This captures the \u2018momentum factor\u2019 used by quantitative funds."},
}


def features_for_timeframe(timeframe: str) -> list[dict]:
    return [{"key": k, **v} for k, v in FEATURE_REGISTRY.items() if timeframe in v["timeframes"]]


# ── Computation ───────────────────────────────────────────────────────────────

def compute_features(
    df: pd.DataFrame,
    requested: list[str],
    macro: dict[str, pd.DataFrame] | None = None,
) -> pd.DataFrame:
    """
    Add requested feature columns to df.
    df must have columns: open, high, low, close, volume, datetime index.
    macro: symbol → DataFrame with 'close' column (for daily macro features).
    NaN rows are NOT dropped here — caller decides.
    """
    req = set(requested)
    c  = df["close"]
    h  = df["high"]
    lo = df["low"]
    v  = df["volume"]

    # ── Price ────────────────────────────────────────────────────────────────
    if "return_1"    in req: df["return_1"]    = c.pct_change(1)
    if "return_3"    in req: df["return_3"]    = c.pct_change(3)
    if "return_5"    in req: df["return_5"]    = c.pct_change(5)
    if "return_10"   in req: df["return_10"]   = c.pct_change(10)
    if "return_20"   in req: df["return_20"]   = c.pct_change(20)
    if "log_return_1" in req: df["log_return_1"] = np.log(c / c.shift(1))
    if "hl_range_pct" in req: df["hl_range_pct"] = (h - lo) / c

    # ── Oscillators / trend ──────────────────────────────────────────────────
    if "rsi_7"  in req: df["rsi_7"]  = ta.momentum.RSIIndicator(c, window=7).rsi()
    if "rsi_14" in req: df["rsi_14"] = ta.momentum.RSIIndicator(c, window=14).rsi()
    if "rsi_21" in req: df["rsi_21"] = ta.momentum.RSIIndicator(c, window=21).rsi()

    if req & {"macd_line", "macd_signal", "macd_hist"}:
        _macd = ta.trend.MACD(c, window_slow=26, window_fast=12, window_sign=9)
        if "macd_line"   in req: df["macd_line"]   = _macd.macd()
        if "macd_signal" in req: df["macd_signal"] = _macd.macd_signal()
        if "macd_hist"   in req: df["macd_hist"]   = _macd.macd_diff()

    if "adx_14" in req:
        df["adx_14"] = ta.trend.ADXIndicator(h, lo, c, window=14).adx()

    if "ema_ratio" in req:
        df["ema_ratio"] = (
            ta.trend.EMAIndicator(c, window=9).ema_indicator()
            / ta.trend.EMAIndicator(c, window=21).ema_indicator()
        )

    # ── Volatility ───────────────────────────────────────────────────────────
    if req & {"bb_pct", "bb_width", "bb_squeeze"}:
        _bb = ta.volatility.BollingerBands(c, window=20, window_dev=2)
        if "bb_pct"   in req: df["bb_pct"]   = _bb.bollinger_pband()
        if "bb_width" in req: df["bb_width"] = _bb.bollinger_wband()
        if "bb_squeeze" in req:
            bw = _bb.bollinger_wband()
            df["bb_squeeze"] = (bw - bw.rolling(50).mean()) / (bw.rolling(50).std() + 1e-9)

    if req & {"atr_pct", "atr_ratio"}:
        atr = ta.volatility.AverageTrueRange(h, lo, c, window=14).average_true_range()
        if "atr_pct"   in req: df["atr_pct"]   = atr / c
        if "atr_ratio" in req: df["atr_ratio"] = atr / (atr.rolling(20).mean() + 1e-9)

    if "vol_zscore" in req:
        ret = c.pct_change()
        df["vol_zscore"] = (ret - ret.rolling(20).mean()) / (ret.rolling(20).std() + 1e-9)

    # ── Volume ───────────────────────────────────────────────────────────────
    if req & {"volume_ratio", "volume_spike"}:
        ratio = v / (v.rolling(20).mean() + 1e-9)
        if "volume_ratio" in req: df["volume_ratio"] = ratio
        if "volume_spike" in req: df["volume_spike"] = (ratio > 2.0).astype(float)

    if "obv_slope" in req:
        obv = ta.volume.OnBalanceVolumeIndicator(c, v).on_balance_volume()
        df["obv_slope"] = obv.diff(5) / (obv.abs().rolling(5).mean() + 1e-9)

    # ── Intraday ─────────────────────────────────────────────────────────────
    if "vwap_pct" in req:
        typical    = (h + lo + c) / 3
        cum_tp_vol = (typical * v).groupby(df.index.date).cumsum()
        cum_vol    = v.groupby(df.index.date).cumsum()
        vwap       = cum_tp_vol / (cum_vol + 1e-9)
        df["vwap_pct"] = (c - vwap) / (vwap + 1e-9)

    if "session_open"  in req: df["session_open"]  = (df.index.hour < 2).astype(float)
    if "session_close" in req: df["session_close"] = (df.index.hour >= 22).astype(float)

    # ── Candlestick patterns ──────────────────────────────────────────────────────
    if req & {"candle_doji", "candle_hammer", "candle_engulf_bull", "candle_engulf_bear",
              "candle_morning_star", "candle_evening_star"}:
        o     = df["open"]
        body  = abs(c - o)
        rng   = h - lo + 1e-9
        lo_shadow = pd.concat([o, c], axis=1).min(axis=1) - lo
        hi_shadow = h - pd.concat([o, c], axis=1).max(axis=1)

        if "candle_doji"   in req:
            df["candle_doji"] = (body / rng < 0.1).astype(float)

        if "candle_hammer" in req:
            df["candle_hammer"] = (
                (lo_shadow >= 2 * (body + 1e-9)) & (hi_shadow <= body + 1e-9)
            ).astype(float)

        if req & {"candle_engulf_bull", "candle_engulf_bear"}:
            p_open  = o.shift(1)
            p_close = c.shift(1)
            b_prev  = p_close - p_open
            b_curr  = c - o

            if "candle_engulf_bull" in req:
                df["candle_engulf_bull"] = (
                    (b_prev < 0) & (b_curr > 0) &
                    (o <= p_close) & (c >= p_open)
                ).astype(float)

            if "candle_engulf_bear" in req:
                df["candle_engulf_bear"] = (
                    (b_prev > 0) & (b_curr < 0) &
                    (o >= p_close) & (c <= p_open)
                ).astype(float)

        if req & {"candle_morning_star", "candle_evening_star"}:
            b1 = c.shift(2) - o.shift(2)
            b2 = abs(c.shift(1) - o.shift(1))
            b3 = c - o
            r1 = (h.shift(2) - lo.shift(2) + 1e-9)
            r2 = (h.shift(1) - lo.shift(1) + 1e-9)

            if "candle_morning_star" in req:
                df["candle_morning_star"] = (
                    (b1 < -r1 * 0.5) & (b2 < r2 * 0.3) & (b3 > rng * 0.5)
                ).astype(float)

            if "candle_evening_star" in req:
                df["candle_evening_star"] = (
                    (b1 > r1 * 0.5) & (b2 < r2 * 0.3) & ((o - c) > rng * 0.5)
                ).astype(float)

    # ── Microstructure ─────────────────────────────────────────────────────────
    if "gap_pct"        in req: df["gap_pct"]        = (df["open"] - c.shift(1)) / (c.shift(1) + 1e-9)
    if "close_position" in req: df["close_position"] = (c - lo) / (h - lo + 1e-9)
    if "body_ratio"     in req: df["body_ratio"]     = abs(c - df["open"]) / (h - lo + 1e-9)

    if req & {"consec_bullish", "consec_bearish"}:
        bull    = (c > c.shift(1)).astype(int)
        groups  = bull.ne(bull.shift()).cumsum()
        consec  = bull.groupby(groups).cumcount() + 1
        if "consec_bullish" in req: df["consec_bullish"] = (consec * bull).astype(float)
        if "consec_bearish" in req: df["consec_bearish"] = (consec * (1 - bull)).astype(float)

    # ── Regime features (daily only, computed inline) ──────────────────────
    if "regime_volatility" in req:
        atr_r = ta.volatility.AverageTrueRange(h, lo, c, window=14).average_true_range()
        atr_norm = atr_r / (atr_r.rolling(252, min_periods=63).mean() + 1e-9)
        regime = pd.Series(1.0, index=df.index)
        regime[atr_norm < 0.75] = 0.0
        regime[atr_norm > 1.25] = 2.0
        df["regime_volatility"] = regime

    if "regime_trend" in req:
        adx = ta.trend.ADXIndicator(h, lo, c, window=14).adx()
        df["regime_trend"] = (adx > 25).astype(float)

    if "momentum_quintile" in req:
        ret_63 = c.pct_change(63)
        df["momentum_quintile"] = ret_63.rolling(252, min_periods=63).apply(
            lambda x: float((x < x[-1]).sum() / max(len(x) - 1, 1) * 5 + 1),
            raw=True,
        ).clip(1, 5)

    # ── Macro ──────────────────────────────────────────────────────────────────
    if macro:
        _dxy = macro.get("DX-Y.NYB")
        _vix = macro.get("^VIX")
        _tnx = macro.get("^TNX")
        _spx = macro.get("^GSPC")

        if _dxy is not None:
            dxy_c = _dxy["close"].reindex(df.index, method="ffill")
            if "dxy_return_5"    in req: df["dxy_return_5"]    = dxy_c.pct_change(5)
            if "gold_dxy_corr_21" in req:
                df["gold_dxy_corr_21"] = c.pct_change().rolling(21).corr(dxy_c.pct_change())

        if _vix is not None:
            vix_c = _vix["close"].reindex(df.index, method="ffill")
            if "vix_level"        in req: df["vix_level"]        = vix_c
            if "vix_return_5"     in req: df["vix_return_5"]     = vix_c.pct_change(5)
            if "gold_vix_corr_21" in req:
                df["gold_vix_corr_21"] = c.pct_change().rolling(21).corr(vix_c.pct_change())

        if _tnx is not None:
            tnx_c = _tnx["close"].reindex(df.index, method="ffill")
            if "tnx_return_5" in req: df["tnx_return_5"] = tnx_c.diff(5)

        if _spx is not None:
            spx_c = _spx["close"].reindex(df.index, method="ffill")
            if "spx_return_5" in req: df["spx_return_5"] = spx_c.pct_change(5)

        # ── Gold-specific macro -----------------------------------------------
        _si = macro.get("SI=F")
        _cl = macro.get("CL=F")

        if _si is not None and "gold_silver_ratio_z" in req:
            si_c  = _si["close"].reindex(df.index, method="ffill")
            ratio = c / (si_c + 1e-9)
            df["gold_silver_ratio_z"] = (
                (ratio - ratio.rolling(20).mean()) / (ratio.rolling(20).std() + 1e-9)
            )

        if _tnx is not None and _vix is not None and "real_yield_proxy" in req:
            tnx_c = _tnx["close"].reindex(df.index, method="ffill")
            vix_c = _vix["close"].reindex(df.index, method="ffill")
            df["real_yield_proxy"] = tnx_c - vix_c

        if _cl is not None and "oil_gold_ratio_chg" in req:
            cl_c  = _cl["close"].reindex(df.index, method="ffill")
            ratio = cl_c / (c + 1e-9)
            df["oil_gold_ratio_chg"] = ratio.pct_change(5)

    # ── Calendar
    if "day_of_week" in req: df["day_of_week"] = df.index.dayofweek.astype(float)
    if "month"       in req: df["month"]       = df.index.month.astype(float)
    if "quarter_end" in req:
        df["quarter_end"] = df.index.to_series().apply(
            lambda d: 1.0 if (d + pd.offsets.BDay(5)).quarter != d.quarter else 0.0
        )

    return df
