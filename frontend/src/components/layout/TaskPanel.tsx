'use client'

import { useCallback } from 'react'
import { api } from '@/lib/api'
import { useTaskContext } from '@/contexts/TaskContext'
import type { Agent } from '@/types'

const TYPE_LABEL: Record<string, string> = {
  training:     'Training',
  optimization: 'Optimizing',
  monte_carlo:  'Simulating',
}

interface TaskPanelProps {
  agents: Agent[]
}

export default function TaskPanel({ agents }: TaskPanelProps) {
  const { tasks, markCancelling } = useTaskContext()
  const taskList = Object.values(tasks)

  const handleCancel = useCallback(
    async (agent_id: string) => {
      markCancelling(agent_id)
      try {
        await api.training.cancel(agent_id)
      } catch {
        // Best-effort; the task will still be removed when training_error fires
      }
    },
    [markCancelling],
  )

  if (taskList.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 400,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        width: 300,
        pointerEvents: 'none', // allow clicks through gaps
      }}
    >
      {taskList.map((task) => {
        const agent  = agents.find((a) => a.id === task.agent_id)
        const name   = agent?.name ?? task.agent_id.slice(0, 8)
        const label  = TYPE_LABEL[task.type] ?? 'Running'
        const isCancelling = task.status === 'cancelling'

        return (
          <div
            key={task.agent_id}
            style={{
              background:   'var(--color-surface)',
              border:       '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              padding:      'var(--space-3) var(--space-4)',
              boxShadow:    '0 8px 24px rgba(0,0,0,0.4)',
              pointerEvents: 'auto',
              animation:    'slide-up 200ms ease',
            }}
          >
            {/* Header row */}
            <div
              style={{
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'space-between',
                marginBottom:   'var(--space-2)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                {/* Animated dot */}
                <span
                  style={{
                    width:           8,
                    height:          8,
                    borderRadius:    '50%',
                    background:      isCancelling ? 'var(--color-bear)' : 'var(--color-gold)',
                    display:         'inline-block',
                    flexShrink:      0,
                    animation:       isCancelling ? 'none' : 'pulse 1.2s ease-in-out infinite',
                  }}
                />
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)' }}>
                  {name}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
                  {isCancelling ? 'Cancelling…' : `${label} ${task.progress}%`}
                </span>
                {!isCancelling && (
                  <button
                    onClick={() => handleCancel(task.agent_id)}
                    style={{
                      background:   'none',
                      border:       '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      color:        'var(--color-muted)',
                      cursor:       'pointer',
                      fontSize:     '0.65rem',
                      padding:      '2px 6px',
                      lineHeight:   1.4,
                      transition:   'all 150ms',
                    }}
                    onMouseEnter={(e) => {
                      ;(e.target as HTMLButtonElement).style.borderColor = 'var(--color-bear)'
                      ;(e.target as HTMLButtonElement).style.color       = 'var(--color-bear)'
                    }}
                    onMouseLeave={(e) => {
                      ;(e.target as HTMLButtonElement).style.borderColor = 'var(--color-border)'
                      ;(e.target as HTMLButtonElement).style.color       = 'var(--color-muted)'
                    }}
                    title="Cancel this task"
                  >
                    ✕ Stop
                  </button>
                )}
              </div>
            </div>

            {/* Progress bar */}
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width:      `${task.progress}%`,
                  background: isCancelling ? 'var(--color-bear)' : undefined,
                  transition: isCancelling ? 'none' : undefined,
                }}
              />
            </div>

            {/* Agent details */}
            {agent && (
              <div
                style={{
                  marginTop: 'var(--space-1)',
                  fontSize:  'var(--text-xs)',
                  color:     'var(--color-muted)',
                  display:   'flex',
                  gap:       'var(--space-3)',
                }}
              >
                <span>{agent.timeframe}</span>
                <span>{agent.model_type}</span>
                <span>{agent.features.length} features</span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
