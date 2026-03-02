/** 根元件：定義路由 (/, /agent/:id, /admin) 與 Layout 包裝 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import AdminRoute from './components/AdminRoute'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import HomePage from './pages/HomePage'
import AgentPage from './pages/AgentPage'
import AdminPage from './pages/AdminPage'
import AdminAgentPermissions from './pages/admin/AdminAgentPermissions'
import AdminUsers from './pages/admin/AdminUsers'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import TestLLMChat from './pages/TestLLMChat'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/" element={<Layout />}>
            <Route
              index
              element={
                <ProtectedRoute>
                  <HomePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="agent/:id"
              element={
                <ProtectedRoute>
                  <AgentPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin"
              element={
                <ProtectedRoute>
                  <AdminRoute>
                    <AdminPage />
                  </AdminRoute>
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="agent-permissions" replace />} />
              <Route path="agent-permissions" element={<AdminAgentPermissions />} />
              <Route path="users" element={<AdminUsers />} />
            </Route>
            <Route
              path="dev-test-chat"
              element={
                <ProtectedRoute>
                  <TestLLMChat />
                </ProtectedRoute>
              }
            />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
