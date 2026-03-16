/** 隱藏測試頁：LLM 聊天測試，僅可透過 /dev-test-chat 存取 */
import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronDown, Copy, GripHorizontal, GripVertical, Loader2, Trash2, Upload, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { chatCompletionsDev } from '@/api/chat'
import { ApiError } from '@/api/client'
import ModelSelect from '@/components/ModelSelect'

const CHAT_MARKDOWN_COMPONENTS = {
  p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="mb-2 last:mb-0 leading-relaxed text-lg text-gray-900" {...props}>
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
    <ul className="mb-2 ml-4 list-disc space-y-1 text-lg text-gray-900" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: React.HTMLAttributes<HTMLOListElement>) => (
    <ol className="mb-2 ml-4 list-decimal list-outside pl-6 space-y-1 text-lg text-gray-900" {...props}>
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
      <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-base" {...props}>
        {children}
      </code>
    )
  },
  pre: ({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-gray-100 p-3 text-base" {...props}>
      {children}
    </pre>
  ),
  hr: () => <hr className="my-3 border-gray-200" />,
  table: ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse border border-gray-200 text-base" {...props}>
        {children}
      </table>
    </div>
  ),
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

interface ResponseMeta {
  model: string
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  finish_reason: string | null
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  meta?: ResponseMeta
}

const MIN_PANEL_WIDTH = 200
const DEFAULT_LEFTMOST_WIDTH = 20
const DEFAULT_LEFT_WIDTH = 35
const DEFAULT_TOP_HEIGHT = 50
const DEFAULT_LEFTMOST_TOP_HEIGHT = 50
const STORAGE_KEY = 'dev-test-chat'

interface StoredState {
  messages: Message[]
  systemPrompt: string
  userPrompt: string
  dataContent: string
  model: string
  includeHistory: boolean
  leftmostWidth: number
  leftmostTopHeight: number
  leftWidth: number
  topHeight: number
}

function loadStored(): Partial<StoredState> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Partial<StoredState>
  } catch {
    return null
  }
}

function saveStored(state: StoredState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

export default function TestLLMChat() {
  const [messages, setMessages] = useState<Message[]>(() => loadStored()?.messages ?? [])
  const [input, setInput] = useState('')
  const [systemPrompt, setSystemPrompt] = useState(() => loadStored()?.systemPrompt ?? '')
  const [userPrompt, setUserPrompt] = useState(() => loadStored()?.userPrompt ?? '')
  const [dataContent, setDataContent] = useState(() => loadStored()?.dataContent ?? '')
  const [model, setModel] = useState(() => loadStored()?.model ?? 'gpt-4o-mini')
  const [includeHistory, setIncludeHistory] = useState(
    () => loadStored()?.includeHistory ?? true
  )
  const [isLoading, setIsLoading] = useState(false)
  const [leftmostWidth, setLeftmostWidth] = useState(
    () => loadStored()?.leftmostWidth ?? DEFAULT_LEFTMOST_WIDTH
  )
  const [leftmostTopHeight, setLeftmostTopHeight] = useState(
    () => loadStored()?.leftmostTopHeight ?? DEFAULT_LEFTMOST_TOP_HEIGHT
  )
  const [leftWidth, setLeftWidth] = useState(() => loadStored()?.leftWidth ?? DEFAULT_LEFT_WIDTH)
  const [topHeight, setTopHeight] = useState(() => loadStored()?.topHeight ?? DEFAULT_TOP_HEIGHT)
  const [isResizing, setIsResizing] = useState(false)
  const [isResizingLeftmost, setIsResizingLeftmost] = useState(false)
  const [isResizingLeftmostVertical, setIsResizingLeftmostVertical] = useState(false)
  const [isResizingVertical, setIsResizingVertical] = useState(false)
  const [uploadedFileNames, setUploadedFileNames] = useState<string[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const leftmostPanelRef = useRef<HTMLDivElement>(null)
  const leftPanelRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)

  function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files?.length) return
    const filesArray = Array.from(files)
    const names = filesArray.map((f) => f.name)
    const readFile = (file: File) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error)
        reader.readAsText(file, 'UTF-8')
      })
    Promise.all(filesArray.map(readFile)).then((texts) => {
      const newContent = texts.join('\n\n')
      setDataContent((prev) => (prev ? `${prev}\n\n${newContent}` : newContent))
      setUploadedFileNames((prev) => [...prev, ...names])
      e.target.value = ''
    })
  }

  function handleClearFiles() {
    setDataContent('')
    setUploadedFileNames([])
  }

  useEffect(() => {
    if (!isResizingLeftmost) return
    function onMove(e: MouseEvent) {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      const pct = Math.max(10, Math.min(50, (x / rect.width) * 100))
      setLeftmostWidth(pct)
    }
    function onUp() {
      setIsResizingLeftmost(false)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizingLeftmost])

  useEffect(() => {
    if (!isResizingLeftmostVertical) return
    function onMove(e: MouseEvent) {
      const el = leftmostPanelRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const y = e.clientY - rect.top
      const pct = Math.max(20, Math.min(80, (y / rect.height) * 100))
      setLeftmostTopHeight(pct)
    }
    function onUp() {
      setIsResizingLeftmostVertical(false)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizingLeftmostVertical])

  useEffect(() => {
    if (!isResizing) return
    function onMove(e: MouseEvent) {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      const pct = (x / rect.width) * 100
      const middleEnd = Math.max(leftmostWidth + 20, Math.min(80, pct))
      setLeftWidth(middleEnd - leftmostWidth)
    }
    function onUp() {
      setIsResizing(false)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing, leftmostWidth])

  useEffect(() => {
    if (!isResizingVertical) return
    function onMove(e: MouseEvent) {
      const el = leftPanelRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const y = e.clientY - rect.top
      const pct = Math.max(20, Math.min(80, (y / rect.height) * 100))
      setTopHeight(pct)
    }
    function onUp() {
      setIsResizingVertical(false)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizingVertical])

  useEffect(() => {
    if (isAtBottom) {
      chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [messages, isLoading, isAtBottom])

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

  useEffect(() => {
    saveStored({
      messages,
      systemPrompt,
      userPrompt,
      dataContent,
      model,
      includeHistory,
      leftmostWidth,
      leftmostTopHeight,
      leftWidth,
      topHeight,
    })
  }, [messages, systemPrompt, userPrompt, dataContent, model, includeHistory, leftmostWidth, leftmostTopHeight, leftWidth, topHeight])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || isLoading) return

    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setIsLoading(true)

    try {
      const res = await chatCompletionsDev({
        system_prompt: systemPrompt,
        user_prompt: userPrompt,
        data: dataContent,
        model,
        messages: includeHistory ? messages : [],
        content: text,
      })
      const meta: ResponseMeta | undefined =
        res.usage != null
          ? {
              model: res.model,
              usage: res.usage,
              finish_reason: res.finish_reason,
            }
          : undefined
      setMessages((prev) => [...prev, { role: 'assistant', content: res.content, meta }])
    } catch (err) {
      let msg = '未知錯誤'
      if (err instanceof ApiError) msg = err.detail ?? err.message
      else if (err instanceof Error) {
        msg = err.name === 'AbortError' ? '請求逾時，請檢查網路或稍後再試' : err.message
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: `錯誤：${msg}` }])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-gray-100">
      <header
        className="flex flex-shrink-0 items-center gap-4 border-b border-gray-200 bg-gray-800 px-4 py-3"
      >
        <Link
          to="/"
          className="flex items-center text-white/90 transition-colors hover:text-white"
          aria-label="返回"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-semibold text-white">LLM Chat 測試</h1>
        <Link
          to="/dev-test-compute-flow"
          className="ml-auto rounded-lg border border-white/30 px-3 py-1.5 text-sm text-white/90 hover:bg-white/10"
        >
          Compute Flow 測試
        </Link>
      </header>

      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        {/* 最左側容器 */}
        <div
          ref={leftmostPanelRef}
          className="flex flex-col overflow-hidden border-r border-gray-200 bg-white"
          style={{ width: `${leftmostWidth}%`, minWidth: 120 }}
        >
          {/* Data */}
          <div
            className="flex min-h-0 flex-col overflow-hidden border-b border-gray-200"
            style={{ height: `${leftmostTopHeight}%` }}
          >
            <div className="flex-shrink-0 border-b border-sky-200 bg-sky-50 px-4 py-2">
              <h2 className="text-lg font-medium text-sky-800">Data</h2>
            </div>
            <textarea
              value={dataContent}
              onChange={(e) => setDataContent(e.target.value)}
              placeholder="貼上或輸入 data..."
              className="min-h-0 flex-1 resize-none border-0 p-4 text-lg text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-0"
            />
          </div>
          {/* 可拖曳調整高度的分隔條 */}
          <button
            type="button"
            onMouseDown={() => setIsResizingLeftmostVertical(true)}
            className="flex h-8 flex-shrink-0 cursor-row-resize items-center justify-center border-y border-gray-200 bg-gray-100 transition-colors hover:bg-gray-200"
            aria-label="調整最左高度"
          >
            <GripHorizontal className="h-4 w-4 text-gray-500" />
          </button>
          {/* Files */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex-shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2">
              <h2 className="text-lg font-medium text-amber-800">Files</h2>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                multiple
                onChange={handleCsvUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-lg text-gray-700 transition-colors hover:bg-gray-50"
              >
                <Upload className="h-5 w-5" />
                上傳 CSV
              </button>
              {uploadedFileNames.length > 0 && (
                <div className="flex flex-col gap-2">
                  {uploadedFileNames.map((name, i) => (
                    <div
                      key={`${name}-${i}`}
                      className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
                    >
                      <span className="truncate text-lg text-gray-700">{name}</span>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={handleClearFiles}
                    className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-lg text-gray-600 transition-colors hover:bg-gray-50"
                  >
                    <X className="h-4 w-4" />
                    移除全部
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 可拖曳調整寬度的分隔條（最左） */}
        <button
          type="button"
          onMouseDown={() => setIsResizingLeftmost(true)}
          className="flex w-3 flex-shrink-0 cursor-col-resize items-center justify-center bg-gray-200 transition-colors hover:bg-gray-300"
          aria-label="調整最左寬度"
        >
          <GripVertical className="h-5 w-5 text-gray-500" />
        </button>

        {/* 中間：System / User prompt */}
        <div
          ref={leftPanelRef}
          className="flex flex-col overflow-hidden border-r border-gray-200 bg-white"
          style={{ width: `${leftWidth}%`, minWidth: MIN_PANEL_WIDTH }}
        >
          {/* 上：System prompt */}
          <div
            className="flex min-h-0 flex-col overflow-hidden"
            style={{ height: `${topHeight}%` }}
          >
            <div className="flex-shrink-0 border-b border-violet-200 bg-violet-50 px-4 py-2">
              <h2 className="text-lg font-medium text-violet-800">System prompt</h2>
            </div>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="輸入 system prompt..."
              className="min-h-0 flex-1 resize-none border-0 p-4 text-lg text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-0"
            />
          </div>
          {/* 可拖曳調整高度的分隔條 */}
          <button
            type="button"
            onMouseDown={() => setIsResizingVertical(true)}
            className="flex h-8 flex-shrink-0 cursor-row-resize items-center justify-center border-y border-gray-200 bg-gray-100 transition-colors hover:bg-gray-200"
            aria-label="調整高度"
          >
            <GripHorizontal className="h-4 w-4 text-gray-500" />
          </button>
          {/* 下：User prompt */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex-shrink-0 border-b border-teal-200 bg-teal-50 px-4 py-2">
              <h2 className="text-lg font-medium text-teal-800">User prompt</h2>
            </div>
            <textarea
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              placeholder="輸入 user prompt..."
              className="min-h-0 flex-1 resize-none border-0 p-4 text-lg text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-0"
            />
          </div>
        </div>

        {/* 可拖曳調整寬度的分隔條 */}
        <button
          type="button"
          onMouseDown={() => setIsResizing(true)}
          className="flex w-3 flex-shrink-0 cursor-col-resize items-center justify-center bg-gray-200 transition-colors hover:bg-gray-300"
          aria-label="調整寬度"
        >
          <GripVertical className="h-5 w-5 text-gray-500" />
        </button>

        {/* 右側 Chatbot */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-gray-50">
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-emerald-200 bg-emerald-50 px-4 py-2">
              <ModelSelect
                id="model-select"
                value={model}
                onChange={setModel}
                label="Model"
                labelClassName="shrink-0 text-lg font-medium text-emerald-800"
                selectClassName="rounded-lg border border-emerald-200 bg-white px-4 py-2 text-lg text-gray-800 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <label className="flex cursor-pointer items-center gap-2 text-lg text-emerald-800">
                <input
                  type="checkbox"
                  checked={includeHistory}
                  onChange={(e) => setIncludeHistory(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                />
                歷史對話
              </label>
              <button
                type="button"
                onClick={() => setMessages([])}
                disabled={isLoading || messages.length === 0}
                className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 py-2 text-lg text-emerald-800 transition-colors hover:bg-emerald-50 disabled:opacity-50 disabled:hover:bg-white"
              >
                <Trash2 className="h-5 w-5" />
                清除對話
              </button>
            </div>
            <div className="flex flex-1 flex-col overflow-hidden p-4">
            <div className="relative mb-4 flex-1 min-h-0">
              <div
                ref={chatScrollRef}
                onScroll={handleChatScroll}
                className="h-full overflow-y-auto rounded-lg border border-gray-200 bg-white p-4"
              >
              {messages.length === 0 ? (
                <p className="text-lg text-gray-500">輸入訊息開始測試...</p>
              ) : (
                <ul className="flex flex-col space-y-3">
                  {messages.map((m, i) => (
                    <li
                      key={i}
                      className={`flex flex-col rounded-lg px-3 py-2 ${
                        m.role === 'user'
                          ? 'ml-auto w-fit max-w-[85%] bg-blue-100 text-blue-900'
                          : 'mr-8 bg-gray-100 text-gray-900'
                      }`}
                    >
                      {m.role === 'user' ? (
                        <p className="whitespace-pre-wrap text-lg">{m.content}</p>
                      ) : (
                        <div>
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={CHAT_MARKDOWN_COMPONENTS}>
                            {m.content}
                          </ReactMarkdown>
                        </div>
                      )}
                      {m.role === 'assistant' && m.meta && (
                        <div className="mt-2 border-t border-gray-200 pt-2 text-lg text-gray-600">
                          model: {m.meta.model} · prompt: {m.meta.usage.prompt_tokens} · completion:{' '}
                          {m.meta.usage.completion_tokens} · total: {m.meta.usage.total_tokens}
                          {m.meta.finish_reason && ` · finish: ${m.meta.finish_reason}`}
                        </div>
                      )}
                      {m.role === 'assistant' && (
                        <div className="mt-2 flex items-center gap-2 border-t border-gray-200 pt-2">
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(m.content).then(
                                () => alert('已複製到剪貼簿'),
                                () => alert('複製失敗')
                              )
                            }}
                            className="flex items-center gap-1 rounded px-2 py-1 text-lg text-gray-600 transition-colors hover:bg-gray-200"
                          >
                            <Copy className="h-4 w-4" />
                            複製
                          </button>
                          <span className="text-gray-300">｜</span>
                          <button
                            type="button"
                            disabled
                            className="flex items-center gap-1 rounded px-2 py-1 text-lg text-gray-400 cursor-not-allowed"
                          >
                            匯出 PDF
                          </button>
                          <span className="text-gray-300">｜</span>
                          <button
                            type="button"
                            disabled
                            className="flex items-center gap-1 rounded px-2 py-1 text-lg text-gray-400 cursor-not-allowed"
                          >
                            重新分析
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {isLoading && (
                <p className="mt-2 flex items-center gap-2 text-lg text-gray-500">
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
                  <span>助理思考中</span>
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

            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault()
                }}
                placeholder="輸入訊息..."
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-lg focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-lg font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600"
              >
                送出
              </button>
            </form>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
