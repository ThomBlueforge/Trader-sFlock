from __future__ import annotations

import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier

from app.models.base import BaseSignalModel


class LGBMModel(BaseSignalModel):

    def __init__(
        self,
        n_estimators:     int   = 300,
        max_depth:        int   = 5,
        learning_rate:    float = 0.05,
        num_leaves:       int   = 31,
        subsample:        float = 0.8,
        colsample_bytree: float = 0.8,
        **kwargs,          # accept any additional valid LightGBM parameter
    ):
        self._clf = LGBMClassifier(
            n_estimators=n_estimators,
            max_depth=max_depth,
            learning_rate=learning_rate,
            num_leaves=num_leaves,
            subsample=subsample,
            colsample_bytree=colsample_bytree,
            random_state=42,
            verbosity=-1,
            **kwargs,
        )

    def fit(self, X: pd.DataFrame, y: pd.Series) -> None:
        self._clf.fit(X.values, y.values)

    def predict_proba_bull(self, X: pd.DataFrame) -> np.ndarray:
        return self._clf.predict_proba(X.values)[:, 1]

    @property
    def feature_importances(self) -> dict[str, float]:
        if not hasattr(self._clf, "feature_importances_"):
            return {}
        names = self._clf.feature_name_ if hasattr(self._clf, "feature_name_") else []
        return dict(zip(names, self._clf.feature_importances_.tolist()))
