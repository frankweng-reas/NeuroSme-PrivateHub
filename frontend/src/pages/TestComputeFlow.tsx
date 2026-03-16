/** 測試頁：Compute Flow（LLM 生成 SQL → DuckDB 執行 → 文字生成）。路徑 /dev-test-compute-flow */

/** 暫時關閉：分析結果、圖表、Debug（改為 true 可恢復顯示） */
const SHOW_ANALYSIS = true
const SHOW_CHART = true
const SHOW_DEBUG = false

/** 將 SQL 格式化為易讀結構 */
function formatSql(sql: string): string {
  if (!sql || typeof sql !== 'string') return ''
  return sql
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b(SELECT|FROM|WHERE|GROUP BY|ORDER BY|LIMIT|HAVING)\b/gi, '\n$1 ')
    .replace(/\b(AND|OR)\b/gi, '\n  $1 ')
    .replace(/^\n/, '')
    .trim()
}
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { chatCompletionsCompute } from '@/api/chat'
import { ApiError } from '@/api/client'
import { listBiProjects } from '@/api/biProjects'
import type { Agent } from '@/types'
import type { BiProjectItem } from '@/api/biProjects'

const STORAGE_KEY_PROJECT = 'bi_compute_project_id'

/** 固定使用 Business insight agent（不讀 DB）。id 須與 agent_catalog.id 一致 */
const BUSINESS_INSIGHT_AGENT: Agent = {
  id: '22',
  agent_id: '22',
  agent_name: 'Business Insight Agent',
  group_id: '',
  group_name: '',
}

import ModelSelect from '@/components/ModelSelect'
import ChartModal from '@/components/ChartModal'
import type { ChartData } from '@/components/ChartModal'

interface ComputeResult {
  content: string
  chartData?: ChartData | null
  debug?: Record<string, unknown>
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

export default function TestComputeFlow() {
  const [projects, setProjects] = useState<BiProjectItem[]>([])
  const [selectedProject, setSelectedProject] = useState<BiProjectItem | null>(null)
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [model, setModel] = useState('gpt-4o-mini')
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<ComputeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chartModalOpen, setChartModalOpen] = useState(false)

  useEffect(() => {
    setProjectsLoading(true)
    setProjectsError(null)
    setProjects([])
    listBiProjects(BUSINESS_INSIGHT_AGENT.id)
      .then((list) => {
        setProjects(list)
        setProjectsError(null)
        const savedId = localStorage.getItem(STORAGE_KEY_PROJECT)
        if (savedId && list.some((p) => p.project_id === savedId)) {
          setSelectedProject(list.find((p) => p.project_id === savedId) ?? null)
        } else {
          setSelectedProject(null)
        }
      })
      .catch((err) => {
        const msg =
          err instanceof ApiError ? err.detail ?? err.message : err instanceof Error ? err.message : '載入失敗'
        setProjectsError(msg)
        setProjects([])
      })
      .finally(() => setProjectsLoading(false))
  }, [])

  function toChartData(cd: NonNullable<ComputeResult['chartData']>): ChartData {
    if (!cd || typeof cd !== 'object' || !('labels' in cd)) return cd as ChartData
    const c = cd as Record<string, unknown>
    const meta = {
      valueSuffix: c.valueSuffix as string | undefined,
      title: c.title as string | undefined,
      yAxisLabel: (c.yAxisLabel ?? c.y_axis_label) as string | undefined,
    }
    if (Array.isArray(c.datasets) && c.datasets.length > 0) {
      return {
        chartType: (c.chartType as 'pie' | 'bar' | 'line') ?? 'line',
        labels: c.labels as string[],
        datasets: c.datasets as { label: string; data: number[] }[],
        ...meta,
      }
    }
    if (Array.isArray(c.data)) {
      return {
        chartType: (c.chartType as 'pie' | 'bar' | 'line') ?? 'bar',
        labels: c.labels as string[],
        data: c.data as number[],
        ...meta,
      }
    }
    return cd as ChartData
  }

  async function handleSubmit() {
    if (!input.trim() || !selectedProject || isLoading) return

    setError(null)
    setResult(null)
    setIsLoading(true)

    try {
      const res = await chatCompletionsCompute({
        agent_id: BUSINESS_INSIGHT_AGENT.id,
        project_id: selectedProject.project_id,
        prompt_type: 'analysis',
        system_prompt: '',
        user_prompt: '',
        data: '',
        model,
        messages: [],
        content: input.trim(),
      })

      const chartData: ChartData | null =
        res.chart_data && res.chart_data.labels && (res.chart_data.data || res.chart_data.datasets)
          ? toChartData(res.chart_data as Parameters<typeof toChartData>[0])
          : null

      setResult({
        content: res.content,
        chartData,
        debug: res.debug,
        usage: res.usage,
      })
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.detail ?? err.message : err instanceof Error ? err.message : '未知錯誤'
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex h-screen flex-col bg-stone-100">
      <header className="flex shrink-0 items-center gap-4 border-b border-gray-300 bg-[#1C3939] px-6 py-4">
        <Link
          to="/"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-white/90 transition-colors hover:bg-white/10"
        >
          <ArrowLeft className="h-5 w-5" />
          返回
        </Link>
        <h1 className="text-xl font-semibold text-white">Compute Flow 測試</h1>
        <span className="text-sm text-white/70">LLM 生成 SQL → DuckDB 執行 → 文字生成</span>
        <div className="ml-auto flex gap-2">
          <Link
            to="/dev-test-compute-tool"
            className="rounded-lg border border-white/30 px-3 py-1.5 text-sm text-white/90 hover:bg-white/10"
          >
            Tool 路徑
          </Link>
          <Link
            to="/dev-test-chat"
            className="rounded-lg border border-white/30 px-3 py-1.5 text-sm text-white/90 hover:bg-white/10"
          >
            LLM Chat 測試
          </Link>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-6 overflow-hidden p-6">
        {/* 左側：設定 */}
        <div className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto rounded-xl border border-gray-300 bg-white p-4 shadow">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Agent</label>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-base text-gray-700">
              {BUSINESS_INSIGHT_AGENT.agent_name}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">專案</label>
            <select
              value={selectedProject?.project_id ?? ''}
              onChange={(e) => {
                const val = e.target.value
                const p = val ? projects.find((x) => x.project_id === val) : null
                setSelectedProject(p ?? null)
                if (val) {
                  localStorage.setItem(STORAGE_KEY_PROJECT, val)
                } else {
                  localStorage.removeItem(STORAGE_KEY_PROJECT)
                }
              }}
              disabled={false}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base disabled:bg-gray-100 disabled:opacity-70"
              aria-label="選擇專案"
            >
              <option value="">請選擇</option>
              {projects.map((p) => (
                <option key={p.project_id} value={p.project_id}>
                  {p.project_name}
                </option>
              ))}
            </select>
            {projectsLoading && <p className="mt-1 text-xs text-gray-500">載入中…</p>}
            {projectsError && (
              <p className="mt-1 text-xs text-red-600">
                {projectsError}
                {projectsError.includes('404') || projectsError.includes('Agent') ? (
                  <span className="block mt-1">請確認 agent_catalog 有對應 id 且 tenant/user 已授權。</span>
                ) : null}
              </p>
            )}
            {!projectsLoading && !projectsError && projects.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">
                此 Agent 尚無專案。
                <Link to={`/agent/${encodeURIComponent(BUSINESS_INSIGHT_AGENT.id)}`} className="ml-1 underline">
                  前往建立
                </Link>
              </p>
            )}
          </div>

          <ModelSelect value={model} onChange={setModel} />

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">問題</label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="例如：各平台銷售額佔比"
              rows={3}
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            />
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selectedProject || !input.trim() || isLoading}
            className="flex items-center justify-center gap-2 rounded-lg bg-[#1C3939] px-4 py-3 font-medium text-white transition-opacity hover:bg-[#2a4d4d] disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                計算中…
              </>
            ) : (
              '送出'
            )}
          </button>
        </div>

        {/* 右側：結果 */}
        <div className="min-w-0 flex-1 overflow-y-auto rounded-xl border border-gray-300 bg-white p-6 shadow">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</div>
          )}

          {result && (
            <div className="space-y-6">
              <section>
                <h2 className="mb-2 text-lg font-semibold text-gray-800">生成的 SQL</h2>
                <pre className="overflow-x-auto rounded-lg border border-gray-200 bg-slate-50 p-4 text-sm text-slate-800 font-mono whitespace-pre-wrap">
                  {(() => {
                    let sql = (result.debug?.sql_intent as { sql?: string } | undefined)?.sql
                    if (!sql && typeof result.debug?.sql_raw === 'string') {
                      try {
                        const start = result.debug.sql_raw.indexOf('{')
                        if (start >= 0) {
                          let depth = 0
                          for (let i = start; i < result.debug.sql_raw.length; i++) {
                            if (result.debug.sql_raw[i] === '{') depth++
                            else if (result.debug.sql_raw[i] === '}') {
                              depth--
                              if (depth === 0) {
                                const obj = JSON.parse(result.debug.sql_raw.slice(start, i + 1))
                                sql = obj?.sql ?? null
                                break
                              }
                            }
                          }
                        }
                      } catch {
                        /* ignore */
                      }
                    }
                    return sql ? formatSql(sql) : '（無法解析 SQL）'
                  })()}
                </pre>
              </section>
              {Array.isArray(result.debug?.sql_result) && result.debug.sql_result.length > 0 && (
                <section>
                  <h2 className="mb-2 text-lg font-semibold text-gray-800">DuckDB 執行結果</h2>
                  <pre className="overflow-x-auto rounded-lg border border-gray-200 bg-slate-50 p-4 text-sm text-slate-800 font-mono whitespace-pre-wrap">
                    {JSON.stringify(result.debug.sql_result, null, 2)}
                  </pre>
                </section>
              )}
              {SHOW_ANALYSIS && (
                <section>
                  <h2 className="mb-2 text-lg font-semibold text-gray-800">分析結果</h2>
                  <div className="prose max-w-none rounded-lg border border-gray-200 bg-gray-50/50 p-4">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.content}</ReactMarkdown>
                  </div>
                </section>
              )}

              {SHOW_CHART && result.chartData && (
                <section>
                  <h2 className="mb-2 text-lg font-semibold text-gray-800">圖表</h2>
                  <button
                    type="button"
                    onClick={() => setChartModalOpen(true)}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-base text-gray-700 hover:bg-gray-50"
                  >
                    開啟圖表
                  </button>
                  <ChartModal
                    open={chartModalOpen}
                    data={result.chartData}
                    onClose={() => setChartModalOpen(false)}
                  />
                </section>
              )}

              {SHOW_DEBUG && result.debug && (
                <section>
                  <h2 className="mb-2 text-lg font-semibold text-gray-800">Debug 資訊</h2>
                  <pre className="max-h-96 overflow-auto rounded-lg border border-gray-200 bg-gray-900 p-4 text-sm text-gray-100">
                    {JSON.stringify(result.debug, null, 2)}
                  </pre>
                </section>
              )}

              {result.usage && (
                <section>
                  <h2 className="mb-2 text-lg font-semibold text-gray-800">Token 用量</h2>
                  <p className="text-sm text-gray-600">
                    prompt: {result.usage.prompt_tokens} / completion: {result.usage.completion_tokens} / total:{' '}
                    {result.usage.total_tokens}
                  </p>
                </section>
              )}
            </div>
          )}

          {!result && !error && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
              <p className="mb-2">選擇 Agent、專案並輸入問題後送出</p>
              <p className="text-sm">此流程會：1) LLM 生成 SQL 2) DuckDB 執行 3) 生成分析文字</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
