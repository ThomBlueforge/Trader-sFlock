'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { useSignalSocket } from '@/hooks/useSignalSocket'
import type { WSEvent } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LogEntry { ts: string; level: string; msg: string }

interface JobState {
  status:      'idle' | 'running' | 'done' | 'error'
  phase:       'download' | 'resample' | null
  pct:         number
  done_hours:  number
  total_hours: number
  ticks:       number
  rate:        number
  eta_s:       number | null
  resample_tf: string | null
  bars_per_tf: Record<string, number>
  elapsed_s:   number
  error:       string | null
  params:      Record<string, unknown>
  logs:        LogEntry[]
}

type TFSummary = Record<string, {
  bar_count: number
  date_from: string | null
  date_to:   string | null
  coverage:  number
}>

const ALL_TFS = ['5m', '15m', '30m', '1h', '2h', '4h', '1d']

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) { return n.toLocaleString() }

function fmtEta(s: number | null): string {
  if (s == null || s < 0) return '—'
  if (s < 60)  return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`
}

function fmtElapsed(s: number): string {
  if (s < 60)   return `${Math.round(s)}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

function coverageColor(pct: number): string {
  if (pct >= 85) return 'var(--color-bull)'
  if (pct >= 60) return '#f59e0b'
  return 'var(--color-bear)'
}

function logColor(level: string): string {
  if (level === 'ERROR') return 'var(--color-bear)'
  if (level === 'WARN')  return '#f59e0b'
  return 'var(--color-muted)'
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function isoYearsAgo(n: number): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - n)
  return d.toISOString().slice(0, 10)
}

function isoMonthsAgo(n: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString().slice(0, 10)
}

// ── Main component ────────────────────────────────────────────────────────────

export default function HistoricalImport() {
  const [job,       setJob]       = useState<JobState | null>(null)
  const [summary,   setSummary]   = useState<TFSummary | null>(null)
  const [startDate, setStartDate] = useState(isoYearsAgo(1))
  const [endDate,   setEndDate]   = useState(isoToday)
  const [selectedTFs, setSelectedTFs] = useState<string[]>(ALL_TFS)
  const [concurrency, setConcurrency] = useState(12)
  const [logPaused,   setLogPaused]   = useState(false)
  const [starting,    setStarting]    = useState(false)
  const [cancelling,  setCancelling]  = useState(false)

  const logRef  = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Fetch helpers ──────────────────────────────────────────────────────────

  const loadSummary = useCallback(async () => {
    try { setSummary(await api.historicalImport.summary()) } catch {}
  }, [])

  const loadStatus = useCallback(async () => {
    try { setJob(await api.historicalImport.status() as unknown as JobState) } catch {}
  }, [])

  // ── Polling ────────────────────────────────────────────────────────────────

  const startPolling = useCallback(() => {
    if (pollRef.current) return
    pollRef.current = setInterval(async () => {
      const s = await api.historicalImport.status() as unknown as JobState
      setJob(s)
      if (s.status !== 'running') {
        clearInterval(pollRef.current!)
        pollRef.current = null
        loadSummary()
      }
    }, 2000)
  }, [loadSummary])

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  // ── Init ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    loadStatus()
    loadSummary()
    return stopPolling
  }, []) // eslint-disable-line

  useEffect(() => {
    if (job?.status === 'running') startPolling()
    else stopPolling()
  }, [job?.status]) // eslint-disable-line

  // ── WS events ──────────────────────────────────────────────────────────────

  useSignalSocket(useCallback((ev: WSEvent) => {
    if (ev.event === 'historical_progress' || ev.event === 'historical_tf_done') {
      loadStatus()
    }
    if (ev.event === 'historical_log') {
      setJob(prev => prev ? {
        ...prev,
        logs: [...(prev.logs ?? []).slice(-199), ev.data as unknown as LogEntry],
      } : prev)
    }
    if (ev.event === 'historical_done') {
      loadStatus()
      loadSummary()
    }
  }, [loadStatus, loadSummary]))

  // ── Auto-scroll log ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!logPaused && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [job?.logs, logPaused])

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleStart = async () => {
    setStarting(true)
    try {
      const s = await api.historicalImport.start({
        start_date:  startDate,
        end_date:    endDate,
        concurrency,
        timeframes:  selectedTFs,
      }) as unknown as JobState
      setJob(s)
    } catch (e: unknown) {
      alert(`Failed to start: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setStarting(false)
    }
  }

  const handleCancel = async () => {
    setCancelling(true)
    try {
      const s = await api.historicalImport.cancel() as unknown as JobState
      setJob(s)
    } finally {
      setCancelling(false)
    }
  }

  const toggleTF = (tf: string) =>
    setSelectedTFs(prev => prev.includes(tf) ? prev.filter(t => t !== tf) : [...prev, tf])

  const setPreset = (label: string) => {
    const today = isoToday()
    if (label === '3mo')  { setStartDate(isoMonthsAgo(3));  setEndDate(today) }
    if (label === '6mo')  { setStartDate(isoMonthsAgo(6));  setEndDate(today) }
    if (label === '1yr')  { setStartDate(isoYearsAgo(1));   setEndDate(today) }
    if (label === '2yr')  { setStartDate(isoYearsAgo(2));   setEndDate(today) }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  const isRunning = job?.status === 'running'
  const isDone    = job?.status === 'done'
  const isError   = job?.status === 'error'

  // ── Idle / form state ──────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: 0, color: 'var(--color-gold)' }}>◈ Historical Data Import</h3>
            <p style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>
              Download tick-level XAUUSD data from Dukascopy and resample to all timeframes.
              Run once to unlock a full year of training data for every agent.
            </p>
          </div>
          {isRunning && (
            <button
              className="btn btn--ghost btn--sm"
              onClick={handleCancel}
              disabled={cancelling}
              style={{ color: 'var(--color-bear)', borderColor: 'var(--color-bear)' }}
            >
              {cancelling ? 'Stopping…' : '✕ Cancel'}
            </button>
          )}
        </div>
      </div>

      {/* Data Status Table */}
      {summary && (
        <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
          <h4 style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Current Data Status — XAUUSD
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'var(--space-2)' }}>
            {ALL_TFS.map(tf => {
              const s = summary[tf]
              const cov = s?.coverage ?? 0
              const count = s?.bar_count ?? 0
              return (
                <div key={tf} style={{ textAlign: 'center', padding: 'var(--space-2)', background: 'var(--color-surface-2)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--color-gold)', marginBottom: 4 }}>{tf}</div>
                  <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text)' }}>{count > 0 ? fmt(count) : '—'}</div>
                  <div style={{ fontSize: '0.6rem', color: 'var(--color-muted)', marginBottom: 4 }}>bars</div>
                  {count > 0 ? (
                    <>
                      <div style={{ height: 3, background: 'var(--color-border)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${cov}%`, background: coverageColor(cov), borderRadius: 2 }} />
                      </div>
                      <div style={{ fontSize: '0.6rem', color: coverageColor(cov), marginTop: 2 }}>{cov}%</div>
                      {s.date_from && (
                        <div style={{ fontSize: '0.55rem', color: 'var(--color-muted)', marginTop: 2 }}>
                          {s.date_from?.slice(5)} →<br />{s.date_to?.slice(5)}
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ fontSize: '0.6rem', color: 'var(--color-muted)' }}>No data</div>
                  )}
                </div>
              )
            })}
          </div>
          <p style={{ margin: 'var(--space-2) 0 0', fontSize: '0.65rem', color: 'var(--color-muted)' }}>
            Coverage % = actual bars ÷ expected trading bars (22.5 h/weekday). Green ≥ 85%, amber ≥ 60%, red below.
          </p>
        </div>
      )}

      {/* Running state */}
      {isRunning && job && (
        <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
          {/* Phase badge + progress */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <div>
                <span style={{
                  display: 'inline-block',
                  fontSize: 'var(--text-xs)', fontWeight: 700,
                  padding: '2px 8px', borderRadius: 20,
                  background: 'oklch(72% 0.14 85 / 0.15)',
                  color: 'var(--color-gold)', marginRight: 8,
                }}>
                  {job.phase === 'download' ? '⬇ Phase 1: Downloading Ticks' : `↻ Phase 2: Resampling${job.resample_tf ? ` — ${job.resample_tf}` : ''}`}
                </span>
                {job.elapsed_s > 0 && (
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
                    Elapsed: {fmtElapsed(job.elapsed_s)}
                  </span>
                )}
              </div>
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, fontFamily: 'monospace', color: 'var(--color-gold)' }}>
                {job.pct.toFixed(1)}%
              </span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${job.pct}%`, transition: 'width 0.5s ease' }} />
            </div>
          </div>

          {/* Stats chips */}
          <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
            {job.phase === 'download' && (
              <>
                <div className="stat-box" style={{ flex: 1, minWidth: 80 }}>
                  <div className="stat-label">Hours done</div>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>
                    {fmt(job.done_hours)} / {fmt(job.total_hours)}
                  </div>
                </div>
                <div className="stat-box" style={{ flex: 1, minWidth: 80 }}>
                  <div className="stat-label">Ticks stored</div>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{fmt(job.ticks)}</div>
                </div>
                <div className="stat-box" style={{ flex: 1, minWidth: 80 }}>
                  <div className="stat-label">Speed</div>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{job.rate} h/s</div>
                </div>
                <div className="stat-box" style={{ flex: 1, minWidth: 80 }}>
                  <div className="stat-label">ETA</div>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{fmtEta(job.eta_s)}</div>
                </div>
              </>
            )}
            {job.phase === 'resample' && (
              <>
                {ALL_TFS.map(tf => {
                  const bars = job.bars_per_tf?.[tf]
                  const done = bars != null
                  const current = job.resample_tf === tf
                  return (
                    <div key={tf} className="stat-box" style={{ flex: 1, minWidth: 60, opacity: done ? 1 : 0.4 }}>
                      <div className="stat-label" style={{ color: current ? 'var(--color-gold)' : undefined }}>{tf}</div>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>
                        {done ? `${fmt(bars)} ✓` : current ? '…' : '—'}
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </div>

          {/* Log panel */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Live Log
              </span>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => setLogPaused(p => !p)}
                style={{ fontSize: '0.65rem', padding: '2px 6px' }}
              >
                {logPaused ? '▶ Resume scroll' : '⏸ Pause'}
              </button>
            </div>
            <div
              ref={logRef}
              style={{
                height: 180,
                overflow: 'auto',
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-2)',
                fontFamily: 'monospace',
                fontSize: '0.68rem',
                lineHeight: 1.6,
              }}
            >
              {(job.logs ?? []).slice(-60).map((l, i) => (
                <div key={i}>
                  <span style={{ color: 'var(--color-border)' }}>[{l.ts}] </span>
                  <span style={{ color: logColor(l.level), fontWeight: l.level !== 'INFO' ? 700 : 400 }}>{l.level.padEnd(5)}</span>
                  <span style={{ color: l.level === 'ERROR' ? 'var(--color-bear)' : l.level === 'WARN' ? '#f59e0b' : 'var(--color-text)' }}> {l.msg}</span>
                </div>
              ))}
              {(job.logs ?? []).length === 0 && (
                <span style={{ color: 'var(--color-muted)' }}>Starting…</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Done state */}
      {isDone && job && (
        <div className="card" style={{ marginBottom: 'var(--space-4)', borderColor: 'var(--color-bull)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
            <span style={{ fontSize: '1.5rem' }}>✅</span>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--color-bull)' }}>Import complete!</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
                Finished in {fmtElapsed(job.elapsed_s)} — all timeframes now available for training.
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
            {Object.entries(job.bars_per_tf ?? {}).map(([tf, bars]) => (
              <div key={tf} className="stat-box" style={{ minWidth: 70 }}>
                <div className="stat-label">{tf}</div>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{fmt(bars)} bars</div>
              </div>
            ))}
          </div>
          <button className="btn btn--ghost btn--sm" onClick={() => setJob(prev => prev ? { ...prev, status: 'idle' } : prev)}>
            Start new import
          </button>
        </div>
      )}

      {/* Error state */}
      {isError && job && (
        <div className="card" style={{ marginBottom: 'var(--space-4)', borderColor: 'var(--color-bear)' }}>
          <div style={{ color: 'var(--color-bear)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>⚠ Import failed</div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginBottom: 'var(--space-3)' }}>{job.error}</div>
          <button className="btn btn--secondary btn--sm" onClick={() => setJob(prev => prev ? { ...prev, status: 'idle' } : prev)}>
            Retry
          </button>
        </div>
      )}

      {/* Form (shown when idle, done, or error) */}
      {!isRunning && (
        <div className="card">
          <h4 style={{ margin: '0 0 var(--space-4)' }}>
            {isDone ? 'Import another range' : 'Configure Import'}
          </h4>

          {/* Date presets */}
          <div className="field">
            <label className="field-label">Date Range</label>
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
              {(['3mo', '6mo', '1yr', '2yr'] as const).map(p => (
                <button key={p} className="btn btn--ghost btn--sm" onClick={() => setPreset(p)}>
                  Last {p.replace('mo', ' mo').replace('yr', ' yr')}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginBottom: 4 }}>From</div>
                <input type="date" className="input" value={startDate}
                  onChange={e => setStartDate(e.target.value)} style={{ width: 140 }} />
              </div>
              <div style={{ color: 'var(--color-muted)', paddingTop: 18 }}>→</div>
              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginBottom: 4 }}>To</div>
                <input type="date" className="input" value={endDate}
                  onChange={e => setEndDate(e.target.value)} style={{ width: 140 }} />
              </div>
            </div>
          </div>

          {/* Timeframe checkboxes */}
          <div className="field">
            <label className="field-label">Timeframes to generate</label>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', margin: '0 0 var(--space-2)' }}>
              Tick data is downloaded once. Select which OHLCV resolutions to build.
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {ALL_TFS.map(tf => {
                const active = selectedTFs.includes(tf)
                return (
                  <button
                    key={tf}
                    className={`btn btn--sm ${active ? 'btn--primary' : 'btn--ghost'}`}
                    onClick={() => toggleTF(tf)}
                    style={{ minWidth: 44 }}
                  >
                    {tf}
                  </button>
                )
              })}
              <button className="btn btn--ghost btn--sm" onClick={() => setSelectedTFs(ALL_TFS)} style={{ fontSize: 'var(--text-xs)' }}>
                All
              </button>
            </div>
          </div>

          {/* Concurrency */}
          <div className="field">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
              <label className="field-label" style={{ marginBottom: 0 }}>Download threads</label>
              <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'monospace', color: 'var(--color-gold)' }}>{concurrency}</span>
            </div>
            <input type="range" className="range" min={4} max={20} step={2}
              value={concurrency} onChange={e => setConcurrency(Number(e.target.value))} />
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', margin: 'var(--space-1) 0 0' }}>
              Higher = faster download but more network load. 12 is the tested optimum.
            </p>
          </div>

          {/* Estimated time */}
          <div style={{
            background: 'var(--color-surface-2)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-3)',
            marginBottom: 'var(--space-4)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-muted)',
          }}>
            <strong style={{ color: 'var(--color-text)' }}>Estimated time:</strong>{' '}
            1 year ≈ 25–35 min at 12 threads · 6 months ≈ 15 min · 3 months ≈ 8 min.
            The job runs in the background — you can navigate away and come back.
          </div>

          <button
            className="btn btn--primary"
            onClick={handleStart}
            disabled={starting || selectedTFs.length === 0}
            style={{ width: '100%' }}
          >
            {starting ? 'Starting…' : `◈ Start Import (${selectedTFs.length} timeframes)`}
          </button>
        </div>
      )}
    </div>
  )
}
