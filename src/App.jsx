import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { isConfigured } from './lib/supabase'
import ConfigBanner from './components/ConfigBanner'
import RequireAdmin from './components/RequireAdmin'
import Login from './pages/Login'
import Admin from './pages/Admin'
import CandidateView from './pages/CandidateView'
import RoomView from './pages/RoomView'

/**
 * The dashboard pulls in Recharts (~400 kB), and most sessions on a screening
 * day never open it. Splitting it out keeps the dispatch board on the same fast
 * first load it had before the charts existed.
 */
const Analytics = lazy(() => import('./pages/Analytics'))

export default function App() {
  if (!isConfigured) return <ConfigBanner />

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="/login" element={<Login />} />
      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <Admin />
          </RequireAdmin>
        }
      />
      {/* Read-only operational metrics. Staff-only: the ledger names candidates,
          rooms and interviewers. */}
      <Route
        path="/admin/analytics"
        element={
          <RequireAdmin>
            <Suspense
              fallback={
                <div className="min-h-screen bg-background">
                  <p className="mx-auto max-w-7xl px-4 py-10 text-sm text-muted-foreground">
                    Loading the dashboard…
                  </p>
                </div>
              }
            >
              <Analytics />
            </Suspense>
          </RequireAdmin>
        }
      />
      {/* The in-room rubric. Staff-only, like the dispatcher view: it shows a
          candidate's name and scores, so it sits behind the same admin gate. */}
      <Route
        path="/room/:roomId"
        element={
          <RequireAdmin>
            <RoomView />
          </RequireAdmin>
        }
      />
      <Route path="/candidate/:id" element={<CandidateView />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
