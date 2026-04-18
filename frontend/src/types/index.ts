export interface Agent {
  id: string
  name: string
  color: string
  timeframe: string
  features: string[]
  model_type: string
  hyperparams: Record<string, unknown>
  target_horizon: number
  target_threshold: number
  train_window: number
  position_size_pct: number
  status: 'created' | 'training' | 'trained' | 'active'
  metrics?: TrainingMetrics & { feature_importances?: Record<string, number> }
  created_at: number
  updated_at: number
}

export interface Candle {
  ts: number   // unix-ms
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface SignalOut {
  id: string
  agent_id: string
  ts: number       // unix-seconds
  timeframe: string
  signal: 'BULL' | 'SHORT'
  confidence: number
}

export interface TrainingMetrics {
  accuracy: number
  precision: number
  recall: number
  f1: number
  total_return: number
  annualized_return: number
  sharpe: number
  max_drawdown: number
  win_rate: number
  n_trades: number
  n_bars_tested: number
}

export interface Portfolio {
  id: string
  agent_id: string
  initial_capital: number
  current_capital: number
  position: number           // 1=long, -1=short, 0=flat
  position_entry_price: number | null
  position_size_pct: number
  created_at: number
  total_return_pct: number
  open_pnl: number
}

export interface Trade {
  id: string
  portfolio_id: string
  agent_id: string
  signal: string
  entry_price: number
  exit_price: number | null
  quantity: number
  pnl: number | null
  opened_at: number
  closed_at: number | null
  status: string
}

export interface WSEvent {
  event: string
  data: Record<string, unknown>
}

export interface FeatureMeta {
  key: string
  name: string
  description: string
  category: string
  timeframes: string[]
}

export interface LatestSignals {
  signals: SignalOut[]
}

export interface CandlesResponse {
  symbol: string
  timeframe: string
  candles: Candle[]
}

export interface Pattern {
  id: string
  symbol: string
  timeframe: string
  ts: number
  pattern_type: string
  direction: 'BULL' | 'SHORT'
  strength: number
  confirmed_at: number | null
}

export interface RegimePoint {
  ts: number
  regime: 'LOW' | 'MED' | 'HIGH'
  atr_21: number
}

export interface ModelVersion {
  id: string
  agent_id: string
  version: number
  feature_names: string[]
  hyperparams: Record<string, unknown>
  metrics: Record<string, unknown> | null
  is_active: boolean
  created_at: number
}

export interface Notification {
  id: string
  agent_id: string | null
  type: string
  message: string
  is_read: boolean
  created_at: number
}

export interface SweepCell {
  horizon: number
  threshold: number
  train_window: number
  sharpe: number | null
  win_rate: number | null
  total_return: number | null
  n_trades: number | null
  error: string | null
}

export interface EquityPoint {
  equity: number
}

export interface MonteCarloResult {
  p5: EquityPoint[]
  p25: EquityPoint[]
  p50: EquityPoint[]
  p75: EquityPoint[]
  p95: EquityPoint[]
  actual: EquityPoint[]
  prob_ruin: number
  sharpe_pvalue: number
}

export interface Scenario {
  id: string
  name: string
  start: number
  end: number
}

export interface FeatureIC {
  key: string
  name: string
  ic: number
  pvalue: number
  mutual_info: number
}

export interface AgentConfig {
  name?: string
  color?: string
  timeframe?: string
  features?: string[]
  model_type?: string
  hyperparams?: Record<string, number>
  target_horizon?: number
  target_threshold?: number
  train_window?: number
  position_size_pct?: number
}
