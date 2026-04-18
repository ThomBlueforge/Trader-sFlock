import React from 'react'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  glass?: boolean
}

export default function Card({ glass = false, className = '', children, ...rest }: CardProps) {
  const classes = ['card', glass ? 'card--glass' : '', className].filter(Boolean).join(' ')
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  )
}
