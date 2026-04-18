'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Agent, SignalOut } from '@/types'
import { api } from '@/lib/api'
import { fmtPct, fmtRelative } from '@/lib/formatters'
import SignalBadge from './SignalBadge'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import AgentBuilder from '@/components/lab/AgentBuilder'

interface AgentCardProps {
  agent: Agent
  latestSignal?: SignalOut
  onActivate:   (id: string) => Promise<void>
  onDeactivate: (id: string) => Promise<void>
  onRefresh?:   () => void
}

function Sparkline({ equity }: { equity: { ts: number; equity: number }[] }) {
  const pts = equity.slice(-50)
  if (pts.length < 2) return null

  const W = 120, H = 36
  const minE = Math.min(...pts.map((p) => p.equity))
  const maxE = Math.max(...pts.map((p) => p.equity))
  const range = maxE - minE || 1

  const polyPoints = pts
    .map((p, i) => {
      const x = (i / (pts.length - 1)) * W
      const y = H - ((p.equity - minE) / range) * H
      return `${x},${y}`
    })
    .join(' ')

  const isUp = pts[pts.length - 1].equity >= pts[0].equity
  const stroke = isUp ? 'var(--color-bull)' : 'var(--color-bear)'

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
      <polyline points={polyPoints} fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  )
}

export default function AgentCard({
  agent,
  latestSignal,
  onActivate,
  onDeactivate,
  onRefresh,
}: AgentCardProps) {
  const [equity,      setEquity]      = useState<{ ts: number; equity: number }[]>([])
  const [busy,        setBusy]        = useState(false)
  const [degraded,    setDegraded]    = useState(false)
  const [editOpen,    setEditOpen]    = useState(false)
  const [actionErr,   setActionErr]   = useState<string | null>(null)
  const [confirmDel,  setConfirmDel]  = useState(false)
  const [deleting,    setDeleting]    = useState(false)

  useEffect(() => {
    if (agent.status === 'active') {
      api.portfolio.equity(agent.id).then(setEquity).catch(() => {})
      api.intelligence.notifications(true).then((notifs: { agent_id: string; type: string }[]) => {
        const deg = notifs.some((n) => n.agent_id === agent.id && n.type === 'agent_degraded')
        setDegraded(deg)
      }).catch(() => {})
    }
  }, [agent.id, agent.status])

  const handleToggle = async () => {
    setBusy(true)
    setActionErr(null)
    try {
      if (agent.status === 'active') {
        await onDeactivate(agent.id)
      } else {
        await onActivate(agent.id)
      }
    } catch (err) {
      setActionErr(String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await api.agents.delete(agent.id)
      onRefresh?.()
    } catch (err) {
      setActionErr(String(err))
      setConfirmDel(false)
    } finally {
      setDeleting(false)
    }
  }

  // Is this agent ready to activate?
  const isEnsemble = agent.name.toLowerCase().includes('ensemble')
  const canActivate = agent.status === 'trained' || agent.status === 'active' || isEnsemble

  const statusVariant = (s: string) => {
    if (s === 'active') return 'active'
    if (s === 'trained') return 'trained'
    if (s === 'training') return 'training'
    return 'created'
  }

  // Gradient border using agent color
  const borderStyle: React.CSSProperties = {
    background: `linear-gradient(var(--color-surface), var(--color-surface)) padding-box,
                 linear-gradient(135deg, ${agent.color}66, ${agent.color}22) border-box`,
    border: '1px solid transparent',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-4)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-3)',
    backdropFilter: 'blur(12px)',
  }

  const metrics = agent.metrics
  const totalReturn = metrics?.total_return

  return (
    <div style={borderStyle}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: agent.color,
              flexShrink: 0,
            }}
          />
          <span style={{ fontWeight: 700, fontSize: 'var(--text-base)' }}>{agent.name}</span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
          <Badge variant="tf">{agent.timeframe}</Badge>
          <Badge variant={statusVariant(agent.status) as 'active' | 'trained' | 'training' | 'created'}>
            {agent.status}
          </Badge>
          {degraded && (
            <span
              className="badge"
              style={{ background: 'oklch(72% 0.14 85 / 0.15)', color: 'oklch(72% 0.14 85)', border: '1px solid oklch(72% 0.14 85 / 0.4)' }}
              title="Signal quality degraded — IC below threshold for 3+ days"
            >
              ⚠ Degraded
            </span>
          )}
        </div>
      </div>

      {/* Signal + sparkline */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <SignalBadge signal={latestSignal} />
          {latestSignal && (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
              {fmtRelative(latestSignal.ts)}
            </span>
          )}
        </div>
        <Sparkline equity={equity} />
      </div>

      {/* Metrics row */}
      {metrics && (
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-4)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-muted)',
          }}
        >
          {totalReturn !== undefined && (
            <span>
              Ret:{' '}
              <span
                style={{
                  color: totalReturn >= 0 ? 'var(--color-bull)' : 'var(--color-bear)',
                  fontWeight: 600,
                }}
              >
                {fmtPct(totalReturn)}
              </span>
            </span>
          )}
          {metrics.sharpe !== undefined && (
            <span>
              Sharpe: <span style={{ color: 'var(--color-text)' }}>{metrics.sharpe.toFixed(2)}</span>
            </span>
          )}
          {metrics.win_rate !== undefined && (
            <span>
              WR: <span style={{ color: 'var(--color-text)' }}>{fmtPct(metrics.win_rate, 0, false)}</span>
            </span>
          )}
        </div>
      )}

      {/* Error message */}
      {actionErr && (
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-bear)', marginTop: 'var(--space-2)' }}>
          {actionErr.includes('trained') ? 'Train the agent first in the Lab.' : actionErr}
        </p>
      )}

      {/* Action buttons row */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
        {/* Main action: depends on status */}
        {agent.status === 'training' ? (
          <Button variant="secondary" size="sm" disabled style={{ flex: 1 }}>
            Training…
          </Button>
        ) : agent.status === 'created' && !isEnsemble ? (
          <Link href="/lab" style={{ flex: 1, textDecoration: 'none' }}>
            <Button variant="secondary" size="sm" style={{ width: '100%' }}>
              → Train in Lab
            </Button>
          </Link>
        ) : (
          <Button
            variant={agent.status === 'active' ? 'secondary' : 'primary'}
            size="sm"
            loading={busy}
            onClick={handleToggle}
            style={{ flex: 1 }}
          >
            {agent.status === 'active' ? 'Deactivate' : 'Activate'}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditOpen(true)}
          title="Edit agent configuration"
        >
          ✏ Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setConfirmDel(true)}
          title="Delete agent"
          style={{ color: 'var(--color-muted)', padding: '4px 8px' }}
        >
          🗑
        </Button>
      </div>

      {/* Inline delete confirmation */}
      {confirmDel && (
        <div style={{
          marginTop: 'var(--space-3)',
          padding: 'var(--space-3)',
          background: 'oklch(60% 0.20 25 / 0.08)',
          border: '1px solid oklch(60% 0.20 25 / 0.3)',
          borderRadius: 'var(--radius-md)',
        }}>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-bear)', marginBottom: 'var(--space-2)' }}>
            Delete <strong>{agent.name}</strong>? This removes the model, all signals, and the portfolio. Cannot be undone.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button
              variant="danger"
              size="sm"
              loading={deleting}
              onClick={handleDelete}
              style={{ flex: 1 }}
            >
              Yes, delete
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDel(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Edit modal — full AgentBuilder wizard pre-filled with this agent's config */}
      {editOpen && (
        <Modal
          isOpen={editOpen}
          onClose={() => setEditOpen(false)}
          title={`Edit Agent: ${agent.name}`}
          size="xl"
        >
          <AgentBuilder
            editAgent={agent}
            onUpdated={() => {
              setEditOpen(false)
              onRefresh?.()
            }}
          />
        </Modal>
      )}
    </div>
  )
}
