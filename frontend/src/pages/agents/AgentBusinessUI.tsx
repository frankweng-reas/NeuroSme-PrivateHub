/**
 * agent_id 含 business 時使用：商務型 agent 專用 UI。
 * 資料匯入僅使用 biProjects.importCsvToDuckdb（bi_schemas → DuckDB），不使用 bi_sources API。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, ChevronsRight, Database, HelpCircle, Lightbulb, Loader2, MoreVertical, Plus, RefreshCw } from 'lucide-react'
import { Group, Panel, PanelImperativeHandle, Separator } from 'react-resizable-panels'
import { chatAgentBiStream, type AgentStepEvent } from '@/api/chat'
import AgentProgressOverlay from '@/components/AgentProgressOverlay'
import { ApiError } from '@/api/client'
import AISettingsPanelBasic from '@/components/AISettingsPanelBasic'
import AISettingsPanelAdvanced from '@/components/AISettingsPanelAdvanced'
import AgentChat, { type Message, type ResponseMeta } from '@/components/AgentChat'
import HelpModal from '@/components/HelpModal'
import AgentHeader from '@/components/AgentHeader'
import ConfirmModal from '@/components/ConfirmModal'
import InputModal from '@/components/InputModal'
import SchemaManagerOverlay from '@/components/SchemaManagerOverlayV2'
import ExamplePromptsModal from '@/components/ExamplePromptsModal'
import { createBiProject, clearDuckdbData, deleteBiProject, getDuckdbStatus, getAutoImport, getAutoImportBaseConfig, setAutoImport, toggleAutoImport, triggerAutoImport, importCsvToDuckdb, listBiProjects, updateBiProject, type AutoImportConfig, type BiProjectItem, type MessageStored, type ProjectConfig } from '@/api/biProjects'
import { getMe } from '@/api/users'
import { getBiSchema, listBiSchemas, type BiSchemaItem } from '@/api/biSchemas'
import { getTenantConfig } from '@/api/llmConfigs'
import type { Agent } from '@/types'

interface AgentBusinessUIProps {
  agent: Agent
}

interface BlockItem {
  id: string
  selectedSchemaId: string
  selectedFiles: File[]
}

/** 從 CSV 檔案讀取第一行作為 headers */
function parseCsvHeadersFromFile(file: File): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      const firstLine = text.trim().split('\n')[0] ?? ''
      const headers = firstLine.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
      resolve(headers)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file, 'UTF-8')
  })
}

/** 檢查是否為相同檔案 */
function isSameFile(a: File, b: File): boolean {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified
}

/** 從 bi_schema 的 columns 取得允許的 CSV headers（field 名稱 + 所有 aliases） */
function getAllowedHeadersFromSchema(columns: Record<string, unknown> | null | undefined): Set<string> {
  const allowed = new Set<string>()
  if (!columns || typeof columns !== 'object') return allowed
  for (const [field, col] of Object.entries(columns)) {
    if (!col || typeof col !== 'object') continue
    const c = col as Record<string, unknown>
    allowed.add(field.trim())
    const aliases = c.aliases
    if (Array.isArray(aliases)) {
      for (const a of aliases) {
        if (typeof a === 'string' && a.trim()) allowed.add(a.trim())
      }
    } else if (typeof aliases === 'string' && aliases.trim()) {
      allowed.add(aliases.trim())
    }
  }
  return allowed
}

/** 檢查 CSV headers 是否都符合 schema（每個 header 需對應到 schema 的 field 或 alias，無欄序 fallback） */
function csvHeadersMatchSchema(csvHeaders: string[], allowedHeaders: Set<string>): boolean {
  if (allowedHeaders.size === 0) return false
  for (const h of csvHeaders) {
    const trimmed = h.trim()
    if (!trimmed) continue
    if (!allowedHeaders.has(trimmed)) return false
  }
  return true
}

const PROJECT_STORAGE_KEY_PREFIX = 'agent-business-project'

/** 系統預設範例問題（無論資料是否就緒皆可檢視；實際分析仍受匯入／權限限制） */
const BI_SYSTEM_EXAMPLE_QUESTIONS = [
  '簡介這個資料庫',
  '提供幾個範例問題',
  '這個資料庫的資料時間區間為何？',
  '最需要注意的三件事，並給建議',
] as const

function getProjectStorageKey(agentId: string) {
  return `${PROJECT_STORAGE_KEY_PREFIX}-${agentId}`
}

/** 從 DB 的 conversation_data 轉成 Message[] */
function parseConversationData(data: unknown): Message[] {
  if (!Array.isArray(data)) return []
  return data.filter((m): m is Message => m && typeof m === 'object' && (m as Message).role && typeof (m as Message).content === 'string')
}

/** 將 chatCompletionsComputeTool 回傳的 chart_data 轉為 ChartModal 格式 */

function ResizeHandle({ className = '' }: { className?: string }) {
  return (
    <Separator
      className={`flex w-1 shrink-0 cursor-col-resize items-center justify-center bg-transparent outline-none ring-0 transition-colors hover:bg-gray-200/60 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 ${className}`}
    >
      <div
        className="pointer-events-none h-12 w-1 shrink-0 rounded-full bg-gray-300/80"
        aria-hidden
      />
    </Separator>
  )
}

function BlockCard({
  block,
  schemas,
  canDelete,
  onSchemaChange,
  onFilesChange,
  onRemoveFile,
  onClearFiles,
  onDelete,
  onValidationError,
  fileInputId,
  getSchemaValidationContext,
}: {
  block: BlockItem
  schemas: BiSchemaItem[]
  canDelete: boolean
  onSchemaChange: (id: string, value: string) => void
  onFilesChange: (id: string, files: File[]) => void
  onRemoveFile: (id: string, index: number) => void
  onClearFiles: (id: string) => void
  onDelete: (id: string) => void
  onValidationError: (message: string) => void
  fileInputId: string
  getSchemaValidationContext: (schemaId: string) => Promise<{
    allowedHeaders: Set<string>
    columnFieldNames: string[]
  }>
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files?.length) return
      const fileList = Array.from(files)

      const validFiles: File[] = []
      const invalidFiles: { file: File; reason: string }[] = []
      const duplicateFiles: File[] = []

      if (!block.selectedSchemaId.trim()) {
        for (const file of fileList) {
          invalidFiles.push({ file, reason: '請先選擇資料 Schema（bi_schemas）' })
        }
      } else {
        let validationCtx: { allowedHeaders: Set<string>; columnFieldNames: string[] } | null = null
        try {
          validationCtx = await getSchemaValidationContext(block.selectedSchemaId)
        } catch {
          for (const file of fileList) {
            invalidFiles.push({ file, reason: '無法取得 Schema 定義，請稍後再試' })
          }
        }

        if (validationCtx && validationCtx.columnFieldNames.length > 0) {
          const { allowedHeaders, columnFieldNames } = validationCtx
          for (const file of fileList) {
            if (block.selectedFiles.some((f) => isSameFile(file, f))) {
              duplicateFiles.push(file)
              continue
            }
            try {
              const csvHeaders = await parseCsvHeadersFromFile(file)
              if (csvHeaders.length === 0) {
                invalidFiles.push({ file, reason: '無法讀取 CSV 欄位' })
                continue
              }
              if (!csvHeadersMatchSchema(csvHeaders, allowedHeaders)) {
                const extra = csvHeaders.filter((h) => h.trim() && !allowedHeaders.has(h.trim()))
                invalidFiles.push({
                  file,
                  reason:
                    extra.length > 0
                      ? `格式不符：以下表頭須與 Schema 欄位名或 aliases 完全一致 — ${extra.join(', ')}`
                      : `格式不符：CSV 表頭與 Schema 不一致（共 ${csvHeaders.length} 欄，Schema 需 ${columnFieldNames.length} 個可辨識表頭）`,
                })
                continue
              }
              if (validFiles.some((f) => isSameFile(file, f))) {
                duplicateFiles.push(file)
                continue
              }
              validFiles.push(file)
            } catch {
              invalidFiles.push({ file, reason: '無法讀取檔案' })
            }
          }
        } else if (validationCtx?.columnFieldNames.length === 0) {
          for (const file of fileList) {
            invalidFiles.push({ file, reason: 'Schema 未定義 columns，無法驗證' })
          }
        }
      }

      if (validFiles.length > 0) {
        onFilesChange(block.id, [...block.selectedFiles, ...validFiles])
      }
      const messages: string[] = []
      if (duplicateFiles.length > 0) {
        const names = duplicateFiles.map((f) => f.name).join('、')
        messages.push(duplicateFiles.length > 1 ? `${names} 等檔案已存在，已略過` : `${names} 已存在，已略過`)
      }
      if (invalidFiles.length > 0) {
        const names = invalidFiles.map(({ file }) => file.name).join('、')
        messages.push(
          invalidFiles.length > 1 ? `${names} 等 ${invalidFiles.length} 個檔案無法加入` : `${names}：${invalidFiles[0].reason}`
        )
      }
      if (messages.length > 0) {
        onValidationError(messages.join('；'))
      }

      setTimeout(() => {
        if (e.target) e.target.value = ''
      }, 0)
    },
    [block.id, block.selectedSchemaId, block.selectedFiles, getSchemaValidationContext, onFilesChange, onValidationError]
  )

  return (
    <div className="flex shrink-0 flex-col overflow-hidden rounded-lg border-2 border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-100 px-4 py-3">
        <span className="text-lg font-medium text-gray-700">匯入資料</span>
        {canDelete && (
          <button
            type="button"
            onClick={() => onDelete(block.id)}
            className="rounded p-1 text-2xl leading-none text-gray-500 transition-colors hover:bg-red-100 hover:text-red-600"
            aria-label="刪除區塊"
          >
            ×
          </button>
        )}
      </div>
      <div className="flex flex-col gap-5 p-4">
        <div className="flex flex-col gap-2">
          <label className="text-lg font-medium text-gray-700" htmlFor={`block-schema-${block.id}`}>
            資料範本
          </label>
          <select
            id={`block-schema-${block.id}`}
            aria-label="從 bi_schemas 選擇一筆 schema"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-lg focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            value={block.selectedSchemaId}
            onChange={(e) => onSchemaChange(block.id, e.target.value)}
          >
            <option value="">— 未選擇 —</option>
            {schemas.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name?.trim() ? s.name : s.id}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            id={fileInputId}
            type="file"
            accept=".csv,text/csv"
            multiple={true}
            aria-label="選擇 CSV 檔案（可多選）"
            className="hidden"
            onChange={handleFileChange}
          />
          <div
            role="button"
            tabIndex={0}
            onClick={() => block.selectedSchemaId && inputRef.current?.click()}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && block.selectedSchemaId) {
                e.preventDefault()
                inputRef.current?.click()
              }
            }}
            onDragOver={(e) => {
              e.preventDefault()
              if (block.selectedSchemaId) e.currentTarget.classList.add('border-blue-400', 'bg-blue-50/50')
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50/50')
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50/50')
              if (!block.selectedSchemaId || !e.dataTransfer.files?.length) return
              const input = inputRef.current
              if (input) {
                const dt = new DataTransfer()
                for (const file of e.dataTransfer.files) dt.items.add(file)
                input.files = dt.files
                input.dispatchEvent(new Event('change', { bubbles: true }))
              }
            }}
            className={`flex cursor-pointer flex-col gap-2 rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 py-3 transition-colors ${
              block.selectedSchemaId
                ? 'hover:border-gray-300 hover:bg-gray-100'
                : 'cursor-not-allowed opacity-60'
            }`}
            title={
              !block.selectedSchemaId
                ? '請先選擇資料 Schema（bi_schemas）'
                : '點擊可一次選多個 CSV；或拖曳多個檔案至此'
            }
          >
            <div className="flex items-center justify-between px-3">
              <span className="text-lg text-gray-600">
                {block.selectedFiles.length > 0
                  ? `已選擇 ${block.selectedFiles.length} 個檔案`
                  : '點擊或拖曳 CSV 至此（可複選多個檔案）'}
              </span>
              {block.selectedFiles.length > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onClearFiles(block.id)
                  }}
                  className="text-lg text-red-600 hover:underline"
                >
                  清除全部
                </button>
              )}
            </div>
            <ul
              className={`overflow-auto px-3 pb-2 ${
                block.selectedFiles.length > 0 ? 'min-h-0 max-h-28' : 'min-h-[2.5rem]'
              }`}
            >
              {block.selectedFiles.length > 0 ? (
                block.selectedFiles.map((file, i) => (
                  <li
                    key={`${file.name}-${file.lastModified}-${i}`}
                    className="flex items-center justify-between gap-2 border-b border-gray-200 py-1.5 last:border-b-0"
                  >
                    <span className="truncate text-lg text-gray-700" title={file.name}>
                      {file.name}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemoveFile(block.id, i)
                      }}
                      className="shrink-0 text-lg text-red-500 hover:text-red-700"
                      aria-label={`移除 ${file.name}`}
                    >
                      ×
                    </button>
                  </li>
                ))
              ) : null}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AgentBusinessUI({ agent }: AgentBusinessUIProps) {
  const aiPanelRef = useRef<PanelImperativeHandle>(null)
  const [projects, setProjects] = useState<BiProjectItem[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState<BiProjectItem | null>(null)
  const [projectPanelCollapsed, setProjectPanelCollapsed] = useState(false)
  const [projectMenuOpen, setProjectMenuOpen] = useState<string | null>(null)
  const [deleteProjectConfirm, setDeleteProjectConfirm] = useState<string | null>(null)
  const [deleteProjectLoading, setDeleteProjectLoading] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDesc, setNewProjectDesc] = useState('')
  const [newProjectSubmitting, setNewProjectSubmitting] = useState(false)
  const [newProjectError, setNewProjectError] = useState<string | null>(null)
  const [editProject, setEditProject] = useState<BiProjectItem | null>(null)
  const [editProjectName, setEditProjectName] = useState('')
  const [editProjectDesc, setEditProjectDesc] = useState('')
  const [editProjectSubmitting, setEditProjectSubmitting] = useState(false)
  const [editProjectError, setEditProjectError] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [analysisModel, setAnalysisModel] = useState<string | null>(null)
  const [userPrompt, setUserPrompt] = useState('')

  const [exampleQuestionsCount, setExampleQuestionsCount] = useState('0')
  const [isLoading, setIsLoading] = useState(false)
  const [loadingStage] = useState<'intent' | 'compute' | 'text' | null>(null)
  const [agentSteps, setAgentSteps] = useState<AgentStepEvent[]>([])
  const [agentFinalizing, setAgentFinalizing] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [importCsvLoading, setImportCsvLoading] = useState(false)
  const [importDrawerOpen, setImportDrawerOpen] = useState(false)
  const [showClearDuckdbConfirm, setShowClearDuckdbConfirm] = useState(false)
  const [importTab, setImportTab] = useState<'csv' | 'auto'>('csv')
  const [currentUserRole, setCurrentUserRole] = useState<string>('user')
  const [autoImportConfig, setAutoImportConfig] = useState<AutoImportConfig | null>(null)
  const [autoImportLoading, setAutoImportLoading] = useState(false)
  const [autoImportSaving, setAutoImportSaving] = useState(false)
  const [autoImportTriggering, setAutoImportTriggering] = useState(false)
  const [autoImportForm, setAutoImportForm] = useState({
    watch_path: '',
    mode: 'replace' as 'replace' | 'append',
    interval_minutes: 60,
    enabled: true,
  })
  const [allowedWatchBase, setAllowedWatchBase] = useState('')
  const nextBlockIdRef = useRef(0)
  const [blocks, setBlocks] = useState<BlockItem[]>(() => [
    { id: '0', selectedSchemaId: '', selectedFiles: [] },
  ])
  const [schemas, setSchemas] = useState<BiSchemaItem[]>([])
  const [csvAdapterToast, setCsvAdapterToast] = useState<string | null>(null)
  /** 各分析主題 DuckDB 列數（null 表示尚未載入或取狀態失敗） */
  const [duckdbRowCountByProject, setDuckdbRowCountByProject] = useState<Record<string, number | null>>({})
  const [schemaManagerOpen, setSchemaManagerOpen] = useState(false)
  const [pendingSchemaChange, setPendingSchemaChange] = useState<{ blockId: string; schemaId: string } | null>(null)
  const [examplePromptsModalOpen, setExamplePromptsModalOpen] = useState(false)
  const [chatInputSeed, setChatInputSeed] = useState<{ n: number; text: string } | null>(null)
  const chatExampleSeedCounterRef = useRef(0)

  const userExamplePrompts = useMemo(
    () =>
      (selectedProject?.project_config?.sampleQuestions ?? []).map((text, i) => ({
        id: String(i),
        text,
      })),
    [selectedProject?.project_config?.sampleQuestions]
  )

  const loadSchemas = useCallback(() => {
    listBiSchemas(agent.agent_id)
      .then(setSchemas)
      .catch(() => setSchemas([]))
  }, [agent.agent_id])

  // 取得目前登入用戶的 role，以及系統層級的 watch_path 根目錄
  useEffect(() => {
    getMe()
      .then((u) => setCurrentUserRole(u.role ?? 'user'))
      .catch(() => setCurrentUserRole('user'))
    getAutoImportBaseConfig(agent.id)
      .then((cfg) => {
        setAllowedWatchBase(cfg.allowed_watch_base)
        setAutoImportForm((prev) => ({
          ...prev,
          // watch_path 由 selectedProject effect 負責填入，此處不預填
        }))
      })
      .catch(() => {})
  }, [agent.id])

  // 當切換到「自動匯入」tab 且有選中 project 時，載入設定
  useEffect(() => {
    if (importTab !== 'auto' || !selectedProject) return
    // 以分析主題名稱（sanitize 後）作為子目錄預設值
    const safeName = selectedProject.project_name.replace(/[/\\:*?"<>|]/g, '_').trim() || selectedProject.project_id
    const defaultPath = allowedWatchBase ? `${allowedWatchBase}/${safeName}` : ''
    setAutoImportLoading(true)
    getAutoImport(agent.id, selectedProject.project_id)
      .then((cfg) => {
        setAutoImportConfig(cfg)
        if (cfg.configured) {
          setAutoImportForm({
            watch_path: cfg.watch_path ?? defaultPath,
            mode: cfg.mode ?? 'replace',
            interval_minutes: cfg.interval_minutes ?? 60,
            enabled: cfg.enabled ?? true,
          })
        } else {
          // 尚未設定時，直接用當前主題名稱的子目錄覆蓋（避免帶入前一個主題的路徑）
          setAutoImportForm((prev) => ({
            ...prev,
            watch_path: defaultPath,
          }))
        }
      })
      .catch(() => { /* 保留舊 config，不清空 */ })
      .finally(() => setAutoImportLoading(false))
  }, [importTab, selectedProject, agent.id])

  const examplePrompts = useMemo(
    () => [
      ...BI_SYSTEM_EXAMPLE_QUESTIONS.map((text, i) => ({
        id: `sys-${i}`,
        text,
        isSystem: true as const,
      })),
      ...userExamplePrompts.map((u) => ({ ...u, isSystem: false as const })),
    ],
    [userExamplePrompts]
  )

  const patchProjectConfig = useCallback(
    (config: ProjectConfig) => {
      if (!selectedProject) return
      const merged: ProjectConfig = { ...selectedProject.project_config, ...config }
      updateBiProject(agent.id, selectedProject.project_id, { project_config: merged })
        .then((updated) => {
          setProjects((prev) => prev.map((p) => (p.project_id === updated.project_id ? updated : p)))
          setSelectedProject((prev) =>
            prev?.project_id === updated.project_id ? updated : prev
          )
        })
        .catch(() => {})
    },
    [agent.id, selectedProject]
  )

  const handleExamplePromptAdd = useCallback(
    (text: string) => {
      const t = text.trim()
      if (!t || !selectedProject) return
      const current = selectedProject.project_config?.sampleQuestions ?? []
      patchProjectConfig({ sampleQuestions: [...current, t] })
    },
    [selectedProject, patchProjectConfig]
  )

  const handleExamplePromptRemove = useCallback(
    (id: string) => {
      if (id.startsWith('sys-') || !selectedProject) return
      const idx = parseInt(id, 10)
      const current = selectedProject.project_config?.sampleQuestions ?? []
      patchProjectConfig({ sampleQuestions: current.filter((_, i) => i !== idx) })
    },
    [selectedProject, patchProjectConfig]
  )

  const handlePickExampleForChat = useCallback((text: string) => {
    chatExampleSeedCounterRef.current += 1
    setChatInputSeed({ n: chatExampleSeedCounterRef.current, text })
  }, [])

  const clearChatInputSeed = useCallback(() => setChatInputSeed(null), [])

  const openImportForProject = useCallback((p: BiProjectItem) => {
    setProjectMenuOpen(null)
    setSelectedProject(p)
    try {
      localStorage.setItem(getProjectStorageKey(agent.id), p.project_id)
    } catch {
      // 忽略
    }
    setImportDrawerOpen(true)
  }, [agent.id])

  // 切換專案時，用已儲存的 schema_id 預填 blocks
  useEffect(() => {
    setBlocks([{
      id: '0',
      selectedSchemaId: selectedProject?.schema_id?.trim() ?? '',
      selectedFiles: [],
    }])
    nextBlockIdRef.current = 0
  }, [selectedProject?.project_id])

  const getSchemaValidationContext = useCallback(
    async (schemaId: string): Promise<{ allowedHeaders: Set<string>; columnFieldNames: string[] }> => {
      const detail = await getBiSchema(schemaId)
      const columns = detail?.schema_json?.columns as Record<string, unknown> | undefined
      const columnFieldNames =
        columns && typeof columns === 'object' ? Object.keys(columns) : []
      return {
        allowedHeaders: getAllowedHeadersFromSchema(columns),
        columnFieldNames,
      }
    },
    []
  )

  /** 送出時必讀最新值，避免 stale closure */
  const latestRef = useRef({
    exampleQuestionsCount,
    userPrompt,
  })
  latestRef.current = {
    exampleQuestionsCount,
    userPrompt,
  }

  const setExampleQuestionsCountAndRef = (v: string) => {
    setExampleQuestionsCount(v)
    latestRef.current.exampleQuestionsCount = v
  }
  const setUserPromptAndRef = (v: string) => {
    setUserPrompt(v)
    latestRef.current.userPrompt = v
  }

  useEffect(() => {
    if (!toastMessage) return
    const id = setTimeout(() => setToastMessage(null), 2000)
    return () => clearTimeout(id)
  }, [toastMessage])

  useEffect(() => {
    if (!csvAdapterToast) return
    const id = setTimeout(() => setCsvAdapterToast(null), 5000)
    return () => clearTimeout(id)
  }, [csvAdapterToast])

  useEffect(() => {
    loadSchemas()
  }, [loadSchemas])

  const projectIdsKey = useMemo(
    () => projects.map((p) => p.project_id).slice().sort().join('|'),
    [projects]
  )

  useEffect(() => {
    if (!agent.id || projects.length === 0) {
      setDuckdbRowCountByProject({})
      return
    }
    let cancelled = false
    void Promise.all(
      projects.map((p) =>
        getDuckdbStatus(agent.id, p.project_id)
          .then((res) => ({ id: p.project_id, count: res.row_count }))
          .catch(() => ({ id: p.project_id, count: null as number | null }))
      )
    ).then((rows) => {
      if (cancelled) return
      const next: Record<string, number | null> = {}
      for (const r of rows) {
        next[r.id] = r.count
      }
      setDuckdbRowCountByProject(next)
    })
    return () => {
      cancelled = true
    }
  }, [agent.id, projectIdsKey])

  // 批次載入所有 project 的自動匯入狀態（manager+ 才需要顯示 badge）
  const [autoImportStatusByProject, setAutoImportStatusByProject] = useState<
    Record<string, Pick<AutoImportConfig, 'configured' | 'enabled' | 'last_import_status'>>
  >({})

  useEffect(() => {
    const isManager = ['manager', 'admin', 'super_admin'].includes(currentUserRole)
    if (!agent.id || projects.length === 0 || !isManager) return
    let cancelled = false
    void Promise.all(
      projects.map((p) =>
        getAutoImport(agent.id, p.project_id)
          .then((cfg) => ({ id: p.project_id, cfg }))
          .catch(() => ({
            id: p.project_id,
            cfg: { configured: false, enabled: false, last_import_status: 'never' } as AutoImportConfig,
          }))
      )
    ).then((results) => {
      if (cancelled) return
      const next: Record<string, Pick<AutoImportConfig, 'configured' | 'enabled' | 'last_import_status'>> = {}
      for (const r of results) {
        next[r.id] = {
          configured: r.cfg.configured,
          enabled: r.cfg.enabled,
          last_import_status: r.cfg.last_import_status,
        }
      }
      setAutoImportStatusByProject(next)
    })
    return () => {
      cancelled = true
    }
  }, [agent.id, projectIdsKey, currentUserRole])

  const duckdbRowCount = selectedProject
    ? duckdbRowCountByProject[selectedProject.project_id] ?? null
    : null

  /** 對話區「資料」按鈕 icon 色：與左欄主題 db 圖示語意一致（淺底用較深 shade） */
  const chatDataDbIconClass = useMemo(() => {
    if (!selectedProject) return 'text-gray-500'
    if (duckdbRowCount == null) return 'text-amber-600'
    if (duckdbRowCount > 0) return 'text-emerald-600'
    return 'text-red-600'
  }, [selectedProject, duckdbRowCount])

  /** 與 db 圖示色語意同源：`duckdbRowCountByProject` / `duckdbRowCount`，不重算 */
  const chatEmptyPlaceholder = useMemo(() => {
    if (!selectedProject) {
      return '請先選擇左側「分析主題」以開始分析。'
    }
    if (duckdbRowCount == null) {
      return '正在確認此主題的資料狀態…'
    }
    if (duckdbRowCount === 0) {
      return '尚無資料。\n請點對話列「範例問題」旁的資料庫圖示，或左側主題旁的資料庫圖示，匯入資料。'
    }
    return '輸入訊息開始對話…'
  }, [selectedProject, duckdbRowCount])

  const chatEmptyPlaceholderClassName = useMemo(() => {
    if (selectedProject && duckdbRowCount === 0) {
      return 'max-w-2xl text-2xl font-semibold leading-snug text-gray-800 sm:text-[1.65rem] md:text-3xl md:leading-snug'
    }
    return undefined
  }, [selectedProject, duckdbRowCount])

  /** 無資料時停用送出，與空狀態 / db 圖示語意一致 */
  const chatSubmitDisabled = Boolean(selectedProject && duckdbRowCount === 0)

  const applySchemaChange = (id: string, value: string) => {
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === id ? { ...b, selectedSchemaId: value, selectedFiles: [] } : b
      )
    )
    const pid = selectedProject?.project_id
    if (!pid) return
    const sid = value.trim()
    void updateBiProject(agent.id, pid, { schema_id: sid || null })
      .then((updated) => {
        setProjects((prev) =>
          prev.map((p) => (p.project_id === updated.project_id ? { ...p, schema_id: updated.schema_id } : p))
        )
        setSelectedProject((prev) =>
          prev?.project_id === updated.project_id ? { ...prev, schema_id: updated.schema_id } : prev
        )
      })
      .catch((err) => {
        const msg =
          err instanceof ApiError ? err.detail ?? err.message : err instanceof Error ? err.message : '更新專案 Schema 失敗'
        setCsvAdapterToast(String(msg))
      })
  }

  const updateBlockSchema = (id: string, value: string) => {
    if (duckdbRowCount != null && duckdbRowCount > 0) {
      setPendingSchemaChange({ blockId: id, schemaId: value })
      return
    }
    applySchemaChange(id, value)
  }
  const updateBlockFiles = (id: string, files: File[]) => {
    setBlocks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, selectedFiles: files } : b))
    )
  }
  const removeFileFromBlock = (id: string, index: number) => {
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === id
          ? { ...b, selectedFiles: b.selectedFiles.filter((_, i) => i !== index) }
          : b
      )
    )
  }
  const clearBlockFiles = (id: string) => {
    setBlocks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, selectedFiles: [] } : b))
    )
  }
  const removeBlock = (id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id))
  }

  /** 專案選單：點擊畫面任何處即關閉 */
  useEffect(() => {
    if (!projectMenuOpen) return
    const handleClick = () => setProjectMenuOpen(null)
    const id = setTimeout(() => document.addEventListener('click', handleClick), 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener('click', handleClick)
    }
  }, [projectMenuOpen])

  /** 切換專案時載入該專案的對話紀錄與 AI 設定 */
  useEffect(() => {
    if (selectedProject) {
      setMessages(parseConversationData(selectedProject.conversation_data))
      setUserPrompt(selectedProject.project_config?.userPrompt ?? '')
      setExampleQuestionsCount(selectedProject.project_config?.suggestedFollowUpCount ?? '0')
    } else {
      setMessages([])
      setUserPrompt('')
      setExampleQuestionsCount('0')
    }
  }, [selectedProject?.project_id])

  useEffect(() => {
    setProjectsLoading(true)
    listBiProjects(agent.id)
      .then((list) => {
        setProjects(list)
        setSelectedProject((prev) => {
          if (list.length === 0) return null
          try {
            const saved = localStorage.getItem(getProjectStorageKey(agent.id))
            if (saved) {
              const found = list.find((p) => p.project_id === saved)
              if (found) return found
            }
          } catch {
            // 忽略
          }
          if (prev) {
            const match = list.find((p) => p.project_id === prev.project_id)
            if (match) return match
          }
          return list[0]
        })
      })
      .catch(() => {})
      .finally(() => setProjectsLoading(false))
  }, [agent.id])

  /** 設定變更時 debounce 儲存至 DB */
  useEffect(() => {
    if (!selectedProject) return
    const timer = setTimeout(() => {
      updateBiProject(agent.id, selectedProject.project_id, {
        project_config: {
          ...selectedProject.project_config,
          userPrompt,
          suggestedFollowUpCount: exampleQuestionsCount,
        },
      })
        .then((updated) => {
          setProjects((prev) => prev.map((p) => (p.project_id === updated.project_id ? updated : p)))
          setSelectedProject((prev) =>
            prev?.project_id === updated.project_id ? { ...prev, project_config: updated.project_config } : prev
          )
        })
        .catch(() => {})
    }, 800)
    return () => clearTimeout(timer)
  }, [agent.id, selectedProject?.project_id, userPrompt, exampleQuestionsCount])

  /** 載入分析模型設定 */
  useEffect(() => {
    getTenantConfig()
      .then((tc) => setAnalysisModel(tc.analysis_llm_model ?? null))
      .catch(() => setAnalysisModel(null))
  }, [])

  /** 依專案儲存對話紀錄至 DB（debounce 500ms） */
  useEffect(() => {
    if (!selectedProject) return
    const timer = setTimeout(() => {
      const payload: MessageStored[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.meta && { meta: m.meta }),
        ...(m.chartData != null && { chartData: m.chartData }),
      }))
      updateBiProject(agent.id, selectedProject.project_id, { conversation_data: payload })
        .then((updated) => {
          setProjects((prev) =>
            prev.map((p) =>
              p.project_id === selectedProject.project_id
                ? {
                    ...p,
                    conversation_data: updated.conversation_data,
                    schema_id: updated.schema_id ?? p.schema_id,
                  }
                : p
            )
          )
          setSelectedProject((prev) =>
            prev && prev.project_id === selectedProject.project_id
              ? {
                  ...prev,
                  conversation_data: updated.conversation_data,
                  schema_id: updated.schema_id ?? prev.schema_id,
                }
              : prev
          )
        })
        .catch(() => {})
    }, 500)
    return () => clearTimeout(timer)
  }, [agent.id, selectedProject?.project_id, messages])

  function buildUserPrompt(s: {
    exampleQuestionsCount: string
    userPrompt: string
  }): string {
    const parts: string[] = []
    const n = parseInt(s.exampleQuestionsCount, 10)
    if (n > 0) {
      parts.push(`回覆結尾請提供 ${n} 個建議追問的問題，對營運管理有幫助的。`)
    }
    if (s.userPrompt.trim()) parts.push(s.userPrompt.trim())
    return parts.join(' ')
  }

  async function handleDeleteProject(projectId: string) {
    setDeleteProjectLoading(true)
    try {
      await deleteBiProject(agent.id, projectId)
      const wasSelected = selectedProject?.project_id === projectId
      if (wasSelected) {
        try {
          localStorage.removeItem(getProjectStorageKey(agent.id))
        } catch {
          // 忽略
        }
        setSelectedProject(null)
        setMessages([])
      }
      setProjects((prev) => prev.filter((p) => p.project_id !== projectId))
      setDuckdbRowCountByProject((prev) => {
        const next = { ...prev }
        delete next[projectId]
        return next
      })
    } catch {
      // 忽略錯誤
    } finally {
      setDeleteProjectLoading(false)
      setDeleteProjectConfirm(null)
      setProjectMenuOpen(null)
    }
  }

  async function handleImportCsv() {
    if (!selectedProject || importCsvLoading) return
    const blocksWithFiles = blocks.filter(
      (b) => b.selectedSchemaId.trim() && b.selectedFiles.length > 0
    )
    if (blocksWithFiles.length === 0) {
      setCsvAdapterToast('請先選擇資料 Schema（bi_schemas）並上傳至少一個 CSV 檔案')
      return
    }
    setImportCsvLoading(true)
    try {
      const payload = await Promise.all(
        blocksWithFiles.map(async (block) => {
          const files = await Promise.all(
            block.selectedFiles.map(async (file) => ({
              file_name: file.name,
              content: await file.text(),
            }))
          )
          return { schema_id: block.selectedSchemaId, files }
        })
      )
      const res = await importCsvToDuckdb(agent.id, selectedProject.project_id, payload)
      setToastMessage(res.message)
      if (res.ok && res.row_count != null) {
        const pid = selectedProject.project_id
        setDuckdbRowCountByProject((prev) => ({ ...prev, [pid]: res.row_count! }))
      }
      if (res.ok && res.schema_id) {
        setProjects((prev) =>
          prev.map((p) =>
            p.project_id === selectedProject.project_id ? { ...p, schema_id: res.schema_id } : p
          )
        )
        setSelectedProject((prev) =>
          prev && prev.project_id === selectedProject.project_id
            ? { ...prev, schema_id: res.schema_id }
            : prev
        )
      }
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.detail ?? err.message : err instanceof Error ? err.message : '匯入失敗，請稍後再試'
      setCsvAdapterToast(msg)
    } finally {
      setImportCsvLoading(false)
    }
  }

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
      const created = await createBiProject({
        agent_id: agent.id,
        project_name: name,
        project_desc: newProjectDesc.trim() || null,
      })
      setProjects((prev) => [created, ...prev])
      setSelectedProject(created)
      try {
        localStorage.setItem(getProjectStorageKey(agent.id), created.project_id)
      } catch {
        // 忽略
      }
      handleCloseNewProject()
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.detail ?? err.message : err instanceof Error ? err.message : '建立失敗，請稍後再試'
      setNewProjectError(msg)
    } finally {
      setNewProjectSubmitting(false)
    }
  }

  const handleOpenEditProject = (p: BiProjectItem) => {
    setEditProject(p)
    setEditProjectName(p.project_name)
    setEditProjectDesc(p.project_desc ?? '')
    setEditProjectError(null)
    setProjectMenuOpen(null)
  }

  const handleCloseEditProject = () => {
    setEditProject(null)
    setEditProjectError(null)
  }

  const handleSubmitEditProject = async () => {
    const name = editProjectName.trim()
    if (!name) {
      setEditProjectError('請輸入專案名稱')
      return
    }
    if (!editProject) return
    setEditProjectSubmitting(true)
    setEditProjectError(null)
    try {
      const updated = await updateBiProject(agent.id, editProject.project_id, {
        project_name: name,
        project_desc: editProjectDesc.trim() || null,
      })
      setProjects((prev) =>
        prev.map((p) =>
          p.project_id === editProject.project_id
            ? {
                ...p,
                project_name: updated.project_name,
                project_desc: updated.project_desc,
                schema_id: updated.schema_id ?? p.schema_id,
              }
            : p
        )
      )
      if (selectedProject?.project_id === editProject.project_id) {
        setSelectedProject((prev) =>
          prev?.project_id === editProject.project_id
            ? {
                ...prev,
                project_name: updated.project_name,
                project_desc: updated.project_desc,
                schema_id: updated.schema_id ?? prev.schema_id,
              }
            : prev
        )
      }
      handleCloseEditProject()
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.detail ?? err.message : err instanceof Error ? err.message : '更新失敗，請稍後再試'
      setEditProjectError(msg)
    } finally {
      setEditProjectSubmitting(false)
    }
  }

  async function handleSendMessage(text: string) {
    if (!text || isLoading) return

    if (!selectedProject) {
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: text },
        { role: 'assistant', content: '請先選擇分析主題後再進行對話。左側可選擇或建立分析主題。' },
      ])
      return
    }

    if (duckdbRowCount === 0) {
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: text },
        {
          role: 'assistant',
          content:
            '此分析主題尚無匯入資料。請點對話列「範例問題」旁或左側主題旁的資料庫圖示匯入資料後，再提問。',
        },
      ])
      return
    }

    const sid = selectedProject.schema_id?.trim()
    if (!sid) {
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: text },
        {
          role: 'assistant',
          content:
            '此分析主題尚未設定資料範本。請在「匯入資料」區選擇資料範本並上傳 CSV 完成匯入後，再進行分析對話。',
        },
      ])
      return
    }

    const latest = latestRef.current
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setIsLoading(true)
    setAgentSteps([])
    setAgentFinalizing(false)

    try {
      const userPrompt = buildUserPrompt(latest)
      const res = await chatAgentBiStream(
        {
          agent_id: agent.id,
          project_id: selectedProject.project_id,
          schema_id: sid,
          system_prompt: '',
          user_prompt: userPrompt || '',
          data: '',
          model: '',   // 由後端從 tenant analysis_llm_model 決定
          messages: [],
          content: text,
        },
        (step: AgentStepEvent) => {
          setAgentSteps((prev) => [...prev, step])
          // 所有查詢結束（最後一個 step 是 done）→ 進入 finalizing
          if (step.phase === 'done') setAgentFinalizing(true)
        }
      )
      const meta: ResponseMeta | undefined =
        res.usage != null
          ? {
              model: res.model,
              usage: res.usage,
              finish_reason: null,
            }
          : undefined
      const dbg = res.debug && typeof res.debug === 'object' ? (res.debug as Record<string, unknown>) : undefined
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: res.content,
          meta,
          // Agent BI 不顯示圖表（多步驟分析的圖表無法自動產生有意義的視覺化）
          ...(dbg && Object.keys(dbg).length > 0 ? { computeDebug: dbg } : {}),
          ...(res.download_data && res.download_data.length > 0 ? { downloadData: res.download_data } : {}),
        },
      ])
    } catch (err) {
      let msg = '未知錯誤'
      if (err instanceof ApiError) msg = err.detail ?? err.message
      else if (err instanceof Error) {
        msg = err.name === 'AbortError' ? '請求逾時，請檢查網路或稍後再試' : err.message
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: `錯誤：${msg}` }])
    } finally {
      setIsLoading(false)
      // 完成後稍作停留再關閉 overlay
      setTimeout(() => {
        setAgentSteps([])
        setAgentFinalizing(false)
      }, 600)
    }
  }

  return (
    <div className="relative flex h-full flex-col p-4 text-[18px]">
      <AgentProgressOverlay
        steps={agentSteps}
        visible={agentSteps.length > 0}
        finalizing={agentFinalizing}
      />
      {toastMessage && (
        <div
          className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-gray-800 px-4 py-2 text-[18px] text-white shadow-lg"
          role="status"
        >
          {toastMessage}
        </div>
      )}
      {csvAdapterToast && (
        <div
          className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 max-w-[90vw] rounded-lg bg-red-600 px-4 py-2 text-lg text-white shadow-lg"
          role="alert"
        >
          {csvAdapterToast}
        </div>
      )}

      <ConfirmModal
        open={pendingSchemaChange !== null}
        title="切換 Schema"
        message={`此 Project 已有 ${duckdbRowCount?.toLocaleString() ?? 0} 筆資料。切換 Schema 後，請重新匯入符合新 Schema 的 CSV，否則查詢將無法正常運作。`}
        confirmText="確認切換"
        cancelText="取消"
        variant="primary"
        onConfirm={() => {
          if (pendingSchemaChange) applySchemaChange(pendingSchemaChange.blockId, pendingSchemaChange.schemaId)
          setPendingSchemaChange(null)
        }}
        onCancel={() => setPendingSchemaChange(null)}
      />

      <ConfirmModal
        open={showClearConfirm}
        title="確認清除"
        message="確定要清除所有對話嗎？"
        confirmText="確認清除"
        onConfirm={() => {
          setMessages([])
          setShowClearConfirm(false)
        }}
        onCancel={() => setShowClearConfirm(false)}
      />
      <ConfirmModal
        open={showClearDuckdbConfirm}
        title="確認清除資料"
        message={`確定要清除「${selectedProject?.project_name ?? ''}」的所有匯入資料嗎？此操作無法復原。`}
        confirmText="確認清除"
        cancelText="取消"
        variant="danger"
        onConfirm={async () => {
          setShowClearDuckdbConfirm(false)
          if (!selectedProject) return
          try {
            await clearDuckdbData(agent.id, selectedProject.project_id)
            setDuckdbRowCountByProject((prev) => ({ ...prev, [selectedProject.project_id]: null }))
            setToastMessage('資料已清除')
          } catch {
            setToastMessage('清除失敗，請稍後再試')
          }
        }}
        onCancel={() => setShowClearDuckdbConfirm(false)}
      />
      <HelpModal
        open={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        url="/help-bi-agent.md"
      />
      <ExamplePromptsModal
        open={examplePromptsModalOpen}
        onClose={() => setExamplePromptsModalOpen(false)}
        examplePrompts={examplePrompts}
        onPick={handlePickExampleForChat}
        onAdd={handleExamplePromptAdd}
        onRemove={handleExamplePromptRemove}
        isLoading={isLoading}
        onCopySuccess={() => setToastMessage('已複製到剪貼簿')}
        onCopyError={() => setToastMessage('複製失敗')}
      />
      <ConfirmModal
        open={deleteProjectConfirm !== null}
        title="刪除專案"
        message="確定要刪除此專案嗎？專案與相關資料將無法復原。"
        confirmText={deleteProjectLoading ? '處理中…' : '刪除'}
        variant="danger"
        onConfirm={() => {
          if (!deleteProjectLoading && deleteProjectConfirm) handleDeleteProject(deleteProjectConfirm)
        }}
        onCancel={() => !deleteProjectLoading && setDeleteProjectConfirm(null)}
      />
      <InputModal
        open={editProject !== null}
        title="修改專案"
        submitLabel="儲存"
        loading={editProjectSubmitting}
        onSubmit={handleSubmitEditProject}
        onClose={handleCloseEditProject}
      >
        {editProject && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-base font-medium text-gray-700">專案名稱</label>
              <input
                type="text"
                value={editProjectName}
                onChange={(e) => setEditProjectName(e.target.value)}
                placeholder="請輸入專案名稱"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-base font-medium text-gray-700">描述</label>
              <textarea
                value={editProjectDesc}
                onChange={(e) => setEditProjectDesc(e.target.value)}
                placeholder="請輸入專案描述（選填）"
                rows={3}
                className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
              />
            </div>
            {editProjectError && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-base text-red-700">{editProjectError}</div>
            )}
          </div>
        )}
      </InputModal>
      <InputModal
        open={newProjectOpen}
        title="新增專案"
        submitLabel="建立"
        loading={newProjectSubmitting}
        onSubmit={handleSubmitNewProject}
        onClose={handleCloseNewProject}
      >
        <div className="space-y-4">
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
      <AgentHeader
        agent={agent}
        headerBackgroundColor="#1C3939"
        showSchemaManager
        onSchemaManagerOpen={() => setSchemaManagerOpen(true)}
        onOnlineHelpClick={() => setShowHelpModal(true)}
      />
      {schemaManagerOpen && (
        <SchemaManagerOverlay
          agentId={agent.agent_id}
          onClose={() => setSchemaManagerOpen(false)}
          onSchemaChanged={loadSchemas}
        />
      )}

      <div className="mt-4 flex min-h-0 flex-1 gap-4 overflow-hidden">
        {/* 左側：專案 sidebar（可折疊，與 AgentQuotationUI 一致） */}
        <div
          className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md transition-[width] duration-200 ${
            projectPanelCollapsed ? 'w-12' : 'w-64'
          }`}
          style={{ backgroundColor: '#1C3939' }}
        >
          <div
            className={`flex shrink-0 items-center justify-between border-b border-gray-300/50 py-2.5 ${
              projectPanelCollapsed ? 'px-2' : 'pl-6 pr-3'
            }`}
          >
            {projectPanelCollapsed ? (
              <button
                type="button"
                onClick={() => setProjectPanelCollapsed(false)}
                className="flex items-center justify-center rounded-2xl p-1.5 text-white/80 transition-colors hover:bg-white/10"
                title="展開分析主題"
                aria-label="展開分析主題"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            ) : (
              <>
                <h3 className="text-base font-medium text-white">分析主題</h3>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setProjectPanelCollapsed(true)}
                    className="rounded-2xl px-1.5 py-1 text-white/80 transition-colors hover:bg-white/10"
                    title="折疊分析主題"
                    aria-label="折疊分析主題"
                  >
                    {'<<'}
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenNewProject}
                    className="flex items-center gap-1 rounded-2xl border border-white/30 bg-white/10 px-2.5 py-1 text-base font-medium text-white transition-colors hover:bg-white/20"
                    aria-label="新增分析主題"
                    title="新增分析主題"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    新增
                  </button>
                </div>
              </>
            )}
          </div>
          {!projectPanelCollapsed && (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {projectsLoading ? (
                <p className="text-base text-[#AE924C]/70">載入中…</p>
              ) : projects.length === 0 ? (
                <p className="text-base text-white">尚無分析主題，點擊「新增」建立</p>
              ) : (
                <ul className="space-y-2">
                  {projects.map((p) => {
                    const rowCount = duckdbRowCountByProject[p.project_id]
                    const dbIconClass =
                      rowCount == null
                        ? 'text-[#AE924C]/80'
                        : rowCount > 0
                          ? 'text-emerald-400'
                          : 'text-red-400'
                    const dbTitle =
                      rowCount == null
                        ? '載入資料狀態…（點擊開啟匯入）'
                        : rowCount > 0
                          ? `已匯入 ${rowCount.toLocaleString()} 筆，點擊開啟匯入`
                          : '尚無資料，點擊開啟匯入'
                    return (
                    <li
                      key={p.project_id}
                      className={`relative flex cursor-pointer items-center justify-between gap-1 rounded-lg px-2 py-2 text-base transition-colors text-white ${
                        selectedProject?.project_id === p.project_id
                          ? 'bg-[#AE924C] font-medium'
                          : 'hover:bg-[#AE924C]/10'
                      }`}
                      onClick={() => {
                        setSelectedProject(p)
                        try {
                          localStorage.setItem(getProjectStorageKey(agent.id), p.project_id)
                        } catch {
                          // 忽略
                        }
                      }}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          openImportForProject(p)
                        }}
                        className="shrink-0 rounded-lg p-1 text-white transition-colors hover:bg-white/15"
                        title={dbTitle}
                        aria-label={dbTitle}
                      >
                        <Database className={`h-4 w-4 ${dbIconClass}`} />
                      </button>
                      <span className="min-w-0 flex-1 truncate text-white">{p.project_name}</span>
                      {/* 自動匯入狀態 badge */}
                      {(() => {
                        const ai = autoImportStatusByProject[p.project_id]
                        if (!ai?.configured) return null
                        const isRunning = ai.last_import_status === 'running'
                        const isFailed = ai.last_import_status === 'failed'
                        const label = isRunning ? '同步中' : isFailed ? '失敗' : ai.enabled ? '自動' : '已停用'
                        const cls = isRunning
                          ? 'bg-blue-400/30 text-blue-100'
                          : isFailed
                          ? 'bg-red-400/30 text-red-100'
                          : ai.enabled
                          ? 'bg-green-400/30 text-green-100'
                          : 'bg-white/10 text-white/60'
                        return (
                          <span
                            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
                            title={`自動匯入：${label}`}
                          >
                            {label}
                          </span>
                        )
                      })()}
                      {selectedProject?.project_id === p.project_id && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setProjectMenuOpen((prev) => (prev === p.project_id ? null : p.project_id))
                            }}
                            className="shrink-0 rounded-2xl p-1 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                            aria-label="分析主題選單"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                          {projectMenuOpen === p.project_id && (
                        <div
                          className="absolute right-0 top-full z-10 mt-1 min-w-[9rem] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="w-full rounded-2xl px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                            onClick={() => openImportForProject(p)}
                          >
                            匯入資料
                          </button>
                          <button
                            type="button"
                            className="w-full rounded-2xl px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                            onClick={() => handleOpenEditProject(p)}
                          >
                            修改
                          </button>
                          <button
                            type="button"
                            className="w-full rounded-2xl px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                            onClick={() => {
                              setProjectMenuOpen(null)
                              setDeleteProjectConfirm(p.project_id)
                            }}
                          >
                            刪除
                          </button>
                        </div>
                          )}
                        </>
                      )}
                    </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* 對話 + AI 設定 */}
        <Group orientation="horizontal" className="flex min-h-0 min-w-0 flex-1 gap-1">
        <Panel
          defaultSize={50}
          minSize="600px"
          className="flex flex-col rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50"
        >
          <AgentChat
            messages={messages}
            onSubmit={handleSendMessage}
            isLoading={isLoading}
            loadingStage={loadingStage}
            showChart={false}
            emptyPlaceholder={chatEmptyPlaceholder}
            emptyPlaceholderClassName={chatEmptyPlaceholderClassName}
            submitDisabled={chatSubmitDisabled}
            submitDisabledTitle="尚無匯入資料，請先點資料庫圖示匯入"
            onCopySuccess={() => setToastMessage('已複製到剪貼簿')}
            onCopyError={() => setToastMessage('複製失敗')}
            exampleLayout="modal"
            chatInputSeed={chatInputSeed}
            onChatInputSeedApplied={clearChatInputSeed}
            headerActions={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setExamplePromptsModalOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                  aria-label="範例問題"
                >
                  <Lightbulb className="h-4 w-4 shrink-0 text-amber-600" />
                  <span>範例問題</span>
                </button>
                <button
                  type="button"
                  onClick={() => setImportDrawerOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                  aria-label="資料管理"
                  title={
                    !selectedProject
                      ? '請先選擇分析主題'
                      : duckdbRowCount == null
                        ? '載入資料狀態…'
                        : duckdbRowCount > 0
                          ? `已匯入 ${duckdbRowCount.toLocaleString()} 筆`
                          : '尚無資料，請匯入'
                  }
                >
                  <Database className={`h-4 w-4 shrink-0 ${chatDataDbIconClass}`} />
                  <span>
                    {selectedProject
                      ? duckdbRowCount !== null
                        ? duckdbRowCount > 0
                          ? `${duckdbRowCount.toLocaleString()} 筆`
                          : '尚無資料'
                        : '…'
                      : '資料管理'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => messages.length > 0 && setShowClearConfirm(true)}
                  disabled={isLoading || messages.length === 0}
                  className="rounded-lg border border-gray-300 bg-white p-2 text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                  aria-label="清除對話"
                >
                  <RefreshCw className="h-5 w-5" />
                </button>
              </div>
            }
          />
        </Panel>
        <ResizeHandle />
        <Panel
          panelRef={aiPanelRef}
          collapsible
          collapsedSize="250px"
          defaultSize={25}
          minSize="250px"
          className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50"
        >
          <header className="flex flex-shrink-0 items-center justify-between rounded-t-xl border-b border-slate-200 bg-slate-100 px-4 py-3 font-semibold text-slate-800 shadow-sm">
            <div className="flex items-center gap-1">
              <span>AI 設定區</span>
              <button
                type="button"
                onClick={() => setShowHelpModal(true)}
                className="rounded-lg p-1.5 text-gray-600 transition-colors hover:bg-gray-200"
                aria-label="使用說明"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => aiPanelRef.current?.collapse()}
              className="rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-200"
              aria-label="折疊"
            >
              <ChevronsRight className="h-5 w-5" />
            </button>
          </header>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden border-b border-gray-200 bg-gray-50 px-4 py-3">
            <AISettingsPanelBasic
              analysisModel={analysisModel}
              exampleQuestionsCount={exampleQuestionsCount}
              onExampleQuestionsCountChange={setExampleQuestionsCountAndRef}
            />
            <div className="shrink-0 border-t border-gray-200" />
            <AISettingsPanelAdvanced
              userPrompt={userPrompt}
              onUserPromptChange={setUserPromptAndRef}
              onToast={setToastMessage}
            />
          </div>
        </Panel>
        </Group>
      </div>

      {/* 資料匯入抽屜 */}
      {importDrawerOpen && (
        <div className="fixed inset-0 z-40 flex">
          {/* 遮罩 */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setImportDrawerOpen(false)}
          />
          {/* 抽屜本體（靠左全高，右側大圓角） */}
          <div className="relative z-50 flex h-full w-80 flex-col overflow-hidden rounded-r-3xl bg-white shadow-2xl ring-1 ring-gray-200/60">
            {/* 抽屜 Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-gray-600" />
                <span className="text-base font-semibold text-gray-800">資料管理</span>
                {selectedProject && duckdbRowCount != null && duckdbRowCount > 0 && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                    {duckdbRowCount.toLocaleString()} 筆
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setImportDrawerOpen(false)}
                className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100"
                aria-label="關閉"
              >
                ✕
              </button>
            </div>

            {/* Tab bar（manager+ 才顯示自動匯入 Tab） */}
            {['manager', 'admin', 'super_admin'].includes(currentUserRole) && (
              <div className="flex shrink-0 border-b border-gray-200">
                {(['csv', 'auto'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setImportTab(tab)}
                    className={`flex-1 py-2 text-sm font-medium transition-colors ${
                      importTab === tab
                        ? 'border-b-2 border-blue-600 text-blue-600'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {tab === 'csv' ? 'CSV 匯入' : '自動匯入'}
                  </button>
                ))}
              </div>
            )}

            {/* 抽屜內容 */}
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 text-lg">
              {/* ── CSV 匯入 Tab ── */}
              {importTab === 'csv' && (
                <>
                  {blocks.map((block) => (
                    <BlockCard
                      key={block.id}
                      block={block}
                      schemas={schemas}
                      canDelete={blocks.length > 1}
                      onSchemaChange={updateBlockSchema}
                      onFilesChange={updateBlockFiles}
                      onRemoveFile={removeFileFromBlock}
                      onClearFiles={clearBlockFiles}
                      onDelete={removeBlock}
                      onValidationError={(msg) => setCsvAdapterToast(msg)}
                      fileInputId={`file-input-drawer-${block.id}`}
                      getSchemaValidationContext={getSchemaValidationContext}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={async () => {
                      await handleImportCsv()
                      setImportDrawerOpen(false)
                    }}
                    disabled={
                      importCsvLoading ||
                      !selectedProject ||
                      blocks.every((b) => !b.selectedSchemaId.trim() || b.selectedFiles.length === 0)
                    }
                    className="flex shrink-0 items-center justify-center rounded-lg bg-blue-600 py-4 text-lg text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {importCsvLoading ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        匯入中…
                      </>
                    ) : (
                      '匯入資料'
                    )}
                  </button>
                  {/* 清除資料按鈕 */}
                  {selectedProject && duckdbRowCount != null && duckdbRowCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowClearDuckdbConfirm(true)}
                      className="flex shrink-0 items-center justify-center rounded-lg border border-red-400 py-3 text-sm text-red-500 transition-colors hover:bg-red-50"
                    >
                      清除資料
                    </button>
                  )}
                </>
              )}

              {/* ── 自動匯入 Tab ── */}
              {importTab === 'auto' && (
                <AutoImportPanel
                  agentId={agent.id}
                  projectId={selectedProject?.project_id ?? null}
                  userRole={currentUserRole}
                  allowedWatchBase={allowedWatchBase}
                  config={autoImportConfig}
                  loading={autoImportLoading}
                  saving={autoImportSaving}
                  triggering={autoImportTriggering}
                  form={autoImportForm}
                  onFormChange={(patch) => setAutoImportForm((prev) => ({ ...prev, ...patch }))}
                  onSave={async () => {
                    if (!selectedProject) return
                    setAutoImportSaving(true)
                    try {
                      const cfg = await setAutoImport(agent.id, selectedProject.project_id, autoImportForm)
                      setAutoImportConfig(cfg)
                      setToastMessage('自動匯入設定已儲存')
                    } catch (err) {
                      const msg = err instanceof ApiError ? (err.detail ?? err.message) : '儲存失敗，請稍後再試'
                      setToastMessage(`儲存失敗：${msg}`)
                    } finally {
                      setAutoImportSaving(false)
                    }
                  }}
                  onToggle={async (enabled) => {
                    if (!selectedProject) return
                    try {
                      await toggleAutoImport(agent.id, selectedProject.project_id, enabled)
                      setAutoImportConfig((prev) => prev ? { ...prev, enabled } : prev)
                      setToastMessage(enabled ? '自動匯入已啟用' : '自動匯入已停用')
                    } catch {
                      setToastMessage('操作失敗，請稍後再試')
                    }
                  }}
                  onTrigger={async () => {
                    if (!selectedProject) return
                    setAutoImportTriggering(true)
                    try {
                      const result = await triggerAutoImport(agent.id, selectedProject.project_id)
                      setAutoImportConfig(result)
                      setToastMessage('已手動執行匯入')
                      // 重新載入 duckdb 筆數
                      const status = await getDuckdbStatus(agent.id, selectedProject.project_id)
                      setDuckdbRowCountByProject((prev) => ({
                        ...prev,
                        [selectedProject.project_id]: status.has_data ? status.row_count : null,
                      }))
                    } catch (err) {
                      const msg = err instanceof ApiError ? err.detail ?? err.message : '觸發失敗，請稍後再試'
                      setToastMessage(msg)
                    } finally {
                      setAutoImportTriggering(false)
                    }
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 自動匯入面板 ─────────────────────────────────────────────────────────────

interface AutoImportPanelProps {
  agentId: string
  projectId: string | null
  userRole: string
  allowedWatchBase: string
  config: AutoImportConfig | null
  loading: boolean
  saving: boolean
  triggering: boolean
  form: { watch_path: string; mode: 'replace' | 'append'; interval_minutes: number; enabled: boolean }
  onFormChange: (patch: Partial<AutoImportPanelProps['form']>) => void
  onSave: () => void
  onToggle: (enabled: boolean) => void
  onTrigger: () => void
}

function AutoImportPanel({
  projectId,
  userRole,
  allowedWatchBase,
  config,
  loading,
  saving,
  triggering,
  form,
  onFormChange,
  onSave,
  onToggle,
  onTrigger,
}: AutoImportPanelProps) {
  const isAdmin = ['admin', 'super_admin'].includes(userRole)

  if (!projectId) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
        請先選擇一個分析主題
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        載入中…
      </div>
    )
  }

  const statusColor: Record<string, string> = {
    never: 'text-gray-400',
    running: 'text-blue-500',
    success: 'text-green-600',
    failed: 'text-red-600',
  }
  const statusLabel: Record<string, string> = {
    never: '從未執行',
    running: '執行中…',
    success: '成功',
    failed: '失敗',
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      {/* 說明 */}
      <p className="text-gray-500 text-xs leading-relaxed">
        系統會依排程自動掃描指定目錄中的 CSV 檔案，並同步更新 DuckDB 資料，無需手動匯入。
      </p>

      {/* 監控目錄（admin 可編輯，manager 唯讀） */}
      <div className="flex flex-col gap-1">
        <label className="font-medium text-gray-700">監控目錄</label>
        {isAdmin ? (
          <input
            type="text"
            className="rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="/app/data/csv_import/your-folder"
            value={form.watch_path}
            onChange={(e) => onFormChange({ watch_path: e.target.value })}
          />
        ) : (
          <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-gray-600 font-mono text-xs break-all">
            {config?.watch_path ?? '（尚未設定，請聯絡管理員）'}
          </div>
        )}
        <p className="text-xs text-gray-400">
          路徑必須在 <span className="font-mono">{allowedWatchBase || '/app/data/csv_import'}/</span> 目錄下
        </p>
      </div>

      {/* 模式與間隔（admin 可編輯） */}
      {isAdmin && (
        <>
          <div className="flex flex-col gap-1">
            <label className="font-medium text-gray-700">匯入模式</label>
            <select
              className="rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={form.mode}
              onChange={(e) => onFormChange({ mode: e.target.value as 'replace' | 'append' })}
            >
              <option value="replace">覆蓋（清空後重新匯入）</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-medium text-gray-700">排程間隔（分鐘）</label>
            <input
              type="number"
              min={1}
              className="rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={form.interval_minutes}
              onChange={(e) => onFormChange({ interval_minutes: Number(e.target.value) })}
            />
          </div>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="flex items-center justify-center rounded-lg bg-blue-600 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />儲存中…</> : '儲存設定'}
          </button>
        </>
      )}

      {/* ── 控制區（永遠顯示，未設定時 disabled） ── */}
      <div className="flex flex-col gap-3">
        {/* 啟用 / 停用 toggle */}
        <div className="flex items-center justify-between rounded-lg border border-gray-200 p-3">
          <div>
            <p className="font-medium text-gray-700">自動排程</p>
            <p className="text-xs text-gray-400">
              {config?.configured
                ? `每 ${config.interval_minutes} 分鐘執行一次`
                : '請先儲存設定'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onToggle(!config?.enabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
              config?.enabled ? 'bg-blue-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                config?.enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* 上次執行狀態 */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs">
          <p className="font-medium text-gray-700 mb-1">上次執行狀態</p>
          <p className={statusColor[config?.last_import_status ?? 'never'] ?? 'text-gray-400'}>
            {statusLabel[config?.last_import_status ?? 'never'] ?? config?.last_import_status}
          </p>
          {config?.last_import_at && (
            <p className="text-gray-400 mt-0.5">
              {new Date(config.last_import_at).toLocaleString('zh-TW')}
            </p>
          )}
          {config?.last_import_rows != null && (
            <p className="text-gray-500 mt-0.5">匯入 {config.last_import_rows.toLocaleString()} 筆</p>
          )}
          {config?.last_error && (
            <p className="text-red-500 mt-1 break-all">{config.last_error}</p>
          )}
        </div>

        {/* 手動觸發 */}
        <button
          type="button"
          onClick={onTrigger}
          disabled={triggering}
          className="flex items-center justify-center rounded-lg border border-blue-500 py-2 text-sm text-blue-600 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {triggering ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />執行中…</>
          ) : (
            '立即執行一次'
          )}
        </button>
      </div>

      {!config?.configured && !isAdmin && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
          尚未設定自動匯入目錄。請聯絡管理員（admin）進行設定。
        </div>
      )}
    </div>
  )
}
