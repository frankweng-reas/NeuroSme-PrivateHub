/** 共用：Agent 頁面 header + 內容區，與 template 樣式一致 */
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { getMe } from '@/api/users'
import { useAuth } from '@/contexts/AuthContext'
import { AvatarCircle } from '@/components/AvatarCircle'
import ProfileModal from '@/components/ProfileModal'
import type { ReactNode } from 'react'
import type { User } from '@/types'

export interface AgentPageLayoutProps {
  /** 標題（顯示於 header） */
  title: string
  /** 返回按鈕連結，預設 "/" */
  backHref?: string
  /** 可選：自訂 header 圖示元件 */
  headerIcon?: ReactNode
  /** 內容區 */
  children: ReactNode
}

export default function AgentPageLayout({
  title,
  backHref = '/',
  headerIcon,
  children,
}: AgentPageLayoutProps) {
  const { user: authUser, logout } = useAuth()
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!authUser) return
    getMe().then(setUser).catch(() => setUser(null))
  }, [authUser])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    if (userMenuOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [userMenuOpen])

  const displayName = user?.display_name || user?.username || authUser?.email?.split('@')[0] || 'U'

  return (
    <div className="flex h-full flex-col p-4 text-[18px]">
      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
      <header
        className="flex-shrink-0 rounded-2xl border-b border-gray-200 px-6 py-4 shadow-sm"
        style={{ backgroundColor: '#4b5563' }}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {headerIcon}
            <h1 className="text-2xl font-bold text-white">{title}</h1>
          </div>
          <div className="flex items-center gap-3">
            {/* 頭像 dropdown */}
            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setUserMenuOpen((o) => !o)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/30 overflow-hidden transition-opacity hover:opacity-80"
                aria-label="使用者選單"
              >
                <AvatarCircle avatarB64={user?.avatar_b64} name={displayName} size={36} />
              </button>
              {userMenuOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 min-w-[200px] rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
                  <div className="flex items-center gap-3 bg-gray-50 border-b border-gray-100 px-4 py-3">
                    <AvatarCircle avatarB64={user?.avatar_b64} name={displayName} size={32} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">{displayName}</p>
                      <p className="truncate text-xs text-gray-500">{authUser?.email ?? user?.email ?? '-'}</p>
                    </div>
                  </div>
                  <div className="py-1">
                    <button
                      type="button"
                      onClick={() => { setProfileOpen(true); setUserMenuOpen(false) }}
                      className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                    >
                      個人設定
                    </button>
                  </div>
                  <div className="border-t border-gray-100 py-1">
                    <button
                      type="button"
                      onClick={() => { logout(); navigate('/login'); setUserMenuOpen(false) }}
                      className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                    >
                      登出
                    </button>
                  </div>
                </div>
              )}
            </div>
            <Link
              to={backHref}
              className="flex items-center text-white transition-opacity hover:opacity-80"
              aria-label="返回"
            >
              <ArrowLeft className="h-6 w-6" />
            </Link>
          </div>
        </div>
      </header>
      <div className="mt-4 flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  )
}
