"""
Monte Carlo simulation.
Takes closed trade PnLs from a completed backtest and produces:
  - Percentile equity curves (p5/p25/p50/p75/p95)
  - Probability of ruin (equity < 50% of initial)
  - p-value of observed Sharpe vs null (zero-IC shuffled) distribution
"""
from __future__ import annotations

import numpy as np


def run_simulation(
    trades:          list[dict],
    initial_capital: float = 10_000.0,
    n_runs:          int   = 500,
    block_size:      int   = 0,
    ruin_threshold:  float = 0.5,
    seed:            int   = 42,
) -> dict:
    """
    trades: list of dicts with a 'pnl' key (closed trades from backtest).
    block_size: 0 = i.i.d. shuffle; >0 = block bootstrap with given block length.
    Returns dict matching MonteCarloResult schema.
    """
    pnls = np.array([t["pnl"] for t in trades if t.get("pnl") is not None], dtype=float)
    if len(pnls) < 5:
        return {
            "p5": [], "p25": [], "p50": [], "p75": [], "p95": [],
            "actual": [], "prob_ruin": 0.0, "sharpe_pvalue": 1.0,
        }

    rng = np.random.default_rng(seed)
    n   = len(pnls)

    # Actual equity curve (cumulative)
    actual_eq = [initial_capital] + list(
        initial_capital + np.cumsum(pnls)
    )

    def _sample(pnl_arr: np.ndarray) -> np.ndarray:
        if block_size <= 0:
            return rng.choice(pnl_arr, size=len(pnl_arr), replace=True)
        # Block bootstrap
        n_blocks = int(np.ceil(len(pnl_arr) / block_size))
        starts   = rng.integers(0, len(pnl_arr) - block_size + 1, size=n_blocks)
        blocks   = [pnl_arr[s:s + block_size] for s in starts]
        return np.concatenate(blocks)[:len(pnl_arr)]

    all_equity: list[np.ndarray] = []
    all_sharpes: list[float] = []

    for _ in range(n_runs):
        sample     = _sample(pnls)
        cum_eq     = initial_capital + np.concatenate([[0], np.cumsum(sample)])
        all_equity.append(cum_eq)
        sharpe = float(sample.mean() / (sample.std() + 1e-9))
        all_sharpes.append(sharpe)

    # Stack all runs
    eq_mat = np.stack(all_equity, axis=0)  # shape (n_runs, n+1)

    def _pct_curve(pct: float) -> list[dict]:
        vals = np.percentile(eq_mat, pct, axis=0)
        return [{"equity": round(float(v), 2)} for v in vals]

    # Probability of ruin
    min_equity = eq_mat.min(axis=1)
    prob_ruin  = float((min_equity < initial_capital * ruin_threshold).mean())

    # Sharpe p-value: fraction of null sharpes >= observed
    obs_sharpe = float(pnls.mean() / (pnls.std() + 1e-9))
    sharpe_pval = float((np.array(all_sharpes) >= obs_sharpe).mean())

    actual_curve = [{"equity": round(v, 2)} for v in actual_eq]

    return {
        "p5":           _pct_curve(5),
        "p25":          _pct_curve(25),
        "p50":          _pct_curve(50),
        "p75":          _pct_curve(75),
        "p95":          _pct_curve(95),
        "actual":       actual_curve,
        "prob_ruin":    round(prob_ruin, 4),
        "sharpe_pvalue": round(sharpe_pval, 4),
    }
