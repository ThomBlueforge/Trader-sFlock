'use client'

import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import type { Agent, FeatureMeta } from '@/types'
import FeatureSelector from './FeatureSelector'
import HyperparamPanel from './HyperparamPanel'
import InlineAgentChat from './InlineAgentChat'
import Button from '@/components/ui/Button'
import DataWindowPicker from '@/components/data/DataWindowPicker'

// Slider with tooltip — reused for Step 4
function Slider({ label, value, min, max, step, onChange, display, tooltip }: {
  label: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; display: string; tooltip?: string
}) {
  return (
    <div className="field">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="field-label" style={{ marginBottom: 0 }}>{label}</span>
          {tooltip && (
            <span className="feature-wrap" style={{ display: 'inline-block' }}>
              <span style={{ fontSize: '0.6rem', color: 'var(--color-gold-dim)', cursor: 'default' }}>&#9432;</span>
              <div className="feature-tooltip" style={{ minWidth: 260, maxWidth: 340 }}>
                <div className="feature-tooltip__name">{label}</div>
                <div className="feature-tooltip__desc">{tooltip}</div>
              </div>
            </span>
          )}
        </div>
        <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'monospace', color: 'var(--color-gold)' }}>{display}</span>
      </div>
      <input type="range" className="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  )
}

const TIMEFRAMES = ['5m', '15m', '30m', '1h', '2h', '4h', '1d']
const PRESET_COLORS = ['#d4af37', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316']

interface AgentBuilderProps {
  onCreated?: (agentId: string) => void
  onUpdated?: (agentId: string) => void
  editAgent?: Agent
}

interface FormState {
  name: string
  color: string
  timeframe: string
  features: string[]
  model_type: string
  hyperparams: Record<string, number | string>
  target_horizon: number
  target_threshold: number
  train_window: number
  position_size_pct: number
}

const DEFAULTS: FormState = {
  name: '',
  color: '#d4af37',
  timeframe: '1d',
  features: [],
  model_type: 'xgboost',
  hyperparams: { n_estimators: 200, max_depth: 4, learning_rate: 0.05, subsample: 0.8, colsample_bytree: 0.8 },
  target_horizon: 5,
  target_threshold: 0.3,
  train_window: 500,
  position_size_pct: 0.1,
}

const STEP_LABELS = ['Identity', 'Features', 'Model', 'Training']

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="wizard-steps">
      {Array.from({ length: total }, (_, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : ''
        return (
          <>
            <div key={i} className={`wizard-step wizard-step--${state || 'pending'}`}>
              <div className="wizard-step__num">{i < current ? '✓' : i + 1}</div>
              <span>{STEP_LABELS[i]}</span>
            </div>
            {i < total - 1 && <div key={`c-${i}`} className="wizard-connector" />}
          </>
        )
      })}
    </div>
  )
}

export default function AgentBuilder({ onCreated, onUpdated, editAgent }: AgentBuilderProps) {
  const isEditing = !!editAgent

  const initialForm: FormState = useMemo(() => {
    if (!editAgent) return DEFAULTS
    return {
      name:              editAgent.name,
      color:             editAgent.color,
      timeframe:         editAgent.timeframe,
      features:          editAgent.features,
      model_type:        editAgent.model_type,
      hyperparams:       editAgent.hyperparams as Record<string, number | string>,
      target_horizon:    editAgent.target_horizon,
      target_threshold:  editAgent.target_threshold,
      train_window:      editAgent.train_window,
      position_size_pct: editAgent.position_size_pct,
    }
  }, [editAgent?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const [step,     setStep]    = useState(0)
  const [form,     setForm]    = useState<FormState>(initialForm)
  const [saving,   setSaving]  = useState(false)
  const [error,    setError]   = useState<string | null>(null)
  const [allFeats, setAllFeats]= useState<FeatureMeta[]>([])

  // Load full feature list for AI context (all timeframes)
  useEffect(() => {
    api.features(form.timeframe).then(setAllFeats).catch(() => {})
  }, [form.timeframe])

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: val }))

  // Apply AI-generated config to the form (updates the live UI)
  const handleAIConfig = (cfg: import('@/types').AgentConfig) => {
    if (cfg.name)              set('name',              cfg.name)
    if (cfg.color)             set('color',             cfg.color)
    if (cfg.timeframe)         set('timeframe',         cfg.timeframe)
    if (cfg.features)          set('features',          cfg.features)
    if (cfg.model_type)        set('model_type',        cfg.model_type)
    if (cfg.hyperparams)       set('hyperparams',       cfg.hyperparams as Record<string, number | string>)
    if (cfg.target_horizon)    set('target_horizon',    cfg.target_horizon)
    if (cfg.target_threshold)  set('target_threshold',  cfg.target_threshold)
    if (cfg.train_window)      set('train_window',      cfg.train_window)
    if (cfg.position_size_pct) set('position_size_pct', cfg.position_size_pct)
  }

  const canProceed = () => {
    if (step === 0) return form.name.trim().length > 0
    if (step === 1) return form.features.length > 0
    return true
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    const payload = {
      name:              form.name.trim(),
      color:             form.color,
      timeframe:         form.timeframe,
      features:          form.features,
      model_type:        form.model_type,
      hyperparams:       form.hyperparams,
      target_horizon:    form.target_horizon,
      target_threshold:  form.target_threshold,
      train_window:      form.train_window,
      position_size_pct: form.position_size_pct,
    }
    try {
      if (isEditing && editAgent) {
        await api.agents.update(editAgent.id, payload)
        onUpdated?.(editAgent.id)
      } else {
        const agent = await api.agents.create(payload)
        setForm(DEFAULTS)
        setStep(0)
        onCreated?.(agent.id)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={isEditing ? undefined : 'card'}>
      <h3 className="section-title" style={{ marginBottom: 'var(--space-3)' }}>
        {isEditing ? `Edit: ${editAgent!.name}` : 'Build New Agent'}
      </h3>

      {/* Retrain warning shown when editing a trained/active agent */}
      {isEditing && editAgent && ['trained', 'active'].includes(editAgent.status) && (
        <div style={{
          background: 'oklch(72% 0.14 85 / 0.08)',
          border: '1px solid oklch(72% 0.14 85 / 0.25)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-3) var(--space-4)',
          marginBottom: 'var(--space-4)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-gold)',
        }}>
          ⚠ This agent is currently <strong>{editAgent.status}</strong>. Any changes to features,
          model type, hyperparams, or training config will require a full retrain before
          new signals are generated.
        </div>
      )}

      <StepIndicator current={step} total={4} />

      {/* Step 0 — Identity */}
      {step === 0 && (
        <div>
          <div className="field">
            <label className="field-label">Agent Name</label>
            <input
              className="input"
              placeholder="e.g. GoldTrendBot"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </div>

          <div className="field">
            <label className="field-label">Color</label>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => set('color', c)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: c,
                    border: form.color === c ? '2px solid white' : '2px solid transparent',
                    cursor: 'pointer',
                    transition: 'transform var(--duration-fast)',
                  }}
                />
              ))}
              <input
                type="color"
                value={form.color}
                onChange={(e) => set('color', e.target.value)}
                style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', cursor: 'pointer' }}
              />
            </div>
          </div>

          <div className="field">
            <label className="field-label">Timeframe</label>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  className={`btn ${form.timeframe === tf ? 'btn--primary' : 'btn--ghost'} btn--sm`}
                  onClick={() => set('timeframe', tf)}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step 1 — Features */}
      {step === 1 && (
        <FeatureSelector
          timeframe={form.timeframe}
          selected={form.features}
          onChange={(keys) => set('features', keys)}
        />
      )}

      {/* Step 2 — Model */}
      {step === 2 && (
        <HyperparamPanel
          value={{ model_type: form.model_type, hyperparams: form.hyperparams }}
          onChange={({ model_type, hyperparams }) => {
            set('model_type', model_type)
            set('hyperparams', hyperparams)
          }}
        />
      )}

      {/* Step 3 — Training config */}
      {step === 3 && (
        <div>
          <Slider
            label="Target Horizon (bars)"
            value={form.target_horizon}
            min={1} max={20} step={1}
            onChange={(v) => set('target_horizon', Math.round(v))}
            display={`${form.target_horizon} bars`}
            tooltip={`How many bars AHEAD the model tries to predict. On a 1d chart, 5 = predicting next week's direction. On 1h, 5 = next 5 hours. Longer horizon = fewer, smoother signals but slower reaction to changes. Short horizon = more trades but noisier. Recommended: 3-7 bars. The model labels each bar as BULL if price rose at least [threshold]% over the next [horizon] bars.`}
          />

          <Slider
            label="Min Move Threshold"
            value={form.target_threshold * 100}
            min={0.1} max={2.0} step={0.1}
            onChange={(v) => set('target_threshold', v / 100)}
            display={`${(form.target_threshold * 100).toFixed(1)}%`}
            tooltip={`The minimum price move required to label a bar as BULL or SHORT. E.g., 0.3% on 1d = gold must rise at least 0.3% over the next [horizon] bars to be called BULL. Too low = the model tries to predict noise. Too high = not enough BULL examples to train on. Recommended: 0.2-0.5% on 1d, 0.1-0.2% on 1h.`}
          />

          <DataWindowPicker
            timeframe={form.timeframe}
            value={form.train_window}
            modelType={form.model_type}
            onChange={(bars) => set('train_window', bars)}
          />

          <Slider
            label="Position Size"
            value={form.position_size_pct * 100}
            min={5} max={50} step={5}
            onChange={(v) => set('position_size_pct', v / 100)}
            display={`${(form.position_size_pct * 100).toFixed(0)}%`}
            tooltip={`What % of your capital to deploy per trade. 10% = if you have $10,000, each trade uses $1,000 of gold exposure. Higher = larger profits AND losses. 5-15% is conservative. A 0.05% commission is deducted on every entry and exit. This setting is used in the backtest to calculate realistic PnL figures.`}
          />

          {error && (
            <p style={{ color: 'var(--color-bear)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-3)' }}>
              {error}
            </p>
          )}
        </div>
      )}

      {/* AI co-pilot — appears on every step */}
      <InlineAgentChat
        step={step}
        form={form as unknown as Record<string, unknown>}
        allFeatures={allFeats}
        onApply={handleAIConfig}
      />

      {/* Navigation */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 'var(--space-6)',
        }}
      >
        <Button
          variant="ghost"
          onClick={() => setStep((s) => s - 1)}
          disabled={step === 0}
        >
          ← Back
        </Button>

        {step < 3 ? (
          <Button variant="primary" onClick={() => setStep((s) => s + 1)} disabled={!canProceed()}>
            Next →
          </Button>
        ) : (
          <Button variant="primary" onClick={handleSave} loading={saving}>
            {isEditing ? 'Save Changes' : 'Save Agent'}
          </Button>
        )}
      </div>
    </div>
  )
}
