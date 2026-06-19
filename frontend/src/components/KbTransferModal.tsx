/** 知識庫所有權轉移 Modal */
import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Search, X } from 'lucide-react'
import { listUsers } from '@/api/users'
import { transferKnowledgeBase, type KmKnowledgeBase } from '@/api/km'
import type { User } from '@/types'

interface Props {
  kb: KmKnowledgeBase
  currentOwnerName?: string | null
  onClose: () => void
  onTransferred: (updated: KmKnowledgeBase) => void
}

export default function KbTransferModal({
  kb,
  currentOwnerName,
  onClose,
  onTransferred,
}: Props) {
  const [users, setUsers] = useState<User[]>([])
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [transferring, setTransferring] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listUsers()
      .then((all) => setUsers(all.filter((u) => u.id !== kb.created_by)))
      .catch(() => setError('無法載入使用者清單'))
      .finally(() => setLoadingUsers(false))
  }, [kb.created_by])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) => u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    )
  }, [users, search])

  async function handleConfirm() {
    if (!selectedUserId) return
    setTransferring(true)
    setError(null)
    try {
      const updated = await transferKnowledgeBase(kb.id, selectedUserId)
      onTransferred(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : '轉移失敗，請稍後再試')
    } finally {
      setTransferring(false)
    }
  }

  const selectedUser = users.find((u) => u.id === selectedUserId)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h3 className="text-lg font-semibold text-gray-800">轉移所有權</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* KB 資訊 */}
          <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm">
            <p className="font-medium text-gray-800">📚 {kb.name}</p>
            {currentOwnerName && (
              <p className="mt-0.5 text-gray-500">
                目前擁有人：<span className="font-medium text-gray-700">{currentOwnerName}</span>
              </p>
            )}
          </div>

          {/* 搜尋 */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">轉移給</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="搜尋使用者姓名或 Email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
            </div>
          </div>

          {/* 使用者清單 */}
          <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200">
            {loadingUsers ? (
              <div className="flex items-center justify-center py-6">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-4 text-center text-sm text-gray-400">沒有符合的使用者</p>
            ) : (
              filtered.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setSelectedUserId(u.id)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-50 ${
                    selectedUserId === u.id ? 'bg-sky-50' : ''
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                      selectedUserId === u.id
                        ? 'border-sky-500 bg-sky-500'
                        : 'border-gray-300'
                    }`}
                  >
                    {selectedUserId === u.id && (
                      <span className="h-1.5 w-1.5 rounded-full bg-white" />
                    )}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="font-medium text-gray-800">{u.username}</span>
                    <span className="ml-2 text-gray-400">{u.email}</span>
                  </span>
                </button>
              ))
            )}
          </div>

          {/* 轉移箭頭預覽 */}
          {selectedUser && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
              <span className="font-medium">{currentOwnerName ?? '（無）'}</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0" />
              <span className="font-medium">{selectedUser.username}</span>
              <span className="ml-auto text-xs text-amber-600">轉移後你將失去管理權限</span>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={transferring}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!selectedUserId || transferring}
            className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-40"
          >
            {transferring ? '轉移中...' : '確認轉移'}
          </button>
        </div>
      </div>
    </div>
  )
}
