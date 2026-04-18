'use client'

import type { AgentConfig } from '@/types'

export const CLAUDE_MODEL        = 'claude-sonnet-4-6'
export const CONFIG_BLOCK_START  = '```config_json'
export const CONFIG_BLOCK_END    = '```'

// Required for direct browser → Anthropic API calls (bypasses CORS restriction)
const BROWSER_HEADERS = {
  'anthropic-version':                  '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',
  'content-type':                       'application/json',
} as const

// ── Secure key storage (AES-256-GCM) ─────────────────────────────────────────────────
// Ciphertext is stored in localStorage; the AES key lives in sessionStorage
// (cleared when all browser windows close).  The raw key never touches localStorage.

const LS_CIPHER = 'sg_key_enc'      // localStorage: base64(iv + ciphertext)
const SS_CRYPTO = 'sg_key_ck'       // sessionStorage: JWK of the AES key
const LS_LEGACY = 'startgold_claude_key'  // old plain-text key (migrated on first load)

// In-memory cache so getApiKey() stays synchronous
let _mem: string | null = null

/** Strip any character outside printable ASCII (32-126). */
function sanitizeKey(raw: string): string {
  return raw.replace(/[^\x20-\x7E]/g, '').trim()
}

async function _loadOrCreateCryptoKey(): Promise<CryptoKey> {
  const stored = sessionStorage.getItem(SS_CRYPTO)
  if (stored) {
    try {
      return await crypto.subtle.importKey(
        'jwk', JSON.parse(stored),
        { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
      )
    } catch { /* fall through and generate a fresh one */ }
  }
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
  )
  const jwk = await crypto.subtle.exportKey('jwk', key)
  sessionStorage.setItem(SS_CRYPTO, JSON.stringify(jwk))
  return key
}

async function _encrypt(plaintext: string): Promise<string> {
  const ck  = await _loadOrCreateCryptoKey()
  const iv  = crypto.getRandomValues(new Uint8Array(12))
  const enc = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, ck, new TextEncoder().encode(plaintext),
  )
  const buf = new Uint8Array(12 + enc.byteLength)
  buf.set(iv)
  buf.set(new Uint8Array(enc), 12)
  return btoa(String.fromCharCode(...buf))
}

async function _decrypt(b64: string): Promise<string | null> {
  try {
    const ck  = await _loadOrCreateCryptoKey()
    const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    const dec = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buf.slice(0, 12) }, ck, buf.slice(12),
    )
    return new TextDecoder().decode(dec)
  } catch { return null }
}

/**
 * Call once at app start (in AppProviders).
 * Decrypts the stored ciphertext into the in-memory cache.
 * If the session key is gone (new browser session), returns null —
 * the user will be prompted to re-enter their key.
 */
export async function initApiKey(): Promise<void> {
  if (typeof window === 'undefined' || _mem) return

  // Migrate old plain-text key if present
  const legacy = localStorage.getItem(LS_LEGACY)
  if (legacy) {
    localStorage.removeItem(LS_LEGACY)
    await setApiKey(legacy)   // re-store encrypted
    return
  }

  const cipher = localStorage.getItem(LS_CIPHER)
  if (!cipher) return

  // Session key gone (new browser session) — ciphertext useless without it
  if (!sessionStorage.getItem(SS_CRYPTO)) return

  const plain = await _decrypt(cipher)
  if (plain) _mem = sanitizeKey(plain)
}

/** Synchronous read from in-memory cache. */
export function getApiKey(): string | null {
  return _mem
}

/** Encrypt the key and persist; update in-memory cache. */
export async function setApiKey(key: string): Promise<void> {
  const clean = sanitizeKey(key)
  _mem = clean
  try {
    const cipher = await _encrypt(clean)
    localStorage.setItem(LS_CIPHER, cipher)
  } catch {
    /* Crypto unavailable (e.g. non-secure context) — key stays in memory only */
  }
}

/** Wipe everywhere. */
export function clearApiKey(): void {
  _mem = null
  sessionStorage.removeItem(SS_CRYPTO)
  localStorage.removeItem(LS_CIPHER)
  localStorage.removeItem(LS_LEGACY)
}

/**
 * Validate the key format locally (no network call).
 * Anthropic keys start with 'sk-ant-' and are at least 40 characters.
 * Full validity is confirmed on the first real message.
 */
export function validateApiKey(key: string): boolean {
  const clean = sanitizeKey(key)
  if (!clean) return false
  // Accept any key that starts with sk-ant- and is long enough
  if (clean.startsWith('sk-ant-') && clean.length >= 40) return true
  // Also accept generic sk- keys in case format changes
  if (clean.startsWith('sk-') && clean.length >= 30) return true
  return false
}

/**
 * Stream a response from the Claude Messages API.
 * onToken is called for each text token as it arrives.
 * Returns the full accumulated text.
 */
export async function streamMessage(
  apiKey:    string,
  system:    string,
  messages:  Message[],
  onToken:   (token: string) => void,
  maxTokens: number = 1024,
): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { ...BROWSER_HEADERS, 'x-api-key': sanitizeKey(apiKey) },
    body: JSON.stringify({
      model:      CLAUDE_MODEL,
      max_tokens: maxTokens,
      stream:     true,
      system,
      messages,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Claude API error ${res.status}: ${err}`)
  }

  const reader  = res.body!.getReader()
  const decoder = new TextDecoder()
  let   full    = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value, { stream: true })
    const lines = chunk.split('\n').filter((l) => l.startsWith('data: '))

    for (const line of lines) {
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue
      try {
        const parsed = JSON.parse(data)
        if (parsed.type === 'content_block_delta') {
          const token = parsed.delta?.text ?? ''
          full += token
          onToken(token)
        }
      } catch {
        // malformed SSE chunk — skip
      }
    }
  }

  return full
}

/** Extract a config_json block from an assistant message. */
export function extractConfig(text: string): AgentConfig | null {
  const start = text.indexOf(CONFIG_BLOCK_START)
  if (start === -1) return null
  const bodyStart = start + CONFIG_BLOCK_START.length
  const end = text.indexOf(CONFIG_BLOCK_END, bodyStart)
  if (end === -1) return null
  try {
    return JSON.parse(text.slice(bodyStart, end).trim()) as AgentConfig
  } catch {
    return null
  }
}

/** Build the dynamic system prompt injecting the feature registry and available options. */
export function buildSystemPrompt(
  featureList: { key: string; name: string; category: string }[],
  currentConfig?: Partial<Record<string, unknown>>,
): string {
  const featsByCategory: Record<string, string[]> = {}
  featureList.forEach((f) => {
    if (!featsByCategory[f.category]) featsByCategory[f.category] = []
    featsByCategory[f.category].push(`${f.key} (${f.name})`)
  })

  const featLines = Object.entries(featsByCategory)
    .map(([cat, keys]) => `  ${cat}: ${keys.join(', ')}`)
    .join('\n')

  const configSection = currentConfig
    ? `\nCurrent agent config:\n${JSON.stringify(currentConfig, null, 2)}\n`
    : ''

  return `You are the StartGold AI Strategy Assistant — an expert in gold (XAU/USD) trading strategy design.
Your role is to help users configure ML-based trading signal agents through natural language conversation.
You NEVER suggest executing real trades. You ONLY configure strategies and explain reasoning.

AVAILABLE FEATURES (by category):
${featLines}

AVAILABLE TIMEFRAMES: 5m, 15m, 30m, 1h, 2h, 4h, 1d
AVAILABLE MODEL TYPES: logreg (Logistic Regression), xgboost (XGBoost), lgbm (LightGBM)
PARAMETER RANGES:
  target_horizon: 1–20 bars
  target_threshold: 0.001–0.02 (fraction, e.g. 0.003 = 0.3%)
  train_window: 100–5000 bars
  position_size_pct: 0.05–0.5
${configSection}
When producing a complete strategy configuration, wrap the JSON in:
\`\`\`config_json
{
  "name": "...",
  "timeframe": "...",
  "features": [...],
  "model_type": "...",
  "hyperparams": {...},
  "target_horizon": 5,
  "target_threshold": 0.003,
  "train_window": 500,
  "position_size_pct": 0.1,
  "setup": {
    "hold_bars": 6,
    "stop_loss_pct": 0.005,
    "take_profit_pct": 0.010,
    "min_confidence": 0.0,
    "position_size_pct": 0.1,
    "start_date": "2022-01-01",
    "end_date": "2024-12-31"
  }
}
\`\`\`
The "setup" block is ALWAYS included and configures the SL/TP/hold tester.
hold_bars = number of bars to hold before time-exit (e.g. 6 bars on 15m = 1.5h).
stop_loss_pct and take_profit_pct are decimal fractions (0.005 = 0.5%).
start_date / end_date restrict the backtest period (ISO format, optional).
If the user only asks about setup parameters, you can return just the "setup" block without the agent config.

Explain your feature choices in terms of gold market dynamics:
- Safe-haven demand (risk-off flows, VIX spikes, geopolitical events)
- USD / DXY inverse correlation
- Real interest rate sensitivity (10Y yield minus inflation)
- Oil/commodity cycle correlation
- Technical regime (trending vs mean-reverting)

Be concise and direct. Never output more than one config block per message.`
}
