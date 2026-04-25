import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import Fridge from './pages/Fridge'
import History from './pages/History'
import Settings from './pages/Settings'
import RecipeDetail from './pages/RecipeDetail'
import PrivacyPolicy from './pages/PrivacyPolicy'
import Admin from './pages/Admin'
import Payslip from './pages/Payslip'
import Splash from './components/Splash'

function PrivateRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <Splash />
  return user ? children : <Navigate to="/login" />
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <Splash />
  return !user ? children : <Navigate to="/" />
}

function OnboardingGuard({ children }) {
  const { userProfile, loading } = useAuth()
  if (loading) return <Splash />
  if (userProfile && !userProfile.onboardingComplete) {
    return <Navigate to="/onboarding" />
  }
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
      <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
      <Route path="/admin" element={<PrivateRoute><Admin /></PrivateRoute>} />
      <Route path="/onboarding" element={<PrivateRoute><Onboarding /></PrivateRoute>} />
      <Route path="/recipe/:id" element={<PrivateRoute><OnboardingGuard><RecipeDetail /></OnboardingGuard></PrivateRoute>} />
      <Route element={<PrivateRoute><OnboardingGuard><Layout /></OnboardingGuard></PrivateRoute>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/fridge" element={<Fridge />} />
        <Route path="/history" element={<History />} />
        <Route path="/payslip" element={<Payslip />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}
