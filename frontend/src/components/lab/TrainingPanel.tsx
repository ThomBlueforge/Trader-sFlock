'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Agent, WSEvent } from '@/types'
import { api } from '@/lib/api'
import { useSignalSocket } from '@/hooks/useSignalSocket'
import { useTaskContext } from '@/contexts/TaskContext'
import { fmtPct } from '@/lib/formatters'
import Button from '@/components/ui/Button'
import TrainingDiagnostics from './TrainingDiagnostics'

// Infer phase label from progress percentage
function phaseLabel(pct: number, isOptimizing: boolean): string {
  if (isOptimizing) {
    if (pct < 5)  return 'Pre-computing features\u2026'
    if (pct < 90) return `Optuna TPE search — trial ${Math.round(pct / 90 * 100)}% complete`
    return 'Training final model with best params\u2026'
  }
  if (pct < 5)  return 'Loading data — computing features\u2026'
  if (pct < 85) return `Walk-forward backtest — window ${Math.round((pct-5)/80 * 100)}% complete`
  if (pct < 95) return 'Retraining final model on full history\u2026'
  return 'Saving model — almost done\u2026'
}

interface TrainingPanelProps {
  agent: Agent
  onComplete?: () => void
}

interface Metrics {
  accuracy?: number
  precision?: number
  recall?: number
  f1?: number
  total_return?: number
  annualized_return?: number
  sharpe?: number
  max_drawdown?: number
  win_rate?: number
  n_trades?: number
  feature_importances?: Record<string, number>
  [key: string]: unknown
}

function FeatureImportanceChart({ fi }: { fi: Record<string, number> }) {
  const entries = Object.entries(fi)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
  if (entries.length === 0) return null

  const maxVal = entries[0][1]
  const W = 240, BAR_H = 14, GAP = 4

  return (
    <div style={{ marginTop: 'var(--space-4)' }}>
      <h4
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 'var(--space-3)',
        }}
      >
        Feature Importance
      </h4>
      <svg
        width={W + 160}
        height={entries.length * (BAR_H + GAP)}
        style={{ overflow: 'visible' }}
      >
        {entries.map(([name, val], i) => {
          const barW = (val / maxVal) * W
          const y = i * (BAR_H + GAP)
          return (
            <g key={name}>
              <text
                x={0}
                y={y + BAR_H - 2}
                fill="var(--color-muted)"
                fontSize={10}
                fontFamily="var(--font-mono), monospace"
                textAnchor="end"
              >
                {name.slice(0, 16)}
              </text>
              <rect
                x={4}
                y={y}
                width={Math.max(barW, 2)}
                height={BAR_H}
                rx={2}
                fill="var(--color-gold)"
                fillOpacity={0.7 + (1 - i / entries.length) * 0.3}
              />
              <text
                x={barW + 8}
                y={y + BAR_H - 2}
                fill="var(--color-muted)"
                fontSize={9}
              >
                {(val * 100).toFixed(1)}%
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export default function TrainingPanel({ agent, onComplete }: TrainingPanelProps) {
  const { tasks, isRunning }     = useTaskContext()
  const globalTask                = tasks[agent.id]
  const isCancelling              = globalTask?.status === 'cancelling'

  const [progress,   setProgress]  = useState<number | null>(null)
  const [metrics,    setMetrics]   = useState<Metrics | null>((agent.metrics ?? null) as Metrics | null)
  const [error,      setError]     = useState<string | null>(null)
  const [training,   setTraining]  = useState(false)
  const [optimizing, setOptimizing]= useState(false)
  const [nTrials,    setNTrials]   = useState(50)

  // Sync local state with global task tracking so UI stays correct
  // even if the component remounted mid-training
  const globalProgress = globalTask?.progress ?? null
  const anyRunning     = isRunning(agent.id)

  // Update metrics if agent prop changes (e.g. after refresh)
  useEffect(() => {
    if (agent.metrics) setMetrics(agent.metrics as unknown as Metrics)
  }, [agent.metrics])

  const handleEvent = useCallback(
    (ev: WSEvent) => {
      if (ev.data.agent_id !== agent.id) return
      if (ev.event === 'training_progress') {
        setProgress(ev.data.pct as number)
      } else if (ev.event === 'training_complete') {
        setProgress(100)
        setMetrics(ev.data.metrics as Metrics)
        setTraining(false)
        setOptimizing(false)
        onComplete?.()
      } else if (ev.event === 'training_error') {
        setError(ev.data.error as string)
        setTraining(false)
        setOptimizing(false)
        setProgress(null)
      }
    },
    [agent.id, onComplete],
  )

  useSignalSocket(handleEvent)

  const startOptimize = async () => {
    setError(null)
    setProgress(0)
    setOptimizing(true)
    setTraining(true)
    try {
      await api.training.optimize(agent.id, nTrials)
    } catch (err) {
      setError(String(err))
      setOptimizing(false)
      setTraining(false)
      setProgress(null)
    }
  }

  const startTraining = async () => {
    setError(null)
    setProgress(0)
    setTraining(true)
    try {
      await api.training.train(agent.id)
    } catch (err) {
      setError(String(err))
      setTraining(false)
      setProgress(null)
    }
  }

  const METRIC_ROWS: { key: keyof Metrics; label: string; fmt: (v: number) => string }[] = [
    { key: 'accuracy',    label: 'Accuracy',    fmt: (v) => fmtPct(v, 1, false) },
    { key: 'precision',   label: 'Precision',   fmt: (v) => fmtPct(v, 1, false) },
    { key: 'recall',      label: 'Recall',      fmt: (v) => fmtPct(v, 1, false) },
    { key: 'f1',          label: 'F1',          fmt: (v) => v.toFixed(3) },
    { key: 'total_return',label: 'Total Return',fmt: (v) => fmtPct(v) },
    { key: 'sharpe',      label: 'Sharpe',      fmt: (v) => v.toFixed(2) },
    { key: 'max_drawdown',label: 'Max Drawdown',fmt: (v) => fmtPct(v) },
    { key: 'win_rate',    label: 'Win Rate',    fmt: (v) => fmtPct(v, 1, false) },
    { key: 'n_trades',    label: 'Trades',      fmt: (v) => v.toFixed(0) },
  ]

  return (
    <div className="card" style={{ marginTop: 'var(--space-4)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-4)',
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>{agent.name}</h3>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
            {agent.model_type} · {agent.timeframe} · {agent.features.length} features
          </span>
        </div>
<div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <Button
          variant="primary"
          onClick={startTraining}
          loading={training || (anyRunning && !optimizing && !isCancelling)}
          disabled={anyRunning}
          title={isCancelling ? 'Cancellation in progress…' : anyRunning ? 'A task is already running for this agent' : undefined}
        >
          {isCancelling ? 'Cancelling…' : anyRunning && !training && !optimizing ? 'Running…' : training ? 'Training…' : 'Train'}
        </Button>
        <select
          className="select"
          value={nTrials}
          onChange={(e) => setNTrials(Number(e.target.value))}
          disabled={anyRunning}
          style={{ fontSize: 'var(--text-xs)', padding: '4px 24px 4px 8px' }}
          title="Number of Optuna trials (more = better params, slower)"
        >
          {[20, 50, 100, 200, 500].map(n => (
            <option key={n} value={n}>{n} trials</option>
          ))}
        </select>
        <Button
          variant="secondary"
          onClick={startOptimize}
          loading={optimizing || (anyRunning && !training && !isCancelling)}
            disabled={anyRunning}
            title={isCancelling ? 'Cancellation in progress…' : anyRunning ? 'A task is already running — stop it first' : `Run ${nTrials} Optuna trials then train with best hyperparams (max 5 min)`}
        >
          {optimizing ? 'Optimizing…' : 'Optimize'}
        </Button>
        </div>
      </div>

      {/* Timing hint */}
      {!anyRunning && !metrics && (
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginBottom: 'var(--space-3)' }}>
          Train: ~10–60 s · Optimize: ~{Math.round(nTrials * 0.04)}–{Math.round(nTrials * 0.1)} min (features pre-computed once, {nTrials} TPE trials)
        </p>
      )}

      {/* Progress bar with phase label */}
      {(progress !== null || globalProgress !== null) && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            marginBottom: 'var(--space-1)', fontSize: 'var(--text-xs)', color: 'var(--color-muted)',
          }}>
            <span style={{ flex: 1, color: isCancelling ? 'var(--color-bear)' : undefined }}>
              {isCancelling ? 'Cancelling — waiting for current window to finish…' : phaseLabel(progress ?? globalProgress ?? 0, optimizing)}
            </span>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: isCancelling ? 'var(--color-bear)' : 'var(--color-gold)' }}>
              {isCancelling ? '…' : `${progress ?? globalProgress}%`}
            </span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress ?? globalProgress}%` }} />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <p
          style={{
            color: 'var(--color-bear)',
            fontSize: 'var(--text-sm)',
            background: 'oklch(60% 0.20 25 / 0.1)',
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            marginBottom: 'var(--space-4)',
          }}
        >
          {error}
        </p>
      )}

      {/* Metrics table */}
      {metrics && (
        <>
          <div className="stat-grid">
            {METRIC_ROWS.filter(({ key }) => metrics[key] !== undefined).map(({ key, label, fmt }) => (
              <div key={key as string} className="stat-box">
                <div className="stat-label">{label}</div>
                <div
                  className="stat-value"
                  style={{
                    color:
                      key === 'total_return' || key === 'sharpe'
                        ? (metrics[key] as number) >= 0
                          ? 'var(--color-bull)'
                          : 'var(--color-bear)'
                        : key === 'max_drawdown'
                        ? 'var(--color-bear)'
                        : 'var(--color-text)',
                  }}
                >
                  {fmt(metrics[key] as number)}
                </div>
              </div>
            ))}
          </div>

          {metrics.feature_importances && (agent.model_type === 'xgboost' || agent.model_type === 'lgbm') && (
            <FeatureImportanceChart fi={metrics.feature_importances} />
          )}

          {/* Signal Health diagnostics */}
          <TrainingDiagnostics
            agent={agent}
            metrics={metrics as unknown as Record<string, number>}
          />
        </>
      )}
    </div>
  )
}
