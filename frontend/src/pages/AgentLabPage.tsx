/**
 * Agent BI 實驗室 (Dev Test Page)
 * 路徑：/agent-lab
 * Tab 1：單一分析主題（原有功能）
 * Tab 2：多分析主題 Chat Bot（新功能實驗）
 */
import { useEffect, useRef, useState } from 'react'
import { Bot, ChevronDown, ChevronRight, FlaskConical, Layers, Loader2, Send, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { agentBiStream, agentBiMultiStream, type AgentBiEvent } from '@/api/agentBi'
import { listAllBiProjects, type BiProjectItem } from '@/api/biProjects'
import { getTenantConfig, listLLMConfigs } from '@/api/llmConfigs'
import type { LLMProviderConfig } from '@/types'

// ─── Markdown 渲染元件 ────────────────────────────────────────────────────────

const LAB_MD_COMPONENTS = {
  table: ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse border border-gray-200 text-sm" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
    <thead className="bg-gray-50" {...props}>{children}</thead>
  ),
  th: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <th className="border border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-700" {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <td className="border border-gray-200 px-3 py-2 text-sm text-gray-800" {...props}>
      {children}
    </td>
  ),
  p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="mb-2 last:mb-0 leading-relaxed text-sm text-gray-800" {...props}>{children}</p>
  ),
  h1: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 className="mb-2 mt-3 text-lg font-semibold text-gray-900 first:mt-0" {...props}>{children}</h1>
  ),
  h2: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className="mb-2 mt-3 border-b border-gray-200 pb-1 text-base font-semibold text-gray-900" {...props}>{children}</h2>
  ),
  h3: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="mb-1.5 mt-2 text-sm font-semibold text-gray-800" {...props}>{children}</h3>
  ),
  ul: ({ children, ...props }: React.HTMLAttributes<HTMLUListElement>) => (
    <ul className="mb-2 ml-4 list-disc space-y-0.5 text-sm text-gray-800" {...props}>{children}</ul>
  ),
  ol: ({ children, ...props }: React.HTMLAttributes<HTMLOListElement>) => (
    <ol className="mb-2 ml-4 list-decimal space-y-0.5 text-sm text-gray-800" {...props}>{children}</ol>
  ),
  code: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => (
    <code className="rounded bg-gray-100 px-1 py-0.5 text-xs font-mono text-gray-700" {...props}>{children}</code>
  ),
  strong: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => (
    <strong className="font-semibold text-gray-900" {...props}>{children}</strong>
  ),
}

// ─── 型別 ─────────────────────────────────────────────────────────────────────

interface StepItem {
  id: number
  event: AgentBiEvent
}

// ─── 共用子元件 ───────────────────────────────────────────────────────────────

function StepBadge({ event }: { event: AgentBiEvent }) {
  const map: Record<string, { label: string; className: string }> = {
    start:       { label: '開始',   className: 'bg-gray-100 text-gray-600' },
    agent_step:  { label: event.phase === 'done' ? '完成查詢' : '查詢中', className: event.phase === 'done' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700' },
    done:        { label: '完成',   className: 'bg-emerald-100 text-emerald-700' },
    error:       { label: '錯誤',   className: 'bg-red-100 text-red-700' },
  }
  const { label, className } = map[event.type] ?? { label: event.type, className: 'bg-gray-100 text-gray-500' }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  )
}

function StepCard({ step, showTopic = false }: { step: StepItem; showTopic?: boolean }) {
  const [open, setOpen] = useState(true)
  const { event } = step

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        )}
        <StepBadge event={event} />
        {event.step !== undefined && (
          <span className="text-xs text-gray-400">步驟 {event.step}</span>
        )}
        {/* 多主題模式顯示主題名稱 */}
        {showTopic && event.topic_name && (
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
            {event.topic_name}
          </span>
        )}
        {!open && event.query && (
          <span className="ml-1 truncate text-xs text-gray-500 max-w-xs">{event.query}</span>
        )}
        {!open && event.content && !event.query && (
          <span className="ml-1 truncate text-xs text-gray-500 max-w-xs">{event.content}</span>
        )}
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-2 text-sm">
          {event.type === 'agent_step' && (
            <>
              {event.query && (
                <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800 font-mono">{event.query}</p>
              )}
              {event.phase === 'done' && (
                <div className={`flex items-center gap-1.5 text-xs font-medium ${event.success !== false ? 'text-green-600' : 'text-red-500'}`}>
                  <span>{event.success !== false ? '✓ 查詢成功' : '✗ 查詢失敗'}</span>
                </div>
              )}
            </>
          )}
          {(event.type === 'done' || event.type === 'error') && event.content && (
            <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">{event.content}</p>
          )}
          {event.type === 'done' && event.chart_data && (
            <details>
              <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-600">
                查看 Chart Data
              </summary>
              <pre className="mt-1 overflow-auto rounded bg-gray-50 p-2 text-xs text-gray-600 max-h-48">
                {JSON.stringify(event.chart_data, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

// ─── localStorage 持久化 ──────────────────────────────────────────────────────

const LS_KEY_SINGLE = 'agent-lab-single-v1'
const LS_KEY_MULTI  = 'agent-lab-multi-v1'

interface LabSavedState {
  savedAt: string
  question: string
  steps: StepItem[]
  finalAnswer: string | null
  error: string | null
  selectedProject?: string
  selectedIds?: string[]
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  model?: string
}

function lsLoad(key: string): LabSavedState | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as LabSavedState) : null
  } catch { return null }
}

function lsSave(key: string, state: LabSavedState) {
  try { localStorage.setItem(key, JSON.stringify(state)) } catch { /* quota */ }
}

function lsClear(key: string) {
  try { localStorage.removeItem(key) } catch { /* ignore */ }
}

// ─── 最終回答面板 ─────────────────────────────────────────────────────────────

function FinalAnswerPanel({
  finalAnswer,
  loading,
  savedAt,
  usage,
  model,
  onClear,
}: {
  finalAnswer: string | null
  loading: boolean
  savedAt?: string
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  model?: string
  onClear?: () => void
}) {
  return (
    <div className="flex flex-1 flex-col border-l border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-6 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          最終分析
        </span>
        <div className="flex items-center gap-3">
          {savedAt && !loading && (
            <span className="text-xs text-gray-400">
              儲存於 {savedAt}
            </span>
          )}
          {onClear && finalAnswer && !loading && (
            <button
              type="button"
              onClick={onClear}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            >
              <X className="h-3 w-3" /> 清除
            </button>
          )}
        </div>
      </div>

      {/* Token 用量列 */}
      {usage && !loading && (
        <div className="flex items-center gap-4 border-b border-gray-100 bg-gray-50 px-6 py-2 text-xs text-gray-500">
          {model && <span className="font-medium text-gray-600">{model}</span>}
          <span>prompt <span className="font-mono font-medium text-gray-700">{usage.prompt_tokens.toLocaleString()}</span></span>
          <span>completion <span className="font-mono font-medium text-gray-700">{usage.completion_tokens.toLocaleString()}</span></span>
          <span className="font-medium text-gray-600">total <span className="font-mono text-indigo-600">{usage.total_tokens.toLocaleString()}</span></span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        {loading && !finalAnswer ? (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            等待 Agent 完成...
          </div>
        ) : finalAnswer ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkBreaks]}
            components={LAB_MD_COMPONENTS}
          >
            {finalAnswer.replace(/\\n/g, '\n')}
          </ReactMarkdown>
        ) : null}
      </div>
    </div>
  )
}

// ─── Tab 1：單一分析主題 ──────────────────────────────────────────────────────

function SingleTopicTab({
  projects,
  models,
}: {
  projects: BiProjectItem[]
  models: { value: string; label: string }[]
}) {
  const [selectedProject, setSelectedProject] = useState('')
  const [selectedModel, setSelectedModel] = useState(models[0]?.value ?? '')
  const [question, setQuestion] = useState('')
  const [steps, setSteps] = useState<StepItem[]>([])
  const [finalAnswer, setFinalAnswer] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | undefined>(undefined)
  const [usage, setUsage] = useState<LabSavedState['usage']>(undefined)
  const [usageModel, setUsageModel] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stepsEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const stepIdRef = useRef(0)

  // 從 localStorage 還原上次結果
  useEffect(() => {
    const saved = lsLoad(LS_KEY_SINGLE)
    if (saved) {
      if (saved.selectedProject) setSelectedProject(saved.selectedProject)
      if (saved.question) setQuestion(saved.question)
      setSteps(saved.steps ?? [])
      setFinalAnswer(saved.finalAnswer ?? null)
      setError(saved.error ?? null)
      setSavedAt(saved.savedAt)
      setUsage(saved.usage)
      setUsageModel(saved.model)
      stepIdRef.current = (saved.steps ?? []).length
    }
  }, [])

  // 修改專案或問題時立刻持久化
  const isFirstMount = useRef(true)
  useEffect(() => {
    if (isFirstMount.current) { isFirstMount.current = false; return }
    const existing = lsLoad(LS_KEY_SINGLE) ?? {} as LabSavedState
    lsSave(LS_KEY_SINGLE, {
      ...existing,
      selectedProject,
      question,
    })
  }, [selectedProject, question])

  useEffect(() => {
    if (models.length > 0 && !selectedModel) setSelectedModel(models[0].value)
  }, [models, selectedModel])

  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [steps])

  function handleClear() {
    lsClear(LS_KEY_SINGLE)
    setSteps([])
    setFinalAnswer(null)
    setError(null)
    setSavedAt(undefined)
    setUsage(undefined)
    setUsageModel(undefined)
    stepIdRef.current = 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedProject || !selectedModel || !question.trim() || loading) return

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setLoading(true)
    setSteps([])
    setFinalAnswer(null)
    setError(null)
    setSavedAt(undefined)
    setUsage(undefined)
    setUsageModel(undefined)
    stepIdRef.current = 0

    const collectedSteps: StepItem[] = []
    let collectedAnswer: string | null = null
    let collectedError: string | null = null
    let collectedUsage: LabSavedState['usage'] = undefined
    let collectedModel: string | undefined = undefined

    try {
      await agentBiStream(
        { project_id: selectedProject, model: selectedModel, question: question.trim() },
        (event) => {
          const id = ++stepIdRef.current
          const item = { id, event }
          collectedSteps.push(item)
          setSteps((prev) => [...prev, item])
          if (event.type === 'done') {
            collectedAnswer = event.content ?? ''
            collectedUsage = event.usage
            collectedModel = event.model
            setFinalAnswer(collectedAnswer)
            setUsage(collectedUsage)
            setUsageModel(collectedModel)
          }
          if (event.type === 'error') { collectedError = event.content ?? '發生錯誤'; setError(collectedError) }
        },
        abortRef.current.signal,
      )
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') {
        collectedError = (err as Error)?.message ?? '請求失敗'
        setError(collectedError)
      }
    } finally {
      setLoading(false)
      if (collectedSteps.length > 0 || collectedAnswer || collectedError) {
        const ts = new Date().toLocaleString('zh-TW', { hour12: false })
        lsSave(LS_KEY_SINGLE, {
          savedAt: ts,
          question: question.trim(),
          steps: collectedSteps,
          finalAnswer: collectedAnswer,
          error: collectedError,
          selectedProject,
          usage: collectedUsage,
          model: collectedModel,
        })
        setSavedAt(ts)
      }
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex w-full max-w-xl flex-col gap-4 overflow-y-auto p-6">
        <form onSubmit={handleSubmit} className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">BI 專案</label>
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              disabled={loading}
            >
              <option value="">請選擇專案...</option>
              {projects.map((p) => (
                <option key={p.project_id} value={p.project_id}>{p.project_name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">模型</label>
            {models.length > 0 ? (
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                disabled={loading}
              >
                {models.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                placeholder="例如：gpt-4o"
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                disabled={loading}
              />
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">問題</label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={3}
              placeholder="例如：比較今年Q1和去年Q1的銷售額，哪個月成長最多？"
              className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              disabled={loading}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(e) }}
            />
            <p className="mt-0.5 text-right text-xs text-gray-400">Cmd/Ctrl + Enter 送出</p>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading || !selectedProject || !selectedModel || !question.trim()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {loading ? '分析中...' : '開始分析'}
            </button>
            {loading && (
              <button
                type="button"
                onClick={() => { abortRef.current?.abort(); setLoading(false) }}
                className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100"
              >
                <X className="h-4 w-4" /> 停止
              </button>
            )}
          </div>
        </form>

        {steps.length > 0 && (
          <div className="space-y-2">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
              <Bot className="h-3.5 w-3.5" /> Agent 執行步驟
            </h2>
            {steps.map((s) => <StepCard key={s.id} step={s} />)}
            <div ref={stepsEndRef} />
          </div>
        )}

        {error && !finalAnswer && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
      </div>

      {(finalAnswer !== null || loading) ? (
        <FinalAnswerPanel finalAnswer={finalAnswer} loading={loading} savedAt={savedAt} usage={usage} model={usageModel} onClear={handleClear} />
      ) : (
        <div className="flex flex-1 items-center justify-center border-l border-gray-200 bg-white">
          <div className="text-center text-gray-400">
            <FlaskConical className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="text-sm">選擇專案與模型，輸入問題後開始實驗</p>
            <p className="mt-1 text-xs text-gray-300">Agent 將自動決定需要幾次查詢</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tab 2：多分析主題 Chat Bot ───────────────────────────────────────────────

function MultiTopicTab({
  projects,
  models,
}: {
  projects: BiProjectItem[]
  models: { value: string; label: string }[]
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedModel, setSelectedModel] = useState(models[0]?.value ?? '')
  const [question, setQuestion] = useState('')
  const [steps, setSteps] = useState<StepItem[]>([])
  const [finalAnswer, setFinalAnswer] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | undefined>(undefined)
  const [usage, setUsage] = useState<LabSavedState['usage']>(undefined)
  const [usageModel, setUsageModel] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stepsEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const stepIdRef = useRef(0)

  // 從 localStorage 還原上次結果
  useEffect(() => {
    const saved = lsLoad(LS_KEY_MULTI)
    if (saved) {
      if (saved.selectedIds?.length) setSelectedIds(new Set(saved.selectedIds))
      if (saved.question) setQuestion(saved.question)
      setSteps(saved.steps ?? [])
      setFinalAnswer(saved.finalAnswer ?? null)
      setError(saved.error ?? null)
      setSavedAt(saved.savedAt)
      setUsage(saved.usage)
      setUsageModel(saved.model)
      stepIdRef.current = (saved.steps ?? []).length
    }
  }, [])

  // 勾選主題或修改問題時立刻持久化（讓切換 Tab 後還原）
  const isFirstMount = useRef(true)
  useEffect(() => {
    if (isFirstMount.current) { isFirstMount.current = false; return }
    const existing = lsLoad(LS_KEY_MULTI) ?? {} as LabSavedState
    lsSave(LS_KEY_MULTI, {
      ...existing,
      selectedIds: Array.from(selectedIds),
      question,
    })
  }, [selectedIds, question])

  useEffect(() => {
    if (models.length > 0 && !selectedModel) setSelectedModel(models[0].value)
  }, [models, selectedModel])

  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [steps])

  function handleClear() {
    lsClear(LS_KEY_MULTI)
    setSteps([])
    setFinalAnswer(null)
    setError(null)
    setSavedAt(undefined)
    setUsage(undefined)
    setUsageModel(undefined)
    stepIdRef.current = 0
  }

  function toggleProject(pid: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(pid)) {
        next.delete(pid)
      } else {
        if (next.size >= 5) return prev
        next.add(pid)
      }
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (selectedIds.size < 2 || !selectedModel || !question.trim() || loading) return

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setLoading(true)
    setSteps([])
    setFinalAnswer(null)
    setError(null)
    setSavedAt(undefined)
    setUsage(undefined)
    setUsageModel(undefined)
    stepIdRef.current = 0

    const collectedSteps: StepItem[] = []
    let collectedAnswer: string | null = null
    let collectedError: string | null = null
    let collectedUsage: LabSavedState['usage'] = undefined
    let collectedModel: string | undefined = undefined

    try {
      await agentBiMultiStream(
        {
          project_ids: Array.from(selectedIds),
          model: selectedModel,
          question: question.trim(),
        },
        (event) => {
          const id = ++stepIdRef.current
          const item = { id, event }
          collectedSteps.push(item)
          setSteps((prev) => [...prev, item])
          if (event.type === 'done') {
            collectedAnswer = event.content ?? ''
            collectedUsage = event.usage
            collectedModel = event.model
            setFinalAnswer(collectedAnswer)
            setUsage(collectedUsage)
            setUsageModel(collectedModel)
          }
          if (event.type === 'error') { collectedError = event.content ?? '發生錯誤'; setError(collectedError) }
        },
        abortRef.current.signal,
      )
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') {
        collectedError = (err as Error)?.message ?? '請求失敗'
        setError(collectedError)
      }
    } finally {
      setLoading(false)
      if (collectedSteps.length > 0 || collectedAnswer || collectedError) {
        const ts = new Date().toLocaleString('zh-TW', { hour12: false })
        lsSave(LS_KEY_MULTI, {
          savedAt: ts,
          question: question.trim(),
          steps: collectedSteps,
          finalAnswer: collectedAnswer,
          error: collectedError,
          selectedIds: Array.from(selectedIds),
          usage: collectedUsage,
          model: collectedModel,
        })
        setSavedAt(ts)
      }
    }
  }

  const selectedCount = selectedIds.size

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex w-full max-w-xl flex-col gap-4 overflow-y-auto p-6">
        <form onSubmit={handleSubmit} className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">

          {/* 多選主題 */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-medium text-gray-700">
                分析主題
                <span className="ml-1 text-gray-400">（至少選 2 個，最多 5 個）</span>
              </label>
              <span className={`text-xs font-medium ${selectedCount >= 2 ? 'text-indigo-600' : 'text-gray-400'}`}>
                已選 {selectedCount} 個
              </span>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 divide-y divide-gray-100 max-h-48 overflow-y-auto">
              {projects.length === 0 ? (
                <p className="px-3 py-2 text-xs text-gray-400">尚無分析主題</p>
              ) : (
                projects.map((p) => {
                  const checked = selectedIds.has(p.project_id)
                  const disabled = loading || (!checked && selectedCount >= 5)
                  return (
                    <label
                      key={p.project_id}
                      className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors ${
                        checked ? 'bg-indigo-50' : disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleProject(p.project_id)}
                        className="h-3.5 w-3.5 rounded accent-indigo-600"
                      />
                      <span className="text-sm text-gray-700">{p.project_name}</span>
                    </label>
                  )
                })
              )}
            </div>
          </div>

          {/* 已選主題預覽 */}
          {selectedCount > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Array.from(selectedIds).map((pid) => {
                const p = projects.find((x) => x.project_id === pid)
                if (!p) return null
                return (
                  <span
                    key={pid}
                    className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700"
                  >
                    {p.project_name}
                    {!loading && (
                      <button
                        type="button"
                        onClick={() => toggleProject(pid)}
                        className="ml-0.5 hover:text-indigo-900"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                )
              })}
            </div>
          )}

          {/* 模型選擇 */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">模型</label>
            {models.length > 0 ? (
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                disabled={loading}
              >
                {models.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                placeholder="例如：gpt-4o"
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                disabled={loading}
              />
            )}
          </div>

          {/* 問題輸入 */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">問題</label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={3}
              placeholder="例如：業績最好的業務，在客服記錄中的客訴率是多少？"
              className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              disabled={loading}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(e) }}
            />
            <p className="mt-0.5 text-right text-xs text-gray-400">Cmd/Ctrl + Enter 送出</p>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading || selectedCount < 2 || !selectedModel || !question.trim()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers className="h-4 w-4" />}
              {loading ? '跨主題分析中...' : '開始跨主題分析'}
            </button>
            {loading && (
              <button
                type="button"
                onClick={() => { abortRef.current?.abort(); setLoading(false) }}
                className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100"
              >
                <X className="h-4 w-4" /> 停止
              </button>
            )}
          </div>

          {selectedCount < 2 && selectedCount > 0 && (
            <p className="text-xs text-amber-600">請再選擇至少 {2 - selectedCount} 個主題</p>
          )}
        </form>

        {/* Agent 執行步驟（顯示主題標籤） */}
        {steps.length > 0 && (
          <div className="space-y-2">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
              <Bot className="h-3.5 w-3.5" /> Agent 執行步驟
            </h2>
            {steps.map((s) => <StepCard key={s.id} step={s} showTopic />)}
            <div ref={stepsEndRef} />
          </div>
        )}

        {error && !finalAnswer && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
      </div>

      {(finalAnswer !== null || loading) ? (
        <FinalAnswerPanel finalAnswer={finalAnswer} loading={loading} savedAt={savedAt} usage={usage} model={usageModel} onClear={handleClear} />
      ) : (
        <div className="flex flex-1 items-center justify-center border-l border-gray-200 bg-white">
          <div className="text-center text-gray-400">
            <Layers className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="text-sm">勾選 2 個以上主題，輸入跨主題問題</p>
            <p className="mt-1 text-xs text-gray-300">AI 自動分解問題、分頭查詢、整合洞察</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 主頁面 ───────────────────────────────────────────────────────────────────

type TabId = 'single' | 'multi'

export default function AgentLabPage() {
  const [activeTab, setActiveTab] = useState<TabId>('single')
  const [projects, setProjects] = useState<BiProjectItem[]>([])
  const [models, setModels] = useState<{ value: string; label: string }[]>([])

  useEffect(() => {
    listAllBiProjects()
      .then(setProjects)
      .catch(() => {/* 忽略 */})

    Promise.all([listLLMConfigs(), getTenantConfig()])
      .then(([configs, tenantCfg]: [LLMProviderConfig[], { default_llm_model?: string | null; default_llm_provider?: string | null }]) => {
        const opts: { value: string; label: string }[] = []
        const seen = new Set<string>()

        for (const cfg of configs) {
          if (!cfg.is_active) continue
          for (const m of cfg.available_models ?? []) {
            if (seen.has(m.model)) continue
            seen.add(m.model)
            const label = m.note ? `${m.model} (${m.note})` : m.model
            opts.push({ value: m.model, label: `[${cfg.label ?? cfg.provider}] ${label}` })
          }
        }

        const defaultModel = tenantCfg.default_llm_model
        if (defaultModel && !seen.has(defaultModel)) {
          const provider = tenantCfg.default_llm_provider ?? 'local'
          opts.unshift({ value: defaultModel, label: `[${provider}] ${defaultModel} ★預設` })
        }

        setModels(opts)
      })
      .catch(() => {/* 忽略 */})
  }, [])

  const tabs: { id: TabId; label: string; icon: React.ReactNode; desc: string }[] = [
    {
      id: 'single',
      label: '單一分析主題',
      icon: <FlaskConical className="h-4 w-4" />,
      desc: 'Multi-step tool calling，單一主題深度分析',
    },
    {
      id: 'multi',
      label: '多分析主題',
      icon: <Layers className="h-4 w-4" />,
      desc: '問題自動分解，跨主題查詢後合併洞察',
    },
  ]

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-purple-600" />
          <h1 className="text-base font-semibold text-gray-900">Agent BI 實驗室</h1>
          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
            Dev Only
          </span>
        </div>
        <p className="mt-0.5 text-xs text-gray-500">
          {tabs.find((t) => t.id === activeTab)?.desc}
        </p>

        {/* Tab 切換 */}
        <div className="mt-3 flex gap-1 border-b border-gray-100 -mb-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? tab.id === 'multi'
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-purple-500 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'single' ? (
        <SingleTopicTab projects={projects} models={models} />
      ) : (
        <MultiTopicTab projects={projects} models={models} />
      )}
    </div>
  )
}
