import React from 'react'

type BadgeVariant =
  | 'bull'
  | 'short'
  | 'active'
  | 'trained'
  | 'training'
  | 'created'
  | 'tf'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
}

export default function Badge({ variant, children, className = '' }: BadgeProps) {
  const classes = ['badge', variant ? `badge--${variant}` : '', className]
    .filter(Boolean)
    .join(' ')
  return <span className={classes}>{children}</span>
}
