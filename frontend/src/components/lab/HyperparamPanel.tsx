'use client'

interface HyperparamConfig {
  model_type: string
  hyperparams: Record<string, number | string>
}

interface HyperparamPanelProps {
  value: HyperparamConfig
  onChange: (v: HyperparamConfig) => void
}

function Slider({
  label, value, min, max, step, onChange,
  format = (v: number) => v.toString(),
  tooltip,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format?: (v: number) => string
  tooltip?: string
}) {
  return (
    <div className="field">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="field-label" style={{ marginBottom: 0 }}>{label}</span>
          {tooltip && (
            <span className="feature-wrap" style={{ display: 'inline-block' }}>
              <span style={{ fontSize: '0.6rem', color: 'var(--color-gold-dim)', cursor: 'default' }}>&#9432;</span>
              <div className="feature-tooltip" style={{ minWidth: 260, maxWidth: 320 }}>
                <div className="feature-tooltip__name">{label}</div>
                <div className="feature-tooltip__desc">{tooltip}</div>
              </div>
            </span>
          )}
        </div>
        <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'monospace', color: 'var(--color-gold)' }}>
          {format(value)}
        </span>
      </div>
      <input type="range" className="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  )
}

const LOGREG_DEFAULTS = { C: 1.0, max_iter: 1000 }
const XGB_DEFAULTS    = { n_estimators: 200, max_depth: 4, learning_rate: 0.05, subsample: 0.8, colsample_bytree: 0.8 }
const LGBM_DEFAULTS   = { n_estimators: 300, max_depth: 5, learning_rate: 0.05, num_leaves: 31, subsample: 0.8, colsample_bytree: 0.8 }

export default function HyperparamPanel({ value, onChange }: HyperparamPanelProps) {
  const setModelType = (mt: string) => {
    const defaults = mt === 'logreg' ? LOGREG_DEFAULTS
                   : mt === 'lgbm'   ? LGBM_DEFAULTS
                   : XGB_DEFAULTS
    onChange({ model_type: mt, hyperparams: defaults })
  }

  const setParam = (key: string, v: number) => {
    onChange({ ...value, hyperparams: { ...value.hyperparams, [key]: v } })
  }

  const hp = value.hyperparams

  return (
    <div>
      {/* Model type selector */}
      <div className="field">
        <label className="field-label">Model Type</label>
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          {(['logreg', 'xgboost', 'lgbm'] as const).map((mt) => (
            <label
              key={mt}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                cursor: 'pointer',
                fontSize: 'var(--text-sm)',
                padding: 'var(--space-2) var(--space-3)',
                borderRadius: 'var(--radius-md)',
                border: `1px solid ${value.model_type === mt ? 'var(--color-gold)' : 'var(--color-border)'}`,
                background: value.model_type === mt
                  ? 'oklch(72% 0.14 85 / 0.1)'
                  : 'var(--color-surface-2)',
                transition: 'all var(--duration-fast)',
              }}
            >
              <input
                type="radio"
                name="model_type"
                value={mt}
                checked={value.model_type === mt}
                onChange={() => setModelType(mt)}
                style={{ accentColor: 'var(--color-gold)' }}
              />
              {mt === 'logreg' ? 'Logistic Regression' : mt === 'xgboost' ? 'XGBoost' : 'LightGBM'}
            </label>
          ))}
        </div>
      </div>

      <div className="divider" />

      {/* LogReg hyperparams */}
      {value.model_type === 'logreg' && (
        <>
          <Slider
            label="C (Regularization)"
            value={(hp.C as number) ?? 1.0}
            min={0.01} max={10} step={0.01}
            onChange={(v) => setParam('C', v)}
            format={(v) => v.toFixed(2)}
            tooltip="Controls how strictly the model is penalized for complexity. LOW (0.1) = heavily constrained, simple decision boundary, unlikely to overfit. HIGH (5+) = loosely constrained, can find complex patterns but risks memorizing training data noise. Start at 1.0 and lower if your backtest looks suspiciously good."
          />
          <Slider
            label="Max Iterations"
            value={(hp.max_iter as number) ?? 1000}
            min={100} max={5000} step={100}
            onChange={(v) => setParam('max_iter', v)}
            tooltip="How many optimization steps the algorithm runs before stopping. Increase if you see convergence warnings in the logs. 1000 is sufficient for most cases. Higher values slow training but won't hurt accuracy if the model already converged."
          />
        </>
      )}

      {/* LightGBM hyperparams */}
      {value.model_type === 'lgbm' && (
        <>
          <Slider label="N Estimators" value={(hp.n_estimators as number) ?? 300} min={100} max={600} step={50} onChange={(v) => setParam('n_estimators', v)}
            tooltip="Number of boosting trees. More trees = more powerful but slower to train and more likely to overfit. 200-400 is a good range for gold signals. Use the Optimize button to find the ideal count automatically." />
          <Slider label="Max Depth" value={(hp.max_depth as number) ?? 5} min={2} max={10} step={1} onChange={(v) => setParam('max_depth', v)}
            tooltip="Maximum depth of each tree. Shallow (2-3) = simple patterns, robust. Deep (7-8) = complex nonlinear patterns, higher overfit risk. For financial data 4-6 is the sweet spot." />
          <Slider label="Learning Rate" value={(hp.learning_rate as number) ?? 0.05} min={0.005} max={0.3} step={0.005} onChange={(v) => setParam('learning_rate', v)} format={(v) => v.toFixed(3)}
            tooltip="How much each new tree corrects the previous ones. Low (0.01-0.05) = small careful corrections, needs more trees but more robust. High (0.1+) = aggressive learning, faster but unstable. Lower learning rate usually needs higher N Estimators." />
          <Slider label="Num Leaves" value={(hp.num_leaves as number) ?? 31} min={15} max={63} step={4} onChange={(v) => setParam('num_leaves', v)}
            tooltip="Maximum number of leaf nodes per tree (LightGBM-specific). More leaves = more complex model. Should be ≤ 2^max_depth. E.g., max_depth=5 → max 31 leaves makes sense. Higher values can improve accuracy but increase overfitting." />
          <Slider label="Subsample" value={(hp.subsample as number) ?? 0.8} min={0.5} max={1.0} step={0.05} onChange={(v) => setParam('subsample', v)} format={(v) => v.toFixed(2)}
            tooltip="Fraction of training bars used to build each tree. 0.8 = each tree only sees 80% of the data (randomly selected). This reduces overfitting and adds diversity between trees. Values 0.6-0.9 work well." />
          <Slider label="ColSample by Tree" value={(hp.colsample_bytree as number) ?? 0.8} min={0.5} max={1.0} step={0.05} onChange={(v) => setParam('colsample_bytree', v)} format={(v) => v.toFixed(2)}
            tooltip="Fraction of FEATURES used for each tree. 0.8 = each tree considers 80% of your selected features randomly. This prevents any single feature from dominating and makes the ensemble more robust. Similar to 'feature bagging'." />
        </>
      )}

      {/* XGBoost hyperparams */}
      {value.model_type === 'xgboost' && (
        <>
          <Slider label="N Estimators" value={(hp.n_estimators as number) ?? 200} min={50} max={1000} step={50} onChange={(v) => setParam('n_estimators', v)}
            tooltip="Number of decision trees in the ensemble. More trees = more powerful but slower to train and more prone to overfitting. 100-300 for intraday; 200-600 for daily. Use the Optimize button to find the ideal number automatically." />
          <Slider label="Max Depth" value={(hp.max_depth as number) ?? 4} min={2} max={10} step={1} onChange={(v) => setParam('max_depth', v)}
            tooltip="Maximum depth of each tree. Shallow trees (2-3) = simple patterns only, hard to overfit. Deep trees (7-8) = complex nonlinear patterns but high overfitting risk. For financial time series, 3-5 is the sweet spot." />
          <Slider label="Learning Rate" value={(hp.learning_rate as number) ?? 0.05} min={0.005} max={0.3} step={0.005} onChange={(v) => setParam('learning_rate', v)} format={(v) => v.toFixed(3)}
            tooltip="How much each new tree corrects the previous ones. Low (0.01-0.05) = small careful steps, more stable but needs more trees. High (0.1+) = fast learning but risky. A low learning rate with more trees almost always beats a high learning rate with fewer." />
          <Slider label="Subsample" value={(hp.subsample as number) ?? 0.8} min={0.5} max={1.0} step={0.05} onChange={(v) => setParam('subsample', v)} format={(v) => v.toFixed(2)}
            tooltip="Fraction of training bars used to build each tree. 0.8 = each tree sees a random 80% of the data. Reduces overfitting. Think of it as training each tree on a slightly different random sample of gold history." />
          <Slider label="ColSample by Tree" value={(hp.colsample_bytree as number) ?? 0.8} min={0.5} max={1.0} step={0.05} onChange={(v) => setParam('colsample_bytree', v)} format={(v) => v.toFixed(2)}
            tooltip="Fraction of FEATURES each tree can use. 0.8 = each tree randomly picks 80% of your selected features. Prevents the model from relying too heavily on any single indicator and makes predictions more robust." />
        </>
      )}
    </div>
  )
}
