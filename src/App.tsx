import { Suspense, lazy } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { envStatus, isLocalSandboxEnabled } from './core/env'
import ConfigBanner from './components/ui/ConfigBanner'
import RequireAdmin from './components/features/RequireAdmin'
import { CurrentEventProvider } from './hooks/useCurrentEvent'
import Login from './pages/Login'
import MainOffice from './pages/MainOffice'
import Admin from './pages/Admin'
import EventHub from './pages/EventHub'
import EventPlanner from './pages/EventPlanner'
import FormStudio from './pages/FormStudio'
import CandidateView from './pages/CandidateView'
import RoomView from './pages/RoomView'

/**
 * The analytics page pulls in Recharts (~400 kB), and most sessions on a
 * screening day never open it. Splitting it out keeps the dispatch board on the
 * same fast first load it had before the charts existed.
 */
const Analytics = lazy(() => import('./pages/Analytics'))
const TrainingHub = lazy(() => import('./training/pages/TrainingHub'))

export default function App() {
  // Startup gate: no screen may render against an unvalidated environment unless Local Sandbox is enabled.
  if (!envStatus.ok && !isLocalSandboxEnabled()) return <ConfigBanner problems={envStatus.problems} />

  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* Club Training & Smart BP Room Draw Module (src/training) */}
      <Route
        path="/training"
        element={
          <Suspense
            fallback={
              <div className="min-h-screen bg-background">
                <p className="mx-auto max-w-6xl px-4 py-10 text-sm text-muted-foreground">
                  Loading Training…
                </p>
              </div>
            }
          >
            <TrainingHub />
          </Suspense>
        }
      />

      {/* Every Back Office route shares one admin gate. */}
      <Route
        element={
          <RequireAdmin>
            <Outlet />
          </RequireAdmin>
        }
      >
        <Route path="/" element={<MainOffice />} />
        <Route path="/home" element={<MainOffice />} />
        <Route path="/admin" element={<EventHub />} />
        <Route path="/admin/training" element={<Navigate to="/training" replace />} />
        <Route path="/admin/forms" element={<FormStudio />} />
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
          <Route path="forms" element={<FormStudio />} />
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
