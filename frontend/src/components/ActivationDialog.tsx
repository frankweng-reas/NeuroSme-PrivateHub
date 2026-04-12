/** 系統啟用對話框：admin 首次登入且 tenant_agents 為空時顯示 */
import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { redeemActivationCode } from '@/api/activation'
import { useToast } from '@/contexts/ToastContext'
import { ApiError } from '@/api/client'

interface Props {
  onActivated: () => void
}

export default function ActivationDialog({ onActivated }: Props) {
  const [code, setCode] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { showToast } = useToast()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = code.trim()
    if (!trimmed) return
    setIsSubmitting(true)
    try {
      const res = await redeemActivationCode(trimmed)
      showToast(`系統已啟用，授權客戶：${res.customer_name}`)
      onActivated()
    } catch (err) {
      const msg =
        err instanceof ApiError && err.detail
          ? err.detail
          : err instanceof Error
            ? err.message
            : '啟用失敗，請確認 Code 是否正確'
      showToast(msg, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-xl">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
            <KeyRound className="h-5 w-5 text-gray-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-800">系統啟用</h2>
            <p className="text-sm text-gray-500">請輸入您的 Activation Code 以啟用功能模組</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Activation Code
            </label>
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="貼入 Activation Code..."
              rows={4}
              required
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs text-gray-700 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting || !code.trim()}
            className="w-full rounded-lg py-2.5 font-medium text-white shadow-sm disabled:opacity-50"
            style={{ backgroundColor: '#4b5563' }}
          >
            {isSubmitting ? '啟用中...' : '啟用系統'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-gray-400">
          如尚未取得 Activation Code，請聯繫 REAS 取得授權。
        </p>
      </div>
    </div>
  )
}
