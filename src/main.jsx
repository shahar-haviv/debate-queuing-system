import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './hooks/useAuth.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import RouteLogger from './components/RouteLogger.jsx'
import DebugPanel from './components/DebugPanel.jsx'
import { installGlobalErrorHandlers } from './lib/monitoring.js'
import { logger } from './lib/logger.js'
import './index.css'

installGlobalErrorHandlers()

logger.info('app boot', {
  mode: import.meta.env.MODE,
  url: window.location.href,
  userAgent: navigator.userAgent,
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <RouteLogger />
        <AuthProvider>
          <App />
        </AuthProvider>
        <DebugPanel />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
