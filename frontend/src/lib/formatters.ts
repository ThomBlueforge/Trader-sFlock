/** Format a price number with 2 decimal places and commas. */
export function fmtPrice(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** Format a ratio as a percentage, e.g. 0.123 → "+12.30%" */
export function fmtPct(n: number, decimals = 2, showSign = true): string {
  const sign = showSign && n > 0 ? '+' : ''
  return `${sign}${(n * 100).toFixed(decimals)}%`
}

/** Format confidence 0–1 as "72.5%" */
export function fmtConfidence(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

/** Format unix-milliseconds as "Apr 17" */
export function fmtDateMs(tsMs: number): string {
  return new Date(tsMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Format unix-seconds as "Apr 17, 14:30" */
export function fmtDateTimeSec(tsSec: number): string {
  return new Date(tsSec * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Format unix-seconds relative to now, e.g. "3m ago" */
export function fmtRelative(tsSec: number): string {
  const diffSec = Math.floor(Date.now() / 1000 - tsSec)
  if (diffSec < 60) return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86400)}d ago`
}

/** Short number display: 10500 → "10.5K" */
export function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toFixed(2)
}
