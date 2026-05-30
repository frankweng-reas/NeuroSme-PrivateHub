import { Loader2 } from 'lucide-react'

/** 共用處理中遮罩：標題、狀態、進度條，可選取消 */
export interface ProcessingModalProps {
  open: boolean
  title: string
  /** 目前步驟說明，例如「第 3/12 頁 OCR 中」 */
  status?: string | null
  /** 副標，例如檔名 */
  subtitle?: string | null
  /** 分段進度（結構化 chunk） */
  progress?: { current: number; total: number } | null
  /** 批次檔案進度，例如第 2/5 檔 */
  batchProgress?: { current: number; total: number } | null
  hint?: string | null
  cancelText?: string
  onCancel?: () => void
}

export default function ProcessingModal({
  open,
  title,
  status,
  subtitle,
  progress,
  batchProgress,
  hint = '請勿關閉此頁面，處理可能需要數分鐘',
  cancelText = '取消',
  onCancel,
}: ProcessingModalProps) {
  if (!open) return null

  const showBar = progress && progress.total > 0
  const barPct = showBar
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : 0

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="processing-modal-title"
      aria-busy="true"
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative z-10 w-full min-w-[min(100%,320px)] max-w-md rounded-2xl border-2 border-gray-200 bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start gap-3">
          <Loader2 className="mt-0.5 h-6 w-6 shrink-0 animate-spin text-emerald-600" />
          <div className="min-w-0 flex-1">
            <h2 id="processing-modal-title" className="font-semibold text-gray-800">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-1 truncate text-sm text-gray-500" title={subtitle}>
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {batchProgress && batchProgress.total > 0 && (
          <p className="mb-2 text-sm font-medium text-gray-600">
            檔案 {batchProgress.current} / {batchProgress.total}
          </p>
        )}

        <p className="mb-4 text-base text-gray-700">
          {status || '處理中…'}
        </p>

        {showBar && (
          <div className="mb-4">
            <div className="h-2 w-full rounded-full bg-gray-100">
              <div
                className="h-2 rounded-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${barPct}%` }}
              />
            </div>
            <p className="mt-1.5 text-center text-sm text-gray-400">
              第 {progress.current} / {progress.total} 段
            </p>
          </div>
        )}

        {hint && (
          <p className="mb-4 text-sm text-gray-400">{hint}</p>
        )}

        {onCancel && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-2xl border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
            >
              {cancelText}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
