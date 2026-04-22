'use client'

import { useEffect, useRef } from 'react'

export default function XAUTicker() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || container.childElementCount > 0) return

    const widgetDiv = document.createElement('div')
    widgetDiv.className = 'tradingview-widget-container__widget'
    container.appendChild(widgetDiv)

    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-symbol-info.js'
    script.async = true
    script.innerHTML = JSON.stringify({
      symbol: 'OANDA:XAUUSD',
      width: '100%',
      locale: 'en',
      colorTheme: 'dark',
      isTransparent: true,
    })
    container.appendChild(script)

    return () => {
      container.innerHTML = ''
    }
  }, [])

  return (
    <div
      className="ticker-wrap"
      style={{ padding: 0, minHeight: 80, alignItems: 'stretch' }}
    >
      <div
        className="tradingview-widget-container"
        ref={containerRef}
        style={{ width: '100%', minHeight: 80 }}
      />
    </div>
  )
}
