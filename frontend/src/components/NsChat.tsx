/** NeuroSme 通用 LLM 對話殼（NsChat）；與 AgentChat 分離，供 ChatAgent 等擴充 */
import React, { useEffect, useRef, useState, type FormEvent, type HTMLAttributes, type ReactNode } from 'react'
import type { ChatMessageAttachmentMeta } from '@/api/chatThreads'
import { BarChart3, ChevronDown, Copy, Download, FileDown, Loader2, RotateCcw } from 'lucide-react'
import PdfPreviewModal from '@/components/PdfPreviewModal'
import ChartModal, { type ChartData } from '@/components/ChartModal'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'

/** 遞迴取出 React node 的純文字 */
function extractTextFromNode(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (!node) return ''
  if (Array.isArray(node)) return node.map(extractTextFromNode).join('')
  if (React.isValidElement(node)) return extractTextFromNode((node.props as { children?: React.ReactNode }).children)
  return ''
}

/** 從 react-markdown table 的 children 走訪出 2D 陣列（含表頭列） */
function extractTableDataFromChildren(children: React.ReactNode): string[][] {
  const rows: string[][] = []
  React.Children.forEach(children, (section) => {
    if (!React.isValidElement(section)) return
    const sectionChildren = (section.props as { children?: React.ReactNode }).children
    React.Children.forEach(sectionChildren, (row) => {
      if (!React.isValidElement(row)) return
      const cells: string[] = []
      const rowChildren = (row.props as { children?: React.ReactNode }).children
      React.Children.forEach(rowChildren, (cell) => {
        if (!React.isValidElement(cell)) return
        cells.push(extractTextFromNode((cell.props as { children?: React.ReactNode }).children))
      })
      if (cells.length > 0) rows.push(cells)
    })
  })
  return rows
}

/** 將表格 2D 陣列轉為 ChartData（第一個非數值欄為 label，其餘數值欄為 datasets） */
function tableDataToChartData(rows: string[][]): ChartData | null {
  if (rows.length < 2) return null
  const headers = rows[0]
  const dataRows = rows.slice(1)

  const parseNum = (v: string): number | null => {
    const t = v.trim()
    if (!t) return null
    // 必須以數字或負號開頭，且不含中文、不含內部連字號（避免日期/代碼誤判）
    if (!/^-?\d/.test(t)) return null
    if (/[\u4e00-\u9fff]/.test(t)) return null
    if (/\d-\d/.test(t)) return null
    const n = parseFloat(t.replace(/,/g, '').replace(/[^\d.-]/g, ''))
    return isNaN(n) ? null : n
  }

  const labelColIdx = headers.findIndex((_, ci) =>
    dataRows.some((r) => { const v = (r[ci] ?? '').trim(); return v !== '' && parseNum(v) === null })
  )
  if (labelColIdx === -1) return null

  const labels = dataRows.map((r) => (r[labelColIdx] ?? '').trim())

  const datasets = headers
    .map((h, ci) => {
      if (ci === labelColIdx) return null
      const nums = dataRows.map((r) => parseNum((r[ci] ?? '').trim()))
      if (nums.every((n) => n === null)) return null
      return { label: h, data: nums.map((n) => n ?? 0) }
    })
    .filter(Boolean) as { label: string; data: number[] }[]

  if (datasets.length === 0) return null
  return { chartType: 'bar', labels, datasets }
}

/** Markdown 表格 + 表格下方「下載 CSV」與「圖表」按鈕 */
function TableWithDownload({ children, ...props }: HTMLAttributes<HTMLTableElement>) {
  const tableData = extractTableDataFromChildren(children as React.ReactNode)
  const chartable = tableDataToChartData(tableData)
  const [chartOpen, setChartOpen] = useState(false)

  function handleDownload() {
    const now = new Date()
    const ts = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('') + '-' + [
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
    ].join('')
    const csv = tableData
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `analysis-${ts}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="my-2">
      <div className="overflow-x-auto">
        <table
          className="min-w-full border-collapse border border-gray-200 text-[16px]"
          {...props}
        >
          {children}
        </table>
      </div>
      {tableData.length > 1 && (
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownload}
            className="flex items-center gap-1 rounded px-2 py-1 text-[14px] text-emerald-700 transition-colors hover:bg-emerald-50"
          >
            <Download className="h-3.5 w-3.5" />
            下載 CSV
          </button>
          {chartable && (
            <button
              type="button"
              onClick={() => setChartOpen(true)}
              className="flex items-center gap-1 rounded px-2 py-1 text-[14px] text-blue-600 transition-colors hover:bg-blue-50"
            >
              <BarChart3 className="h-3.5 w-3.5" />
              圖表
            </button>
          )}
        </div>
      )}
      {chartOpen && chartable && (
        <ChartModal open data={chartable} onClose={() => setChartOpen(false)} />
      )}
    </div>
  )
}

const CHAT_MARKDOWN_COMPONENTS = {
  a: ({ children, ...props }: HTMLAttributes<HTMLAnchorElement> & { href?: string }) => (
    <a
      className="text-blue-600 underline hover:text-blue-800"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
  p: ({ children, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
    <p className="mb-2 last:mb-0 leading-relaxed text-[18px] text-gray-900" {...props}>
      {children}
    </p>
  ),
  h1: ({ children, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
    <h1 className="mb-2 mt-3 text-xl font-semibold text-gray-900 first:mt-0" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className="mb-2 mt-3 border-b border-gray-200 pb-1 text-lg font-semibold text-gray-900" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="mb-2 mt-2 text-base font-semibold text-gray-800" {...props}>
      {children}
    </h3>
  ),
  ul: ({ children, ...props }: HTMLAttributes<HTMLUListElement>) => (
    <ul className="mb-2 ml-4 list-disc space-y-1 text-[18px] text-gray-900" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: HTMLAttributes<HTMLOListElement>) => (
    <ol className="mb-2 ml-4 list-decimal space-y-1 text-[18px] text-gray-900" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }: HTMLAttributes<HTMLLIElement>) => (
    <li className="leading-relaxed" {...props}>
      {children}
    </li>
  ),
  strong: ({ children, ...props }: HTMLAttributes<HTMLElement>) => (
    <strong className="font-semibold text-gray-900" {...props}>
      {children}
    </strong>
  ),
  code: ({ children, className, ...props }: HTMLAttributes<HTMLElement>) => {
    const isBlock = className?.includes('language-')
    if (isBlock) {
      return (
        <code className="block whitespace-pre overflow-x-auto" {...props}>
          {children}
        </code>
      )
    }
    return (
      <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[16px]" {...props}>
        {children}
      </code>
    )
  },
  pre: ({ children, ...props }: HTMLAttributes<HTMLPreElement>) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-gray-100 p-3 text-[16px]" {...props}>
      {children}
    </pre>
  ),
  hr: () => <hr className="my-3 border-gray-200" />,
  table: TableWithDownload,
  thead: ({ children, ...props }: HTMLAttributes<HTMLTableSectionElement>) => (
    <thead className="bg-gray-100" {...props}>
      {children}
    </thead>
  ),
  th: ({ children, ...props }: HTMLAttributes<HTMLTableCellElement>) => (
    <th className="border border-gray-200 px-3 py-2 text-left font-semibold text-gray-900" {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }: HTMLAttributes<HTMLTableCellElement>) => (
    <td className="border border-gray-200 px-3 py-2 text-gray-900" {...props}>
      {children}
    </td>
  ),
  tr: ({ children, ...props }: HTMLAttributes<HTMLTableRowElement>) => (
    <tr {...props}>{children}</tr>
  ),
  tbody: ({ children, ...props }: HTMLAttributes<HTMLTableSectionElement>) => (
    <tbody {...props}>{children}</tbody>
  ),
}

function isImageAttachmentMeta(a: ChatMessageAttachmentMeta): boolean {
  const t = (a.content_type || '').toLowerCase()
  if (t === 'image/jpeg' || t === 'image/png' || t === 'image/webp' || t === 'image/gif') {
    return true
  }
  const n = a.original_filename || ''
  const i = n.lastIndexOf('.')
  const ext = i >= 0 ? n.slice(i).toLowerCase() : ''
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)
}

export interface NsChatUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface NsChatResponseMeta {
  model: string
  /** 上游有時不回 usage；仍顯示 model / finish */
  usage?: NsChatUsage | null
  finish_reason: string | null
}

function formatAssistantMetaLine(meta: NsChatResponseMeta): string | null {
  const parts: string[] = []
  const m = meta.model?.trim()
  if (m) parts.push(`model: ${m}`)
  if (meta.usage) {
    parts.push(
      `prompt: ${meta.usage.prompt_tokens} · completion: ${meta.usage.completion_tokens} · total: ${meta.usage.total_tokens}`
    )
  }
  if (meta.finish_reason != null && meta.finish_reason !== '') {
    parts.push(`finish: ${meta.finish_reason}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

export interface NsChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** 後端 chat_messages.id，有則可搭配 onRetryLastAssistant 再試一次 */
  id?: string
  /** 為 true 時為串流進行中，不顯示「再試一次」 */
  streaming?: boolean
  meta?: NsChatResponseMeta
  /** user 訊息之附件 meta（圖片等由 attachmentBlobUrls 對應顯示） */
  attachments?: ChatMessageAttachmentMeta[]
}

export interface NsChatProps {
  messages: NsChatMessage[]
  onSubmit: (text: string) => void
  isLoading: boolean
  headerTitle?: string
  headerActions?: ReactNode
  emptyPlaceholder?: string
  emptyPlaceholderClassName?: string
  /** 無訊息時顯示於說明文字上方（例如插圖） */
  emptyStateTop?: ReactNode
  /** 輸入框 placeholder，未傳則用 emptyPlaceholder */
  inputPlaceholder?: string
  /** 思考中顯示文字，預設「助理思考中」 */
  loadingLabel?: string
  submitDisabled?: boolean
  submitDisabledTitle?: string
  onCopySuccess?: () => void
  onCopyError?: () => void
  /** 助理訊息是否顯示 PDF 下載（預設 true） */
  showPdf?: boolean
  /** 僅在最後一則助理訊息顯示「再試一次」；由父層負責打 API／刪除舊訊息等 */
  onRetryLastAssistant?: () => void
  /** 為 true 時不畫外框（由外層容器套用 rounded-2xl / border / shadow，對齊 AgentBusinessUI 主面板） */
  embedded?: boolean
  /**
   * 為 true 時允許輸入框空白仍送出（例如僅附加檔時由父層填入預設訊息寫入 DB）
   */
  allowSubmitEmptyInput?: boolean
  /** 訊息列表末尾（捲動區內，緊接最後一則訊息之後） */
  appendContent?: ReactNode
  /** 送出列上方（例如待併入本則訊息的附件列表） */
  composerAboveForm?: ReactNode
  /** 與輸入框同一列、位於輸入框左側（例如附加檔按鈕） */
  composerLeading?: ReactNode
  /** 外部注入文字至輸入框（例如語音辨識結果），每次值改變都 append；請在注入後重設為 '' */
  appendInputText?: string
  /** 外部注入文字並立即送出（語音輸入「使用此文字」自動送出），注入後請重設為 '' */
  appendAndSendText?: string
  /** stored_file id → object URL，供 user 圖片附件顯示 */
  attachmentBlobUrls?: Record<string, string>
}

export default function NsChat({
  messages,
  onSubmit,
  isLoading,
  headerTitle = '',
  headerActions,
  emptyPlaceholder = '輸入訊息…',
  emptyPlaceholderClassName,
  emptyStateTop,
  inputPlaceholder,
  loadingLabel = '助理思考中',
  submitDisabled = false,
  submitDisabledTitle,
  onCopySuccess,
  onCopyError,
  showPdf = true,
  onRetryLastAssistant,
  embedded = false,
  allowSubmitEmptyInput = false,
  appendContent,
  composerAboveForm,
  composerLeading,
  appendInputText,
  appendAndSendText,
  attachmentBlobUrls = {},
}: NsChatProps) {
  const [input, setInput] = useState('')
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [pdfPreviewContent, setPdfPreviewContent] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 語音辨識等外部文字注入：appendInputText 變化時 append 到輸入框並聚焦
  useEffect(() => {
    if (!appendInputText) return
    setInput((prev) => (prev ? `${prev} ${appendInputText}` : appendInputText))
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [appendInputText])

  // 語音輸入「使用此文字」自動送出
  useEffect(() => {
    if (!appendAndSendText) return
    const text = appendAndSendText.trim()
    if (!text || isLoading || submitDisabled) return
    onSubmit(text)
    setInput('')
  }, [appendAndSendText])

  useEffect(() => {
    if (isAtBottom) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [messages, isLoading, isAtBottom])

  function handleChatScroll() {
    const el = scrollRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    const atBottom = scrollHeight - scrollTop - clientHeight < 20
    setIsAtBottom(atBottom)
  }

  function scrollToBottom() {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    setIsAtBottom(true)
  }

  function handleCopy(content: string) {
    navigator.clipboard.writeText(content).then(
      () => onCopySuccess?.(),
      () => onCopyError?.()
    )
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const t = input.trim()
    if ((!t && !allowSubmitEmptyInput) || isLoading || submitDisabled) return
    onSubmit(t)
    setInput('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
  }

  const rootClass = embedded
    ? 'flex h-full min-h-0 flex-col bg-white'
    : 'flex h-full min-h-0 flex-col rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50'

  return (
    <div className={rootClass}>
      {(headerTitle?.trim() || headerActions != null) && (
        <header className="flex shrink-0 flex-wrap items-center justify-start gap-2 border-b border-gray-200 px-3 py-2">
          {headerTitle?.trim() ? (
            <h2 className="text-lg font-semibold text-gray-800">{headerTitle.trim()}</h2>
          ) : null}
          {headerActions != null ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2">{headerActions}</div>
          ) : null}
        </header>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
        <div className="relative mb-2 flex min-h-0 flex-1 flex-col">
          <div
            ref={scrollRef}
            onScroll={handleChatScroll}
            className="h-full min-h-0 overflow-y-auto rounded-xl border border-gray-200/80 bg-gray-50/60 p-4 ring-1 ring-gray-200/40"
            role="log"
            aria-live="polite"
          >
            {messages.length === 0 && !isLoading ? (
              emptyStateTop != null ? (
                <div className="flex h-full min-h-full w-full flex-col items-center gap-5 px-1 py-3 text-center">
                  <div className="flex min-h-0 w-full flex-1 items-center justify-center">
                    <div className="box-border flex h-full min-h-[10rem] w-full items-center justify-center overflow-hidden">
                      {emptyStateTop}
                    </div>
                  </div>
                  <p
                    className={`shrink-0 max-w-xl whitespace-pre-line ${emptyPlaceholderClassName ?? 'text-[18px] text-gray-400'}`}
                  >
                    {emptyPlaceholder}
                  </p>
                </div>
              ) : (
                <p
                  className={`whitespace-pre-line ${emptyPlaceholderClassName ?? 'text-center text-[18px] text-gray-400'}`}
                >
                  {emptyPlaceholder}
                </p>
              )
            ) : (
              <ul className="flex flex-col space-y-4">
                {messages.map((m, i) => (
                  <li
                    key={m.id ?? `${i}-${m.role}-${m.content.slice(0, 48)}`}
                    className={`flex flex-col px-4 py-3 shadow-sm ${
                      m.role === 'user'
                        ? 'ml-auto w-fit max-w-[85%] rounded-3xl bg-gray-800 text-white ring-1 ring-gray-700/50'
                        : 'mr-4 rounded-xl border border-gray-100 bg-white text-gray-900 ring-1 ring-gray-200/50 sm:mr-8'
                    }`}
                  >
                    <span className="sr-only">{m.role === 'user' ? '您：' : '助理：'}</span>
                    {m.role === 'user' ? (
                      <div className="space-y-2">
                        <p className="whitespace-pre-wrap text-[18px] leading-relaxed">{m.content}</p>
                        {m.attachments?.filter(isImageAttachmentMeta).map((a) => {
                          const url = attachmentBlobUrls[a.file_id]
                          return (
                            <div key={a.file_id} className="max-w-full">
                              {url ? (
                                <img
                                  src={url}
                                  alt={a.original_filename}
                                  className="max-h-72 max-w-full rounded-lg object-contain ring-1 ring-white/25"
                                />
                              ) : (
                                <p className="text-[15px] text-white/75">圖片載入中…</p>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkBreaks]}
                          components={CHAT_MARKDOWN_COMPONENTS}
                        >
                          {m.content.replace(/\\n/g, '\n')}
                        </ReactMarkdown>
                      </div>
                    )}
                    {(() => {
                      if (m.role !== 'assistant' || m.meta == null) return null
                      const line = formatAssistantMetaLine(m.meta)
                      if (!line) return null
                      return (
                        <div className="mt-2 border-t border-gray-200 pt-2 text-[15px] text-gray-600">{line}</div>
                      )
                    })()}
                    {m.role === 'assistant' && !m.streaming && m.content && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-2">
                        <button
                          type="button"
                          onClick={() => handleCopy(m.content)}
                          className="flex items-center gap-1 rounded-2xl px-2 py-1 text-[16px] text-gray-600 transition-colors hover:bg-gray-200"
                        >
                          <Copy className="h-4 w-4" />
                          複製
                        </button>
                        {showPdf && (
                          <button
                            type="button"
                            onClick={() => setPdfPreviewContent(m.content)}
                            title="下載 PDF"
                            className="flex items-center gap-1 rounded-2xl px-2 py-1 text-[16px] text-gray-600 transition-colors hover:bg-gray-200"
                          >
                            <FileDown className="h-4 w-4" />
                            下載 PDF
                          </button>
                        )}
                        {onRetryLastAssistant != null &&
                          i === messages.length - 1 &&
                          !isLoading &&
                          m.id != null &&
                          m.id !== '' && (
                            <button
                              type="button"
                              onClick={() => onRetryLastAssistant()}
                              className="flex items-center gap-1 rounded-2xl px-2 py-1 text-[16px] text-gray-600 transition-colors hover:bg-gray-200"
                            >
                              <RotateCcw className="h-4 w-4" />
                              再試一次
                            </button>
                          )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {isLoading && (
              <p className="mt-2 flex items-center gap-2 text-[18px] text-gray-500">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
                <span>{loadingLabel}</span>
                <span className="animate-thinking-dots inline-flex">
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </p>
            )}
            {appendContent != null && (
              <div className="mt-3">{appendContent}</div>
            )}
          </div>
          {!isAtBottom && messages.length > 0 ? (
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center justify-center rounded-full border border-gray-300 bg-white p-2 text-gray-700 shadow-lg transition-colors hover:bg-gray-50"
              aria-label="捲到最新訊息"
            >
              <ChevronDown className="h-5 w-5" />
            </button>
          ) : null}
        </div>

        {pdfPreviewContent != null && (
          <PdfPreviewModal
            open
            content={pdfPreviewContent}
            onClose={() => setPdfPreviewContent(null)}
            onDownloadError={onCopyError}
          />
        )}

        {composerAboveForm != null ? (
          <div className="mb-2 shrink-0 space-y-2">{composerAboveForm}</div>
        ) : null}

        <form onSubmit={handleSubmit} className="flex shrink-0 gap-2">
          {composerLeading != null ? (
            <div className="flex shrink-0 items-center">{composerLeading}</div>
          ) : null}
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (!isLoading && !submitDisabled && (input.trim() || allowSubmitEmptyInput)) {
                  handleSubmit(e as unknown as FormEvent)
                }
              }
            }}
            placeholder={inputPlaceholder ?? emptyPlaceholder}
            disabled={isLoading || submitDisabled}
            title={submitDisabled ? submitDisabledTitle : undefined}
            className="min-h-[44px] max-h-[160px] min-w-0 flex-1 resize-none overflow-y-auto rounded-lg border border-gray-300 px-4 py-2.5 text-[18px] leading-snug focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:bg-gray-50"
            aria-label="訊息輸入"
          />
          <button
            type="submit"
            disabled={isLoading || submitDisabled || (!input.trim() && !allowSubmitEmptyInput)}
            title={submitDisabled ? submitDisabledTitle : undefined}
            className="shrink-0 rounded-2xl bg-gray-800 px-5 py-2 text-[18px] font-medium text-white transition-colors hover:bg-gray-900 disabled:opacity-40"
          >
            送出
          </button>
        </form>
      </div>
    </div>
  )
}
