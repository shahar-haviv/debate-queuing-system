import { Navigate, Route, Routes } from 'react-router-dom'
import { isConfigured } from './lib/supabase'
import ConfigBanner from './components/ConfigBanner'
import RequireAdmin from './components/RequireAdmin'
import Login from './pages/Login'
import Admin from './pages/Admin'
import CandidateView from './pages/CandidateView'
import RoomView from './pages/RoomView'

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
