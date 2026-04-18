'use client'

import type { Trade } from '@/types'
import { fmtPrice, fmtDateTimeSec } from '@/lib/formatters'

interface TradeLogProps {
  trades: Trade[]
}

export default function TradeLog({ trades }: TradeLogProps) {
  if (trades.length === 0) {
    return (
      <p
        style={{
          textAlign: 'center',
          color: 'var(--color-muted)',
          fontSize: 'var(--text-sm)',
          padding: 'var(--space-8)',
        }}
      >
        No trades yet.
      </p>
    )
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            <th>Signal</th>
            <th>Entry</th>
            <th>Exit</th>
            <th>Qty</th>
            <th>PnL</th>
            <th>Opened</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const pnl = t.pnl
            const isOpen = t.status === 'open'
            return (
              <tr key={t.id}>
                <td>
                  <span
                    style={{
                      color: t.signal === 'BULL' ? 'var(--color-bull)' : 'var(--color-bear)',
                      fontWeight: 600,
                      fontSize: 'var(--text-xs)',
                    }}
                  >
                    {t.signal === 'BULL' ? '▲' : '▼'} {t.signal}
                  </span>
                </td>
                <td className="mono">{fmtPrice(t.entry_price)}</td>
                <td className="mono">
                  {t.exit_price != null ? fmtPrice(t.exit_price) : '—'}
                </td>
                <td className="mono">{t.quantity.toFixed(4)}</td>
                <td
                  className="mono"
                  style={{
                    color:
                      pnl == null
                        ? 'var(--color-muted)'
                        : pnl >= 0
                        ? 'var(--color-bull)'
                        : 'var(--color-bear)',
                    fontWeight: pnl != null ? 600 : 400,
                  }}
                >
                  {pnl != null ? (pnl >= 0 ? '+' : '') + fmtPrice(pnl) : '—'}
                </td>
                <td style={{ color: 'var(--color-muted)', fontSize: 'var(--text-xs)' }}>
                  {fmtDateTimeSec(t.opened_at)}
                </td>
                <td>
                  <span
                    style={{
                      fontSize: 'var(--text-xs)',
                      color: isOpen ? 'var(--color-gold)' : 'var(--color-muted)',
                    }}
                  >
                    {t.status}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
