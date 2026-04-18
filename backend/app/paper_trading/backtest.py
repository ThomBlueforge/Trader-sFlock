"""
Walk-forward backtest engine.
Signals are strictly BULL or SHORT — always in the market, no NEUTRAL.
Fixed position size per trade. No data leakage.
"""
from __future__ import annotations

import logging

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score

from app.data.features import compute_features
from app.data.store import load_macro, load_ohlcv

logger = logging.getLogger(__name__)

COMMISSION = 0.0005  # 0.05% per side


def _build_target(close: pd.Series, horizon: int, threshold: float) -> pd.Series:
    future_return = close.pct_change(horizon).shift(-horizon)
    return (future_return > threshold).astype(float).where(future_return.notna())


def _metrics(equity: list[float], trades: list[dict], n_bars: int,
             all_signals: list[str] | None = None,
             bars_per_year_override: int | None = None) -> dict:
    eq = np.array(equity, dtype=float)
    if len(eq) < 2:
        return {}

    total_ret     = float(eq[-1] / eq[0] - 1)
    bars_per_year = bars_per_year_override or (252 * 26 if n_bars > 5000 else 252)
    n_years       = max(len(eq) / bars_per_year, 1e-9)
    ann_ret       = float((1 + total_ret) ** (1 / n_years) - 1)

    bar_rets  = np.diff(eq) / (eq[:-1] + 1e-9)
    sharpe    = float(bar_rets.mean() / (bar_rets.std() + 1e-9) * np.sqrt(bars_per_year))

    # Sortino
    down_rets  = bar_rets[bar_rets < 0]
    down_std   = float(np.sqrt(np.mean(down_rets ** 2))) if len(down_rets) > 0 else 1e-9
    sortino    = float(bar_rets.mean() / (down_std + 1e-9) * np.sqrt(bars_per_year))

    peak   = np.maximum.accumulate(eq)
    max_dd = float(((eq - peak) / (peak + 1e-9)).min())

    # Calmar
    calmar = float(ann_ret / (abs(max_dd) + 1e-9))

    closed   = [t for t in trades if t["pnl"] is not None]
    win_rate = sum(1 for t in closed if t["pnl"] > 0) / max(len(closed), 1)

    # Profit factor
    wins   = [t["pnl"] for t in closed if (t["pnl"] or 0) > 0]
    losses = [t["pnl"] for t in closed if (t["pnl"] or 0) <= 0]
    pf     = float(sum(wins) / (abs(sum(losses)) + 1e-9))

    # Avg trade duration
    avg_dur = float(n_bars / max(len(closed), 1))

    # Signal stability
    sig_stab = None
    if all_signals and len(all_signals) > 1:
        flips    = sum(1 for a, b in zip(all_signals, all_signals[1:]) if a != b)
        sig_stab = round(1.0 - flips / len(all_signals), 4)

    out = {
        "total_return":           round(total_ret, 4),
        "annualized_return":      round(ann_ret, 4),
        "sharpe":                 round(sharpe, 4),
        "sortino_ratio":          round(sortino, 4),
        "calmar_ratio":           round(min(calmar, 99.0), 4),
        "profit_factor":          round(min(pf, 99.0), 4),
        "max_drawdown":           round(max_dd, 4),
        "win_rate":               round(win_rate, 4),
        "n_trades":               len(closed),
        "n_bars_tested":          len(eq),
        "avg_trade_duration_bars": round(avg_dur, 2),
    }
    if sig_stab is not None:
        out["signal_stability"] = sig_stab
    return out


def run_walkforward(
    model_cls,
    model_kwargs: dict,
    features: list[str],
    symbol: str,
    timeframe: str,
    target_horizon: int,
    target_threshold: float,
    train_window: int,
    position_size_pct: float,
    initial_capital: float = 10_000.0,
    progress_cb=None,
    regime_filter: str | None = None,
    start_ts_ms: int | None = None,
    end_ts_ms:   int | None = None,
) -> dict:
    """
    Walk-forward backtest. Re-trains every test_window bars on an expanding window.
    Returns dict with keys: equity_curve, trades, metrics.
    """
    test_window = max(50, train_window // 10)

    from app.core.config import settings  # avoid circular import at module load
    bpy = settings.bars_per_year.get(timeframe, 252)

    gold_df = load_ohlcv(symbol, timeframe, start_ts_ms=start_ts_ms)
    if gold_df.empty:
        raise ValueError(f"No data for {symbol}/{timeframe}")

    if end_ts_ms is not None:
        cutoff = pd.Timestamp(end_ts_ms, unit="ms")
        gold_df = gold_df[gold_df.index <= cutoff]

    macro = load_macro("1d") if timeframe == "1d" else None
    df    = compute_features(gold_df.copy(), features, macro)
    df    = df.dropna(subset=features)
    df["_target"] = _build_target(df["close"], target_horizon, target_threshold)
    df    = df.dropna(subset=["_target"])

    # Regime filter: restrict dataset to bars of a specific volatility regime
    if regime_filter and "regime_volatility" in df.columns:
        regime_map = {"LOW": 0.0, "MED": 1.0, "HIGH": 2.0}
        target_regime = regime_map.get(regime_filter.upper())
        if target_regime is not None:
            df = df[df["regime_volatility"] == target_regime]
            if df.empty:
                raise ValueError(f"No bars found for regime_filter={regime_filter!r}")

    n = len(df)
    if n < train_window + test_window:
        raise ValueError(f"Insufficient data: {n} bars (need {train_window + test_window})")

    all_idx:     list = []
    all_signals: list[str]  = []
    all_proba:   list[float] = []

    total_steps = max((n - train_window) // test_window, 1)
    step = 0

    for start in range(train_window, n, test_window):
        train = df.iloc[:start]
        test  = df.iloc[start: start + test_window]
        if test.empty or train["_target"].nunique() < 2:
            continue

        model = model_cls(**model_kwargs)
        model.fit(train[features], train["_target"])

        proba   = model.predict_proba_bull(test[features])
        signals = ["BULL" if p >= 0.5 else "SHORT" for p in proba]

        all_idx.extend(test.index.tolist())
        all_signals.extend(signals)
        all_proba.extend(proba.tolist())

        step += 1
        if progress_cb:
            progress_cb(int(step / total_steps * 85))

    if not all_signals:
        raise ValueError("No predictions generated — check training window size")

    # ── Simulate paper trades ─────────────────────────────────────────────────
    close_map = df["close"].to_dict()
    capital   = initial_capital
    position  = 0
    entry_px  = 0.0
    equity:   list[float] = []
    trades:   list[dict]  = []
    open_trade: dict | None = None

    for idx, signal in zip(all_idx, all_signals):
        price = close_map.get(idx)
        if price is None:
            continue
        direction = 1 if signal == "BULL" else -1

        if position != direction:
            if position != 0 and open_trade:
                pnl = position * (price - entry_px) / (entry_px + 1e-9) * capital * position_size_pct
                pnl -= abs(capital * position_size_pct) * COMMISSION
                capital += pnl
                open_trade.update(exit_price=price, pnl=round(pnl, 4),
                                  closed_at=int(pd.Timestamp(idx).timestamp()))
                trades.append(open_trade)

            capital -= capital * position_size_pct * COMMISSION
            position  = direction
            entry_px  = price
            open_trade = dict(signal=signal, entry_price=price, exit_price=None,
                              pnl=None, opened_at=int(pd.Timestamp(idx).timestamp()),
                              closed_at=None)

        open_pnl = position * (price - entry_px) / (entry_px + 1e-9) * capital * position_size_pct
        equity.append(capital + open_pnl)

    if open_trade and all_idx:
        last_px = close_map.get(all_idx[-1], entry_px)
        pnl     = position * (last_px - entry_px) / (entry_px + 1e-9) * capital * position_size_pct
        open_trade.update(exit_price=last_px, pnl=round(pnl, 4))
        trades.append(open_trade)

    metrics = _metrics(equity, trades, n, all_signals=all_signals, bars_per_year_override=bpy)

    actual = df.loc[all_idx, "_target"].values
    pred   = np.array([1 if s == "BULL" else 0 for s in all_signals])
    if len(actual) == len(pred) and len(actual) > 0:
        metrics["accuracy"]  = round(float(accuracy_score(actual, pred)), 4)
        metrics["precision"] = round(float(precision_score(actual, pred, zero_division=0)), 4)
        metrics["recall"]    = round(float(recall_score(actual, pred, zero_division=0)), 4)
        metrics["f1"]        = round(float(f1_score(actual, pred, zero_division=0)), 4)

    # ── Information Coefficient (Spearman IC) ──────────────────────────────
    try:
        fwd_ret = df["close"].pct_change(target_horizon).shift(-target_horizon)
        fwd_ret_aligned = fwd_ret.reindex(all_idx)
        valid_mask = fwd_ret_aligned.notna()
        if valid_mask.sum() > 10:
            proba_valid = np.array(all_proba)[valid_mask.values]
            ret_valid   = fwd_ret_aligned[valid_mask].values
            ic, ic_pval = spearmanr(proba_valid, ret_valid)
            metrics["ic_score"]  = round(float(ic),   4)
            metrics["ic_pvalue"] = round(float(ic_pval), 4)
    except Exception:
        pass

    # ── Bootstrap Sharpe 95% CI (1000 resamplings of trade PnLs) ────────────
    closed_pnls = [t["pnl"] for t in trades if t.get("pnl") is not None]
    if len(closed_pnls) >= 10:
        rng_boot = np.random.default_rng(42)
        boot_sharpes: list[float] = []
        arr = np.array(closed_pnls)
        for _ in range(1000):
            sample = rng_boot.choice(arr, size=len(arr), replace=True)
            boot_sharpes.append(
                float(sample.mean() / (sample.std() + 1e-9) * np.sqrt(bpy))
            )
        metrics["sharpe_ci_low"]  = round(float(np.percentile(boot_sharpes, 2.5)),  4)
        metrics["sharpe_ci_high"] = round(float(np.percentile(boot_sharpes, 97.5)), 4)

    equity_curve = [
        {"ts": int(pd.Timestamp(i).timestamp() * 1000), "equity": round(e, 2)}
        for i, e in zip(all_idx[: len(equity)], equity)
    ]

    if progress_cb:
        progress_cb(100)

    return {"equity_curve": equity_curve, "trades": trades, "metrics": metrics}
