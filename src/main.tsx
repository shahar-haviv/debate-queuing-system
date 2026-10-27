import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './hooks/useAuth'
import { envStatus } from './core/env'
import { ServicesProvider } from './services/container'
import ErrorBoundary from './components/ui/ErrorBoundary'
import ConfigBanner from './components/ui/ConfigBanner'
import RouteLogger from './components/features/RouteLogger'
import DebugPanel from './components/ui/DebugPanel'
import { installGlobalErrorHandlers } from './core/monitoring'
import { logger } from './core/logger'
import './index.css'

installGlobalErrorHandlers()

logger.info('app boot', {
  mode: import.meta.env.MODE,
  url: window.location.href,
  userAgent: navigator.userAgent,
})

const root = document.getElementById('root')
if (!root) throw new Error('#root is missing from index.html')

// The composition root: services are built once here (lazily), and every hook
// below reads them from context. Swapping Supabase for another backend means
// passing a different DatabaseService to this provider - no UI change.
if (!envStatus.ok) {
  // Fail fast and explain: no service is constructed without valid config.
  logger.error('environment invalid - refusing to start', { problems: envStatus.problems })
  ReactDOM.createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <ConfigBanner problems={envStatus.problems} />
      </ErrorBoundary>
    </StrictMode>,
  )
} else {
  ReactDOM.createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <ServicesProvider>
          <BrowserRouter>
            <RouteLogger />
            <AuthProvider>
              <App />
            </AuthProvider>
            <DebugPanel />
          </BrowserRouter>
        </ServicesProvider>
      </ErrorBoundary>
    </StrictMode>,
  )
}
