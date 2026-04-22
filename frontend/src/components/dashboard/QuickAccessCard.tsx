import Link from 'next/link'

interface QuickAccessCardProps {
  href: string
  icon: string
  label: string
  description: string
  count?: number | string | null
  countLabel?: string
}

export default function QuickAccessCard({
  href,
  icon,
  label,
  description,
  count,
  countLabel,
}: QuickAccessCardProps) {
  return (
    <Link href={href} className="quick-card">
      <span className="quick-card__icon">{icon}</span>
      <span className="quick-card__label">{label}</span>
      <span className="quick-card__desc">{description}</span>
      {count != null && (
        <span className="quick-card__count">
          {count}
          {countLabel && (
            <span
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-muted)',
                fontWeight: 500,
                marginLeft: 4,
              }}
            >
              {countLabel}
            </span>
          )}
        </span>
      )}
    </Link>
  )
}
