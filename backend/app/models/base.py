"""
Abstract base class for all signal models.
Signals are strictly BULL or SHORT — no NEUTRAL.
The model always picks the direction with the higher probability.
"""
from __future__ import annotations

import io
from abc import ABC, abstractmethod

import joblib
import numpy as np
import pandas as pd


class BaseSignalModel(ABC):

    @abstractmethod
    def fit(self, X: pd.DataFrame, y: pd.Series) -> None:
        """Train on feature matrix X and binary target y (1=BULL, 0=SHORT)."""

    @abstractmethod
    def predict_proba_bull(self, X: pd.DataFrame) -> np.ndarray:
        """Return P(BULL) for each row. Shape: (n_samples,)."""

    def predict(self, X: pd.DataFrame) -> list[str]:
        """Return BULL or SHORT for each row. Strictly binary — no NEUTRAL."""
        return ["BULL" if p >= 0.5 else "SHORT" for p in self.predict_proba_bull(X)]

    def predict_single(self, x: pd.DataFrame) -> tuple[str, float]:
        """
        Predict signal + confidence for a single-row DataFrame.
        Confidence is always >= 0.5 (probability of the predicted direction).
        """
        p = float(self.predict_proba_bull(x)[0])
        if p >= 0.5:
            return "BULL", p
        return "SHORT", 1.0 - p

    def to_bytes(self) -> bytes:
        buf = io.BytesIO()
        joblib.dump(self, buf)
        return buf.getvalue()

    @classmethod
    def from_bytes(cls, data: bytes) -> "BaseSignalModel":
        return joblib.load(io.BytesIO(data))
