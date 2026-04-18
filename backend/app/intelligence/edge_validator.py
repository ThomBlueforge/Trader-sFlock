"""
Edge validator / correlation miner.
Computes per-feature IC (Spearman), mutual information, and collinearity
for a given timeframe. Used by the GET /api/intelligence/mine_correlations endpoint.
"""
from __future__ import annotations

import logging

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.feature_selection import mutual_info_classif

from app.core.config import settings
from app.data.features import FEATURE_REGISTRY, compute_features, features_for_timeframe
from app.data.store import load_macro, load_ohlcv
from app.paper_trading.backtest import _build_target

logger = logging.getLogger(__name__)


def mine_correlations(timeframe: str, horizon: int = 5, threshold: float = 0.003) -> dict:
    """
    Compute feature-level IC, mutual information, and collinearity
    for all features available on the given timeframe.
    Returns a dict suitable for CorrelationMinerResult schema.
    """
    df_raw = load_ohlcv(settings.gold_symbol, timeframe)
    if df_raw.empty or len(df_raw) < 200:
        return {"timeframe": timeframe, "feature_ics": [], "collinearity": {}, "top_pairs": []}

    macro = load_macro("1d") if timeframe == "1d" else None

    all_features = [f["key"] for f in features_for_timeframe(timeframe)]
    df = compute_features(df_raw.copy(), all_features, macro)
    df["_target"] = _build_target(df["close"], horizon, threshold)
    df = df.dropna(subset=all_features + ["_target"])

    if len(df) < 100:
        return {"timeframe": timeframe, "feature_ics": [], "collinearity": {}, "top_pairs": []}

    fwd_ret = df["close"].pct_change(horizon).shift(-horizon)
    X = df[all_features]
    y = df["_target"]
    y_binary = y.astype(int)

    feature_ics = []
    for feat in all_features:
        col = X[feat].dropna()
        common = col.index.intersection(fwd_ret.dropna().index)
        if len(common) < 50:
            continue
        try:
            ic, pval = spearmanr(col.loc[common], fwd_ret.loc[common])
            feature_ics.append({
                "key":  feat,
                "name": FEATURE_REGISTRY.get(feat, {}).get("name", feat),
                "ic":   round(float(ic), 4),
                "pvalue": round(float(pval), 4),
                "mutual_info": 0.0,  # filled below
            })
        except Exception:
            pass

    # Mutual information (batch computation is much faster)
    try:
        X_clean = X.fillna(0)
        mi_scores = mutual_info_classif(X_clean, y_binary, random_state=42)
        mi_map = dict(zip(all_features, mi_scores.tolist()))
        for fi in feature_ics:
            fi["mutual_info"] = round(float(mi_map.get(fi["key"], 0.0)), 4)
    except Exception:
        pass

    feature_ics.sort(key=lambda x: abs(x["ic"]), reverse=True)

    # Collinearity (Spearman corr matrix for top 20 features by |IC|)
    top_keys = [fi["key"] for fi in feature_ics[:20]]
    collinearity: dict[str, dict[str, float]] = {}
    if len(top_keys) >= 2:
        corr_df = X[top_keys].corr(method="spearman").round(3)
        collinearity = corr_df.to_dict()

    # Top IC pairs (combined IC = sqrt(|ic_a|*|ic_b|) to surface synergy)
    top_pairs = []
    ics = {fi["key"]: abs(fi["ic"]) for fi in feature_ics}
    for i, k1 in enumerate(top_keys[:15]):
        for k2 in top_keys[i + 1:15]:
            combined = float(np.sqrt(ics.get(k1, 0) * ics.get(k2, 0)))
            corr_val = float(collinearity.get(k1, {}).get(k2, 0.0))
            top_pairs.append({
                "feature_a": k1, "feature_b": k2,
                "combined_ic": round(combined, 4),
                "correlation": corr_val,
            })
    top_pairs.sort(key=lambda x: x["combined_ic"], reverse=True)

    return {
        "timeframe":    timeframe,
        "feature_ics":  feature_ics,
        "collinearity": collinearity,
        "top_pairs":    top_pairs[:10],
    }
