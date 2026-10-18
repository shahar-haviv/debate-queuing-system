import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { createLogger } from '../lib/logger.js'

const log = createLogger('route')

/**
 * Route middleware: records every navigation so the debug log always shows
 * which screen an action belonged to.
 */
export default function RouteLogger() {
  const location = useLocation()
  const previous = useRef(null)

  useEffect(() => {
    const from = previous.current
    const to = `${location.pathname}${location.search}`
    previous.current = location.pathname
    if (from === location.pathname) return
    log.info(`${from ?? '(start)'} → ${to}`)
  }, [location])

  return null
}
