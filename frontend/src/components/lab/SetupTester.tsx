'use client'

import { useCallback, useState } from 'react'
import type { Agent, WSEvent } from '@/types'
import { api } from '@/lib/api'
import { useSignalSocket } from '@/hooks/useSignalSocket'
import { useClaudeAgent } from '@/hooks/useClaudeAgent'
import { fmtPct, fmtPrice, fmtDateTimeSec } from '@/lib/formatters'
import EquityCurve from '@/components/portfolio/EquityCurve'
import Button from '@/components/ui/Button'

// ── Timeframe helpers ─────────────────────────────────────────────────────────

const TF_MINUTES: Record<string, number> = {
  '5m': 5, '15m': 15, '30m': 30, '1h': 60, '2h': 120, '4h': 240, '1d': 1440,
}

function barsToMinutes(bars: number, tf: string): string {
  const mins = bars * (TF_MINUTES[tf] ?? 60)
  if (mins < 60)  return `${mins}m`
  if (mins < 1440) return `${(mins / 60).toFixed(1)}h`
  return `${(mins / 1440).toFixed(1)}d`
}

// ── Slider helper ─────────────────────────────────────────────────────────────

function Slider({
  label, value, min, max, step, onChange, display,
}: {
  label: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; display: string
}) {
  return (
    <div className="field">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
        <span className="field-label" style={{ marginBottom: 0 }}>{label}</span>
        <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'monospace', color: 'var(--color-gold)' }}>
          {display}
        </span>
      </div>
      <input type="range" className="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  )
}

// ── Claude config helper ──────────────────────────────────────────────────────

function ClaudeSetupChat({ agent, onApply }: { agent: Agent; onApply: (cfg: SetupConfig) => void }) {
  const [input, setInput] = useState('')
  const [visible, setVisible] = useState(false)

  const { messages, streaming, send } = useClaudeAgent((config: any) => {
    if (config.setup) onApply(config.setup as SetupConfig)
  })

  const handleSend = async () => {
    if (!input.trim() || streaming) return
    const text = input.trim()
    setInput('')
    // Inject context about the agent before sending
    const enriched = `[Agent: ${agent.name}, TF: ${agent.timeframe}]\n${text}`
    await send(enriched)
  }

  if (!visible) {
    return (
      <button
        className="btn btn--ghost btn--sm"
        onClick={() => setVisible(true)}
        style={{ marginBottom: 'var(--space-4)' }}
      >
        ✨ Ask Claude to configure this setup
      </button>
    )
  }

  return (
    <div
      style={{
        background: 'oklch(72% 0.14 85 / 0.05)',
        border: '1px solid oklch(72% 0.14 85 / 0.2)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-4)',
        marginBottom: 'var(--space-4)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-gold)' }}>
          ✨ Claude Setup Assistant
        </span>
        <button className="btn btn--ghost btn--sm" onClick={() => setVisible(false)}>✕</button>
      </div>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginBottom: 'var(--space-3)' }}>
        Describe the setup you want to test. Claude will configure the parameters below.
        Example: <em>"Test a 30-minute scalp with tight 0.3% stop and 0.6% target on 2023 data"</em>
      </p>

      {/* Chat history */}
      <div style={{ maxHeight: 160, overflowY: 'auto', marginBottom: 'var(--space-3)' }}>
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              marginBottom: 'var(--space-2)',
              textAlign: m.role === 'user' ? 'right' : 'left',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                background: m.role === 'user' ? 'var(--color-gold)' : 'var(--color-surface-2)',
                color: m.role === 'user' ? '#0e0f14' : 'var(--color-text)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-1) var(--space-2)',
                fontSize: 'var(--text-xs)',
                maxWidth: '90%',
                whiteSpace: 'pre-wrap',
              }}
            >
              {m.content.replace(/```config_json[\s\S]*?```/g, '[config applied]') || '…'}
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <input
          className="input"
          placeholder="Describe your setup…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          disabled={streaming}
          style={{ flex: 1 }}
        />
        <Button size="sm" loading={streaming} onClick={handleSend} disabled={!input.trim()}>
          Send
        </Button>
      </div>
    </div>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface SetupConfig {
  hold_bars:         number
  stop_loss_pct:     number
  take_profit_pct:   number
  start_date?:       string
  end_date?:         string
  min_confidence:    number
  position_size_pct: number
}

interface SetupResult {
  config:      SetupConfig
  metrics:     Record<string, number>
  equity_curve: { ts: number; equity: number }[]
  trades:      Record<string, unknown>[]
}

interface SweepRow {
  hold_bars:       number
  stop_loss_pct:   number
  take_profit_pct: number
  sharpe?:         number
  win_rate?:       number
  profit_factor?:  number
  n_trades?:       number
  tp_hit_rate?:    number
  sl_hit_rate?:    number
  error?:          string
}

// ── Main component ────────────────────────────────────────────────────────────

interface SetupTesterProps {
  agent: Agent
}

export default function SetupTester({ agent }: SetupTesterProps) {
  const tf = agent.timeframe

  // Form state — every parameter is individually controllable
  const [holdBars,     setHoldBars]     = useState(6)
  const [slPct,        setSlPct]        = useState(0.5)   // stored as %, converted to decimal on submit
  const [tpPct,        setTpPct]        = useState(1.0)
  const [minConf,      setMinConf]      = useState(0.0)
  const [posSizePct,   setPosSizePct]   = useState(10)   // stored as %, converted on submit
  const [startDate,    setStartDate]    = useState('')
  const [endDate,      setEndDate]      = useState('')

  const [running,  setRunning]  = useState(false)
  const [sweeping, setSweeping] = useState(false)
  const [result,   setResult]   = useState<SetupResult | null>(null)
  const [sweep,    setSweep]    = useState<SweepRow[]>([])
  const [error,    setError]    = useState('')
  const [tab,      setTab]      = useState<'single' | 'sweep'>('single')

  // Claude auto-fill handler
  const handleClaudeConfig = useCallback((cfg: SetupConfig) => {
    if (cfg.hold_bars)         setHoldBars(cfg.hold_bars)
    if (cfg.stop_loss_pct)     setSlPct(cfg.stop_loss_pct * 100)
    if (cfg.take_profit_pct)   setTpPct(cfg.take_profit_pct * 100)
    if (cfg.min_confidence)    setMinConf(cfg.min_confidence)
    if (cfg.position_size_pct) setPosSizePct(cfg.position_size_pct * 100)
    if (cfg.start_date)        setStartDate(cfg.start_date)
    if (cfg.end_date)          setEndDate(cfg.end_date)
  }, [])

  const buildBody = () => ({
    hold_bars:         holdBars,
    stop_loss_pct:     slPct / 100,
    take_profit_pct:   tpPct / 100,
    min_confidence:    minConf,
    position_size_pct: posSizePct / 100,
    start_date:        startDate || undefined,
    end_date:          endDate   || undefined,
  })

  const handleRun = async () => {
    setRunning(true)
    setError('')
    setResult(null)
    try {
      const r = await api.training.setupTest(agent.id, buildBody()) as unknown as SetupResult
      setResult(r)
    } catch (err) {
      setError(String(err))
    } finally {
      setRunning(false)
    }
  }

  const handleSweep = async () => {
    setSweeping(true)
    setError('')
    setSweep([])
    try {
      const rows = await api.training.setupSweep(agent.id, {
        hold_bars_list: [3, 6, 12, 24],
        sl_pcts:        [0.002, 0.005, 0.008, 0.012],
        tp_pcts:        [0.005, 0.010, 0.015, 0.020],
        start_date:     startDate || undefined,
        end_date:       endDate   || undefined,
      }) as SweepRow[]
      setSweep(rows)
    } catch (err) {
      setError(String(err))
    } finally {
      setSweeping(false)
    }
  }

  const m = result?.metrics ?? {}

  const STAT_ITEMS = [
    { label: 'Total Return',   value: m.total_return   != null ? fmtPct(m.total_return)              : '—', color: m.total_return   >= 0 ? 'var(--color-bull)' : 'var(--color-bear)' },
    { label: 'Sharpe',         value: m.sharpe         != null ? m.sharpe.toFixed(2)                 : '—', color: m.sharpe          >= 0 ? 'var(--color-bull)' : 'var(--color-bear)' },
    { label: 'Win Rate',       value: m.win_rate       != null ? fmtPct(m.win_rate, 1, false)        : '—', color: 'var(--color-text)' },
    { label: 'Profit Factor',  value: m.profit_factor  != null ? m.profit_factor.toFixed(2)          : '—', color: m.profit_factor  >= 1 ? 'var(--color-bull)' : 'var(--color-bear)' },
    { label: 'Max Drawdown',   value: m.max_drawdown   != null ? fmtPct(m.max_drawdown)              : '—', color: 'var(--color-bear)' },
    { label: 'Trades',         value: m.n_trades       != null ? String(m.n_trades)                  : '—', color: 'var(--color-text)' },
    { label: 'TP Hit Rate',    value: m.tp_hit_rate    != null ? fmtPct(m.tp_hit_rate, 1, false)     : '—', color: 'var(--color-bull)' },
    { label: 'SL Hit Rate',    value: m.sl_hit_rate    != null ? fmtPct(m.sl_hit_rate, 1, false)     : '—', color: 'var(--color-bear)' },
    { label: 'Time Exit Rate', value: m.time_exit_rate != null ? fmtPct(m.time_exit_rate, 1, false)  : '—', color: 'var(--color-muted)' },
  ]

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-6)' }}>
        <button className={`btn btn--sm ${tab === 'single' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setTab('single')}>
          Single Test
        </button>
        <button className={`btn btn--sm ${tab === 'sweep' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setTab('sweep')}>
          Auto Sweep
        </button>
      </div>

      {/* Claude assistant */}
      <ClaudeSetupChat agent={agent} onApply={handleClaudeConfig} />

      {/* Configuration panel */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-4)',
        }}
      >
        {/* Left column */}
        <div>
          <Slider
            label={`Hold Duration — ${barsToMinutes(holdBars, tf)} (${holdBars} bars)`}
            value={holdBars}
            min={1} max={48} step={1}
            onChange={setHoldBars}
            display={barsToMinutes(holdBars, tf)}
          />
          <Slider
            label="Stop Loss"
            value={slPct}
            min={0.1} max={3.0} step={0.1}
            onChange={setSlPct}
            display={`${slPct.toFixed(1)}%`}
          />
          <Slider
            label="Take Profit"
            value={tpPct}
            min={0.1} max={5.0} step={0.1}
            onChange={setTpPct}
            display={`${tpPct.toFixed(1)}%`}
          />
          {tpPct <= slPct && (
            <p style={{ color: 'var(--color-bear)', fontSize: 'var(--text-xs)', marginTop: '-var(--space-2)' }}>
              ⚠ Take profit must be greater than stop loss
            </p>
          )}
        </div>

        {/* Right column */}
        <div>
          <Slider
            label="Min Confidence Filter"
            value={minConf * 100}
            min={50} max={90} step={1}
            onChange={(v) => setMinConf(v / 100)}
            display={minConf === 0 ? 'Off' : `${(minConf * 100).toFixed(0)}%`}
          />
          <Slider
            label="Position Size"
            value={posSizePct}
            min={1} max={50} step={1}
            onChange={setPosSizePct}
            display={`${posSizePct.toFixed(0)}%`}
          />

          {/* Date range */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
            <div className="field">
              <label className="field-label">From (optional)</label>
              <input
                type="date"
                className="input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label">To (optional)</label>
              <input
                type="date"
                className="input"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* R:R ratio display */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          padding: 'var(--space-3) var(--space-4)',
          background: 'var(--color-surface-2)',
          borderRadius: 'var(--radius-md)',
          marginBottom: 'var(--space-4)',
          fontSize: 'var(--text-sm)',
        }}
      >
        <span className="text-muted">Risk:Reward</span>
        <span style={{ fontWeight: 700, color: tpPct / slPct >= 2 ? 'var(--color-bull)' : tpPct / slPct >= 1 ? 'var(--color-gold)' : 'var(--color-bear)' }}>
          1:{(tpPct / slPct).toFixed(2)}
        </span>
        <span className="text-muted" style={{ marginLeft: 'auto' }}>
          Agent: {agent.name} · {agent.timeframe} · {agent.model_type}
        </span>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
        {tab === 'single' ? (
          <Button
            variant="primary"
            loading={running}
            onClick={handleRun}
            disabled={tpPct <= slPct}
          >
            Run Setup Test
          </Button>
        ) : (
          <Button
            variant="primary"
            loading={sweeping}
            onClick={handleSweep}
          >
            Run Auto Sweep (4×4×4 grid)
          </Button>
        )}
        {(result || sweep.length > 0) && (
          <Button variant="ghost" onClick={() => { setResult(null); setSweep([]) }}>
            Clear
          </Button>
        )}
      </div>

      {error && (
        <p style={{ color: 'var(--color-bear)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>
          {error}
        </p>
      )}

      {/* ── Single test results ─────────────────────────────────────────────── */}
      {tab === 'single' && result && (
        <div>
          {/* Metric grid */}
          <div className="stat-grid" style={{ marginBottom: 'var(--space-6)' }}>
            {STAT_ITEMS.filter(s => s.value !== '—').map((s) => (
              <div key={s.label} className="stat-box">
                <div className="stat-label">{s.label}</div>
                <div className="stat-value" style={{ color: s.color, fontSize: 'var(--text-base)' }}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>

          {/* Equity curve */}
          {result.equity_curve.length > 1 && (
            <div style={{ marginBottom: 'var(--space-6)' }}>
              <h4 style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Equity Curve
              </h4>
              <EquityCurve equity={result.equity_curve} height={200} />
            </div>
          )}

          {/* Trade log */}
          {result.trades.length > 0 && (
            <div>
              <h4 style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Trades (last {result.trades.length})
              </h4>
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Signal</th>
                      <th>Conf</th>
                      <th>Entry</th>
                      <th>Exit</th>
                      <th>Exit Via</th>
                      <th>Bars</th>
                      <th>Return</th>
                      <th>PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(result.trades as any[]).slice(-50).reverse().map((t, i) => {
                      const isWin = (t.pnl ?? 0) > 0
                      return (
                        <tr key={i}>
                          <td>
                            <span style={{ color: t.signal === 'BULL' ? 'var(--color-bull)' : 'var(--color-bear)', fontWeight: 600, fontSize: 'var(--text-xs)' }}>
                              {t.signal === 'BULL' ? '▲' : '▼'} {t.signal}
                            </span>
                          </td>
                          <td className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
                            {(t.confidence * 100).toFixed(0)}%
                          </td>
                          <td className="mono">{fmtPrice(t.entry_price)}</td>
                          <td className="mono">{fmtPrice(t.exit_price)}</td>
                          <td>
                            <span
                              style={{
                                fontSize: 'var(--text-xs)',
                                fontWeight: 700,
                                color: t.exit_reason === 'tp' ? 'var(--color-bull)'
                                     : t.exit_reason === 'sl' ? 'var(--color-bear)'
                                     : 'var(--color-muted)',
                              }}
                            >
                              {t.exit_reason === 'tp' ? '✓TP' : t.exit_reason === 'sl' ? '✗SL' : '⏱Time'}
                            </span>
                          </td>
                          <td className="mono" style={{ color: 'var(--color-muted)', fontSize: 'var(--text-xs)' }}>
                            {t.bars_held}
                          </td>
                          <td className="mono" style={{ color: isWin ? 'var(--color-bull)' : 'var(--color-bear)', fontSize: 'var(--text-xs)' }}>
                            {(t.return_pct >= 0 ? '+' : '')}{(t.return_pct * 100).toFixed(3)}%
                          </td>
                          <td className="mono" style={{ color: isWin ? 'var(--color-bull)' : 'var(--color-bear)', fontWeight: 600 }}>
                            {(t.pnl >= 0 ? '+' : '')}{fmtPrice(t.pnl)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Sweep results ────────────────────────────────────────────────────── */}
      {tab === 'sweep' && sweep.length > 0 && (
        <div>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginBottom: 'var(--space-3)' }}>
            {sweep.filter(r => !r.error).length} combinations tested — sorted by Sharpe.
            Click a row to load those parameters.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Hold</th>
                  <th>SL</th>
                  <th>TP</th>
                  <th>R:R</th>
                  <th>Sharpe</th>
                  <th>Win Rate</th>
                  <th>Profit Factor</th>
                  <th>TP Rate</th>
                  <th>SL Rate</th>
                  <th>Trades</th>
                </tr>
              </thead>
              <tbody>
                {sweep.filter(r => !r.error).map((r, i) => (
                  <tr
                    key={i}
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      setHoldBars(r.hold_bars)
                      setSlPct(r.stop_loss_pct * 100)
                      setTpPct(r.take_profit_pct * 100)
                      setTab('single')
                    }}
                  >
                    <td style={{ fontWeight: 600 }}>
                      {barsToMinutes(r.hold_bars, tf)}
                    </td>
                    <td className="mono" style={{ color: 'var(--color-bear)' }}>
                      {(r.stop_loss_pct * 100).toFixed(2)}%
                    </td>
                    <td className="mono" style={{ color: 'var(--color-bull)' }}>
                      {(r.take_profit_pct * 100).toFixed(2)}%
                    </td>
                    <td className="mono" style={{ color: r.take_profit_pct / r.stop_loss_pct >= 2 ? 'var(--color-bull)' : 'var(--color-muted)' }}>
                      1:{(r.take_profit_pct / r.stop_loss_pct).toFixed(1)}
                    </td>
                    <td className="mono" style={{ color: (r.sharpe ?? 0) >= 0 ? 'var(--color-bull)' : 'var(--color-bear)', fontWeight: 700 }}>
                      {r.sharpe?.toFixed(2) ?? '—'}
                    </td>
                    <td className="mono">{r.win_rate != null ? fmtPct(r.win_rate, 1, false) : '—'}</td>
                    <td className="mono" style={{ color: (r.profit_factor ?? 0) >= 1 ? 'var(--color-bull)' : 'var(--color-bear)' }}>
                      {r.profit_factor?.toFixed(2) ?? '—'}
                    </td>
                    <td className="mono" style={{ color: 'var(--color-bull)' }}>
                      {r.tp_hit_rate != null ? fmtPct(r.tp_hit_rate, 1, false) : '—'}
                    </td>
                    <td className="mono" style={{ color: 'var(--color-bear)' }}>
                      {r.sl_hit_rate != null ? fmtPct(r.sl_hit_rate, 1, false) : '—'}
                    </td>
                    <td className="mono">{r.n_trades ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
