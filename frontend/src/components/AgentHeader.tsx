/** Agent 頁面共用 header：icon + 標題 + 返回連結 */
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Trash2, Upload, X } from 'lucide-react'
import AgentIcon from '@/components/AgentIcon'
import { getMe } from '@/api/users'
import { createQtnCatalog, deleteQtnCatalog, listQtnCatalogs, type QtnCatalogItem } from '@/api/qtnCatalogs'
import { useAuth } from '@/contexts/AuthContext'
import { ApiError } from '@/api/client'
import type { Agent } from '@/types'
import type { User } from '@/types'
import { AvatarCircle } from '@/components/AvatarCircle'
import ProfileModal from '@/components/ProfileModal'

function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.detail) return err.detail
  return err instanceof Error ? err.message : '操作失敗'
}

interface AgentHeaderProps {
  agent: Agent
  className?: string
  /** 是否顯示主管工具（僅報價型 agent 使用，其他 agent 不顯示） */
  showManagerTools?: boolean
  /** 是否顯示資料範本管理按鈕（manager 以上角色才顯示） */
  showSchemaManager?: boolean
  /** 點擊資料範本管理按鈕的 callback */
  onSchemaManagerOpen?: () => void
  /** 自訂 header 背景色，未傳則用預設 #4b5563 */
  headerBackgroundColor?: string
  /** 標題右側「使用說明」按鈕（例如開啟 HelpModal） */
  onOnlineHelpClick?: () => void
}

export default function AgentHeader({ agent, className = '', showManagerTools: showManagerToolsProp = false, showSchemaManager = false, onSchemaManagerOpen, headerBackgroundColor = '#4b5563', onOnlineHelpClick }: AgentHeaderProps) {
  const { user: authUser, logout } = useAuth()
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [managerToolsOpen, setManagerToolsOpen] = useState(false)
  const [catalogName, setCatalogName] = useState('')
  const [catalogContent, setCatalogContent] = useState('')
  const [catalogFile, setCatalogFile] = useState<File | null>(null)
  const [catalogSubmitting, setCatalogSubmitting] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [catalogs, setCatalogs] = useState<QtnCatalogItem[]>([])
  const [catalogsLoading, setCatalogsLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadCatalogs = () => {
    setCatalogsLoading(true)
    listQtnCatalogs()
      .then(setCatalogs)
      .catch(() => setCatalogs([]))
      .finally(() => setCatalogsLoading(false))
  }

  useEffect(() => {
    if (!authUser) return
    getMe()
      .then(setUser)
      .catch(() => setUser(null))
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

  const showManagerTools = showManagerToolsProp && (user?.role === 'admin' || user?.role === 'manager')
  const canManageSchema = showSchemaManager && (user?.role === 'manager' || user?.role === 'admin' || user?.role === 'super_admin')

  const handleCatalogFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f && f.size > 0 && f.size < 1024 * 1024) {
      setCatalogFile(f)
      if (!catalogName.trim()) setCatalogName(f.name.replace(/\.[^.]+$/, '') || f.name)
    }
    e.target.value = ''
  }

  const handleSubmitCatalogUpload = async () => {
    const name = catalogName.trim()
    if (!name) {
      setCatalogError('請輸入清單名稱')
      return
    }
    let content = catalogContent.trim()
    if (catalogFile) {
      try {
        content = await catalogFile.text()
      } catch {
        setCatalogError('無法讀取檔案')
        return
      }
    }
    if (!content) {
      setCatalogError('請上傳檔案或輸入內容')
      return
    }
    setCatalogSubmitting(true)
    setCatalogError(null)
    try {
      await createQtnCatalog({ catalog_name: name, content })
      setCatalogName('')
      setCatalogContent('')
      setCatalogFile(null)
      loadCatalogs()
    } catch (err) {
      setCatalogError(getErrorMessage(err))
    } finally {
      setCatalogSubmitting(false)
    }
  }

  const handleDeleteCatalog = async (catalogId: string) => {
    setDeletingId(catalogId)
    try {
      await deleteQtnCatalog(catalogId)
      setCatalogs((prev) => prev.filter((c) => c.catalog_id !== catalogId))
    } catch (err) {
      setCatalogError(getErrorMessage(err))
    } finally {
      setDeletingId(null)
    }
  }

  const handleCloseManagerTools = () => {
    setManagerToolsOpen(false)
    setCatalogError(null)
  }

  const handleOpenManagerTools = () => {
    setManagerToolsOpen(true)
    loadCatalogs()
  }

  return (
    <>
      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
      <header
        className={`flex-shrink-0 rounded-2xl border-b border-gray-300/50 px-6 py-4 shadow-md ${className}`.trim()}
        style={{ backgroundColor: headerBackgroundColor }}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AgentIcon iconName={agent.icon_name} className="h-6 w-6 text-white" />
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-white">{agent.agent_name}</h1>
              {onOnlineHelpClick && (
                <button
                  type="button"
                  onClick={onOnlineHelpClick}
                  title="使用說明"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/10 text-base font-semibold leading-none text-white transition-opacity hover:bg-white/20"
                  aria-label="使用說明"
                >
                  ？
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {canManageSchema && (
              <button
                type="button"
                onClick={onSchemaManagerOpen}
                className="rounded-3xl border border-white/30 bg-white/10 px-4 py-2 text-sm font-medium text-white transition-opacity hover:bg-white/20"
                aria-label="資料範本管理"
              >
                資料範本管理
              </button>
            )}
            {showManagerTools && (
              <button
                type="button"
                onClick={handleOpenManagerTools}
                className="rounded-3xl border border-white/30 bg-white/10 px-4 py-2 text-sm font-medium text-white transition-opacity hover:bg-white/20"
              >
                主管工具
              </button>
            )}
            {/* 頭像 dropdown */}
            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setUserMenuOpen((o) => !o)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/30 overflow-hidden transition-opacity hover:opacity-80"
                aria-label="使用者選單"
              >
                <AvatarCircle
                  avatarB64={user?.avatar_b64}
                  name={user?.display_name || user?.username || authUser?.email?.split('@')[0] || 'U'}
                  size={36}
                />
              </button>
              {userMenuOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 min-w-[200px] rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
                  <div className="flex items-center gap-3 bg-gray-50 border-b border-gray-100 px-4 py-3">
                    <AvatarCircle
                      avatarB64={user?.avatar_b64}
                      name={user?.display_name || user?.username || authUser?.email?.split('@')[0] || 'U'}
                      size={32}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">
                        {user?.display_name || user?.username || '—'}
                      </p>
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
              to="/"
              className="flex items-center text-white transition-opacity hover:opacity-80"
              aria-label="返回"
            >
              <ArrowLeft className="h-6 w-6" />
            </Link>
          </div>
        </div>
      </header>

      {/* 主管工具 Modal：上傳清單至 qtn_catalog */}
      {managerToolsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={handleCloseManagerTools}
          role="dialog"
          aria-modal="true"
          aria-labelledby="manager-tools-title"
        >
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="relative z-10 min-w-[400px] max-w-[90vw] rounded-2xl border-2 border-gray-200 bg-white p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 id="manager-tools-title" className="text-lg font-semibold text-gray-800">
                主管工具
              </h2>
              <button
                type="button"
                onClick={handleCloseManagerTools}
                className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                aria-label="關閉"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* qtn_catalog 清單 */}
            <section className="mb-6">
              <h3 className="mb-2 text-sm font-medium text-gray-700">公司報價清單（qtn_catalogs）</h3>
              {catalogsLoading ? (
                <p className="py-4 text-sm text-gray-500">載入中...</p>
              ) : catalogs.length === 0 ? (
                <p className="py-4 text-sm text-gray-500">尚無清單</p>
              ) : (
                <ul className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2">
                  {catalogs.map((c) => (
                    <li
                      key={c.catalog_id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-gray-200/60"
                    >
                      <span className="truncate text-gray-600">{c.tenant_id}</span>
                      <span className="min-w-0 flex-1 truncate font-medium text-gray-800">{c.catalog_name}</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteCatalog(c.catalog_id)}
                        disabled={deletingId === c.catalog_id}
                        className="shrink-0 rounded p-1 text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                        aria-label="刪除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="mb-6">
              <h3 className="mb-2 text-sm font-medium text-gray-700">上傳清單</h3>
              <p className="mb-4 text-sm text-gray-500">
                清單將儲存至公司報價清單（qtn_catalogs），可供後續專案使用
              </p>
              {catalogError && (
                <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{catalogError}</div>
              )}
              <div className="mb-4">
                <label className="mb-1 block text-sm font-medium text-gray-700">清單名稱</label>
                <input
                  type="text"
                  value={catalogName}
                  onChange={(e) => setCatalogName(e.target.value)}
                  placeholder="例如：2026 裝修標準報價表"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                />
              </div>
              <label className="mb-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 py-4 transition-colors hover:border-gray-400 hover:bg-gray-100">
                <Upload className="mb-2 h-6 w-6 text-gray-500" />
                <span className="text-sm text-gray-600">選擇檔案（CSV、TXT 等）</span>
                <input type="file" accept=".csv,.txt,.md,.json" className="hidden" onChange={handleCatalogFileChange} />
              </label>
              {catalogFile && <p className="mb-3 text-sm text-gray-600">已選：{catalogFile.name}</p>}
              <div className="mb-4">
                <label className="mb-1 block text-sm font-medium text-gray-700">或輸入內容</label>
                <textarea
                  value={catalogContent}
                  onChange={(e) => setCatalogContent(e.target.value)}
                  placeholder="貼上 CSV 或文字內容"
                  rows={4}
                  className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleCloseManagerTools}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSubmitCatalogUpload}
                  disabled={catalogSubmitting}
                  className="rounded-lg bg-gray-700 px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {catalogSubmitting ? '上傳中...' : '上傳'}
                </button>
              </div>
            </section>
          </div>
        </div>
      )}
    </>
  )
}
