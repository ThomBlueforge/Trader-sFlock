from __future__ import annotations
from typing import Any, Optional
from pydantic import BaseModel, Field


# ── Agent ─────────────────────────────────────────────────────────────────────

class AgentCreate(BaseModel):
    name: str
    color: str = "#d4af37"
    timeframe: str = "1d"
    features: list[str] = Field(default_factory=list)
    model_type: str = "xgboost"          # "logreg" | "xgboost"
    hyperparams: dict[str, Any] = Field(default_factory=dict)
    target_horizon: int = 5
    target_threshold: float = 0.3
    train_window: int = 500
    position_size_pct: float = 0.1


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    features: Optional[list[str]] = None
    model_type: Optional[str] = None
    hyperparams: Optional[dict[str, Any]] = None
    target_horizon: Optional[int] = None
    target_threshold: Optional[float] = None
    train_window: Optional[int] = None
    position_size_pct: Optional[float] = None


class AgentOut(BaseModel):
    id: str
    name: str
    color: str
    timeframe: str
    features: list[str]
    model_type: str
    hyperparams: dict[str, Any]
    target_horizon: int
    target_threshold: float
    train_window: int
    position_size_pct: float
    status: str                          # created | training | trained | active
    metrics: Optional[dict[str, Any]] = None
    created_at: int
    updated_at: int


# ── Candles ───────────────────────────────────────────────────────────────────

class Candle(BaseModel):
    ts: int        # unix-ms
    open: float
    high: float
    low: float
    close: float
    volume: float


class CandlesResponse(BaseModel):
    symbol: str
    timeframe: str
    candles: list[Candle]


# ── Signals ───────────────────────────────────────────────────────────────────

class SignalOut(BaseModel):
    id: str
    agent_id: str
    ts: int
    timeframe: str
    signal: str       # "BULL" | "SHORT"
    confidence: float


class LatestSignals(BaseModel):
    signals: list[SignalOut]


# ── Training ──────────────────────────────────────────────────────────────────

class TrainRequest(BaseModel):
    agent_id: str


class TrainingMetrics(BaseModel):
    accuracy: float
    precision: float
    recall: float
    f1: float
    total_return: float
    annualized_return: float
    sharpe: float
    sortino_ratio: Optional[float] = None
    calmar_ratio: Optional[float] = None
    profit_factor: Optional[float] = None
    max_drawdown: float
    win_rate: float
    n_trades: int
    n_bars_tested: int
    avg_trade_duration_bars: Optional[float] = None
    signal_stability: Optional[float] = None
    ic_score: Optional[float] = None
    ic_pvalue: Optional[float] = None
    sharpe_ci_low: Optional[float] = None
    sharpe_ci_high: Optional[float] = None
    regime_breakdown: Optional[dict[str, Any]] = None
    feature_importances: Optional[dict[str, float]] = None


# ── Portfolio ─────────────────────────────────────────────────────────────────

class PortfolioOut(BaseModel):
    id: str
    agent_id: str
    initial_capital: float
    current_capital: float
    position: float           # 1.0 = long, -1.0 = short, 0 = flat
    position_entry_price: Optional[float]
    position_size_pct: float
    created_at: int
    total_return_pct: float
    open_pnl: float


class TradeOut(BaseModel):
    id: str
    portfolio_id: str
    agent_id: str
    signal: str
    entry_price: float
    exit_price: Optional[float]
    quantity: float
    pnl: Optional[float]
    opened_at: int
    closed_at: Optional[int]
    status: str               # open | closed


# ── WebSocket events ──────────────────────────────────────────────────────────

class WSEvent(BaseModel):
    event: str                # signal_update | training_progress | price_tick
    data: dict[str, Any]


# ── Feature registry ──────────────────────────────────────────────────────────

class FeatureMeta(BaseModel):
    key: str
    name: str
    description: str
    category: str
    timeframes: list[str]


# ── Intelligence — Patterns & Regimes ─────────────────────────────────────────

class PatternOut(BaseModel):
    id: str
    symbol: str
    timeframe: str
    ts: int
    pattern_type: str
    direction: str
    strength: float
    confirmed_at: Optional[int] = None


class PatternStatsOut(BaseModel):
    pattern_type: str
    timeframe: str
    direction: str
    n_total: int
    n_correct: int
    hit_rate: float
    mean_fwd_ret: Optional[float] = None


class RegimePoint(BaseModel):
    ts: int
    regime: str       # LOW | MED | HIGH
    atr_21: float


# ── Intelligence — Edge Discovery ─────────────────────────────────────────────

class FeatureIC(BaseModel):
    key: str
    name: str
    ic: float
    pvalue: float
    mutual_info: float


class CorrelationMinerResult(BaseModel):
    timeframe: str
    feature_ics: list[FeatureIC]
    collinearity: dict[str, dict[str, float]]
    top_pairs: list[dict[str, Any]]


# ── Intelligence — Parameter Sweep ────────────────────────────────────────────

class SweepRequest(BaseModel):
    agent_id: str
    horizons: list[int] = Field(default=[3, 5, 7, 10])
    thresholds: list[float] = Field(default=[0.001, 0.002, 0.003, 0.005])
    train_windows: list[int] = Field(default=[300, 500])


class SweepCell(BaseModel):
    horizon: int
    threshold: float
    train_window: int
    sharpe: Optional[float] = None
    win_rate: Optional[float] = None
    total_return: Optional[float] = None
    n_trades: Optional[int] = None
    error: Optional[str] = None


# ── Simulation — Monte Carlo ──────────────────────────────────────────────────

class MonteCarloRequest(BaseModel):
    agent_id: str
    n_runs: int = 500
    block_size: int = 0     # 0 = shuffle, >0 = block bootstrap


class MonteCarloResult(BaseModel):
    p5: list[dict[str, float]]
    p25: list[dict[str, float]]
    p50: list[dict[str, float]]
    p75: list[dict[str, float]]
    p95: list[dict[str, float]]
    actual: list[dict[str, float]]
    prob_ruin: float
    sharpe_pvalue: float


# ── ML — Model Registry ────────────────────────────────────────────────────────

class ModelVersionOut(BaseModel):
    id: str
    agent_id: str
    version: int
    feature_names: list[str]
    hyperparams: dict[str, Any]
    metrics: Optional[dict[str, Any]] = None
    is_active: bool
    created_at: int


# ── Notifications ──────────────────────────────────────────────────────────────

class NotificationOut(BaseModel):
    id: str
    agent_id: Optional[str] = None
    type: str
    message: str
    is_read: bool
    created_at: int


# ── Setup Tester ───────────────────────────────────────────────────────────

class SetupTestRequest(BaseModel):
    hold_bars:         int   = 6
    stop_loss_pct:     float = 0.005
    take_profit_pct:   float = 0.010
    start_date:        Optional[str] = None
    end_date:          Optional[str] = None
    initial_capital:   float = 10_000.0
    position_size_pct: float = 0.1
    min_confidence:    float = 0.0


class SetupSweepRequest(BaseModel):
    hold_bars_list: list[int]   = Field(default=[3, 6, 12, 24])
    sl_pcts:        list[float] = Field(default=[0.002, 0.005, 0.008])
    tp_pcts:        list[float] = Field(default=[0.005, 0.010, 0.015, 0.020])
    start_date:     Optional[str] = None
    end_date:       Optional[str] = None
