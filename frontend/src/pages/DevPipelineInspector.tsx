/**
 * 開發用 Pipeline Inspector：輸入問題 + project_id → Tab 檢視
 *   Tab 1：Prompt（上）+ Intent JSON（下）
 *   Tab 2：SQL（上）+ Chart Result（下）
 * 路徑 /dev-pipeline-inspector
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy } from 'lucide-react'
import { format as formatSql } from 'sql-formatter'
import { pipelineInspect, type PipelineInspectResponse } from '@/api/chat'
import { listAllBiProjects, type BiProjectItem } from '@/api/biProjects'
import { listBiSchemas, type BiSchemaItem } from '@/api/biSchemas'
import { ApiError } from '@/api/client'
import LLMModelSelect from '@/components/LLMModelSelect'

// ──────────────────────────────────────────────
// LocalStorage keys
// ──────────────────────────────────────────────
const LS = {
  question: 'neurosme:dev-pipeline:question',
  projectId: 'neurosme:dev-pipeline:project-id',
  schemaId: 'neurosme:dev-pipeline:schema-id',
  model: 'neurosme:dev-pipeline:model',
  result: 'neurosme:dev-pipeline:result',
}

function ls(key: string, fallback = '') {
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}
function lsSet(key: string, val: string) {
  try { localStorage.setItem(key, val) } catch { /* quota */ }
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
function useCopyHint() {
  const [hint, setHint] = useState('')
  async function copy(text: string) {
    if (!text.trim()) return
    try {
      await navigator.clipboard.writeText(text)
      setHint('已複製')
    } catch {
      setHint('複製失敗')
    }
    setTimeout(() => setHint(''), 2000)
  }
  return { hint, copy }
}

/** 水平拖曳分隔條，回傳左側寬度百分比（10~90） */
function useSplitDrag(initial = 50) {
  const [pct, setPct] = useState(initial)
  const dragging = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const newPct = Math.min(90, Math.max(10, (x / rect.width) * 100))
      setPct(newPct)
    }
    function onUp() {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  return { pct, containerRef, onMouseDown }
}

// ──────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────
function SectionHeader({
  title,
  badge,
  hint,
  onCopy,
}: {
  title: string
  badge?: string
  hint?: string
  onCopy?: () => void
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</span>
        {badge && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{badge}</span>
        )}
      </div>
      {onCopy && (
        <div className="flex items-center gap-1.5">
          {hint && <span className="text-[11px] text-slate-400" aria-live="polite">{hint}</span>}
          <button
            type="button"
            onClick={onCopy}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <Copy className="h-3.5 w-3.5" />
            複製
          </button>
        </div>
      )}
    </div>
  )
}

function CodePane({ text, placeholder }: { text: string; placeholder?: string }) {
  return (
    <pre className="flex-1 basis-0 overflow-auto whitespace-pre-wrap break-words bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-800 selection:bg-slate-200 selection:text-slate-900">
      {text || <span className="text-slate-400">{placeholder ?? '—'}</span>}
    </pre>
  )
}

// ──────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────
type TabId = 'intent' | 'compute'

export default function DevPipelineInspector() {
  const [question, setQuestion] = useState(() => ls(LS.question))
  const [projectId, setProjectId] = useState(() => ls(LS.projectId))
  const [schemaId, setSchemaId] = useState(() => ls(LS.schemaId))
  const [model, setModel] = useState(() => ls(LS.model, 'gpt-4o-mini'))

  const [projects, setProjects] = useState<BiProjectItem[]>([])
  const [schemas, setSchemas] = useState<BiSchemaItem[]>([])

  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<PipelineInspectResponse | null>(() => {
    try {
      const raw = localStorage.getItem(LS.result)
      return raw ? (JSON.parse(raw) as PipelineInspectResponse) : null
    } catch { return null }
  })
  const [fetchError, setFetchError] = useState<string>('')

  const [activeTab, setActiveTab] = useState<TabId>('intent')

  const split1 = useSplitDrag(67)  // Tab 1: Prompt | Intent
  const split2 = useSplitDrag(67)  // Tab 2: SQL | Result

  useEffect(() => {
    listAllBiProjects().then(setProjects).catch(() => {})
    listBiSchemas().then(setSchemas).catch(() => {})
  }, [])

  const promptCopy = useCopyHint()
  const intentCopy = useCopyHint()
  const sqlCopy = useCopyHint()
  const resultCopy = useCopyHint()

  async function handleRun() {
    const q = question.trim()
    const pid = projectId.trim()
    if (!q) { setFetchError('請輸入問題'); return }
    if (!pid) { setFetchError('請選擇專案'); return }

    setFetchError('')
    setResult(null)
    setLoading(true)
    try {
      const res = await pipelineInspect({
        question: q,
        project_id: pid,
        schema_id: schemaId.trim() || undefined,
        model: model.trim() || undefined,
      })
      setResult(res)
      try { localStorage.setItem(LS.result, JSON.stringify(res)) } catch { /* quota */ }
      // 若 compute 階段才失敗，自動切到 Tab 2 方便查看
      if (res.stage_failed === 'compute') setActiveTab('compute')
    } catch (e) {
      const msg = e instanceof ApiError ? e.detail || e.message : e instanceof Error ? e.message : String(e)
      setFetchError(`請求失敗：${msg}`)
    } finally {
      setLoading(false)
    }
  }

  const promptText = result?.user_content ?? ''
  const intentText = result ? JSON.stringify(result.intent, null, 2) : ''
  const sqlRaw = result?.sql ?? ''
  const sqlText = sqlRaw
    ? (() => { try { return formatSql(sqlRaw, { language: 'sql', tabWidth: 2, keywordCase: 'upper' }) } catch { return sqlRaw } })()
    : ''
  const chartText = result ? JSON.stringify(result.chart_result, null, 2) : ''

  const stageLabel: Record<string, string> = {
    intent_llm: 'LLM 意圖萃取',
    intent_parse: 'Intent 解析',
    intent_validate: 'Intent 驗證',
    compute: '計算引擎',
  }

  const inputClass =
    'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1 scheme-light [color-scheme:light]'

  const tabs: { id: TabId; label: string }[] = [
    { id: 'intent', label: 'Prompt & Intent' },
    { id: 'compute', label: 'SQL & Result' },
  ]

  return (
    <div className="force-light-form-widgets box-border flex min-h-[100dvh] w-full flex-1 flex-col px-4 py-4 md:min-h-0">

      {/* ── 輸入列 ── */}
      <section className="mb-3 shrink-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1" style={{ minWidth: '220px' }}>
            <label className="text-xs font-medium text-slate-500">問題</label>
            <input
              type="text"
              value={question}
              onChange={e => { setQuestion(e.target.value); lsSet(LS.question, e.target.value) }}
              placeholder="例：上個月各產品銷售額各是多少？"
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-1" style={{ width: '190px' }}>
            <label className="text-xs font-medium text-slate-500">專案</label>
            <select
              value={projectId}
              onChange={e => { setProjectId(e.target.value); lsSet(LS.projectId, e.target.value) }}
              className={inputClass}
            >
              <option value="">— 選擇專案 —</option>
              {projects.map(p => (
                <option key={p.project_id} value={p.project_id}>{p.project_name}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1" style={{ width: '160px' }}>
            <label className="text-xs font-medium text-slate-500">Schema（可選）</label>
            <select
              value={schemaId}
              onChange={e => { setSchemaId(e.target.value); lsSet(LS.schemaId, e.target.value) }}
              className={inputClass}
            >
              <option value="">— 用專案預設 —</option>
              {schemas.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="min-w-0" style={{ width: '180px' }}>
            <LLMModelSelect
              label="模型"
              labelPosition="stacked"
              compact
              value={model}
              onChange={(v) => {
                setModel(v)
                lsSet(LS.model, v)
              }}
              disabled={loading}
              labelClassName="text-xs font-medium text-slate-500"
              selectClassName={inputClass}
              className="w-full"
            />
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => void handleRun()}
            className="shrink-0 rounded-md bg-slate-800 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-900 disabled:opacity-50"
          >
            {loading ? '執行中…' : '執行'}
          </button>
        </div>

        {fetchError && <p className="mt-2 text-xs text-red-600">{fetchError}</p>}
        {result?.stage_failed && (
          <p className="mt-2 text-xs font-medium text-red-600">
            ✗ 失敗於 {stageLabel[result.stage_failed] ?? result.stage_failed}：{result.error}
          </p>
        )}
        {result && !result.stage_failed && (
          <p className="mt-2 text-xs text-emerald-600">
            ✓ 完成　
            {result.intent_usage
              ? `tokens: prompt=${result.intent_usage.prompt_tokens ?? '?'} / completion=${result.intent_usage.completion_tokens ?? '?'}`
              : ''}
          </p>
        )}
      </section>

      {/* ── Tab 列 ── */}
      <div className="mb-0 flex shrink-0 gap-1 border-b border-slate-200">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-t-md px-5 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'border border-b-white border-slate-200 bg-white text-slate-800'
                : 'text-slate-500 hover:text-slate-700'
            }`}
            style={activeTab === tab.id ? { marginBottom: '-1px' } : {}}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab 內容 ── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-lg rounded-tr-lg border border-slate-200 bg-white shadow-sm">

        {/* Tab 1: Prompt + Intent */}
        {activeTab === 'intent' && (
          <div ref={split1.containerRef} className="flex min-h-0 flex-1 flex-row">
            {/* Prompt（左）*/}
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden" style={{ width: `${split1.pct}%` }}>
              <SectionHeader
                title="User Prompt"
                badge={promptText ? `${promptText.length} chars` : undefined}
                hint={promptCopy.hint}
                onCopy={promptText ? () => void promptCopy.copy(promptText) : undefined}
              />
              <CodePane text={promptText} placeholder="執行後顯示注入 schema 的 User Message" />
            </div>

            {/* 拖曳分隔條 */}
            <div
              onMouseDown={split1.onMouseDown}
              className="group flex w-2 shrink-0 cursor-col-resize items-center justify-center bg-slate-100 hover:bg-slate-200 active:bg-slate-300"
            >
              <div className="h-8 w-0.5 rounded-full bg-slate-300 group-hover:bg-slate-400" />
            </div>

            {/* Intent JSON（右）*/}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <SectionHeader
                title="Intent JSON"
                hint={intentCopy.hint}
                onCopy={intentText ? () => void intentCopy.copy(intentText) : undefined}
              />
              <CodePane text={intentText} placeholder="LLM 解析出的 Intent v4 JSON" />
              {result?.intent_raw && result.intent_raw !== intentText && (
                <details className="shrink-0 border-t border-slate-200">
                  <summary className="cursor-pointer px-4 py-2 text-xs text-slate-500 hover:text-slate-700">
                    LLM 原始回覆（raw）
                  </summary>
                  <pre className="max-h-36 overflow-auto whitespace-pre-wrap px-4 pb-3 font-mono text-[11px] text-slate-600">
                    {result.intent_raw}
                  </pre>
                </details>
              )}
            </div>
          </div>
        )}

        {/* Tab 2: SQL + Result */}
        {activeTab === 'compute' && (
          <div ref={split2.containerRef} className="flex min-h-0 flex-1 flex-row">
            {/* SQL（左）*/}
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden" style={{ width: `${split2.pct}%` }}>
              <SectionHeader
                title="Generated SQL"
                hint={sqlCopy.hint}
                onCopy={sqlRaw ? () => void sqlCopy.copy(sqlRaw) : undefined}
              />
              <CodePane text={sqlText} placeholder="compute_engine 組出的 SQL" />
              {result?.sql_params && result.sql_params.length > 0 && (
                <div className="shrink-0 border-t border-slate-100 px-4 py-2">
                  <span className="text-[11px] font-medium text-slate-500">params: </span>
                  <span className="font-mono text-[11px] text-slate-600">
                    {JSON.stringify(result.sql_params)}
                  </span>
                </div>
              )}
            </div>

            {/* 拖曳分隔條 */}
            <div
              onMouseDown={split2.onMouseDown}
              className="group flex w-2 shrink-0 cursor-col-resize items-center justify-center bg-slate-100 hover:bg-slate-200 active:bg-slate-300"
            >
              <div className="h-8 w-0.5 rounded-full bg-slate-300 group-hover:bg-slate-400" />
            </div>

            {/* Chart Result（右）*/}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <SectionHeader
                title="Chart Result"
                hint={resultCopy.hint}
                onCopy={chartText ? () => void resultCopy.copy(chartText) : undefined}
              />
              <CodePane text={chartText} placeholder="compute_engine 回傳的 chart_result JSON" />
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
