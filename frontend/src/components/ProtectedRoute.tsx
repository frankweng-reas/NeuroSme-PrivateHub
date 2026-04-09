/** 需登入才能存取的路由，未登入則導向 /login */
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

const LOGIN_RETURN_URL_KEY = 'login_return_url'

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500">載入中...</p>
      </div>
    )
  }

  if (!isAuthenticated) {
    const path = `${location.pathname}${location.search}`
    if (path && !path.startsWith('/login')) {
      sessionStorage.setItem(LOGIN_RETURN_URL_KEY, path)
    }
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
