'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/',             label: 'Dashboard'    },
  { href: '/chart',        label: 'Chart'        },
  { href: '/agents',       label: 'Agents'       },
  { href: '/lab',          label: 'Lab'          },
  { href: '/portfolio',    label: 'Portfolio'    },
  { href: '/intelligence', label: 'Intelligence' },
  { href: '/simulate',     label: 'Simulate'     },
  { href: '/assistant',    label: 'Assistant'    },
]

export default function Navbar() {
  const pathname = usePathname()

  return (
    <nav className="navbar">
      <div className="navbar__logo">
        <span className="navbar__logo-mark">◈</span>
        <span>Trader&rsquo;s Flock</span>
      </div>

      <div className="navbar__links">
        {LINKS.map(({ href, label }) => {
          const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`navbar__link${isActive ? ' navbar__link--active' : ''}`}
            >
              {label}
            </Link>
          )
        })}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-muted)',
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'var(--color-bull)',
            display: 'inline-block',
          }}
        />
        XAUUSD
      </div>
    </nav>
  )
}
