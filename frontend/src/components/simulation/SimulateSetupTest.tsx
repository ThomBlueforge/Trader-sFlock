'use client'

import { useState } from 'react'
import type { Agent } from '@/types'
import { api } from '@/lib/api'
import { fmtPct, fmtPrice, fmtDateTimeSec } from '@/lib/formatters'
import EquityCurve from '@/components/portfolio/EquityCurve'

const TF_MINUTES: Record<string, number> = {
  '5m': 5, '15m': 15, '30m': 30, '1h': 60, '2h': 120, '4h': 240, '1d': 1440,
}

function barsToTime(bars: number, tf: string) {
  const mins = bars * (TF_MINUTES[tf] ?? 60)
  if (mins < 60) return `${mins} min`
  if (mins < 1440) return `${(mins / 60).toFixed(1)} hr`
  return `${(mins / 1440).toFixed(1)} days`
}

interface Result {
  metrics:      Record<string, number>
  trades:       Record<string, unknown>[]
  equity_curve: { ts: number; equity: number }[]
  config:       Record<string, unknown>
}

interface Props {
  agents:   Agent[]
  agentId:  string
  onAgentChange: (id: string) => void
}

export default function SimulateSetupTest({ agents, agentId, onAgentChange }: Props) {
  const agent = agents.find(a => a.id === agentId)

  // Controls
  const [tpPct,      setTpPct]      = useState(1.0)
  const [slPct,      setSlPct]      = useState(0.5)
  const [holdBars,   setHoldBars]   = useState(6)
  const [startDate,  setStartDate]  = useState('')
  const [endDate,    setEndDate]    = useState('')
  const [minConf,    setMinConf]    = useState(0)

  const [result,   setResult]   = useState<Result | null>(null)
  const [running,  setRunning]  = useState(false)
  const [error,    setError]    = useState('')

  const handleRun = async () => {
    if (!agentId) return
    setRunning(true)
    setError('')
    setResult(null)
    try {
      const r = await api.training.setupTest(agentId, {
        hold_bars:         holdBars,
        stop_loss_pct:     slPct / 100,
        take_profit_pct:   tpPct / 100,
        min_confidence:    minConf,
        start_date:        startDate || undefined,
        end_date:          endDate   || undefined,
      }) as Result
      setResult(r)
    } catch (err) {
      setError(String(err))
    } finally {
      setRunning(false)
    }
  }

  const m = result?.metrics ?? {}
  const trades = (result?.trades ?? []) as { exit_reason: string; pnl: number }[]
  const tpHits   = trades.filter(t => t.exit_reason === 'tp')
  const slHits   = trades.filter(t => t.exit_reason === 'sl')
  const timeHits = trades.filter(t => t.exit_reason === 'time')

  const rr = tpPct / slPct

  return (
    <div>
      {/* Agent selector */}
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <label className="field-label">Agent</label>
        <select className="select" value={agentId} onChange={e => onAgentChange(e.target.value)}>
          <option value="">Select agent…</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name} ({a.timeframe})</option>)}
        </select>
      </div>

      {agent && (
        <>
          {/* ── Controls ─────────────────────────────────────────── */}
          <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
            <h4 style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--text-sm)' }}>
              Setup Parameters — <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}>{agent.name} · {agent.timeframe}</span>
            </h4>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
              {/* Left column */}
              <div>
                {/* Take Profit */}
                <div className="field">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                    <label className="field-label" style={{ marginBottom: 0 }}>Take Profit</label>
                    <span style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)', color: 'var(--color-bull)', fontWeight: 700 }}>
                      +{tpPct.toFixed(1)}%
                    </span>
                  </div>
                  <input type="range" className="range" min={0.1} max={5} step={0.1}
                    value={tpPct} onChange={e => setTpPct(parseFloat(e.target.value))} />
                </div>

                {/* Stop Loss */}
                <div className="field">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                    <label className="field-label" style={{ marginBottom: 0 }}>Stop Loss</label>
                    <span style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)', color: 'var(--color-bear)', fontWeight: 700 }}>
                      -{slPct.toFixed(1)}%
                    </span>
                  </div>
                  <input type="range" className="range" min={0.1} max={3} step={0.1}
                    value={slPct} onChange={e => setSlPct(parseFloat(e.target.value))} />
                </div>

                {/* Max hold */}
                <div className="field">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                    <label className="field-label" style={{ marginBottom: 0 }}>Max Hold Duration</label>
                    <span style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)', color: 'var(--color-gold)', fontWeight: 700 }}>
                      {holdBars} bars ({barsToTime(holdBars, agent.timeframe)})
                    </span>
                  </div>
                  <input type="range" className="range" min={1} max={48} step={1}
                    value={holdBars} onChange={e => setHoldBars(parseInt(e.target.value))} />
                </div>
              </div>

              {/* Right column */}
              <div>
                {/* Min confidence */}
                <div className="field">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                    <label className="field-label" style={{ marginBottom: 0 }}>Min Confidence Filter</label>
                    <span style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
                      {minConf === 0 ? 'Off' : `≥ ${(minConf * 100).toFixed(0)}%`}
                    </span>
                  </div>
                  <input type="range" className="range" min={0.5} max={0.9} step={0.01}
                    value={minConf === 0 ? 0.5 : minConf}
                    onChange={e => setMinConf(parseFloat(e.target.value) === 0.5 && minConf === 0 ? 0 : parseFloat(e.target.value))} />
                  <button className="btn btn--ghost btn--sm" style={{ marginTop: 4 }}
                    onClick={() => setMinConf(0)}>
                    {minConf === 0 ? '— no filter' : 'Clear filter'}
                  </button>
                </div>

                {/* Date range */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                  <div className="field">
                    <label className="field-label">From</label>
                    <input type="date" className="input" value={startDate} onChange={e => setStartDate(e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="field-label">To</label>
                    <input type="date" className="input" value={endDate} onChange={e => setEndDate(e.target.value)} />
                  </div>
                </div>
              </div>
            </div>

            {/* R:R summary + run button */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)',
              padding: 'var(--space-3) var(--space-4)', background: 'var(--color-surface-2)',
              borderRadius: 'var(--radius-md)', marginTop: 'var(--space-2)' }}>
              <div>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>Risk:Reward </span>
                <span style={{ fontWeight: 700, color: rr >= 2 ? 'var(--color-bull)' : rr >= 1 ? 'var(--color-gold)' : 'var(--color-bear)' }}>
                  1:{rr.toFixed(1)}
                </span>
              </div>
              <div>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>Break-even WR </span>
                <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}>
                  {(1 / (1 + rr) * 100).toFixed(0)}%
                </span>
                <span style={{ fontSize: '0.6rem', color: 'var(--color-muted)', marginLeft: 4 }}>
                  (need this win rate to break even)
                </span>
              </div>
              <button
                className="btn btn--primary"
                style={{ marginLeft: 'auto' }}
                onClick={handleRun}
                disabled={running || tpPct <= slPct}
              >
                {running ? 'Running…' : 'Analyse'}
              </button>
            </div>

            {tpPct <= slPct && (
              <p style={{ color: 'var(--color-bear)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)' }}>
                TP must be greater than SL
              </p>
            )}
            {error && (
              <p style={{ color: 'var(--color-bear)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-3)' }}>{error}</p>
            )}
          </div>

          {/* ── Results ─────────────────────────────────────────────── */}
          {result && trades.length > 0 && (
            <div className="card">
              {/* Primary answer */}
              <h3 style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--text-lg)' }}>
                Out of <strong>{trades.length} trades</strong>
                {startDate || endDate
                  ? ` from ${startDate || 'start'} to ${endDate || 'today'}`
                  : ' (full history)'}
              </h3>

              {/* Exit outcome bars */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
                {/* TP */}
                <div style={{ background: 'oklch(65% 0.18 145 / 0.1)', border: '1px solid oklch(65% 0.18 145 / 0.4)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', textAlign: 'center' }}>
                  <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 900, color: 'var(--color-bull)' }}>
                    {tpHits.length}
                  </div>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-bull)', marginTop: 4 }}>
                    Hit Take Profit (+{tpPct.toFixed(1)}%)
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginTop: 2 }}>
                    {(tpHits.length / trades.length * 100).toFixed(0)}% of trades
                  </div>
                  {/* Visual bar */}
                  <div style={{ height: 4, background: 'var(--color-border)', borderRadius: 2, marginTop: 'var(--space-2)' }}>
                    <div style={{ height: '100%', width: `${tpHits.length / trades.length * 100}%`, background: 'var(--color-bull)', borderRadius: 2 }} />
                  </div>
                </div>

                {/* SL */}
                <div style={{ background: 'oklch(60% 0.20 25 / 0.1)', border: '1px solid oklch(60% 0.20 25 / 0.4)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', textAlign: 'center' }}>
                  <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 900, color: 'var(--color-bear)' }}>
                    {slHits.length}
                  </div>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-bear)', marginTop: 4 }}>
                    Hit Stop Loss (-{slPct.toFixed(1)}%)
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginTop: 2 }}>
                    {(slHits.length / trades.length * 100).toFixed(0)}% of trades
                  </div>
                  <div style={{ height: 4, background: 'var(--color-border)', borderRadius: 2, marginTop: 'var(--space-2)' }}>
                    <div style={{ height: '100%', width: `${slHits.length / trades.length * 100}%`, background: 'var(--color-bear)', borderRadius: 2 }} />
                  </div>
                </div>

                {/* Time exit */}
                <div style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', textAlign: 'center' }}>
                  <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 900, color: 'var(--color-muted)' }}>
                    {timeHits.length}
                  </div>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-muted)', marginTop: 4 }}>
                    Time Exit ({barsToTime(holdBars, agent.timeframe)})
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginTop: 2 }}>
                    {(timeHits.length / trades.length * 100).toFixed(0)}% of trades
                  </div>
                  <div style={{ height: 4, background: 'var(--color-border)', borderRadius: 2, marginTop: 'var(--space-2)' }}>
                    <div style={{ height: '100%', width: `${timeHits.length / trades.length * 100}%`, background: 'var(--color-muted)', borderRadius: 2 }} />
                  </div>
                </div>
              </div>

              {/* Verdict */}
              {(() => {
                const wr      = m.win_rate ?? 0
                const beven   = 1 / (1 + rr)
                const edge    = wr - beven
                const verdict = edge > 0.05
                  ? { color: 'var(--color-bull)', icon: '✓', text: `This TP/SL setup has a positive edge: win rate (${(wr*100).toFixed(0)}%) exceeds the break-even threshold (${(beven*100).toFixed(0)}%) by ${(edge*100).toFixed(0)} percentage points.` }
                  : edge > 0
                  ? { color: 'var(--color-gold)', icon: '◐', text: `Marginal edge: win rate (${(wr*100).toFixed(0)}%) barely covers break-even (${(beven*100).toFixed(0)}%). Transaction costs may eliminate this in live trading.` }
                  : { color: 'var(--color-bear)', icon: '✕', text: `Negative edge: win rate (${(wr*100).toFixed(0)}%) is below break-even (${(beven*100).toFixed(0)}%). You need either a higher TP, lower SL, or a better signal.` }
                return (
                  <div style={{ background: 'var(--color-surface-2)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3) var(--space-4)', marginBottom: 'var(--space-4)', display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 'var(--text-xl)', color: verdict.color, flexShrink: 0 }}>{verdict.icon}</span>
                    <p style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6, margin: 0 }}>{verdict.text}</p>
                  </div>
                )
              })()}

              {/* Summary stats */}
              <div className="stat-grid" style={{ marginBottom: 'var(--space-6)' }}>
                {[
                  { label: 'Total Return',  value: m.total_return   != null ? fmtPct(m.total_return)           : '—', color: (m.total_return ?? 0)  >= 0 ? 'var(--color-bull)' : 'var(--color-bear)' },
                  { label: 'Sharpe',        value: m.sharpe         != null ? m.sharpe.toFixed(2)              : '—', color: (m.sharpe ?? 0)        >= 0 ? 'var(--color-bull)' : 'var(--color-bear)' },
                  { label: 'Win Rate',      value: m.win_rate       != null ? fmtPct(m.win_rate, 1, false)     : '—', color: 'var(--color-text)' },
                  { label: 'Profit Factor', value: m.profit_factor  != null ? m.profit_factor.toFixed(2)       : '—', color: (m.profit_factor ?? 0) >= 1 ? 'var(--color-bull)' : 'var(--color-bear)' },
                  { label: 'Max Drawdown',  value: m.max_drawdown   != null ? fmtPct(m.max_drawdown)           : '—', color: 'var(--color-bear)' },
                  { label: 'Avg PnL',       value: m.avg_trade_pnl  != null ? `$${fmtPrice(m.avg_trade_pnl)}` : '—', color: (m.avg_trade_pnl ?? 0) >= 0 ? 'var(--color-bull)' : 'var(--color-bear)' },
                ].map(s => (
                  <div key={s.label} className="stat-box">
                    <div className="stat-label">{s.label}</div>
                    <div className="stat-value" style={{ fontSize: 'var(--text-base)', color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Equity curve */}
              {result.equity_curve.length > 1 && (
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <h4 style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 var(--space-3)' }}>
                    Equity Curve
                  </h4>
                  <EquityCurve equity={result.equity_curve} height={200} />
                </div>
              )}

              {/* Trade breakdown table (last 30) */}
              <h4 style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 var(--space-3)' }}>
                Last 30 Trades
              </h4>
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr><th>Signal</th><th>Entry</th><th>Exit</th><th>Exit via</th><th>Return</th><th>PnL</th></tr>
                  </thead>
                  <tbody>
                    {(result.trades as any[]).slice(-30).reverse().map((t, i) => {
                      const isWin = (t.pnl ?? 0) > 0
                      return (
                        <tr key={i}>
                          <td>
                            <span style={{ color: t.signal === 'BULL' ? 'var(--color-bull)' : 'var(--color-bear)', fontWeight: 700, fontSize: 'var(--text-xs)' }}>
                              {t.signal === 'BULL' ? '▲' : '▼'} {t.signal}
                            </span>
                          </td>
                          <td className="mono">{fmtPrice(t.entry_price)}</td>
                          <td className="mono">{fmtPrice(t.exit_price)}</td>
                          <td>
                            <span style={{
                              fontSize: 'var(--text-xs)', fontWeight: 700,
                              color: t.exit_reason === 'tp' ? 'var(--color-bull)' : t.exit_reason === 'sl' ? 'var(--color-bear)' : 'var(--color-muted)',
                            }}>
                              {t.exit_reason === 'tp' ? `✓ TP +${tpPct.toFixed(1)}%` : t.exit_reason === 'sl' ? `✕ SL -${slPct.toFixed(1)}%` : `⏱ Time`}
                            </span>
                          </td>
                          <td className="mono" style={{ color: isWin ? 'var(--color-bull)' : 'var(--color-bear)', fontSize: 'var(--text-xs)' }}>
                            {(t.return_pct >= 0 ? '+' : '')}{(t.return_pct * 100).toFixed(3)}%
                          </td>
                          <td className="mono" style={{ color: isWin ? 'var(--color-bull)' : 'var(--color-bear)', fontWeight: 600 }}>
                            {t.pnl >= 0 ? '+' : ''}{fmtPrice(t.pnl)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result && trades.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-muted)' }}>
              <p>No trades generated. Try a longer date range or lower threshold.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
