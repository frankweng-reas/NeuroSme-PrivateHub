/** agent_id 含 quotation 時使用：報價型 agent 專用 UI（流程型態，多步驟） */
import { useEffect, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import AgentHeader from '@/components/AgentHeader'
import InputModal from '@/components/InputModal'
import QtnOfferingList from '@/components/QtnOfferingList'
import QtnRequirementList from '@/components/QtnRequirementList'
import QuotationStepper from '@/components/QuotationStepper'
import { chatCompletions } from '@/api/chat'
import { createQtnProject, listQtnProjects, type QtnProjectItem } from '@/api/qtnProjects'
import { listQtnSources } from '@/api/qtnSources'
import { ApiError } from '@/api/client'
import type { Agent } from '@/types'

interface AgentQuotationUIProps {
  agent: Agent
}

/** Step 1 解析結果的單一項目（動態結構，依 LLM 輸出而定） */
type ParsedItem = Record<string, unknown>

const ARRAY_KEYS = ['items', 'data', 'result', 'requirements', 'list']

const STORAGE_KEY_PREFIX = 'quotation_parse_'
const STEP_STORAGE_KEY_PREFIX = 'quotation_step_'

function getStorageKey(agentId: string, projectId?: string) {
  return projectId ? `${STORAGE_KEY_PREFIX}${agentId}:${projectId}` : `${STORAGE_KEY_PREFIX}${agentId}`
}

function getStepStorageKey(agentId: string) {
  return `${STEP_STORAGE_KEY_PREFIX}${agentId}`
}

interface ParseResult {
  schema: Record<string, string> | null
  data: ParsedItem[]
}

interface StoredResult {
  parseResult: ParsedItem[] | null
  schema: Record<string, string> | null
  rawContent: string
}

function tryParseJson(content: string): ParseResult | null {
  if (!content?.trim()) return null
  let raw = content.trim()
  const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) raw = codeBlock[1].trim()
  const jsonMatch = raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
  if (!jsonMatch) return null
  raw = jsonMatch[0]
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if (
        'schema' in parsed &&
        'data' in parsed &&
        typeof parsed.schema === 'object' &&
        Array.isArray(parsed.data)
      ) {
        return {
          schema: parsed.schema as Record<string, string>,
          data: parsed.data as ParsedItem[],
        }
      }
      for (const key of ARRAY_KEYS) {
        const arr = parsed[key]
        if (Array.isArray(arr)) return { schema: null, data: arr as ParsedItem[] }
      }
    }
    if (Array.isArray(parsed)) return { schema: null, data: parsed as ParsedItem[] }
    return null
  } catch {
    return null
  }
}

/** 從所有列合併出欄位（以第一列順序為主，其餘列多出的 key 補在後面） */
function getAllKeys(rows: ParsedItem[]): string[] {
  if (rows.length === 0) return []
  const firstKeys = Object.keys(rows[0])
  const otherKeys = new Set<string>()
  for (let i = 1; i < rows.length; i++) {
    Object.keys(rows[i]).forEach((k) => otherKeys.add(k))
  }
  const result = [...firstKeys]
  otherKeys.forEach((k) => {
    if (!result.includes(k)) result.push(k)
  })
  return result
}

/** 解析失敗時：strip markdown code block，若為 JSON 則 pretty-print */
function formatRawContentForDisplay(content: string): string {
  if (!content?.trim()) return content
  let raw = content.trim()
  const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) raw = codeBlock[1].trim()
  const jsonMatch = raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0])
      return JSON.stringify(parsed, null, 2)
    } catch {
      return raw
    }
  }
  return raw
}

/** 將 cell 值轉為顯示字串 */
function formatCellValue(val: unknown): string {
  if (val === undefined || val === null) return '-'
  if (typeof val === 'number') return String(val)
  if (typeof val === 'boolean') return val ? '是' : '否'
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

type StepNum = 1 | 2 | 3 | 4

export default function AgentQuotationUI({ agent }: AgentQuotationUIProps) {
  const [currentStep, setCurrentStep] = useState<StepNum>(1)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analyzeProgress, setAnalyzeProgress] = useState(0)
  const [parseResult, setParseResult] = useState<ParsedItem[] | null>(null)
  const [schema, setSchema] = useState<Record<string, string> | null>(null)
  const [rawContent, setRawContent] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [editingCell, setEditingCell] = useState<{ row: number; field: string } | null>(null)

  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDesc, setNewProjectDesc] = useState('')
  const [newProjectSubmitting, setNewProjectSubmitting] = useState(false)
  const [newProjectError, setNewProjectError] = useState<string | null>(null)

  const [projects, setProjects] = useState<QtnProjectItem[]>([])
  const [selectedProject, setSelectedProject] = useState<QtnProjectItem | null>(null)

  useEffect(() => {
    const pid = selectedProject?.project_id
    if (!pid) {
      setParseResult(null)
      setSchema(null)
      setRawContent(null)
      return
    }
    try {
      const key = getStorageKey(agent.id, pid)
      const raw = localStorage.getItem(key)
      if (raw) {
        const stored: StoredResult = JSON.parse(raw)
        setParseResult(stored.parseResult)
        setSchema(stored.schema ?? null)
        setRawContent(stored.rawContent ?? '')
      } else {
        setParseResult(null)
        setSchema(null)
        setRawContent(null)
      }
    } catch {
      setParseResult(null)
      setSchema(null)
      setRawContent(null)
    }
  }, [agent.id, selectedProject?.project_id])

  useEffect(() => {
    try {
      const key = getStepStorageKey(agent.id)
      const saved = localStorage.getItem(key)
      if (saved) {
        const n = parseInt(saved, 10)
        if (n >= 1 && n <= 4) setCurrentStep(n as StepNum)
      }
    } catch {
      // 忽略
    }
  }, [agent.id])

  /** 假進度：解析中時 0→90%，前面慢、後面漸快，約 20 秒到 90% */
  useEffect(() => {
    if (!isAnalyzing) return
    setAnalyzeProgress(0)
    const start = Date.now()
    const interval = setInterval(() => {
      const elapsed = Date.now() - start
      const t = Math.min(1, elapsed / 20000)
      setAnalyzeProgress(90 * t ** 1.8)
    }, 200)
    return () => clearInterval(interval)
  }, [isAnalyzing])

  useEffect(() => {
    listQtnProjects(agent.id)
      .then((list) => {
        setProjects(list)
        setSelectedProject((prev) => {
          if (list.length === 0) return null
          if (prev && list.some((p) => p.project_id === prev.project_id)) return prev
          return list[0]
        })
      })
      .catch(() => {})
  }, [agent.id])

  const persistStep = (step: StepNum) => {
    try {
      localStorage.setItem(getStepStorageKey(agent.id), String(step))
    } catch {
      // 忽略
    }
  }

  const completedSteps: number[] = []
  if (parseResult !== null) completedSteps.push(1)
  if (parseResult !== null && parseResult.length > 0) completedSteps.push(2)

  const saveToStorage = (
    result: ParsedItem[] | null,
    content: string,
    schemaVal?: Record<string, string> | null
  ) => {
    const pid = selectedProject?.project_id
    if (!pid) return
    try {
      localStorage.setItem(
        getStorageKey(agent.id, pid),
        JSON.stringify({
          parseResult: result,
          schema: schemaVal ?? schema,
          rawContent: content,
        } satisfies StoredResult)
      )
    } catch {
      // 忽略 localStorage 寫入錯誤
    }
  }

  const updateField = (rowIndex: number, field: string, value: string | number) => {
    if (!parseResult) return
    const currentVal = parseResult[rowIndex]?.[field]
    const isNumeric = typeof currentVal === 'number'
    const parsed = isNumeric ? (typeof value === 'number' ? value : Number(value) || 0) : value
    const next = parseResult.map((row, i) =>
      i === rowIndex ? { ...row, [field]: parsed } : row
    )
    setParseResult(next)
    saveToStorage(next, rawContent ?? '')
    setEditingCell(null)
  }

  const handleAddRow = () => {
    const newItem: ParsedItem = {}
    const next = parseResult ? [...parseResult, newItem] : [newItem]
    setParseResult(next)
    saveToStorage(next, rawContent ?? '')
    setEditingCell(null)
  }

  const handleDeleteRow = (rowIndex: number) => {
    if (!parseResult) return
    const next = parseResult.filter((_, i) => i !== rowIndex)
    setParseResult(next)
    saveToStorage(next, rawContent ?? '')
    setEditingCell(null)
  }

  const handleStartAnalysis = async () => {
    if (!selectedProject) {
      setErrorMsg('請先選擇專案')
      return
    }
    setErrorMsg(null)
    const [offering, requirement] = await Promise.all([
      listQtnSources(selectedProject.project_id, 'OFFERING'),
      listQtnSources(selectedProject.project_id, 'REQUIREMENT'),
    ])
    if (offering.length === 0 || requirement.length === 0) {
      setErrorMsg('必須有產品/服務清單與需求描述才能開始解析')
      return
    }
    setIsAnalyzing(true)
    setParseResult(null)
    setSchema(null)
    setRawContent(null)
    try {
      const res = await chatCompletions({
        agent_id: agent.id,
        project_id: selectedProject.project_id,
        prompt_type: 'quotation_parse',
        system_prompt: '',
        user_prompt: '',
        data: '',
        model: 'gpt-4o-mini',
        messages: [],
        content: '請解析以上參考資料，輸出為 JSON 陣列。',
      })
      const parsed = tryParseJson(res.content)
      const content = res.content ?? ''
      if (parsed) {
        setParseResult(parsed.data)
        setSchema(parsed.schema)
        setRawContent(content)
        saveToStorage(parsed.data, content, parsed.schema)
      } else {
        setParseResult(null)
        setSchema(null)
        setRawContent(content)
        if (content) saveToStorage(null, content, null)
      }
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.detail ?? err.message : err instanceof Error ? err.message : '解析失敗，請稍後再試'
      setErrorMsg(msg)
    } finally {
      setAnalyzeProgress(100)
      await new Promise((r) => setTimeout(r, 300))
      setIsAnalyzing(false)
      setAnalyzeProgress(0)
    }
  }

  const handleReParse = () => {
    if (window.confirm('重新解析將覆蓋現有需求清單，確定嗎？')) {
      handleStartAnalysis()
    }
  }

  const handleStepClick = (step: number) => {
    if (step >= 1 && step <= 4 && completedSteps.includes(step)) {
      setCurrentStep(step as StepNum)
      persistStep(step as StepNum)
    }
  }

  const handlePrev = () => {
    if (currentStep > 1) {
      const next = (currentStep - 1) as StepNum
      setCurrentStep(next)
      persistStep(next)
    }
  }

  const handleNext = () => {
    if (currentStep < 4) {
      const next = (currentStep + 1) as StepNum
      setCurrentStep(next)
      persistStep(next)
    }
  }

  const canProceedStep1 = parseResult !== null
  const canProceedStep2 = parseResult !== null && parseResult.length > 0

  const handleOpenNewProject = () => {
    setNewProjectName('')
    setNewProjectDesc('')
    setNewProjectError(null)
    setNewProjectOpen(true)
  }

  const handleCloseNewProject = () => {
    setNewProjectOpen(false)
    setNewProjectError(null)
  }

  const handleSubmitNewProject = async () => {
    const name = newProjectName.trim()
    if (!name) {
      setNewProjectError('請輸入專案名稱')
      return
    }
    setNewProjectSubmitting(true)
    setNewProjectError(null)
    try {
      const created = await createQtnProject({
        agent_id: agent.id,
        project_name: name,
        project_desc: newProjectDesc.trim() || null,
      })
      setProjects((prev) => [created, ...prev])
      setSelectedProject(created)
      handleCloseNewProject()
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.detail ?? err.message : err instanceof Error ? err.message : '建立失敗，請稍後再試'
      setNewProjectError(msg)
    } finally {
      setNewProjectSubmitting(false)
    }
  }

  return (
    <div className="flex h-full flex-col p-4">
      {/* 解析中 overlay */}
      {isAnalyzing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center animate-analyzing-overlay"
          role="dialog"
          aria-modal="true"
          aria-live="polite"
          aria-label="解析中"
        >
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative z-10 flex flex-col items-center gap-4 rounded-2xl border border-gray-200 bg-white px-8 py-6 shadow-xl animate-analyzing-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <Loader2 className="h-10 w-10 animate-spin text-gray-600" aria-hidden />
            <p className="text-lg font-medium text-gray-800">
              解析中
              <span className="animate-thinking-dots inline-flex">
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>
              <span className="ml-1 text-gray-600">({Math.round(analyzeProgress)}%)</span>
            </p>
            <div className="h-2 w-48 overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-gray-600 transition-[width] duration-300 ease-out"
                style={{ width: `${analyzeProgress}%` }}
              />
            </div>
          </div>
        </div>
      )}

      <AgentHeader agent={agent} showManagerTools />

      <div className="mt-4 flex min-h-0 flex-1 gap-4 overflow-hidden">
        {/* 左側：報價專案資訊容器 */}
        <div className="flex w-64 shrink-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
            <h3 className="text-base font-medium text-gray-700">報價專案</h3>
            <button
              type="button"
              onClick={handleOpenNewProject}
              className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-base font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              <Plus className="h-3.5 w-3.5" />
              New
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {projects.length === 0 ? (
              <p className="text-base text-gray-500">尚無專案，點擊 +New 建立</p>
            ) : (
              <ul className="space-y-2">
                {projects.map((p) => (
                  <li
                    key={p.project_id}
                    className={`cursor-pointer rounded-lg px-3 py-2 text-base transition-colors ${
                      selectedProject?.project_id === p.project_id
                        ? 'bg-gray-200 font-medium text-gray-800'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                    onClick={() => setSelectedProject(p)}
                  >
                    {p.project_name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* 新增專案 Modal */}
        <InputModal
          open={newProjectOpen}
          title="新增報價專案"
          submitLabel="建立"
          loading={newProjectSubmitting}
          onSubmit={handleSubmitNewProject}
          onClose={handleCloseNewProject}
        >
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-base font-medium text-gray-700">專案 ID</label>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-base text-gray-500">
                （建立後產生）
              </div>
            </div>
            <div>
              <label className="mb-1 block text-base font-medium text-gray-700">專案名稱</label>
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="請輸入專案名稱"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-base font-medium text-gray-700">描述</label>
              <textarea
                value={newProjectDesc}
                onChange={(e) => setNewProjectDesc(e.target.value)}
                placeholder="請輸入專案描述（選填）"
                rows={3}
                className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
              />
            </div>
            {newProjectError && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-base text-red-700">{newProjectError}</div>
            )}
          </div>
        </InputModal>

        {/* 右側：Stepper + 內容 */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          {/* Stepper */}
          <div className="shrink-0 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <QuotationStepper
              currentStep={currentStep}
              completedSteps={completedSteps}
              onStepClick={handleStepClick}
            />
          </div>

          {/* 內容區：依 currentStep 顯示 */}
          <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
            {currentStep === 1 && (
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden rounded-2xl border-2 border-gray-200 bg-white shadow-sm p-4">
                {/* 上排：產品清單 | 需求描述 左右並排，高度充滿 */}
                <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <QtnOfferingList
                      projectId={selectedProject?.project_id ?? null}
                      collapsible={true}
                    />
                  </div>
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <QtnRequirementList
                      projectId={selectedProject?.project_id ?? null}
                      collapsible={true}
                    />
                  </div>
                </div>

                {/* 下排：解析說明 */}
                <div className="flex min-h-[200px] max-h-[40vh] shrink-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-gray-50/80">
                  <div className="flex shrink-0 items-center justify-between rounded-t-xl border-b border-gray-200 bg-amber-100 px-4 py-2">
                    <h4 className="text-base font-medium text-gray-700">解析說明</h4>
                    <button
                      type="button"
                      onClick={handleStartAnalysis}
                      disabled={isAnalyzing || !selectedProject}
                      className="rounded-lg bg-gray-700 px-4 py-1.5 text-base font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
                    >
                      開始解析
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    {errorMsg ? (
                      <div className="rounded-lg bg-red-50 px-4 py-3 text-lg text-red-800">
                        {errorMsg}
                      </div>
                    ) : !parseResult && !rawContent ? (
                      <p className="text-lg text-gray-500">請先上傳產品/服務清單與需求描述，並點擊解析</p>
                    ) : parseResult !== null ? (
                      <p className="text-lg text-gray-700">
                        解析完成，共 {parseResult.length} 筆需求項目。請至 Step 2 檢視需求清單。
                      </p>
                    ) : rawContent ? (
                      <>
                        <p className="mb-3 text-lg font-medium text-amber-800">解析未成功，以下為 LLM 原始回傳：</p>
                        <pre className="whitespace-pre-wrap break-words rounded-lg bg-amber-50/80 p-3 text-lg text-gray-700 ring-1 ring-amber-200">
                          {formatRawContentForDisplay(rawContent)}
                        </pre>
                      </>
                    ) : (
                      <p className="text-lg text-gray-500">解析完成，請至 Step 2 檢視需求清單</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {currentStep === 2 && (
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden rounded-2xl border-2 border-gray-200 bg-white shadow-sm">
                {parseResult === null && rawContent === null && !isAnalyzing ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/50 p-8">
                    <p className="text-gray-600">請先完成 Step 1：上傳來源檔案並執行解析</p>
                    <button
                      type="button"
                      onClick={() => {
                        setCurrentStep(1)
                        persistStep(1)
                      }}
                      className="rounded-lg bg-gray-700 px-4 py-2 text-white hover:bg-gray-800"
                    >
                      回到 Step 1
                    </button>
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3">
                      <div>
                        <h3 className="font-medium text-gray-800">解析結果：需求清單</h3>
                        <p className="mt-0.5 text-base text-gray-500">請確認或編輯需求項目，至少需有一筆才能進入下一步</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleReParse}
                          disabled={isAnalyzing || !selectedProject}
                          className="flex items-center gap-1 rounded-lg border border-amber-600 bg-amber-50 px-3 py-1.5 text-base font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50"
                          title="重新執行 AI 解析，將覆蓋現有清單"
                        >
                          重新解析
                        </button>
                        <button
                          type="button"
                          onClick={handleAddRow}
                          className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-base text-gray-700 transition-colors hover:bg-gray-50"
                        >
                          <Plus className="h-4 w-4" />
                          新增
                        </button>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto p-4">
                      {parseResult !== null ? (
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-base">
                            <thead>
                              <tr className="border-b border-gray-200 text-left text-gray-600">
                                <th className="whitespace-nowrap px-2 py-1.5">#</th>
                                {getAllKeys(parseResult)
                                  .filter((f) => f !== 'id')
                                  .map((field) => (
                                    <th key={field} className="whitespace-nowrap px-2 py-1.5">
                                      {schema?.[field] ?? field}
                                    </th>
                                  ))}
                                <th className="w-10 px-2 py-1.5"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {parseResult.length === 0 ? (
                                <tr>
                                  <td
                                    colSpan={
                                      getAllKeys(parseResult).filter((f) => f !== 'id').length + 2
                                    }
                                    className="px-2 py-6 text-center text-gray-500"
                                  >
                                    尚無需求項目，請點擊「新增」或回到 Step 1 重新解析
                                  </td>
                                </tr>
                              ) : (
                                parseResult.map((row, i) => {
                                  const fields = getAllKeys(parseResult).filter((f) => f !== 'id')
                                  return (
                                    <tr key={i} className="border-b border-gray-100">
                                      <td className="whitespace-nowrap px-2 py-1.5 text-gray-600">
                                        {i + 1}
                                      </td>
                                      {fields.map((field) => {
                                        const isEditing =
                                          editingCell?.row === i && editingCell?.field === field
                                        const val = row[field]
                                        const display = formatCellValue(val)
                                        const isNum = typeof val === 'number'
                                        return (
                                          <td
                                            key={field}
                                            className="max-w-[200px] px-2 py-1.5"
                                          >
                                            {isEditing ? (
                                              <input
                                                type={isNum ? 'number' : 'text'}
                                                defaultValue={display === '-' ? '' : display}
                                                autoFocus
                                                className="min-w-[60px] max-w-full rounded border border-gray-300 px-1.5 py-0.5 text-base"
                                                onBlur={(e) => {
                                                  const v = e.target.value
                                                  updateField(i, field, isNum ? Number(v) : v)
                                                }}
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter') {
                                                    const v = e.currentTarget.value
                                                    updateField(i, field, isNum ? Number(v) : v)
                                                  }
                                                  if (e.key === 'Escape') setEditingCell(null)
                                                }}
                                              />
                                            ) : (
                                              <span
                                                role="button"
                                                tabIndex={0}
                                                className="block min-h-[1.5em] cursor-pointer truncate rounded px-0.5 hover:bg-gray-100"
                                                title={display}
                                                onClick={() => setEditingCell({ row: i, field })}
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault()
                                                    setEditingCell({ row: i, field })
                                                  }
                                                }}
                                              >
                                                {display}
                                              </span>
                                            )}
                                          </td>
                                        )
                                      })}
                                      <td className="w-10 px-2 py-1.5">
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteRow(i)}
                                          className="rounded p-1 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"
                                          aria-label="刪除此列"
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </button>
                                      </td>
                                    </tr>
                                  )
                                })
                              )}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <pre className="whitespace-pre-wrap break-words text-base text-gray-700">
                          {rawContent || 'LLM 回傳為空'}
                        </pre>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {currentStep === 3 && (
              <div className="flex flex-1 items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/50 p-8">
                <p className="text-gray-500">步驟 3：產生報價（尚未實作）</p>
              </div>
            )}

            {currentStep === 4 && (
              <div className="flex flex-1 items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/50 p-8">
                <p className="text-gray-500">步驟 4：檢視輸出（尚未實作）</p>
              </div>
            )}

            {/* 導航按鈕 */}
            <div className="flex shrink-0 justify-between border-t border-gray-200 bg-gray-50/80 px-4 py-3">
              <button
                type="button"
                onClick={handlePrev}
                disabled={currentStep <= 1}
                className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50 disabled:hover:bg-transparent"
              >
                上一步
              </button>
              {currentStep < 4 && (
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={
                    (currentStep === 1 && !canProceedStep1) || (currentStep === 2 && !canProceedStep2)
                  }
                  className="rounded-lg bg-gray-700 px-4 py-2 font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
                >
                  下一步
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
