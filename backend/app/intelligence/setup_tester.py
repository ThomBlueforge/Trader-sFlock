"""
Setup Tester.

Given a trained agent, regenerates BULL/SHORT signals for the full historical
dataset and simulates trade-by-trade exits using Stop Loss, Take Profit, or
a maximum hold duration — whichever is hit first.

Unlike the walk-forward backtest (always in the market), this engine enters
one trade per signal and exits cleanly before the next entry, giving a realistic
picture of a fixed-setup intraday/swing approach.
"""
from __future__ import annotations

import logging
from datetime import datetime

import numpy as np
import pandas as pd

from app.core.config import settings
from app.data.features import compute_features
from app.data.store import load_macro, load_ohlcv
from app.ml import model_registry
from app.models.base import BaseSignalModel

logger = logging.getLogger(__name__)

COMMISSION = 0.0005   # 0.05% per side


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_date(s: str | None, is_end: bool = False) -> pd.Timestamp | None:
    if not s:
        return None
    try:
        ts = pd.Timestamp(s)
        if is_end:
            ts = ts.replace(hour=23, minute=59, second=59)
        return ts
    except Exception:
        return None


def _compute_metrics(trades: list[dict], equity: list[float], bars_per_year: int) -> dict:
    if not trades or len(equity) < 2:
        return {}

    closed = [t for t in trades if t.get("pnl") is not None]
    if not closed:
        return {}

    pnls   = np.array([t["pnl"] for t in closed])
    wins   = pnls[pnls > 0]
    losses = pnls[pnls <= 0]

    total_ret    = float(equity[-1] / equity[0] - 1) if equity[0] > 0 else 0.0
    n_years      = max(len(equity) / bars_per_year, 1e-9)
    ann_ret      = float((1 + total_ret) ** (1 / n_years) - 1)
    bar_rets     = np.diff(equity) / (np.array(equity[:-1]) + 1e-9)
    sharpe       = float(bar_rets.mean() / (bar_rets.std() + 1e-9) * np.sqrt(bars_per_year))
    peak         = np.maximum.accumulate(equity)
    max_dd       = float(((np.array(equity) - peak) / (peak + 1e-9)).min())
    profit_factor= float(wins.sum() / (abs(losses.sum()) + 1e-9))
    win_rate     = float(len(wins) / max(len(closed), 1))
    avg_pnl      = float(pnls.mean())

    sl_hits  = sum(1 for t in closed if t.get("exit_reason") == "sl")
    tp_hits  = sum(1 for t in closed if t.get("exit_reason") == "tp")
    time_ex  = sum(1 for t in closed if t.get("exit_reason") == "time")

    return {
        "total_return":      round(total_ret, 4),
        "annualized_return": round(ann_ret, 4),
        "sharpe":            round(sharpe, 4),
        "max_drawdown":      round(max_dd, 4),
        "win_rate":          round(win_rate, 4),
        "profit_factor":     round(min(profit_factor, 99.0), 4),
        "avg_trade_pnl":     round(avg_pnl, 4),
        "n_trades":          len(closed),
        "sl_hit_rate":       round(sl_hits / max(len(closed), 1), 4),
        "tp_hit_rate":       round(tp_hits / max(len(closed), 1), 4),
        "time_exit_rate":    round(time_ex / max(len(closed), 1), 4),
    }


# ── Main engine ───────────────────────────────────────────────────────────────

def run_setup_test(
    agent_id:          str,
    hold_bars:         int   = 6,
    stop_loss_pct:     float = 0.005,
    take_profit_pct:   float = 0.010,
    start_date:        str | None = None,
    end_date:          str | None = None,
    initial_capital:   float = 10_000.0,
    position_size_pct: float = 0.1,
    min_confidence:    float = 0.0,
) -> dict:
    """
    Simulate trade-by-trade exits on an agent's historical signals.

    Parameters
    ----------
    hold_bars       : Max bars to hold a trade (e.g. 6 bars on 5m TF = 30 min)
    stop_loss_pct   : Stop loss as fraction of entry price (0.005 = 0.5%)
    take_profit_pct : Take profit as fraction of entry price (0.010 = 1.0%)
    start_date      : ISO date string for backtest window start
    end_date        : ISO date string for backtest window end
    min_confidence  : Only enter trades where model confidence >= this value
    """
    from app.agents.registry import get_agent

    agent = get_agent(agent_id)
    if agent is None:
        raise ValueError(f"Agent {agent_id!r} not found")
    if not agent.features:
        raise ValueError("Agent has no features selected")

    blob = model_registry.load_active_model(agent_id)
    if blob is None:
        raise ValueError("No trained model found — train the agent first")

    model_bytes, feature_names = blob
    model: BaseSignalModel = BaseSignalModel.from_bytes(model_bytes)

    bpy = settings.bars_per_year.get(agent.timeframe, 252)

    # ── Load and filter OHLCV ─────────────────────────────────────────────────
    df_raw = load_ohlcv(settings.gold_symbol, agent.timeframe)
    if df_raw.empty:
        raise ValueError(f"No data for {settings.gold_symbol}/{agent.timeframe}")

    start_ts = _parse_date(start_date)
    end_ts   = _parse_date(end_date, is_end=True)
    if start_ts:
        df_raw = df_raw[df_raw.index >= start_ts]
    if end_ts:
        df_raw = df_raw[df_raw.index <= end_ts]
    if len(df_raw) < agent.train_window + hold_bars + 10:
        raise ValueError("Insufficient data for the selected date range")

    # ── Compute features + signals ────────────────────────────────────────────
    macro = load_macro("1d") if agent.timeframe == "1d" else None
    df    = compute_features(df_raw.copy(), feature_names, macro)
    df    = df.dropna(subset=feature_names)

    X         = df[feature_names]
    proba     = model.predict_proba_bull(X)
    signals   = ["BULL" if p >= 0.5 else "SHORT" for p in proba]

    # Skip training period — only test on out-of-sample portion
    train_cutoff = agent.train_window
    test_df      = df.iloc[train_cutoff:].copy()
    test_signals = signals[train_cutoff:]
    test_proba   = proba[train_cutoff:]

    # ── SL/TP/time simulation ─────────────────────────────────────────────────
    capital   = initial_capital
    equity    = [capital]
    trades:   list[dict] = []
    n         = len(test_df)
    i         = 0

    while i < n - hold_bars - 1:
        signal     = test_signals[i]
        confidence = float(test_proba[i])

        # Confidence filter
        if confidence < min_confidence:
            i += 1
            continue

        entry_row   = test_df.iloc[i]
        entry_price = float(entry_row["close"])
        entry_ts    = int(entry_row.name.timestamp())
        direction   = 1.0 if signal == "BULL" else -1.0

        # Determine SL / TP price levels
        if direction == 1:   # BULL: SL below, TP above
            sl_price = entry_price * (1 - stop_loss_pct)
            tp_price = entry_price * (1 + take_profit_pct)
        else:                # SHORT: SL above, TP below
            sl_price = entry_price * (1 + stop_loss_pct)
            tp_price = entry_price * (1 - take_profit_pct)

        # Walk forward up to hold_bars looking for SL/TP/time exit
        exit_price  = entry_price
        exit_reason = "time"
        exit_bar    = min(i + hold_bars, n - 1)

        for j in range(i + 1, exit_bar + 1):
            row  = test_df.iloc[j]
            high = float(row["high"])
            low  = float(row["low"])

            if direction == 1:   # BULL
                if low <= sl_price:
                    exit_price  = sl_price
                    exit_reason = "sl"
                    exit_bar    = j
                    break
                if high >= tp_price:
                    exit_price  = tp_price
                    exit_reason = "tp"
                    exit_bar    = j
                    break
            else:                # SHORT
                if high >= sl_price:
                    exit_price  = sl_price
                    exit_reason = "sl"
                    exit_bar    = j
                    break
                if low <= tp_price:
                    exit_price  = tp_price
                    exit_reason = "tp"
                    exit_bar    = j
                    break
        else:
            # Time exit: use close of the last bar
            exit_price = float(test_df.iloc[exit_bar]["close"])

        # PnL calculation
        position_size = capital * position_size_pct
        raw_ret       = direction * (exit_price - entry_price) / (entry_price + 1e-9)
        pnl           = raw_ret * position_size
        pnl          -= position_size * COMMISSION * 2   # both sides
        capital      += pnl

        exit_ts = int(test_df.iloc[exit_bar].name.timestamp())
        trades.append({
            "signal":       signal,
            "confidence":   round(confidence, 4),
            "entry_price":  round(entry_price, 4),
            "exit_price":   round(exit_price, 4),
            "exit_reason":  exit_reason,
            "pnl":          round(pnl, 4),
            "return_pct":   round(raw_ret, 5),
            "bars_held":    exit_bar - i,
            "opened_at":    entry_ts,
            "closed_at":    exit_ts,
        })
        equity.append(round(capital, 2))

        # Next entry after this trade closes
        i = exit_bar + 1

    metrics = _compute_metrics(trades, equity, bpy)
    equity_curve = [
        {"ts": int(test_df.iloc[min(k, n - 1)].name.timestamp() * 1000), "equity": e}
        for k, e in enumerate(equity)
    ]

    return {
        "config": {
            "hold_bars":         hold_bars,
            "stop_loss_pct":     stop_loss_pct,
            "take_profit_pct":   take_profit_pct,
            "start_date":        start_date,
            "end_date":          end_date,
            "min_confidence":    min_confidence,
            "timeframe":         agent.timeframe,
            "position_size_pct": position_size_pct,
        },
        "metrics":     metrics,
        "equity_curve": equity_curve,
        "trades":       trades[-200:],   # return last 200 trades max
    }


def run_setup_sweep(
    agent_id:        str,
    hold_bars_list:  list[int],
    sl_pcts:         list[float],
    tp_pcts:         list[float],
    start_date:      str | None = None,
    end_date:        str | None = None,
) -> list[dict]:
    """Test a grid of (hold_bars, sl_pct, tp_pct) combinations."""
    results = []
    for hb in hold_bars_list:
        for sl in sl_pcts:
            for tp in tp_pcts:
                if tp <= sl:
                    continue  # skip if TP <= SL (no edge possible)
                try:
                    r = run_setup_test(agent_id, hb, sl, tp, start_date, end_date)
                    m = r.get("metrics", {})
                    results.append({
                        "hold_bars":       hb,
                        "stop_loss_pct":   sl,
                        "take_profit_pct": tp,
                        "sharpe":          m.get("sharpe"),
                        "win_rate":        m.get("win_rate"),
                        "profit_factor":   m.get("profit_factor"),
                        "total_return":    m.get("total_return"),
                        "n_trades":        m.get("n_trades"),
                        "tp_hit_rate":     m.get("tp_hit_rate"),
                        "sl_hit_rate":     m.get("sl_hit_rate"),
                    })
                except Exception as exc:
                    logger.warning("Setup sweep cell failed hb=%s sl=%s tp=%s: %s", hb, sl, tp, exc)
                    results.append({
                        "hold_bars": hb, "stop_loss_pct": sl, "take_profit_pct": tp,
                        "error": str(exc),
                    })

    results.sort(key=lambda x: x.get("sharpe") or -99, reverse=True)
    return results
