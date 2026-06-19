/**
 * Doc Analyst Agent UI（agent_id = doc-analyst）
 * 以文件為錨點，每輪對話都帶入完整文件 context，適合深度分析標案、合約等長文件。
 * 左欄：對話歷史清單 + 新文件上傳；右欄：對話
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, FileSearch, Loader2, Plus, Trash2, Upload } from 'lucide-react'
import NsChat, { type NsChatMessage } from '@/components/NsChat'
import AgentHeader from '@/components/AgentHeader'
import LLMModelSelect from '@/components/LLMModelSelect'
import ErrorModal from '@/components/ErrorModal'
import HelpModal from '@/components/HelpModal'
import {
  appendChatMessage,
  deleteChatThread,
  listChatMessages,
  listChatThreads,
  type ChatMessageItem,
  type ChatThreadItem,
} from '@/api/chatThreads'
import { chatCompletionsStream, docAnalystUpload, docAnalystInitText } from '@/api/chat'
import { ApiError } from '@/api/client'
import type { Agent } from '@/types'

interface Props { agent: Agent }

const STREAMING_MSG_ID = '__doc_analyst_streaming__'
const HISTORY_ROUNDS = 20
const HEADER_COLOR = '#1A3A52'
const LS_INIT_KEY = 'ns_doc_analyst_init'
const SESSION_THREAD_KEY = 'doc-analyst-active-thread'
const AUTO_INTRO_PROMPT =
  '請嚴格依照以下格式回答，不要加入其他說明或前言：\n\n[SUMMARY]\n（用 2-3 句話介紹此文件的主題與重點）\n\n[QUESTIONS]\nQ: （第一個最有助於深入分析此文件的問題）\nQ: （第二個問題）\nQ: （第三個問題）'

/** 取 [SUMMARY] 段（去掉 [QUESTIONS] 以後的部分與標籤本身） */
function extractSummary(content: string): string {
  const qIdx = content.search(/\[QUESTIONS\]/i)
  const raw = qIdx >= 0 ? content.slice(0, qIdx) : content
  return raw.replace(/^\[SUMMARY\]\s*/i, '').trim()
}

/** 從 [QUESTIONS] 段解析 Q: 問題 */
function parseQuestions(content: string): string[] {
  const qIdx = content.search(/\[QUESTIONS\]/i)
  const section = qIdx >= 0 ? content.slice(qIdx) : content
  return section
    .split('\n')
    .filter((l) => /^Q[:：]\s*/i.test(l.trim()))
    .map((l) => l.trim().replace(/^Q[:：]\s*/i, '').trim())
    .filter(Boolean)
    .slice(0, 3)
}

interface DocInfo {
  threadId: string
  filename: string       // 顯示標題
  filenames?: string[]   // 各檔名（多檔時使用）
  charCount?: number
}

function mapRows(rows: ChatMessageItem[]): NsChatMessage[] {
  return rows
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .map((r) => {
      const meta =
        r.role === 'assistant' && r.llm_meta?.model
          ? {
              model: r.llm_meta.model ?? '',
              usage:
                r.llm_meta.prompt_tokens != null
                  ? {
                      prompt_tokens: r.llm_meta.prompt_tokens ?? 0,
                      completion_tokens: r.llm_meta.completion_tokens ?? 0,
                      total_tokens: r.llm_meta.total_tokens ?? 0,
                    }
                  : null,
              finish_reason: null,
            }
          : undefined
      return {
        id: r.id,
        role: r.role as 'user' | 'assistant',
        content: r.content,
        meta,
      }
    })
}

function threadLabel(t: ChatThreadItem): string {
  return (t.title || '未命名文件').replace(/\.(pdf|md)$/i, '')
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return `${diffDays} 天前`
  return d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })
}

export default function AgentDocAnalystUI({ agent }: Props) {
  const [model, setModel] = useState('')
  const storageKey = `doc-analyst-model-${agent.id}`

  // ── Thread list ─────────────────────────────────────────────────────────────
  const [threads, setThreads] = useState<ChatThreadItem[]>([])
  const [threadsLoading, setThreadsLoading] = useState(true)
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [_docInfo, setDocInfo] = useState<DocInfo | null>(null)

  // ── Messages ─────────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<NsChatMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  // ── Upload ───────────────────────────────────────────────────────────────────
  const [uploading, setUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── UI ───────────────────────────────────────────────────────────────────────
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [errorModal, setErrorModal] = useState<{ title: string; message: string } | null>(null)
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([])
  const [helpOpen, setHelpOpen] = useState(false)
  const initFiredRef = useRef(false)
  const autoIntroFiredRef = useRef<Set<string>>(new Set())
  const pendingAutoIntroRef = useRef(false)

  // 讀取 model 偏好
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved) as { model?: string }
        if (parsed.model) setModel(parsed.model)
      }
    } catch { /* ignore */ }
  }, [storageKey])

  const persistModel = useCallback((m: string) => {
    setModel(m)
    try { localStorage.setItem(storageKey, JSON.stringify({ model: m })) } catch { /* ignore */ }
  }, [storageKey])

  // 載入 thread 清單
  const loadThreads = useCallback(async () => {
    try {
      const list = await listChatThreads(agent.id)
      setThreads(list)
      return list
    } catch {
      return []
    } finally {
      setThreadsLoading(false)
    }
  }, [agent.id])

  useEffect(() => {
    loadThreads().then((list) => {
      // 嘗試恢復上次選取的 thread
      try {
        const saved = sessionStorage.getItem(`${SESSION_THREAD_KEY}-${agent.id}`)
        if (saved && list.some((t) => t.id === saved)) {
          setSelectedThreadId(saved)
          return
        }
      } catch { /* ignore */ }
      // 預設選第一個
      if (list.length > 0) setSelectedThreadId(list[0].id)
    })
  }, [loadThreads, agent.id])

  // mount 時：讀 Doc Parse 傳來的初始文件
  useEffect(() => {
    if (initFiredRef.current) return
    let raw: string | null = null
    try { raw = localStorage.getItem(LS_INIT_KEY) } catch { /* ignore */ }
    if (!raw) return
    initFiredRef.current = true
    try { localStorage.removeItem(LS_INIT_KEY) } catch { /* ignore */ }
    let parsed: { text?: string; filename?: string } | null = null
    try { parsed = JSON.parse(raw) as { text?: string; filename?: string } } catch { /* ignore */ }
    if (!parsed?.text) return

    const { text, filename = 'document' } = parsed
    setUploading(true)
    docAnalystInitText(text, filename)
      .then(async (res) => {
        await loadThreads()
        selectThread({ id: res.thread_id, title: res.filename } as ChatThreadItem, res.char_count, res.filenames)
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : '初始化失敗'
        setErrorModal({ title: '載入文件失敗', message: msg })
      })
      .finally(() => setUploading(false))
  }, [loadThreads]) // eslint-disable-line react-hooks/exhaustive-deps

  // 切換 thread → 載入訊息
  useEffect(() => {
    setSuggestedQuestions([])
    if (!selectedThreadId) {
      setMessages([])
      setDocInfo(null)
      setMessagesLoading(false)
      return
    }
    const thread = threads.find((t) => t.id === selectedThreadId)
    if (thread) {
      setDocInfo({ threadId: thread.id, filename: thread.title || '未命名文件' })
    }
    setMessagesLoading(true)
    let cancelled = false
    listChatMessages(selectedThreadId)
      .then((rows) => { if (!cancelled) setMessages(mapRows(rows)) })
      .catch(() => { if (!cancelled) setMessages([]) })
      .finally(() => { if (!cancelled) setMessagesLoading(false) })
    return () => { cancelled = true }
  }, [selectedThreadId, threads])

  // 儲存選取狀態
  useEffect(() => {
    if (!selectedThreadId) return
    try { sessionStorage.setItem(`${SESSION_THREAD_KEY}-${agent.id}`, selectedThreadId) } catch { /* ignore */ }
  }, [selectedThreadId, agent.id])

  function selectThread(t: Pick<ChatThreadItem, 'id' | 'title'>, charCount?: number, filenames?: string[]) {
    setSelectedThreadId(t.id)
    setDocInfo({ threadId: t.id, filename: t.title || '未命名文件', charCount, filenames })
  }

  // ── 上傳文件 ─────────────────────────────────────────────────────────────────
  function isSupportedFile(file: File): boolean {
    const name = file.name.toLowerCase()
    return name.endsWith('.pdf') || name.endsWith('.md') || file.type === 'application/pdf'
  }

  async function handleUpload(files: File[]) {
    const valid = files.filter(isSupportedFile)
    if (!valid.length) {
      setErrorModal({ title: '格式錯誤', message: '僅支援 PDF 或 Markdown（.md）格式' })
      return
    }
    setUploading(true)
    try {
      const res = await docAnalystUpload(valid)
      await loadThreads()
      selectThread(
        { id: res.thread_id, title: res.filename },
        res.char_count,
        res.filenames,
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : '上傳失敗'
      setErrorModal({ title: '上傳失敗', message: msg })
    } finally {
      setUploading(false)
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length) handleUpload(files)
    e.target.value = ''
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length) handleUpload(files)
  }

  // ── 刪除 thread ──────────────────────────────────────────────────────────────
  async function handleDelete(e: React.MouseEvent, tid: string) {
    e.stopPropagation()
    if (!window.confirm('確定刪除此對話？')) return
    try {
      await deleteChatThread(tid)
      setThreads((prev) => prev.filter((t) => t.id !== tid))
      if (selectedThreadId === tid) {
        setSelectedThreadId(null)
        setMessages([])
        setDocInfo(null)
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.detail ?? err.message : '刪除失敗'
      setErrorModal({ title: '刪除失敗', message: msg ?? '未知錯誤' })
    }
  }

  // ── 送出訊息 ─────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async (text: string) => {
    const content = text.trim()
    if (!content || isLoading || !model.trim() || !selectedThreadId) return

    setSuggestedQuestions([])
    const isAutoIntro = pendingAutoIntroRef.current
    pendingAutoIntroRef.current = false

    const threadId = selectedThreadId
    setIsLoading(true)
    try {
      let userMsgId = ''
      let prior: { role: 'user' | 'assistant'; content: string }[] = []

      if (isAutoIntro) {
        // auto-intro：不儲存 user 訊息，不顯示 prompt，直接用空歷史叫 LLM
        prior = []
      } else {
        const userRow = await appendChatMessage(threadId, { role: 'user', content })
        userMsgId = userRow.id
        const rowsAfterUser = await listChatMessages(threadId)
        setMessages(mapRows(rowsAfterUser))
        setThreads((prev) =>
          prev.map((t) =>
            t.id === threadId ? { ...t, last_message_at: new Date().toISOString() } : t
          )
        )
        const hist = rowsAfterUser
          .filter((r) => r.role === 'user' || r.role === 'assistant')
          .map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content }))
        if (!hist.length || hist[hist.length - 1].role !== 'user') return
        prior = hist.slice(0, -1).slice(-(HISTORY_ROUNDS * 2))
      }

      const traceId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '', id: STREAMING_MSG_ID, streaming: true },
      ])

      // 用本地變數追蹤完整 streaming 內容（含 [QUESTIONS] 段），供 onDone 解析
      let fullStreamContent = ''

      await chatCompletionsStream(
        {
          agent_id: agent.id,
          prompt_type: 'doc-analyst',
          chat_thread_id: threadId,
          trace_id: traceId,
          user_message_id: userMsgId,
          system_prompt: '',
          user_prompt: '',
          data: '',
          model,
          messages: prior,
          content,
        },
        {
          onDelta: (delta) => {
            fullStreamContent += delta
            setMessages((prev) => {
              const next = [...prev]
              const idx = next.findIndex((m) => m.id === STREAMING_MSG_ID)
              if (idx < 0) return prev
              const cur = next[idx]!
              // auto-intro 時只顯示摘要段，隱藏 [QUESTIONS] 區塊
              const display = isAutoIntro ? extractSummary(fullStreamContent) : fullStreamContent
              next[idx] = { ...cur, content: display, streaming: true }
              return next
            })
          },
          onDone: async (done) => {
            try {
              // auto-intro：只存摘要到 DB；問題只作為 chips
              const rawContent = done.content ?? fullStreamContent ?? ''
              const saveContent = isAutoIntro ? extractSummary(rawContent) : rawContent
              await appendChatMessage(threadId, {
                role: 'assistant',
                content: saveContent,
                ...(done.llm_request_id ? { llm_request_id: done.llm_request_id } : {}),
              })
              const finalRows = await listChatMessages(threadId)
              setMessages(
                mapRows(finalRows).map((m, i, arr) => {
                  if (m.role !== 'assistant' || i !== arr.length - 1) return m
                  return {
                    ...m,
                    meta: {
                      model: done.model ?? m.meta?.model ?? '',
                      usage: done.usage ?? m.meta?.usage ?? null,
                      finish_reason: done.finish_reason ?? null,
                    },
                  }
                })
              )
              if (isAutoIntro && rawContent) {
                const qs = parseQuestions(rawContent)
                if (qs.length > 0) setSuggestedQuestions(qs)
              }
            } catch (e) {
              setMessages((prev) => prev.filter((m) => m.id !== STREAMING_MSG_ID))
              const msg = e instanceof ApiError ? e.detail ?? e.message : e instanceof Error ? e.message : '儲存失敗'
              setErrorModal({ title: '儲存助理訊息失敗', message: msg ?? '未知錯誤' })
            }
          },
          onError: async (message) => {
            const safe = typeof message === 'string' && message.trim() ? message.trim() : '未知錯誤，請稍後再試。'
            setMessages((prev) => prev.filter((m) => m.id !== STREAMING_MSG_ID))
            try {
              await appendChatMessage(threadId, { role: 'assistant', content: `錯誤：${safe}` })
              const finalRows = await listChatMessages(threadId)
              setMessages(mapRows(finalRows))
            } catch { /* ignore */ }
          },
        }
      )
    } finally {
      setIsLoading(false)
    }
  }, [agent.id, isLoading, model, selectedThreadId])

  // 新 thread 無訊息時自動送出簡介 prompt（放在 handleSubmit 定義之後）
  useEffect(() => {
    if (!selectedThreadId || messagesLoading || messages.length > 0) return
    if (!model.trim()) return
    if (autoIntroFiredRef.current.has(selectedThreadId)) return
    autoIntroFiredRef.current.add(selectedThreadId)
    pendingAutoIntroRef.current = true
    handleSubmit(AUTO_INTRO_PROMPT)
  }, [selectedThreadId, messagesLoading, messages.length, model, handleSubmit])

  // ── Render ───────────────────────────────────────────────────────────────────
  const ext = (filename: string) => filename.toLowerCase().endsWith('.md') ? 'MD' : 'PDF'

  return (
    <div className="relative flex h-full flex-col p-4 text-[18px]">
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} url="/help-doc-analyst.md" title="Doc Analyst 使用說明" />
      <AgentHeader agent={agent} headerBackgroundColor={HEADER_COLOR} onOnlineHelpClick={() => setHelpOpen(true)} />

      <div className="mt-4 flex min-h-0 flex-1 gap-3 overflow-hidden">

        {/* ── 左欄 Sidebar ── */}
        <div
          className={`flex shrink-0 flex-col overflow-hidden rounded-xl shadow-md transition-[width] duration-200 ${
            sidebarCollapsed ? 'w-12' : 'w-96'
          }`}
          style={{ backgroundColor: HEADER_COLOR }}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
        >
          {/* Header：上傳按鈕 + 折疊按鈕 */}
          <div className={`shrink-0 flex items-center border-b border-white/20 py-2.5 gap-2 ${sidebarCollapsed ? 'px-2 justify-center' : 'pl-3 pr-2'}`}>
            {sidebarCollapsed ? (
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="flex w-full items-center justify-center rounded-lg p-1.5 text-white/70 hover:bg-white/10"
                title="展開"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            ) : (
              <>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-white/15 px-3 py-2 text-base font-medium text-white hover:bg-white/25 disabled:opacity-50 transition-colors"
                >
                  {uploading
                    ? <><Loader2 className="h-4 w-4 animate-spin" />萃取中...</>
                    : <><Plus className="h-4 w-4" />上傳新文件</>
                  }
                </button>
                <button
                  onClick={() => setSidebarCollapsed(true)}
                  className="shrink-0 rounded-lg px-1.5 py-1 text-white/50 hover:bg-white/10 hover:text-white"
                  title="折疊"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.md,application/pdf,text/markdown"
              multiple
              className="hidden"
              onChange={onFileChange}
            />
          </div>

          {/* Thread 清單 */}
          <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto py-2 px-1.5">
            {isDragging && !sidebarCollapsed && (
              <div className="mx-1 mb-1 flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-white/40 bg-white/10 p-4 text-center">
                <Upload className="h-5 w-5 text-white/60" />
                <p className="text-sm text-white/70">放開以上傳</p>
              </div>
            )}
            {threadsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-white/40" />
              </div>
            ) : threads.length === 0 && !sidebarCollapsed ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <FileSearch className="h-8 w-8 text-white/30" />
                <p className="text-base text-white/50">尚無分析記錄</p>
                <p className="text-sm text-white/30">上傳文件即可開始</p>
              </div>
            ) : (
              threads.map((t) => (
                <button
                  key={t.id}
                  onClick={() => selectThread(t)}
                  title={sidebarCollapsed ? threadLabel(t) : undefined}
                  className={`group flex w-full items-start gap-2 rounded-lg px-2 py-2.5 text-left transition-colors ${
                    selectedThreadId === t.id
                      ? 'bg-sky-500/30 text-white'
                      : 'text-white/65 hover:bg-white/10 hover:text-white'
                  } ${sidebarCollapsed ? 'justify-center' : ''}`}
                >
                  <span className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-bold ${
                    selectedThreadId === t.id ? 'bg-white/20 text-white' : 'bg-white/10 text-white/50'
                  } ${sidebarCollapsed ? '' : 'mt-0.5'}`}>
                    {ext(t.title || '')}
                  </span>
                  {!sidebarCollapsed && (
                    <>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base font-medium leading-tight">
                          {threadLabel(t)}
                        </p>
                        <p className={`text-sm ${selectedThreadId === t.id ? 'text-white/60' : 'text-white/35'}`}>
                          {formatRelativeTime(t.last_message_at ?? t.created_at)}
                        </p>
                      </div>
                      <button
                        onClick={(e) => handleDelete(e, t.id)}
                        className="mt-0.5 shrink-0 rounded p-1 opacity-0 group-hover:opacity-100 hover:bg-white/10 text-white/40 hover:text-white/80"
                        title="刪除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </button>
              ))
            )}
          </nav>

          {/* 底部：model */}
          {!sidebarCollapsed && (
            <div className="shrink-0 border-t border-white/20 px-2.5 py-3">
              <p className="mb-1.5 text-sm font-medium text-white/50">模型</p>
              <LLMModelSelect
                value={model}
                onChange={persistModel}
                label=""
                compact
                selectClassName="w-full rounded-lg border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white focus:border-white/40 focus:outline-none"
              />
            </div>
          )}
        </div>

        {/* ── 右欄：對話 ── */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 shadow-sm bg-white">
          {messagesLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <NsChat
              messages={messages}
              onSubmit={handleSubmit}
              isLoading={isLoading}
              embedded
              emptyPlaceholder={
                !selectedThreadId
                  ? '請先上傳文件或選取左側記錄'
                  : '輸入問題，例如：請摘要本文件的重點...'
              }
              submitDisabled={!selectedThreadId || !model.trim() || uploading || messagesLoading}
              submitDisabledTitle={
                !model.trim()
                  ? '請先選擇 LLM 模型'
                  : !selectedThreadId
                    ? '請先上傳文件'
                    : undefined
              }
              loadingLabel="分析中"
              appendContent={
                suggestedQuestions.length > 0 && !isLoading ? (
                  <div className="flex flex-wrap gap-2">
                    {suggestedQuestions.map((q, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleSubmit(q)}
                        className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-base text-sky-700 hover:bg-sky-100 transition-colors text-left"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                ) : null
              }
            />
          )}
        </div>
      </div>

      {errorModal && (
        <ErrorModal
          open
          title={errorModal.title}
          message={errorModal.message}
          onClose={() => setErrorModal(null)}
        />
      )}
    </div>
  )
}
