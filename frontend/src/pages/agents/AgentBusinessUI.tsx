/** agent_id 含 business 時使用：商務型 agent 專用 UI */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronsLeft, ChevronsRight, HelpCircle, RefreshCw } from 'lucide-react'
import { Group, Panel, PanelImperativeHandle, Separator } from 'react-resizable-panels'
import { chatCompletions } from '@/api/chat'
import { ApiError } from '@/api/client'
import {
  createPromptTemplate,
  deletePromptTemplate,
  listPromptTemplates,
  updatePromptTemplate,
  type PromptTemplateItem,
} from '@/api/promptTemplates'
import AgentChat, { type Message, type ResponseMeta } from '@/components/AgentChat'
import AgentHeader from '@/components/AgentHeader'
import ConfirmModal from '@/components/ConfirmModal'
import HelpModal from '@/components/HelpModal'
import SourceFileManager from '@/components/SourceFileManager'
import type { Agent } from '@/types'

interface AgentBusinessUIProps {
  agent: Agent
}

const STORAGE_KEY_PREFIX = 'agent-business-ui'

interface StoredState {
  messages: Message[]
  userPrompt: string
  model: string
  role: string
  language: string
  detailLevel: string
  selectedTemplateId: number | null
}

function loadStored(agentId: string): Partial<StoredState> | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}-${agentId}`)
    if (!raw) return null
    return JSON.parse(raw) as Partial<StoredState>
  } catch {
    return null
  }
}

function saveStored(agentId: string, state: StoredState) {
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}-${agentId}`, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

const MODEL_OPTIONS = [
  { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
  { value: 'gpt-4o', label: 'gpt-4o' },
  { value: 'gemini/gemini-2.0-flash', label: 'gemini-2.0-flash' },
  { value: 'gemini/gemini-2.5-flash', label: 'gemini-2.5-flash' },
  { value: 'gemini/gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite' },
  { value: 'gemini/gemini-1.5-pro', label: 'gemini-1.5-pro' },
  { value: 'gemini/gemini-pro', label: 'gemini-pro' },
  { value: 'twcc/Llama3.1-FFM-8B-32K', label: '台智雲 Llama3.1-FFM-8B' },
] as const

const ROLE_OPTIONS = [
  { value: 'manager', label: '管理者', prompt: '以管理者的角度來分析。' },
  { value: 'boss', label: '老闆', prompt: '以老闆的角度來分析。' },
  { value: 'employee', label: '員工', prompt: '以員工的角度來分析。' },
] as const

const LANGUAGE_OPTIONS = [
  { value: 'zh-TW', label: '繁中', prompt: '請用繁體中文回覆。' },
  { value: 'en', label: '英文', prompt: 'Please respond in English.' },
] as const

const DETAIL_OPTIONS = [
  { value: 'brief', label: '簡要', prompt: '請簡要回答（3–5 點重點）。' },
  { value: 'standard', label: '標準', prompt: '請以標準詳細程度回答。' },
  { value: 'detailed', label: '詳細', prompt: '請詳細分析，包含數據與推論。' },
] as const

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

export default function AgentBusinessUI({ agent }: AgentBusinessUIProps) {
  const sourcePanelRef = useRef<PanelImperativeHandle>(null)
  const aiPanelRef = useRef<PanelImperativeHandle>(null)
  const [model, setModel] = useState(() => loadStored(agent.id)?.model ?? 'gpt-4o-mini')
  const [userPrompt, setUserPrompt] = useState(() => loadStored(agent.id)?.userPrompt ?? '')
  const [role, setRole] = useState(() => loadStored(agent.id)?.role ?? 'manager')
  const [language, setLanguage] = useState(() => loadStored(agent.id)?.language ?? 'zh-TW')
  const [detailLevel, setDetailLevel] = useState(() => loadStored(agent.id)?.detailLevel ?? 'brief')
  const [messages, setMessages] = useState<Message[]>(() => loadStored(agent.id)?.messages ?? [])
  const [isLoading, setIsLoading] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [templates, setTemplates] = useState<PromptTemplateItem[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(
    () => loadStored(agent.id)?.selectedTemplateId ?? null
  )
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false)
  const [saveTemplateName, setSaveTemplateName] = useState('')
  const [showDeleteTemplateConfirm, setShowDeleteTemplateConfirm] = useState(false)

  const fetchTemplates = useCallback(async () => {
    setTemplatesLoading(true)
    try {
      const list = await listPromptTemplates(agent.id)
      setTemplates(list)
    } catch {
      setTemplates([])
    } finally {
      setTemplatesLoading(false)
    }
  }, [agent.id])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  useEffect(() => {
    if (templates.length === 0) return
    if (selectedTemplateId != null && !templates.some((t) => t.id === selectedTemplateId)) {
      setSelectedTemplateId(null)
    }
  }, [templates, selectedTemplateId])

  useEffect(() => {
    if (!toastMessage) return
    const id = setTimeout(() => setToastMessage(null), 2000)
    return () => clearTimeout(id)
  }, [toastMessage])

  useEffect(() => {
    saveStored(agent.id, {
      messages,
      userPrompt,
      model,
      role,
      language,
      detailLevel,
      selectedTemplateId,
    })
  }, [agent.id, messages, userPrompt, model, role, language, detailLevel, selectedTemplateId])

  function buildUserPrompt(): string {
    const parts: string[] = []
    const roleOpt = ROLE_OPTIONS.find((o) => o.value === role)
    const langOpt = LANGUAGE_OPTIONS.find((o) => o.value === language)
    const detailOpt = DETAIL_OPTIONS.find((o) => o.value === detailLevel)
    if (roleOpt) parts.push(roleOpt.prompt)
    if (langOpt) parts.push(langOpt.prompt)
    if (detailOpt) parts.push(detailOpt.prompt)
    if (userPrompt.trim()) parts.push(userPrompt.trim())
    return parts.join(' ')
  }

  async function handleSendMessage(text: string) {
    if (!text || isLoading) return

    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setIsLoading(true)

    try {
      const res = await chatCompletions({
        agent_id: agent.id,
        system_prompt: '',
        user_prompt: buildUserPrompt(),
        data: '',
        model,
        messages: [],
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

  function handleSelectTemplate(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value
    if (val === '') {
      setSelectedTemplateId(null)
      return
    }
    const id = Number(val)
    const t = templates.find((x) => x.id === id)
    if (t) {
      setSelectedTemplateId(id)
      setUserPrompt(t.content)
    }
  }

  async function handleSaveAsTemplate() {
    const name = saveTemplateName.trim()
    if (!name) {
      setToastMessage('請輸入範本名稱')
      return
    }
    try {
      await createPromptTemplate(agent.id, name, userPrompt)
      setToastMessage('已儲存範本')
      setShowSaveTemplateModal(false)
      setSaveTemplateName('')
      fetchTemplates()
    } catch (err) {
      const msg = err instanceof ApiError ? err.detail ?? err.message : '儲存失敗'
      setToastMessage(String(msg))
    }
  }

  async function handleUpdateTemplate() {
    if (selectedTemplateId == null) return
    try {
      await updatePromptTemplate(selectedTemplateId, { content: userPrompt })
      setToastMessage('已更新範本')
      fetchTemplates()
    } catch (err) {
      const msg = err instanceof ApiError ? err.detail ?? err.message : '更新失敗'
      setToastMessage(String(msg))
    }
  }

  async function handleDeleteTemplate() {
    if (selectedTemplateId == null) return
    try {
      await deletePromptTemplate(selectedTemplateId)
      setToastMessage('已刪除範本')
      setSelectedTemplateId(null)
      setShowDeleteTemplateConfirm(false)
      fetchTemplates()
    } catch (err) {
      const msg = err instanceof ApiError ? err.detail ?? err.message : '刪除失敗'
      setToastMessage(String(msg))
    }
  }

  const selectedTemplate = selectedTemplateId != null
    ? templates.find((t) => t.id === selectedTemplateId)
    : null

  return (
    <div className="relative flex h-full flex-col p-4 text-[18px]">
      {toastMessage && (
        <div
          className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-gray-800 px-4 py-2 text-[18px] text-white shadow-lg"
          role="status"
        >
          {toastMessage}
        </div>
      )}

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
        open={showDeleteTemplateConfirm}
        title="確認刪除"
        message={`確定要刪除範本「${selectedTemplate?.name ?? ''}」嗎？`}
        confirmText="刪除"
        onConfirm={handleDeleteTemplate}
        onCancel={() => setShowDeleteTemplateConfirm(false)}
      />
      {showSaveTemplateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => setShowSaveTemplateModal(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="relative z-10 min-w-[320px] rounded-2xl border-2 border-gray-200 bg-white p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 font-semibold text-gray-800">儲存為範本</h2>
            <input
              type="text"
              value={saveTemplateName}
              onChange={(e) => setSaveTemplateName(e.target.value)}
              placeholder="輸入範本名稱"
              className="mb-6 w-full rounded-lg border border-gray-300 px-3 py-2 text-[18px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSaveTemplateModal(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveAsTemplate}
                className="rounded-lg px-4 py-2 text-white hover:opacity-90"
                style={{ backgroundColor: '#4b5563' }}
              >
                儲存
              </button>
            </div>
          </div>
        </div>
      )}
      <HelpModal
        open={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        url="/help-sourcefile.md"
      />
      <AgentHeader agent={agent} />

      {/* 左、中、右三欄可拖曳調整大小的獨立容器 */}
      <Group orientation="horizontal" className="mt-4 flex min-h-0 flex-1 gap-1">
        <Panel
          panelRef={sourcePanelRef}
          collapsible
          collapsedSize="250px"
          defaultSize={25}
          minSize="250px"
          className="flex flex-col rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50"
        >
          <header className="flex flex-shrink-0 items-center justify-between rounded-t-xl border-b border-slate-200 bg-slate-100 px-4 py-3 font-semibold text-slate-800 shadow-sm">
            <div className="flex items-center gap-1">
              <span>來源</span>
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
              onClick={() => sourcePanelRef.current?.collapse()}
              className="rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-200"
              aria-label="折疊"
            >
              <ChevronsLeft className="h-5 w-5" />
            </button>
          </header>
          <SourceFileManager agentId={agent.id} />
        </Panel>
        <ResizeHandle />
        <Panel
          defaultSize={50}
          minSize="600px"
          className="flex flex-col rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50"
        >
          <AgentChat
            messages={messages}
            onSubmit={handleSendMessage}
            isLoading={isLoading}
            onCopySuccess={() => setToastMessage('已複製到剪貼簿')}
            onCopyError={() => setToastMessage('複製失敗')}
            headerActions={
              <button
                type="button"
                onClick={() => messages.length > 0 && setShowClearConfirm(true)}
                disabled={isLoading || messages.length === 0}
                className="rounded-lg border border-gray-300 bg-white p-2 text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                aria-label="清除對話"
              >
                <RefreshCw className="h-5 w-5" />
              </button>
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
            <span>AI 設定區</span>
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
            {/* 基本設定 */}
            <div className="shrink-0">
              <h3 className="mb-2 text-[14px] font-semibold uppercase tracking-wide text-blue-600">
                基本設定
              </h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div className="flex items-center gap-2">
                  <label className="shrink-0 text-[16px] font-medium text-gray-700">模型</label>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[16px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
                  >
                    {MODEL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="shrink-0 text-[16px] font-medium text-gray-700">角色</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[16px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
                  >
                    {ROLE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="shrink-0 text-[16px] font-medium text-gray-700">語言</label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[16px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
                  >
                    {LANGUAGE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="shrink-0 text-[16px] font-medium text-gray-700">詳略</label>
                  <select
                    value={detailLevel}
                    onChange={(e) => setDetailLevel(e.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[16px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
                  >
                    {DETAIL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="shrink-0 border-t border-gray-200" />

            {/* 進階設定 */}
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <h3 className="shrink-0 text-[14px] font-semibold uppercase tracking-wide text-blue-600">
                進階設定
              </h3>
              <div className="flex min-w-0 shrink-0 w-full items-center gap-2">
                <label className="shrink-0 text-[16px] font-medium text-gray-700">範本</label>
                <select
                  value={selectedTemplateId ?? ''}
                  onChange={handleSelectTemplate}
                  disabled={templatesLoading}
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[16px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:opacity-50"
                >
                  <option value="">無</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSaveTemplateName('')
                    setShowSaveTemplateModal(true)
                  }}
                  className="shrink-0 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[14px] text-gray-700 hover:bg-gray-50"
                >
                  儲存到範本
                </button>
                <button
                  type="button"
                  onClick={handleUpdateTemplate}
                  disabled={selectedTemplateId == null}
                  className="shrink-0 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[14px] text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  更新
                </button>
                <button
                  type="button"
                  onClick={() => selectedTemplateId != null && setShowDeleteTemplateConfirm(true)}
                  disabled={selectedTemplateId == null}
                  className="shrink-0 rounded-lg border border-red-200 bg-white px-2 py-1.5 text-[14px] text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  刪除
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <textarea
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                  placeholder="User Prompt（選填），如格式、資料辭典等"
                  className="h-full min-h-[80px] w-full resize-y rounded-lg border border-gray-300 bg-white p-2 text-[16px] text-gray-800 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
                />
              </div>
            </div>
          </div>
        </Panel>
      </Group>
    </div>
  )
}
