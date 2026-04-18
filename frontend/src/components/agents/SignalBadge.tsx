import { fmtConfidence } from '@/lib/formatters'
import type { SignalOut } from '@/types'

interface SignalBadgeProps {
  signal: SignalOut | null | undefined
  showConfidence?: boolean
}

export default function SignalBadge({ signal, showConfidence = true }: SignalBadgeProps) {
  if (!signal) {
    return <span className="badge badge--created">—</span>
  }

  const isBull = signal.signal === 'BULL'
  return (
    <span className={`badge badge--${isBull ? 'bull' : 'short'}`}>
      {isBull ? '▲' : '▼'} {signal.signal}
      {showConfidence && ` ${fmtConfidence(signal.confidence)}`}
    </span>
  )
}
