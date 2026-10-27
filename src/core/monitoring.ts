/**
 * Last-resort logging for things that escape React: crashes outside the render
 * tree, rejected promises nobody awaited, and connectivity changes (which
 * matter a lot for a realtime app).
 */
import { createLogger } from './logger'

const log = createLogger('global')

export function installGlobalErrorHandlers(): void {
  if (typeof window === 'undefined') return

  window.addEventListener('error', (event) => {
    // Resource failures (a missing image, say) bubble here with no error object.
    if (!event.error && !event.message) return
    log.error('uncaught error', {
      message: event.message,
      source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
      error: event.error,
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    log.error('unhandled promise rejection', { reason: event.reason })
  })

  window.addEventListener('online', () => log.info('network back online'))
  window.addEventListener('offline', () => log.warn('network offline - realtime will pause'))
}
