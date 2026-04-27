/** 個人設定 Modal：可從任何頁面開啟，關閉後留在原頁面 */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Camera, X } from 'lucide-react'
import { getMe, updateMyProfile } from '@/api/users'
import { useToast } from '@/contexts/ToastContext'
import { AvatarCircle } from '@/components/AvatarCircle'
import type { User } from '@/types'

function compressAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const SIZE = 160
        const canvas = document.createElement('canvas')
        canvas.width = SIZE
        canvas.height = SIZE
        const ctx = canvas.getContext('2d')!
        const side = Math.min(img.width, img.height)
        const sx = (img.width - side) / 2
        const sy = (img.height - side) / 2
        ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.onerror = reject
      img.src = e.target?.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

interface ProfileModalProps {
  open: boolean
  onClose: () => void
}

export default function ProfileModal({ open, onClose }: ProfileModalProps) {
  const { showToast } = useToast()
  const [user, setUser] = useState<User | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [avatarB64, setAvatarB64] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    getMe().then((me) => {
      setUser(me)
      setDisplayName(me.display_name ?? '')
      setAvatarB64(me.avatar_b64 ?? null)
    })
  }, [open])

  // ESC 關閉
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const previewName = displayName.trim() || user?.username || 'U'

  const handleAvatarClick = () => fileRef.current?.click()

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setAvatarB64(await compressAvatar(file))
    } catch {
      showToast('圖片處理失敗，請換一張試試', 'error')
    }
    e.target.value = ''
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await updateMyProfile({ display_name: displayName.trim() || null, avatar_b64: avatarB64 })
      showToast('已儲存', 'success')
      onClose()
    } catch {
      showToast('儲存失敗', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Modal 卡片 */}
      <div
        className="relative z-10 w-full max-w-xl rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 p-7"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 標題列 */}
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-lg font-bold text-slate-800">個人設定</h1>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            aria-label="關閉"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 兩欄：左頭像 / 分隔線 / 右欄位 */}
        <div className="flex gap-0">

          {/* 左：頭像 */}
          <div className="flex flex-col items-center gap-2 pt-1 pr-8">
            <div className="relative group cursor-pointer" onClick={handleAvatarClick}>
              <AvatarCircle avatarB64={avatarB64} name={previewName} size={88} />
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera className="h-5 w-5 text-white" />
              </div>
            </div>
            <button
              type="button"
              onClick={handleAvatarClick}
              className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
            >
              更換頭像
            </button>
            {avatarB64 && (
              <button
                type="button"
                onClick={() => setAvatarB64(null)}
                className="text-xs text-slate-400 hover:text-red-500"
              >
                移除
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          </div>

          {/* 分隔線 */}
          <div className="w-px bg-slate-200 self-stretch" />

          {/* 右：欄位 */}
          <div className="flex-1 min-w-0 flex flex-col gap-3 pl-8">
            {/* 顯示名稱 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">顯示名稱</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={user?.username ?? ''}
                maxLength={50}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              <p className="mt-0.5 text-xs text-slate-400">問候語與 sidebar 顯示此名稱</p>
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                type="text"
                value={user?.email ?? ''}
                disabled
                className="w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500 cursor-not-allowed"
              />
            </div>

            {/* 角色 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">角色</label>
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2">
                <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  user?.role === 'admin' || user?.role === 'super_admin'
                    ? 'bg-violet-100 text-violet-700'
                    : user?.role === 'manager'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-200 text-slate-600'
                }`}>
                  {user?.role === 'super_admin' ? 'Super Admin'
                    : user?.role === 'admin' ? 'Admin'
                    : user?.role === 'manager' ? 'Manager'
                    : 'Member'}
                </span>
                <span className="text-xs text-slate-400">由管理員設定</span>
              </div>
            </div>

            {/* 儲存 */}
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="w-full rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
            >
              {isSaving ? '儲存中…' : '儲存設定'}
            </button>

            {/* 修改密碼 */}
            <Link
              to="/change-password"
              onClick={onClose}
              className="flex w-full items-center justify-center rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
            >
              修改密碼
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
