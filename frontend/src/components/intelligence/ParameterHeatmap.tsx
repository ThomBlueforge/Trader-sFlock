'use client'

import { useMemo } from 'react'
import type { SweepCell } from '@/types'

interface ParameterHeatmapProps {
  cells:      SweepCell[]
  onSelect?:  (cell: SweepCell) => void
}

const REGIME_COLORS: Record<string, string> = {
  LOW:  'oklch(65% 0.18 145)',
  MED:  'oklch(72% 0.14 85)',
  HIGH: 'oklch(60% 0.20 25)',
}

export default function ParameterHeatmap({ cells, onSelect }: ParameterHeatmapProps) {
  const { horizons, thresholds, grid, minS, maxS } = useMemo(() => {
    const horizons   = Array.from(new Set(cells.map((c) => c.horizon))).sort((a, b) => a - b)
    const thresholds = Array.from(new Set(cells.map((c) => c.threshold))).sort((a, b) => a - b)

    const sharpes = cells.map((c) => c.sharpe ?? -99).filter((s) => s > -99)
    const minS    = Math.min(...sharpes, -1)
    const maxS    = Math.max(...sharpes, 1)

    const grid: Record<string, SweepCell> = {}
    cells.forEach((c) => { grid[`${c.horizon}:${c.threshold}`] = c })

    return { horizons, thresholds, grid, minS, maxS }
  }, [cells])

  if (!cells.length) {
    return (
      <p style={{ color: 'var(--color-muted)', textAlign: 'center', padding: 'var(--space-8)' }}>
        Run a parameter sweep to see results.
      </p>
    )
  }

  const CELL_W = 72
  const CELL_H = 52
  const PAD_L  = 64
  const PAD_T  = 32

  const W = PAD_L + horizons.length   * CELL_W + 8
  const H = PAD_T  + thresholds.length * CELL_H + 8

  function sharpeToColor(s: number | null): string {
    if (s == null) return 'var(--color-border)'
    const t = (s - minS) / Math.max(maxS - minS, 0.01)
    // Green → gold → red gradient
    if (t > 0.5) {
      const r = 1 - (t - 0.5) * 2
      return `oklch(${55 + r * 15}% 0.18 ${85 + (1 - r) * 60})`
    } else {
      const r = t * 2
      return `oklch(${50 + r * 10}% 0.15 ${25 + r * 60})`
    }
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={W} height={H} style={{ display: 'block' }}>
        {/* Horizon labels (x-axis) */}
        {horizons.map((h, xi) => (
          <text
            key={h}
            x={PAD_L + xi * CELL_W + CELL_W / 2}
            y={PAD_T - 8}
            textAnchor="middle"
            fill="var(--color-muted)"
            fontSize={10}
          >
            h={h}
          </text>
        ))}

        {/* Threshold labels (y-axis) */}
        {thresholds.map((t, yi) => (
          <text
            key={t}
            x={PAD_L - 6}
            y={PAD_T + yi * CELL_H + CELL_H / 2 + 4}
            textAnchor="end"
            fill="var(--color-muted)"
            fontSize={10}
          >
            {(t * 100).toFixed(2)}%
          </text>
        ))}

        {/* Cells */}
        {thresholds.map((t, yi) =>
          horizons.map((h, xi) => {
            const cell     = grid[`${h}:${t}`]
            const sharpe   = cell?.sharpe ?? null
            const nTrades  = cell?.n_trades ?? 0
            const tooFew   = nTrades < 5
            const bg       = sharpeToColor(sharpe)
            const x        = PAD_L + xi * CELL_W
            const y        = PAD_T + yi * CELL_H
            const clickable = cell && !cell.error && !tooFew
            return (
              <g
                key={`${h}:${t}`}
                style={{ cursor: clickable ? 'pointer' : 'not-allowed' }}
                onClick={() => clickable && onSelect?.(cell)}
              >
                <rect
                  x={x + 2} y={y + 2}
                  width={CELL_W - 4} height={CELL_H - 4}
                  rx={4}
                  fill={bg}
                  fillOpacity={tooFew ? 0.25 : 0.8}
                />
                {tooFew && (
                  <rect
                    x={x + 2} y={y + 2}
                    width={CELL_W - 4} height={CELL_H - 4}
                    rx={4}
                    fill="none"
                    stroke="rgba(255,255,255,0.15)"
                    strokeWidth={1}
                    strokeDasharray="3 2"
                  />
                )}
                <text
                  x={x + CELL_W / 2} y={y + CELL_H / 2 - 8}
                  textAnchor="middle"
                  fill={tooFew ? 'rgba(255,255,255,0.35)' : 'white'}
                  fontSize={11}
                  fontWeight={700}
                >
                  {sharpe != null ? sharpe.toFixed(2) : cell?.error ? '✗' : '—'}
                </text>
                {cell?.win_rate != null && (
                  <text
                    x={x + CELL_W / 2} y={y + CELL_H / 2 + 4}
                    textAnchor="middle"
                    fill={tooFew ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.7)'}
                    fontSize={9}
                  >
                    WR {(cell.win_rate * 100).toFixed(0)}%
                  </text>
                )}
                <text
                  x={x + CELL_W / 2} y={y + CELL_H / 2 + 15}
                  textAnchor="middle"
                  fill={tooFew ? 'rgba(255,80,80,0.6)' : 'rgba(255,255,255,0.45)'}
                  fontSize={8}
                >
                  {nTrades} trade{nTrades !== 1 ? 's' : ''}{tooFew ? ' ⚠' : ''}
                </text>
              </g>
            )
          })
        )}
      </svg>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginTop: 'var(--space-2)', textAlign: 'center' }}>
        Cell colour = Sharpe ratio. Faded cells (⚠ &lt;5 trades) are statistically unreliable — click a solid cell to load params into the Lab.
      </p>
    </div>
  )
}
