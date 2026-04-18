'use client'

import { useCallback, useRef, useState } from 'react'
import { clearApiKey, extractConfig, getApiKey, streamMessage } from '@/lib/claude'
import type { AgentConfig, FeatureMeta } from '@/types'

export interface InlineChatMsg {
  id:        string
  role:      'user' | 'assistant'
  content:   string
  streaming: boolean
  config?:   AgentConfig | null
}

interface FormSnapshot {
  name:              string
  timeframe:         string
  features:          string[]
  model_type:        string
  hyperparams:       Record<string, number | string>
  target_horizon:    number
  target_threshold:  number
  train_window:      number
  position_size_pct: number
}

// ── Step-specific system prompts ───────────────────────────────────────────────

function buildStepPrompt(
  step:          number,
  form:          FormSnapshot,
  allFeatures:   FeatureMeta[],
): string {
  const featsByCategory: Record<string, string[]> = {}
  allFeatures.forEach(f => {
    if (!featsByCategory[f.category]) featsByCategory[f.category] = []
    featsByCategory[f.category].push(`${f.key} — ${f.name}`)
  })
  const featLines = Object.entries(featsByCategory)
    .map(([cat, keys]) => `  ${cat}: ${keys.join(' | ')}`)
    .join('\n')

  const currentSummary = `Agent: "${form.name || 'unnamed'}" | TF: ${form.timeframe} | Model: ${form.model_type} | Features selected: ${form.features.length > 0 ? form.features.join(', ') : 'none'}`

  const stepContext: Record<number, string> = {
    0: `We are on Step 1 — Identity. Help the user choose a name, color, and timeframe. Consider the timeframe carefully: 5m/15m for scalping, 1h/4h for swing, 1d for macro. Return a config_json block with name, timeframe, and color.`,

    1: `We are on Step 2 — Feature Selection.
CURRENTLY SELECTED: ${form.features.length > 0 ? form.features.join(', ') : '(none yet)'}
ALL AVAILABLE FEATURES BY CATEGORY:
${featLines}

Help the user select the right features for their gold trading strategy. Explain WHY each feature is relevant (DXY inverse, VIX safe-haven, RSI momentum, etc.). When you have a recommendation, return a config_json block with a "features" array — the user will see checkboxes update in real time.`,

    2: `We are on Step 3 — Model & Hyperparameters.
CURRENT: model_type=${form.model_type}, hyperparams=${JSON.stringify(form.hyperparams)}
OPTIONS: logreg (fast, interpretable, less overfit risk), xgboost (powerful, needs regularisation), lgbm (fastest, good for noisy intraday data).
Help configure the model. Return a config_json block with model_type and hyperparams when you have a recommendation.`,

    3: `We are on Step 4 — Training Configuration.
CURRENT: horizon=${form.target_horizon} bars, threshold=${(form.target_threshold * 100).toFixed(2)}%, train_window=${form.train_window}, position_size=${(form.position_size_pct * 100).toFixed(0)}%
horizon = how many bars ahead to predict (e.g. 5 bars on 1d = next week).
threshold = minimum price move to count as a BULL signal (too low = noise, too high = too few examples).
train_window = bars of history per training fold (too small = underfit, too large = stale patterns).
Return a config_json block when you have recommendations.`,
  }

  return `You are an expert gold (XAU/USD) trading strategy AI assistant, embedded directly in an agent builder wizard.
${currentSummary}
TIMEFRAME: ${form.timeframe} | STATUS: in wizard step ${step + 1}/4

${stepContext[step] ?? 'Help the user configure their gold trading agent.'}

ALWAYS explain your reasoning in 2-3 sentences, then produce a config_json block.
Wrap the JSON in: \`\`\`config_json\n{...}\n\`\`\`
Only include the fields relevant to the current step. Be concise — the user can see the form updating live.`
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useInlineChat(onApply: (config: AgentConfig) => void) {
  const [messages,  setMessages]  = useState<InlineChatMsg[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const historyRef = useRef<{ role: 'user' | 'assistant'; content: string }[]>([])

  const send = useCallback(async (
    userText:    string,
    step:        number,
    form:        FormSnapshot,
    allFeatures: FeatureMeta[],
  ) => {
    const key = getApiKey()
    if (!key) {
      setError('No API key — click ✨ to connect Claude.')
      return
    }

    setError(null)
    const userMsg: InlineChatMsg = {
      id:        crypto.randomUUID(),
      role:      'user',
      content:   userText,
      streaming: false,
    }
    setMessages(prev => [...prev.slice(-6), userMsg])
    historyRef.current = [...historyRef.current.slice(-6), { role: 'user', content: userText }]

    const assistantId = crypto.randomUUID()
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', streaming: true }])
    setStreaming(true)

    let full = ''
    try {
      full = await streamMessage(
        key,
        buildStepPrompt(step, form, allFeatures),
        historyRef.current.slice(-6),
        (token) => {
          full += token
          setMessages(prev => prev.map(m =>
            m.id === assistantId ? { ...m, content: full } : m
          ))
        },
        800,
      )

      const config = extractConfig(full)
      setMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, content: full, streaming: false, config } : m
      ))
      historyRef.current = [...historyRef.current, { role: 'assistant', content: full }]

      if (config) onApply(config)
    } catch (err) {
      const msg = String(err)
      // If Anthropic says the key is invalid, clear it and ask user to re-enter
      if (msg.includes('401') || msg.includes('invalid x-api-key') || msg.includes('authentication_error')) {
        clearApiKey()
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, content: 'Your API key was rejected by Anthropic (401). Please disconnect and re-enter a valid key.', streaming: false }
            : m
        ))
        setError('Key rejected — please re-enter.')
      } else {
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, content: '⚠ ' + msg, streaming: false }
            : m
        ))
        setError(msg)
      }
    } finally {
      setStreaming(false)
    }
  }, [onApply])

  const clear = useCallback(() => {
    setMessages([])
    historyRef.current = []
    setError(null)
  }, [])

  return { messages, streaming, error, send, clear }
}
