'use client'

import { useEffect, useState } from 'react'
import type { Agent } from '@/types'
import { api } from '@/lib/api'
import { fmtDateMs, fmtPct } from '@/lib/formatters'

interface EquityPoint { ts: number; equity: number }

interface AgentEquity {
  agent: Agent
  equity: EquityPoint[]
}

interface AgentComparisonProps {
  agents: Agent[]
  height?: number
}

export default function AgentComparison({ agents, height = 240 }: AgentComparisonProps) {
  const [data, setData] = useState<AgentEquity[]>([])

  useEffect(() => {
    const active = agents.filter((a) => a.status === 'active')
    Promise.all(
      active.map((a) =>
        api.portfolio
          .equity(a.id)
          .then((eq) => ({ agent: a, equity: eq }))
          .catch(() => ({ agent: a, equity: [] })),
      ),
    ).then(setData)
  }, [agents])

  const withData = data.filter((d) => d.equity.length >= 2)

  if (withData.length === 0) {
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
        Activate multiple agents to compare equity curves.
      </div>
    )
  }

  const W = 600, H = height - 40, LABEL_W = 60

  // Normalise all curves to 1.0 starting capital for comparison
  const allTs = withData.flatMap((d) => d.equity.map((p) => p.ts))
  const minTs  = Math.min(...allTs)
  const maxTs  = Math.max(...allTs)
  const tsRange = maxTs - minTs || 1

  const toX = (ts: number) => LABEL_W + ((ts - minTs) / tsRange) * (W - LABEL_W)

  return (
    <div>
      {/* Legend */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-3)',
        }}
      >
        {withData.map(({ agent, equity }) => {
          const ret = equity[equity.length - 1].equity / equity[0].equity - 1
          return (
            <div
              key={agent.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                fontSize: 'var(--text-xs)',
              }}
            >
              <span
                style={{
                  width: 12,
                  height: 3,
                  borderRadius: 2,
                  background: agent.color,
                  display: 'inline-block',
                }}
              />
              <span style={{ color: 'var(--color-text)' }}>{agent.name}</span>
              <span
                style={{ color: ret >= 0 ? 'var(--color-bull)' : 'var(--color-bear)', fontWeight: 600 }}
              >
                {fmtPct(ret)}
              </span>
            </div>
          )
        })}
      </div>

      <svg width="100%" viewBox={`0 0 660 ${height}`} style={{ overflow: 'visible', display: 'block' }}>
        {/* Horizontal grid */}
        {[0.25, 0.5, 0.75, 1.0].map((frac) => {
          const y = H - frac * (H - 4)
          return (
            <line
              key={frac}
              x1={LABEL_W}
              y1={y}
              x2={W}
              y2={y}
              stroke="var(--color-border)"
              strokeWidth={0.5}
              strokeDasharray="4 4"
            />
          )
        })}

        {/* Each agent equity curve (normalised to initial capital = 1) */}
        {withData.map(({ agent, equity }) => {
          const base = equity[0].equity
          const allEq = equity.map((p) => p.equity / base)
          const minV  = Math.min(...allEq)
          const maxV  = Math.max(...allEq)
          const vRange = maxV - minV || 0.01
          const toY = (v: number) => H - ((v - minV) / vRange) * (H - 4)

          const pts = equity
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.ts)},${toY(p.equity / base)}`)
            .join(' ')

          return (
            <path
              key={agent.id}
              d={pts}
              fill="none"
              stroke={agent.color}
              strokeWidth={2}
              strokeLinejoin="round"
            />
          )
        })}

        {/* X-axis labels */}
        {[minTs, (minTs + maxTs) / 2, maxTs].map((ts) => (
          <text
            key={ts}
            x={toX(ts)}
            y={H + 24}
            textAnchor="middle"
            fill="var(--color-muted)"
            fontSize={10}
          >
            {fmtDateMs(ts)}
          </text>
        ))}
      </svg>
    </div>
  )
}
