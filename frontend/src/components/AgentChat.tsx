/** Agent 頁面共用聊天元件：訊息列表、輸入框、loading、捲到底 */
import React, { useEffect, useRef, useState } from 'react'
import { BarChart3, ChevronDown, Copy, Download, FileDown, Loader2, X } from 'lucide-react'
import type { ExamplePromptItem } from '@/types/examplePrompts'
import ChartModal, { type ChartData } from '@/components/ChartModal'
import PdfPreviewModal from '@/components/PdfPreviewModal'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'

/** 將 DownloadItem[] 轉成 CSV 字串並觸發瀏覽器下載 */
function downloadAsCSV(items: DownloadItem[], filename = 'analysis.csv') {
  const rows: string[] = []
  items.forEach((item, idx) => {
    if (idx > 0) rows.push('')  // 每個子查詢之間空一行
    rows.push(`# ${item.query}`)
    const datasets = item.datasets ?? []
    const labels = item.labels ?? []
    if (datasets.length > 0) {
      const headers = ['類別', ...datasets.map(d => d.label || d.valueLabel || `數值${datasets.indexOf(d)+1}`)]
      rows.push(headers.map(h => `"${h.replace(/"/g, '""')}"`).join(','))
      for (let i = 0; i < labels.length; i++) {
        const vals = [labels[i], ...datasets.map(d => d.data?.[i] ?? '')]
        rows.push(vals.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      }
    } else if (item.data && item.data.length === labels.length) {
      rows.push('"類別","數值"')
      labels.forEach((lbl, i) => {
        rows.push(`"${lbl.replace(/"/g, '""')}","${item.data![i]}"`)
      })
    }
  })
  const bom = '\uFEFF'  // UTF-8 BOM，讓 Excel 正確識別中文
  const blob = new Blob([bom + rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

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

/** 圖表應排除的摘要列關鍵字（不分大小寫） */
const SUMMARY_ROW_KEYWORDS = new Set([
  '總計', '合計', '小計', '總和', '全部', '匯總', '加總',
  'total', 'sum', 'grand total', 'subtotal', 'all', 'overall',
])

function isSummaryLabel(label: string): boolean {
  const t = label.trim().toLowerCase()
  return t === '' || SUMMARY_ROW_KEYWORDS.has(t)
}

/** 將表格 2D 陣列轉為 ChartData（第一個非數值欄為 label，其餘數值欄為 datasets）
 *  自動排除總計/合計等摘要列，避免圖表失真。
 */
function tableDataToChartData(rows: string[][]): ChartData | null {
  if (rows.length < 2) return null
  const headers = rows[0]
  const allDataRows = rows.slice(1)

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

  // 第一個「至少有一列非空非數值」的欄 → label 欄
  const labelColIdx = headers.findIndex((_, ci) =>
    allDataRows.some((r) => { const v = (r[ci] ?? '').trim(); return v !== '' && parseNum(v) === null })
  )
  if (labelColIdx === -1) return null

  // 過濾掉總計/合計/空 label 的摘要列
  const dataRows = allDataRows.filter((r) => !isSummaryLabel(r[labelColIdx] ?? ''))
  if (dataRows.length === 0) return null

  const labels = dataRows.map((r) => (r[labelColIdx] ?? '').trim())

  // 其餘欄，資料全部能解析為數字的才算 dataset
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
function TableWithDownload({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) {
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

  // tableData.length > 1：至少有表頭 + 一列資料才顯示按鈕
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
  a: ({ children, ...props }: React.HTMLAttributes<HTMLAnchorElement> & { href?: string }) => (
    <a
      className="text-blue-600 underline hover:text-blue-800"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
  p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="mb-2 last:mb-0 leading-relaxed text-[18px] text-gray-900" {...props}>
      {children}
    </p>
  ),
  h1: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 className="mb-2 mt-3 text-xl font-semibold text-gray-900 first:mt-0" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className="mb-2 mt-3 border-b border-gray-200 pb-1 text-lg font-semibold text-gray-900" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="mb-2 mt-2 text-base font-semibold text-gray-800" {...props}>
      {children}
    </h3>
  ),
  ul: ({ children, ...props }: React.HTMLAttributes<HTMLUListElement>) => (
    <ul className="mb-2 ml-4 list-disc space-y-1 text-[18px] text-gray-900" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: React.HTMLAttributes<HTMLOListElement>) => (
    <ol className="mb-2 ml-4 list-decimal space-y-1 text-[18px] text-gray-900" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }: React.HTMLAttributes<HTMLLIElement>) => (
    <li className="leading-relaxed" {...props}>
      {children}
    </li>
  ),
  strong: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => (
    <strong className="font-semibold text-gray-900" {...props}>
      {children}
    </strong>
  ),
  code: ({ children, className, ...props }: React.HTMLAttributes<HTMLElement>) => {
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
  pre: ({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-gray-100 p-3 text-[16px]" {...props}>
      {children}
    </pre>
  ),
  hr: () => <hr className="my-3 border-gray-200" />,
  table: TableWithDownload,
  thead: ({ children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
    <thead className="bg-gray-100" {...props}>
      {children}
    </thead>
  ),
  th: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <th className="border border-gray-200 px-3 py-2 text-left font-semibold text-gray-900" {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <td className="border border-gray-200 px-3 py-2 text-gray-900" {...props}>
      {children}
    </td>
  ),
  tr: ({ children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => (
    <tr {...props}>{children}</tr>
  ),
  tbody: ({ children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
    <tbody {...props}>{children}</tbody>
  ),
}

export interface ResponseMeta {
  model: string
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  finish_reason: string | null
}

export type { ChartData } from '@/components/ChartModal'

export interface AgentChartEntry {
  step: number
  query: string
  chartData: ChartData
}

export interface DownloadItem {
  query: string
  labels?: string[]
  datasets?: { label: string; data: number[]; valueLabel?: string }[]
  data?: number[]
  title?: string
}

export interface Message {
  role: 'user' | 'assistant'
  content: string
  meta?: ResponseMeta
  chartData?: ChartData
  charts?: AgentChartEntry[]   // Agent BI 多步驟圖表（有時同時有 chartData = 最後一張）
  sources?: { filename: string }[]
  downloadData?: DownloadItem[]  // Agent BI 各子查詢原始資料（供下載 CSV）
}

/** 三階段 loading 文字（意圖解析 → 計算 → 分析建議） */
export type LoadingStage = 'intent' | 'compute' | 'text'

const LOADING_STAGE_LABELS: Record<LoadingStage, string> = {
  intent: '意圖解析中…',
  compute: '計算中…',
  text: '分析建議…',
}

export type { ExamplePromptItem }

const MAX_CUSTOM_EXAMPLE_CHARS = 280

interface AgentChatProps {
  messages: Message[]
  onSubmit: (text: string) => void
  isLoading: boolean
  /** 三階段進度，有值時取代預設「助理思考中」 */
  loadingStage?: LoadingStage | null
  onCopySuccess?: () => void
  onCopyError?: () => void
  emptyPlaceholder?: string
  /** 覆寫空狀態字級／顏色（預設 text-[18px] text-gray-400） */
  emptyPlaceholderClassName?: string
  /** 為 true 時無法送出（仍可在輸入框打字） */
  submitDisabled?: boolean
  submitDisabledTitle?: string
  headerTitle?: string
  headerActions?: React.ReactNode
  /** 系統 + 使用者範例（點選帶入輸入框） */
  examplePrompts?: readonly ExamplePromptItem[]
  /** 刪除一則使用者範例（系統範例 id 父層應忽略） */
  onExamplePromptRemove?: (id: string) => void
  /** 新增一則使用者範例 */
  onExamplePromptAdd?: (text: string) => void
  /**
   * inline：在輸入框上方展開區塊（預設）
   * modal：由父層開啟獨立視窗，此處不顯示例區；請搭配 chatInputSeed 帶入文字
   */
  exampleLayout?: 'inline' | 'modal'
  /** 父層選好範例後遞增 n 並帶入 text，會寫入輸入框並 focus */
  chatInputSeed?: { n: number; text: string } | null
  onChatInputSeedApplied?: () => void
  /** 控制訊息下方動作列顯示哪些按鈕（預設全開） */
  showCopy?: boolean
  showChart?: boolean
  showPdf?: boolean
  /** 輸入框左側插槽（例：語音輸入按鈕） */
  composerLeading?: React.ReactNode
  /** 外部注入文字（每次值變化時 append 到輸入框並 focus） */
  appendInputText?: string
  /** 外部取代文字（每次值變化時完整取代輸入框內容，適合語音輸入） */
  replaceInputText?: string
  /** 帶入文字並自動送出（語音確認後直接送出） */
  appendAndSendText?: string
  /** 緊湊模式：移除訊息區卡片邊框與外距，適合全螢幕 Widget */
  compact?: boolean
}

export default function AgentChat({
  messages,
  onSubmit,
  isLoading,
  loadingStage,
  onCopySuccess,
  onCopyError,
  emptyPlaceholder = '輸入訊息開始對話...',
  emptyPlaceholderClassName,
  submitDisabled = false,
  submitDisabledTitle,
  headerTitle = '對話',
  headerActions,
  examplePrompts,
  onExamplePromptRemove,
  onExamplePromptAdd,
  exampleLayout = 'inline',
  chatInputSeed,
  onChatInputSeedApplied,
  showCopy = true,
  showChart = true,
  showPdf = true,
  composerLeading,
  appendInputText,
  replaceInputText,
  appendAndSendText,
  compact = false,
}: AgentChatProps) {
  const [input, setInput] = useState('')
  const [isAtBottom, setIsAtBottom] = useState(true)
  // { msgIdx: 訊息索引, chartIdx: charts[] 內的索引，-1 代表 message.chartData }
  const [chartModalTarget, setChartModalTarget] = useState<{ msgIdx: number; chartIdx: number } | null>(null)
  const [pdfPreviewTarget, setPdfPreviewTarget] = useState<{ content: string; chartData?: ChartData } | null>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const chatInputRef = useRef<HTMLTextAreaElement>(null)
  const [exampleDraft, setExampleDraft] = useState('')
  const [examplePanelOpen, setExamplePanelOpen] = useState(true)
  const prevMessageCountRef = useRef(messages.length)

  const hasExampleBlock = Boolean(
    exampleLayout === 'inline' &&
      ((examplePrompts && examplePrompts.length > 0) || onExamplePromptAdd)
  )

  const onSeedAppliedRef = useRef(onChatInputSeedApplied)
  onSeedAppliedRef.current = onChatInputSeedApplied
  const lastSeedNRef = useRef<number | null>(null)

  useEffect(() => {
    if (!chatInputSeed) return
    if (lastSeedNRef.current === chatInputSeed.n) return
    lastSeedNRef.current = chatInputSeed.n
    setInput(chatInputSeed.text)
    queueMicrotask(() => chatInputRef.current?.focus())
    onSeedAppliedRef.current?.()
  }, [chatInputSeed?.n, chatInputSeed?.text])

  useEffect(() => {
    if (isAtBottom) {
      chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [messages, isLoading, isAtBottom])

  useEffect(() => {
    const prev = prevMessageCountRef.current
    if (prev === 0 && messages.length > 0) setExamplePanelOpen(false)
    if (messages.length === 0) setExamplePanelOpen(true)
    prevMessageCountRef.current = messages.length
  }, [messages.length])

  function handleChatScroll() {
    const el = chatScrollRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    const atBottom = scrollHeight - scrollTop - clientHeight < 20
    setIsAtBottom(atBottom)
  }

  function scrollToBottom() {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' })
    setIsAtBottom(true)
  }

  // 外部注入文字（append 模式）
  useEffect(() => {
    if (!appendInputText) return
    setInput((prev) => prev ? `${prev} ${appendInputText}` : appendInputText)
    setTimeout(() => chatInputRef.current?.focus(), 0)
  }, [appendInputText])

  // 外部取代文字（語音輸入：直接替換整個輸入框）
  useEffect(() => {
    if (replaceInputText === undefined || replaceInputText === '') return
    setInput(replaceInputText)
    setTimeout(() => chatInputRef.current?.focus(), 0)
  }, [replaceInputText])

  // 語音確認自動送出
  useEffect(() => {
    if (!appendAndSendText) return
    const text = appendAndSendText.trim()
    if (!text || isLoading || submitDisabled) return
    onSubmit(text)
    setInput('')
  }, [appendAndSendText])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || isLoading || submitDisabled) return
    setInput('')
    if (chatInputRef.current) chatInputRef.current.style.height = 'auto'
    onSubmit(text)
  }

  function handleCopy(content: string) {
    navigator.clipboard.writeText(content).then(
      () => onCopySuccess?.(),
      () => onCopyError?.()
    )
  }

  function handleOpenPdfPreview(content: string, chartData?: ChartData) {
    setPdfPreviewTarget({ content, chartData })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {(headerTitle || headerActions) && (
        <header className="flex flex-shrink-0 items-center justify-between rounded-t-xl border-b border-slate-200 bg-slate-100 px-4 py-3 font-semibold text-slate-800 shadow-sm">
          <span>{headerTitle}</span>
          {headerActions}
        </header>
      )}
      <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${compact ? 'p-0' : 'p-3 sm:p-4'}`}>
        <div className={`relative flex-1 min-h-0 ${compact ? 'mb-2' : 'mb-4'}`}>
          <div
            ref={chatScrollRef}
            onScroll={handleChatScroll}
            className={`h-full overflow-y-auto p-4 ${compact ? 'bg-gray-50' : 'rounded-xl border border-gray-200/80 bg-gray-50/60 ring-1 ring-gray-200/40'}`}
          >
            {messages.length === 0 ? (
              <p
                className={`whitespace-pre-line ${emptyPlaceholderClassName ?? 'text-[18px] text-gray-400'}`}
              >
                {emptyPlaceholder}
              </p>
            ) : (
              <ul className="flex flex-col space-y-4">
                {messages.map((m, i) => {
                  if (m.role === 'assistant' && !m.content) return null
                  return (
                  <li
                    key={i}
                    className={`flex flex-col rounded-xl px-4 py-3 shadow-sm ${
                      m.role === 'user'
                        ? 'ml-auto w-fit max-w-[85%] bg-gray-800 text-white ring-1 ring-gray-700/50'
                        : 'mr-8 border border-gray-100 bg-white text-gray-900 ring-1 ring-gray-200/50'
                    }`}
                  >
                    {m.role === 'user' ? (
                      <p className="whitespace-pre-wrap text-[18px] leading-relaxed">{m.content}</p>
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
                    {m.role === 'assistant' && m.meta && (
                      <div className="mt-2 border-t border-gray-200 pt-2 text-[18px] text-gray-600">
                        model: {m.meta.model} · prompt: {m.meta.usage.prompt_tokens} · completion:{' '}
                        {m.meta.usage.completion_tokens} · total: {m.meta.usage.total_tokens}
                        {m.meta.finish_reason && ` · finish: ${m.meta.finish_reason}`}
                      </div>
                    )}
                    {m.role === 'assistant' && m.content && (showCopy || showChart || showPdf) && (
                      <div className="mt-2 flex items-center gap-2 border-t border-gray-200 pt-2">
                        {showCopy && (
                          <button
                            type="button"
                            onClick={() => handleCopy(m.content)}
                            className="flex items-center gap-1 rounded-2xl px-2 py-1 text-[18px] text-gray-600 transition-colors hover:bg-gray-200"
                          >
                            <Copy className="h-4 w-4" />
                            複製
                          </button>
                        )}
                        {showChart && (
                          <>
                            {/* Agent BI 多步驟圖表：每張各一個按鈕 */}
                            {m.charts && m.charts.length > 0 ? (
                              m.charts.map((c, ci) => (
                                <button
                                  key={ci}
                                  type="button"
                                  onClick={() => setChartModalTarget({ msgIdx: i, chartIdx: ci })}
                                  title={c.query}
                                  className="flex items-center gap-1 rounded-2xl px-2 py-1 text-[18px] text-gray-600 transition-colors hover:bg-gray-200"
                                >
                                  <BarChart3 className="h-4 w-4" />
                                  圖表 {c.step}
                                </button>
                              ))
                            ) : (
                              /* 一般單張圖表 */
                              <button
                                type="button"
                                onClick={() => m.chartData && setChartModalTarget({ msgIdx: i, chartIdx: -1 })}
                                disabled={!m.chartData}
                                title={m.chartData ? '檢視圖表' : '此回覆無圖表資料'}
                                className="flex items-center gap-1 rounded-2xl px-2 py-1 text-[18px] text-gray-600 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                              >
                                <BarChart3 className="h-4 w-4" />
                                圖表
                              </button>
                            )}
                          </>
                        )}
                        {showPdf && (
                          <button
                            type="button"
                            onClick={() => handleOpenPdfPreview(m.content, m.charts?.[0]?.chartData ?? m.chartData)}
                            title="匯出 PDF"
                            className="flex items-center gap-1 rounded-2xl px-2 py-1 text-[18px] text-gray-600 transition-colors hover:bg-gray-200"
                          >
                            <FileDown className="h-4 w-4" />
                            PDF
                          </button>
                        )}
                        {m.downloadData && m.downloadData.length > 0 && (
                          <button
                            type="button"
                            onClick={() => downloadAsCSV(m.downloadData!, 'analysis.csv')}
                            title="下載分析資料（CSV）"
                            className="flex items-center gap-1 rounded-2xl px-2 py-1 text-[18px] text-emerald-700 transition-colors hover:bg-emerald-50"
                          >
                            <Download className="h-4 w-4" />
                            CSV
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                  )
                })}
              </ul>
            )}
            {isLoading && (
              <p className="mt-2 flex items-center gap-2 text-[18px] text-gray-500">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
                <span>{loadingStage ? LOADING_STAGE_LABELS[loadingStage] : '助理思考中'}</span>
                <span className="animate-thinking-dots inline-flex">
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </p>
            )}
          </div>
          {!isAtBottom && messages.length > 0 && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center justify-center rounded-full border border-gray-300 bg-white p-2 text-gray-700 shadow-lg transition-colors hover:bg-gray-50"
              aria-label="跳到最後"
            >
              <ChevronDown className="h-5 w-5" />
            </button>
          )}
        </div>
        {chartModalTarget != null && (() => {
          const m = messages[chartModalTarget.msgIdx]
          const data = chartModalTarget.chartIdx >= 0
            ? m?.charts?.[chartModalTarget.chartIdx]?.chartData
            : m?.chartData
          const queryLabel = chartModalTarget.chartIdx >= 0
            ? m?.charts?.[chartModalTarget.chartIdx]?.query
            : undefined
          const displayData = data && queryLabel && !data.title
            ? { ...data, title: queryLabel }
            : data
          return displayData ? (
            <ChartModal
              open
              data={displayData}
              onClose={() => setChartModalTarget(null)}
            />
          ) : null
        })()}
        {pdfPreviewTarget && (
          <PdfPreviewModal
            open
            content={pdfPreviewTarget.content}
            chartData={pdfPreviewTarget.chartData}
            onClose={() => setPdfPreviewTarget(null)}
            onDownloadError={onCopyError}
          />
        )}
        {hasExampleBlock && (
          <div className="mb-3 shrink-0 rounded-xl border border-gray-200/80 bg-white/90 px-3 py-2 ring-1 ring-gray-200/40">
            <button
              type="button"
              onClick={() => setExamplePanelOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1.5 text-left text-[16px] text-gray-800 transition-colors hover:bg-gray-50"
              aria-expanded={examplePanelOpen}
            >
              <span>
                <span className="font-semibold text-gray-800">範例問題</span>
                <span className="ml-2 font-normal text-gray-500">點選帶入下方輸入框</span>
              </span>
              <ChevronDown
                className={`h-5 w-5 shrink-0 text-gray-500 transition-transform ${examplePanelOpen ? 'rotate-180' : ''}`}
                aria-hidden
              />
            </button>
            {examplePanelOpen && (
              <div className="mt-2 space-y-3 border-t border-gray-100 pt-3">
                {examplePrompts != null && examplePrompts.some((p) => p.isSystem) && (
                  <div>
                    <p className="mb-1.5 text-[14px] font-medium text-gray-500">系統提供</p>
                    <div className="flex flex-wrap gap-2">
                      {examplePrompts
                        .filter((p) => p.isSystem)
                        .map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setInput(p.text)
                              chatInputRef.current?.focus()
                            }}
                            disabled={isLoading}
                            className="max-w-full rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-left text-[15px] leading-snug text-gray-800 transition-colors hover:border-slate-300 hover:bg-slate-100 disabled:opacity-50"
                          >
                            <span className="line-clamp-2">{p.text}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                )}
                {examplePrompts != null && examplePrompts.some((p) => !p.isSystem) && (
                  <div>
                    <p className="mb-1.5 text-[14px] font-medium text-gray-500">我的範例</p>
                    <div className="flex flex-wrap gap-2">
                      {examplePrompts
                        .filter((p) => !p.isSystem)
                        .map((p) => (
                          <div
                            key={p.id}
                            className="flex max-w-full items-center gap-0.5 rounded-full border border-blue-200 bg-blue-50/80 pl-3 pr-1 py-1"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setInput(p.text)
                                chatInputRef.current?.focus()
                              }}
                              disabled={isLoading}
                              className="min-w-0 max-w-[min(100%,24rem)] text-left text-[15px] leading-snug text-gray-800 transition-opacity hover:opacity-90 disabled:opacity-50"
                            >
                              <span className="line-clamp-2">{p.text}</span>
                            </button>
                            {onExamplePromptRemove && (
                              <button
                                type="button"
                                onClick={() => onExamplePromptRemove(p.id)}
                                className="shrink-0 rounded-full p-1 text-blue-700/80 transition-colors hover:bg-blue-100 hover:text-blue-900"
                                aria-label={`刪除範例：${p.text.slice(0, 20)}${p.text.length > 20 ? '…' : ''}`}
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                )}
                {examplePrompts != null &&
                  examplePrompts.length === 0 &&
                  !onExamplePromptAdd && (
                    <p className="text-[15px] text-gray-500">目前沒有範例問題。</p>
                  )}
                {onExamplePromptAdd && (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      type="text"
                      value={exampleDraft}
                      onChange={(e) => setExampleDraft(e.target.value.slice(0, MAX_CUSTOM_EXAMPLE_CHARS))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.nativeEvent.isComposing) return
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          const t = exampleDraft.trim()
                          if (!t) return
                          onExamplePromptAdd(t)
                          setExampleDraft('')
                        }
                      }}
                      placeholder="新增我的範例…"
                      maxLength={MAX_CUSTOM_EXAMPLE_CHARS}
                      disabled={isLoading}
                      className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-[15px] text-gray-800 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:opacity-50"
                    />
                    <button
                      type="button"
                      disabled={isLoading || !exampleDraft.trim()}
                      onClick={() => {
                        const t = exampleDraft.trim()
                        if (!t) return
                        onExamplePromptAdd(t)
                        setExampleDraft('')
                      }}
                      className="shrink-0 rounded-xl bg-gray-200 px-4 py-2 text-[15px] font-medium text-gray-800 transition-colors hover:bg-gray-300 disabled:opacity-40"
                    >
                      加入
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <form onSubmit={handleSubmit} className={`flex gap-1.5 sm:gap-2 ${compact ? 'px-3 pb-2 sm:px-4' : ''}`}>
          {composerLeading}
          <textarea
            ref={chatInputRef}
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
                if (!isLoading && input.trim() && !submitDisabled) {
                  handleSubmit(e as unknown as React.FormEvent)
                }
              }
            }}
            placeholder="輸入訊息… (Shift+Enter 換行)"
            className="min-h-[44px] max-h-[160px] min-w-0 flex-1 resize-none overflow-y-auto rounded-lg border border-gray-300 px-3 py-2.5 text-[16px] leading-snug focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400 sm:px-4 sm:text-[18px]"
            disabled={isLoading}
          />
          <button
            type="submit"
            title={submitDisabled ? submitDisabledTitle : undefined}
            disabled={isLoading || !input.trim() || submitDisabled}
            className="min-h-[44px] min-w-[64px] rounded-2xl bg-gray-800 px-4 py-2 text-[16px] font-medium text-white transition-colors hover:bg-gray-900 disabled:opacity-40 sm:px-5 sm:text-[18px]"
          >
            送出
          </button>
        </form>
      </div>
    </div>
  )
}
