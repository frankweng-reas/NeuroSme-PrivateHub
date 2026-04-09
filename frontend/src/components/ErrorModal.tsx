/** 共用錯誤提示：標題＋說明、單一關閉鈕（點遮罩同效） */
export interface ErrorModalProps {
  open: boolean
  title?: string
  message: string
  confirmText?: string
  onClose: () => void
}

export default function ErrorModal({
  open,
  title = '發生錯誤',
  message,
  confirmText = '我知道了',
  onClose,
}: ErrorModalProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      onClick={onClose}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="error-modal-title"
      aria-describedby="error-modal-desc"
    >
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative z-10 max-h-[min(80vh,28rem)] min-w-[min(100%,320px)] max-w-lg overflow-y-auto rounded-2xl border-2 border-red-200 bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="error-modal-title" className="mb-4 font-semibold text-red-800">
          {title}
        </h2>
        <p id="error-modal-desc" className="mb-6 whitespace-pre-wrap break-words text-gray-700">
          {message}
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl bg-red-600 px-4 py-2 text-white hover:bg-red-700"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
