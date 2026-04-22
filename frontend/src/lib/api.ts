import type {
  Agent,
  CandlesResponse,
  FeatureMeta,
  LatestSignals,
  Portfolio,
  SignalOut,
  Trade,
} from '@/types'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// Read FastAPI's { detail } error body; fall back to status text
const json = async (r: Response) => {
  if (!r.ok) {
    let msg = `Server error ${r.status}`
    try {
      const body = await r.json()
      if (body?.detail) {
        msg = typeof body.detail === 'string'
          ? body.detail
          : JSON.stringify(body.detail)
      }
    } catch {}
    throw new Error(msg)
  }
  return r.json()
}

// Fetch with an AbortController timeout so slow ops don't hang the UI
const fetchT = (url: string, opts: RequestInit = {}, timeoutMs = 30_000) => {
  const ctrl = new AbortController()
  const tid  = setTimeout(() => ctrl.abort(), timeoutMs)
  return fetch(url, { ...opts, signal: ctrl.signal })
    .finally(() => clearTimeout(tid))
    .then(json)
    .catch((err: Error) => {
      if (err.name === 'AbortError') {
        throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s. The operation is still running on the server — try again.`)
      }
      throw err
    })
}

const post = (url: string, body?: unknown, timeoutMs = 30_000) =>
  fetchT(url, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }, timeoutMs)

const patch = (url: string, body: unknown) =>
  fetchT(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const del = (url: string) => fetchT(url, { method: 'DELETE' })

export const api = {
  candles: (sym: string, tf: string, limit = 500): Promise<CandlesResponse> =>
    fetch(`${BASE}/api/data/candles/${sym}/${tf}?limit=${limit}`).then(json),

  features: (tf: string): Promise<FeatureMeta[]> =>
    fetch(`${BASE}/api/data/features?timeframe=${tf}`).then(json),

  symbols: (): Promise<Record<string, Record<string, number>>> =>
    fetch(`${BASE}/api/data/symbols`).then(json),

  refresh: (): Promise<{ status: string }> =>
    post(`${BASE}/api/data/refresh`),

  agents: {
    list: (): Promise<Agent[]> =>
      fetch(`${BASE}/api/agents/`).then(json),

    create: (body: Partial<Agent>): Promise<Agent> =>
      post(`${BASE}/api/agents/`, body),

    get: (id: string): Promise<Agent> =>
      fetch(`${BASE}/api/agents/${id}`).then(json),

    update: (id: string, body: Partial<Agent>): Promise<Agent> =>
      patch(`${BASE}/api/agents/${id}`, body),

    delete: (id: string): Promise<{ deleted: boolean }> =>
      del(`${BASE}/api/agents/${id}`),

    activate: (id: string): Promise<Agent> =>
      post(`${BASE}/api/agents/${id}/activate`),

    deactivate: (id: string): Promise<Agent> =>
      post(`${BASE}/api/agents/${id}/deactivate`),

    signals: (id: string, limit = 100): Promise<SignalOut[]> =>
      fetch(`${BASE}/api/agents/${id}/signals?limit=${limit}`).then(json),

    latest: (): Promise<LatestSignals> =>
      fetch(`${BASE}/api/agents/signals/latest`).then(json),

    generateSignals: (): Promise<{ generated: number }> =>
      post(`${BASE}/api/agents/signals/generate`),
  },

  training: {
    train: (id: string): Promise<{ status: string }> =>
      post(`${BASE}/api/training/${id}/train`),

    optimize: (id: string, nTrials?: number): Promise<{ status: string }> =>
      post(`${BASE}/api/training/${id}/optimize${nTrials ? `?n_trials=${nTrials}` : ''}`),

    cancel: (id: string): Promise<{ status: string }> =>
      post(`${BASE}/api/training/${id}/cancel`),

    backtest: (id: string): Promise<Record<string, unknown>> =>
      post(`${BASE}/api/training/${id}/backtest`),

    setupTest: (id: string, body: unknown): Promise<Record<string, unknown>> =>
      post(`${BASE}/api/training/${id}/setup_test`, body),

    setupSweep: (id: string, body: unknown): Promise<unknown[]> =>
      post(`${BASE}/api/training/${id}/setup_sweep`, body),
  },

  portfolio: {
    get:    (id: string): Promise<Portfolio> =>
      fetch(`${BASE}/api/portfolio/${id}`).then(json),

    trades: (id: string, limit = 100): Promise<Trade[]> =>
      fetch(`${BASE}/api/portfolio/${id}/trades?limit=${limit}`).then(json),

    equity: (id: string): Promise<{ ts: number; equity: number }[]> =>
      fetch(`${BASE}/api/portfolio/${id}/equity`).then(json),

    reset: (id: string): Promise<Portfolio> =>
      post(`${BASE}/api/portfolio/${id}/reset`),

    all: (): Promise<Portfolio[]> =>
      fetch(`${BASE}/api/portfolio/summary/all`).then(json),
  },

  intelligence: {
    regimes: (limit = 500) =>
      fetch(`${BASE}/api/intelligence/regimes?limit=${limit}`).then(json),

    patterns: (symbol = 'GC=F', timeframe = '1d', limit = 100) =>
      fetch(`${BASE}/api/intelligence/patterns?symbol=${symbol}&timeframe=${timeframe}&limit=${limit}`).then(json),

    patternStats: (timeframe = '1d') =>
      fetch(`${BASE}/api/intelligence/pattern_stats?timeframe=${timeframe}`).then(json),

    sweep: (body: unknown) =>
      post(`${BASE}/api/intelligence/sweep`, body, 300_000), // 5-min timeout

    mineCorrelations: (timeframe = '1d', horizon = 5, threshold = 0.003) =>
      post(`${BASE}/api/intelligence/mine_correlations?timeframe=${timeframe}&horizon=${horizon}&threshold=${threshold}`),

    modelVersions: (agentId: string) =>
      fetch(`${BASE}/api/intelligence/model_versions/${agentId}`).then(json),

    rollback: (agentId: string, version: number) =>
      post(`${BASE}/api/intelligence/rollback/${agentId}/${version}`),

    notifications: (unreadOnly = false) =>
      fetch(`${BASE}/api/intelligence/notifications?unread_only=${unreadOnly}`).then(json),

    markRead: (id: string) =>
      post(`${BASE}/api/intelligence/notifications/${id}/read`),
  },

  simulate: {
    scenarios: () =>
      fetch(`${BASE}/api/simulate/scenarios`).then(json),

    monteCarlo: (body: unknown) =>
      post(`${BASE}/api/simulate/monte_carlo`, body, 600_000), // 10-min timeout for heavy backtests

    scenario: (scenarioId: string, agentId: string) =>
      post(`${BASE}/api/simulate/scenario/${scenarioId}?agent_id=${agentId}`),
  },

  baseline: () =>
    post(`${BASE}/api/agents/baseline`),

  presets: (): Promise<Agent[]> =>
    post(`${BASE}/api/agents/presets`),

  historicalImport: {
    start: (body: {
      start_date?: string
      end_date?: string
      symbol?: string
      concurrency?: number
      timeframes?: string[]
    }): Promise<Record<string, unknown>> =>
      post(`${BASE}/api/data/historical/start`, body, 10_000),

    status: (): Promise<Record<string, unknown>> =>
      fetch(`${BASE}/api/data/historical/status`).then(json),

    cancel: (): Promise<Record<string, unknown>> =>
      post(`${BASE}/api/data/historical/cancel`),

    summary: (symbol = 'GC=F'): Promise<Record<string, { bar_count: number; date_from: string | null; date_to: string | null; coverage: number }>> =>
      fetch(`${BASE}/api/data/historical/summary?symbol=${symbol}`).then(json),
  },
}
