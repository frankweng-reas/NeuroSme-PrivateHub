/**
 * 圖片 → 結構化 MD（含萃取設定管理）
 * 作為 DocRefiner image-md 模式的主畫面
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Database,
  FileText,
  GripVertical,
  ImageIcon,
  Link,
  Loader2,
  Pencil,
  Plus,
  Save,
  ScanText,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  createDocImageConfig,
  deleteDocImageConfig,
  deleteDocImageHistoryItem,
  importDocImageToKB,
  listDocImageConfigs,
  listDocImageHistory,
  processDocImage,
  updateDocImageConfig,
  updateDocImageHistoryMarkdown,
  type DocImageConfig,
  type DocImageHistoryItem,
  type ExtractionTopic,
} from '@/api/docImageRefiner'
import { listKBs, type KBOption } from '@/api/docRefiner'
import ConfirmModal from '@/components/ConfirmModal'

const SIDEBAR_BG = '#1A3A52'
const PANEL_BG = '#1A3A52'
const ACCEPT_TYPES = '.jpg,.jpeg,.png,.webp,.pdf'

// ── 小工具 ────────────────────────────────────────────────────────────────────

function topicListText(topics: ExtractionTopic[]): string {
  return topics.map((t) => t.name).join('、') || '（未設定主題）'
}

// ══════════════════════════════════════════════════
// 主元件
// ══════════════════════════════════════════════════

interface DocImageMdModeProps {
  model: string
}

export default function DocImageMdMode({ model }: DocImageMdModeProps) {
  const [configs, setConfigs] = useState<DocImageConfig[]>([])
  const [selectedConfig, setSelectedConfig] = useState<DocImageConfig | null>(null)

  // config 表單
  const [showConfigForm, setShowConfigForm] = useState(false)
  const [editingConfig, setEditingConfig] = useState<DocImageConfig | null>(null)
  const [configName, setConfigName] = useState('')
  const [topics, setTopics] = useState<ExtractionTopic[]>([])
  const [savingConfig, setSavingConfig] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DocImageConfig | null>(null)

  // 上傳 & 處理
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 結果
  const [resultMarkdown, setResultMarkdown] = useState('')
  const [resultFilename, setResultFilename] = useState('')
  const [resultHistoryId, setResultHistoryId] = useState<number | null>(null)
  const [stage, setStage] = useState<'upload' | 'result'>('upload')

  // KB 匯入
  const [kbs, setKbs] = useState<KBOption[]>([])
  const [showImportModal, setShowImportModal] = useState(false)
  const [importKbId, setImportKbId] = useState<number | null>(null)
  const [importing, setImporting] = useState(false)
  const [importSuccess, setImportSuccess] = useState<{ kbName: string } | null>(null)

  // 歷史記錄
  const [history, setHistory] = useState<DocImageHistoryItem[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [deleteHistTarget, setDeleteHistTarget] = useState<DocImageHistoryItem | null>(null)

  // ── 載入 ──────────────────────────────────────────────────────────────────

  const loadConfigs = useCallback(async () => {
    try {
      const list = await listDocImageConfigs()
      setConfigs(list)
    } catch { /* ignore */ }
  }, [])

  const loadHistory = useCallback(async (configId: number) => {
    try {
      const items = await listDocImageHistory(configId)
      setHistory(items)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { void loadConfigs() }, [loadConfigs])

  useEffect(() => {
    if (selectedConfig) void loadHistory(selectedConfig.id)
    else setHistory([])
  }, [selectedConfig, loadHistory])

  // ── Config 表單 ───────────────────────────────────────────────────────────

  function openNewConfig() {
    setEditingConfig(null)
    setConfigName('')
    setTopics([{ name: '', hint: '' }])
    setShowConfigForm(true)
  }

  function openEditConfig(cfg: DocImageConfig, e: React.MouseEvent) {
    e.stopPropagation()
    setEditingConfig(cfg)
    setConfigName(cfg.name)
    setTopics(cfg.extraction_topics.length > 0 ? cfg.extraction_topics : [{ name: '', hint: '' }])
    setShowConfigForm(true)
  }

  async function handleSaveConfig() {
    if (!configName.trim()) return
    const validTopics = topics.filter((t) => t.name.trim())
    setSavingConfig(true)
    try {
      if (editingConfig) {
        const updated = await updateDocImageConfig(editingConfig.id, {
          name: configName.trim(),
          extraction_topics: validTopics,
        })
        setConfigs((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
        if (selectedConfig?.id === updated.id) setSelectedConfig(updated)
      } else {
        const created = await createDocImageConfig({
          name: configName.trim(),
          model: '',
          extraction_topics: validTopics,
        })
        setConfigs((prev) => [created, ...prev])
        setSelectedConfig(created)
      }
      setShowConfigForm(false)
    } catch (err) {
      alert(err instanceof Error ? err.message : '儲存失敗')
    } finally {
      setSavingConfig(false)
    }
  }

  async function handleDeleteConfig() {
    if (!deleteTarget) return
    try {
      await deleteDocImageConfig(deleteTarget.id)
      setConfigs((prev) => prev.filter((c) => c.id !== deleteTarget.id))
      if (selectedConfig?.id === deleteTarget.id) {
        setSelectedConfig(null)
        resetResult()
      }
    } catch { /* ignore */ }
    setDeleteTarget(null)
  }

  // ── Topic 編輯 ────────────────────────────────────────────────────────────

  function addTopic() {
    setTopics((prev) => [...prev, { name: '', hint: '' }])
  }

  function updateTopic(idx: number, field: 'name' | 'hint', value: string) {
    setTopics((prev) => prev.map((t, i) => (i === idx ? { ...t, [field]: value } : t)))
  }

  function removeTopic(idx: number) {
    setTopics((prev) => prev.filter((_, i) => i !== idx))
  }

  // ── 上傳 & 處理 ───────────────────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    e.target.value = ''
    setFile(f)
    setError(null)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f) { setFile(f); setError(null) }
  }

  function resetResult() {
    setStage('upload')
    setResultMarkdown('')
    setResultFilename('')
    setResultHistoryId(null)
    setImportSuccess(null)
  }

  async function handleProcess() {
    if (!file || !selectedConfig) return
    setProcessing(true)
    setError(null)
    try {
      const result = await processDocImage(selectedConfig.id, file, model || undefined)
      setResultMarkdown(result.result_markdown)
      setResultFilename(result.filename)
      setResultHistoryId(result.id)
      setStage('result')
      void loadHistory(selectedConfig.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : '處理失敗')
    } finally {
      setProcessing(false)
    }
  }

  // ── KB 匯入 ───────────────────────────────────────────────────────────────

  async function openImportModal() {
    const list = await listKBs({ writable: true })
    setKbs(list)
    setImportKbId(list[0]?.id ?? null)
    setShowImportModal(true)
  }

  async function handleImport() {
    if (!selectedConfig) return
    setImporting(true)
    try {
      const res = await importDocImageToKB({
        title: resultFilename || selectedConfig.name,
        markdown: resultMarkdown,
        kb_id: importKbId ?? undefined,
      })
      setImportSuccess({ kbName: res.kb_name })
      setShowImportModal(false)
    } catch (err) {
      alert(err instanceof Error ? err.message : '匯入失敗')
    } finally {
      setImporting(false)
    }
  }

  // ── 歷史還原 ──────────────────────────────────────────────────────────────

  function restoreHistory(item: DocImageHistoryItem) {
    setResultMarkdown(item.result_markdown)
    setResultFilename(item.filename)
    setResultHistoryId(item.id)
    setStage('result')
    setImportSuccess(null)
    setShowHistory(false)
  }

  async function handleDeleteHist() {
    if (!deleteHistTarget || !selectedConfig) return
    try {
      await deleteDocImageHistoryItem(selectedConfig.id, deleteHistTarget.id)
      setHistory((prev) => prev.filter((h) => h.id !== deleteHistTarget.id))
    } catch { /* ignore */ }
    setDeleteHistTarget(null)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">

      {/* ── Confirm modals ── */}
      <ConfirmModal
        open={deleteTarget !== null}
        title="刪除設定"
        message={`確定要刪除「${deleteTarget?.name}」？相關歷史記錄也會一併刪除。`}
        confirmText="刪除"
        variant="danger"
        onConfirm={handleDeleteConfig}
        onCancel={() => setDeleteTarget(null)}
      />
      <ConfirmModal
        open={deleteHistTarget !== null}
        title="刪除歷史記錄"
        message="確定要刪除這筆歷史記錄？"
        confirmText="刪除"
        variant="danger"
        onConfirm={handleDeleteHist}
        onCancel={() => setDeleteHistTarget(null)}
      />

      {/* ── 左側：設定列表 ── */}
      <div
        className="flex w-64 shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md"
        style={{ backgroundColor: SIDEBAR_BG }}
      >
        <div className="flex items-center justify-between px-3 py-3 border-b border-white/20">
          <span className="text-base font-semibold text-white">萃取設定</span>
          <button
            type="button"
            onClick={openNewConfig}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-white/70 hover:bg-white/10 hover:text-white"
          >
            <Plus className="h-4 w-4" />
            新增
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-2 px-1.5">
          {configs.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-white/40">尚無設定<br />點上方「新增」建立</p>
          ) : (
            configs.map((cfg) => (
              <button
                key={cfg.id}
                type="button"
                onClick={() => { setSelectedConfig(cfg); resetResult(); setShowHistory(false) }}
                className={`group mb-1 flex w-full items-start gap-2 rounded-lg px-2 py-2.5 text-left transition-colors ${
                  selectedConfig?.id === cfg.id
                    ? 'bg-sky-500/30 text-white'
                    : 'text-white/65 hover:bg-white/10 hover:text-white'
                }`}
              >
                <ScanText className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium">{cfg.name}</p>
                  <p className="truncate text-sm opacity-60">{topicListText(cfg.extraction_topics)}</p>
                </div>
                <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100">
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => openEditConfig(cfg, e)}
                    onKeyDown={(e) => e.key === 'Enter' && openEditConfig(cfg, e as unknown as React.MouseEvent)}
                    className="rounded p-0.5 hover:bg-white/20"
                    title="編輯"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(cfg) }}
                    onKeyDown={(e) => e.key === 'Enter' && setDeleteTarget(cfg)}
                    className="rounded p-0.5 hover:bg-red-500/30 text-red-300"
                    title="刪除"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── 右側：主畫面 ── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/20 shadow-md" style={{ backgroundColor: PANEL_BG }}>

        {showConfigForm ? (
          /* ── 設定表單 ── */
          <ConfigForm
            editing={editingConfig}
            name={configName}
            topics={topics}
            saving={savingConfig}
            onNameChange={setConfigName}
            onAddTopic={addTopic}
            onUpdateTopic={updateTopic}
            onRemoveTopic={removeTopic}
            onSave={handleSaveConfig}
            onCancel={() => setShowConfigForm(false)}
          />
        ) : !selectedConfig ? (
          /* ── 未選設定 ── */
          <EmptyState onNew={openNewConfig} />
        ) : showHistory ? (
          /* ── 歷史記錄 ── */
          <HistoryPanel
            configName={selectedConfig.name}
            history={history}
            onRestore={restoreHistory}
            onDelete={(h) => setDeleteHistTarget(h)}
            onBack={() => setShowHistory(false)}
          />
        ) : stage === 'upload' ? (
          /* ── 上傳區 ── */
          <UploadPanel
            config={selectedConfig}
            file={file}
            processing={processing}
            error={error}
            fileInputRef={fileInputRef}
            historyCount={history.length}
            onFileChange={handleFileChange}
            onDrop={handleDrop}
            onProcess={handleProcess}
            onEditConfig={(e) => openEditConfig(selectedConfig, e)}
            onShowHistory={() => setShowHistory(true)}
          />
        ) : (
          /* ── 結果區 ── */
          <ResultPanel
            filename={resultFilename}
            markdown={resultMarkdown}
            importing={importing}
            importSuccess={importSuccess}
            configId={selectedConfig.id}
            historyId={resultHistoryId}
            onMarkdownChange={setResultMarkdown}
            onImport={openImportModal}
            onReupload={resetResult}
          />
        )}
      </div>

      {/* ── KB 匯入 modal ── */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#1A3A52] border border-white/20 shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/20">
              <h3 className="text-base font-semibold text-white">匯入至知識庫</h3>
              <button type="button" onClick={() => setShowImportModal(false)} className="text-white/60 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-white/70">選擇知識庫</label>
                <select
                  value={importKbId ?? ''}
                  onChange={(e) => setImportKbId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                >
                  {kbs.map((kb) => (
                    <option key={kb.id} value={kb.id}>{kb.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-white/20">
              <button type="button" onClick={() => setShowImportModal(false)} className="rounded-lg px-4 py-2 text-sm text-white/70 hover:text-white">
                取消
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={importing || !importKbId}
                className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                匯入
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════
// 子元件
// ══════════════════════════════════════════════════

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center">
        <ScanText className="mx-auto mb-4 h-12 w-12 text-white/20" />
        <p className="mb-2 text-base font-medium text-white/60">請先選擇或建立萃取設定</p>
        <p className="mb-6 text-sm text-white/40">每種圖片類型（工程圖、產品圖…）可建立不同設定</p>
        <button
          type="button"
          onClick={onNew}
          className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-sky-500"
        >
          <Plus className="h-4 w-4" />
          建立第一個設定
        </button>
      </div>
    </div>
  )
}

// ── 設定表單 ──────────────────────────────────────

interface ConfigFormProps {
  editing: DocImageConfig | null
  name: string
  topics: ExtractionTopic[]
  saving: boolean
  onNameChange: (v: string) => void
  onAddTopic: () => void
  onUpdateTopic: (idx: number, field: 'name' | 'hint', value: string) => void
  onRemoveTopic: (idx: number) => void
  onSave: () => void
  onCancel: () => void
}

function ConfigForm({
  editing, name, topics, saving,
  onNameChange, onAddTopic, onUpdateTopic, onRemoveTopic, onSave, onCancel,
}: ConfigFormProps) {

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/20 px-5 py-3.5">
        <h3 className="text-base font-semibold text-white">
          {editing ? '編輯設定' : '新增設定'}
        </h3>
        <button type="button" onClick={onCancel} className="text-white/60 hover:text-white">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* 名稱 */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-white/70">設定名稱 *</label>
          <input
            type="text"
            placeholder="例：工程圖、產品圖、合約文件"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-sky-400 focus:outline-none"
          />
        </div>

        {/* 萃取主題 */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium text-white/70">萃取主題</label>
            <button
              type="button"
              onClick={onAddTopic}
              className="flex items-center gap-1 text-sm text-sky-400 hover:text-sky-300"
            >
              <Plus className="h-3.5 w-3.5" />
              新增主題
            </button>
          </div>
          <p className="mb-3 text-sm text-white/40">
            每個主題定義要從圖片中萃取的資訊，LLM 只輸出相關的段落。
          </p>
          <div className="space-y-2">
            {topics.map((topic, idx) => (
              <div key={idx} className="flex items-start gap-2 rounded-lg bg-white/5 p-2">
                <GripVertical className="mt-2.5 h-4 w-4 shrink-0 text-white/20 cursor-grab" />
                <div className="flex-1 space-y-1.5">
                  <input
                    type="text"
                    placeholder="主題名稱（例：材質、尺寸、付款條款）"
                    value={topic.name}
                    onChange={(e) => onUpdateTopic(idx, 'name', e.target.value)}
                    className="w-full rounded border border-white/20 bg-transparent px-2 py-1 text-sm text-white placeholder-white/30 focus:border-sky-400 focus:outline-none"
                  />
                  <input
                    type="text"
                    placeholder="說明 / hint（選填，幫助 LLM 找到正確內容）"
                    value={topic.hint}
                    onChange={(e) => onUpdateTopic(idx, 'hint', e.target.value)}
                    className="w-full rounded border border-white/20 bg-transparent px-2 py-1 text-sm text-white/70 placeholder-white/25 focus:border-sky-400 focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveTopic(idx)}
                  disabled={topics.length <= 1}
                  className="mt-1 rounded p-1 text-white/40 hover:bg-red-500/20 hover:text-red-400 disabled:opacity-20"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-white/20 px-5 py-3">
        <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-white/70 hover:text-white">
          取消
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !name.trim()}
          className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          儲存
        </button>
      </div>
    </div>
  )
}

// ── 上傳面板 ──────────────────────────────────────

interface UploadPanelProps {
  config: DocImageConfig
  file: File | null
  processing: boolean
  error: string | null
  fileInputRef: React.RefObject<HTMLInputElement>
  historyCount: number
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onDrop: (e: React.DragEvent) => void
  onProcess: () => void
  onEditConfig: (e: React.MouseEvent) => void
  onShowHistory: () => void
}

function UploadPanel({
  config, file, processing, error, fileInputRef, historyCount,
  onFileChange, onDrop, onProcess, onEditConfig, onShowHistory,
}: UploadPanelProps) {
  const [dragOver, setDragOver] = useState(false)

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* config info bar */}
      <div className="flex items-center justify-between border-b border-white/20 px-5 py-3">
        <div className="flex items-center gap-2">
          <ScanText className="h-4 w-4 text-sky-400" />
          <span className="text-sm font-medium text-white">{config.name}</span>
          <span className="text-sm text-white/40">·</span>
          <span className="text-sm text-white/50 truncate max-w-64">
            {topicListText(config.extraction_topics)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {historyCount > 0 && (
            <button
              type="button"
              onClick={onShowHistory}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-white/60 hover:bg-white/10 hover:text-white"
            >
              <FileText className="h-4 w-4" />
              歷史（{historyCount}）
            </button>
          )}
          <button
            type="button"
            onClick={onEditConfig}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-white/60 hover:bg-white/10 hover:text-white"
          >
            <Pencil className="h-3.5 w-3.5" />
            編輯設定
          </button>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-lg space-y-5">
          {/* 拖拽上傳區 */}
          <div
            className={`relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 transition-colors cursor-pointer ${
              dragOver ? 'border-sky-400 bg-sky-400/10' : 'border-white/20 hover:border-white/40'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { setDragOver(false); onDrop(e) }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_TYPES}
              className="hidden"
              onChange={onFileChange}
            />
            {file ? (
              <>
                <ImageIcon className="mb-3 h-10 w-10 text-sky-400" />
                <p className="text-base font-medium text-white">{file.name}</p>
                <p className="text-sm text-white/50">{(file.size / 1024).toFixed(0)} KB · 點擊更換</p>
              </>
            ) : (
              <>
                <Upload className="mb-3 h-10 w-10 text-white/30" />
                <p className="text-base font-medium text-white/70">拖曳或點擊上傳</p>
                <p className="mt-1 text-sm text-white/40">支援 JPEG、PNG、WEBP、PDF</p>
              </>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          <button
            type="button"
            onClick={onProcess}
            disabled={!file || processing}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 py-3 text-base font-medium text-white hover:bg-sky-500 disabled:opacity-50 transition-colors"
          >
            {processing ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                OCR + 萃取中…（視圖片大小需 30–120 秒）
              </>
            ) : (
              <>
                <ScanText className="h-5 w-5" />
                開始處理
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 結果面板 ──────────────────────────────────────

interface ResultPanelProps {
  filename: string
  markdown: string
  importing: boolean
  importSuccess: { kbName: string } | null
  configId: number
  historyId: number | null
  onMarkdownChange: (v: string) => void
  onImport: () => void
  onReupload: () => void
}

function ResultPanel({
  filename, markdown, importing, importSuccess,
  configId, historyId,
  onMarkdownChange, onImport, onReupload,
}: ResultPanelProps) {
  const [copied, setCopied] = useState(false)
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [urlValue, setUrlValue] = useState('')
  const urlInputRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function saveMarkdown(md: string) {
    if (!historyId) return
    setSaving(true)
    try {
      await updateDocImageHistoryMarkdown(configId, historyId, md)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch { /* silent fail */ }
    finally { setSaving(false) }
  }

  function handleCopy() {
    void navigator.clipboard.writeText(markdown)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function openUrlInput() {
    setUrlValue('')
    setShowUrlInput(true)
    setTimeout(() => urlInputRef.current?.focus(), 50)
  }

  function handleInsertUrl() {
    const url = urlValue.trim()
    if (!url) return
    const separator = markdown.endsWith('\n') ? '\n' : '\n\n'
    const newMd = markdown + separator + `[原圖連結](${url})`
    onMarkdownChange(newMd)
    setShowUrlInput(false)
    setUrlValue('')
    void saveMarkdown(newMd)
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* 工具列 */}
      <div className="flex items-center justify-between border-b border-white/20 px-5 py-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-sky-400" />
          <span className="text-sm font-medium text-white truncate max-w-72">{filename}</span>
        </div>
        <div className="flex items-center gap-2">
          {importSuccess && (
            <span className="flex items-center gap-1 text-sm text-green-400">
              <CheckCircle2 className="h-4 w-4" />
              已匯入「{importSuccess.kbName}」
            </span>
          )}
          {saving && <span className="text-xs text-white/40">儲存中…</span>}
          {saved && !saving && (
            <span className="flex items-center gap-1 text-xs text-white/40">
              <CheckCircle2 className="h-3 w-3" />
              已儲存
            </span>
          )}
          {/* 插入 URL */}
          <div className="relative">
            <button
              type="button"
              onClick={showUrlInput ? () => setShowUrlInput(false) : openUrlInput}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                showUrlInput
                  ? 'bg-sky-500/20 text-sky-300'
                  : 'text-white/70 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Link className="h-4 w-4" />
              插入 URL
            </button>
            {showUrlInput && (
              <div className="absolute right-0 top-full z-20 mt-1.5 flex w-80 items-center gap-2 rounded-xl border border-white/20 bg-[#1A3A52] p-2.5 shadow-xl">
                <input
                  ref={urlInputRef}
                  type="url"
                  placeholder="https://..."
                  value={urlValue}
                  onChange={(e) => setUrlValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleInsertUrl()
                    if (e.key === 'Escape') setShowUrlInput(false)
                  }}
                  className="flex-1 rounded-lg border border-white/20 bg-white/10 px-2.5 py-1.5 text-sm text-white placeholder-white/30 focus:border-sky-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleInsertUrl}
                  disabled={!urlValue.trim()}
                  className="shrink-0 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
                >
                  插入
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-white/70 hover:bg-white/10 hover:text-white"
          >
            {copied ? <CheckCircle2 className="h-4 w-4 text-green-400" /> : <ScanText className="h-4 w-4" />}
            {copied ? '已複製' : '複製 MD'}
          </button>
          <button
            type="button"
            onClick={onImport}
            disabled={importing}
            className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            匯入知識庫
          </button>
          <button
            type="button"
            onClick={onReupload}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-white/70 hover:bg-white/10 hover:text-white"
          >
            <Upload className="h-4 w-4" />
            換檔案
          </button>
        </div>
      </div>

      {/* Markdown 編輯器 */}
      <div className="flex-1 overflow-hidden p-4">
        <textarea
          value={markdown}
          onChange={(e) => onMarkdownChange(e.target.value)}
          onBlur={(e) => void saveMarkdown(e.target.value)}
          className="h-full w-full resize-none rounded-xl border border-white/20 bg-white/5 p-4 font-mono text-sm text-white/90 placeholder-white/30 focus:border-sky-400 focus:outline-none"
          placeholder="萃取結果將顯示在這裡，可直接編輯後再匯入知識庫&#10;&#10;插入 URL 後格式：[原圖連結](https://...)"
          spellCheck={false}
        />
      </div>
    </div>
  )
}

// ── 歷史記錄面板 ──────────────────────────────────

interface HistoryPanelProps {
  configName: string
  history: DocImageHistoryItem[]
  onRestore: (item: DocImageHistoryItem) => void
  onDelete: (item: DocImageHistoryItem) => void
  onBack: () => void
}

function HistoryPanel({ configName, history, onRestore, onDelete, onBack }: HistoryPanelProps) {
  const [expanded, setExpanded] = useState<number | null>(null)

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-white/20 px-5 py-3">
        <button type="button" onClick={onBack} className="text-white/60 hover:text-white text-sm">
          ← 返回
        </button>
        <span className="text-sm font-medium text-white">{configName} · 歷史記錄</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {history.length === 0 ? (
          <p className="py-8 text-center text-sm text-white/40">尚無歷史記錄</p>
        ) : (
          history.map((item) => (
            <div key={item.id} className="rounded-xl border border-white/10 bg-white/5">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-white">{item.filename}</p>
                  <p className="text-xs text-white/40">
                    {new Date(item.created_at).toLocaleString('zh-TW')}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                    className="rounded-lg px-2 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white"
                  >
                    <ChevronDown className={`h-4 w-4 transition-transform ${expanded === item.id ? 'rotate-180' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRestore(item)}
                    className="rounded-lg px-2.5 py-1 text-xs text-sky-400 hover:bg-sky-500/20"
                  >
                    還原
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(item)}
                    className="rounded-lg p-1 text-white/40 hover:bg-red-500/20 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {expanded === item.id && (
                <div className="border-t border-white/10 px-4 py-3">
                  <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-xs text-white/70">
                    {item.result_markdown || '（無結果）'}
                  </pre>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
