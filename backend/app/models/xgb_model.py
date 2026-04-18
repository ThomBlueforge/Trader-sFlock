from __future__ import annotations

import numpy as np
import pandas as pd
from xgboost import XGBClassifier

from app.models.base import BaseSignalModel


class XGBModel(BaseSignalModel):

    def __init__(
        self,
        n_estimators:     int   = 200,
        max_depth:        int   = 4,
        learning_rate:    float = 0.05,
        subsample:        float = 0.8,
        colsample_bytree: float = 0.8,
        **kwargs,          # accept any additional valid XGBoost parameter
    ):
        self._clf = XGBClassifier(
            n_estimators=n_estimators,
            max_depth=max_depth,
            learning_rate=learning_rate,
            subsample=subsample,
            colsample_bytree=colsample_bytree,
            eval_metric="logloss",
            random_state=42,
            verbosity=0,
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
        names = self._clf.get_booster().feature_names or []
        return dict(zip(names, self._clf.feature_importances_.tolist()))
