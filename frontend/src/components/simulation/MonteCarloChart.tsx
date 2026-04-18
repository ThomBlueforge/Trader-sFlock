'use client'

import { useMemo } from 'react'
import type { MonteCarloResult } from '@/types'
import { fmtPct } from '@/lib/formatters'

interface MonteCarloChartProps {
  result: MonteCarloResult
  height?: number
}

export default function MonteCarloChart({ result, height = 320 }: MonteCarloChartProps) {
  if (!result.actual || result.actual.length < 2) {
    return (
      <div style={{
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        color: 'var(--color-muted)',
        background: 'var(--color-surface-2)',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-sm)',
        textAlign: 'center',
        padding: 'var(--space-6)',
      }}>
        <span style={{ fontSize: '2rem', opacity: 0.3 }}>📊</span>
        <p>No simulation data — the backtest produced too few trades.</p>
        <p style={{ fontSize: 'var(--text-xs)' }}>
          Try: lower the <strong>train_window</strong>, reduce the <strong>target_threshold</strong>,
          or pick a <strong>daily (1d)</strong> agent which has the most historical data.
        </p>
      </div>
    )
  }

  const { paths, W, H } = useMemo(() => {
    const all = [
      ...result.p5.map((p) => p.equity),
      ...result.p95.map((p) => p.equity),
      ...result.actual.map((p) => p.equity),
    ]
    const n    = result.actual.length
    const minV = Math.min(...all)
    const maxV = Math.max(...all)
    const rng  = maxV - minV || 1

    const W = 600
    const H = height - 40

    const toX = (i: number) => (i / Math.max(n - 1, 1)) * W
    const toY = (v: number) => H - ((v - minV) / rng) * (H - 4)

    const makePath = (pts: { equity: number }[]) =>
      pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(p.equity)}`).join(' ')

    const makeFill = (lo: { equity: number }[], hi: { equity: number }[]) => {
      const top  = hi.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(p.equity)}`).join(' ')
      const bot  = [...lo].reverse().map((p, i) => `L${toX(lo.length - 1 - i)},${toY(p.equity)}`).join(' ')
      return `${top} ${bot} Z`
    }

    return {
      paths: {
        fill_p5_p95:  makeFill(result.p5,  result.p95),
        fill_p25_p75: makeFill(result.p25, result.p75),
        p5:     makePath(result.p5),
        p95:    makePath(result.p95),
        p50:    makePath(result.p50),
        actual: makePath(result.actual),
      },
      W, H,
    }
  }, [result, height])

  return (
    <div>
      {/* Stats */}
      <div style={{ display: 'flex', gap: 'var(--space-4)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div className="stat-box">
          <div className="stat-label">Prob. Ruin</div>
          <div className="stat-value" style={{ color: result.prob_ruin > 0.1 ? 'var(--color-bear)' : 'var(--color-bull)' }}>
            {fmtPct(result.prob_ruin, 1, false)}
          </div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Sharpe p-value</div>
          <div className="stat-value" style={{ color: result.sharpe_pvalue < 0.05 ? 'var(--color-bull)' : 'var(--color-muted)' }}>
            {result.sharpe_pvalue.toFixed(3)}
          </div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Signal</div>
          <div className="stat-value" style={{ fontSize: 'var(--text-base)', color: result.sharpe_pvalue < 0.05 ? 'var(--color-bull)' : 'var(--color-bear)' }}>
            {result.sharpe_pvalue < 0.05 ? 'Significant' : 'Not significant'}
          </div>
        </div>
      </div>

      <svg width="100%" viewBox={`0 0 ${W} ${height}`} style={{ display: 'block', overflow: 'visible' }}>
        {/* p5-p95 fill */}
        <path d={paths.fill_p5_p95}  fill="var(--color-gold)" fillOpacity={0.06} />
        {/* p25-p75 fill */}
        <path d={paths.fill_p25_p75} fill="var(--color-gold)" fillOpacity={0.12} />
        {/* Median */}
        <path d={paths.p50}   fill="none" stroke="var(--color-gold-dim)" strokeWidth={1.5} strokeDasharray="6 3" />
        {/* p5 / p95 bounds */}
        <path d={paths.p5}    fill="none" stroke="var(--color-bear)" strokeWidth={1} strokeOpacity={0.5} />
        <path d={paths.p95}   fill="none" stroke="var(--color-bull)" strokeWidth={1} strokeOpacity={0.5} />
        {/* Actual equity curve */}
        <path d={paths.actual} fill="none" stroke="var(--color-gold)" strokeWidth={2.5} />

        {/* Legend */}
        <g fontSize={10} fill="var(--color-muted)">
          <rect x={4} y={H + 16} width={12} height={3} fill="var(--color-gold)" />
          <text x={20} y={H + 21}>Actual</text>
          <rect x={70} y={H + 16} width={12} height={3} fill="var(--color-gold-dim)" />
          <text x={86} y={H + 21}>Median</text>
          <rect x={140} y={H + 14} width={12} height={8} fill="var(--color-gold)" fillOpacity={0.15} />
          <text x={156} y={H + 21}>p5-p95</text>
        </g>
      </svg>
    </div>
  )
}
