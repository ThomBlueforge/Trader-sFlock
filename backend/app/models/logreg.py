from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from app.models.base import BaseSignalModel


class LogRegModel(BaseSignalModel):

    def __init__(self, C: float = 1.0, max_iter: int = 1000, solver: str = "lbfgs", **kwargs):
        # Filter only recognised LogisticRegression params from kwargs
        import inspect
        valid = set(inspect.signature(LogisticRegression.__init__).parameters)
        lr_kwargs = {k: v for k, v in kwargs.items() if k in valid}
        self._pipeline = Pipeline([
            ("scaler", StandardScaler()),
            ("clf",    LogisticRegression(C=C, max_iter=max_iter, solver=solver,
                                          random_state=42, **lr_kwargs)),
        ])

    def fit(self, X: pd.DataFrame, y: pd.Series) -> None:
        self._pipeline.fit(X.values, y.values)

    def predict_proba_bull(self, X: pd.DataFrame) -> np.ndarray:
        proba    = self._pipeline.predict_proba(X.values)
        bull_idx = list(self._pipeline.named_steps["clf"].classes_).index(1)
        return proba[:, bull_idx]
