'use client'

import type { Agent } from '@/types'

interface Metric {
  key: string
  label: string
  value: string
  status: 'good' | 'warn' | 'bad'
  what: string    // what this metric means
  why: string     // why it's good/bad right now
  fix?: string    // what to change
}

const THRESHOLDS = {
  sharpe:          { good: 0.5,   warn: 0 },
  win_rate:        { good: 0.55,  warn: 0.48 },
  precision:       { good: 0.50,  warn: 0.40 },
  ic_score:        { good: 0.05,  warn: 0.02 },
  signal_stability:{ good: 0.70,  warn: 0.50 },
}

function status(val: number, t: { good: number; warn: number }): 'good' | 'warn' | 'bad' {
  return val >= t.good ? 'good' : val >= t.warn ? 'warn' : 'bad'
}

function buildMetrics(m: Record<string, number>, agent: Agent): Metric[] {
  const out: Metric[] = []

  // ── IC Score (most important) ──────────────────────────────────────────
  if (m.ic_score != null) {
    const ic = m.ic_score
    const s  = status(Math.abs(ic), THRESHOLDS.ic_score)
    out.push({
      key: 'ic', label: 'IC Score', value: ic.toFixed(3), status: s,
      what: 'Spearman correlation between model probabilities and actual future returns. The purest measure of whether your features can predict gold price direction.',
      why: s === 'good'
        ? 'Features have genuine predictive power — the model is not just memorising noise.'
        : s === 'warn'
        ? 'Weak but real signal. More data or tighter feature selection could amplify this.'
        : 'Near zero — features have no detectable relationship with future returns at this horizon/threshold.',
      fix: s === 'bad'
        ? `Go to Intelligence → Edge Discovery, select ${agent.timeframe}, click Compute. Remove features where |IC| < 0.02. Then Train again.`
        : undefined,
    })
  }

  // ── Class imbalance detector ───────────────────────────────────────────
  if (m.accuracy != null && m.precision != null) {
    const acc  = m.accuracy
    const prec = m.precision
    if (acc > 0.75 && prec < 0.42) {
      out.push({
        key: 'imbalance', label: 'Class Imbalance', value: `${(acc*100).toFixed(0)}% acc / ${(prec*100).toFixed(0)}% prec`,
        status: 'bad',
        what: 'When accuracy is high but precision is low, the model learned to always predict SHORT (the majority class) to boost accuracy — not because it is genuinely good at predicting direction.',
        why: `With threshold ${(agent.target_threshold*100).toFixed(2)}% on ${agent.timeframe}, only ~${(prec*100*0.3).toFixed(0)}–${(prec*100*0.5).toFixed(0)}% of bars are labelled BULL. The model takes the easy path and predicts SHORT almost every time.`,
        fix: `In Edit Config → Step 4, raise target_threshold to ${(agent.target_threshold*200).toFixed(2)}% or increase horizon from ${agent.target_horizon} to ${agent.target_horizon + 3} bars. This makes BULL labels rarer but more reliable.`,
      })
    }
  }

  // ── Sharpe ratio ──────────────────────────────────────────────────────
  if (m.sharpe != null) {
    const sh = m.sharpe
    const s  = status(sh, THRESHOLDS.sharpe)
    out.push({
      key: 'sharpe', label: 'Sharpe Ratio', value: sh.toFixed(2), status: s,
      what: 'Return divided by volatility of returns, annualised. > 0.5 is strong; > 1.0 is exceptional. Negative means the strategy is destroying capital.',
      why: s === 'good'
        ? 'Strong risk-adjusted return — the strategy has real edge after costs.'
        : s === 'warn'
        ? 'Positive but thin. After live-trading slippage this may turn negative.'
        : 'Negative Sharpe. The strategy loses money net of the 0.1% round-trip commission.',
      fix: sh < 0
        ? `Raise target_threshold (each signal must predict a larger move to justify the commission cost) or increase horizon to allow patterns more time to express.`
        : sh < 0.3
        ? 'Run Optimize (100+ trials) to fine-tune hyperparameters, or use Edge Discovery to remove low-IC features.'
        : undefined,
    })
  }

  // ── Win rate ─────────────────────────────────────────────────────────
  if (m.win_rate != null) {
    const wr = m.win_rate
    const s  = status(wr, THRESHOLDS.win_rate)
    out.push({
      key: 'winrate', label: 'Win Rate', value: `${(wr*100).toFixed(1)}%`, status: s,
      what: 'Fraction of closed backtest trades that were profitable. Does NOT account for trade size — a strategy with 40% win rate can still be profitable if winners are bigger than losers.',
      why: s === 'good'
        ? 'Most trades are profitable. Combined with a positive Sharpe this is a solid result.'
        : s === 'warn'
        ? 'Near coin-flip. Profitability depends on good risk/reward ratio (check Profit Factor).'
        : 'Most trades lose money. The model is not finding the right direction.',
      fix: wr < 0.48
        ? 'Check signal_stability — if it is low (<50%), excessive signal flips are causing losers. Increase horizon or threshold.'
        : undefined,
    })
  }

  // ── Signal stability ──────────────────────────────────────────────────
  if (m.signal_stability != null) {
    const ss = m.signal_stability
    const s  = status(ss, THRESHOLDS.signal_stability)
    out.push({
      key: 'stability', label: 'Signal Stability', value: `${(ss*100).toFixed(0)}%`, status: s,
      what: 'Fraction of consecutive bars where the signal does NOT flip. Low = the model oscillates BULL→SHORT→BULL constantly, paying commission every flip. High = model holds a direction.',
      why: s === 'good'
        ? 'Model holds its direction — low signal churn, commission cost is manageable.'
        : s === 'warn'
        ? 'Some oscillation. Monitor in the Setup Tester with realistic SL/TP.'
        : 'Very high churn. The strategy is whipsawing — every flip pays the commission and usually loses.',
      fix: ss < 0.5
        ? `Horizon ${agent.target_horizon} bars is too short — signals flip on every noise tick. Increase horizon to ${Math.max(agent.target_horizon * 2, 4)} bars.`
        : undefined,
    })
  }

  // ── Bootstrap Sharpe CI ──────────────────────────────────────────────
  if (m.sharpe_ci_low != null && m.sharpe_ci_high != null) {
    const lo = m.sharpe_ci_low
    const s  = lo > 0 ? 'good' : lo > -0.3 ? 'warn' : 'bad'
    out.push({
      key: 'ci', label: 'Sharpe 95% CI', value: `[${lo.toFixed(2)}, ${m.sharpe_ci_high.toFixed(2)}]`,
      status: s,
      what: '95% confidence interval for the Sharpe ratio from 1000 bootstrap resamplings of trade PnLs. If the lower bound is negative the observed Sharpe may be due to luck.',
      why: s === 'good'
        ? 'Even in adverse scenarios the Sharpe stays positive — results are statistically robust.'
        : 'CI includes negative Sharpe. The strategy may not be statistically significant.',
      fix: s !== 'good'
        ? 'Run Monte Carlo (Simulate tab) to quantify probability of ruin. Aim for p-value < 0.05.'
        : undefined,
    })
  }

  return out
}

// ── Priority recommendation ────────────────────────────────────────────────

function topRecommendation(metrics: Metric[]): string | null {
  const bad = metrics.filter(m => m.status === 'bad' && m.fix)
  if (bad.length === 0) {
    const warn = metrics.filter(m => m.status === 'warn' && m.fix)
    if (warn.length === 0) return null
    return warn[0].fix!
  }
  // Prioritise imbalance > ic > stability > sharpe
  const priority = ['imbalance', 'ic', 'stability', 'sharpe']
  for (const key of priority) {
    const found = bad.find(m => m.key === key && m.fix)
    if (found) return found.fix!
  }
  return bad[0].fix!
}

// ── Status colour ──────────────────────────────────────────────────────────

const STATUS_STYLE = {
  good: { bg: 'oklch(65% 0.18 145 / 0.08)', border: 'oklch(65% 0.18 145 / 0.3)', dot: 'var(--color-bull)', label: '●' },
  warn: { bg: 'oklch(72% 0.14 85  / 0.08)', border: 'oklch(72% 0.14 85  / 0.3)', dot: 'var(--color-gold)', label: '◐' },
  bad:  { bg: 'oklch(60% 0.20 25  / 0.08)', border: 'oklch(60% 0.20 25  / 0.3)', dot: 'var(--color-bear)', label: '✕' },
}

// ── Main component ─────────────────────────────────────────────────────────

interface Props {
  agent:    Agent
  metrics:  Record<string, number>
}

export default function TrainingDiagnostics({ agent, metrics }: Props) {
  const items = buildMetrics(metrics, agent)
  if (items.length === 0) return null

  const top = topRecommendation(items)
  const allGood = items.every(i => i.status === 'good')

  return (
    <div style={{ marginTop: 'var(--space-4)' }}>
      <h4 style={{
        fontSize: 'var(--text-xs)', color: 'var(--color-muted)',
        textTransform: 'uppercase', letterSpacing: '0.08em',
        marginBottom: 'var(--space-3)',
      }}>
        Signal Health
      </h4>

      {/* Top recommendation */}
      {top && (
        <div style={{
          background: 'oklch(72% 0.14 85 / 0.07)',
          border: '1px solid oklch(72% 0.14 85 / 0.3)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-3) var(--space-4)',
          marginBottom: 'var(--space-4)',
        }}>
          <p style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--color-gold)', marginBottom: 4 }}>
            ⚡ Recommended next action
          </p>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text)', lineHeight: 1.6 }}>{top}</p>
        </div>
      )}
      {allGood && (
        <div style={{
          background: 'oklch(65% 0.18 145 / 0.07)',
          border: '1px solid oklch(65% 0.18 145 / 0.3)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-3) var(--space-4)',
          marginBottom: 'var(--space-4)',
        }}>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-bull)' }}>
            ✓ All indicators healthy. Activate the agent and monitor live signals. Run Monte Carlo to stress-test.
          </p>
        </div>
      )}

      {/* Metric cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {items.map(item => {
          const sty = STATUS_STYLE[item.status]
          return (
            <details key={item.key} style={{
              background: sty.bg,
              border: `1px solid ${sty.border}`,
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2) var(--space-3)',
              cursor: 'pointer',
            }}>
              <summary style={{
                display: 'flex', alignItems: 'center', gap: 8,
                listStyle: 'none', userSelect: 'none',
              }}>
                <span style={{ color: sty.dot, fontWeight: 700, fontSize: 'var(--text-sm)' }}>
                  {sty.label}
                </span>
                <span style={{ flex: 1, fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                  {item.label}
                </span>
                <span style={{
                  fontFamily: 'var(--font-mono), monospace',
                  fontSize: 'var(--text-sm)', fontWeight: 700,
                  color: sty.dot,
                }}>
                  {item.value}
                </span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginLeft: 4 }}>
                  ▸
                </span>
              </summary>

              <div style={{ marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)',
                borderTop: `1px solid ${sty.border}` }}>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginBottom: 'var(--space-1)' }}>
                  <strong style={{ color: 'var(--color-text)' }}>What it measures:</strong> {item.what}
                </p>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginBottom: item.fix ? 'var(--space-1)' : 0 }}>
                  <strong style={{ color: 'var(--color-text)' }}>Right now:</strong> {item.why}
                </p>
                {item.fix && (
                  <p style={{
                    fontSize: 'var(--text-xs)',
                    background: 'oklch(72% 0.14 85 / 0.1)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--space-2) var(--space-3)',
                    marginTop: 'var(--space-2)',
                    lineHeight: 1.6,
                    color: 'var(--color-text)',
                  }}>
                    <strong style={{ color: 'var(--color-gold)' }}>→ Fix:</strong> {item.fix}
                  </p>
                )}
              </div>
            </details>
          )
        })}
      </div>
    </div>
  )
}
