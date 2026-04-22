'use client'

/**
 * DataWindowPicker
 * Replaces the raw `train_window` number input in AgentBuilder Step 3.
 * Fetches available bar counts from the backend and lets the user choose
 * a training window via presets or a custom number — then calls onChange(bars).
 */

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

interface TFInfo {
  bar_count: number
  date_from: string | null
  date_to:   string | null
  coverage:  number
}

interface Props {
  timeframe: string
  value:     number            // current train_window (bars)
  modelType?: string
  onChange:  (bars: number) => void
}

// Approximate bars per period at each timeframe
const BARS_PER_PERIOD: Record<string, Record<string, number>> = {
  '5m':  { '3mo': 16_200, '6mo': 32_400, '1yr': 64_800, '2yr': 129_600 },
  '15m': { '3mo':  5_400, '6mo': 10_800, '1yr': 21_600, '2yr':  43_200 },
  '30m': { '3mo':  2_700, '6mo':  5_400, '1yr': 10_800, '2yr':  21_600 },
  '1h':  { '3mo':  1_350, '6mo':  2_700, '1yr':  5_400, '2yr':  10_800 },
  '2h':  { '3mo':    675, '6mo':  1_350, '1yr':  2_700, '2yr':   5_400 },
  '4h':  { '3mo':    337, '6mo':    675, '1yr':  1_350, '2yr':   2_700 },
  '1d':  { '3mo':     65, '6mo':    130, '1yr':    260, '2yr':     520 },
}

// Minimum bars recommendation per model type
const MIN_BARS: Record<string, number> = {
  xgboost: 300,
  lgbm:    300,
  logreg:  200,
}

function coverageColor(pct: number) {
  if (pct >= 85) return 'var(--color-bull)'
  if (pct >= 60) return '#f59e0b'
  return 'var(--color-bear)'
}

function qualityLabel(pct: number) {
  if (pct >= 85) return { label: 'Excellent', color: 'var(--color-bull)' }
  if (pct >= 60) return { label: 'Good', color: '#f59e0b' }
  return { label: 'Sparse', color: 'var(--color-bear)' }
}

function fmtBars(n: number) { return n.toLocaleString() }

export default function DataWindowPicker({ timeframe, value, modelType = 'xgboost', onChange }: Props) {
  const [info,    setInfo]    = useState<TFInfo | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.historicalImport.summary().then(summary => {
      if (!cancelled) {
        setInfo((summary[timeframe] ?? null) as TFInfo | null)
        setLoading(false)
      }
    }).catch(() => setLoading(false))
    return () => { cancelled = true }
  }, [timeframe])

  const periods = BARS_PER_PERIOD[timeframe] ?? {}
  const available = info?.bar_count ?? 0
  const minRec = MIN_BARS[modelType] ?? 300

  const setPreset = (key: string) => {
    if (key === 'all') {
      onChange(available || value)
      return
    }
    const bars = Math.min(periods[key] ?? value, available || 99999)
    onChange(Math.max(bars, 50))
  }

  const quality = info ? qualityLabel(info.coverage) : null

  return (
    <div style={{ background: 'var(--color-surface-2)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
        <div>
          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Training Data — XAUUSD / {timeframe}
          </div>
          {info && info.date_from && (
            <div style={{ fontSize: '0.65rem', color: 'var(--color-muted)', marginTop: 2 }}>
              Available: {info.date_from} → {info.date_to}
            </div>
          )}
        </div>
        {quality && (
          <span style={{
            fontSize: '0.65rem', fontWeight: 700,
            padding: '2px 8px', borderRadius: 12,
            background: `${quality.color}22`,
            color: quality.color,
          }}>
            {quality.label} ({info?.coverage}%)
          </span>
        )}
      </div>

      {loading && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>Checking available data…</div>
      )}

      {!loading && available === 0 && (
        <div style={{
          fontSize: 'var(--text-xs)', color: '#f59e0b',
          background: 'oklch(72% 0.14 85 / 0.08)',
          border: '1px solid oklch(72% 0.14 85 / 0.2)',
          borderRadius: 'var(--radius-sm)', padding: 'var(--space-2)',
          marginBottom: 'var(--space-3)',
        }}>
          ⚠ No {timeframe} data found. Go to the <strong>Data</strong> tab to import historical data first.
          Without data, training will fail or use very limited yfinance bars (60-day cap).
        </div>
      )}

      {!loading && available > 0 && (
        <>
          {/* Coverage bar */}
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: '0.65rem', color: 'var(--color-muted)' }}>
              <span>{fmtBars(available)} bars available</span>
              <span>Coverage: <span style={{ color: coverageColor(info?.coverage ?? 0) }}>{info?.coverage}%</span></span>
            </div>
            <div style={{ height: 4, background: 'var(--color-border)', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
              <div style={{ height: '100%', width: `${info?.coverage ?? 0}%`, background: coverageColor(info?.coverage ?? 0), borderRadius: 2 }} />
            </div>
            {/* Selection bar: show selected / available */}
            <div style={{ height: 4, background: 'var(--color-border)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${Math.min(value / available, 1) * 100}%`,
                background: 'var(--color-gold)',
                borderRadius: 2,
              }} />
            </div>
            <div style={{ fontSize: '0.6rem', color: 'var(--color-muted)', marginTop: 3, textAlign: 'right' }}>
              Selected: {fmtBars(Math.min(value, available))} bars (gold bar above)
            </div>
          </div>

          {/* Presets */}
          <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap', marginBottom: 'var(--space-2)' }}>
            <button className="btn btn--ghost btn--sm" onClick={() => setPreset('all')} style={{ fontSize: '0.65rem' }}>
              All ({fmtBars(available)})
            </button>
            {(['2yr', '1yr', '6mo', '3mo'] as const).filter(k => periods[k] <= available).map(k => (
              <button key={k} className="btn btn--ghost btn--sm" onClick={() => setPreset(k)} style={{ fontSize: '0.65rem' }}>
                Last {k.replace('mo', ' mo').replace('yr', ' yr')} (~{fmtBars(periods[k])})
              </button>
            ))}
          </div>
        </>
      )}

      {/* Manual input */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <label className="field-label" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>Training window (bars):</label>
        <input
          type="number"
          className="input"
          min={50}
          max={available || 100000}
          value={value}
          onChange={e => onChange(Math.max(50, parseInt(e.target.value) || 500))}
          style={{ width: 90 }}
        />
        {available > 0 && (
          <span style={{ fontSize: '0.65rem', color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
            / {fmtBars(available)} available
          </span>
        )}
      </div>

      {/* Warnings */}
      {value < minRec && (
        <div style={{ marginTop: 'var(--space-2)', fontSize: '0.65rem', color: '#f59e0b' }}>
          ⚠ {value} bars is below the recommended minimum of {minRec} for {modelType}. The model may underfit.
        </div>
      )}
      {available > 0 && value > available && (
        <div style={{ marginTop: 'var(--space-2)', fontSize: '0.65rem', color: '#f59e0b' }}>
          ⚠ Only {fmtBars(available)} bars available — effective window will be capped.
        </div>
      )}
    </div>
  )
}
