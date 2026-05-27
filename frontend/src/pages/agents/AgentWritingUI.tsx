/** Writing Agent UI：左欄文件列表 + 中欄設定 + 右欄 TipTap 編輯器 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import { BubbleMenuPlugin } from '@tiptap/extension-bubble-menu'
import StarterKit from '@tiptap/starter-kit'
import { marked } from 'marked'
import {
  Bold, ClipboardCopy, FileText, Heading2, Italic, List, ListOrdered,
  Loader2, Maximize2, Minimize2, Pencil, Plus, RotateCcw, Save, Search, Sparkles, Trash2, Undo2, X, Zap,
} from 'lucide-react'
import AgentHeader from '@/components/AgentHeader'
import LLMModelSelect from '@/components/LLMModelSelect'
import ErrorModal from '@/components/ErrorModal'
import HelpModal from '@/components/HelpModal'
import InputModal from '@/components/InputModal'
import { chatCompletionsStream } from '@/api/chat'
import { createChatThread } from '@/api/chatThreads'
import {
  listWritingDocs, createWritingDoc, updateWritingDoc, deleteWritingDoc,
  type WritingDoc,
} from '@/api/writing'
import { listLlmSkills, type LlmSkill } from '@/api/llmSkills'
import type { Agent } from '@/types'

const HEADER_COLOR = '#1C3939'
const STORAGE_KEY = 'agent-writing-ui-model'
const LAST_DOC_KEY = 'agent-writing-ui-last-doc'
const CONTENT_MAX = 10_000
const PROMPT_MAX = 2_000

// ── 指令範本 ──────────────────────────────────────────────────────────────────

interface PromptTemplate {
  label: string
  prompt: string
}

const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    label: '商業 Email',
    prompt: `請根據以上內容，寫一封商業 Email，格式如下：主旨、稱呼、內文、結尾敬語、署名。
目的：（例：拜訪感謝、報價跟進、會議邀請）
語氣：友善
其他要求：`,
  },
  {
    label: '工作報告',
    prompt: `請根據以上內容，整理成一份工作報告，格式如下：標題、摘要、主要發現／數據、結論與建議。
報告主題：
受眾：主管
其他要求：`,
  },
  {
    label: '會議摘要',
    prompt: `請根據以上內容，整理成一份會議摘要，格式如下：會議主題、日期、與會者、討論重點（條列）、決議事項（條列）、行動項目（負責人＋期限）。
會議主題：
其他要求：`,
  },
  {
    label: '提案簡介',
    prompt: `請根據以上內容，寫一份提案簡介，格式如下：標題、客戶痛點、解決方案、核心優勢、結語。
目標客戶：
其他要求：`,
  },
  {
    label: '內部公告',
    prompt: `請根據以上內容，寫一份內部公告，格式如下：標題、公告對象、公告內容、生效日期（如適用）、聯絡窗口。
公告對象：全體同仁
其他要求：`,
  },
  {
    label: 'FAQ 生成',
    prompt: `請將以上內容轉換成一組 Q&A，每個問題對應一個完整答案。格式如下：

Q：（問題標題）
A：（答案內容）

規則：
- 答案須忠實呈現原始內容，不得自行增加或刪減步驟與資訊
- 每個 Q&A 為獨立完整的一組，可直接使用
- 問題數量：
- 問題：`,
  },
]

// ── Skill Picker Modal ────────────────────────────────────────────────────────

interface SkillPickerModalProps {
  skills: LlmSkill[]
  onApply: (skill: LlmSkill) => void
  onClose: () => void
}

function SkillPickerModal({ skills, onApply, onClose }: SkillPickerModalProps) {
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState<string>('全部')
  const [previewSkill, setPreviewSkill] = useState<LlmSkill | null>(null)

  // 分類列表
  const categories = ['全部', ...Array.from(new Set(
    skills.map((s) => s.category?.trim() || '未分類')
  )).sort((a, b) => {
    if (a === '未分類') return 1
    if (b === '未分類') return -1
    return a.localeCompare(b, 'zh-TW')
  })]

  // 過濾
  const filtered = skills.filter((s) => {
    const matchCat = catFilter === '全部' || (s.category?.trim() || '未分類') === catFilter
    const q = search.trim().toLowerCase()
    const matchSearch = !q || s.title.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q)
    return matchCat && matchSearch
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative z-10 flex h-[72vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 預覽 sub-modal */}
        {previewSkill && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30">
            <div
              className="relative flex w-[90%] max-w-lg flex-col rounded-2xl bg-white shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-teal-600" />
                  <span className="font-semibold text-gray-800">{previewSkill.title}</span>
                  {previewSkill.category && (
                    <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
                      {previewSkill.category}
                    </span>
                  )}
                </div>
                <button type="button" onClick={() => setPreviewSkill(null)}
                  className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="overflow-y-auto px-5 py-4">
                <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700">{previewSkill.prompt}</pre>
              </div>
              <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
                <button type="button" onClick={() => setPreviewSkill(null)}
                  className="rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                  取消
                </button>
                <button type="button" onClick={() => { onApply(previewSkill); setPreviewSkill(null) }}
                  className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800">
                  套用
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-teal-600" />
            <h2 className="text-base font-semibold text-gray-800">Skill 庫</h2>
          </div>
          <button type="button" onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 搜尋 */}
        <div className="border-b border-gray-100 px-4 py-3">
          <div className="flex items-center gap-2 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-gray-400" />
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜尋名稱或說明…"
              className="flex-1 bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')}>
                <X className="h-4 w-4 text-gray-400 hover:text-gray-600" />
              </button>
            )}
          </div>
        </div>

        {/* 主體：左分類 + 右卡片 */}
        <div className="flex min-h-0 flex-1">
          {/* 左欄：分類 */}
          <div className="flex w-32 shrink-0 flex-col overflow-y-auto border-r border-gray-100 py-2">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCatFilter(cat)}
                className={`px-4 py-2.5 text-left text-base transition-colors ${
                  catFilter === cat
                    ? 'bg-teal-50 font-semibold text-teal-700'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* 右欄：卡片 */}
          <div className="flex-1 overflow-y-auto p-4">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-16 text-gray-400">
                <Zap className="h-8 w-8 opacity-30" />
                <p className="text-sm">
                  {skills.length === 0 ? '尚未建立任何 Skill，請聯絡管理員' : '找不到符合條件的 Skill'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map((skill) => (
                  <div key={skill.id}
                    className="group flex items-start justify-between rounded-xl border border-gray-200 bg-white p-4 hover:border-teal-300 hover:bg-teal-50/30 transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-800">{skill.title}</span>
                        {skill.category && (
                          <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
                            {skill.category}
                          </span>
                        )}
                      </div>
                      {skill.description && (
                        <p className="mt-0.5 text-sm text-gray-500">{skill.description}</p>
                      )}
                    </div>
                    <div className="ml-3 flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPreviewSkill(skill)}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-500 hover:bg-white hover:border-gray-400"
                      >
                        預覽
                      </button>
                      <button
                        type="button"
                        onClick={() => onApply(skill)}
                        className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800"
                      >
                        套用
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildPrompt(content: string, userPrompt: string, outputLang: string): string {
  const lines: string[] = []
  if (content.trim()) {
    lines.push('**內容素材**：')
    lines.push(content.trim())
    lines.push('')
  }
  lines.push(`**指令**: ${userPrompt.trim() || '請根據以上內容生成一份專業文件'}`)
  lines.push(`**輸出語言**: ${outputLang}`)
  lines.push('')
  lines.push('請直接輸出文件本體，不需要前言或後記。不要使用佔位符，若資訊不足請合理推斷或省略。')
  return lines.join('\n')
}

function buildRewritePrompt(fullText: string, selectedText: string, instruction: string): string {
  const markedDoc = fullText.replace(
    selectedText,
    `[REWRITE_START]\n${selectedText}\n[REWRITE_END]`,
  )
  return `改寫指令：${instruction}\n\n完整文件如下，請只改寫標記範圍內的段落：\n\n${markedDoc}`
}

function markdownToHtml(text: string): string {
  try {
    const html = marked.parse(text, { async: false, breaks: true }) as string
    return html || '<p></p>'
  } catch {
    return text.split('\n\n').map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('') || '<p></p>'
  }
}

// ── 主元件 ───────────────────────────────────────────────────────────────────

interface AgentWritingUIProps {
  agent: Agent
}

export default function AgentWritingUI({ agent }: AgentWritingUIProps) {
  // ── 全域設定 ──
  const [model, setModel] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || '' } catch { return '' }
  })

  // ── 文件列表 ──
  const [docs, setDocs] = useState<WritingDoc[]>([])
  const [docsLoading, setDocsLoading] = useState(true)
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null)

  // ── 中欄：目前文件的編輯狀態 ──
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [userPrompt, setUserPrompt] = useState('')
  const [outputLang, setOutputLang] = useState('繁體中文')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [pendingDraft, setPendingDraft] = useState<string | null>(null)
  const [draftDirty, setDraftDirty] = useState(false)
  const [draftSaving, setDraftSaving] = useState(false)
  const [pendingSelectDoc, setPendingSelectDoc] = useState<WritingDoc | null>(null)

  // ── 生成狀態 ──
  const [isStreaming, setIsStreaming] = useState(false)
  const [isRewriting, setIsRewriting] = useState(false)
  const [rewriteInput, setRewriteInput] = useState('')
  const [showRewriteInput, setShowRewriteInput] = useState(false)
  const [showInsertInput, setShowInsertInput] = useState(false)
  const [insertInput, setInsertInput] = useState('')
  const [copyFeedback, setCopyFeedback] = useState(false)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [lastMeta, setLastMeta] = useState<{
    model: string
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null
  } | null>(null)

  // ── Skills ──
  const [skills, setSkills] = useState<LlmSkill[]>([])
  const [showSkillModal, setShowSkillModal] = useState(false)

  // ── UI ──
  const [errorModal, setErrorModal] = useState<{ title: string; message: string } | null>(null)
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [newDocLoading, setNewDocLoading] = useState(false)
  const [showNewDocModal, setShowNewDocModal] = useState(false)
  const [newDocTitle, setNewDocTitle] = useState('')
  const [settingsExpanded, setSettingsExpanded] = useState(false)

  const fullTextRef = useRef('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const rewriteRangeRef = useRef<{ from: number; to: number } | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isStreamingRef = useRef(false)
  const draftDirtyRef = useRef(false)
  const rewriteInputRef = useRef<HTMLInputElement>(null)
  const insertInputRef = useRef<HTMLInputElement>(null)
  const bubbleMenuElRef = useRef<HTMLDivElement | null>(null)
  if (!bubbleMenuElRef.current) {
    bubbleMenuElRef.current = document.createElement('div')
  }
  const savedSelectionRef = useRef<{ from: number; to: number } | null>(null)

  // ── Editor ──
  const editor = useEditor({
    extensions: [StarterKit],
    content: '<p></p>',
    editorProps: {
      attributes: {
        class: 'outline-none min-h-full px-8 py-6 prose prose-gray max-w-none text-base leading-relaxed',
      },
    },
    onUpdate: () => {
      // 串流或載入草稿時的更新不算用戶修改
      // 只在第一次變 dirty 時才 setState，避免每次 keystroke 都觸發 re-render
      if (!isStreamingRef.current && !draftDirtyRef.current) {
        draftDirtyRef.current = true
        setDraftDirty(true)
      }
    },
  })

  // BubbleMenu 自訂 input 出現時自動 focus
  useEffect(() => {
    if (showRewriteInput) {
      const t = setTimeout(() => rewriteInputRef.current?.focus(), 20)
      return () => clearTimeout(t)
    }
  }, [showRewriteInput])

  // 插入 input 出現時自動 focus
  useEffect(() => {
    if (showInsertInput) {
      const t = setTimeout(() => insertInputRef.current?.focus(), 20)
      return () => clearTimeout(t)
    }
  }, [showInsertInput])

  // ── 初始化 ──
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  // BubbleMenuPlugin：editor 就緒後注冊
  useEffect(() => {
    if (!editor || !bubbleMenuElRef.current) return
    const el = bubbleMenuElRef.current
    editor.registerPlugin(
      BubbleMenuPlugin({
        pluginKey: 'writingBubbleMenu',
        editor,
        element: el,
        shouldShow: ({ state }) => {
          const { from, to } = state.selection
          // 有選取，或 bubble menu 內部有 focus（custom input）
          return from !== to || el.contains(document.activeElement)
        },
        options: { placement: 'top' },
      }),
    )
    return () => { editor.unregisterPlugin('writingBubbleMenu') }
  }, [editor])

  useEffect(() => {
    createChatThread({ agent_id: agent.id, title: null })
      .then((t) => setThreadId(t.id))
      .catch(() => {})
  }, [agent.id])

  // 載入 LLM Skills（靜默失敗，不影響主功能）
  useEffect(() => {
    listLlmSkills().then(setSkills).catch(() => {})
  }, [])

  // 載入文件列表
  useEffect(() => {
    setDocsLoading(true)
    listWritingDocs()
      .then((list) => {
        setDocs(list)
        if (list.length > 0) {
          // 優先還原上次選的 doc，找不到則選第一筆
          const lastId = (() => { try { return Number(localStorage.getItem(LAST_DOC_KEY)) || null } catch { return null } })()
          const target = (lastId ? list.find((d) => d.id === lastId) : null) ?? list[0]
          doSelectDoc(target)
        }
      })
      .catch(() => setErrorModal({ title: '載入失敗', message: '無法載入文件列表' }))
      .finally(() => setDocsLoading(false))
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── 儲存草稿 ──
  const saveDraft = useCallback(async () => {
    if (!selectedDocId || !editor) return
    // 用 getHTML() 取得用戶目前實際編輯的內容，不使用可能過期的 fullTextRef
    const html = editor.getText().trim() ? editor.getHTML() : ''
    setDraftSaving(true)
    try {
      const updated = await updateWritingDoc(selectedDocId, { draft: html })
      setDocs((prev) => prev.map((d) => d.id === updated.id ? updated : d))
      fullTextRef.current = html  // 同步 ref 避免下次存錯
      draftDirtyRef.current = false
      setDraftDirty(false)
    } catch {
      setErrorModal({ title: '儲存失敗', message: '草稿儲存失敗，請重試。' })
    } finally {
      setDraftSaving(false)
    }
  }, [editor, selectedDocId])

  // ── 選擇文件 ──
  const doSelectDoc = useCallback((doc: WritingDoc) => {
    setSelectedDocId(doc.id)
    setTitle(doc.title)
    setContent(doc.content ?? '')
    setUserPrompt(doc.user_prompt ?? '')
    setDirty(false)
    draftDirtyRef.current = false
    setDraftDirty(false)
    setPendingDraft(doc.draft ?? '')
    try { localStorage.setItem(LAST_DOC_KEY, String(doc.id)) } catch { /* ignore */ }
  }, [])

  const selectDoc = useCallback((doc: WritingDoc) => {
    if (draftDirty && doc.id !== selectedDocId) {
      setPendingSelectDoc(doc)
      return
    }
    doSelectDoc(doc)
  }, [draftDirty, selectedDocId, doSelectDoc])

  // pendingDraft + editor 都就緒時才載入草稿
  useEffect(() => {
    if (!editor || pendingDraft === null) return
    isStreamingRef.current = true
    // 新格式存 HTML（以 < 開頭），舊格式存 markdown → 用 markdownToHtml 轉換
    const html = pendingDraft
      ? (pendingDraft.trimStart().startsWith('<') ? pendingDraft : markdownToHtml(pendingDraft))
      : '<p></p>'
    editor.commands.setContent(html, { emitUpdate: false })
    fullTextRef.current = html
    setPendingDraft(null)
    draftDirtyRef.current = false
    setDraftDirty(false)
    isStreamingRef.current = false
  }, [editor, pendingDraft])

  // ── 持久化 ──
  const persistModel = useCallback((m: string) => {
    setModel(m)
    try { localStorage.setItem(STORAGE_KEY, m) } catch { /* ignore */ }
  }, [])

  // ── 儲存目前文件 ──
  const saveCurrentDoc = useCallback(async (patch?: { title?: string; content?: string; user_prompt?: string }) => {
    if (!selectedDocId) return
    setSaving(true)
    try {
      const updated = await updateWritingDoc(selectedDocId, patch ?? { title, content, user_prompt: userPrompt })
      setDocs((prev) => prev.map((d) => d.id === updated.id ? updated : d))
      setDirty(false)
    } catch {
      setErrorModal({ title: '儲存失敗', message: '儲存文件時發生錯誤' })
    } finally {
      setSaving(false)
    }
  }, [selectedDocId, title, content, userPrompt])

  // 欄位變更時自動 debounce 儲存
  const handleFieldChange = useCallback((field: 'title' | 'content' | 'userPrompt', value: string) => {
    if (field === 'title') setTitle(value)
    else if (field === 'content') setContent(value)
    else setUserPrompt(value)
    setDirty(true)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      const patch = field === 'title'
        ? { title: value }
        : field === 'content'
          ? { content: value }
          : { user_prompt: value }
      if (selectedDocId) {
        updateWritingDoc(selectedDocId, patch)
          .then((updated) => {
            setDocs((prev) => prev.map((d) => d.id === updated.id ? updated : d))
            setDirty(false)
          })
          .catch(() => { /* silent */ })
      }
    }, 1500)
  }, [selectedDocId])

  // ── 新增文件 ──
  const handleOpenNewDocModal = useCallback(() => {
    setNewDocTitle('')
    setShowNewDocModal(true)
  }, [])

  const handleNewDoc = useCallback(async () => {
    const trimmed = newDocTitle.trim()
    if (!trimmed) return
    setNewDocLoading(true)
    try {
      const doc = await createWritingDoc({ title: trimmed, content: '', user_prompt: '' })
      setDocs((prev) => [doc, ...prev])
      doSelectDoc(doc)
      setShowNewDocModal(false)
    } catch {
      setErrorModal({ title: '新增失敗', message: '無法建立新文件' })
    } finally {
      setNewDocLoading(false)
    }
  }, [newDocTitle, doSelectDoc])

  // ── 刪除文件 ──
  const handleDeleteDoc = useCallback(async (docId: number) => {
    setDeletingId(docId)
    try {
      await deleteWritingDoc(docId)
      setDocs((prev) => {
        const next = prev.filter((d) => d.id !== docId)
        if (selectedDocId === docId) {
          if (next.length > 0) {
            // 直接用 doSelectDoc，跳過 draftDirty 檢查（當前文件已刪除）
            doSelectDoc(next[0])
          } else {
            setSelectedDocId(null)
            setTitle('')
            setContent('')
            setUserPrompt('')
            editor?.commands.setContent('<p></p>')
            fullTextRef.current = ''
            draftDirtyRef.current = false
            setDraftDirty(false)
          }
        }
        return next
      })
    } catch {
      setErrorModal({ title: '刪除失敗', message: '無法刪除文件' })
    } finally {
      setDeletingId(null)
    }
  }, [selectedDocId, doSelectDoc, editor])

  // ── 生成草稿 ──
  const stopStreaming = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const handleGenerate = useCallback(async () => {
    if (isStreaming || !editor) return
    if (!userPrompt.trim() && !content.trim()) {
      setErrorModal({ title: '請填寫內容', message: '請先填入素材或在「對 AI 的指令」輸入要求。' })
      return
    }
    // 生成前先儲存
    if (dirty && selectedDocId) {
      await saveCurrentDoc()
    }

    const prompt = buildPrompt(content, userPrompt, outputLang)
    editor.commands.setContent('<p></p>')
    fullTextRef.current = ''
    setIsStreaming(true)
    isStreamingRef.current = true

    intervalRef.current = setInterval(() => {
      if (fullTextRef.current && editor) {
        editor.commands.setContent(markdownToHtml(fullTextRef.current), { emitUpdate: false })
      }
    }, 50)

    try {
      await chatCompletionsStream(
        {
          agent_id: agent.id,
          prompt_type: 'writing',
          system_prompt: '',
          user_prompt: '',
          data: '',
          model,
          messages: [],
          content: prompt,
          chat_thread_id: threadId ?? '',
        },
        {
          onDelta: (chunk) => { fullTextRef.current += chunk },
          onDone: (done) => {
            stopStreaming()
            const finalContent = done.content ?? fullTextRef.current
            if (finalContent && editor) {
              editor.commands.setContent(markdownToHtml(finalContent), { emitUpdate: false })
            }
            setLastMeta({ model: done.model ?? model, usage: done.usage ?? null })
            setIsStreaming(false)
            isStreamingRef.current = false
            draftDirtyRef.current = false
            setDraftDirty(false)
            // 存草稿到 DB（存 HTML 格式，與 saveDraft 一致）
            if (selectedDocId && finalContent) {
              const draftHtml = markdownToHtml(finalContent)
              fullTextRef.current = draftHtml
              updateWritingDoc(selectedDocId, { draft: draftHtml })
                .then((updated) => setDocs((prev) => prev.map((d) => d.id === updated.id ? updated : d)))
                .catch(() => {/* silent */})
            }
          },
          onError: (msg) => {
            stopStreaming()
            setIsStreaming(false)
            isStreamingRef.current = false
            setErrorModal({ title: '生成失敗', message: msg ?? '發生未知錯誤' })
          },
        },
      )
    } catch (e) {
      stopStreaming()
      setIsStreaming(false)
      setErrorModal({ title: '生成失敗', message: e instanceof Error ? e.message : '發生未知錯誤' })
    }
  }, [agent.id, content, dirty, editor, isStreaming, model, outputLang, saveCurrentDoc, selectedDocId, stopStreaming, threadId, userPrompt])

  // ── 複製 / 清除 ──
  const handleCopy = useCallback(async () => {
    if (!editor) return

    // 從 TipTap state 產生乾淨的語義 HTML（不含 class/style）
    function nodeToHtml(node: import('@tiptap/pm/model').Node): string {
      if (node.isText) {
        let text = node.text ?? ''
        // XSS escape
        text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        if (node.marks) {
          for (const mark of node.marks) {
            if (mark.type.name === 'bold') text = `<b>${text}</b>`
            else if (mark.type.name === 'italic') text = `<em>${text}</em>`
            else if (mark.type.name === 'code') text = `<code>${text}</code>`
          }
        }
        return text
      }
      const inner = (() => {
        const parts: string[] = []
        node.forEach((child) => parts.push(nodeToHtml(child)))
        return parts.join('')
      })()
      switch (node.type.name) {
        case 'paragraph': return `<p>${inner}</p>`
        case 'heading': return `<h${node.attrs.level}>${inner}</h${node.attrs.level}>`
        case 'bulletList': return `<ul>${inner}</ul>`
        case 'orderedList': return `<ol>${inner}</ol>`
        case 'listItem': return `<li>${inner}</li>`
        case 'blockquote': return `<blockquote>${inner}</blockquote>`
        case 'codeBlock': return `<pre><code>${inner}</code></pre>`
        case 'horizontalRule': return '<hr>'
        case 'hardBreak': return '<br>'
        default: return inner
      }
    }

    const parts: string[] = []
    editor.state.doc.forEach((node) => parts.push(nodeToHtml(node)))
    const html = parts.join('')

    // 純文字 fallback
    const textLines: string[] = []
    editor.state.doc.forEach((node) => textLines.push(node.textContent))
    const plainText = textLines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()

    try {
      // 優先用 ClipboardItem（同時提供 HTML + 純文字）
      if (typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plainText], { type: 'text/plain' }),
          }),
        ])
      } else {
        // 舊瀏覽器 fallback：純文字
        await navigator.clipboard.writeText(plainText)
      }
      setCopyFeedback(true)
      setTimeout(() => setCopyFeedback(false), 2000)
    } catch {
      setErrorModal({ title: '複製失敗', message: '無法複製到剪貼簿，請手動選取文字。' })
    }
  }, [editor])

  const handleClear = useCallback(() => {
    if (!editor || isStreaming) return
    editor.commands.setContent('<p></p>')
    fullTextRef.current = ''
    draftDirtyRef.current = false
    setDraftDirty(false)
  }, [editor, isStreaming])

  // ── AI 改寫（BubbleMenu 呼叫）──
  const handleRewrite = useCallback(async (instruction: string) => {
    if (!editor || isRewriting || isStreaming) return
    // input 送出時 editor 可能失焦，從 savedSelectionRef 取
    const sel = editor.state.selection
    const from = sel.from !== sel.to ? sel.from : (savedSelectionRef.current?.from ?? sel.from)
    const to = sel.from !== sel.to ? sel.to : (savedSelectionRef.current?.to ?? sel.to)
    savedSelectionRef.current = null
    if (from === to) return
    const selectedText = editor.state.doc.textBetween(from, to, '\n')
    if (!selectedText.trim()) return

    rewriteRangeRef.current = { from, to }
    setIsRewriting(true)
    setShowRewriteInput(false)
    setRewriteInput('')

    const prompt = buildRewritePrompt(editor.getText(), selectedText, instruction)
    let rewrittenText = ''

    try {
      await chatCompletionsStream(
        { agent_id: agent.id, prompt_type: 'writing_rewrite', system_prompt: '', user_prompt: '', data: '', model, messages: [], content: prompt, chat_thread_id: threadId ?? '' },
        {
          onDelta: (chunk) => { rewrittenText += chunk },
          onDone: () => {
            if (editor && rewrittenText && rewriteRangeRef.current) {
              const { from: f, to: t } = rewriteRangeRef.current
              editor.chain().focus().setTextSelection({ from: f, to: t }).deleteSelection().insertContent(markdownToHtml(rewrittenText)).run()
              draftDirtyRef.current = true
              setDraftDirty(true)
            }
            rewriteRangeRef.current = null
            setIsRewriting(false)
          },
          onError: (msg) => {
            rewriteRangeRef.current = null
            setIsRewriting(false)
            setErrorModal({ title: '改寫失敗', message: msg ?? '發生未知錯誤' })
          },
        },
      )
    } catch (e) {
      rewriteRangeRef.current = null
      setIsRewriting(false)
      setErrorModal({ title: '改寫失敗', message: e instanceof Error ? e.message : '發生未知錯誤' })
    }
  }, [agent.id, editor, isRewriting, isStreaming, model, threadId])

  // ── AI 插入（游標位置）──
  const handleInsert = useCallback(async (instruction: string) => {
    if (!editor || isRewriting || isStreaming) return
    const docText = editor.getText().trim()
    const prompt = [
      docText ? `以下是目前文件草稿：\n\n${docText}\n\n---\n\n` : '',
      `指令：${instruction}\n\n`,
      '請根據上述草稿與指令，生成一段新的段落文字。只輸出新段落文字，不要重複原有內容，不要加前言或後記。',
    ].join('')

    setIsRewriting(true)
    setShowInsertInput(false)
    setInsertInput('')

    let result = ''
    try {
      await chatCompletionsStream(
        { agent_id: agent.id, prompt_type: 'writing_rewrite', system_prompt: '', user_prompt: '', data: '', model, messages: [], content: prompt, chat_thread_id: threadId ?? '' },
        {
          onDelta: (chunk) => { result += chunk },
          onDone: () => {
            if (editor && result) {
              editor.chain().focus().insertContent(markdownToHtml(result)).run()
              draftDirtyRef.current = true
              setDraftDirty(true)
            }
            setIsRewriting(false)
          },
          onError: (msg) => {
            setIsRewriting(false)
            setErrorModal({ title: '插入失敗', message: msg ?? '發生未知錯誤' })
          },
        },
      )
    } catch (e) {
      setIsRewriting(false)
      setErrorModal({ title: '插入失敗', message: e instanceof Error ? e.message : '發生未知錯誤' })
    }
  }, [agent.id, editor, isRewriting, isStreaming, model, threadId])

  const hasContent = editor && editor.getText().trim().length > 0

  return (
    <div className="relative flex h-full flex-col p-4 text-[18px]">
      <ErrorModal
        open={errorModal != null}
        title={errorModal?.title}
        message={errorModal?.message ?? ''}
        onClose={() => setErrorModal(null)}
      />
      <HelpModal
        open={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        url="/help-writing-agent.md"
        title="Writing Agent 使用說明"
      />

      <InputModal
        open={showNewDocModal}
        title="新增文件"
        submitLabel="建立"
        loading={newDocLoading}
        onSubmit={handleNewDoc}
        onClose={() => setShowNewDocModal(false)}
      >
        <div>
          <label className="mb-1.5 block text-base font-medium text-gray-700">文件名稱</label>
          <input
            autoFocus
            type="text"
            value={newDocTitle}
            onChange={(e) => setNewDocTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && newDocTitle.trim()) handleNewDoc() }}
            placeholder="例：客戶報價跟進信、5 月份週報"
            maxLength={200}
            className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-base text-gray-800 placeholder:text-gray-400 focus:border-[#1C3939] focus:outline-none focus:ring-1 focus:ring-[#1C3939]"
          />
        </div>
      </InputModal>

      {/* ── 草稿未儲存提示 modal ── */}
      {pendingSelectDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/30" onClick={() => setPendingSelectDoc(null)} />
          <div className="relative z-10 min-w-[320px] rounded-2xl border-2 border-gray-200 bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-base font-semibold text-gray-800">草稿有未儲存的變更</h2>
            <p className="mb-6 text-sm text-gray-500">離開前要儲存草稿嗎？</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPendingSelectDoc(null)}
                className="rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                取消
              </button>
              <button type="button" onClick={() => { doSelectDoc(pendingSelectDoc); setPendingSelectDoc(null) }}
                className="rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                不儲存
              </button>
              <button type="button" onClick={async () => { await saveDraft(); doSelectDoc(pendingSelectDoc); setPendingSelectDoc(null) }}
                className="rounded-xl px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                style={{ backgroundColor: '#36454F' }}>
                儲存後離開
              </button>
            </div>
          </div>
        </div>
      )}

      <AgentHeader agent={agent} headerBackgroundColor={HEADER_COLOR} onOnlineHelpClick={() => setShowHelpModal(true)} />

      <div className="mt-4 flex min-h-0 flex-1 gap-3 overflow-hidden">

        {/* ── 左欄：文件列表 ────────────────────────────────────────────── */}
        <div
          className="flex w-52 shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md"
          style={{ backgroundColor: HEADER_COLOR }}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-white/20 px-3 py-2.5">
            <span className="flex items-center gap-1.5 text-lg font-semibold text-white/80">
              <FileText className="h-4 w-4" />
              我的文件
            </span>
            <button
              type="button"
              onClick={handleOpenNewDocModal}
              title="新增文件"
              className="flex items-center justify-center rounded-lg p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          {/* 文件清單 */}
          <div className="flex-1 overflow-y-auto py-1">
            {docsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-white/40" />
              </div>
            ) : docs.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-white/35">
                尚無文件<br />點擊 + 新增
              </div>
            ) : (
              docs.map((doc) => (
                <div
                  key={doc.id}
                  className={`group flex cursor-pointer items-center gap-1 px-2 py-2 transition-colors ${
                    selectedDocId === doc.id
                      ? 'bg-white/15 text-white'
                      : 'text-white/60 hover:bg-white/8 hover:text-white/85'
                  }`}
                  onClick={() => selectDoc(doc)}
                >
                  <span className="min-w-0 flex-1 truncate text-lg leading-snug">
                    {doc.title}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleDeleteDoc(doc.id) }}
                    disabled={deletingId === doc.id}
                    className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100 disabled:opacity-30"
                    title="刪除"
                  >
                    {deletingId === doc.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── 中欄：設定面板 ────────────────────────────────────────────── */}
        <div className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md transition-[width] duration-200 ${settingsExpanded ? 'w-[640px]' : 'w-80'}`}>
          {selectedDocId === null ? (
            <div
              className="flex flex-1 flex-col items-center justify-center gap-3"
              style={{ backgroundColor: '#F0FFF0' }}
            >
              <FileText className="h-10 w-10 opacity-20" style={{ color: HEADER_COLOR }} />
              <p className="text-sm" style={{ color: HEADER_COLOR, opacity: 0.4 }}>選擇或新增文件</p>
            </div>
          ) : (
            <>
              {/* 中欄 Header：文件標題（深色保持不變） */}
              <div className="shrink-0 border-b border-white/20 px-3 py-2" style={{ backgroundColor: HEADER_COLOR }}>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => handleFieldChange('title', e.target.value)}
                    placeholder="文件名稱"
                    className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-white placeholder:text-white/30 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setSettingsExpanded((v) => !v)}
                    title={settingsExpanded ? '縮小設定欄' : '放大設定欄'}
                    className="shrink-0 rounded p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    {settingsExpanded
                      ? <Minimize2 className="h-3.5 w-3.5" />
                      : <Maximize2 className="h-3.5 w-3.5" />
                    }
                  </button>
                </div>
                {saving && (
                  <span className="flex items-center gap-1 text-xs text-white/30">
                    <Loader2 className="h-3 w-3 animate-spin" />儲存中…
                  </span>
                )}
              </div>

              <div className="flex min-h-0 flex-1 flex-col" style={{ backgroundColor: '#F0FFF0' }}>
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3">

                  {/* 輸出語言 */}
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-600">輸出語言</label>
                    <select
                      value={outputLang}
                      onChange={(e) => setOutputLang(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 focus:border-[#AE924C] focus:outline-none"
                    >
                      <option value="繁體中文">繁體中文</option>
                      <option value="日文">日文</option>
                      <option value="英文">英文</option>
                    </select>
                  </div>

                  {/* 內容素材 */}
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <label className="text-sm font-medium text-gray-600">內容素材</label>
                      <span className={`text-xs ${content.length > CONTENT_MAX * 0.9 ? 'text-amber-500' : 'text-gray-400'}`}>
                        {content.length.toLocaleString()} / {CONTENT_MAX.toLocaleString()}
                      </span>
                    </div>
                    <textarea
                      rows={8}
                      value={content}
                      maxLength={CONTENT_MAX}
                      onChange={(e) => handleFieldChange('content', e.target.value)}
                      placeholder="貼入相關資料、會議記錄、舊稿、重點等…"
                      className="w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-[#AE924C] focus:outline-none"
                    />
                  </div>

                  {/* 對 AI 的指令 */}
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="text-sm font-medium text-gray-600">對 AI 的指令</label>
                      <span className={`text-xs ${userPrompt.length > PROMPT_MAX * 0.9 ? 'text-amber-500' : 'text-gray-400'}`}>
                        {userPrompt.length} / {PROMPT_MAX}
                      </span>
                    </div>
                    {/* 指令範本下拉 + Skill 庫按鈕 */}
                    <div className="mb-2 flex shrink-0 items-center gap-2">
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          if (!e.target.value) return
                          handleFieldChange('userPrompt', e.target.value)
                          e.target.value = ''
                        }}
                        className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-500 focus:border-[#AE924C] focus:outline-none"
                      >
                        <option value="" disabled>套用範本…</option>
                        {PROMPT_TEMPLATES.map((t) => (
                          <option key={t.label} value={t.prompt}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setShowSkillModal(true)}
                        title="開啟 Skill 庫"
                        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-sm font-medium text-teal-700 hover:bg-teal-100 transition-colors"
                      >
                        <Zap className="h-3.5 w-3.5" />
                        Skills
                      </button>
                    </div>

                    {/* Skill 庫 Modal */}
                    {showSkillModal && (
                      <SkillPickerModal
                        skills={skills}
                        onApply={(skill) => {
                          handleFieldChange('userPrompt', skill.prompt)
                          setShowSkillModal(false)
                        }}
                        onClose={() => setShowSkillModal(false)}
                      />
                    )}
                    <textarea
                      value={userPrompt}
                      maxLength={PROMPT_MAX}
                      onChange={(e) => handleFieldChange('userPrompt', e.target.value)}
                      placeholder="例：整理成報價跟進信，語氣友善；或：寫一份會議摘要"
                      className="min-h-[80px] flex-1 resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-[#AE924C] focus:outline-none"
                    />
                  </div>
                </div>

                {/* 生成按鈕 */}
                <div className="shrink-0 border-t border-gray-200 p-3">
                  <button
                    type="button"
                    disabled={isStreaming}
                    onClick={handleGenerate}
                    className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ backgroundColor: '#36454F' }}
                  >
                    <Sparkles className="h-4 w-4" />
                    {isStreaming ? '生成中…' : '生成草稿'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── 右欄：編輯器 ─────────────────────────────────────────────── */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50">
          {/* Toolbar 第一排 */}
          <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2.5">
            <span className="text-base font-medium text-gray-600">
              {isStreaming ? (
                <span className="flex items-center gap-2 text-amber-600">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                  生成中…
                </span>
              ) : isRewriting ? (
                <span className="flex items-center gap-2 text-blue-600">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                  改寫中…
                </span>
              ) : hasContent ? (
                '草稿（可直接編輯）'
              ) : (
                '填寫中欄後點擊「生成草稿」'
              )}
            </span>
            <div className="flex items-center gap-2">
              <LLMModelSelect value={model} onChange={persistModel} compact labelPosition="inline" />
              {hasContent && (
                <>
                  {draftDirty && (
                    <button
                      type="button"
                      onClick={saveDraft}
                      disabled={draftSaving || isStreaming}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-base font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                      style={{ backgroundColor: '#36454F' }}
                    >
                      {draftSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {draftSaving ? '儲存中…' : '儲存草稿'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleClear}
                    disabled={isStreaming}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-base text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40"
                  >
                    <RotateCcw className="h-4 w-4" />
                    清除
                  </button>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-base text-gray-600 transition-colors hover:bg-gray-50"
                  >
                    <ClipboardCopy className="h-4 w-4" />
                    {copyFeedback ? '已複製！' : '複製'}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Toolbar 第二排：格式 + AI 改寫 */}
          {hasContent && (
            <div className="flex shrink-0 items-center gap-1 border-y border-amber-200 bg-gradient-to-b from-amber-100 to-amber-50 px-4 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),inset_0_-1px_0_rgba(0,0,0,0.06),0_2px_4px_rgba(0,0,0,0.08)]">
              {[
                { icon: <Bold className="h-4 w-4" />, title: '粗體', action: () => editor?.chain().focus().toggleBold().run(), active: editor?.isActive('bold') },
                { icon: <Italic className="h-4 w-4" />, title: '斜體', action: () => editor?.chain().focus().toggleItalic().run(), active: editor?.isActive('italic') },
                { icon: <Heading2 className="h-4 w-4" />, title: '標題', action: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(), active: editor?.isActive('heading', { level: 2 }) },
                { icon: <List className="h-4 w-4" />, title: '條列清單', action: () => editor?.chain().focus().toggleBulletList().run(), active: editor?.isActive('bulletList') },
                { icon: <ListOrdered className="h-4 w-4" />, title: '數字清單', action: () => editor?.chain().focus().toggleOrderedList().run(), active: editor?.isActive('orderedList') },
              ].map(({ icon, title, action, active }) => (
                <button
                  key={title}
                  type="button"
                  onClick={action}
                  disabled={isStreaming || isRewriting}
                  title={title}
                  className={`rounded-lg p-2 transition-colors disabled:opacity-30 ${active ? 'bg-white text-amber-800 shadow-sm' : 'text-amber-600 hover:bg-white/70 hover:text-amber-800'}`}
                >
                  {icon}
                </button>
              ))}
              <div className="mx-1 h-4 w-px bg-amber-300" />
              <button
                type="button"
                onClick={() => editor?.commands.undo()}
                disabled={!editor?.can().undo()}
                title="復原"
                className="rounded-lg p-2 text-amber-600 transition-colors hover:bg-white/70 hover:text-amber-800 disabled:opacity-30"
              >
                <Undo2 className="h-4 w-4" />
              </button>

              <div className="mx-1 h-4 w-px bg-amber-300" />

              {/* 插入：固定顯示，在游標位置新增段落 */}
              {!isStreaming && (
                showInsertInput ? (
                  <form
                    className="flex items-center gap-1"
                    onSubmit={(e) => { e.preventDefault(); if (insertInput.trim()) handleInsert(insertInput.trim()) }}
                  >
                    <input
                      ref={insertInputRef}
                      type="text"
                      value={insertInput}
                      onChange={(e) => setInsertInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Escape') { setShowInsertInput(false); setInsertInput('') } }}
                      placeholder="描述要插入的內容…"
                      className="w-44 rounded-lg border border-amber-300 bg-white px-2 py-1 text-sm focus:border-amber-500 focus:outline-none"
                    />
                    <button type="submit" disabled={!insertInput.trim() || isRewriting} className="rounded-lg px-2 py-1 text-sm font-medium text-amber-700 hover:bg-white/70 disabled:opacity-40">送出</button>
                    <button type="button" onClick={() => { setShowInsertInput(false); setInsertInput('') }} className="rounded-lg px-1.5 py-1 text-sm text-amber-500 hover:bg-white/70">✕</button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowInsertInput(true)}
                    disabled={isRewriting}
                    className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-sm font-medium text-amber-700 transition-colors hover:bg-white/70 disabled:opacity-40"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    插入
                  </button>
                )
              )}

              {/* 改寫中狀態提示 */}
              {isRewriting && (
                <>
                  <div className="mx-1 h-4 w-px bg-amber-300" />
                  <span className="animate-pulse text-sm text-amber-600">AI 處理中…</span>
                </>
              )}
            </div>
          )}

          {/* BubbleMenu Portal：選取文字後浮出 */}
          {bubbleMenuElRef.current && createPortal(
            <div className="flex items-center gap-0.5 rounded-lg border border-amber-300 bg-white px-1.5 py-1 shadow-lg">
              {!isStreaming && !isRewriting && [
                { label: '重寫', instruction: '重新改寫這段，保持語意但換一種表達方式' },
                { label: '縮短', instruction: '將這段縮短，保留核心意思' },
                { label: '正式化', instruction: '將這段改為更正式的語氣' },
                { label: '友善化', instruction: '將這段改為更親切友善的語氣' },
              ].map(({ label, instruction }) => (
                <button
                  key={label}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleRewrite(instruction)}
                  className="rounded px-2 py-0.5 text-sm font-medium text-amber-800 hover:bg-amber-100"
                >
                  {label}
                </button>
              ))}
              {!isStreaming && (
                <>
                  <div className="mx-1 h-4 w-px bg-amber-200" />
                  {isRewriting ? (
                    <span className="animate-pulse px-2 text-sm text-amber-600">AI 處理中…</span>
                  ) : showRewriteInput ? (
                    <form
                      className="flex items-center gap-1"
                      onSubmit={(e) => {
                        e.preventDefault()
                        if (rewriteInput.trim()) {
                          // 在送出前先保存 selection
                          const sel = editor?.state.selection
                          if (sel && sel.from !== sel.to) savedSelectionRef.current = { from: sel.from, to: sel.to }
                          handleRewrite(rewriteInput.trim())
                        }
                      }}
                    >
                      <input
                        ref={rewriteInputRef}
                        type="text"
                        value={rewriteInput}
                        onChange={(e) => setRewriteInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') { setShowRewriteInput(false); setRewriteInput('') } }}
                        placeholder="輸入改寫指令…"
                        className="w-36 rounded border border-amber-300 px-2 py-0.5 text-sm focus:border-amber-500 focus:outline-none"
                      />
                      <button type="submit" disabled={!rewriteInput.trim()} className="rounded px-1.5 py-0.5 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-40">送出</button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setShowRewriteInput(false); setRewriteInput('') }} className="rounded px-1 py-0.5 text-sm text-amber-400 hover:bg-amber-100">✕</button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setShowRewriteInput(true)}
                      className="flex items-center gap-1 rounded px-2 py-0.5 text-sm font-medium text-amber-700 hover:bg-amber-100"
                    >
                      <Pencil className="h-3 w-3" />
                      自訂
                    </button>
                  )}
                </>
              )}
            </div>,
            bubbleMenuElRef.current,
          )}

          {/* 編輯器主體 */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!hasContent && !isStreaming ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-gray-400">
                <FileText className="h-16 w-16 opacity-30" />
                <p className="text-base">填寫中欄素材與指令，AI 將幫你生成草稿</p>
              </div>
            ) : (
              <EditorContent editor={editor} className="h-full" />
            )}
          </div>

          {/* 底部 Meta 資訊 */}
          {lastMeta && (
            <div className="shrink-0 border-t border-amber-200 bg-gradient-to-b from-amber-100 to-amber-50 px-4 py-1.5 text-xs text-amber-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
              <span className="font-medium text-gray-500">{lastMeta.model}</span>
              {lastMeta.usage && (
                <span> · prompt: {lastMeta.usage.prompt_tokens} · completion: {lastMeta.usage.completion_tokens} · total: {lastMeta.usage.total_tokens}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
