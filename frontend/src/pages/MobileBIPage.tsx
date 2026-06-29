/**
 * MobileBIPage — 手機版 BI 分析查詢介面
 * 路由：/bi（全螢幕，不套用 Layout sidebar）
 * 功能：主題選擇、聊天輸入、分析結果顯示、圖表視覺化
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  BarChart2, BarChart3, ChevronDown, Lightbulb,
  Loader2, Send, X, CheckCircle2, XCircle,
} from 'lucide-react'
import { chatAgentBiStream, type AgentStepEvent } from '@/api/chat'
import { agentBiMultiStream } from '@/api/agentBi'
import { transcribeAudio, getSpeechStatus } from '@/api/speech'
import VoiceInput from '@/components/VoiceInput'
import { listBiProjects, type BiProjectItem } from '@/api/biProjects'
import ChartModal, { type ChartData } from '@/components/ChartModal'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgentChartEntry {
  step: number
  query: string
  chartData: ChartData
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  charts?: AgentChartEntry[]
  error?: boolean
}

/** 統一單/多主題模式的步驟事件 */
interface StepEvent {
  step: number
  query: string
  phase: 'running' | 'done'
  success?: boolean
  topic_name?: string   // 多主題模式才有
}

// ── Table chart helpers (共用自 AgentChat 邏輯) ────────────────────────────────

function extractTextFromNode(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractTextFromNode).join('')
  if (React.isValidElement(node)) {
    const p = node.props as { children?: React.ReactNode }
    return extractTextFromNode(p.children)
  }
  return ''
}

function extractTableData(children: React.ReactNode): string[][] {
  const rows: string[][] = []
  React.Children.forEach(children, (section) => {
    if (!React.isValidElement(section)) return
    const sec = (section.props as { children?: React.ReactNode }).children
    React.Children.forEach(sec, (row) => {
      if (!React.isValidElement(row)) return
      const cells: string[] = []
      const rc = (row.props as { children?: React.ReactNode }).children
      React.Children.forEach(rc, (cell) => {
        if (!React.isValidElement(cell)) return
        cells.push(extractTextFromNode((cell.props as { children?: React.ReactNode }).children))
      })
      if (cells.length > 0) rows.push(cells)
    })
  })
  return rows
}

const SUMMARY_ROW_KEYWORDS = new Set([
  '總計', '合計', '小計', '總和', '全部', '匯總', '加總',
  'total', 'sum', 'grand total', 'subtotal', 'all', 'overall',
])

function isSummaryLabel(label: string): boolean {
  const t = label.trim().toLowerCase()
  return t === '' || SUMMARY_ROW_KEYWORDS.has(t)
}

function tableToChartData(rows: string[][]): ChartData | null {
  if (rows.length < 2) return null
  const headers = rows[0]
  const allDataRows = rows.slice(1)
  const parseNum = (v: string): number | null => {
    const t = v.trim()
    if (!t || !/^-?\d/.test(t) || /[\u4e00-\u9fff]/.test(t) || /\d-\d/.test(t)) return null
    const n = parseFloat(t.replace(/,/g, '').replace(/[^\d.-]/g, ''))
    return isNaN(n) ? null : n
  }
  const labelColIdx = headers.findIndex((_, ci) =>
    allDataRows.some((r) => { const v = (r[ci] ?? '').trim(); return v !== '' && parseNum(v) === null })
  )
  if (labelColIdx === -1) return null
  // 排除總計/合計/空 label 的摘要列
  const dataRows = allDataRows.filter((r) => !isSummaryLabel(r[labelColIdx] ?? ''))
  if (dataRows.length === 0) return null
  const labels = dataRows.map((r) => (r[labelColIdx] ?? '').trim())
  const datasets = headers.map((h, ci) => {
    if (ci === labelColIdx) return null
    const nums = dataRows.map((r) => parseNum((r[ci] ?? '').trim()))
    if (nums.every((n) => n === null)) return null
    return { label: h, data: nums.map((n) => n ?? 0) }
  }).filter(Boolean) as { label: string; data: number[] }[]
  if (datasets.length === 0) return null
  return { chartType: 'bar', labels, datasets }
}

/** 手機版 TableWithActions：Markdown table renderer，帶圖表按鈕 */
function TableWithActions({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  const tableData = extractTableData(children as React.ReactNode)
  const chartable = tableToChartData(tableData)
  const [chartOpen, setChartOpen] = useState(false)

  return (
    <div className="my-2">
      <div className="overflow-x-auto -mx-1">
        <table className="min-w-full border-collapse border border-gray-200 text-xs" {...props}>
          {children}
        </table>
      </div>
      {chartable && (
        <div className="mt-1.5">
          <button onClick={() => setChartOpen(true)} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 transition-colors">
            <BarChart3 className="h-3 w-3" /> 圖表
          </button>
        </div>
      )}
      {chartOpen && chartable && <ChartModal open data={chartable} onClose={() => setChartOpen(false)} />}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const BI_AGENT_ID = 'business'
const BI_SELECTED_KEY = 'bi_selected_project_ids'
// ── Progress overlay (inline, mobile-optimised) ───────────────────────────────

function ProgressOverlay({
  steps, visible, finalizing,
}: { steps: StepEvent[]; visible: boolean; finalizing: boolean }) {
  if (!visible) return null

  const stepMap = new Map<number, StepEvent>()
  for (const s of steps) {
    const prev = stepMap.get(s.step)
    if (!prev || s.phase === 'done') stepMap.set(s.step, s)
  }
  const display = Array.from(stepMap.values()).sort((a, b) => a.step - b.step)

  return (
    <div className="fixed bottom-[72px] left-0 right-0 flex justify-center px-4 z-30 pointer-events-none">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white/95 px-4 py-3 shadow-xl backdrop-blur-sm pointer-events-auto">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">分析中</p>
        <div className="space-y-1.5">
          {display.map((s) => (
            <div key={s.step} className="flex items-center gap-2">
              {s.phase === 'running' ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />
              ) : s.success !== false ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
              ) : (
                <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
              )}
              <span className="truncate text-sm text-gray-700">
                {s.topic_name && (
                  <span className="mr-1 rounded-full bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-600 font-medium">
                    {s.topic_name}
                  </span>
                )}
                {s.query.length > 36 ? s.query.slice(0, 36) + '…' : s.query}
              </span>
            </div>
          ))}
          {finalizing && (
            <div className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-purple-500" />
              <span className="text-sm text-gray-500">整理分析中…</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Project Picker bottom sheet ───────────────────────────────────────────────

function ProjectPicker({
  open, projects, selected, onConfirm, onClose,
}: {
  open: boolean
  projects: BiProjectItem[]
  selected: BiProjectItem[]
  onConfirm: (ps: BiProjectItem[]) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<Set<string>>(new Set(selected.map((p) => p.project_id)))

  // 每次開啟時同步外部選擇狀態
  useEffect(() => {
    if (open) setDraft(new Set(selected.map((p) => p.project_id)))
  }, [open, selected])

  function toggle(p: BiProjectItem) {
    setDraft((prev) => {
      const next = new Set(prev)
      if (next.has(p.project_id)) {
        next.delete(p.project_id)
      } else {
        if (next.size >= 5) return prev
        next.add(p.project_id)
      }
      return next
    })
  }

  function handleConfirm() {
    const result = projects.filter((p) => draft.has(p.project_id))
    onConfirm(result)
    onClose()
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative rounded-t-2xl bg-white shadow-xl max-h-[75vh] flex flex-col">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <div>
            <span className="text-base font-semibold text-gray-800">選擇分析主題</span>
            <span className="ml-2 text-sm text-gray-400">可多選，最多 5 個</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {projects.map((p) => {
            const checked = draft.has(p.project_id)
            const disabled = !checked && draft.size >= 5
            return (
              <button
                key={p.project_id}
                onClick={() => !disabled && toggle(p)}
                disabled={disabled}
                className={`w-full flex items-center gap-3 px-5 py-4 text-left transition-colors border-b border-gray-50 last:border-0 ${
                  checked ? 'bg-[#1C3939]/5' : disabled ? 'opacity-40' : 'hover:bg-gray-50'
                }`}
              >
                <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                  checked ? 'border-[#1C3939] bg-[#1C3939]' : 'border-gray-300'
                }`}>
                  {checked && (
                    <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
                <BarChart2 className={`h-5 w-5 shrink-0 ${checked ? 'text-[#1C3939]' : 'text-gray-400'}`} />
                <div className="min-w-0">
                  <p className={`font-medium truncate ${checked ? 'text-[#1C3939]' : 'text-gray-700'}`}>{p.project_name}</p>
                  {p.project_desc && (
                    <p className="text-sm text-gray-400 truncate mt-0.5">{p.project_desc}</p>
                  )}
                </div>
              </button>
            )
          })}
        </div>
        {/* 確認按鈕 */}
        <div className="border-t border-gray-100 px-5 py-4">
          <button
            onClick={handleConfirm}
            disabled={draft.size === 0}
            className="w-full rounded-xl bg-[#1C3939] py-3 text-sm font-medium text-white disabled:opacity-40 active:scale-[0.98] transition-all"
          >
            {draft.size === 0 ? '請選擇主題'
              : draft.size === 1 ? '確認選擇'
              : `確認（${draft.size} 個主題跨主題分析）`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Example Questions bottom sheet ────────────────────────────────────────────

type ExampleGroup = { project: string; questions: string[] }

function ExampleSheet({
  open, groups, onSelect, onClose,
}: {
  open: boolean
  groups: ExampleGroup[]
  onSelect: (q: string) => void
  onClose: () => void
}) {
  if (!open) return null
  const total = groups.reduce((n, g) => n + g.questions.length, 0)
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative rounded-t-2xl bg-white shadow-xl max-h-[60vh] flex flex-col">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <span className="text-base font-semibold text-gray-800">範例問題</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {total === 0 ? (
            <p className="px-5 py-6 text-sm text-gray-400 text-center">此主題尚無範例問題</p>
          ) : (
            groups.map((g) => (
              <div key={g.project}>
                {groups.length > 1 && (
                  <div className="px-5 py-2 bg-gray-50 border-b border-gray-100">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{g.project}</span>
                  </div>
                )}
                {g.questions.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => { onSelect(q); onClose() }}
                    className="w-full flex items-start gap-3 px-5 py-4 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                  >
                    <Lightbulb className="h-4 w-4 mt-0.5 shrink-0 text-amber-400" />
                    <span className="text-sm text-gray-700 leading-relaxed">{q}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ── Message bubble ────────────────────────────────────────────────────────────

const MD_COMPONENTS = {
  table: TableWithActions,
  th: ({ children, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
    <th className="border border-gray-200 bg-gray-50 px-2 py-1 text-left text-xs font-semibold" {...props}>{children}</th>
  ),
  td: ({ children, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
    <td className="border border-gray-200 px-2 py-1 text-xs" {...props}>{children}</td>
  ),
}

function MessageBubble({ msg }: { msg: Message }) {
  const [chartTarget, setChartTarget] = useState<number | null>(null)  // index into msg.charts

  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[#1C3939] px-4 py-3 text-white text-sm leading-relaxed">
          {msg.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className={`rounded-2xl rounded-bl-sm px-4 py-3 text-sm leading-relaxed ${
        msg.error ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-white border border-gray-200 text-gray-800'
      }`}>
        {msg.error ? (
          <p>{msg.content}</p>
        ) : (
          <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 overflow-x-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
              {msg.content}
            </ReactMarkdown>
          </div>
        )}
      </div>

      {/* 訊息層動作列：多步驟圖表按鈕 */}
      {msg.charts && msg.charts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {msg.charts.map((c, ci) => (
            <button
              key={ci}
              onClick={() => setChartTarget(ci)}
              className="flex items-center gap-1.5 rounded-lg bg-blue-50 border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
            >
              <BarChart3 className="h-3.5 w-3.5" />
              圖表 {c.step}
            </button>
          ))}
        </div>
      )}

      {/* Chart Modal */}
      {chartTarget !== null && msg.charts?.[chartTarget] && (
        <ChartModal
          open
          data={{ ...msg.charts[chartTarget].chartData, title: msg.charts[chartTarget].query }}
          onClose={() => setChartTarget(null)}
        />
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function MobileBIPage() {
  // Projects
  const [projects, setProjects] = useState<BiProjectItem[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [selectedProjects, setSelectedProjects] = useState<BiProjectItem[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)

  // Chat
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [agentSteps, setAgentSteps] = useState<StepEvent[]>([])
  const [agentFinalizing, setAgentFinalizing] = useState(false)

  // Example questions：所有選中主題的範例問題，分組顯示
  const exampleGroups: ExampleGroup[] = selectedProjects
    .map((p) => ({ project: p.project_name, questions: p.project_config?.sampleQuestions ?? [] }))
    .filter((g) => g.questions.length > 0)
  const [exampleOpen, setExampleOpen] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, agentSteps, agentFinalizing])

  // Load projects
  useEffect(() => {
    setProjectsLoading(true)
    listBiProjects(BI_AGENT_ID)
      .then((list) => {
        setProjects(list)
        // 從 localStorage 還原上次選擇，驗證 project_id 還存在
        try {
          const saved = JSON.parse(localStorage.getItem(BI_SELECTED_KEY) ?? '[]') as string[]
          const restored = list.filter((p) => saved.includes(p.project_id))
          if (restored.length > 0) setSelectedProjects(restored)
          // 若 localStorage 無記錄，預設不選任何主題
        } catch { /* 解析失敗就不預設 */ }
      })
      .catch(() => {})
      .finally(() => setProjectsLoading(false))
  }, [])


  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
  }

  const canSend = !isLoading && selectedProjects.length > 0 && input.trim().length > 0

  const handleSend = useCallback(async (overrideText?: string) => {
    const content = (overrideText ?? input).trim()
    if (!content || selectedProjects.length === 0 || isLoading) return

    setInput('')
    if (inputRef.current) inputRef.current.style.height = 'auto'

    const userMsg: Message = { role: 'user', content }
    setMessages((prev) => [...prev, userMsg])
    setIsLoading(true)
    setAgentSteps([])
    setAgentFinalizing(false)

    try {
      if (selectedProjects.length >= 2) {
        // ── 多主題模式 ──────────────────────────────────────────────────────
        const resultContent = await agentBiMultiStream(
          {
            project_ids: selectedProjects.map((p) => p.project_id),
            model: '',
            question: content,
            agent_id: BI_AGENT_ID,
          },
          (event) => {
            if (event.type === 'agent_step') {
              const step: StepEvent = {
                step: event.step ?? 0,
                query: event.query ?? '',
                phase: event.phase ?? 'running',
                success: event.success,
                topic_name: event.topic_name,
              }
              setAgentSteps((prev) => [...prev, step])
              if (event.phase === 'done') setAgentFinalizing(true)
            }
          },
        )
        setTimeout(() => { setAgentSteps([]); setAgentFinalizing(false) }, 600)
        setMessages((prev) => [...prev, { role: 'assistant', content: resultContent }])

      } else {
        // ── 單主題模式（原有邏輯）───────────────────────────────────────────
        const proj = selectedProjects[0]
        const result = await chatAgentBiStream(
          {
            content,
            project_id: proj.project_id,
            schema_id: proj.schema_id ?? undefined,
            agent_id: BI_AGENT_ID,
            system_prompt: '',
            user_prompt: '',
            data: '',
            model: '',
            messages: [],
          },
          (step: AgentStepEvent) => {
            setAgentSteps((prev) => [...prev, {
              step: step.step,
              query: step.query,
              phase: step.phase,
              success: step.success,
            }])
            if (step.phase === 'done') setAgentFinalizing(true)
          },
        )
        setTimeout(() => { setAgentSteps([]); setAgentFinalizing(false) }, 600)
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: result.content,
          charts: result.charts as AgentChartEntry[] | undefined,
        }])
      }
    } catch (err) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: err instanceof Error ? err.message : '分析失敗，請稍後再試',
        error: true,
      }])
      setAgentSteps([])
      setAgentFinalizing(false)
    } finally {
      setIsLoading(false)
    }
  }, [input, selectedProjects, isLoading])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void handleSend()
    }
  }

  const noData = selectedProjects.length > 0 && !projectsLoading

  // 頂部顯示文字
  const topBarLabel = projectsLoading ? '載入中…'
    : selectedProjects.length === 0 ? '選擇主題'
    : selectedProjects.length === 1 ? selectedProjects[0].project_name
    : `多主題 (${selectedProjects.length})`

  return (
    <div className="fixed inset-0 flex flex-col bg-gray-50" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* ── Top Bar ── */}
      <div className="flex items-center gap-2 bg-[#1C3939] px-4 py-3 shadow-sm shrink-0">
        <BarChart2 className="h-5 w-5 text-white/80 shrink-0" />
        <span className="text-white font-semibold text-base flex-1 truncate">BI 分析</span>
        <button
          onClick={() => setPickerOpen(true)}
          disabled={projectsLoading || projects.length === 0}
          className="flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-white text-sm transition-colors disabled:opacity-40 max-w-[60%]"
        >
          {selectedProjects.length >= 2 && (
            <span className="rounded-full bg-indigo-400/50 px-1.5 py-0.5 text-xs font-medium text-white mr-0.5">
              多主題
            </span>
          )}
          <span className="truncate">{topBarLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        </button>
      </div>

      {/* ── Messages Area ── */}
      <div className="flex-1 overflow-y-auto relative">
        <div className="px-4 py-4 space-y-3 min-h-full flex flex-col">

          {/* Welcome / empty state */}
          {messages.length === 0 && !isLoading && (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
              <div className="w-16 h-16 rounded-2xl bg-[#1C3939]/10 flex items-center justify-center mb-4">
                <BarChart2 className="h-8 w-8 text-[#1C3939]" />
              </div>
              {selectedProjects.length === 0 ? (
                <>
                  <p className="text-gray-700 font-medium mb-1">請先選擇分析主題</p>
                  <p className="text-gray-400 text-sm">點擊右上角選擇要查詢的主題</p>
                </>
              ) : selectedProjects.length >= 2 ? (
                <>
                  <p className="text-gray-700 font-medium mb-1">跨主題分析模式</p>
                  <div className="flex flex-wrap justify-center gap-1.5 mt-2 mb-3">
                    {selectedProjects.map((p) => (
                      <span key={p.project_id} className="rounded-full bg-[#1C3939]/10 px-2.5 py-1 text-xs font-medium text-[#1C3939]">
                        {p.project_name}
                      </span>
                    ))}
                  </div>
                  <p className="text-gray-400 text-sm">輸入跨主題問題，AI 自動分解查詢</p>
                </>
              ) : (
                <>
                  <p className="text-gray-700 font-medium mb-1">{selectedProjects[0].project_name}</p>
                  <p className="text-gray-400 text-sm mb-4">輸入問題開始分析，或點擊下方燈泡查看範例</p>
                  {exampleGroups[0]?.questions.slice(0, 3).map((q, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(q)}
                      className="mt-2 w-full max-w-xs rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-left text-sm text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Messages */}
          {messages.length > 0 && (
            <div className="space-y-3">
              {messages.map((msg, i) => (
                <MessageBubble key={i} msg={msg} />
              ))}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Progress overlay */}
        <ProgressOverlay
          steps={agentSteps}
          visible={isLoading && (agentSteps.length > 0 || agentFinalizing)}
          finalizing={agentFinalizing}
        />
      </div>

      {/* ── Input Bar ── */}
      <div className="shrink-0 border-t border-gray-200 bg-white px-3 py-2">
        {!noData ? null : (
          <div className="flex items-end gap-2">
            {/* Example questions button */}
            <button
              onClick={() => setExampleOpen(true)}
              disabled={isLoading}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-amber-500 disabled:opacity-40 transition-colors"
              title="範例問題"
            >
              <Lightbulb className="h-5 w-5" />
            </button>

            {/* Text input */}
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={
                selectedProjects.length === 0 ? '請先選擇分析主題'
                : selectedProjects.length >= 2 ? `詢問跨主題問題…`
                : `詢問「${selectedProjects[0].project_name}」的問題…`
              }
              disabled={isLoading || selectedProjects.length === 0}
              rows={1}
              className="flex-1 resize-none rounded-xl border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm leading-relaxed focus:border-[#1C3939] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#1C3939]/30 disabled:opacity-50 transition-colors overflow-hidden"
              style={{ minHeight: '40px', maxHeight: '120px' }}
            />

            {/* Voice input */}
            <VoiceInput
              transcribe={(blob, filename, lang) =>
                transcribeAudio(blob, filename, lang).then((r) => r.text)
              }
              checkStatus={getSpeechStatus}
              onTranscript={(text, autoSend) => {
                if (autoSend && selectedProject && !isLoading) {
                  void handleSend(text)
                } else {
                  setInput(text)
                  if (inputRef.current) {
                    inputRef.current.style.height = 'auto'
                    inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`
                    inputRef.current.focus()
                  }
                }
              }}
              onError={() => {/* VoiceInput 內部已顯示錯誤 */}}
              disabled={isLoading}
              hideLangSelector
              buttonClassName="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200 disabled:opacity-40 transition-colors"
            />

            {/* Send button */}
            <button
              onClick={() => void handleSend()}
              disabled={!canSend}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1C3939] text-white disabled:opacity-40 hover:bg-[#163130] active:scale-95 transition-all"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
        )}
        <div className="h-safe-area-bottom" />
      </div>

      {/* ── Sheets ── */}
      <ProjectPicker
        open={pickerOpen}
        projects={projects}
        selected={selectedProjects}
        onConfirm={(ps) => {
          setSelectedProjects(ps)
          setMessages([])
          try {
            localStorage.setItem(BI_SELECTED_KEY, JSON.stringify(ps.map((p) => p.project_id)))
          } catch { /* ignore */ }
        }}
        onClose={() => setPickerOpen(false)}
      />
      <ExampleSheet
        open={exampleOpen}
        groups={exampleGroups}
        onSelect={(q) => setInput(q)}
        onClose={() => setExampleOpen(false)}
      />
    </div>
  )
}
