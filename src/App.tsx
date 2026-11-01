import { Suspense, lazy } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { envStatus } from './core/env'
import ConfigBanner from './components/ui/ConfigBanner'
import RequireAdmin from './components/features/RequireAdmin'
import { CurrentEventProvider } from './hooks/useCurrentEvent'
import Login from './pages/Login'
import Admin from './pages/Admin'
import EventHub from './pages/EventHub'
import EventPlanner from './pages/EventPlanner'
import CandidateView from './pages/CandidateView'
import RoomView from './pages/RoomView'

/**
 * The analytics page pulls in Recharts (~400 kB), and most sessions on a
 * screening day never open it. Splitting it out keeps the dispatch board on the
 * same fast first load it had before the charts existed.
 */
const Analytics = lazy(() => import('./pages/Analytics'))

export default function App() {
  // Startup gate: no screen may render against an unvalidated environment.
  if (!envStatus.ok) return <ConfigBanner problems={envStatus.problems} />

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="/login" element={<Login />} />

      {/* Every Back Office route shares one admin gate. */}
      <Route
        element={
          <RequireAdmin>
            <Outlet />
          </RequireAdmin>
        }
      >
        <Route path="/admin" element={<EventHub />} />
        <Route path="/admin/event/new" element={<EventPlanner />} />

        {/* The event id in the URL is the single source of truth for all
            nested data fetching; the provider resolves it once. */}
        <Route
          path="/admin/event/:id"
          element={
            <CurrentEventProvider>
              <Outlet />
            </CurrentEventProvider>
          }
        >
          <Route index element={<Navigate to="queue" replace />} />
          <Route path="queue" element={<Admin />} />
          <Route
            path="analytics"
            element={
              <Suspense
                fallback={
                  <div className="min-h-screen bg-background">
                    <p className="mx-auto max-w-7xl px-4 py-10 text-sm text-muted-foreground">
                      Loading the dashboard.
                    </p>
                  </div>
                }
              >
                <Analytics />
              </Suspense>
            }
          />
        </Route>

        {/* Old bookmarks land back on the hub rather than a dead route. */}
        <Route path="/admin/analytics" element={<Navigate to="/admin" replace />} />

        {/* The in-room rubric. Staff-only, like the dispatcher view: it shows a
            candidate's name and scores, so it sits behind the same admin gate. */}
        <Route path="/room/:roomId" element={<RoomView />} />
      </Route>

      <Route path="/candidate/:id" element={<CandidateView />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  )
}
