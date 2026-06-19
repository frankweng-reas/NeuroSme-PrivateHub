/**
 * Agent BI 實驗室 (Dev Test Page)
 * 路徑：/agent-lab
 * 完全獨立，不影響現有 BI 功能。
 */
import { useEffect, useRef, useState } from 'react'
import { Bot, ChevronDown, ChevronRight, FlaskConical, Loader2, Send, X } from 'lucide-react'
import { agentBiStream, type AgentBiEvent } from '@/api/agentBi'
import { listAllBiProjects, type BiProjectItem } from '@/api/biProjects'
import { getTenantConfig, listLLMConfigs } from '@/api/llmConfigs'
import type { LLMProviderConfig } from '@/types'

// ─── 型別 ─────────────────────────────────────────────────────────────────────

interface StepItem {
  id: number
  event: AgentBiEvent
}

// ─── 子元件 ───────────────────────────────────────────────────────────────────

function StepBadge({ type }: { type: AgentBiEvent['type'] }) {
  const map: Record<string, { label: string; className: string }> = {
    start:       { label: '開始',     className: 'bg-gray-100 text-gray-600' },
    thinking:    { label: '思考中',   className: 'bg-blue-100 text-blue-700' },
    tool_call:   { label: '呼叫工具', className: 'bg-amber-100 text-amber-700' },
    tool_result: { label: '工具結果', className: 'bg-green-100 text-green-700' },
    done:        { label: '完成',     className: 'bg-emerald-100 text-emerald-700' },
    error:       { label: '錯誤',     className: 'bg-red-100 text-red-700' },
  }
  const { label, className } = map[type] ?? { label: type, className: 'bg-gray-100 text-gray-500' }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  )
}

function StepCard({ step }: { step: StepItem }) {
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
        <StepBadge type={event.type} />
        {event.step !== undefined && (
          <span className="text-xs text-gray-400">步驟 {event.step}</span>
        )}
        {event.tool && (
          <code className="text-xs bg-gray-100 rounded px-1.5 py-0.5 text-gray-600">{event.tool}</code>
        )}
        {!open && event.content && (
          <span className="ml-1 truncate text-xs text-gray-500 max-w-xs">{event.content}</span>
        )}
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-2 text-sm">
          {/* thinking / start / error / done 的文字內容 */}
          {event.content && (
            <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">{event.content}</p>
          )}

          {/* tool_call：顯示查詢描述 */}
          {event.type === 'tool_call' && (event as AgentBiEvent & { query?: string }).query && (
            <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800 font-mono">
              {(event as AgentBiEvent & { query?: string }).query}
            </p>
          )}

          {/* tool_result：顯示查詢結果 */}
          {event.type === 'tool_result' && (
            <>
              <div className={`flex items-center gap-1.5 text-xs font-medium ${event.success ? 'text-green-600' : 'text-red-500'}`}>
                <span>{event.success ? '✓ 查詢成功' : '✗ 查詢失敗'}</span>
              </div>
              {event.result && (
                <pre className="overflow-auto rounded bg-gray-50 p-2 text-xs text-gray-600 whitespace-pre-wrap">
                  {event.result}
                </pre>
              )}
              {event.chart_data && (
                <details>
                  <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-600">
                    查看 Chart Data
                  </summary>
                  <pre className="mt-1 overflow-auto rounded bg-gray-50 p-2 text-xs text-gray-600 max-h-48">
                    {JSON.stringify(event.chart_data, null, 2)}
                  </pre>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── 主頁面 ───────────────────────────────────────────────────────────────────

export default function AgentLabPage() {
  const [projects, setProjects] = useState<BiProjectItem[]>([])
  const [models, setModels] = useState<{ value: string; label: string }[]>([])
  const [selectedProject, setSelectedProject] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [question, setQuestion] = useState('')
  const [steps, setSteps] = useState<StepItem[]>([])
  const [finalAnswer, setFinalAnswer] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stepsEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const stepIdRef = useRef(0)

  // 載入專案與模型清單
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

        // 若預設模型不在 available_models 清單，補入
        const defaultModel = tenantCfg.default_llm_model
        if (defaultModel && !seen.has(defaultModel)) {
          const provider = tenantCfg.default_llm_provider ?? 'local'
          opts.unshift({ value: defaultModel, label: `[${provider}] ${defaultModel} ★預設` })
        }

        setModels(opts)

        // 優先選預設模型，否則選第一個
        const preselect = defaultModel ?? (opts[0]?.value ?? '')
        setSelectedModel(preselect)
      })
      .catch(() => {/* 忽略 */})
  }, [])

  // 自動捲動到最新步驟
  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [steps])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedProject || !selectedModel || !question.trim() || loading) return

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    setSteps([])
    setFinalAnswer(null)
    setError(null)
    stepIdRef.current = 0

    try {
      await agentBiStream(
        { project_id: selectedProject, model: selectedModel, question: question.trim() },
        (event) => {
          const id = ++stepIdRef.current
          setSteps((prev) => [...prev, { id, event }])
          if (event.type === 'done') setFinalAnswer(event.content ?? '')
          if (event.type === 'error') setError(event.content ?? '發生錯誤')
        },
        abortRef.current.signal,
      )
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') {
        setError((err as Error)?.message ?? '請求失敗')
      }
    } finally {
      setLoading(false)
    }
  }

  function handleStop() {
    abortRef.current?.abort()
    setLoading(false)
  }

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
          Multi-step tool calling 測試環境，與現有 BI 分析功能完全獨立
        </p>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* 左側：設定 + 步驟記錄 */}
        <div className="flex w-full max-w-xl flex-col gap-4 overflow-y-auto p-6">
          {/* 設定區 */}
          <form onSubmit={handleSubmit} className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
            {/* 專案選擇 */}
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
                  <option key={p.project_id} value={p.project_id}>
                    {p.project_name}
                  </option>
                ))}
              </select>
            </div>

            {/* 模型選擇 */}
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
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  placeholder="例如：gpt-4o, gemini/gemini-1.5-pro"
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
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
                placeholder="例如：比較今年Q1和去年Q1的銷售額，哪個月成長最多？"
                className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                disabled={loading}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    handleSubmit(e)
                  }
                }}
              />
              <p className="mt-0.5 text-right text-xs text-gray-400">Cmd/Ctrl + Enter 送出</p>
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={loading || !selectedProject || !selectedModel || !question.trim()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {loading ? '分析中...' : '開始分析'}
              </button>
              {loading && (
                <button
                  type="button"
                  onClick={handleStop}
                  className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100"
                >
                  <X className="h-4 w-4" /> 停止
                </button>
              )}
            </div>
          </form>

          {/* Agent 思考步驟 */}
          {steps.length > 0 && (
            <div className="space-y-2">
              <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                <Bot className="h-3.5 w-3.5" /> Agent 執行步驟
              </h2>
              {steps.map((s) => (
                <StepCard key={s.id} step={s} />
              ))}
              <div ref={stepsEndRef} />
            </div>
          )}

          {/* 錯誤訊息 */}
          {error && !finalAnswer && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* 右側：最終回答 */}
        {(finalAnswer !== null || loading) && (
          <div className="flex flex-1 flex-col border-l border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-6 py-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                最終分析
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {loading && !finalAnswer ? (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  等待 Agent 完成...
                </div>
              ) : finalAnswer ? (
                <div className="prose prose-sm max-w-none text-gray-800">
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{finalAnswer}</pre>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* 空白狀態（右側） */}
        {finalAnswer === null && !loading && steps.length === 0 && (
          <div className="flex flex-1 items-center justify-center border-l border-gray-200 bg-white">
            <div className="text-center text-gray-400">
              <FlaskConical className="mx-auto mb-3 h-10 w-10 opacity-30" />
              <p className="text-sm">選擇專案與模型，輸入問題後開始實驗</p>
              <p className="mt-1 text-xs text-gray-300">Agent 將自動決定需要幾次查詢</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
