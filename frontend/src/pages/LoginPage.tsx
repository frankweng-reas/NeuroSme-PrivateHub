/** 登入頁：呼叫 LocalAuth /auth/login */
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

const RETURN_URL_KEY = 'login_return_url'

/** on-prem 等可設 VITE_AUTH_ALLOW_REGISTER=false、VITE_AUTH_ALLOW_FORGOT_PASSWORD=false */
function authUiEnabled(name: `VITE_${string}`): boolean {
  const v = import.meta.env[name] as string | undefined
  if (v === undefined || v === '') return true
  const s = String(v).trim().toLowerCase()
  return s !== 'false' && s !== '0' && s !== 'no'
}

const APP_NAME = (import.meta.env.VITE_APP_NAME as string | undefined)?.trim() || 'NeuroSme'

/** 僅 dev server 預填測試帳密；production build 欄位為空。上線前若改為永遠預填請刪除此判斷。 */
const DEV_DEFAULT_EMAIL = import.meta.env.DEV ? 'test01@test.com' : ''
const DEV_DEFAULT_PASSWORD = import.meta.env.DEV ? 'test@000' : ''

export default function LoginPage() {
  const [email, setEmail] = useState(DEV_DEFAULT_EMAIL)
  const [password, setPassword] = useState(DEV_DEFAULT_PASSWORD)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [searchParams] = useSearchParams()
  const isExpired = searchParams.get('expired') === '1'
  const isRegistered = searchParams.get('registered') === '1'
  const isPasswordChanged = searchParams.get('password_changed') === '1'
  const { login } = useAuth()
  const navigate = useNavigate()
  const allowRegister = authUiEnabled('VITE_AUTH_ALLOW_REGISTER')
  const allowForgotPassword = authUiEnabled('VITE_AUTH_ALLOW_FORGOT_PASSWORD')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      const returnUrl = sessionStorage.getItem(RETURN_URL_KEY)
      if (returnUrl) {
        sessionStorage.removeItem(RETURN_URL_KEY)
        navigate(returnUrl, { replace: true })
      } else {
        const postLogin =
          (import.meta.env.VITE_POST_LOGIN_PATH as string | undefined)?.trim() || ''
        navigate(postLogin || '/', { replace: true })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '登入失敗'
      if (msg.includes('密碼已過期')) {
        navigate('/change-password-expired', {
          replace: true,
          state: { email, password },
        })
        return
      }
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-lg">
        <h1 className="mb-6 text-center text-2xl font-bold text-gray-800">{APP_NAME} 登入</h1>
        {isRegistered && (
          <div
            className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
            role="alert"
          >
            註冊成功！請至您的信箱確認註冊，確認後即可登入
          </div>
        )}
        {isExpired && (
          <div
            className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
            role="alert"
          >
            您的登入已過期，請重新登入以繼續操作
          </div>
        )}
        {isPasswordChanged && (
          <div
            className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
            role="alert"
          >
            密碼已更新，請使用新密碼登入
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              密碼
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? '登入中...' : '登入'}
          </button>
        </form>
        {(allowRegister || allowForgotPassword) && (
          <p className="mt-4 text-center text-sm text-gray-500">
            {allowRegister && (
              <>
                尚未註冊？{' '}
                <Link to="/register" className="font-medium text-indigo-600 hover:text-indigo-500">
                  前往註冊
                </Link>
              </>
            )}
            {allowRegister && allowForgotPassword && ' · '}
            {allowForgotPassword && (
              <Link to="/forgot-password" className="font-medium text-indigo-600 hover:text-indigo-500">
                忘記密碼
              </Link>
            )}
          </p>
        )}
      </div>
    </div>
  )
}
