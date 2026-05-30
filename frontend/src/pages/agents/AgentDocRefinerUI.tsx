/**
 * Doc Refiner Agent UI（agent_id = doc-refiner）
 * Sidebar 切換模式：
 *   doc  - 文件 → FAQ
 *   note - 筆記 → FAQ
 *   sop  - SOP → FAQ
 *   md   - 文件 → 結構化 MD
 *   web-md - 網頁 → MD
 *   md-batch - 批次 → 結構化 MD
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import {
  BookOpen,
  ChevronRight,
  Clipboard,
  ClipboardCheck,
  ClipboardList,
  Copy,
  Download,
  FileCode2,
  FileText,
  Files,
  FolderOpen,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  processDocumentStream,
  toMarkdownStream,
  importMdToKB,
  exportTxt,
  fetchWebPreview,
  listKBs,
  importToKB,
  rewriteQAItem,
  webToMarkdownStream,
  type WebPreviewResponse,
  type TokenUsage,
  type QAItem,
  type KBOption,
} from '@/api/docRefiner'
import AgentHeader from '@/components/AgentHeader'
import ConfirmModal from '@/components/ConfirmModal'
import ErrorModal from '@/components/ErrorModal'
import HelpModal from '@/components/HelpModal'
import ProcessingModal from '@/components/ProcessingModal'
import LLMModelSelect from '@/components/LLMModelSelect'
import {
  createBatchItems,
  isBatchItemRunnable,
  isFileSystemAccessSupported,
  isStructuredMdFile,
  pickOutputDirectory,
  runBatch,
  type BatchFileItem,
  type BatchSummary,
} from '@/lib/structuredMdBatch'
import type { Agent } from '@/types'

interface Props { agent: Agent }

type Stage = 'upload' | 'edit'
type Mode = 'doc' | 'note' | 'sop' | 'md' | 'md-batch' | 'web-md'

const MD_ACCEPT_RE = /\.pdf$/i
const MD_ACCEPT_ATTR = '.pdf'

const HEADER_COLOR = '#1A3A52'

function faqProcessingStatus(progress: { current: number; total: number } | null): string {
  if (progress && progress.total > 1) return 'AI 萃取 Q&A 中…'
  return 'AI 整理中…'
}

const NAV_ITEMS: { id: Mode; label: string; icon: React.ReactNode }[] = [
  { id: 'doc',  label: '文件 → FAQ',        icon: <FileText      className="h-4 w-4 shrink-0" /> },
  { id: 'note', label: '筆記 → FAQ',        icon: <BookOpen      className="h-4 w-4 shrink-0" /> },
  { id: 'sop',  label: 'SOP → FAQ',         icon: <ClipboardList className="h-4 w-4 shrink-0" /> },
  { id: 'md',   label: '文件 → 結構化 MD',  icon: <FileCode2     className="h-4 w-4 shrink-0" /> },
  { id: 'web-md', label: '網頁 → MD',         icon: <Globe         className="h-4 w-4 shrink-0" /> },
  { id: 'md-batch', label: '批次 → 結構化 MD', icon: <Files       className="h-4 w-4 shrink-0" /> },
]

export default function AgentDocRefinerUI({ agent }: Props) {
  // ── Mode & Sidebar ──
  const [mode, setMode] = useState<Mode>('doc')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // ── 階段（doc mode 專用）──
  const [stage, setStage] = useState<Stage>('edit')

  // ── 上傳設定 ──
  const [file, setFile] = useState<File | null>(null)
  const [model, setModel] = useState('')
  const [processing, setProcessing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── 整理結果（可編輯）──
  const [items, setItems] = useState<QAItem[]>(() => {
    try { return JSON.parse(localStorage.getItem('doc-refiner:doc:items') ?? 'null') ?? [] } catch { return [] }
  })
  const [title, setTitle] = useState<string>(() =>
    localStorage.getItem('doc-refiner:doc:title') ?? ''
  )
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  // SSE 進度
  const [chunkProgress, setChunkProgress] = useState<{ current: number; total: number } | null>(null)
  // 完成後的 usage / model（用於 footer）
  const [doneInfo, setDoneInfo] = useState<{ usage: TokenUsage; model: string } | null>(null)
  // abort controller
  const abortRef = useRef<AbortController | null>(null)

  // ── 匯出 ──
  const [_exportingTxt, setExportingTxt] = useState(false)

  // ── 匯入至 KB ──
  const [_importSuccess, setImportSuccess] = useState<{ kbName: string; count: number } | null>(null)
  const [downloadModalOpen, setDownloadModalOpen] = useState(false)

  // ── Note mode 獨立狀態 ──
  const [noteText, setNoteText] = useState<string>(() =>
    localStorage.getItem('doc-refiner:note:text') ?? ''
  )
  const [noteTitle, setNoteTitle] = useState<string>(() =>
    localStorage.getItem('doc-refiner:note:title') ?? '筆記整理'
  )
  const [noteItems, setNoteItems] = useState<QAItem[]>(() => {
    try { return JSON.parse(localStorage.getItem('doc-refiner:note:items') ?? 'null') ?? [] } catch { return [] }
  })
  const [_noteImportSuccess, setNoteImportSuccess] = useState<{ kbName: string; count: number } | null>(null)
  const [noteDownloadModalOpen, setNoteDownloadModalOpen] = useState(false)
  const [_noteExportingTxt, setNoteExportingTxt] = useState(false)
  const [noteProcessing, setNoteProcessing] = useState(false)
  const [noteChunkProgress, setNoteChunkProgress] = useState<{ current: number; total: number } | null>(null)
  const [noteDoneInfo, setNoteDoneInfo] = useState<{ usage: TokenUsage; model: string } | null>(null)
  const noteAbortRef = useRef<AbortController | null>(null)

  // ── SOP mode 獨立狀態 ──
  const [sopFile, setSopFile] = useState<File | null>(null)
  const [sopPdfUrl, setSopPdfUrl] = useState<string | null>(null)
  const [sopTitle, setSopTitle] = useState<string>(() =>
    localStorage.getItem('doc-refiner:sop:title') ?? ''
  )
  const [sopItems, setSopItems] = useState<QAItem[]>(() => {
    try { return JSON.parse(localStorage.getItem('doc-refiner:sop:items') ?? 'null') ?? [] } catch { return [] }
  })
  const [sopProcessing, setSopProcessing] = useState(false)
  const [sopChunkProgress, setSopChunkProgress] = useState<{ current: number; total: number } | null>(null)
  const [sopDoneInfo, setSopDoneInfo] = useState<{ usage: TokenUsage; model: string } | null>(null)
  const sopAbortRef = useRef<AbortController | null>(null)
  const [sopReuploadModalOpen, setSopReuploadModalOpen] = useState(false)
  const [sopDownloadModalOpen, setSopDownloadModalOpen] = useState(false)
  const [_sopImportSuccess, setSopImportSuccess] = useState<{ kbName: string; count: number } | null>(null)

  // ── MD mode 狀態 ──
  const [mdFile, setMdFile] = useState<File | null>(null)
  const [mdPdfUrl, setMdPdfUrl] = useState<string | null>(null)
  const [mdContent, setMdContent] = useState<string>(() =>
    localStorage.getItem('doc-refiner:md:content') ?? ''
  )
  const [mdTitle, setMdTitle] = useState<string>(() =>
    localStorage.getItem('doc-refiner:md:title') ?? ''
  )
  const [mdProcessing, setMdProcessing] = useState(false)
  const [mdChunkProgress, setMdChunkProgress] = useState<{ current: number; total: number } | null>(null)
  const [mdExtractStatus, setMdExtractStatus] = useState<string | null>(null)
  const [mdDoneInfo, setMdDoneInfo] = useState<{ usage: TokenUsage; model: string } | null>(null)
  const mdAbortRef = useRef<AbortController | null>(null)
  const mdFileInputRef = useRef<HTMLInputElement>(null)
  const mdStageRef = useRef<'upload' | 'edit'>(
    localStorage.getItem('doc-refiner:md:content') ? 'edit' : 'upload'
  )
  const [mdStage, setMdStage] = useState<'upload' | 'edit'>(mdStageRef.current)

  const [mdImportOpen, setMdImportOpen] = useState(false)
  const [mdKBs, setMdKBs] = useState<KBOption[]>([])
  const [mdImporting, setMdImporting] = useState(false)
  const [mdImportSuccess, setMdImportSuccess] = useState<{ kbName: string; count: number } | null>(null)

  // ── MD batch mode 狀態 ──
  const [batchItems, setBatchItems] = useState<BatchFileItem[]>([])
  const [batchOutputDir, setBatchOutputDir] = useState<FileSystemDirectoryHandle | null>(null)
  const [batchOutputDirName, setBatchOutputDirName] = useState('')
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null)
  const [batchProgress, setBatchProgress] = useState<{
    fileName: string
    fileIndex: number
    fileTotal: number
    status: string
    chunk: { current: number; total: number } | null
  } | null>(null)
  const batchAbortRef = useRef<AbortController | null>(null)
  const batchQueueTotalRef = useRef(0)
  const batchFileInputRef = useRef<HTMLInputElement>(null)

  // ── 網頁 → MD 狀態 ──
  type WebMdStage = 'input' | 'preview' | 'edit'
  const [webMdStage, setWebMdStage] = useState<WebMdStage>('input')
  const [webMdUrl, setWebMdUrl] = useState('')
  const [webMdFetching, setWebMdFetching] = useState(false)
  const [webMdPreview, setWebMdPreview] = useState<WebPreviewResponse | null>(null)
  const [webMdTitle, setWebMdTitle] = useState('')
  const [webMdContent, setWebMdContent] = useState('')
  const [webMdProcessing, setWebMdProcessing] = useState(false)
  const [webMdChunkProgress, setWebMdChunkProgress] = useState<{ current: number; total: number } | null>(null)
  const [webMdExtractStatus, setWebMdExtractStatus] = useState<string | null>(null)
  const [webMdDoneInfo, setWebMdDoneInfo] = useState<{ usage: TokenUsage; model: string } | null>(null)
  const webMdAbortRef = useRef<AbortController | null>(null)
  const [webMdImportOpen, setWebMdImportOpen] = useState(false)
  const [webMdKBs, setWebMdKBs] = useState<KBOption[]>([])
  const [webMdImporting, setWebMdImporting] = useState(false)
  const [webMdImportSuccess, setWebMdImportSuccess] = useState<{ kbName: string; count: number } | null>(null)

  // ── 錯誤 ──
  const [errorModal, setErrorModal] = useState<{ title?: string; message: string } | null>(null)

  // ── 使用說明 ──
  const [helpOpen, setHelpOpen] = useState(false)

  // ── localStorage 自動存檔 ──
  useEffect(() => {
    if (processing) return
    try { localStorage.setItem('doc-refiner:doc:items', JSON.stringify(items)) } catch { /* ignore */ }
  }, [items, processing])

  useEffect(() => {
    try { localStorage.setItem('doc-refiner:doc:title', title) } catch { /* ignore */ }
  }, [title])

  useEffect(() => {
    if (noteProcessing) return
    try { localStorage.setItem('doc-refiner:note:items', JSON.stringify(noteItems)) } catch { /* ignore */ }
  }, [noteItems, noteProcessing])

  useEffect(() => {
    try { localStorage.setItem('doc-refiner:note:title', noteTitle) } catch { /* ignore */ }
  }, [noteTitle])

  useEffect(() => {
    try { localStorage.setItem('doc-refiner:note:text', noteText) } catch { /* ignore */ }
  }, [noteText])

  useEffect(() => {
    if (sopProcessing) return
    try { localStorage.setItem('doc-refiner:sop:items', JSON.stringify(sopItems)) } catch { /* ignore */ }
  }, [sopItems, sopProcessing])

  useEffect(() => {
    try { localStorage.setItem('doc-refiner:sop:title', sopTitle) } catch { /* ignore */ }
  }, [sopTitle])

  useEffect(() => {
    if (mdProcessing) return
    try { localStorage.setItem('doc-refiner:md:content', mdContent) } catch { /* ignore */ }
  }, [mdContent, mdProcessing])

  useEffect(() => {
    try { localStorage.setItem('doc-refiner:md:title', mdTitle) } catch { /* ignore */ }
  }, [mdTitle])

  // ────────────────────────────────────────────────
  // 檔案選擇
  // ────────────────────────────────────────────────

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.name.toLowerCase().match(/\.(pdf|txt)$/)) {
      setErrorModal({ title: '格式錯誤', message: '目前支援 PDF 或 TXT 格式' })
      return
    }
    setFile(f)
    setPdfUrl(URL.createObjectURL(f))
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (!f) return
    if (!f.name.toLowerCase().match(/\.(pdf|txt)$/)) {
      setErrorModal({ title: '格式錯誤', message: '目前支援 PDF 或 TXT 格式' })
      return
    }
    setFile(f)
    setPdfUrl(URL.createObjectURL(f))
  }

  // ────────────────────────────────────────────────
  // 開始整理
  // ────────────────────────────────────────────────

  // ── 重新上傳 Modal ──
  const [reuploadModalOpen, setReuploadModalOpen] = useState(false)

  // ────────────────────────────────────────────────
  // 開始整理（可由外部傳入 file/model 覆蓋）
  // ────────────────────────────────────────────────

  const handleProcess = async (overrideFile?: File, overrideModel?: string, append = false) => {
    const f = overrideFile ?? file
    const m = overrideModel ?? model
    if (!f) return

    // 取消上次未完成的 stream
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setProcessing(true)
    if (!append) setItems([])
    setDoneInfo(null)
    setChunkProgress(null)
    setTitle(f.name.replace(/\.(pdf|txt)$/i, ''))
    setStage('edit')  // 立即切到 EditStage，讓用戶看到結果逐漸出現

    try {
      for await (const event of processDocumentStream(
        f, m || undefined, abortRef.current.signal, 'doc',
      )) {
        if (event.type === 'meta') {
          setChunkProgress({ current: 0, total: event.chunk_total })
        } else if (event.type === 'items') {
          setItems((prev) => {
            const offset = prev.length > 0 ? Math.max(...prev.map((it) => it.id)) : 0
            return [...prev, ...event.items.map((it) => ({ ...it, id: it.id + offset }))]
          })
          setChunkProgress({ current: event.chunk, total: event.chunk_total })
        } else if (event.type === 'done') {
          setDoneInfo({ usage: event.usage, model: event.model })
          setChunkProgress(null)
          setProcessing(false)
        } else if (event.type === 'error') {
          setErrorModal({ title: '整理失敗', message: event.detail })
          setProcessing(false)
        } else if (event.type === 'chunk_error') {
          // 某段失敗但繼續，不跳錯誤 modal，只 log
          console.warn(`chunk ${event.chunk} 解析失敗：${event.detail}`)
        }
      }
      // 串流正常結束但未收到 done（例如後端非預期中斷），確保 spinner 停止
      setProcessing(false)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setErrorModal({ title: '整理失敗', message: err instanceof Error ? err.message : '處理失敗，請重試' })
      }
      setProcessing(false)
    }
  }

  const handleDocAbort = () => {
    abortRef.current?.abort()
    setProcessing(false)
    setChunkProgress(null)
  }

  // 重新上傳確認：換新檔案後直接開始整理
  const handleReuploadConfirm = (newFile: File, append: boolean) => {
    setFile(newFile)
    setPdfUrl(URL.createObjectURL(newFile))
    setImportSuccess(null)
    setReuploadModalOpen(false)
    void handleProcess(newFile, undefined, append)
  }

  // ────────────────────────────────────────────────
  // 卡片編輯
  // ────────────────────────────────────────────────

  const updateItem = (id: number, patch: Partial<QAItem>) => {
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, ...patch } : it))
  }

  const deleteItem = (id: number) => {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }

  const addItem = () => {
    const newId = Math.max(0, ...items.map((it) => it.id)) + 1
    setItems((prev) => [...prev, { id: newId, question: '', answer: '' }])
  }

  // ────────────────────────────────────────────────
  // 匯入至知識庫
  // ────────────────────────────────────────────────

  const handleImport = async (kbId: number | undefined, newKbName: string | undefined, qaSetName: string) => {
    const res = await importToKB({
      title: qaSetName || title,
      items,
      kb_id: kbId,
      new_kb_name: newKbName,
    })
    setImportSuccess({ kbName: res.kb_name, count: res.imported_count })
  }

  // ────────────────────────────────────────────────
  // 匯出 PDF
  // ────────────────────────────────────────────────

  const handleExportTxt = async (qaSetName?: string) => {
    const name = qaSetName || title
    setExportingTxt(true)
    try {
      const blob = await exportTxt({ title: name, items })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${name || 'qa'}.txt`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setErrorModal({
        title: '匯出失敗',
        message: err instanceof Error ? err.message : '匯出 TXT 失敗',
      })
    } finally {
      setExportingTxt(false)
    }
  }

  // ────────────────────────────────────────────────
  // 重新上傳
  // ────────────────────────────────────────────────

  // ────────────────────────────────────────────────
  // Note mode：Q&A 卡片操作
  // ────────────────────────────────────────────────

  const updateNoteItem = (id: number, patch: Partial<QAItem>) => {
    setNoteItems((prev) => prev.map((it) => it.id === id ? { ...it, ...patch } : it))
  }

  const deleteNoteItem = (id: number) => {
    setNoteItems((prev) => prev.filter((it) => it.id !== id))
  }

  const addNoteItem = () => {
    const newId = Math.max(0, ...noteItems.map((it) => it.id)) + 1
    setNoteItems((prev) => [...prev, { id: newId, question: '', answer: '' }])
  }

  const handleNoteImport = async (kbId: number | undefined, newKbName: string | undefined, qaSetName: string) => {
    const res = await importToKB({ title: qaSetName || noteTitle, items: noteItems, kb_id: kbId, new_kb_name: newKbName })
    setNoteImportSuccess({ kbName: res.kb_name, count: res.imported_count })
  }

  const handleNoteProcess = async () => {
    if (!noteText.trim()) return
    noteAbortRef.current?.abort()
    noteAbortRef.current = new AbortController()

    setNoteProcessing(true)
    setNoteDoneInfo(null)
    setNoteChunkProgress(null)

    // 將文字包成 File 送進既有的串流處理
    const blob = new Blob([noteText], { type: 'text/plain' })
    const file = new File([blob], `${noteTitle || 'note'}.txt`, { type: 'text/plain' })

    try {
      for await (const event of processDocumentStream(
        file, model || undefined, noteAbortRef.current.signal, 'note',
      )) {
        if (event.type === 'meta') {
          setNoteChunkProgress({ current: 0, total: event.chunk_total })
        } else if (event.type === 'items') {
          setNoteItems((prev) => {
            const offset = prev.length > 0 ? Math.max(...prev.map((it) => it.id)) : 0
            return [...prev, ...event.items.map((it) => ({ ...it, id: it.id + offset }))]
          })
          setNoteChunkProgress({ current: event.chunk, total: event.chunk_total })
        } else if (event.type === 'done') {
          setNoteDoneInfo({ usage: event.usage, model: event.model })
          setNoteChunkProgress(null)
          setNoteProcessing(false)
        } else if (event.type === 'error') {
          setErrorModal({ title: '整理失敗', message: event.detail })
          setNoteProcessing(false)
        } else if (event.type === 'chunk_error') {
          console.warn(`chunk ${event.chunk} 解析失敗：${event.detail}`)
        }
      }
      setNoteProcessing(false)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setErrorModal({ title: '整理失敗', message: err instanceof Error ? err.message : '處理失敗，請重試' })
      }
      setNoteProcessing(false)
    }
  }

  const handleNoteAbort = () => {
    noteAbortRef.current?.abort()
    setNoteProcessing(false)
    setNoteChunkProgress(null)
  }

  const handleNoteExportTxt = async (qaSetName?: string) => {
    const name = qaSetName || noteTitle
    setNoteExportingTxt(true)
    try {
      const blob = await exportTxt({ title: name, items: noteItems })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `${name || 'note-qa'}.txt`; a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setErrorModal({ title: '匯出失敗', message: err instanceof Error ? err.message : '匯出 TXT 失敗' })
    } finally {
      setNoteExportingTxt(false)
    }
  }

  // ────────────────────────────────────────────────
  // SOP mode handlers
  // ────────────────────────────────────────────────

  const updateSopItem = (id: number, patch: Partial<QAItem>) => {
    setSopItems((prev) => prev.map((it) => it.id === id ? { ...it, ...patch } : it))
  }
  const deleteSopItem = (id: number) => {
    setSopItems((prev) => prev.filter((it) => it.id !== id))
  }
  const addSopItem = () => {
    const newId = Math.max(0, ...sopItems.map((it) => it.id)) + 1
    setSopItems((prev) => [...prev, { id: newId, question: '', answer: '' }])
  }

  const handleSopProcess = useCallback(async (overrideFile?: File, append = false) => {
    const f = overrideFile ?? sopFile
    if (!f) return
    sopAbortRef.current?.abort()
    sopAbortRef.current = new AbortController()

    setSopProcessing(true)
    if (!append) setSopItems([])
    setSopDoneInfo(null)
    setSopChunkProgress(null)
    setSopTitle(f.name.replace(/\.(pdf|txt)$/i, ''))

    try {
      for await (const event of processDocumentStream(
        f, model || undefined, sopAbortRef.current.signal, 'sop',
      )) {
        if (event.type === 'meta') {
          setSopChunkProgress({ current: 0, total: event.chunk_total })
        } else if (event.type === 'items') {
          setSopItems((prev) => {
            const offset = prev.length > 0 ? Math.max(...prev.map((it) => it.id)) : 0
            return [...prev, ...event.items.map((it) => ({ ...it, id: it.id + offset }))]
          })
          setSopChunkProgress({ current: event.chunk, total: event.chunk_total })
        } else if (event.type === 'done') {
          setSopDoneInfo({ usage: event.usage, model: event.model })
          setSopChunkProgress(null)
          setSopProcessing(false)
        } else if (event.type === 'error') {
          setErrorModal({ title: '整理失敗', message: event.detail })
          setSopProcessing(false)
        } else if (event.type === 'chunk_error') {
          console.warn(`chunk ${event.chunk} 解析失敗：${event.detail}`)
        }
      }
      setSopProcessing(false)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setErrorModal({ title: '整理失敗', message: err instanceof Error ? err.message : '處理失敗，請重試' })
      }
      setSopProcessing(false)
    }
  }, [sopFile, model])

  const handleSopAbort = () => {
    sopAbortRef.current?.abort()
    setSopProcessing(false)
    setSopChunkProgress(null)
  }

  const handleSopReuploadConfirm = (newFile: File, append: boolean) => {
    setSopFile(newFile)
    setSopPdfUrl(URL.createObjectURL(newFile))
    setSopImportSuccess(null)
    setSopReuploadModalOpen(false)
    void handleSopProcess(newFile, append)
  }

  const handleSopImport = async (kbId: number | undefined, newKbName: string | undefined, qaSetName: string) => {
    const res = await importToKB({ title: qaSetName || sopTitle, items: sopItems, kb_id: kbId, new_kb_name: newKbName })
    setSopImportSuccess({ kbName: res.kb_name, count: res.imported_count })
  }

  const handleSopExportTxt = async (qaSetName?: string) => {
    const name = qaSetName || sopTitle
    try {
      const blob = await exportTxt({ title: name, items: sopItems })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `${name || 'sop-qa'}.txt`; a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setErrorModal({ title: '匯出失敗', message: err instanceof Error ? err.message : '匯出 TXT 失敗' })
    }
  }

  // ────────────────────────────────────────────────
  // MD mode：檔案選擇 & 開始整理
  // ────────────────────────────────────────────────

  const handleMdFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!MD_ACCEPT_RE.test(f.name)) {
      setErrorModal({ title: '格式錯誤', message: '文件 → 結構化 MD 僅支援 PDF（Word、網頁請先匯出 PDF）' })
      return
    }
    setMdFile(f)
    setMdPdfUrl(URL.createObjectURL(f))
  }

  const handleMdDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (!f) return
    if (!MD_ACCEPT_RE.test(f.name)) {
      setErrorModal({ title: '格式錯誤', message: '文件 → 結構化 MD 僅支援 PDF（Word、網頁請先匯出 PDF）' })
      return
    }
    setMdFile(f)
    setMdPdfUrl(URL.createObjectURL(f))
  }

  const handleMdProcess = async () => {
    if (!mdFile) return
    mdAbortRef.current?.abort()
    mdAbortRef.current = new AbortController()

    setMdProcessing(true)
    setMdContent('')
    setMdDoneInfo(null)
    setMdChunkProgress(null)
    setMdExtractStatus(null)
    setMdImportSuccess(null)
    setMdTitle(mdFile.name.replace(/\.pdf$/i, ''))
    setMdStage('edit')

    try {
      for await (const event of toMarkdownStream(mdFile, model || undefined, mdAbortRef.current.signal)) {
        if (event.type === 'extract_progress') {
          setMdExtractStatus(event.detail || `第 ${event.page}/${event.page_count} 頁`)
        } else if (event.type === 'meta') {
          setMdExtractStatus(null)
          setMdChunkProgress({ current: 0, total: event.chunk_total })
        } else if (event.type === 'md_chunk') {
          setMdContent((prev) => {
            const sep = prev && !prev.endsWith('\n') ? '\n\n' : prev ? '\n' : ''
            return prev + sep + event.content
          })
          setMdChunkProgress({ current: event.chunk, total: event.chunk_total })
        } else if (event.type === 'done') {
          setMdDoneInfo({ usage: event.usage, model: event.model })
          setMdChunkProgress(null)
          setMdProcessing(false)
        } else if (event.type === 'error') {
          setErrorModal({ title: '整理失敗', message: event.detail })
          setMdProcessing(false)
        }
      }
      setMdProcessing(false)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setErrorModal({ title: '整理失敗', message: err instanceof Error ? err.message : '處理失敗，請重試' })
      }
      setMdProcessing(false)
    }
  }

  const handleMdAbort = () => {
    mdAbortRef.current?.abort()
    setMdProcessing(false)
    setMdChunkProgress(null)
    setMdExtractStatus(null)
  }

  const handleMdDownload = () => {
    if (!mdContent.trim()) return
    const blob = new Blob([mdContent], { type: 'text/markdown; charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${mdTitle || 'document'}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleMdImportOpen = async () => {
    try {
      const kbs = await listKBs()
      setMdKBs(kbs)
    } catch {
      setMdKBs([])
    }
    setMdImportOpen(true)
  }

  const handleMdImport = async (kbId: number | null, newKbName: string) => {
    if (!mdContent.trim()) return
    setMdImporting(true)
    try {
      const res = await importMdToKB({
        title: mdTitle || 'document',
        markdown: mdContent,
        kb_id: kbId ?? undefined,
        new_kb_name: newKbName || undefined,
      })
      setMdImportSuccess({ kbName: res.kb_name, count: res.imported_count })
      setMdImportOpen(false)
    } catch (err) {
      setErrorModal({ title: '匯入失敗', message: err instanceof Error ? err.message : '匯入失敗，請重試' })
    } finally {
      setMdImporting(false)
    }
  }

  const handleWebMdFetchPreview = async () => {
    const url = webMdUrl.trim()
    if (!url) return
    setWebMdFetching(true)
    setWebMdPreview(null)
    try {
      const preview = await fetchWebPreview(url)
      setWebMdPreview(preview)
      setWebMdTitle(preview.title)
      setWebMdStage('preview')
    } catch (err) {
      setErrorModal({
        title: '無法擷取網頁',
        message: err instanceof Error ? err.message : '網頁擷取失敗',
      })
    } finally {
      setWebMdFetching(false)
    }
  }

  const handleWebMdProcess = async () => {
    if (!webMdPreview) return
    webMdAbortRef.current?.abort()
    webMdAbortRef.current = new AbortController()

    setWebMdProcessing(true)
    setWebMdContent('')
    setWebMdDoneInfo(null)
    setWebMdChunkProgress(null)
    setWebMdExtractStatus(null)
    setWebMdImportSuccess(null)
    setWebMdStage('edit')

    try {
      for await (const event of webToMarkdownStream(
        {
          sourceUrl: webMdPreview.source_url,
          title: webMdTitle || webMdPreview.title,
          contentHtml: webMdPreview.content_html,
          model: model || undefined,
        },
        webMdAbortRef.current.signal,
      )) {
        if (event.type === 'extract_progress') {
          setWebMdExtractStatus(event.detail || `第 ${event.page}/${event.page_count} 頁`)
        } else if (event.type === 'meta') {
          setWebMdExtractStatus(null)
          setWebMdChunkProgress({ current: 0, total: event.chunk_total })
        } else if (event.type === 'md_chunk') {
          setWebMdContent((prev) => {
            const sep = prev && !prev.endsWith('\n') ? '\n\n' : prev ? '\n' : ''
            return prev + sep + event.content
          })
          setWebMdChunkProgress({ current: event.chunk, total: event.chunk_total })
        } else if (event.type === 'done') {
          setWebMdDoneInfo({ usage: event.usage, model: event.model })
          setWebMdChunkProgress(null)
          setWebMdProcessing(false)
        } else if (event.type === 'error') {
          setErrorModal({ title: '整理失敗', message: event.detail })
          setWebMdProcessing(false)
        }
      }
      setWebMdProcessing(false)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setErrorModal({ title: '整理失敗', message: err instanceof Error ? err.message : '處理失敗，請重試' })
      }
      setWebMdProcessing(false)
    }
  }

  const handleWebMdAbort = () => {
    webMdAbortRef.current?.abort()
    setWebMdProcessing(false)
    setWebMdChunkProgress(null)
    setWebMdExtractStatus(null)
  }

  const handleWebMdDownload = () => {
    if (!webMdContent.trim()) return
    const blob = new Blob([webMdContent], { type: 'text/markdown; charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${webMdTitle || 'webpage'}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleWebMdImportOpen = async () => {
    try {
      const kbs = await listKBs()
      setWebMdKBs(kbs)
    } catch {
      setWebMdKBs([])
    }
    setWebMdImportOpen(true)
  }

  const handleWebMdImport = async (kbId: number | null, newKbName: string) => {
    if (!webMdContent.trim()) return
    setWebMdImporting(true)
    try {
      const res = await importMdToKB({
        title: webMdTitle || 'webpage',
        markdown: webMdContent,
        kb_id: kbId ?? undefined,
        new_kb_name: newKbName || undefined,
      })
      setWebMdImportSuccess({ kbName: res.kb_name, count: res.imported_count })
      setWebMdImportOpen(false)
    } catch (err) {
      setErrorModal({ title: '匯入失敗', message: err instanceof Error ? err.message : '匯入失敗，請重試' })
    } finally {
      setWebMdImporting(false)
    }
  }

  const handleBatchAddFiles = (incoming: FileList | File[]) => {
    const list = Array.from(incoming).filter(isStructuredMdFile)
    if (list.length === 0) {
      setErrorModal({ title: '格式錯誤', message: '批次轉換僅支援 PDF' })
      return
    }
    // 上一輪已跑完：新選檔案視為新一輪，取代舊 list（避免已存檔項目被重跑）
    if (batchSummary && !batchRunning) {
      setBatchItems(createBatchItems(list))
      setBatchSummary(null)
      return
    }
    setBatchItems((prev) => {
      const existing = new Set(prev.map((i) => `${i.file.name}-${i.file.size}`))
      const added = createBatchItems(list.filter((f) => !existing.has(`${f.name}-${f.size}`)))
      return [...prev, ...added]
    })
    setBatchSummary(null)
  }

  const handleBatchPickDir = async () => {
    try {
      const dir = await pickOutputDirectory()
      setBatchOutputDir(dir)
      setBatchOutputDirName(dir.name)
    } catch (err) {
      setErrorModal({
        title: '無法選擇資料夾',
        message: err instanceof Error ? err.message : '請使用 Chrome 或 Edge',
      })
    }
  }

  const handleBatchStart = async () => {
    if (batchRunning) return

    const queue = batchItems
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => isBatchItemRunnable(item.status))

    if (queue.length === 0) {
      setErrorModal({
        title: '無待處理檔案',
        message: '列表中的 PDF 皆已轉換完成。請加入新檔案，或移除已存檔項目後再試。',
      })
      return
    }
    if (isFileSystemAccessSupported() && !batchOutputDir) {
      setErrorModal({ title: '請先選擇輸出資料夾', message: '批次轉換需指定本機輸出目錄' })
      return
    }

    batchAbortRef.current?.abort()
    batchAbortRef.current = new AbortController()
    batchQueueTotalRef.current = queue.length
    setBatchRunning(true)
    setBatchSummary(null)
    setBatchProgress({
      fileName: queue[0].item.file.name,
      fileIndex: 1,
      fileTotal: queue.length,
      status: '準備中…',
      chunk: null,
    })
    setBatchItems((items) =>
      items.map((i) =>
        i.status === 'saved'
          ? i
          : { ...i, status: 'pending' as const, error: undefined },
      ),
    )

    const summary = await runBatch({
      files: queue.map((q) => q.item.file),
      outputDir: batchOutputDir,
      model: model || undefined,
      signal: batchAbortRef.current.signal,
      onFileStart: (batchIndex, file) => {
        const { index } = queue[batchIndex]
        setBatchProgress({
          fileName: file.name,
          fileIndex: batchIndex + 1,
          fileTotal: batchQueueTotalRef.current,
          status: '讀取 PDF…',
          chunk: null,
        })
        setBatchItems((items) =>
          items.map((item, i) => (i === index ? { ...item, status: 'processing' } : item)),
        )
      },
      onFileProgress: (_batchIndex, file, info) => {
        setBatchProgress((prev) => ({
          fileName: file.name,
          fileIndex: prev?.fileIndex ?? 1,
          fileTotal: prev?.fileTotal ?? batchQueueTotalRef.current,
          status: info.status,
          chunk: info.chunk ?? null,
        }))
      },
      onFileDone: (batchIndex, _file, outputName) => {
        const { index } = queue[batchIndex]
        setBatchItems((items) =>
          items.map((item, i) =>
            i === index ? { ...item, status: 'saved', outputName, error: undefined } : item,
          ),
        )
      },
      onFileError: (batchIndex, _file, error) => {
        const { index } = queue[batchIndex]
        setBatchItems((items) =>
          items.map((item, i) => (i === index ? { ...item, status: 'error', error } : item)),
        )
      },
    })

    setBatchSummary(summary)
    setBatchRunning(false)
    setBatchProgress(null)
  }

  const handleBatchClear = () => {
    if (batchRunning) return
    setBatchItems([])
    setBatchSummary(null)
  }

  const handleBatchAbort = () => {
    batchAbortRef.current?.abort()
    setBatchRunning(false)
    setBatchProgress(null)
  }

  const handleBatchRemove = (id: string) => {
    if (batchRunning) return
    setBatchItems((items) => items.filter((i) => i.id !== id))
  }

  // ────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────

  return (
    <div className="relative flex h-full flex-col p-4 text-[18px]">
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} url="/help-doc-refiner.md" title="Doc Refiner 使用說明" />
      <ErrorModal
        open={errorModal !== null}
        title={errorModal?.title}
        message={errorModal?.message ?? ''}
        onClose={() => setErrorModal(null)}
      />
      <ProcessingModal
        open={mode === 'doc' && processing}
        title="文件 → FAQ"
        subtitle={title || file?.name}
        status={faqProcessingStatus(chunkProgress)}
        progress={chunkProgress}
        hint="請勿關閉此頁面，Q&A 將逐段出現"
        onCancel={handleDocAbort}
      />
      <ProcessingModal
        open={mode === 'note' && noteProcessing}
        title="筆記 → FAQ"
        subtitle={noteTitle || '筆記'}
        status={faqProcessingStatus(noteChunkProgress)}
        progress={noteChunkProgress}
        hint="請勿關閉此頁面，Q&A 將逐段出現"
        onCancel={handleNoteAbort}
      />
      <ProcessingModal
        open={mode === 'sop' && sopProcessing}
        title="SOP → FAQ"
        subtitle={sopTitle || sopFile?.name}
        status={faqProcessingStatus(sopChunkProgress)}
        progress={sopChunkProgress}
        hint="請勿關閉此頁面，Q&A 將逐段出現"
        onCancel={handleSopAbort}
      />
      <ProcessingModal
        open={mode === 'md' && mdProcessing}
        title="結構化 Markdown"
        subtitle={mdTitle || mdFile?.name}
        status={mdExtractStatus || (mdChunkProgress ? 'AI 結構化中…' : '準備中…')}
        progress={mdChunkProgress}
        onCancel={handleMdAbort}
      />
      <ProcessingModal
        open={mode === 'web-md' && (webMdFetching || webMdProcessing)}
        title="網頁 → 結構化 MD"
        subtitle={webMdPreview?.source_url || webMdUrl}
        status={
          webMdFetching
            ? '擷取並去除雜訊…'
            : webMdExtractStatus || (webMdChunkProgress ? 'AI 結構化中…' : '產生 PDF 快照…')
        }
        progress={webMdProcessing ? webMdChunkProgress : null}
        onCancel={
          webMdFetching
            ? undefined
            : handleWebMdAbort
        }
      />
      <ProcessingModal
        open={mode === 'md-batch' && batchRunning}
        title="批次轉換結構化 MD"
        subtitle={batchProgress?.fileName}
        status={batchProgress?.status || '準備中…'}
        progress={batchProgress?.chunk}
        batchProgress={
          batchProgress
            ? { current: batchProgress.fileIndex, total: batchProgress.fileTotal }
            : null
        }
        onCancel={handleBatchAbort}
      />
      <AgentHeader
        agent={agent}
        headerBackgroundColor={HEADER_COLOR}
        onOnlineHelpClick={() => setHelpOpen(true)}
      />

      {reuploadModalOpen && (
        <ReuploadModal
          hasExistingItems={items.length > 0}
          onConfirm={handleReuploadConfirm}
          onClose={() => setReuploadModalOpen(false)}
        />
      )}
      {downloadModalOpen && (
        <DownloadModal
          qaTitle={title}
          onExportTxt={(name) => handleExportTxt(name)}
          onImport={handleImport}
          onClose={() => setDownloadModalOpen(false)}
        />
      )}
      {noteDownloadModalOpen && (
        <DownloadModal
          qaTitle={noteTitle}
          onExportTxt={(name) => handleNoteExportTxt(name)}
          onImport={handleNoteImport}
          onClose={() => setNoteDownloadModalOpen(false)}
        />
      )}
      {sopReuploadModalOpen && (
        <ReuploadModal
          hasExistingItems={sopItems.length > 0}
          onConfirm={handleSopReuploadConfirm}
          onClose={() => setSopReuploadModalOpen(false)}
        />
      )}
      {sopDownloadModalOpen && (
        <DownloadModal
          qaTitle={sopTitle}
          onExportTxt={(name) => handleSopExportTxt(name)}
          onImport={handleSopImport}
          onClose={() => setSopDownloadModalOpen(false)}
        />
      )}

      <div className="mt-4 flex min-h-0 flex-1 gap-3 overflow-hidden">

        {/* ── Sidebar：模式切換 ── */}
        <DocRefinerSidebar
          mode={mode}
          onModeChange={setMode}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
          model={model}
          onModelChange={setModel}
        />

        {/* ── 主畫面 ── */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {mode === 'doc' ? (
            stage === 'upload' ? (
              <UploadStage
                file={file}
                processing={processing}
                fileInputRef={fileInputRef}
                onFileChange={handleFileChange}
                onDrop={handleDrop}
                onProcess={handleProcess}
              />
            ) : (
              <EditStage
                pdfUrl={pdfUrl}
                file={file}
                items={items}
                processing={processing}
                doneInfo={doneInfo}
                onUpdateItem={updateItem}
                onDeleteItem={deleteItem}
                onAddItem={addItem}
                onClearAll={() => setItems([])}
                onDownloadClick={() => setDownloadModalOpen(true)}
                onReuploadClick={() => setReuploadModalOpen(true)}
              />
            )
          ) : mode === 'note' ? (
            <NoteStage
              text={noteText}
              title={noteTitle}
              items={noteItems}
              processing={noteProcessing}
              doneInfo={noteDoneInfo}
              onTextChange={setNoteText}
              onTitleChange={setNoteTitle}
              onUpdateItem={updateNoteItem}
              onDeleteItem={deleteNoteItem}
              onAddItem={addNoteItem}
              onClearAll={() => setNoteItems([])}
              onProcess={handleNoteProcess}
              onDownloadClick={() => setNoteDownloadModalOpen(true)}
            />
          ) : mode === 'md' ? (
            mdStage === 'upload' ? (
              <MdUploadStage
                file={mdFile}
                processing={mdProcessing}
                fileInputRef={mdFileInputRef}
                onFileChange={handleMdFileChange}
                onDrop={handleMdDrop}
                onProcess={handleMdProcess}
              />
            ) : (
              <>
                <MdEditStage
                  pdfUrl={mdPdfUrl}
                  title={mdTitle}
                  content={mdContent}
                  processing={mdProcessing}
                  doneInfo={mdDoneInfo}
                  importSuccess={mdImportSuccess}
                  onContentChange={setMdContent}
                  onDownload={handleMdDownload}
                  onImport={handleMdImportOpen}
                  onReupload={() => { setMdStage('upload'); setMdContent(''); setMdDoneInfo(null); setMdImportSuccess(null) }}
                />
                {mdImportOpen && (
                  <MdImportModal
                    kbs={mdKBs}
                    importing={mdImporting}
                    onImport={handleMdImport}
                    onClose={() => setMdImportOpen(false)}
                  />
                )}
              </>
            )
          ) : mode === 'web-md' ? (
            webMdStage === 'input' ? (
              <WebMdInputStage
                url={webMdUrl}
                fetching={webMdFetching}
                onUrlChange={setWebMdUrl}
                onFetch={handleWebMdFetchPreview}
              />
            ) : webMdStage === 'preview' && webMdPreview ? (
              <WebMdPreviewStage
                preview={webMdPreview}
                title={webMdTitle}
                onTitleChange={setWebMdTitle}
                onBack={() => { setWebMdStage('input'); setWebMdPreview(null) }}
                onConfirm={handleWebMdProcess}
              />
            ) : (
              <>
                <MdEditStage
                  pdfUrl={null}
                  previewHtml={webMdPreview?.preview_html ?? null}
                  sourceLabel={webMdPreview?.source_url}
                  title={webMdTitle}
                  content={webMdContent}
                  processing={webMdProcessing}
                  doneInfo={webMdDoneInfo}
                  importSuccess={webMdImportSuccess}
                  onContentChange={setWebMdContent}
                  onDownload={handleWebMdDownload}
                  onImport={handleWebMdImportOpen}
                  onReupload={() => {
                    setWebMdStage('input')
                    setWebMdContent('')
                    setWebMdDoneInfo(null)
                    setWebMdImportSuccess(null)
                    setWebMdPreview(null)
                  }}
                  reuploadLabel="換 URL"
                />
                {webMdImportOpen && (
                  <MdImportModal
                    kbs={webMdKBs}
                    importing={webMdImporting}
                    onImport={handleWebMdImport}
                    onClose={() => setWebMdImportOpen(false)}
                  />
                )}
              </>
            )
          ) : mode === 'md-batch' ? (
            <MdBatchStage
              items={batchItems}
              outputDirName={batchOutputDirName}
              running={batchRunning}
              summary={batchSummary}
              fileInputRef={batchFileInputRef}
              onAddFiles={handleBatchAddFiles}
              onPickDir={handleBatchPickDir}
              onRemove={handleBatchRemove}
              onStart={handleBatchStart}
              onAbort={handleBatchAbort}
              onClear={handleBatchClear}
              fsAccessSupported={isFileSystemAccessSupported()}
            />
          ) : (
            /* SOP 模式：與 doc 模式相同，永遠顯示 EditStage，左側空白時即為上傳入口 */
            <EditStage
              pdfUrl={sopPdfUrl}
              file={sopFile}
              items={sopItems}
              processing={sopProcessing}
              doneInfo={sopDoneInfo}
              onUpdateItem={updateSopItem}
              onDeleteItem={deleteSopItem}
              onAddItem={addSopItem}
              onClearAll={() => setSopItems([])}
              onDownloadClick={() => setSopDownloadModalOpen(true)}
              onReuploadClick={() => setSopReuploadModalOpen(true)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// Sidebar：模式切換
// ══════════════════════════════════════════════════

interface DocRefinerSidebarProps {
  mode: Mode
  onModeChange: (m: Mode) => void
  collapsed: boolean
  onCollapsedChange: (v: boolean) => void
  model: string
  onModelChange: (m: string) => void
}

function DocRefinerSidebar({ mode, onModeChange, collapsed, onCollapsedChange, model, onModelChange }: DocRefinerSidebarProps) {
  return (
    <div
      className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md transition-[width] duration-200 ${
        collapsed ? 'w-12' : 'w-64'
      }`}
      style={{ backgroundColor: HEADER_COLOR }}
    >
      {/* Header */}
      <div
        className={`flex shrink-0 items-center justify-between border-b border-white/20 py-2.5 ${
          collapsed ? 'px-2' : 'pl-4 pr-2'
        }`}
      >
        {collapsed ? (
          <button
            type="button"
            onClick={() => onCollapsedChange(false)}
            className="flex w-full items-center justify-center rounded-2xl p-1.5 text-white/80 hover:bg-white/10"
            title="展開"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        ) : (
          <>
            <span className="text-base font-semibold text-white">模式</span>
            <button
              type="button"
              onClick={() => onCollapsedChange(true)}
              className="rounded-2xl px-1.5 py-1 text-white/60 hover:bg-white/10 hover:text-white"
              title="折疊"
            >
              {'<<'}
            </button>
          </>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex flex-1 flex-col gap-1 py-2 px-1.5">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onModeChange(item.id)}
            title={collapsed ? item.label : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-2 py-2.5 text-left text-lg font-medium transition-colors ${
              mode === item.id
                ? 'bg-sky-500/30 text-white'
                : 'text-white/65 hover:bg-white/10 hover:text-white'
            } ${collapsed ? 'justify-center' : ''}`}
          >
            {item.icon}
            {!collapsed && <span className="leading-tight">{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* Model selector */}
      {!collapsed && (
        <div className="shrink-0 border-t border-white/20 px-2.5 py-3">
          <p className="mb-1.5 text-base font-medium text-white/50">模型</p>
          <LLMModelSelect
            value={model}
            onChange={onModelChange}
            label=""
            compact
            selectClassName="w-full rounded-lg border border-white/20 bg-white/10 px-2 py-1.5 text-base text-white focus:border-white/40 focus:outline-none"
          />
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════
// 網頁 → MD
// ══════════════════════════════════════════════════

interface WebMdInputStageProps {
  url: string
  fetching: boolean
  onUrlChange: (v: string) => void
  onFetch: () => void
}

function WebMdInputStage({ url, fetching, onUrlChange, onFetch }: WebMdInputStageProps) {
  const CARD_BG = '#1A3A52'
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-xl rounded-2xl border border-white/20 p-8 shadow-xl" style={{ backgroundColor: CARD_BG }}>
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-400/20">
            <Globe className="h-5 w-5 text-sky-300" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">網頁 → 結構化 MD</h2>
            <p className="text-base text-white/50">貼上公開網址，自動抽取正文、預覽確認後結構化</p>
          </div>
        </div>
        <label className="mb-2 block text-sm font-medium text-white/60">網頁 URL</label>
        <input
          type="url"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://example.com/docs/guide"
          className="mb-4 w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-base text-white placeholder-white/30 outline-none focus:border-sky-400/60"
          onKeyDown={(e) => { if (e.key === 'Enter') onFetch() }}
        />
        <p className="mb-5 text-sm text-white/40">
          僅支援可公開存取的 http(s) 頁面。登入牆或重度 JS 網站可能失敗，請改上傳 PDF。
        </p>
        <button
          type="button"
          onClick={onFetch}
          disabled={!url.trim() || fetching}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-base font-semibold text-white transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ backgroundColor: '#0369a1' }}
        >
          {fetching ? (
            <><Loader2 className="h-5 w-5 animate-spin" />擷取中…</>
          ) : (
            <><Globe className="h-5 w-5" />擷取正文預覽</>
          )}
        </button>
      </div>
    </div>
  )
}

interface WebMdPreviewStageProps {
  preview: WebPreviewResponse
  title: string
  onTitleChange: (v: string) => void
  onBack: () => void
  onConfirm: () => void
}

function WebMdPreviewStage({
  preview, title, onTitleChange, onBack, onConfirm,
}: WebMdPreviewStageProps) {
  const CARD_BG = '#1A3A52'
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-end gap-3 rounded-xl border border-white/10 p-4" style={{ backgroundColor: CARD_BG }}>
        <div className="min-w-[200px] flex-1">
          <label className="mb-1 block text-sm text-white/50">文件標題</label>
          <input
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-base text-white outline-none focus:border-sky-400/60"
          />
        </div>
        <p className="text-sm text-white/40">
          約 {preview.text_length.toLocaleString()} 字
          {preview.excerpt ? ` · ${preview.excerpt.slice(0, 80)}…` : ''}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-white/20 px-4 py-2 text-base text-white/70 hover:bg-white/10"
          >
            重新輸入 URL
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex items-center gap-2 rounded-lg bg-emerald-700/70 px-4 py-2 text-base font-medium text-white hover:bg-emerald-600/80"
          >
            <Sparkles className="h-4 w-4" />
            確認並結構化
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-white">
        <iframe
          srcDoc={preview.preview_html}
          sandbox=""
          className="h-full w-full border-0"
          title="正文預覽"
        />
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// MD mode：上傳 Stage
// ══════════════════════════════════════════════════

interface MdUploadStageProps {
  file: File | null
  processing: boolean
  fileInputRef: React.RefObject<HTMLInputElement>
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onDrop: (e: React.DragEvent) => void
  onProcess: () => void
}

function MdUploadStage({ file, processing, fileInputRef, onFileChange, onDrop, onProcess }: MdUploadStageProps) {
  const CARD_BG = '#1A3A52'
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-xl rounded-2xl border border-white/20 p-8 shadow-xl" style={{ backgroundColor: CARD_BG }}>
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-400/20">
            <FileCode2 className="h-5 w-5 text-emerald-300" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">文件 → 結構化 MD</h2>
            <p className="text-base text-white/50">上傳 PDF（Word、網頁請先匯出 PDF）；低文字頁與內嵌圖自動 OCR，AI 補上章節標題</p>
          </div>
        </div>

        <div
          className={`mb-5 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 transition-colors ${
            file ? 'border-emerald-400/60 bg-emerald-900/20' : 'border-white/20 hover:border-white/40 hover:bg-white/5'
          }`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={MD_ACCEPT_ATTR}
            className="hidden"
            onChange={onFileChange}
          />
          {file ? (
            <>
              <FileCode2 className="h-8 w-8 text-emerald-400" />
              <div className="text-center">
                <p className="font-medium text-white">{file.name}</p>
                <p className="text-base text-white/50">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
              <p className="text-base text-white/40">點擊重新選擇</p>
            </>
          ) : (
            <>
              <Upload className="h-8 w-8 text-white/40" />
              <p className="text-base text-white/60">拖曳 PDF 至此，或點擊選擇</p>
              <p className="text-base text-white/30">最大 20 MB・僅支援 PDF</p>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={onProcess}
          disabled={!file || processing}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-base font-semibold text-white transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ backgroundColor: '#065f46' }}
        >
          {processing ? (
            <><Loader2 className="h-5 w-5 animate-spin" />處理中…</>
          ) : (
            <><Sparkles className="h-5 w-5" />開始結構化</>
          )}
        </button>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// MD batch mode
// ══════════════════════════════════════════════════

interface MdBatchStageProps {
  items: BatchFileItem[]
  outputDirName: string
  running: boolean
  summary: BatchSummary | null
  fileInputRef: React.RefObject<HTMLInputElement>
  onAddFiles: (files: FileList | File[]) => void
  onPickDir: () => void
  onRemove: (id: string) => void
  onStart: () => void
  onAbort: () => void
  onClear: () => void
  fsAccessSupported: boolean
}

function MdBatchStage({
  items, outputDirName, running, summary, fileInputRef,
  onAddFiles, onPickDir, onRemove, onStart, onAbort, onClear, fsAccessSupported,
}: MdBatchStageProps) {
  const CARD_BG = '#1A3A52'
  const runnableCount = items.filter((i) => isBatchItemRunnable(i.status)).length

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="rounded-xl border border-white/10 p-5" style={{ backgroundColor: CARD_BG }}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">批次 → 結構化 MD</h2>
            <p className="text-base text-white/50">逐檔轉換，PDF 低文字頁自動 OCR，完成一檔寫入本機資料夾</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={running}
              className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-2 text-base text-white/80 hover:bg-white/10 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
              加入檔案
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={MD_ACCEPT_ATTR}
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) onAddFiles(e.target.files)
                e.target.value = ''
              }}
            />
            {fsAccessSupported && (
              <button
                type="button"
                onClick={onPickDir}
                disabled={running}
                className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-2 text-base text-white/80 hover:bg-white/10 disabled:opacity-40"
              >
                <FolderOpen className="h-4 w-4" />
                {outputDirName ? `輸出：${outputDirName}` : '選擇輸出資料夾'}
              </button>
            )}
            {items.length > 0 && !running && (
              <button
                type="button"
                onClick={onClear}
                className="rounded-lg border border-white/20 px-3 py-2 text-base text-white/60 hover:bg-white/10 hover:text-white"
              >
                清空列表
              </button>
            )}
            {running ? (
              <button
                type="button"
                onClick={onAbort}
                className="rounded-lg bg-red-800/60 px-4 py-2 text-base font-medium text-white hover:bg-red-700/70"
              >
                停止
              </button>
            ) : (
              <button
                type="button"
                onClick={onStart}
                disabled={runnableCount === 0}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-700/70 px-4 py-2 text-base font-medium text-white hover:bg-emerald-600/80 disabled:opacity-40"
              >
                <Sparkles className="h-4 w-4" />
                開始轉換
              </button>
            )}
          </div>
        </div>

        {!fsAccessSupported && (
          <p className="mb-3 text-sm text-amber-300/90">
            此瀏覽器不支援選擇資料夾；每檔完成後將個別下載 .md 檔案。
          </p>
        )}

        {summary && !running && (
          <p className="mb-3 text-sm text-white/60">
            完成：成功 {summary.saved}、失敗 {summary.failed} / 共 {summary.total} 檔
            {runnableCount === 0 && items.length > 0
              ? ' · 加入新 PDF 將開始新一輪'
              : ''}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-white/10" style={{ backgroundColor: CARD_BG }}>
        {items.length === 0 ? (
          <div className="flex h-full min-h-[200px] items-center justify-center text-white/40">
            加入 PDF 檔案開始批次轉換
          </div>
        ) : (
          <ul className="divide-y divide-white/10">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                <FileCode2 className="h-4 w-4 shrink-0 text-emerald-400/80" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base text-white/90">{item.file.name}</p>
                  {item.error && <p className="text-sm text-red-300">{item.error}</p>}
                  {item.outputName && item.status === 'saved' && (
                    <p className="text-sm text-emerald-300/80">已存檔：{item.outputName}</p>
                  )}
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                  item.status === 'saved' ? 'bg-emerald-900/50 text-emerald-300'
                  : item.status === 'processing' ? 'bg-blue-900/50 text-blue-300'
                  : item.status === 'error' ? 'bg-red-900/50 text-red-300'
                  : 'bg-white/10 text-white/50'
                }`}>
                  {item.status === 'saved' ? '已存檔'
                    : item.status === 'processing' ? '處理中'
                    : item.status === 'error' ? '失敗'
                    : '等待'}
                </span>
                {!running && (
                  <button
                    type="button"
                    onClick={() => onRemove(item.id)}
                    className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"
                    title="移除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// MD mode：編輯 Stage
// ══════════════════════════════════════════════════

interface MdEditStageProps {
  pdfUrl: string | null
  previewHtml?: string | null
  sourceLabel?: string | null
  title: string
  content: string
  processing: boolean
  doneInfo: { usage: TokenUsage; model: string } | null
  importSuccess: { kbName: string; count: number } | null
  onContentChange: (v: string) => void
  onDownload: () => void
  onImport: () => void
  onReupload: () => void
  reuploadLabel?: string
}

function MdEditStage({
  pdfUrl, previewHtml, sourceLabel, title, content, processing, doneInfo, importSuccess,
  onContentChange, onDownload, onImport, onReupload, reuploadLabel = '換檔',
}: MdEditStageProps) {
  const CARD_BG = '#112233'
  const [copied, setCopied] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 新內容流入時自動捲動到底
  useEffect(() => {
    if (processing && textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight
    }
  }, [content, processing])

  const handleCopy = () => {
    if (!content) return
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
      {/* ── 左側：PDF 預覽 ── */}
      <div className="flex min-h-0 w-[45%] shrink-0 flex-col overflow-hidden rounded-xl border border-white/10" style={{ backgroundColor: CARD_BG }}>
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-2.5">
          <span className="truncate text-base font-medium text-white/70">
            {previewHtml ? '網頁正文預覽' : title || '原始文件'}
          </span>
          <button
            type="button"
            onClick={onReupload}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-base text-white/50 hover:bg-white/10 hover:text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {reuploadLabel}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {previewHtml ? (
            <iframe
              srcDoc={previewHtml}
              sandbox=""
              className="h-full w-full border-0 bg-white"
              title="網頁正文預覽"
            />
          ) : pdfUrl ? (
            <iframe src={pdfUrl} className="h-full w-full" title="PDF 預覽" />
          ) : null}
        </div>
        {sourceLabel && (
          <div className="shrink-0 truncate border-t border-white/10 px-4 py-2 text-xs text-white/35">
            {sourceLabel}
          </div>
        )}
      </div>

      {/* ── 右側：MD 編輯器 ── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10" style={{ backgroundColor: CARD_BG }}>
        {/* 工具列 */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <FileCode2 className="h-4 w-4 text-emerald-400" />
            <span className="text-base font-medium text-white/70">
              {title ? `${title}.md` : '結構化 Markdown'}
            </span>
            {processing && (
              <span className="rounded-full bg-emerald-900/40 px-2 py-0.5 text-xs text-emerald-300/90">
                處理中
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              disabled={!content}
              title="複製全文"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-base text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30"
            >
              {copied ? <ClipboardCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? '已複製' : '複製'}
            </button>
            <button
              type="button"
              onClick={onDownload}
              disabled={!content.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-700/60 px-3 py-1.5 text-base font-medium text-white hover:bg-emerald-600/70 disabled:opacity-30"
            >
              <Download className="h-3.5 w-3.5" />
              下載 .md
            </button>
            <button
              type="button"
              onClick={onImport}
              disabled={!content.trim() || processing}
              className="flex items-center gap-1.5 rounded-lg bg-blue-700/60 px-3 py-1.5 text-base font-medium text-white hover:bg-blue-600/70 disabled:opacity-30"
            >
              <BookOpen className="h-3.5 w-3.5" />
              匯入知識庫
            </button>
          </div>
        </div>

        {importSuccess && (
          <div className="shrink-0 border-b border-white/10 bg-blue-900/30 px-4 py-2">
            <p className="text-sm text-blue-300">
              已匯入「{importSuccess.kbName}」，共 {importSuccess.count} 個 chunks
            </p>
          </div>
        )}

        {/* 編輯區 */}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => onContentChange(e.target.value)}
          placeholder={processing ? 'AI 結構化中，內容逐段出現…' : '尚無內容，請上傳 PDF 開始整理'}
          className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-sm leading-relaxed text-white/85 placeholder-white/20 outline-none"
          spellCheck={false}
        />

        {/* 底部資訊列 */}
        {doneInfo && (
          <div className="shrink-0 border-t border-white/10 px-4 py-2">
            <p className="text-xs text-white/35">
              模型：{doneInfo.model}・
              Token：{doneInfo.usage.total_tokens.toLocaleString()}・
              字數：{content.length.toLocaleString()}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// MD 匯入知識庫 Modal
// ══════════════════════════════════════════════════

interface MdImportModalProps {
  kbs: KBOption[]
  importing: boolean
  onImport: (kbId: number | null, newKbName: string) => void
  onClose: () => void
}

function MdImportModal({ kbs, importing, onImport, onClose }: MdImportModalProps) {
  const [selectedKbId, setSelectedKbId] = useState<number | 'new' | ''>(kbs[0]?.id ?? 'new')
  const [newKbName, setNewKbName] = useState('')

  const handleConfirm = () => {
    if (selectedKbId === 'new') {
      if (!newKbName.trim()) return
      onImport(null, newKbName.trim())
    } else if (selectedKbId !== '') {
      onImport(Number(selectedKbId), '')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[420px] rounded-2xl border border-white/10 bg-[#0d1b2a] p-6 shadow-2xl">
        <h3 className="mb-4 text-lg font-semibold text-white">匯入知識庫</h3>

        <label className="mb-1.5 block text-sm text-white/60">選擇知識庫</label>
        <select
          value={selectedKbId}
          onChange={(e) => setSelectedKbId(e.target.value === 'new' ? 'new' : Number(e.target.value))}
          className="mb-4 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
        >
          {kbs.map((kb) => (
            <option key={kb.id} value={kb.id}>
              {kb.name}（{kb.scope === 'company' ? '共用' : '個人'}）
            </option>
          ))}
          <option value="new">＋ 建立新知識庫</option>
        </select>

        {selectedKbId === 'new' && (
          <>
            <label className="mb-1.5 block text-sm text-white/60">新知識庫名稱</label>
            <input
              type="text"
              value={newKbName}
              onChange={(e) => setNewKbName(e.target.value)}
              placeholder="輸入知識庫名稱"
              className="mb-4 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
            />
          </>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            className="rounded-lg px-4 py-2 text-sm text-white/50 hover:bg-white/10 disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={importing || (selectedKbId === 'new' && !newKbName.trim())}
            className="flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-40"
          >
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookOpen className="h-3.5 w-3.5" />}
            {importing ? '匯入中…' : '確認匯入'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// Stage 1：上傳
// ══════════════════════════════════════════════════

interface UploadStageProps {
  file: File | null
  processing: boolean
  fileInputRef: React.RefObject<HTMLInputElement>
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onDrop: (e: React.DragEvent) => void
  onProcess: () => void
}

function UploadStage({
  file, processing, fileInputRef,
  onFileChange, onDrop, onProcess,
}: UploadStageProps) {
  const CARD_BG = '#1A3A52'
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-xl rounded-2xl border border-white/20 p-8 shadow-xl" style={{ backgroundColor: CARD_BG }}>

        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-400/20">
            <FileText className="h-5 w-5 text-sky-300" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">智慧文件整理</h2>
            <p className="text-base text-white/50">上傳 PDF / TXT，AI 自動萃取 Q&A 知識條目</p>
          </div>
        </div>

        {/* 拖曳上傳區 */}
        <div
          className={`mb-5 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 transition-colors ${
            file ? 'border-sky-400/60 bg-sky-900/20' : 'border-white/20 hover:border-white/40 hover:bg-white/5'
          }`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt"
            className="hidden"
            onChange={onFileChange}
          />
          {file ? (
            <>
              <FileText className="h-8 w-8 text-sky-400" />
              <div className="text-center">
                <p className="font-medium text-white">{file.name}</p>
                <p className="text-base text-white/50">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
              <p className="text-base text-white/40">點擊重新選擇</p>
            </>
          ) : (
            <>
              <Upload className="h-8 w-8 text-white/40" />
              <p className="text-base text-white/60">拖曳 PDF / TXT 至此，或點擊選擇</p>
              <p className="text-base text-white/30">最大 20 MB</p>
            </>
          )}
        </div>

        {/* 開始按鈕 */}
        <button
          type="button"
          onClick={onProcess}
          disabled={!file || processing}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-base font-semibold text-white transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ backgroundColor: '#0e7490' }}
        >
          {processing ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              處理中…
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" />
              開始智慧整理
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// Stage 2：比對編輯
// ══════════════════════════════════════════════════

interface EditStageProps {
  pdfUrl: string | null
  file: File | null
  items: QAItem[]
  processing: boolean
  doneInfo: { usage: TokenUsage; model: string } | null
  onUpdateItem: (id: number, patch: Partial<QAItem>) => void
  onDeleteItem: (id: number) => void
  onAddItem: () => void
  onClearAll: () => void
  onDownloadClick: () => void
  onReuploadClick: () => void
}

function EditStage({
  pdfUrl, file, items, processing, doneInfo,
  onUpdateItem, onDeleteItem, onAddItem, onClearAll, onDownloadClick, onReuploadClick,
}: EditStageProps) {
  const PANEL_BG = '#1A3A52'
  const [copied, setCopied] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [txtContent, setTxtContent] = useState<string | null>(null)

  useEffect(() => {
    if (file && file.name.toLowerCase().endsWith('.txt')) {
      file.text().then(setTxtContent).catch(() => setTxtContent(null))
    } else {
      setTxtContent(null)
    }
  }, [file])

  const handleCopy = () => {
    const text = items.map((it) => `Q: ${it.question}\nA: ${it.answer}`).join('\n\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">


      {/* 主體：左右分割 */}
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">

        {/* 左：PDF 預覽 */}
        <div className="flex w-[45%] flex-shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md">
          <div className="flex items-center gap-2 border-b border-white/20 px-4 py-2.5" style={{ backgroundColor: HEADER_COLOR }}>
            <FileText className="h-4 w-4 text-white/70" />
            <span className="text-base font-medium text-white/70">原始文件</span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={onReuploadClick}
              className="flex items-center gap-1 rounded-lg bg-sky-700 px-2.5 py-1 text-base font-medium text-white transition hover:bg-sky-600"
            >
              <Upload className="h-3.5 w-3.5" />
              上傳
            </button>
          </div>
          <div className="flex-1 overflow-hidden bg-white">
            {pdfUrl && !txtContent ? (
              <iframe
                src={pdfUrl}
                className="h-full w-full border-0"
                title="原始 PDF 預覽"
              />
            ) : txtContent ? (
              <pre className="h-full w-full overflow-auto whitespace-pre-wrap break-words p-4 text-base leading-relaxed text-gray-800 font-sans">
                {txtContent}
              </pre>
            ) : (
              <div
                className="flex h-full cursor-pointer flex-col items-center justify-center gap-3 text-gray-300 transition-colors hover:bg-gray-50 hover:text-gray-400"
                onClick={onReuploadClick}
              >
                <Upload className="h-10 w-10" />
                <p className="text-base">點擊上傳 PDF / TXT</p>
                <p className="text-base text-gray-200">支援拖曳，最大 20 MB</p>
              </div>
            )}
          </div>
        </div>

        {/* 右：整理結果（可編輯）*/}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md" style={{ backgroundColor: PANEL_BG }}>
          <div className="flex flex-shrink-0 items-center gap-2 border-b border-white/20 px-4 py-2.5">
            <span className="text-base font-medium text-white/70">Q&A 整理結果</span>
            {processing && (
              <span className="rounded-full bg-sky-900/40 px-2 py-0.5 text-xs text-sky-300/90">
                處理中
              </span>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={onDownloadClick}
              disabled={items.length === 0 || processing}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1 text-base font-semibold text-white transition hover:bg-sky-500 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              下載 Q&A
            </button>
            <button
              type="button"
              onClick={handleCopy}
              disabled={items.length === 0 || processing}
              className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1 text-base font-semibold text-white/70 transition hover:bg-white/10 disabled:opacity-40"
            >
              {copied ? <ClipboardCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Clipboard className="h-3.5 w-3.5" />}
              {copied ? '已複製' : '複製'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              disabled={items.length === 0 || processing}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1 text-base font-semibold text-red-400/70 transition hover:bg-red-500/10 disabled:opacity-40"
              title="清空全部 Q&A"
            >
              <Trash2 className="h-3.5 w-3.5" />
              清空
            </button>
          </div>

          <ConfirmModal
            open={confirmClear}
            title="清空 Q&A"
            message="確定清除所有 Q&A 條目？此操作無法復原。"
            confirmText="確定清空"
            variant="danger"
            onConfirm={() => { onClearAll(); setConfirmClear(false) }}
            onCancel={() => setConfirmClear(false)}
          />

          <div className="flex-1 space-y-1 overflow-y-auto px-4 pb-4 pt-2 bg-white">
            {items.length === 0 && processing && (
              <div className="flex flex-col items-center justify-center gap-3 pt-16 text-white/40">
                <span className="text-base">Q&A 將逐段出現…</span>
              </div>
            )}
            {items.length === 0 && !processing && (
              <div className="flex flex-col items-center gap-3 pt-16 text-white/30">
                <FileText className="h-8 w-8 opacity-40" />
                <p className="text-base">上傳 PDF / TXT 後，AI 將自動萃取 Q&A</p>
              </div>
            )}

            {items.map((item) => (
              <QACard
                key={item.id}
                item={item}
                onUpdate={(patch) => onUpdateItem(item.id, patch)}
                onDelete={() => onDeleteItem(item.id)}
              />
            ))}

            {/* 新增按鈕 */}
            <button
              type="button"
              onClick={onAddItem}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 py-3 text-base text-white/40 transition hover:border-white/40 hover:text-white/60"
            >
              <Plus className="h-4 w-4" />
              新增一條
            </button>
          </div>

          {/* Token 使用量 footer */}
          {doneInfo && (
            <div className="flex flex-shrink-0 items-center border-t border-white/10 px-4 py-2 font-mono text-base text-white/60">
              <span>model: {doneInfo.model}</span>
              <span className="mx-2 text-white/20">·</span>
              <span>prompt: {doneInfo.usage.prompt_tokens.toLocaleString()}</span>
              <span className="mx-2 text-white/20">·</span>
              <span>completion: {doneInfo.usage.completion_tokens.toLocaleString()}</span>
              <span className="mx-2 text-white/20">·</span>
              <span>total: {doneInfo.usage.total_tokens.toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// Q&A 卡片
// ══════════════════════════════════════════════════

const REWRITE_PRESETS = [
  { label: '問題更自然', instruction: '讓問題聽起來更像真人提問，更自然口語' },
  { label: '答案更清楚', instruction: '重新措辭，讓答案更容易理解' },
  { label: '答案更精簡', instruction: '去除冗詞，保留核心內容' },
]

function QACard({
  item,
  onUpdate,
  onDelete,
}: {
  item: QAItem
  onUpdate: (patch: Partial<QAItem>) => void
  onDelete: () => void
}) {
  const [question, setQuestion] = useState(item.question.trim())
  const [answer, setAnswer] = useState(item.answer.trim())
  const qRef = useRef<HTMLTextAreaElement>(null)
  const aRef = useRef<HTMLTextAreaElement>(null)

  // ── AI 改寫狀態 ──
  const [rewriteOpen, setRewriteOpen] = useState(false)
  const [customInstruction, setCustomInstruction] = useState('')
  const [rewriting, setRewriting] = useState(false)
  const [rewriteResult, setRewriteResult] = useState<{ question: string; answer: string } | null>(null)

  const autoResize = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  useEffect(() => { setQuestion(item.question.trim()) }, [item.id, item.question])
  useEffect(() => { setAnswer(item.answer.trim()) }, [item.id, item.answer])
  useEffect(() => { autoResize(qRef.current) }, [question])
  useEffect(() => { autoResize(aRef.current) }, [answer])

  const handleRewrite = async (instruction: string) => {
    if (!instruction.trim()) return
    setRewriting(true)
    setRewriteResult(null)
    try {
      const result = await rewriteQAItem({ question, answer, instruction })
      setRewriteResult(result)
    } catch (err) {
      setRewriteResult({ question: `改寫失敗：${err instanceof Error ? err.message : '請重試'}`, answer })
    } finally {
      setRewriting(false)
    }
  }

  const handleApply = () => {
    if (!rewriteResult) return
    setQuestion(rewriteResult.question)
    setAnswer(rewriteResult.answer)
    onUpdate({ question: rewriteResult.question, answer: rewriteResult.answer })
    setRewriteResult(null)
    setRewriteOpen(false)
    setCustomInstruction('')
  }

  return (
    <div className="group rounded-xl border border-black/10 transition hover:border-black/20" style={{ backgroundColor: '#343434' }}>
      {/* Q / A 內容 */}
      <div className="p-4">
        <div className="mb-2 flex items-start gap-2">
          <span className="mt-0.5 flex-shrink-0 rounded-md bg-blue-500/30 px-2 py-0.5 text-base font-bold text-blue-300">
            Q{item.id}
          </span>
          <textarea
            ref={qRef}
            value={question}
            onChange={(e) => { setQuestion(e.target.value); autoResize(e.target) }}
            onBlur={() => onUpdate({ question })}
            placeholder="輸入問題…"
            rows={1}
            className="flex-1 resize-none overflow-hidden rounded-lg bg-transparent text-base text-white/90 placeholder-white/30 outline-none focus:ring-1 focus:ring-blue-400/40 px-2 py-1"
          />
          <button
            onClick={() => { setRewriteOpen((v) => !v); setRewriteResult(null) }}
            className="flex-shrink-0 rounded-lg px-2 py-1 text-violet-400 transition hover:bg-violet-500/20 hover:text-violet-300"
            title="AI 改寫"
          >
            <Sparkles className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="flex-shrink-0 rounded-lg p-1 text-white/40 transition hover:bg-red-900/40 hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-start gap-2 pl-1">
          <span className="mt-0.5 flex-shrink-0 rounded-md bg-emerald-600/30 px-2 py-0.5 text-base font-bold text-emerald-300">
            A
          </span>
          <textarea
            ref={aRef}
            value={answer}
            onChange={(e) => { setAnswer(e.target.value); autoResize(e.target) }}
            onBlur={() => onUpdate({ answer })}
            placeholder="輸入答案…"
            rows={1}
            className="flex-1 resize-none overflow-hidden rounded-lg bg-transparent text-base text-white/75 placeholder-white/25 outline-none focus:ring-1 focus:ring-emerald-400/40 px-2 py-1"
          />
        </div>
      </div>

      {/* AI 改寫面板 */}
      {rewriteOpen && (
        <div className="border-t border-white/10 px-4 pb-4 pt-3">
          <p className="mb-2 text-base font-medium text-white/50">AI 改寫</p>
          {/* 預設指令 */}
          <div className="mb-2 flex flex-wrap gap-1.5">
            {REWRITE_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                disabled={rewriting}
                onClick={() => setCustomInstruction((prev) =>
                  prev.trim() ? `${prev.trim()}，${p.instruction}` : p.instruction
                )}
                className="rounded-lg border border-white/15 px-2.5 py-1 text-base text-white/60 transition hover:border-violet-400/50 hover:bg-violet-500/10 hover:text-violet-300 disabled:opacity-40"
              >
                {p.label}
              </button>
            ))}
          </div>
          {/* 自訂指令 */}
          <div className="flex gap-1.5">
            <input
              type="text"
              value={customInstruction}
              onChange={(e) => setCustomInstruction(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleRewrite(customInstruction) }}
              placeholder="自訂指令…"
              disabled={rewriting}
              className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-base text-white/70 placeholder-white/25 outline-none focus:border-violet-400/50 disabled:opacity-40"
            />
            <button
              type="button"
              disabled={rewriting || !customInstruction.trim()}
              onClick={() => handleRewrite(customInstruction)}
              className="flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1 text-base font-semibold text-white transition hover:bg-violet-500 disabled:opacity-40"
            >
              {rewriting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              改寫
            </button>
          </div>

          {/* 改寫結果 */}
          {rewriting && (
            <div className="mt-3 flex items-center gap-2 text-base text-white/40">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> AI 改寫中…
            </div>
          )}
          {rewriteResult && !rewriting && (
            <div className="mt-3 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
              <p className="mb-1 text-[11px] font-semibold text-violet-400">改寫結果</p>
              <p className="mb-0.5 text-base text-white/80"><span className="text-blue-300 font-medium">Q：</span>{rewriteResult.question}</p>
              <p className="text-base text-white/70"><span className="text-emerald-300 font-medium">A：</span>{rewriteResult.answer}</p>
              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  onClick={handleApply}
                  className="rounded-lg bg-violet-600 px-3 py-1 text-base font-semibold text-white hover:bg-violet-500"
                >
                  套用
                </button>
                <button
                  type="button"
                  onClick={() => setRewriteResult(null)}
                  className="rounded-lg border border-white/15 px-3 py-1 text-base text-white/50 hover:bg-white/10"
                >
                  捨棄
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════
// Note Stage：筆記 → FAQ
// ══════════════════════════════════════════════════

interface NoteStageProps {
  text: string
  title: string
  items: QAItem[]
  processing: boolean
  doneInfo: { usage: TokenUsage; model: string } | null
  onTextChange: (v: string) => void
  onTitleChange: (v: string) => void
  onUpdateItem: (id: number, patch: Partial<QAItem>) => void
  onDeleteItem: (id: number) => void
  onAddItem: () => void
  onClearAll: () => void
  onProcess: () => void
  onDownloadClick: () => void
}

function NoteStage({
  text, title: _title, items, processing, doneInfo,
  onTextChange, onTitleChange: _onTitleChange, onUpdateItem, onDeleteItem, onAddItem,
  onClearAll, onProcess, onDownloadClick,
}: NoteStageProps) {
  const PANEL_BG = '#1A3A52'
  const [copied, setCopied] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const handleCopy = () => {
    const t = items.map((it) => `Q: ${it.question}\nA: ${it.answer}`).join('\n\n')
    navigator.clipboard.writeText(t).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">

      {/* 左：貼入文字 */}
      <div
        className="flex w-[45%] shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md"
      >
        <div className="flex items-center gap-2 border-b border-white/20 px-4 py-2.5" style={{ backgroundColor: HEADER_COLOR }}>
          <BookOpen className="h-4 w-4 text-white/70" />
          <span className="text-base font-medium text-white/70">原始筆記</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onProcess}
            disabled={processing || !text.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1 text-base font-semibold text-white transition hover:bg-violet-500 disabled:opacity-40"
          >
            {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            轉成 Q&A
          </button>
        </div>
        <div className="flex flex-1 flex-col overflow-hidden bg-white p-3">
          <textarea
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder={"貼入或輸入任意文字…\n\n例：\n- 會議紀錄\n- SOP 說明\n- 規章條文\n- 產品說明\n\nAI 將協助轉換為 Q&A 格式"}
            className="flex-1 resize-none rounded-lg bg-transparent p-3 text-base text-gray-700 placeholder-gray-300 outline-none focus:ring-1 focus:ring-sky-400/60"
          />
        </div>
      </div>

      {/* 右：Q&A 整理結果 */}
      <div
        className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md"
        style={{ backgroundColor: PANEL_BG }}
      >
        {/* 操作按鈕列 */}
        <div className="flex shrink-0 items-center gap-2 border-b border-white/20 px-4 py-2.5">
            <span className="text-base font-medium text-white/70">Q&A 整理結果</span>
            {processing && (
              <span className="rounded-full bg-sky-900/40 px-2 py-0.5 text-xs text-sky-300/90">
                處理中
              </span>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={onDownloadClick}
              disabled={items.length === 0}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1 text-base font-semibold text-white transition hover:bg-sky-500 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              下載 Q&A
            </button>
            <button
              type="button"
              onClick={handleCopy}
              disabled={items.length === 0}
              className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1 text-base font-semibold text-white/70 transition hover:bg-white/10 disabled:opacity-40"
            >
              {copied ? <ClipboardCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Clipboard className="h-3.5 w-3.5" />}
              {copied ? '已複製' : '複製'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              disabled={items.length === 0 || processing}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1 text-base font-semibold text-red-400/70 transition hover:bg-red-500/10 disabled:opacity-40"
              title="清空全部 Q&A"
            >
              <Trash2 className="h-3.5 w-3.5" />
              清空
            </button>
        </div>

        <ConfirmModal
          open={confirmClear}
          title="清空 Q&A"
          message="確定清除所有 Q&A 條目？此操作無法復原。"
          confirmText="確定清空"
          variant="danger"
          onConfirm={() => { onClearAll(); setConfirmClear(false) }}
          onCancel={() => setConfirmClear(false)}
        />

        {/* Q&A 卡片列表 */}
        <div className="flex-1 space-y-1 overflow-y-auto px-4 pb-4 pt-2 bg-white">
          {items.length === 0 && processing && (
            <div className="flex flex-col items-center justify-center gap-3 pt-16 text-white/40">
              <span className="text-base">Q&A 將逐段出現…</span>
            </div>
          )}
          {items.length === 0 && !processing && (
            <div className="flex flex-col items-center gap-3 pt-16 text-white/30">
              <Sparkles className="h-8 w-8 opacity-40" />
              <p className="text-base">在左側貼入文字後，點擊「轉成 Q&A」</p>
            </div>
          )}

          {items.map((item) => (
            <QACard
              key={item.id}
              item={item}
              onUpdate={(patch) => onUpdateItem(item.id, patch)}
              onDelete={() => onDeleteItem(item.id)}
            />
          ))}

          {items.length > 0 && (
            <button
              type="button"
              onClick={onAddItem}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 py-3 text-base text-white/40 transition hover:border-white/40 hover:text-white/60"
            >
              <Plus className="h-4 w-4" />
              新增一條
            </button>
          )}
        </div>
        {doneInfo && (
          <div className="flex flex-shrink-0 items-center border-t border-white/10 px-4 py-2 font-mono text-base text-white/60">
            <span>model: {doneInfo.model}</span>
            <span className="mx-2 text-white/20">·</span>
            <span>prompt: {doneInfo.usage.prompt_tokens.toLocaleString()}</span>
            <span className="mx-2 text-white/20">·</span>
            <span>completion: {doneInfo.usage.completion_tokens.toLocaleString()}</span>
            <span className="mx-2 text-white/20">·</span>
            <span>total: {doneInfo.usage.total_tokens.toLocaleString()}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// 重新上傳 Modal
// ══════════════════════════════════════════════════

function ReuploadModal({
  hasExistingItems,
  title = '上傳文件',
  onConfirm,
  onClose,
}: {
  hasExistingItems: boolean
  title?: string
  onConfirm: (file: File, append: boolean) => void
  onClose: () => void
}) {
  const MODAL_BG = '#1A3A52'
  const [tempFile, setTempFile] = useState<File | null>(null)
  const [append, setAppend] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileError, setFileError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleSubmit = () => {
    if (!tempFile) return
    if (hasExistingItems && !append) {
      setConfirmOpen(true)
    } else {
      onConfirm(tempFile, append)
    }
  }

  const handleFile = (f: File | undefined) => {
    if (!f) return
    if (!f.name.toLowerCase().match(/\.(pdf|txt)$/)) {
      setFileError('目前支援 PDF 或 TXT 格式')
      return
    }
    setFileError('')
    setTempFile(f)
  }

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-white/20 p-6 shadow-2xl"
        style={{ backgroundColor: MODAL_BG }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-400/20">
            <Upload className="h-4 w-4 text-sky-300" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">{title}</h3>
            <p className="text-base text-white/50">選擇 PDF / TXT，AI 自動開始整理</p>
          </div>
        </div>

        {/* 拖曳上傳區 */}
        <div
          className={`mb-4 flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed p-7 transition-colors ${
            tempFile
              ? 'border-sky-400/60 bg-sky-900/20'
              : 'border-white/20 hover:border-white/40 hover:bg-white/5'
          }`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]) }}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          {tempFile ? (
            <>
              <FileText className="h-7 w-7 text-sky-400" />
              <div className="text-center">
                <p className="text-base font-medium text-white">{tempFile.name}</p>
                <p className="text-base text-white/50">{(tempFile.size / 1024).toFixed(1)} KB</p>
              </div>
              <p className="text-base text-white/40">點擊重新選擇</p>
            </>
          ) : (
            <>
              <Upload className="h-7 w-7 text-white/40" />
              <p className="text-base text-white/60">拖曳 PDF / TXT 至此，或點擊選擇</p>
              <p className="text-base text-white/30">最大 20 MB</p>
            </>
          )}
        </div>
        {fileError && <p className="mb-3 text-base text-red-400">{fileError}</p>}

        {/* 累加模式 toggle（有舊 Q&A 時顯示）*/}
        {hasExistingItems && (
          <div className="mb-5 flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-2.5">
            <div>
              <p className="text-base font-medium text-white/80">Q&A 累加模式</p>
              <p className="text-base text-white/40">{append ? '新 Q&A 將附加到現有清單' : '新 Q&A 將取代現有清單'}</p>
            </div>
            <button
              type="button"
              onClick={() => setAppend((v) => !v)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${append ? 'bg-sky-500' : 'bg-white/20'}`}
              role="switch"
              aria-checked={append}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${append ? 'translate-x-5' : 'translate-x-0'}`}
              />
            </button>
          </div>
        )}

        {/* 按鈕 */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-white/20 py-2.5 text-base text-white/60 hover:bg-white/10"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!tempFile}
            onClick={handleSubmit}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-base font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: '#0e7490' }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            開始整理
          </button>
        </div>
      </div>
    </div>

    <ConfirmModal
      open={confirmOpen}
      title="確認取代 Q&A"
      message="目前的 Q&A 清單將被清除，確定繼續？"
      confirmText="確認取代"
      cancelText="取消"
      variant="danger"
      onConfirm={() => { setConfirmOpen(false); onConfirm(tempFile!, false) }}
      onCancel={() => setConfirmOpen(false)}
    />
  </>
  )
}

// ══════════════════════════════════════════════════
// ══════════════════════════════════════════════════
// 下載 Q&A Modal（下載 TXT + 可選匯入 KB）
// ══════════════════════════════════════════════════

function DownloadModal({
  qaTitle,
  onExportTxt,
  onImport,
  onClose,
}: {
  qaTitle: string
  onExportTxt: (qaSetName: string) => Promise<void>
  onImport: (kbId: number | undefined, newKbName: string | undefined, qaSetName: string) => Promise<void>
  onClose: () => void
}) {
  const MODAL_BG = '#1A3A52'
  const [qaSetName, setQaSetName] = useState(qaTitle)
  const [importEnabled, setImportEnabled] = useState(false)
  const [kbs, setKbs] = useState<KBOption[]>([])
  const [kbsLoading, setKbsLoading] = useState(false)
  const [selectedKbId, setSelectedKbId] = useState<number | 'new' | ''>('')
  const [newKbName, setNewKbName] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (importEnabled && kbs.length === 0 && !kbsLoading) {
      setKbsLoading(true)
      listKBs()
        .then((data) => { setKbs(data); if (data.length > 0) setSelectedKbId(data[0].id) })
        .catch(() => setSelectedKbId('new'))
        .finally(() => setKbsLoading(false))
    }
  }, [importEnabled])

  const selectedKbName = selectedKbId === 'new'
    ? (newKbName.trim() || '新知識庫')
    : (kbs.find((kb) => kb.id === selectedKbId)?.name ?? '')

  const canConfirm = !loading && (
    !importEnabled ||
    (selectedKbId === 'new' ? newKbName.trim().length > 0 : typeof selectedKbId === 'number')
  )

  const handleConfirm = async () => {
    setLoading(true)
    const name = qaSetName.trim() || qaTitle
    try {
      await onExportTxt(name)
      if (importEnabled) {
        const kbId = typeof selectedKbId === 'number' ? selectedKbId : undefined
        const newKb = selectedKbId === 'new' ? newKbName.trim() : undefined
        await onImport(kbId, newKb, name)
      }
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border border-white/20 p-6 shadow-2xl"
        style={{ backgroundColor: MODAL_BG }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-base font-semibold text-white">下載 Q&A</h3>

        {/* Q&A 集名稱 */}
        <div className="mb-4">
          <label className="mb-1.5 block text-base text-white/60">Q&A 集名稱</label>
          <input
            type="text"
            value={qaSetName}
            onChange={(e) => setQaSetName(e.target.value)}
            placeholder="輸入名稱…"
            className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-base text-white placeholder-white/30 outline-none focus:border-sky-400"
          />
        </div>

        {/* 匯入 KB toggle */}
        <div
          className="mb-4 flex cursor-pointer items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3"
          onClick={() => setImportEnabled((v) => !v)}
        >
          <div>
            <p className="text-base font-medium text-white/80">同時匯入至知識庫</p>
            <p className="text-base text-white/40">{importEnabled ? '下載後自動匯入' : '僅下載 TXT'}</p>
          </div>
          <button
            type="button"
            className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${importEnabled ? 'bg-sky-500' : 'bg-white/20'}`}
            role="switch"
            aria-checked={importEnabled}
            onClick={(e) => { e.stopPropagation(); setImportEnabled((v) => !v) }}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${importEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        {/* KB 選擇（toggle ON 後才顯示）*/}
        {importEnabled && (
          <div className="mb-4 space-y-3">
            {kbsLoading ? (
              <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-white/40" /></div>
            ) : (
              <>
                <div>
                  <label className="mb-1.5 block text-base text-white/60">選擇知識庫</label>
                  <select
                    value={selectedKbId === '' ? '' : String(selectedKbId)}
                    onChange={(e) => {
                      const v = e.target.value
                      setSelectedKbId(v === 'new' ? 'new' : Number(v))
                    }}
                    className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-base text-white outline-none focus:border-sky-400"
                  >
                    {kbs.map((kb) => (
                      <option key={kb.id} value={kb.id} className="bg-slate-800">
                        {kb.name}{kb.scope === 'company' ? '（公司）' : ''}
                      </option>
                    ))}
                    <option value="new" className="bg-slate-800">＋ 建立新知識庫</option>
                  </select>
                </div>
                {selectedKbId === 'new' && (
                  <div>
                    <label className="mb-1.5 block text-base text-white/60">新知識庫名稱</label>
                    <input
                      type="text"
                      value={newKbName}
                      onChange={(e) => setNewKbName(e.target.value)}
                      placeholder="輸入名稱…"
                      className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-base text-white placeholder-white/30 outline-none focus:border-sky-400"
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* 確認摘要 */}
        <p className="mb-3 text-base text-white/50">
          {importEnabled
            ? `將下載 TXT 並匯入至「${selectedKbName}」`
            : '將下載 TXT 檔案'}
        </p>

        {/* 按鈕 */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 rounded-xl border border-white/20 py-2.5 text-base text-white/60 hover:bg-white/10 disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-base font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: '#0e7490' }}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            確認下載
          </button>
        </div>
      </div>
    </div>
  )
}

