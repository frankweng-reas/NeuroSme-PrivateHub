/**
 * Document Parse Agent UI（agent_id = document-parse）
 * Step 1：左欄設定（Profile + 上傳 + Model）＋右欄 SSE 解析結果
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Clock, Download, FileSearch, Loader2, Settings, Trash2, Upload } from 'lucide-react'
import AgentHeader from '@/components/AgentHeader'
import HelpModal from '@/components/HelpModal'
import DocParseProfileManager from './DocParseProfileManager'
import LLMModelSelect from '@/components/LLMModelSelect'
import { getMe } from '@/api/users'
import {
  deleteParseResult,
  getParseResult,
  listParseProfiles,
  listParseResults,
  parseDocumentStream,
  patchResultField,
  type ParseField,
  type ParseProfile,
  type ParseResultSummary,
  type ParseSection,
  type ParseUsage,
} from '@/api/documentParse'
import type { Agent, UserRole } from '@/types'

interface Props { agent: Agent }

const HEADER_COLOR = '#1A3A52'

export default function AgentDocumentParseUI({ agent }: Props) {
  // ── 角色 & 管理 ────────────────────────────────────────────────────────────
  const [userRole, setUserRole] = useState<UserRole>('member')
  const canManage = userRole === 'admin' || userRole === 'super_admin' || userRole === 'manager'
  const [managerOpen, setManagerOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  // ── 設定 ──────────────────────────────────────────────────────────────────
  const [profiles, setProfiles] = useState<ParseProfile[]>([])
  const [profileId, setProfileId] = useState('')
  const [model, setModel] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── 解析狀態 ──────────────────────────────────────────────────────────────
  const [parsing, setParsing] = useState(false)
  const [progress, setProgress] = useState<{ chunk: number; total: number; status: string } | null>(null)
  const [sections, setSections] = useState<ParseSection[] | null>(null)
  const [usage, setUsage] = useState<ParseUsage | null>(null)
  const [usedModel, setUsedModel] = useState('')
  const [savedFileName, setSavedFileName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // ── 初始化：從 DB 讀最近一筆結果 ─────────────────────────────────────────
  useEffect(() => {
    getMe().then((me) => setUserRole(me.role as UserRole)).catch(() => {})
    listParseResults(1)
      .then(async (list) => {
        if (list.length === 0) return
        const latest = list[0]
        const detail = await getParseResult(latest.id)
        setSections(detail.sections)
        setUsage(detail.usage)
        setUsedModel(detail.model)
        setSavedFileName(detail.file_name)
        setActiveHistoryId(detail.id)
        setProfileId(detail.profile_id)
      })
      .catch(() => {})
  }, [])

  function loadProfiles() {
    listParseProfiles()
      .then((list) => {
        setProfiles(list)
        setProfileId((prev) => prev || (list.length > 0 ? list[0].id : ''))
      })
      .catch(() => {})
  }

  useEffect(() => { loadProfiles() }, [])

  function handleFileChange(f: File | null) {
    if (!f) return
    if (f.type !== 'application/pdf') { setError('目前僅支援 PDF 格式'); return }
    setFile(f)
    setError(null)
    setSections(null)
    setSavedFileName('')
  }

  async function handleParse() {
    if (!file || !profileId) return
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setParsing(true)
    setError(null)
    setSections(null)
    setUsage(null)
    setProgress(null)

    try {
      for await (const ev of parseDocumentStream(file, profileId, model || undefined, abortRef.current.signal)) {
        if (ev.type === 'meta') {
          setProgress({ chunk: 0, total: ev.chunk_total, status: `共 ${ev.page_count} 頁，${ev.chunk_total} 段` })
        } else if (ev.type === 'progress') {
          setProgress({ chunk: ev.chunk, total: ev.chunk_total, status: ev.status })
        } else if (ev.type === 'done') {
          setSections(ev.sections)
          setUsage(ev.usage)
          setUsedModel(ev.model)
          setSavedFileName(file.name)
          setProgress(null)
          if (ev.result_id) {
            setActiveHistoryId(ev.result_id)
            // 若歷史面板已開啟，重新整理清單
            setHistory((prev) => {
              const exists = prev.some((r) => r.id === ev.result_id)
              if (exists) return prev
              return [{
                id: ev.result_id!,
                profile_id: profileId,
                profile_name: profiles.find((p) => p.id === profileId)?.name ?? profileId,
                file_name: file.name,
                page_count: null,
                model: ev.model,
                created_at: new Date().toISOString(),
              }, ...prev]
            })
          }
        } else if (ev.type === 'error') {
          setError(ev.detail)
          setProgress(null)
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(String(e))
    } finally {
      setParsing(false)
    }
  }

  function handleAbort() {
    abortRef.current?.abort()
    setParsing(false)
    setProgress(null)
  }

  const foundCount = sections?.flatMap((s) => s.fields).filter((f) => !f.not_found).length ?? 0
  const totalCount = sections?.flatMap((s) => s.fields).length ?? 0

  function clearResult() {
    setSections(null)
    setUsage(null)
    setUsedModel('')
    setSavedFileName('')
    setActiveHistoryId(null)
  }

  // ── 原文依據顯示 ──────────────────────────────────────────────────────────
  const [showCite, setShowCite] = useState(false)

  // ── Inline 編輯 ───────────────────────────────────────────────────────────
  const [editingField, setEditingField] = useState<{ sectionId: string; fieldKey: string } | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [savingField, setSavingField] = useState(false)

  function startEdit(sectionId: string, field: ParseField) {
    if (field.not_found) {
      setEditingValue('')
    } else if (Array.isArray(field.value)) {
      setEditingValue((field.value as string[]).join('\n'))
    } else {
      setEditingValue((field.value as string) ?? '')
    }
    setEditingField({ sectionId, fieldKey: field.key })
  }

  async function commitEdit(sectionId: string, field: ParseField) {
    if (!editingField || editingField.fieldKey !== field.key || editingField.sectionId !== sectionId) return
    setEditingField(null)
    if (!activeHistoryId) return

    const isListField = field.type === 'text_list' || field.type === 'doc_list'
    const newValue = isListField
      ? editingValue.split('\n').map((s) => s.trim()).filter(Boolean)
      : editingValue.trim() || null

    // 樂觀更新本地 state
    setSections((prev) =>
      prev?.map((s) =>
        s.id !== sectionId ? s : {
          ...s,
          fields: s.fields.map((f) =>
            f.key !== field.key ? f : {
              ...f,
              value: newValue,
              not_found: newValue === null || (Array.isArray(newValue) && newValue.length === 0),
            }
          ),
        }
      ) ?? null
    )

    setSavingField(true)
    try {
      await patchResultField(activeHistoryId, sectionId, field.key, newValue)
    } catch { /* silent: local state already updated */ }
    finally { setSavingField(false) }
  }

  // ── Markdown 匯出 ─────────────────────────────────────────────────────────
  function exportMarkdown() {
    if (!sections) return
    const lines: string[] = [`# 解析結果：${savedFileName}`, '']
    for (const section of sections) {
      lines.push(`## ${section.label}`, '')
      lines.push('| 欄位 | 值 |', '|---|---|')
      for (const f of section.fields) {
        const val = f.not_found
          ? '—'
          : Array.isArray(f.value)
            ? (f.value as string[]).join('、')
            : (f.value as string) ?? '—'
        lines.push(`| ${f.label} | ${val.replace(/\|/g, '｜')} |`)
      }
      lines.push('')
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${savedFileName.replace(/\.pdf$/i, '')}_解析結果.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── 歷史記錄 ──────────────────────────────────────────────────────────────
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<ParseResultSummary[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [activeHistoryId, setActiveHistoryId] = useState<number | null>(null)

  const loadHistory = useCallback(() => {
    setHistoryLoading(true)
    listParseResults(30)
      .then(setHistory)
      .catch(() => {})
      .finally(() => setHistoryLoading(false))
  }, [])

  useEffect(() => {
    if (historyOpen) loadHistory()
  }, [historyOpen, loadHistory])

  async function handleLoadHistory(id: number) {
    if (activeHistoryId === id) return
    try {
      const r = await getParseResult(id)
      setSections(r.sections)
      setUsage(r.usage)
      setUsedModel(r.model)
      setSavedFileName(r.file_name)
      setActiveHistoryId(id)
    } catch { /* ignore */ }
  }

  async function handleDeleteHistory(e: React.MouseEvent, id: number) {
    e.stopPropagation()
    await deleteParseResult(id).catch(() => {})
    setHistory((prev) => prev.filter((r) => r.id !== id))
    if (activeHistoryId === id) setActiveHistoryId(null)
  }

  function formatDate(iso: string) {
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <div className="relative flex h-full flex-col p-4 text-[18px]">
      {managerOpen && (
        <DocParseProfileManager
          onClose={() => setManagerOpen(false)}
          onSaved={() => loadProfiles()}
        />
      )}
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} url="/help-document-parse.md" title="Document Parse 使用說明" />
      <AgentHeader agent={agent} headerBackgroundColor={HEADER_COLOR} onOnlineHelpClick={() => setHelpOpen(true)} />

      <div className="mt-4 flex min-h-0 flex-1 gap-3 overflow-hidden">

        {/* ══ 左欄：設定 ═══════════════════════════════════════════════════════ */}
        <div
          className="flex w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md"
          style={{ backgroundColor: HEADER_COLOR }}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-white/20 px-4 py-3">
            <div className="flex items-center gap-2">
              <FileSearch className="h-4 w-4 text-white/70" />
              <span className="text-lg font-semibold text-white">解析設定</span>
            </div>
            {canManage && (
              <button
                type="button"
                onClick={() => setManagerOpen(true)}
                title="管理 Profile"
                className="rounded-lg p-1.5 text-white/60 hover:bg-white/15 hover:text-white"
              >
                <Settings className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">

            {/* Profile 下拉 */}
            <div>
              <label className="mb-1.5 block text-base font-medium text-white/70">解析類型</label>
              <select
                value={profileId}
                onChange={(e) => { setProfileId(e.target.value); setSections(null) }}
                className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-base text-white focus:border-white/40 focus:outline-none focus:ring-1 focus:ring-white/40"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id} className="bg-gray-800 text-white">{p.name}</option>
                ))}
              </select>
            </div>

            {/* 上傳區 */}
            <div>
              <label className="mb-1.5 block text-base font-medium text-white/70">上傳文件</label>
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFileChange(e.dataTransfer.files[0] ?? null) }}
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-6 transition-colors ${
                  isDragging ? 'border-white/60 bg-white/20' : 'border-white/25 bg-white/5 hover:border-white/40 hover:bg-white/10'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                />
                {file ? (
                  <>
                    <FileSearch className="h-7 w-7 text-white/80" />
                    <p className="max-w-full break-all px-2 text-center text-base font-medium text-white">{file.name}</p>
                    <p className="text-sm text-white/50">點擊可重新選擇</p>
                  </>
                ) : (
                  <>
                    <Upload className="h-7 w-7 text-white/50" />
                    <p className="text-base text-white/70">拖曳或點擊上傳 PDF</p>
                    <p className="text-sm text-white/40">最大 20 MB</p>
                  </>
                )}
              </div>
            </div>

            {/* Model 選擇 */}
            <div>
              <label className="mb-1.5 block text-base font-medium text-white/70">AI 模型</label>
              <div className="rounded-lg bg-white/10">
                <LLMModelSelect
                  value={model}
                  onChange={setModel}
                  className="[&_button]:!border-white/20 [&_button]:!bg-transparent [&_button]:!text-white [&_button]:!text-base [&_label]:!hidden"
                />
              </div>
            </div>

            {/* 解析按鈕 */}
            {parsing ? (
              <button
                type="button"
                onClick={handleAbort}
                className="mt-auto flex w-full items-center justify-center gap-2 rounded-xl border border-white/30 bg-white/10 py-2.5 text-base font-semibold text-white transition-opacity hover:bg-white/20"
              >
                <Loader2 className="h-4 w-4 animate-spin" />取消
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleParse()}
                disabled={!file || !profileId}
                className="mt-auto flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 py-2.5 text-base font-semibold text-white transition-opacity hover:bg-sky-600 disabled:opacity-40"
              >
                <FileSearch className="h-4 w-4" />開始解析
              </button>
            )}
          </div>
        </div>

        {/* ══ 右欄：解析結果 ═══════════════════════════════════════════════════ */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-300/50 bg-white shadow-md">

          {/* 右欄標題 */}
          <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-lg font-semibold text-gray-700">解析結果</span>
              {sections && savedFileName && (
                <span className="text-xs text-gray-400 truncate max-w-xs" title={savedFileName}>
                  {savedFileName}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {sections && (
                <span className="flex items-center gap-1.5 text-base text-gray-500">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  找到 {foundCount} / {totalCount} 欄位
                  {usedModel && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-sm text-gray-400">{usedModel}</span>}
                  <button
                    onClick={clearResult}
                    className="ml-2 rounded px-2 py-0.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    title="清除結果"
                  >
                    清除
                  </button>
                </span>
              )}
              {sections && (
                <>
                  <label className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-gray-500 hover:bg-gray-50 select-none">
                    <input
                      type="checkbox"
                      checked={showCite}
                      onChange={(e) => setShowCite(e.target.checked)}
                      className="rounded accent-sky-500"
                    />
                    原文依據
                  </label>
                  <button
                    type="button"
                    onClick={exportMarkdown}
                    title="匯出 Markdown"
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                </>
              )}
              {savingField && <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />}
              <button
                type="button"
                onClick={() => setHistoryOpen((o) => !o)}
                title="歷史記錄"
                className={`rounded-lg p-1.5 transition-colors ${historyOpen ? 'bg-sky-100 text-sky-600' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'}`}
              >
                <Clock className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* 主體：結果 + 歷史側欄並排 */}
          <div className="flex min-h-0 flex-1 overflow-hidden">

          {/* 內容區 */}
          <div className="min-h-0 flex-1 overflow-y-auto">

            {/* 解析中進度 */}
            {parsing && progress && (
              <div className="flex flex-col items-center justify-center gap-4 px-8 py-12">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
                <p className="text-base font-medium text-gray-600">{progress.status}</p>
                {progress.total > 1 && (
                  <div className="w-full max-w-xs">
                    <div className="h-2 w-full rounded-full bg-gray-100">
                      <div
                        className="h-2 rounded-full bg-sky-500 transition-all duration-300"
                        style={{ width: `${Math.round((progress.chunk / progress.total) * 100)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-center text-sm text-gray-400">{progress.chunk} / {progress.total} 段</p>
                  </div>
                )}
              </div>
            )}

            {/* 空白提示 */}
            {!parsing && !sections && !error && (
              <div className="flex h-full items-center justify-center">
                <p className="text-base text-gray-400">上傳 PDF 並點擊「開始解析」</p>
              </div>
            )}

            {/* 錯誤 */}
            {error && (
              <div className="m-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-base text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* 結果 */}
            {sections && (
              <div className="divide-y divide-gray-100">
                {sections.map((section) => (
                  <div key={section.id}>
                    <h3 className="px-5 py-2 text-base font-semibold text-sky-800 bg-sky-50 border-b border-sky-100">{section.label}</h3>
                    <div className="px-5 py-4">
                    <table className="w-full text-base">
                      <tbody className="divide-y divide-gray-50">
                        {section.fields.map((field) => {
                          const isEditing = editingField?.sectionId === section.id && editingField?.fieldKey === field.key
                          const isListField = field.type === 'text_list' || field.type === 'doc_list'
                          const canEdit = !!activeHistoryId
                          return (
                          <tr key={field.key} className={field.not_found ? 'bg-red-50/50' : ''}>
                            <td className="w-36 shrink-0 py-2 pr-4 text-base font-medium text-gray-600 align-top">
                              {field.label}
                            </td>
                            <td className="py-2 align-top">
                              {isEditing ? (
                                isListField ? (
                                  <textarea
                                    autoFocus
                                    value={editingValue}
                                    onChange={(e) => setEditingValue(e.target.value)}
                                    onBlur={() => void commitEdit(section.id, field)}
                                    onKeyDown={(e) => { if (e.key === 'Escape') setEditingField(null) }}
                                    rows={Math.max(3, editingValue.split('\n').length)}
                                    placeholder="每行一項"
                                    className="w-full rounded-md border border-sky-300 px-2 py-1 text-base text-gray-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-300"
                                  />
                                ) : (
                                  <input
                                    autoFocus
                                    value={editingValue}
                                    onChange={(e) => setEditingValue(e.target.value)}
                                    onBlur={() => void commitEdit(section.id, field)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') void commitEdit(section.id, field)
                                      if (e.key === 'Escape') setEditingField(null)
                                    }}
                                    className="w-full rounded-md border border-sky-300 px-2 py-1 text-base text-gray-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-300"
                                  />
                                )
                              ) : (
                                <div
                                  onClick={() => canEdit && startEdit(section.id, field)}
                                  className={canEdit ? 'group/cell cursor-text rounded px-1 -mx-1 hover:bg-sky-50' : ''}
                                >
                                  {field.not_found ? (
                                    <span className="inline-flex items-center gap-1 text-base text-red-400">
                                      <AlertCircle className="h-3.5 w-3.5" />
                                      未找到{canEdit && <span className="ml-1 text-xs text-gray-400 opacity-0 group-hover/cell:opacity-100">點擊填入</span>}
                                    </span>
                                  ) : Array.isArray(field.value) ? (
                                    <ul className="list-disc pl-4 space-y-0.5">
                                      {(field.value as string[]).map((item, i) => (
                                        <li key={i} className="text-gray-700">{item}</li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <span className="text-gray-800">{field.value as string}</span>
                                  )}
                                </div>
                              )}
                              {showCite && field.cite && !isEditing && (
                                <div className="mt-1.5 rounded-md border-l-2 border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-800 leading-relaxed">
                                  「{field.cite}」
                                </div>
                              )}
                            </td>
                          </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    </div>{/* end px-5 py-4 */}
                  </div>
                ))}

                {/* Token 用量 */}
                {usage && (
                  <div className="px-5 py-3 text-sm text-gray-400">
                    Token 用量：prompt {usage.prompt_tokens} + completion {usage.completion_tokens} = {usage.total_tokens}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── 歷史側邊欄 ─────────────────────────────────────────────────── */}
          {historyOpen && (
            <div className="flex w-64 shrink-0 flex-col border-l border-gray-100">
              <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-3 py-2">
                <span className="text-sm font-semibold text-gray-600">歷史記錄</span>
                {historyLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
              </div>
              <div className="flex-1 overflow-y-auto">
                {history.length === 0 && !historyLoading && (
                  <p className="p-4 text-center text-sm text-gray-400">尚無歷史記錄</p>
                )}
                {history.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => void handleLoadHistory(r.id)}
                    className={`group flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-sky-50 ${activeHistoryId === r.id ? 'bg-sky-50' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span
                        className="flex-1 truncate text-sm font-medium text-gray-700"
                        title={r.file_name}
                      >
                        {r.file_name}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => void handleDeleteHistory(e, r.id)}
                        className="shrink-0 rounded p-0.5 text-gray-300 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                        title="刪除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <span className="text-xs text-gray-400">{r.profile_name}</span>
                    <span className="text-xs text-gray-300">{formatDate(r.created_at)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          </div>{/* end 主體 */}
        </div>
      </div>
    </div>
  )
}
