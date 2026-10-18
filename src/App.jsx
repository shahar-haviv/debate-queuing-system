import { Navigate, Route, Routes } from 'react-router-dom'
import { isConfigured } from './lib/supabase'
import ConfigBanner from './components/ConfigBanner'
import RequireAdmin from './components/RequireAdmin'
import Login from './pages/Login'
import Admin from './pages/Admin'
import CandidateView from './pages/CandidateView'

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
      <Route path="/candidate/:id" element={<CandidateView />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
