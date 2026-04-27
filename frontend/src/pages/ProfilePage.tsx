/** 個人 Profile 設定頁 */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Camera } from 'lucide-react'
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

export default function ProfilePage() {
  const { showToast } = useToast()
  const [user, setUser] = useState<User | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [avatarB64, setAvatarB64] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getMe().then((me) => {
      setUser(me)
      setDisplayName(me.display_name ?? '')
      setAvatarB64(me.avatar_b64 ?? null)
    })
  }, [])

  const handleAvatarClick = () => fileRef.current?.click()

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const compressed = await compressAvatar(file)
      setAvatarB64(compressed)
    } catch {
      showToast('圖片處理失敗，請換一張試試', 'error')
    }
    e.target.value = ''
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const updated = await updateMyProfile({
        display_name: displayName.trim() || null,
        avatar_b64: avatarB64,
      })
      setUser(updated)
      showToast('已儲存', 'success')
    } catch {
      showToast('儲存失敗', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  const previewName = displayName.trim() || user?.username || 'U'

  return (
    <div className="flex h-full flex-col px-2 pt-3 pb-5">
      <div
        className="flex min-h-0 flex-1 flex-col rounded-3xl ring-1 ring-slate-300/60 shadow-xl"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Cpath d='M 0 0 L 40 40 M 40 0 L 0 40' fill='none' stroke='rgba(24,51,61,0.1)' stroke-width='1'/%3E%3C/svg%3E"), linear-gradient(160deg, #e3e9ec 0%, #dee5e8 100%)`,
        }}
      >
        {/* 頂部返回列 */}
        <div className="flex-shrink-0 px-7 pt-5 pb-2">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 transition-colors">
            <ArrowLeft className="h-4 w-4" />
            返回首頁
          </Link>
        </div>

        {/* 主內容：垂直置中 */}
        <div className="flex flex-1 items-center justify-center px-4 pb-4">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-7">
            <h1 className="text-lg font-bold text-slate-800 mb-5">個人設定</h1>

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
              <div className="w-px bg-slate-200 self-stretch mx-0" />

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
                  className="flex w-full items-center justify-center rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
                >
                  修改密碼
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
