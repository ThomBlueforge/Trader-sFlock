'use client'

import { useMemo } from 'react'
import { fmtDateMs, fmtCompact } from '@/lib/formatters'

interface EquityPoint {
  ts: number
  equity: number
}

interface EquityCurveProps {
  equity: EquityPoint[]
  height?: number
  color?: string
  label?: string
}

export default function EquityCurve({
  equity,
  height = 200,
  color,
  label,
}: EquityCurveProps) {
  const { pathD, fillD, yLabels, xLabels, isUp, minE, maxE } = useMemo(() => {
    if (equity.length < 2) {
      return { pathD: '', fillD: '', yLabels: [], xLabels: [], isUp: true, minE: 0, maxE: 0 }
    }

    const W = 600
    const H = height - 40  // reserve for x-axis labels
    const LABEL_W = 60

    const minE = Math.min(...equity.map((p) => p.equity))
    const maxE = Math.max(...equity.map((p) => p.equity))
    const eRange = maxE - minE || 1

    const minTs = equity[0].ts
    const maxTs = equity[equity.length - 1].ts
    const tsRange = maxTs - minTs || 1

    const toX = (ts: number) => LABEL_W + ((ts - minTs) / tsRange) * (W - LABEL_W)
    const toY = (e: number) => H - ((e - minE) / eRange) * (H - 4)

    const pts = equity.map((p) => `${toX(p.ts)},${toY(p.equity)}`).join(' ')
    const pathD = `M ${pts.split(' ').join(' L ')}`

    // Closed fill path
    const lastX = toX(equity[equity.length - 1].ts)
    const firstX = toX(equity[0].ts)
    const fillD = `${pathD} L ${lastX},${H} L ${firstX},${H} Z`

    const isUp = equity[equity.length - 1].equity >= equity[0].equity
    const lineColor = color ?? (isUp ? 'var(--color-bull)' : 'var(--color-bear)')

    // Y labels
    const yLabels = [minE, (minE + maxE) / 2, maxE].map((v) => ({
      label: `$${fmtCompact(v)}`,
      y: toY(v),
    }))

    // X labels (3 evenly spaced)
    const xIndices = [0, Math.floor(equity.length / 2), equity.length - 1]
    const xLabels = xIndices.map((i) => ({
      label: fmtDateMs(equity[i].ts),
      x: toX(equity[i].ts),
    }))

    return { pathD, fillD, yLabels, xLabels, isUp, minE, maxE, lineColor }
  }, [equity, height, color])

  if (equity.length < 2) {
    return (
      <div
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-muted)',
          fontSize: 'var(--text-sm)',
          background: 'var(--color-surface-2)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        No equity data yet — run the agent to generate trades.
      </div>
    )
  }

  const lineColor = color ?? (isUp ? 'var(--color-bull)' : 'var(--color-bear)')
  const H = height - 40

  return (
    <div>
      {label && (
        <p
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-muted)',
            marginBottom: 'var(--space-2)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          {label}
        </p>
      )}
      <svg
        width="100%"
        viewBox={`0 0 660 ${height}`}
        style={{ overflow: 'visible', display: 'block' }}
      >
        {/* Horizontal grid lines */}
        {yLabels.map((l) => (
          <g key={l.label}>
            <line
              x1={60}
              y1={l.y}
              x2={600}
              y2={l.y}
              stroke="var(--color-border)"
              strokeWidth={0.5}
              strokeDasharray="4 4"
            />
            <text
              x={56}
              y={l.y + 4}
              textAnchor="end"
              fill="var(--color-muted)"
              fontSize={10}
              fontFamily="var(--font-mono), monospace"
            >
              {l.label}
            </text>
          </g>
        ))}

        {/* Fill area */}
        <path d={fillD} fill={lineColor} fillOpacity={0.07} />

        {/* Equity line */}
        <path
          d={pathD}
          fill="none"
          stroke={lineColor}
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* X-axis labels */}
        {xLabels.map((l) => (
          <text
            key={l.label}
            x={l.x}
            y={H + 24}
            textAnchor="middle"
            fill="var(--color-muted)"
            fontSize={10}
          >
            {l.label}
          </text>
        ))}
      </svg>
    </div>
  )
}
