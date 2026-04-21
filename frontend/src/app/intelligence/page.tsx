'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAgents } from '@/hooks/useAgents'
import { api } from '@/lib/api'
import { fmtDateMs } from '@/lib/formatters'
import type { Pattern, RegimePoint, SweepCell, FeatureIC } from '@/types'
import ParameterHeatmap from '@/components/intelligence/ParameterHeatmap'
import Button from '@/components/ui/Button'
import { useSignalSocket } from '@/hooks/useSignalSocket'

const REGIME_COLOR: Record<string, string> = {
  LOW:  'var(--color-bull)',
  MED:  'var(--color-gold)',
  HIGH: 'var(--color-bear)',
}
const TARGET_HORIZON = 5  // must match backend pattern_engine.TARGET_HORIZON

export default function IntelligencePage() {
  const { agents } = useAgents()
  const [tab, setTab] = useState<'regimes' | 'patterns' | 'sweep' | 'miner'>('regimes')

  // Regimes
  const [regimes, setRegimes] = useState<RegimePoint[]>([])
  const [reloadingRegimes, setReloadingRegimes] = useState(false)

  // Pattern stats
  const [patternStats, setPatternStats] = useState<Record<string, { n_total: number; n_correct: number; hit_rate: number; mean_fwd_ret: number }>>({})

  // Patterns
  const [patterns,    setPatterns]    = useState<Pattern[]>([])
  const [patternTf,   setPatternTf]   = useState('1d')

  // Sweep
  const [sweepAgentId, setSweepAgentId] = useState('')
  const [sweepCells,   setSweepCells]   = useState<SweepCell[]>([])
  const [sweeping,     setSweeping]     = useState(false)
  const [sweepPct,     setSweepPct]     = useState(0)
  const [sweepError,   setSweepError]   = useState('')
  const [sweepStatus,  setSweepStatus]  = useState('')  // e.g. "12 / 32"

  // Miner
  const [minerTf,       setMinerTf]       = useState('1d')
  const [featureICs,    setFeatureICs]    = useState<FeatureIC[]>([])
  const [mining,        setMining]        = useState(false)

  useEffect(() => {
    api.intelligence.regimes(365).then(setRegimes).catch(() => {})
  }, [])

  useEffect(() => {
    api.intelligence.patterns('GC=F', patternTf, 100).then(setPatterns).catch(() => {})
    api.intelligence.patternStats(patternTf).then((stats: any[]) => {
      const map: Record<string, any> = {}
      stats.forEach((s) => { map[`${s.pattern_type}:${s.direction}`] = s })
      setPatternStats(map)
    }).catch(() => {})
  }, [patternTf])

  useSignalSocket((e) => {
    if (e.event === 'sweep_progress') {
      const { pct, completed, total } = e.data as { pct: number; completed: number; total: number }
      setSweepPct(pct)
      setSweepStatus(`${completed} / ${total}`)
    }
    if (e.event === 'sweep_complete') {
      const { cells } = e.data as { cells: SweepCell[] }
      setSweepCells(cells)
      setSweepPct(100)
      setSweeping(false)
    }
  })

  const handleSweep = async () => {
    if (!sweepAgentId) return
    setSweeping(true)
    setSweepError('')
    setSweepCells([])
    setSweepPct(0)
    setSweepStatus('')
    try {
      await api.intelligence.sweep({
        agent_id: sweepAgentId,
        horizons: [3, 5, 7, 10],
        thresholds: [0.001, 0.002, 0.003, 0.005],
        train_windows: [300, 500],
      })
      // Results arrive via sweep_complete WebSocket event
    } catch (err) {
      setSweepError(String(err))
      setSweeping(false)
    }
  }

  const handleMine = async () => {
    setMining(true)
    try {
      const result = await api.intelligence.mineCorrelations(minerTf, 5, 0.003)
      setFeatureICs(result.feature_ics ?? [])
    } catch (err) {
      console.error(err)
    } finally {
      setMining(false)
    }
  }

  const currentRegime = regimes.length > 0 ? regimes[regimes.length - 1] : null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-6)' }}>
        <div>
          <h2 style={{ margin: 0 }}>Intelligence</h2>
          <p style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>
            Market regime, pattern detection, edge discovery, and parameter exploration.
          </p>
        </div>
        {currentRegime && (
          <div className="stat-box">
            <div className="stat-label">Current Regime</div>
            <div className="stat-value" style={{ color: REGIME_COLOR[currentRegime.regime], fontSize: 'var(--text-lg)' }}>
              {currentRegime.regime}
            </div>
          </div>
        )}
      </div>

      {/* Tab navigation */}
      <div style={{ display: 'flex', gap: 'var(--space-1)', marginBottom: 'var(--space-6)', borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--space-2)' }}>
        {(['regimes', 'patterns', 'sweep', 'miner'] as const).map((t) => (
          <button
            key={t}
            className={`btn btn--sm ${tab === t ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => setTab(t)}
            style={{ textTransform: 'capitalize' }}
          >
            {t === 'miner' ? 'Edge Discovery' : t}
          </button>
        ))}
      </div>

      {/* Regimes tab */}
      {tab === 'regimes' && (
        <div className="card">
          <h3 style={{ margin: '0 0 var(--space-4)' }}>Volatility Regime History (Daily)</h3>
          {regimes.length === 0 ? (
            <p className="text-muted">No regime data yet. Run the backend to generate it.</p>
          ) : (
            <div>
              {/* Colour-coded strip */}
              <div style={{ display: 'flex', height: 24, borderRadius: 'var(--radius-sm)', overflow: 'hidden', marginBottom: 'var(--space-4)' }}>
                {regimes.slice(-252).map((r, i) => (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      background: REGIME_COLOR[r.regime] ?? 'var(--color-border)',
                      opacity: 0.7,
                    }}
                    title={`${fmtDateMs(r.ts)} — ${r.regime}`}
                  />
                ))}
              </div>
              {/* Legend */}
              <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: 'var(--text-xs)' }}>
                {Object.entries(REGIME_COLOR).map(([label, color]) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                    <span style={{ width: 12, height: 12, borderRadius: 2, background: color, display: 'inline-block' }} />
                    {label}
                  </div>
                ))}
              </div>
              {/* Recent history table */}
              <div style={{ marginTop: 'var(--space-4)', overflowX: 'auto' }}>
                <table className="table">
                  <thead><tr><th>Date</th><th>Regime</th><th>ATR-21</th></tr></thead>
                  <tbody>
                    {regimes.slice(-30).reverse().map((r) => (
                      <tr key={r.ts}>
                        <td>{fmtDateMs(r.ts)}</td>
                        <td><span style={{ color: REGIME_COLOR[r.regime], fontWeight: 700 }}>{r.regime}</span></td>
                        <td className="mono">{r.atr_21.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Patterns tab */}
      {tab === 'patterns' && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
            <h3 style={{ margin: 0 }}>Pattern Timeline — XAUUSD</h3>
            <select className="select" value={patternTf} onChange={(e) => setPatternTf(e.target.value)}>
              {['5m', '15m', '30m', '1h', '2h', '4h', '1d'].map((tf) => (
                <option key={tf} value={tf}>{tf}</option>
              ))}
            </select>
          </div>
          {/* Pattern stats summary */}
          {Object.keys(patternStats).length > 0 && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginBottom: 'var(--space-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Historical hit-rates on {patternTf}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                {Object.entries(patternStats).map(([key, s]: [string, any]) => {
                  const [ptype, dir] = key.split(':')
                  const isBull = dir === 'BULL'
                  const pct = (s.hit_rate * 100).toFixed(0)
                  return (
                    <div key={key} style={{
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      padding: 'var(--space-2) var(--space-3)',
                      fontSize: 'var(--text-xs)',
                    }}>
                      <div style={{ fontWeight: 600, color: isBull ? 'var(--color-bull)' : 'var(--color-bear)' }}>
                        {isBull ? '▲' : '▼'} {ptype.replace('candle_', '').replace(/_/g, ' ')}
                      </div>
                      <div style={{ color: Number(pct) >= 55 ? 'var(--color-bull)' : 'var(--color-muted)', fontWeight: 700 }}>
                        {pct}% ({s.n_correct}/{s.n_total})
                      </div>
                      <div style={{ color: s.mean_fwd_ret >= 0 ? 'var(--color-bull)' : 'var(--color-bear)' }}>
                        avg {s.mean_fwd_ret >= 0 ? '+' : ''}{(s.mean_fwd_ret * 100).toFixed(2)}%
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="divider" />
            </div>
          )}

          {patterns.length === 0 ? (
            <p className="text-muted">No patterns detected yet — wait for the next data refresh.</p>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Date</th><th>Pattern</th><th>Direction</th><th>Confirmed</th><th>Result</th></tr>
              </thead>
              <tbody>
                {patterns.map((p) => {
                  const statsKey = `${p.pattern_type}:${p.direction}`
                  const stat = patternStats[statsKey]
                  return (
                    <tr key={p.id} style={{ opacity: p.confirmed_at ? 1 : 0.6 }}>
                      <td style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>{fmtDateMs(p.ts)}</td>
                      <td style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>
                        {p.pattern_type.replace('candle_', '').replace(/_/g, ' ')}
                        {stat && (
                          <span style={{ marginLeft: 6, fontSize: '0.65rem', color: 'var(--color-muted)' }}>
                            ({(stat.hit_rate * 100).toFixed(0)}% hist.)
                          </span>
                        )}
                      </td>
                      <td>
                        <span style={{ color: p.direction === 'BULL' ? 'var(--color-bull)' : 'var(--color-bear)', fontWeight: 700, fontSize: 'var(--text-xs)' }}>
                          {p.direction === 'BULL' ? '▲' : '▼'} {p.direction}
                        </span>
                      </td>
                      <td>
                        {p.confirmed_at ? (
                          <span style={{ color: 'var(--color-bull)', fontSize: 'var(--text-xs)', fontWeight: 700 }}>✓ Confirmed</span>
                        ) : (
                          <span style={{ color: 'var(--color-muted)', fontSize: 'var(--text-xs)' }}>Pending ({TARGET_HORIZON} bars)</span>
                        )}
                      </td>
                      <td style={{ fontSize: 'var(--text-xs)' }}>
                        {p.confirmed_at ? (
                          stat ? (
                            <span style={{ color: stat.mean_fwd_ret >= 0 ? 'var(--color-bull)' : 'var(--color-bear)' }}>
                              {stat.mean_fwd_ret >= 0 ? '+' : ''}{(stat.mean_fwd_ret * 100).toFixed(2)}% avg
                            </span>
                          ) : '—'
                        ) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Sweep tab */}
      {tab === 'sweep' && (
        <div className="card">
          <h3 style={{ margin: '0 0 var(--space-4)' }}>Parameter Sweep</h3>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end', marginBottom: 'var(--space-6)' }}>
            <div className="field" style={{ margin: 0 }}>
              <label className="field-label">Agent</label>
              <select className="select" value={sweepAgentId} onChange={(e) => setSweepAgentId(e.target.value)}>
                <option value="">Select agent…</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          <Button variant="primary" loading={sweeping} onClick={handleSweep} disabled={!sweepAgentId}>
              Run Sweep
            </Button>
          </div>

          {/* Progress bar */}
          {sweeping && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-1)', fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
                <span>Running combinations…</span>
                <span className="mono">{sweepStatus || '—'}</span>
              </div>
              <div style={{ height: 6, borderRadius: 99, background: 'var(--color-surface-2)', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${sweepPct}%`,
                    background: 'var(--color-gold)',
                    borderRadius: 99,
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
            </div>
          )}

          {/* Error */}
          {sweepError && (
            <p style={{ color: 'var(--color-bear)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>
              {sweepError}
            </p>
          )}

          <ParameterHeatmap
            cells={sweepCells}
            onSelect={(cell) => {
              window.location.href = `/lab?horizon=${cell.horizon}&threshold=${cell.threshold}&train_window=${cell.train_window}`
            }}
          />
        </div>
      )}

      {/* Edge Discovery / Correlation miner tab */}
      {tab === 'miner' && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
            <h3 style={{ margin: 0 }}>Feature IC Rankings</h3>
            <select className="select" value={minerTf} onChange={(e) => setMinerTf(e.target.value)}>
              {['5m', '15m', '30m', '1h', '2h', '4h', '1d'].map((tf) => (
                <option key={tf} value={tf}>{tf}</option>
              ))}
            </select>
            <Button variant="primary" size="sm" loading={mining} onClick={handleMine}>
              Compute
            </Button>
          </div>
          {featureICs.length === 0 ? (
            <p className="text-muted">Select a timeframe and click Compute to rank features by IC.</p>
          ) : (
            <div>
              {/* IC bar chart (SVG) */}
              <svg width="100%" viewBox="0 0 600 200" style={{ display: 'block', marginBottom: 'var(--space-4)' }}>
                {featureICs.slice(0, 15).map((f, i) => {
                  const BAR_H = 11
                  const GAP   = 2
                  const y     = i * (BAR_H + GAP)
                  const maxIC = Math.max(...featureICs.slice(0, 15).map((ff) => Math.abs(ff.ic)), 0.01)
                  const W     = (Math.abs(f.ic) / maxIC) * 300
                  const color = f.ic >= 0 ? 'var(--color-bull)' : 'var(--color-bear)'
                  return (
                    <g key={f.key}>
                      <text x={0} y={y + BAR_H - 1} fontSize={9} fill="var(--color-muted)" fontFamily="monospace">
                        {f.key.slice(0, 18)}
                      </text>
                      <rect x={148} y={y} width={W} height={BAR_H} rx={2} fill={color} fillOpacity={0.7} />
                      <text x={150 + W} y={y + BAR_H - 1} fontSize={9} fill="var(--color-muted)">
                        {f.ic.toFixed(3)} (p={f.pvalue.toFixed(3)})
                      </text>
                    </g>
                  )
                })}
              </svg>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
