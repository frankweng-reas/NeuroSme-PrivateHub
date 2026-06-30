/**
 * KB 管理 Agent UI（agent_id = kb-manager）
 * 三欄式：左=知識庫列表 / 中=文件管理 / 右=測試查詢
 * 對象：一般員工（可查詢）、manager+（可建立/管理 KB 與文件）
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  BarChart2,
  Check,
  ChevronRight,
  FileText,
  Headphones,
  Loader2,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
  Upload,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import { chatCompletionsStream } from '@/api/chat'
import { ApiError } from '@/api/client'
import {
  addChunk,
  adminListKnowledgeBases,
  batchDeleteChunks,
  createConnector,
  createKnowledgeBase,
  deleteChunk,
  deleteConnector,
  deleteKnowledgeBase,
  deleteKmDocument,
  getKbQueryStats,
  listConnectors,
  listKbChunks,
  listKbDocuments,
  listKnowledgeBases,
  triggerConnectorSync,
  updateChunk,
  updateConnector,
  updateKnowledgeBase,
  uploadKmDocument,
  validateSlackToken,
  type KbScope,
  type KmChunkDetail,
  type KmConnector,
  type KmDocument,
  type KmKnowledgeBase,
  type QueryStatsResponse,
  type QueryStatsView,
  type SlackChannel,
} from '@/api/km'
import { getMe } from '@/api/users'
import { appendChatMessage, createChatThread, listChatMessages } from '@/api/chatThreads'
import AgentChat, { type Message, type ResponseMeta } from '@/components/AgentChat'
import AgentHeader from '@/components/AgentHeader'
import ConfirmModal from '@/components/ConfirmModal'
import ErrorModal from '@/components/ErrorModal'
import HelpModal from '@/components/HelpModal'
import KbTransferModal from '@/components/KbTransferModal'
import LLMModelSelect from '@/components/LLMModelSelect'
import type { Agent, User } from '@/types'

interface Props { agent: Agent }

const HEADER_COLOR = '#1A3A52'

/** 將 local:{id}/model 或 custom:{id}/model 剝除前綴，僅顯示 model 名稱 */
function stripModelPrefix(modelId: string): string {
  if (!modelId) return modelId
  const slashIdx = modelId.indexOf('/')
  if ((modelId.startsWith('local:') || modelId.startsWith('custom:')) && slashIdx >= 0) {
    return modelId.slice(slashIdx + 1)
  }
  if (modelId.startsWith('local/')) return modelId.slice(6)
  return modelId
}


export default function AgentKbManagerUI({ agent }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const userRole = currentUser?.role ?? 'member'
  const isAdmin = userRole === 'admin' || userRole === 'super_admin'
  const canManage = isAdmin || userRole === 'manager'

  // 判斷目前使用者是否可修改指定 KB（只有 owner 或 admin 可寫）
  const canModifyKb = (kb: KmKnowledgeBase) => isAdmin || kb.created_by === currentUser?.id

  useEffect(() => {
    getMe().then((me) => setCurrentUser(me)).catch(() => {})
  }, [])

  // ── KB 所有人名稱對照（admin 專用）─────────────────────────────────────────
  const [kbOwnerNames, setKbOwnerNames] = useState<Record<number, string>>({})
  const [transferKbTarget, setTransferKbTarget] = useState<KmKnowledgeBase | null>(null)

  // ── 左欄：KB 列表 ─────────────────────────────────────────────────────────
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [midExpanded, setMidExpanded] = useState(true)
  const [kbs, setKbs] = useState<KmKnowledgeBase[]>([])
  const [kbsLoading, setKbsLoading] = useState(true)
  const [selectedKbId, setSelectedKbId] = useState<number | null>(null)
  const [kbMenuId, setKbMenuId] = useState<number | null>(null)
  const kbMenuRef = useRef<HTMLLIElement | null>(null)
  // 折疊狀態（記憶在 localStorage）
  const [myKbOpen, setMyKbOpen] = useState(() => {
    try { return localStorage.getItem('kb-section-my') !== 'closed' } catch { return true }
  })
  const [companyKbOpen, setCompanyKbOpen] = useState(() => {
    try { return localStorage.getItem('kb-section-company') === 'open' } catch { return false }
  })
  const [othersKbOpen, setOthersKbOpen] = useState(() => {
    try { return localStorage.getItem('kb-section-others') !== 'closed' } catch { return true }
  })

  const [creatingKbModal, setCreatingKbModal] = useState(false)

  const [deleteKbTarget, setDeleteKbTarget] = useState<KmKnowledgeBase | null>(null)

  // KB 設定 Modal（新增 & 編輯共用）
  const [settingsKb, setSettingsKb] = useState<KmKnowledgeBase | null>(null)
  const [settingsName, setSettingsName] = useState('')
  const [settingsModel, setSettingsModel] = useState('')
  const [settingsPrompt, setSettingsPrompt] = useState('')
  const [settingsScope, setSettingsScope] = useState<KbScope>('personal')
  const [settingsSaving, setSettingsSaving] = useState(false)

  // 用 ref 追蹤 isAdmin，讓 loadKbs callback 永遠讀到最新值
  const isAdminRef = useRef(isAdmin)
  useEffect(() => { isAdminRef.current = isAdmin }, [isAdmin])

  const loadKbs = useCallback(() => {
    setKbsLoading(true)
    const fetchFn = isAdminRef.current ? adminListKnowledgeBases : listKnowledgeBases
    fetchFn()
      .then((data) => {
        setKbs(data)
        if (isAdminRef.current) {
          const map: Record<number, string> = {}
          ;(data as import('@/api/km').KmKnowledgeBaseAdmin[]).forEach((kb) => {
            if (kb.created_by && kb.created_by_name) map[kb.id] = kb.created_by_name
          })
          setKbOwnerNames(map)
        }
        if (data.length > 0 && selectedKbId === null) setSelectedKbId(data[0].id)
      })
      .catch(() => setKbs([]))
      .finally(() => setKbsLoading(false))
  }, [selectedKbId])

  // 初始載入（loadKbs 用 ref 判斷 isAdmin，所以不需要 isAdmin 作為依賴）
  useEffect(() => { loadKbs() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Admin 身份確認後重新載入，補抓其他人的 KB
  useEffect(() => {
    if (isAdmin) loadKbs()
  }, [isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!kbMenuId) return
    const handler = (e: MouseEvent) => {
      if (kbMenuRef.current && !kbMenuRef.current.contains(e.target as Node)) setKbMenuId(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [kbMenuId])

  useEffect(() => { if (creatingKbModal) {} }, [creatingKbModal])

  const openCreateKbModal = () => {
    setSettingsKb(null)
    setSettingsName('')
    setSettingsModel('')
    setSettingsPrompt('')
    setSettingsScope('personal')
    setCreatingKbModal(true)
  }

  const closeSettingsModal = () => {
    setSettingsKb(null)
    setCreatingKbModal(false)
  }

  const handleDeleteKb = async () => {
    if (!deleteKbTarget) return
    try {
      await deleteKnowledgeBase(deleteKbTarget.id)
      setKbs((prev) => prev.filter((kb) => kb.id !== deleteKbTarget.id))
      if (selectedKbId === deleteKbTarget.id) {
        const remaining = kbs.filter((kb) => kb.id !== deleteKbTarget.id)
        setSelectedKbId(remaining.length > 0 ? remaining[0].id : null)
      }
    } catch (err) {
      setErrorModal({ title: '刪除失敗', message: err instanceof Error ? err.message : '刪除失敗' })
    } finally {
      setDeleteKbTarget(null)
    }
  }

  const handleSaveSettings = async () => {
    if (!settingsName.trim()) return
    setSettingsSaving(true)
    try {
      if (creatingKbModal) {
        // 新增模式
        const kb = await createKnowledgeBase({
          name: settingsName.trim(),
          model_name: settingsModel,
          scope: settingsScope,
          system_prompt: settingsPrompt,
        })
        setKbs((prev) => [...prev, kb])
        setSelectedKbId(kb.id)
        setCreatingKbModal(false)
        showToast('知識庫已建立')
      } else {
        if (!settingsKb) return
        const updated = await updateKnowledgeBase(settingsKb.id, {
          name: settingsName.trim(),
          model_name: settingsModel,
          system_prompt: settingsPrompt,
          scope: settingsScope,
        })
        setKbs((prev) => prev.map((kb) => kb.id === updated.id ? updated : kb))
        setSettingsKb(null)
        showToast('設定已儲存')
      }
    } catch (err) {
      setErrorModal({ title: creatingKbModal ? '建立知識庫失敗' : '儲存設定失敗', message: err instanceof Error ? err.message : '操作失敗' })
    } finally {
      setSettingsSaving(false)
    }
  }

  // ── 知識條目（Chunks 跨文件視圖）──────────────────────────────────────────
  const [kbChunks, setKbChunks] = useState<KmChunkDetail[]>([])
  const [kbChunksLoading, setKbChunksLoading] = useState(false)
  const [chunkSearchQuery, setChunkSearchQuery] = useState('')
  const [chunkSourceFilter, setChunkSourceFilter] = useState<number | null>(null)
  const [selectedChunkIds, setSelectedChunkIds] = useState<Set<number>>(new Set())
  const [editingChunk, setEditingChunk] = useState<KmChunkDetail | null>(null)
  const [editModalContent, setEditModalContent] = useState('')
  const [editModalSaving, setEditModalSaving] = useState(false)
  const [addEntryOpen, setAddEntryOpen] = useState(false)
  const [addEntryContent, setAddEntryContent] = useState('')
  const [addEntryDocId, setAddEntryDocId] = useState<number | null>(null)
  const [addEntrySaving, setAddEntrySaving] = useState(false)
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [confirmBatchDeleteOpen, setConfirmBatchDeleteOpen] = useState(false)

  const loadKbChunks = useCallback((kbId: number, q?: string, docId?: number) => {
    setKbChunksLoading(true)
    listKbChunks(kbId, { q: q || undefined, document_id: docId ?? undefined, limit: 200 })
      .then(setKbChunks)
      .catch(() => setKbChunks([]))
      .finally(() => setKbChunksLoading(false))
  }, [])

  const handleEditChunkSave = useCallback(async () => {
    if (!editingChunk) return
    const content = editModalContent.trim()
    if (!content) return
    setEditModalSaving(true)
    try {
      await updateChunk(editingChunk.id, content)
      setKbChunks((prev) => prev.map((c) => c.id === editingChunk.id ? { ...c, content } : c))
      setEditingChunk(null)
      showToast('條目已儲存並重新 Embedding')
    } catch (err) {
      setErrorModal({ title: '儲存失敗', message: err instanceof Error ? err.message : '儲存失敗' })
    } finally {
      setEditModalSaving(false)
    }
  }, [editingChunk, editModalContent]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeleteSingleChunk = useCallback(async (chunkId: number) => {
    try {
      await deleteChunk(chunkId)
      setKbChunks((prev) => prev.filter((c) => c.id !== chunkId))
      setSelectedChunkIds((prev) => { const next = new Set(prev); next.delete(chunkId); return next })
      showToast('條目已刪除')
    } catch (err) {
      setErrorModal({ title: '刪除失敗', message: err instanceof Error ? err.message : '刪除失敗' })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleBatchDelete = useCallback(async () => {
    if (selectedChunkIds.size === 0) return
    setBatchDeleting(true)
    try {
      const count = selectedChunkIds.size
      await batchDeleteChunks([...selectedChunkIds])
      setKbChunks((prev) => prev.filter((c) => !selectedChunkIds.has(c.id)))
      setSelectedChunkIds(new Set())
      showToast(`已刪除 ${count} 筆條目`)
      // 重新載入文件清單，更新篩選選單（chunk_count 可能已歸零）
      if (selectedKbId) {
        listKbDocuments(selectedKbId)
          .then((loaded) => setDocs(loaded))
          .catch(() => {})
      }
    } catch (err) {
      setErrorModal({ title: '批次刪除失敗', message: err instanceof Error ? err.message : '刪除失敗' })
    } finally {
      setBatchDeleting(false)
    }
  }, [selectedChunkIds, selectedKbId]) // eslint-disable-line react-hooks/exhaustive-deps


  // ── 中欄：文件管理 ─────────────────────────────────────────────────────────
  const [docs, setDocs] = useState<KmDocument[]>([])
  const [selectedDocIds, setSelectedDocIds] = useState<Set<number>>(new Set())
  const [, setDocsLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadCurrent, setUploadCurrent] = useState(0)
  const [uploadTotal, setUploadTotal] = useState(0)
  const [uploadDocType, setUploadDocType] = useState<string>('article')
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [deleteDocTarget, setDeleteDocTarget] = useState<KmDocument | null>(null)
  const [deleteDocLoading, setDeleteDocLoading] = useState(false)

  // ── 中欄：Tab 切換（文件管理 / 查詢統計 / 資料來源） ────────────────────────
  const [centerTab, setCenterTab] = useState<'docs' | 'stats' | 'sources'>('docs')

  // ── 中欄：資料來源（Connectors） ────────────────────────────────────────────
  const [connectors, setConnectors] = useState<KmConnector[]>([])
  const [connectorsLoading, setConnectorsLoading] = useState(false)
  const [syncingConnectorId, setSyncingConnectorId] = useState<number | null>(null)
  const [deleteConnectorTarget, setDeleteConnectorTarget] = useState<KmConnector | null>(null)
  // 新增／編輯 Modal
  const [connectorModalOpen, setConnectorModalOpen] = useState(false)
  const [connectorModalStep, setConnectorModalStep] = useState<'token' | 'channels' | 'edit'>('token')
  const [connectorToken, setConnectorToken] = useState('')
  const [connectorName, setConnectorName] = useState('')
  const [connectorInterval, setConnectorInterval] = useState(1440)
  const [connectorDaysLookback, setConnectorDaysLookback] = useState(30)
  const [connectorValidating, setConnectorValidating] = useState(false)
  const [connectorWorkspace, setConnectorWorkspace] = useState('')
  const [availableChannels, setAvailableChannels] = useState<SlackChannel[]>([])
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([])
  const [connectorSaving, setConnectorSaving] = useState(false)
  const [connectorError, setConnectorError] = useState('')

  const loadConnectors = useCallback((kbId: number) => {
    setConnectorsLoading(true)
    listConnectors(kbId)
      .then(setConnectors)
      .catch(() => setConnectors([]))
      .finally(() => setConnectorsLoading(false))
  }, [])

  const [editingConnector, setEditingConnector] = useState<KmConnector | null>(null)

  const openConnectorModal = () => {
    setEditingConnector(null)
    setConnectorModalStep('token')
    setConnectorToken('')
    setConnectorName('')
    setConnectorInterval(1440)
    setConnectorDaysLookback(30)
    setConnectorWorkspace('')
    setAvailableChannels([])
    setSelectedChannelIds([])
    setConnectorError('')
    setConnectorModalOpen(true)
  }

  const openEditConnectorModal = async (c: KmConnector) => {
    setEditingConnector(c)
    setConnectorName(c.display_name)
    setConnectorInterval(c.sync_interval_minutes)
    setConnectorDaysLookback((c.config?.days_lookback as number) ?? 30)
    setConnectorToken('')
    setConnectorError('')
    setAvailableChannels([])
    setSelectedChannelIds((c.config?.channel_ids as string[]) ?? [])
    // 直接進到頻道選擇步驟，需要先驗證取得可選頻道
    // 顯示 modal 讓使用者看到目前選擇，並可重新驗證 token 取得最新頻道清單
    setConnectorModalStep('edit')
    setConnectorModalOpen(true)
  }

  const handleValidateToken = async () => {
    if (!connectorToken.trim()) return
    setConnectorValidating(true)
    setConnectorError('')
    try {
      const result = await validateSlackToken(connectorToken.trim())
      setConnectorWorkspace(result.workspace)
      setAvailableChannels(result.channels)
      setSelectedChannelIds([])
      if (!connectorName) setConnectorName(`Slack - ${result.workspace}`)
      setConnectorModalStep('channels')
    } catch (e: unknown) {
      setConnectorError(e instanceof Error ? e.message : 'Token 驗證失敗')
    } finally {
      setConnectorValidating(false)
    }
  }

  const handleValidateTokenForEdit = async () => {
    if (!connectorToken.trim() || connectorValidating) return
    setConnectorValidating(true)
    setConnectorError('')
    try {
      const result = await validateSlackToken(connectorToken.trim())
      setAvailableChannels(result.channels)
      if (result.channels.length === 0) {
        setConnectorError('找不到可用頻道，請確認 Token 權限是否包含 channels:read')
      }
    } catch (e: unknown) {
      setConnectorError(e instanceof Error ? e.message : '驗證失敗')
    } finally {
      setConnectorValidating(false)
    }
  }

  const handleSaveEditConnector = async () => {
    if (!editingConnector || !selectedKbId) return
    setConnectorSaving(true)
    setConnectorError('')
    try {
      // 合併舊的 channel_names，再用最新載入的頻道清單覆蓋有名稱的部分
      const oldNames = (editingConnector.config?.channel_names as Record<string, string>) ?? {}
      const channelNameMap: Record<string, string> = { ...oldNames }
      availableChannels.forEach((ch) => {
        if (selectedChannelIds.includes(ch.id)) channelNameMap[ch.id] = ch.name
      })
      // 移除已取消勾選的 ID
      Object.keys(channelNameMap).forEach((id) => {
        if (!selectedChannelIds.includes(id)) delete channelNameMap[id]
      })
      const newConfig = {
        ...editingConnector.config,
        channel_ids: selectedChannelIds,
        channel_names: channelNameMap,
        days_lookback: connectorDaysLookback,
      }
      const updateData: Parameters<typeof updateConnector>[1] = {
        display_name: connectorName,
        config: newConfig,
        sync_interval_minutes: connectorInterval,
      }
      if (connectorToken.trim()) {
        updateData.credentials = { token: connectorToken.trim() }
      }
      await updateConnector(editingConnector.id, updateData)
      setConnectorModalOpen(false)
      loadConnectors(selectedKbId)
    } catch (e: unknown) {
      setConnectorError(e instanceof Error ? e.message : '儲存失敗')
    } finally {
      setConnectorSaving(false)
    }
  }

  const handleCreateConnector = async () => {
    if (!selectedKbId || selectedChannelIds.length === 0) return
    setConnectorSaving(true)
    setConnectorError('')
    try {
      const channelNameMap: Record<string, string> = {}
      availableChannels.forEach((ch) => {
        if (selectedChannelIds.includes(ch.id)) channelNameMap[ch.id] = ch.name
      })
      await createConnector({
        knowledge_base_id: selectedKbId,
        source_type: 'slack',
        display_name: connectorName || 'Slack',
        config: {
          channel_ids: selectedChannelIds,
          channel_names: channelNameMap,
          days_lookback: connectorDaysLookback,
          doc_type: 'chat',
          include_threads: true,
        },
        credentials: { token: connectorToken.trim() },
        sync_interval_minutes: connectorInterval,
      })
      setConnectorModalOpen(false)
      const updated = await listConnectors(selectedKbId)
      setConnectors(updated)
      // 立刻觸發首次同步（帶輪詢）
      const newest = updated[updated.length - 1]
      if (newest) {
        handleTriggerSync(newest.id)
      }
    } catch (e: unknown) {
      setConnectorError(e instanceof Error ? e.message : '建立失敗')
    } finally {
      setConnectorSaving(false)
    }
  }

  const handleTriggerSync = async (connectorId: number) => {
    if (!selectedKbId) return
    setSyncingConnectorId(connectorId)
    try {
      await triggerConnectorSync(connectorId)
      // 輪詢直到 last_synced_at 更新（最多等 30 秒）
      const kbId = selectedKbId
      let attempts = 0
      const poll = setInterval(async () => {
        attempts++
        const updated = await listConnectors(kbId)
        setConnectors(updated)
        const target = updated.find((c) => c.id === connectorId)
        const isDone = target?.last_synced_at && (
          attempts === 1 || new Date(target.last_synced_at).getTime() > Date.now() - 35000
        )
        if (isDone || attempts >= 15) {
          clearInterval(poll)
          setSyncingConnectorId(null)
          if (isDone) loadDocs(kbId)
        }
      }, 2000)
    } catch {
      setSyncingConnectorId(null)
    }
  }

  const handleTogglePause = async (c: KmConnector) => {
    if (!selectedKbId) return
    await updateConnector(c.id, { status: c.status === 'active' ? 'paused' : 'active' })
    loadConnectors(selectedKbId)
  }

  const handleDeleteConnector = async () => {
    if (!deleteConnectorTarget || !selectedKbId) return
    try {
      await deleteConnector(deleteConnectorTarget.id)
      setDeleteConnectorTarget(null)
      loadConnectors(selectedKbId)
    } catch {
      /* ignore */
    }
  }

  // ── 中欄：查詢統計 ─────────────────────────────────────────────────────────
  const [statsDays, setStatsDays] = useState<7 | 30 | 90>(30)
  const [statsView, setStatsView] = useState<QueryStatsView>('top_queries')
  const [statsData, setStatsData] = useState<QueryStatsResponse | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsOffset, setStatsOffset] = useState(0)
  const STATS_LIMIT = 20

  const loadStats = useCallback((kbId: number, days: 7 | 30 | 90, view: QueryStatsView, offset = 0) => {
    setStatsLoading(true)
    getKbQueryStats(kbId, { days, view, limit: STATS_LIMIT, offset })
      .then((data) => {
        if (offset === 0) {
          setStatsData(data)
        } else {
          setStatsData((prev) => prev ? {
            ...data,
            queries: [...prev.queries, ...data.queries],
          } : data)
        }
        setStatsOffset(offset)
      })
      .catch(() => {})
      .finally(() => setStatsLoading(false))
  }, [])

  const storageKey = (kbId: number) => `kb-manager-docs-${kbId}`

  const loadDocs = useCallback((kbId: number) => {
    setDocsLoading(true)
    listKbDocuments(kbId)
      .then((loaded) => {
        setDocs(loaded)
        const readyIds = loaded.filter((d) => d.status === 'ready').map((d) => d.id)
        const saved = localStorage.getItem(storageKey(kbId))
        if (saved) {
          try {
            const parsed: number[] = JSON.parse(saved)
            setSelectedDocIds(new Set(parsed.filter((id) => readyIds.includes(id))))
          } catch {
            setSelectedDocIds(new Set(readyIds))
          }
        } else {
          setSelectedDocIds(new Set(readyIds))
        }
      })
      .catch(() => { setDocs([]); setSelectedDocIds(new Set()) })
      .finally(() => setDocsLoading(false))
  }, [])

  const handleAddEntry = useCallback(async () => {
    const docId = addEntryDocId
    if (!docId || !addEntryContent.trim()) return
    setAddEntrySaving(true)
    try {
      const added = await addChunk(docId, addEntryContent.trim())
      const doc = docs.find((d) => d.id === docId)
      const detail: KmChunkDetail = {
        id: added.id,
        document_id: docId,
        chunk_index: added.chunk_index,
        content: added.content,
        metadata: null,
        doc_filename: doc?.filename ?? null,
      }
      setKbChunks((prev) => [...prev, detail])
      setAddEntryContent('')
      setAddEntryOpen(false)
      showToast('條目已新增並完成 Embedding')
    } catch (err) {
      setErrorModal({ title: '新增失敗', message: err instanceof Error ? err.message : '新增失敗' })
    } finally {
      setAddEntrySaving(false)
    }
  }, [addEntryDocId, addEntryContent, docs]) // eslint-disable-line react-hooks/exhaustive-deps

  const threadStorageKey = (kbId: number) => `kb-manager-thread-${kbId}`

  useEffect(() => {
    if (selectedKbId != null) {
      loadDocs(selectedKbId)
      loadConnectors(selectedKbId)
      loadKbChunks(selectedKbId)
      setChunkSearchQuery('')
      setChunkSourceFilter(null)
      setSelectedChunkIds(new Set())
      // 切換 KB 時重置統計狀態
      setCenterTab('docs')
      setStatsData(null)
      setStatsOffset(0)
      setStatsDays(30)
      setStatsView('top_queries')
      // 嘗試復原舊 thread；沒有則建新的
      const savedThreadId = localStorage.getItem(threadStorageKey(selectedKbId))
      if (savedThreadId) {
        setThreadId(savedThreadId)
        setMessages([])
        listChatMessages(savedThreadId)
          .then((msgs) => {
            setMessages(
              msgs.map((m) => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
              }))
            )
          })
          .catch(() => {
            // thread 已失效，建新的
            localStorage.removeItem(threadStorageKey(selectedKbId))
            setMessages([])
            createChatThread({ agent_id: agent.id, title: null })
              .then((t) => {
                setThreadId(t.id)
                localStorage.setItem(threadStorageKey(selectedKbId), t.id)
              })
              .catch(() => {})
          })
      } else {
        setMessages([])
        createChatThread({ agent_id: agent.id, title: null })
          .then((t) => {
            setThreadId(t.id)
            localStorage.setItem(threadStorageKey(selectedKbId), t.id)
          })
          .catch(() => {})
      }
    } else {
      setDocs([])
    }
  }, [selectedKbId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!selectedKbId) return
      const files = e.target.files
      if (!files?.length) return
      const fileList = Array.from(files)
      e.target.value = ''
      setUploading(true)
      setUploadTotal(fileList.length)
      setUploadCurrent(0)
      let successCount = 0
      let errorCount = 0
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i]
        setUploadCurrent(i + 1)
        setUploadProgress(0)
        const lower = file.name.toLowerCase()
        let detectedType = uploadDocType
        if (uploadDocType === 'article' && /faq|q[&＆]a|問答/.test(lower)) detectedType = 'faq'
        try {
          const doc = await uploadKmDocument(file, 'private', (pct) => setUploadProgress(pct), [], selectedKbId, detectedType)
          setDocs((prev) => [doc, ...prev])
          if (doc.status === 'ready') setSelectedDocIds((prev) => new Set([...prev, doc.id]))
          setKbs((prev) => prev.map((kb) =>
            kb.id === selectedKbId
              ? { ...kb, doc_count: kb.doc_count + 1, ready_count: doc.status === 'ready' ? kb.ready_count + 1 : kb.ready_count }
              : kb
          ))
          // 若 PDF 萃取文字量過少，提示使用 Doc Refiner 進行 OCR
          if (file.name.toLowerCase().endsWith('.pdf') && doc.char_count != null && doc.char_count < 200) {
            setOcrHintFile(file.name)
          }
          successCount++
        } catch (err) {
          errorCount++
          setErrorModal({ title: `「${file.name}」上傳失敗`, message: err instanceof Error ? err.message : '上傳失敗' })
        }
      }
      setUploading(false); setUploadProgress(0); setUploadCurrent(0); setUploadTotal(0)
      if (fileList.length > 1) showToast(errorCount === 0 ? `${successCount} 個上傳完成` : `完成 ${successCount}，失敗 ${errorCount}`)
      else if (successCount === 1) showToast('上傳完成')
      setUploadModalOpen(false)
    },
    [selectedKbId, uploadDocType] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const handleDeleteDoc = useCallback(async () => {
    if (!deleteDocTarget || !selectedKbId) return
    setDeleteDocLoading(true)
    try {
      await deleteKmDocument(deleteDocTarget.id)
      setDocs((prev) => prev.filter((d) => d.id !== deleteDocTarget.id))
      setSelectedDocIds((prev) => { const next = new Set(prev); next.delete(deleteDocTarget.id); return next })
      setKbs((prev) => prev.map((kb) =>
        kb.id === selectedKbId
          ? { ...kb, doc_count: Math.max(0, kb.doc_count - 1), ready_count: deleteDocTarget.status === 'ready' ? Math.max(0, kb.ready_count - 1) : kb.ready_count }
          : kb
      ))
    } catch (err) {
      const msg = err instanceof ApiError ? err.detail ?? err.message : err instanceof Error ? err.message : '刪除失敗'
      showToast(String(msg), 'error')
    } finally {
      setDeleteDocLoading(false)
      setDeleteDocTarget(null)
    }
  }, [deleteDocTarget, selectedKbId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 右欄：Chat ─────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  const latestKbIdRef = useRef(selectedKbId)
  latestKbIdRef.current = selectedKbId

  const handleSendMessage = useCallback(
    async (text: string) => {
      if (!text || isLoading) return
      const kbId = latestKbIdRef.current
      if (!kbId) {
        setMessages((prev) => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '請先在左側選擇知識庫。' }])
        return
      }
      const readyCount = docs.filter((d) => d.status === 'ready').length
      if (readyCount === 0) {
        setMessages((prev) => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '此知識庫尚無可用文件，請先上傳並等待處理完成。' }])
        return
      }
      if (selectedDocIds.size === 0) {
        setMessages((prev) => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '目前沒有勾選任何文件，請至少勾選一份後再提問。' }])
        return
      }
      setMessages((prev) => [...prev, { role: 'user', content: text }])
      setIsLoading(true)
      if (threadId) appendChatMessage(threadId, { role: 'user', content: text }).catch(() => {})
      let assistantText = ''
      const startIdx = messages.length + 1
      setMessages((prev) => [...prev, { role: 'assistant', content: '' }])
      try {
        await chatCompletionsStream(
          {
            agent_id: agent.agent_id,
            prompt_type: 'knowledge',
            system_prompt: '',
            user_prompt: '',
            data: '',
            model: '',
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            content: text,
            knowledge_base_id: kbId,
            selected_doc_ids: [...selectedDocIds],
            chat_thread_id: threadId ?? '',
          },
          {
            onDelta: (chunk) => {
              assistantText += chunk
              setMessages((prev) => {
                const next = [...prev]
                if (next[startIdx]) next[startIdx] = { ...next[startIdx], content: assistantText }
                return next
              })
            },
            onDone: (done) => {
              const meta: ResponseMeta | undefined = done.usage != null
                ? { model: done.model, usage: done.usage, finish_reason: done.finish_reason }
                : undefined
              setMessages((prev) => {
                const next = [...prev]
                if (next[startIdx]) next[startIdx] = { ...next[startIdx], content: done.content, meta, sources: done.sources?.length ? done.sources : undefined }
                return next
              })
              if (threadId && done.content) appendChatMessage(threadId, { role: 'assistant', content: done.content }).catch(() => {})
            },
            onError: (errMsg) => {
              setMessages((prev) => prev.slice(0, startIdx))
              setErrorModal({ title: '對話發生錯誤', message: errMsg })
            },
          }
        )
      } catch (err) {
        setMessages((prev) => prev.slice(0, startIdx))
        setErrorModal({ title: '對話發生錯誤', message: err instanceof Error ? err.message : '未知錯誤' })
      } finally {
        setIsLoading(false)
      }
    },
    [agent.agent_id, isLoading, messages, docs, selectedDocIds, threadId]
  )

  // ── OCR 提示（文字量過少的 PDF） ──────────────────────────────────────────
  const [ocrHintFile, setOcrHintFile] = useState<string | null>(null)

  // ── Toast / Error ─────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ msg: string; type: 'info' | 'error' } | null>(null)
  const showToast = useCallback((msg: string, type: 'info' | 'error' = 'info') => setToast({ msg, type }), [])
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(id)
  }, [toast])
  const [errorModal, setErrorModal] = useState<{ title?: string; message: string } | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  const selectedKb = kbs.find((kb) => kb.id === selectedKbId) ?? null
  const readyCount = docs.filter((d) => d.status === 'ready').length
  // 只有 KB owner 或 admin 可以修改（上傳、刪除文件、設定等）
  const canUploadToSelectedKb = selectedKb != null && canModifyKb(selectedKb)

  // 若切換到沒有管理權限的 KB，且目前在管理專用 tab，自動跳到「查詢統計」
  useEffect(() => {
    if (!canUploadToSelectedKb && (centerTab === 'docs' || centerTab === 'sources')) {
      setCenterTab('stats')
    }
  }, [canUploadToSelectedKb]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative flex h-full flex-col p-4 text-[18px]">
      {toast && (
        <div className={`fixed bottom-8 left-1/2 z-50 -translate-x-1/2 max-w-[90vw] rounded-lg px-4 py-2 text-base text-white shadow-lg ${toast.type === 'error' ? 'bg-red-600' : 'bg-gray-800'}`}
          role={toast.type === 'error' ? 'alert' : 'status'}>{toast.msg}</div>
      )}

      {/* ── OCR 提示 Banner ────────────────────────────────────────────────── */}
      {ocrHintFile && (
        <div className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 flex w-full max-w-xl items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 shadow-lg">
          <span className="mt-0.5 text-amber-500">⚠</span>
          <div className="flex-1 text-sm text-amber-800">
            <span className="font-medium">「{ocrHintFile}」</span> 偵測到文字內容極少，可能是掃描型 PDF。<br />
            建議至 <a href="/agent/default:doc-refiner" className="font-semibold underline hover:text-amber-900">Doc Refiner</a> 進行 OCR 處理後再匯入知識庫。
          </div>
          <button
            type="button"
            onClick={() => setOcrHintFile(null)}
            className="mt-0.5 shrink-0 text-amber-400 hover:text-amber-600"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── 編輯條目 Modal ──────────────────────────────────────────────────── */}
      {editingChunk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div>
                <p className="text-lg font-semibold text-gray-800">編輯知識條目</p>
                {editingChunk.doc_filename && (
                  <p className="text-base text-gray-400">來源：{editingChunk.doc_filename}</p>
                )}
              </div>
              <button type="button" onClick={() => setEditingChunk(null)} disabled={editModalSaving}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-40">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-4">
              <textarea
                autoFocus
                value={editModalContent}
                onChange={(e) => setEditModalContent(e.target.value)}
                rows={10}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-700 focus:border-sky-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-400"
              />
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
              <button type="button" onClick={() => setEditingChunk(null)} disabled={editModalSaving}
                className="rounded-lg border border-gray-300 px-4 py-2 text-base text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                取消
              </button>
              <button type="button" onClick={() => void handleEditChunkSave()}
                disabled={editModalSaving || !editModalContent.trim()}
                className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-base font-medium text-white hover:bg-sky-700 disabled:opacity-50">
                {editModalSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editModalSaving ? '儲存中…' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 新增條目 Modal ──────────────────────────────────────────────────── */}
      {addEntryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <p className="text-lg font-semibold text-gray-800">新增知識條目</p>
              <button type="button" onClick={() => { setAddEntryOpen(false); setAddEntryContent('') }} disabled={addEntrySaving}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-40">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div>
                <label className="mb-1 block text-base font-medium text-gray-700">來源文件</label>
                <select
                  value={addEntryDocId ?? ''}
                  onChange={(e) => setAddEntryDocId(Number(e.target.value) || null)}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-base text-gray-700 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
                >
                  <option value="">— 選擇來源文件 —</option>
                  {docs.filter((d) => d.status === 'ready').map((d) => (
                    <option key={d.id} value={d.id}>{d.filename}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-base font-medium text-gray-700">內容</label>
                <textarea
                  autoFocus
                  value={addEntryContent}
                  onChange={(e) => setAddEntryContent(e.target.value)}
                  rows={8}
                  placeholder="輸入知識條目內容…"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-700 placeholder-gray-300 focus:border-sky-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-400"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
              <button type="button" onClick={() => { setAddEntryOpen(false); setAddEntryContent('') }} disabled={addEntrySaving}
                className="rounded-lg border border-gray-300 px-4 py-2 text-base text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                取消
              </button>
              <button type="button" onClick={() => void handleAddEntry()}
                disabled={addEntrySaving || !addEntryContent.trim() || !addEntryDocId}
                className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-base font-medium text-white hover:bg-sky-700 disabled:opacity-50">
                {addEntrySaving && <Loader2 className="h-4 w-4 animate-spin" />}
                {addEntrySaving ? '新增中…' : '新增'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 上傳 Modal */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div className="flex items-center gap-2">
                <Upload className="h-4 w-4 text-sky-500" />
                <span className="text-lg font-semibold text-gray-800">上傳檔案</span>
              </div>
              <button type="button" onClick={() => !uploading && setUploadModalOpen(false)} disabled={uploading}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-40">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-6 space-y-5">
              <div>
                <p className="mb-1 text-base font-semibold text-gray-700">文件類型</p>
                <p className="mb-3 text-sm text-gray-400">選擇最符合文件用途的類型，系統會以最適合的方式切塊與建立索引</p>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    {
                      value: 'article',
                      emoji: '📄',
                      label: '一般文件',
                      sub: '說明文件、操作手冊、合約、報告、規章',
                      detail: '段落切塊（約 1500 字），保留段落語意完整性，適合 AI 整合回答多段內容',
                    },
                    {
                      value: 'faq',
                      emoji: '💬',
                      label: '精準問答',
                      sub: 'Q&A 問答集、常見問題、客服話術、SOP 步驟',
                      detail: '小切塊（約 300 字）＋ BM25 關鍵字索引，問答對獨立檢索，精準回答 Bot 專用',
                    },
                    {
                      value: 'reference',
                      emoji: '📑',
                      label: '整份查閱',
                      sub: '價目表、術語對照表、產品目錄、不宜拆分的規章',
                      detail: '整份文件不切分，查詢時一次取回完整內容，適合需要對照全表的場景',
                    },
                    {
                      value: 'structured_md',
                      emoji: '🗂️',
                      label: '結構化 MD',
                      sub: 'Doc Refiner 產出的 .md 文件、帶章節標題的手冊',
                      detail: '依 ##/### 標題切 chunk 並附章節路徑，BM25 + 向量雙重索引；僅接受 .md 格式',
                    },
                  ] as const).map(({ value, emoji, label, sub, detail }) => (
                    <button key={value} type="button"
                      disabled={uploading}
                      onClick={() => setUploadDocType(value)}
                      className={`flex flex-col gap-2 rounded-xl border-2 px-4 py-4 text-left transition-all disabled:opacity-60 ${uploadDocType === value ? 'border-sky-400 bg-sky-50 ring-2 ring-sky-200' : 'border-gray-200 bg-gray-50 hover:border-sky-200'}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-2xl leading-none">{emoji}</span>
                        <p className={`text-base font-semibold ${uploadDocType === value ? 'text-sky-700' : 'text-gray-800'}`}>{label}</p>
                        {uploadDocType === value && <Check className="ml-auto h-4 w-4 shrink-0 text-sky-500" />}
                      </div>
                      <p className="text-sm font-medium text-gray-600">{sub}</p>
                      <p className="text-sm text-gray-400 leading-relaxed">{detail}</p>
                    </button>
                  ))}
                </div>
                {uploadDocType === 'structured_md' && (
                  <p className="mt-2 text-sm text-amber-600 flex items-center gap-1.5">
                    <span>⚠️</span>結構化 MD 僅接受 <code className="rounded bg-amber-50 px-1 font-mono">.md</code> /
                    <code className="rounded bg-amber-50 px-1 font-mono">.markdown</code> 格式
                  </p>
                )}
              </div>
              {uploading && (
                <div className="space-y-1">
                  {uploadTotal > 1 && <p className="text-center text-sm text-gray-500">處理中 {uploadCurrent}/{uploadTotal}</p>}
                  <div className="overflow-hidden rounded-full bg-gray-100">
                    <div className="h-2 rounded-full bg-sky-400 transition-all" style={{ width: `${uploadProgress > 0 ? uploadProgress : 100}%` }} />
                  </div>
                </div>
              )}
              <input ref={fileInputRef} type="file"
                accept={uploadDocType === 'structured_md' ? '.md,.markdown' : '.pdf,.txt,.md,.markdown'}
                multiple className="hidden" onChange={handleFileChange} />
              <button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-xl py-4 text-base font-medium text-white hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: HEADER_COLOR }}>
                {uploading
                  ? <><Loader2 className="h-5 w-5 animate-spin" />{`上傳中 ${uploadProgress > 0 ? `${uploadProgress}%` : '…'}`}</>
                  : uploadDocType === 'structured_md'
                    ? <><Upload className="h-5 w-5" />點擊選擇 .md 檔案（可多選）</>
                    : <><Upload className="h-5 w-5" />點擊選擇檔案（可多選，PDF / TXT / MD）</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* KB 設定 Modal */}
      {(settingsKb || creatingKbModal) && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
          <div className="flex w-full max-w-2xl flex-col rounded-xl border border-gray-200 bg-white shadow-xl max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">{creatingKbModal ? '新增知識庫' : '知識庫設定'}</h2>
              <button type="button" onClick={closeSettingsModal} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 overflow-y-auto px-5 py-4">
              <div>
                <label className="mb-1.5 block text-base font-medium text-gray-700">
                  名稱 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={settingsName}
                  onChange={(e) => setSettingsName(e.target.value)}
                  maxLength={100}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-base font-medium text-gray-700">LLM 模型</label>
                <LLMModelSelect value={settingsModel} onChange={setSettingsModel} label="" labelPosition="stacked"
                  selectClassName="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />
              </div>
              <div>
                <label className="mb-1.5 block text-base font-medium text-gray-700">知識庫範圍</label>
                <p className="mb-2 text-base text-gray-400">公司共用需 manager 以上權限才能設定</p>
                <div className="flex gap-3">
                  {([
                    { value: 'personal', label: '🔒 個人私有',  sub: '只有建立者可見' },
                    { value: 'company',  label: '🏢 公司共用',  sub: '同公司全員可引用' },
                    { value: 'bot_only', label: '🤖 Bot 專用',  sub: '僅 Bot 可引用，員工不可見' },
                  ] as const).map(({ value, label, sub }) => (
                    <button key={value} type="button"
                      disabled={!canManage}
                      onClick={() => canManage && setSettingsScope(value)}
                      className={`flex flex-1 flex-col items-start rounded-xl border-2 px-4 py-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                        settingsScope === value
                          ? 'border-sky-400 bg-sky-50 ring-2 ring-sky-200'
                          : 'border-gray-200 bg-gray-50 hover:border-sky-200'
                      }`}>
                      <span className={`text-base font-medium ${settingsScope === value ? 'text-sky-700' : 'text-gray-800'}`}>{label}</span>
                      <span className="text-base text-gray-400">{sub}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-base font-medium text-gray-700">
                  自訂系統提示詞<span className="ml-1 font-normal text-gray-400">（選填）</span>
                </label>
                <p className="mb-1.5 text-sm text-gray-400">
                  直接查詢此知識庫時套用（例如作為獨立 HR / IT 支援使用）。透過 Bot 引用此知識庫時，Bot 本身的提示詞優先，此設定不生效。
                </p>
                <textarea value={settingsPrompt} onChange={(e) => setSettingsPrompt(e.target.value)} rows={8}
                  placeholder="你是 XX 公司的客服助手…"
                  className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 font-mono text-base text-gray-800 placeholder-amber-300 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400" />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
              <button type="button" onClick={closeSettingsModal}
                className="rounded-lg border border-gray-300 px-4 py-2 text-base text-gray-700 hover:bg-gray-50">取消</button>
              <button type="button" onClick={() => void handleSaveSettings()} disabled={settingsSaving || !settingsName.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-base font-medium text-white hover:bg-sky-700 disabled:opacity-60">
                {settingsSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{creatingKbModal ? '建立' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ErrorModal open={errorModal !== null} title={errorModal?.title} message={errorModal?.message ?? ''} onClose={() => setErrorModal(null)} />
      {transferKbTarget && (
        <KbTransferModal
          kb={transferKbTarget}
          currentOwnerName={kbOwnerNames[transferKbTarget.id] ?? null}
          onClose={() => setTransferKbTarget(null)}
          onTransferred={(updated) => {
            setKbs((prev) => prev.map((kb) => kb.id === updated.id ? updated : kb))
            setKbOwnerNames((prev) => {
              const next = { ...prev }
              delete next[updated.id]
              return next
            })
            setTransferKbTarget(null)
            adminListKnowledgeBases().then((list) => {
              const map: Record<number, string> = {}
              list.forEach((kb) => { if (kb.created_by && kb.created_by_name) map[kb.id] = kb.created_by_name })
              setKbOwnerNames(map)
            }).catch(() => {})
          }}
        />
      )}
      <ConfirmModal open={deleteKbTarget !== null} title="刪除知識庫"
        message={`確定要刪除「${deleteKbTarget?.name}」嗎？\n知識庫內所有文件也將一併刪除，此操作無法復原。`}
        confirmText="刪除" variant="danger" onConfirm={() => void handleDeleteKb()} onCancel={() => setDeleteKbTarget(null)} />
      <ConfirmModal open={deleteDocTarget !== null} title="刪除文件"
        message={`確定要刪除「${deleteDocTarget?.filename}」嗎？文件與所有切片將永久刪除。`}
        confirmText={deleteDocLoading ? '處理中…' : '刪除'} variant="danger"
        onConfirm={() => { if (!deleteDocLoading) void handleDeleteDoc() }}
        onCancel={() => !deleteDocLoading && setDeleteDocTarget(null)} />
      <ConfirmModal open={showClearConfirm} title="確認清除" message="確定要清除此段對話嗎？" confirmText="確認清除"
        onConfirm={() => {
          setMessages([])
          setShowClearConfirm(false)
          if (selectedKbId != null) localStorage.removeItem(threadStorageKey(selectedKbId))
          createChatThread({ agent_id: agent.id, title: null })
            .then((t) => {
              setThreadId(t.id)
              if (selectedKbId != null) localStorage.setItem(threadStorageKey(selectedKbId), t.id)
            })
            .catch(() => {})
        }}
        onCancel={() => setShowClearConfirm(false)} />

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} url="/help-kb-manager.md" title="KB 管理 使用說明" />
      <AgentHeader agent={agent} headerBackgroundColor={HEADER_COLOR} onOnlineHelpClick={() => setHelpOpen(true)} />

      <div className="mt-4 flex min-h-0 flex-1 gap-3 overflow-hidden">

        {/* ══ 左欄：KB 列表 ═══════════════════════════════════════════════ */}
        <div className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md transition-[width] duration-200 ${sidebarCollapsed ? 'w-12' : 'w-80'}`}
          style={{ backgroundColor: HEADER_COLOR }}>
          <div className={`flex shrink-0 items-center justify-between border-b border-white/20 py-2.5 ${sidebarCollapsed ? 'px-2' : 'pl-4 pr-2'}`}>
            {sidebarCollapsed ? (
              <button type="button" onClick={() => setSidebarCollapsed(false)}
                className="flex w-full items-center justify-center rounded-2xl p-1.5 text-white/80 hover:bg-white/10" title="展開">
                <ChevronRight className="h-5 w-5" />
              </button>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <Headphones className="h-4 w-4 text-white/70" />
                  <span className="text-lg font-semibold text-white">知識庫</span>
                </div>
                <div className="flex items-center gap-0.5">
                  <button type="button" onClick={() => { openCreateKbModal(); setKbMenuId(null) }}
                    className="rounded-lg p-1.5 text-white/70 hover:bg-white/15 hover:text-white" title="新增知識庫">
                    <Plus className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => setSidebarCollapsed(true)}
                    className="rounded-lg px-1 py-1 text-white/60 hover:bg-white/10 hover:text-white" title="折疊">
                    {'<<'}
                  </button>
                </div>
              </>
            )}
          </div>

          {!sidebarCollapsed && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
                {kbsLoading ? (
                  <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-white/50" /></div>
                ) : (() => {
                  const myKbs = kbs.filter((kb) => kb.scope !== 'company' && kb.created_by === currentUser?.id)
                  const companyKbs = kbs.filter((kb) => kb.scope === 'company')
                  const othersKbs = isAdmin ? kbs.filter((kb) => kb.scope !== 'company' && kb.created_by !== currentUser?.id) : []

                  const renderKbItem = (kb: KmKnowledgeBase) => (
                    <li key={kb.id} className="relative" ref={kbMenuId === kb.id ? kbMenuRef : undefined}>
                      <button type="button" onClick={() => { setSelectedKbId(kb.id); setKbMenuId(null) }}
                        className={`group flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-lg transition-colors ${selectedKbId === kb.id ? 'bg-sky-500/30 text-white' : 'text-white/75 hover:bg-white/10 hover:text-white'}`}>
                        <span className="min-w-0 flex-1 overflow-hidden">
                          <span className="block truncate font-medium">{kb.name}</span>
                          {isAdmin && kbOwnerNames[kb.id] && (
                            <span className="block truncate text-xs text-white/40">{kbOwnerNames[kb.id]}</span>
                          )}
                        </span>
                        <span className={`shrink-0 text-lg ${selectedKbId === kb.id ? 'text-sky-200/80' : 'text-white/40'}`}>{kb.ready_count}/{kb.doc_count}</span>
                        {kb.scope === 'bot_only' && (
                          <span className="shrink-0 rounded-full bg-violet-500/30 px-1.5 py-0.5 text-xs font-medium text-violet-200" title="Bot 專用">
                            🤖
                          </span>
                        )}
                        {(kb.scope === 'company' || kb.scope === 'bot_only') && (
                          <span
                            className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium ${kb.bot_count > 0 ? 'bg-emerald-500/30 text-emerald-200' : 'bg-white/10 text-white/30'}`}
                            title={kb.bot_count > 0 ? `${kb.bot_count} 個 Bot 使用中` : '尚無 Bot 使用'}
                          >
                            {kb.bot_count}
                          </span>
                        )}
                        {canModifyKb(kb) && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); setKbMenuId(kbMenuId === kb.id ? null : kb.id) }}
                            className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/20">
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </button>
                      {kbMenuId === kb.id && (
                        <div className="absolute right-0 top-full z-20 mt-0.5 w-28 overflow-hidden rounded-lg border border-white/20 bg-[#1a3a52] shadow-xl">
                          <button type="button" onClick={() => { setSettingsKb(kb); setSettingsName(kb.name); setSettingsModel(kb.model_name ?? ''); setSettingsPrompt(kb.system_prompt ?? ''); setSettingsScope(kb.scope ?? 'personal'); setKbMenuId(null) }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-lg text-white/80 hover:bg-white/10 hover:text-white">
                            <Settings className="h-3 w-3" />設定
                          </button>
                          {isAdmin && (
                            <button type="button" onClick={() => { setTransferKbTarget(kb); setKbMenuId(null) }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-lg text-sky-300 hover:bg-sky-500/20">
                              <ArrowRight className="h-3 w-3" />轉移所有權
                            </button>
                          )}
                          <button type="button" onClick={() => { setDeleteKbTarget(kb); setKbMenuId(null) }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-lg text-red-300 hover:bg-red-500/20">
                            <Trash2 className="h-3 w-3" />刪除
                          </button>
                        </div>
                      )}
                    </li>
                  )

                  return (
                    <div className="space-y-1">
                      {/* ── 我的知識庫 ── */}
                      <div>
                        <button type="button"
                          onClick={() => { const next = !myKbOpen; setMyKbOpen(next); try { localStorage.setItem('kb-section-my', next ? 'open' : 'closed') } catch {} }}
                          className="flex w-full items-center gap-1.5 rounded-lg px-3 py-1.5 text-left text-lg font-semibold text-sky-200 hover:text-white" style={{ backgroundColor: 'rgba(56,139,192,0.25)' }}>
                          <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${myKbOpen ? 'rotate-90' : ''}`} />
                          <span className="flex-1">我的知識庫</span>
                          <span className="rounded-full bg-white/10 px-1.5 text-lg text-sky-200/70">{myKbs.length}</span>
                        </button>
                        {myKbOpen && (
                          myKbs.length === 0 ? (
                            <p className="px-7 pb-2 text-lg text-white/30">點擊上方 + 新增</p>
                          ) : (
                            <ul className="space-y-0.5 px-2">
                              {myKbs.map(renderKbItem)}
                            </ul>
                          )
                        )}
                      </div>

                      {/* ── 公司共用 ── */}
                      <div>
                        <div className="border-t border-white/20" />
                        <div className="mb-1 mt-0.5 border-t border-white/20" />
                      </div>
                      <div>
                        <button type="button"
                          onClick={() => { const next = !companyKbOpen; setCompanyKbOpen(next); try { localStorage.setItem('kb-section-company', next ? 'open' : 'closed') } catch {} }}
                          className="flex w-full items-center gap-1.5 rounded-lg px-3 py-1.5 text-left text-lg font-semibold text-emerald-200 hover:text-white" style={{ backgroundColor: 'rgba(16,120,80,0.30)' }}>
                          <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${companyKbOpen ? 'rotate-90' : ''}`} />
                          <span className="flex-1">公司共用</span>
                          <span className="rounded-full bg-white/10 px-1.5 text-lg text-emerald-200/70">{companyKbs.length}</span>
                        </button>
                        {companyKbOpen && (
                          companyKbs.length === 0 ? (
                            <p className="px-7 pb-2 text-lg text-white/30">尚無公司共用知識庫</p>
                          ) : (
                            <ul className="space-y-0.5 px-2">
                              {companyKbs.map(renderKbItem)}
                            </ul>
                          )
                        )}
                      </div>

                      {/* ── 其他人的知識庫（Admin 專用）── */}
                      {isAdmin && othersKbs.length > 0 && (
                        <div>
                          <div className="border-t border-white/20" />
                          <div className="mb-1 mt-0.5 border-t border-white/20" />
                          <button type="button"
                            onClick={() => { const next = !othersKbOpen; setOthersKbOpen(next); try { localStorage.setItem('kb-section-others', next ? 'open' : 'closed') } catch {} }}
                            className="flex w-full items-center gap-1.5 rounded-lg px-3 py-1.5 text-left text-lg font-semibold text-amber-200 hover:text-white" style={{ backgroundColor: 'rgba(120,80,10,0.30)' }}>
                            <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${othersKbOpen ? 'rotate-90' : ''}`} />
                            <span className="flex-1">其他人的知識庫</span>
                            <span className="rounded-full bg-white/10 px-1.5 text-lg text-amber-200/70">{othersKbs.length}</span>
                          </button>
                          {othersKbOpen && (
                            <ul className="space-y-0.5 px-2">
                              {othersKbs.map(renderKbItem)}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            </div>
          )}
        </div>

        {/* ══ 中欄：文件管理 / 查詢統計 ══════════════════════════════════════ */}
        <div className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-md transition-[width] duration-200 ${midExpanded ? 'w-[600px]' : 'w-80'}`}>
          {/* 標題列 */}
          <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3">
            <div className="min-w-0 flex-1">
              {selectedKb ? (
                <>
                  <h2 className="truncate text-base font-semibold text-gray-800">{selectedKb.name}</h2>
                  <p className="text-base text-gray-400">
                    {selectedKb.scope === 'company' && (
                      selectedKb.bot_count > 0
                        ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-base font-medium text-emerald-700">{selectedKb.bot_count} 個 Bot 使用中</span>
                        : <span className="rounded-full bg-gray-100 px-2 py-0.5 text-base font-medium text-gray-400">未被 Bot 使用</span>
                    )}
                  </p>
                </>
              ) : (
                <p className="text-base text-gray-400">請選擇知識庫</p>
              )}
            </div>
            {selectedKbId && centerTab === 'docs' && canUploadToSelectedKb && (
              <button type="button"
                onClick={() => loadKbChunks(selectedKbId, chunkSearchQuery, chunkSourceFilter ?? undefined)}
                className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <RefreshCw className={`h-3.5 w-3.5 ${kbChunksLoading ? 'animate-spin' : ''}`} />
              </button>
            )}
            {selectedKbId && centerTab === 'stats' && (
              <button type="button" onClick={() => loadStats(selectedKbId, statsDays, statsView, 0)}
                className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <RefreshCw className={`h-3.5 w-3.5 ${statsLoading ? 'animate-spin' : ''}`} />
              </button>
            )}
            <button
              type="button"
              title={midExpanded ? '縮小' : '放大'}
              onClick={() => setMidExpanded((v) => !v)}
              className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              {midExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          </div>

          {/* Tab bar（只在選了 KB 且有查詢功能時顯示） */}
          {selectedKbId && (
            <div className="flex shrink-0 border-b border-gray-100">
              {canUploadToSelectedKb && (
                <button
                  type="button"
                  onClick={() => setCenterTab('docs')}
                  className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-base font-medium transition-colors ${
                    centerTab === 'docs'
                      ? 'border-b-2 border-sky-500 text-sky-600'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  <FileText className="h-3.5 w-3.5" />知識條目
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setCenterTab('stats')
                  if (!statsData) loadStats(selectedKbId, statsDays, statsView, 0)
                }}
                className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-base font-medium transition-colors ${
                  centerTab === 'stats'
                    ? 'border-b-2 border-sky-500 text-sky-600'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <BarChart2 className="h-3.5 w-3.5" />查詢統計
              </button>
              {canUploadToSelectedKb && (
                <button
                  type="button"
                  onClick={() => {
                    setCenterTab('sources')
                    if (selectedKbId) loadConnectors(selectedKbId)
                  }}
                  className={`relative flex flex-1 items-center justify-center gap-1.5 py-2 text-base font-medium transition-colors ${
                    centerTab === 'sources'
                      ? 'border-b-2 border-sky-500 text-sky-600'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  <Plug className="h-3.5 w-3.5" />整合
                  {connectors.length > 0 && (
                    <span className="absolute right-2 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-sky-500 text-[10px] font-bold text-white">
                      {connectors.length}
                    </span>
                  )}
                </button>
              )}
            </div>
          )}

          {/* ── 知識條目內容 ── */}
          {centerTab === 'docs' && (
            <>
              {/* Bot 引用警示 */}
              {selectedKb && selectedKb.referenced_bots.length > 0 && (
                <div className="shrink-0 flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5">
                  <span className="mt-0.5 shrink-0 text-amber-500">⚠️</span>
                  <p className="text-base text-amber-700">
                    此知識庫已被以下 Bot 引用：
                    <span className="font-medium">
                      {selectedKb.referenced_bots.map((b) => b.name).join('、')}
                    </span>
                    ，修改將立即影響線上服務。
                  </p>
                </div>
              )}

              {/* 搜尋列 + 工具列 */}
              {selectedKbId && (
                <div className="shrink-0 border-b border-gray-100 px-3 py-2 space-y-2">
                  <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5">
                    <ArrowRight className="h-3.5 w-3.5 rotate-90 text-gray-300" />
                    <input
                      type="text"
                      value={chunkSearchQuery}
                      onChange={(e) => {
                        setChunkSearchQuery(e.target.value)
                        if (selectedKbId) loadKbChunks(selectedKbId, e.target.value, chunkSourceFilter ?? undefined)
                      }}
                      placeholder="搜尋知識條目內容…"
                      className="flex-1 bg-transparent text-base text-gray-700 placeholder-gray-300 focus:outline-none"
                    />
                    {chunkSearchQuery && (
                      <button type="button" onClick={() => {
                        setChunkSearchQuery('')
                        if (selectedKbId) loadKbChunks(selectedKbId, '', chunkSourceFilter ?? undefined)
                      }} className="text-gray-300 hover:text-gray-500">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {/* 按鈕列：新增條目 / 匯入文件 */}
                  {canUploadToSelectedKb && (
                    <div className="flex items-center gap-2">
                      <button type="button"
                        onClick={() => {
                          const readyDocs = docs.filter((d) => d.status === 'ready')
                          setAddEntryDocId(readyDocs.length > 0 ? readyDocs[0].id : null)
                          setAddEntryContent('')
                          setAddEntryOpen(true)
                        }}
                        className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-base text-gray-600 hover:border-sky-300 hover:text-sky-600">
                        <Plus className="h-3.5 w-3.5" />新增條目
                      </button>
                      <button type="button" onClick={() => setUploadModalOpen(true)}
                        className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-base text-gray-600 hover:border-sky-300 hover:text-sky-600">
                        <Upload className="h-3.5 w-3.5" />匯入文件
                      </button>
                    </div>
                  )}
                  {/* 篩選列：來源過濾 */}
                  <select
                    value={chunkSourceFilter ?? ''}
                    onChange={(e) => {
                      const val = e.target.value ? Number(e.target.value) : null
                      setChunkSourceFilter(val)
                      if (selectedKbId) loadKbChunks(selectedKbId, chunkSearchQuery, val ?? undefined)
                    }}
                    className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-base text-gray-600 focus:outline-none">
                    <option value="">所有來源</option>
                    {docs.filter((d) => (d.chunk_count ?? 0) > 0).map((d) => (
                      <option key={d.id} value={d.id}>{d.filename}</option>
                    ))}
                  </select>
                  {/* 批次工具列 */}
                  {canUploadToSelectedKb && kbChunks.length > 0 && (
                    <div className="flex items-center gap-2">
                      <button type="button"
                        onClick={() => {
                          if (selectedChunkIds.size === kbChunks.length) {
                            setSelectedChunkIds(new Set())
                          } else {
                            setSelectedChunkIds(new Set(kbChunks.map((c) => c.id)))
                          }
                        }}
                        className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-base text-gray-500 hover:border-sky-300 hover:text-sky-600">
                        <input
                          type="checkbox"
                          readOnly
                          checked={selectedChunkIds.size === kbChunks.length}
                          ref={(el) => { if (el) el.indeterminate = selectedChunkIds.size > 0 && selectedChunkIds.size < kbChunks.length }}
                          className="h-3.5 w-3.5 accent-sky-500 pointer-events-none"
                        />
                        {selectedChunkIds.size === kbChunks.length ? '全不選' : '全選'}
                      </button>
                      {selectedChunkIds.size > 0 && (
                        <>
                          <span className="text-base text-gray-500">已選 {selectedChunkIds.size} 筆</span>
                          <button type="button"
                            onClick={() => setConfirmBatchDeleteOpen(true)}
                            disabled={batchDeleting}
                            className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1 text-base font-medium text-white hover:bg-red-700 disabled:opacity-50">
                            {batchDeleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            {batchDeleting ? '刪除中…' : '批次刪除'}
                          </button>
                          <button type="button" onClick={() => setSelectedChunkIds(new Set())}
                            className="text-base text-gray-400 hover:text-gray-600">取消</button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto">
                {!selectedKbId ? (
                  <div className="flex h-full items-center justify-center">
                    <p className="text-base text-gray-300">← 選擇知識庫</p>
                  </div>
                ) : kbChunksLoading ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
                  </div>
                ) : kbChunks.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
                    <FileText className="h-8 w-8 text-gray-200" />
                    <p className="text-base text-gray-400">
                      {chunkSearchQuery ? '找不到相符的條目' : '尚無知識條目'}
                    </p>
                    {!chunkSearchQuery && canUploadToSelectedKb && (
                      <p className="text-base text-gray-300">點擊「匯入文件」開始建立知識庫</p>
                    )}
                  </div>
                ) : (
                  <ul className="divide-y divide-gray-50">
                    {kbChunks.map((chunk) => (
                      <li key={chunk.id} className="group flex items-start gap-3 px-4 py-3 hover:bg-gray-50">
                        {canUploadToSelectedKb && (
                          <input type="checkbox"
                            checked={selectedChunkIds.has(chunk.id)}
                            onChange={(e) => setSelectedChunkIds((prev) => {
                              const next = new Set(prev)
                              if (e.target.checked) next.add(chunk.id); else next.delete(chunk.id)
                              return next
                            })}
                            className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer accent-sky-500"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-3 whitespace-pre-wrap break-words text-base text-gray-700 leading-relaxed">
                            {chunk.content}
                          </p>
                          {chunk.doc_filename && (
                            <p className="mt-1 text-xs text-gray-400">來源：{chunk.doc_filename}</p>
                          )}
                        </div>
                        {canUploadToSelectedKb && (
                          <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button type="button"
                              onClick={() => { setEditingChunk(chunk); setEditModalContent(chunk.content) }}
                              title="編輯"
                              className="rounded p-1.5 text-gray-400 hover:bg-sky-50 hover:text-sky-500">
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button type="button"
                              onClick={() => void handleDeleteSingleChunk(chunk.id)}
                              title="刪除"
                              className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-400">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          {/* ── 查詢統計內容 ── */}
          {centerTab === 'stats' && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {/* 篩選列 */}
              <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 bg-gray-100 px-4 py-2">
                <span className="text-base text-gray-400">近</span>
                {([7, 30, 90] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      setStatsDays(d)
                      if (selectedKbId) loadStats(selectedKbId, d, statsView, 0)
                    }}
                    className={`rounded-full px-2.5 py-0.5 text-base font-medium transition-colors ${
                      statsDays === d
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {d}天
                  </button>
                ))}
              </div>

              {/* 摘要卡片 */}
              {statsData && (
                <div className="grid shrink-0 grid-cols-3 divide-x divide-gray-100 border-b border-gray-100">
                  <div className="flex flex-col items-center bg-slate-50 py-3">
                    <span className="text-lg font-bold text-slate-700">{statsData.summary.total_queries}</span>
                    <span className="text-base text-slate-500">總查詢</span>
                  </div>
                  <div className="flex flex-col items-center bg-emerald-50 py-3">
                    <span className="text-lg font-bold text-emerald-600">
                      {statsData.summary.total_queries > 0
                        ? `${Math.round(statsData.summary.hit_rate * 100)}%`
                        : '—'}
                    </span>
                    <span className="text-base text-emerald-600">命中率</span>
                  </div>
                  <div className={`flex flex-col items-center py-3 ${statsData.summary.zero_hit_count > 0 ? 'bg-amber-50' : 'bg-gray-50'}`}>
                    <span className={`text-lg font-bold ${statsData.summary.zero_hit_count > 0 ? 'text-amber-600' : 'text-gray-500'}`}>
                      {statsData.summary.zero_hit_count}
                    </span>
                    <span className={`text-base ${statsData.summary.zero_hit_count > 0 ? 'text-amber-600' : 'text-gray-500'}`}>零命中</span>
                  </div>
                </div>
              )}

              {/* Sub-tab */}
              <div className="flex shrink-0 border-b border-gray-100">
                {(['top_queries', 'zero_hit'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      setStatsView(v)
                      if (selectedKbId) loadStats(selectedKbId, statsDays, v, 0)
                    }}
                    className={`flex-1 py-2 text-base font-medium transition-colors ${
                      statsView === v
                        ? 'border-b-2 border-sky-500 text-sky-600'
                        : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    {v === 'top_queries' ? '最多人問' : '零命中'}
                  </button>
                ))}
              </div>

              {/* 清單 */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {statsLoading && !statsData ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
                  </div>
                ) : !statsData || statsData.queries.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
                    <BarChart2 className="h-8 w-8 text-gray-200" />
                    <p className="text-base text-gray-400">
                      {statsView === 'zero_hit' ? '近期無零命中查詢' : '尚無查詢記錄'}
                    </p>
                  </div>
                ) : (
                  <>
                    <ol className="divide-y divide-gray-50">
                      {statsData.queries.map((item, idx) => (
                        <li key={idx} className="flex items-start gap-3 px-4 py-2.5">
                          <span className="mt-0.5 w-5 shrink-0 text-center text-base font-medium text-gray-300">
                            {statsOffset + idx + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 break-all text-base text-gray-700">{item.query}</p>
                          </div>
                          <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-base font-medium ${
                            item.hit ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                          }`}>
                            {item.count} 次
                          </span>
                        </li>
                      ))}
                    </ol>
                    {statsData.has_more && (
                      <div className="flex justify-center py-3">
                        <button
                          type="button"
                          disabled={statsLoading}
                          onClick={() => {
                            if (selectedKbId) {
                              const nextOffset = statsOffset + STATS_LIMIT
                              loadStats(selectedKbId, statsDays, statsView, nextOffset)
                            }
                          }}
                          className="text-base text-sky-500 hover:underline disabled:opacity-40"
                        >
                          {statsLoading ? '載入中…' : '載入更多'}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── 資料來源內容 ── */}
          {centerTab === 'sources' && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {/* 工具列 */}
              <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-2">
                <span className="text-base text-gray-500">
                  {connectors.length > 0 ? `${connectors.length} 個連接器` : '自動從外部來源同步資料'}
                </span>
                {selectedKbId && canUploadToSelectedKb && (
                  <button
                    type="button"
                    onClick={openConnectorModal}
                    className="flex items-center gap-1 rounded-lg bg-sky-500 px-2.5 py-1 text-base font-medium text-white hover:bg-sky-600"
                  >
                    <Plus className="h-3.5 w-3.5" />新增來源
                  </button>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {!selectedKbId ? (
                  <div className="flex h-full items-center justify-center">
                    <p className="text-base text-gray-300">← 選擇知識庫</p>
                  </div>
                ) : connectorsLoading ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
                  </div>
                ) : connectors.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                    <Plug className="h-10 w-10 text-gray-200" />
                    <p className="text-sm font-medium text-gray-400">尚未設定任何整合</p>
                    <p className="text-base text-gray-300">連接 Slack、Notion 等外部平台，自動同步內容到知識庫</p>
                    {canUploadToSelectedKb && (
                      <button
                        type="button"
                        onClick={openConnectorModal}
                        className="mt-1 flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-base font-medium text-sky-600 hover:bg-sky-100"
                      >
                        <Plus className="h-3.5 w-3.5" />新增連接器
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="p-3 flex flex-col gap-3">
                    {connectors.map((c) => {
                      const isSyncing = syncingConnectorId === c.id
                      const channelIds: string[] = (c.config?.channel_ids as string[]) ?? []
                      const syncIntervalLabel =
                        c.sync_interval_minutes === 0 ? '僅手動同步'
                        : c.sync_interval_minutes < 60 ? `每 ${c.sync_interval_minutes} 分鐘`
                        : c.sync_interval_minutes < 1440 ? `每 ${c.sync_interval_minutes / 60} 小時`
                        : `每天`
                      return (
                        <div key={c.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                          {/* ── 卡片頂部：來源色條 ── */}
                          <div className="h-1 w-full bg-[#4A154B]" />

                          {/* ── 卡片主體 ── */}
                          <div className="p-4">
                            {/* 標題列 */}
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#4A154B] text-white shadow-sm">
                                  <span className="text-sm font-bold">#</span>
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-gray-800">{c.display_name}</p>
                                  <p className="text-base text-gray-400">Slack · {channelIds.length} 個頻道</p>
                                </div>
                              </div>
                              {/* 狀態 badge */}
                              {isSyncing ? (
                                <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-base font-medium text-amber-700">
                                  <Loader2 className="h-3 w-3 animate-spin" />同步中
                                </span>
                              ) : c.status === 'active' ? (
                                <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-base font-medium text-emerald-700">
                                  <Wifi className="h-3 w-3" />已啟用
                                </span>
                              ) : c.status === 'paused' ? (
                                <span className="flex shrink-0 items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-base font-medium text-gray-500">
                                  <WifiOff className="h-3 w-3" />已暫停
                                </span>
                              ) : (
                                <span className="flex shrink-0 items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-base font-medium text-red-600">
                                  <WifiOff className="h-3 w-3" />錯誤
                                </span>
                              )}
                            </div>

                            {/* 詳情 */}
                            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-base text-gray-400">
                              <span>{syncIntervalLabel}</span>
                              {c.last_synced_at ? (
                                <span>上次同步：{new Date(c.last_synced_at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                              ) : (
                                <span className="text-amber-500">尚未同步</span>
                              )}
                            </div>

                            {c.status === 'error' && c.last_error && (
                              <p className="mt-2 rounded-lg bg-red-50 px-3 py-1.5 text-base text-red-500 break-all">{c.last_error}</p>
                            )}
                          </div>

                          {/* ── 卡片底部：操作按鈕 ── */}
                          {canUploadToSelectedKb && (
                            <div className="flex items-center gap-2 border-t border-gray-100 bg-gray-50/60 px-4 py-2.5">
                              <button
                                type="button"
                                onClick={() => handleTriggerSync(c.id)}
                                disabled={isSyncing}
                                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-base text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                              >
                                <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                                {isSyncing ? '同步中…' : '立即同步'}
                              </button>
                              <button
                                type="button"
                                disabled={isSyncing}
                                onClick={async () => {
                                  await updateConnector(c.id, { force_full_sync: true })
                                  handleTriggerSync(c.id)
                                }}
                                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-base text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />重新同步
                              </button>
                              <button
                                type="button"
                                onClick={() => handleTogglePause(c)}
                                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-base text-gray-600 hover:bg-gray-50"
                              >
                                {c.status === 'paused' ? '啟用' : '暫停'}
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditConnectorModal(c)}
                                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-base text-gray-600 hover:bg-gray-50"
                              >
                                <Pencil className="h-3.5 w-3.5" />編輯
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteConnectorTarget(c)}
                                className="ml-auto flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-base text-red-500 hover:bg-red-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />刪除
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ══ 右欄：測試查詢 Chat ═══════════════════════════════════════════ */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50">
          <div className="flex shrink-0 items-center gap-1 border-b border-gray-100 bg-gray-50/70 px-4 py-2">
            {selectedKb && (
              <>
                {selectedKb.model_name ? (
                  <><span className="flex shrink-0 items-center gap-1"><span className="text-base text-gray-500">使用模型：</span><span className="rounded-full bg-sky-100 px-2 py-0.5 text-base text-sky-700">{stripModelPrefix(selectedKb.model_name)}</span></span></>
                ) : (
                  <><span className="shrink-0 text-base text-gray-400">系統預設模型</span></>
                )}
              </>
            )}
            <button type="button" onClick={() => messages.length > 0 && setShowClearConfirm(true)}
              disabled={isLoading || messages.length === 0}
              className="ml-auto rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              <RefreshCw className="h-5 w-5" />
            </button>
          </div>
          <AgentChat
            messages={messages}
            onSubmit={handleSendMessage}
            isLoading={isLoading}
            headerTitle=""
            emptyPlaceholder={
              !selectedKb ? '請在左側選擇知識庫後開始提問。'
              : readyCount === 0 ? `「${selectedKb.name}」尚無可用文件，請先在中間欄上傳並等待處理完成。`
              : `知識庫：${selectedKb.name}（${readyCount} 份可用）\n輸入問題，AI 將從知識庫中搜尋相關資料回答。`
            }
            onCopySuccess={() => showToast('已複製到剪貼簿')}
            onCopyError={() => showToast('複製失敗', 'error')}
            showChart={false}
            showPdf={false}
          />
        </div>

      </div>

      {/* ══ 新增 Connector Modal ══════════════════════════════════════════ */}
      {connectorModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-800">
                  {editingConnector ? '編輯連接器' : '新增整合'}
                </h3>
                <p className="text-base text-gray-400">
                  {connectorModalStep === 'token' ? '步驟 1／2：驗證 Slack Token'
                    : connectorModalStep === 'channels' ? `步驟 2／2：選擇頻道（${connectorWorkspace}）`
                    : `編輯設定：${editingConnector?.display_name}`}
                </p>
              </div>
              <button type="button" onClick={() => setConnectorModalOpen(false)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
              {connectorModalStep === 'token' ? (
                <>
                  {/* ── 步驟 1：Token 輸入 ── */}
                  {/* 來源選擇（目前只有 Slack） */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-600">來源類型</label>
                    <div className="flex gap-2">
                      <div className="flex flex-1 items-center gap-2 rounded-xl border-2 border-sky-400 bg-sky-50 px-3 py-2.5">
                        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#4A154B]">
                          <span className="text-xs font-bold text-white">#</span>
                        </div>
                        <span className="text-sm font-medium text-gray-700">Slack</span>
                        <Check className="ml-auto h-3.5 w-3.5 text-sky-500" />
                      </div>
                      <div className="flex flex-1 cursor-not-allowed items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 opacity-40">
                        <span className="text-sm text-gray-400">Notion（即將推出）</span>
                      </div>
                    </div>
                  </div>

                  {/* Token 輸入 */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-600">
                      Slack User Token
                      <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer" className="ml-1.5 text-sky-500 hover:underline">
                        如何取得？↗
                      </a>
                    </label>
                    <input
                      type="password"
                      value={connectorToken}
                      onChange={(e) => { setConnectorToken(e.target.value); setConnectorError('') }}
                      onKeyDown={(e) => e.key === 'Enter' && handleValidateToken()}
                      placeholder="xoxp-..."
                      className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-mono placeholder-gray-300 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-200"
                    />
                    <p className="mt-1 text-base text-gray-400">需要 channels:history、channels:read、users:read、files:read 權限</p>
                  </div>

                  {connectorError && (
                    <p className="rounded-lg bg-red-50 px-3 py-2 text-base text-red-500">{connectorError}</p>
                  )}
                </>
              ) : connectorModalStep === 'channels' ? (
                <>
                  {/* ── 步驟 2：頻道選擇（新建流程） ── */}
                  {/* 連接器名稱 */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-600">連接器名稱</label>
                    <input
                      type="text"
                      value={connectorName}
                      onChange={(e) => setConnectorName(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-200"
                    />
                  </div>

                  {/* 頻道選擇 */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-600">
                      選擇頻道
                      <span className="ml-1.5 text-gray-400">（已選 {selectedChannelIds.length} 個）</span>
                    </label>
                    <div className="max-h-52 overflow-y-auto rounded-xl border border-gray-200">
                      {availableChannels.length === 0 ? (
                        <p className="px-3 py-4 text-center text-base text-gray-400">找不到可用頻道</p>
                      ) : (
                        availableChannels.map((ch) => (
                          <label key={ch.id} className="flex cursor-pointer items-center gap-3 border-b border-gray-50 px-3 py-2 hover:bg-gray-50 last:border-0">
                            <input
                              type="checkbox"
                              checked={selectedChannelIds.includes(ch.id)}
                              onChange={(e) => {
                                setSelectedChannelIds((prev) =>
                                  e.target.checked ? [...prev, ch.id] : prev.filter((id) => id !== ch.id)
                                )
                              }}
                              className="h-4 w-4 rounded border-gray-300 text-sky-500 focus:ring-sky-300"
                            />
                            <span className="flex-1 text-sm text-gray-700">
                              {ch.is_private ? '🔒' : '#'} {ch.name}
                            </span>
                            {ch.member_count != null && (
                              <span className="text-base text-gray-300">{ch.member_count} 人</span>
                            )}
                          </label>
                        ))
                      )}
                    </div>
                  </div>

                  {/* 設定列 */}
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="mb-1.5 block text-xs font-medium text-gray-600">同步頻率</label>
                      <select
                        value={connectorInterval}
                        onChange={(e) => setConnectorInterval(Number(e.target.value))}
                        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none"
                      >
                        <option value={30}>每 30 分鐘</option>
                        <option value={60}>每 1 小時</option>
                        <option value={360}>每 6 小時</option>
                        <option value={720}>每 12 小時</option>
                        <option value={1440}>每天</option>
                        <option value={0}>只手動同步</option>
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="mb-1.5 block text-xs font-medium text-gray-600">首次同步範圍</label>
                      <select
                        value={connectorDaysLookback}
                        onChange={(e) => setConnectorDaysLookback(Number(e.target.value))}
                        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none"
                      >
                        <option value={7}>最近 7 天</option>
                        <option value={30}>最近 30 天</option>
                        <option value={90}>最近 90 天</option>
                        <option value={180}>最近 180 天</option>
                      </select>
                    </div>
                  </div>

                  {connectorError && (
                    <p className="rounded-lg bg-red-50 px-3 py-2 text-base text-red-500">{connectorError}</p>
                  )}
                </>
              ) : (
                <>
                  {/* ── 編輯模式 ── */}
                  {/* 連接器名稱 */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-600">連接器名稱</label>
                    <input
                      type="text"
                      value={connectorName}
                      onChange={(e) => setConnectorName(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-200"
                    />
                  </div>

                  {/* 目前已選頻道（顯示 ID） */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-600">
                      已選頻道
                      <span className="ml-1.5 text-gray-400">（已選 {selectedChannelIds.length} 個）</span>
                    </label>
                    {availableChannels.length > 0 ? (
                      <div className="max-h-52 overflow-y-auto rounded-xl border border-gray-200">
                        {availableChannels.map((ch) => (
                          <label key={ch.id} className="flex cursor-pointer items-center gap-3 border-b border-gray-50 px-3 py-2 hover:bg-gray-50 last:border-0">
                            <input
                              type="checkbox"
                              checked={selectedChannelIds.includes(ch.id)}
                              onChange={(e) => {
                                setSelectedChannelIds((prev) =>
                                  e.target.checked ? [...prev, ch.id] : prev.filter((id) => id !== ch.id)
                                )
                              }}
                              className="h-4 w-4 rounded border-gray-300 text-sky-500 focus:ring-sky-300"
                            />
                            <span className="flex-1 text-sm text-gray-700">
                              {ch.is_private ? '🔒' : '#'} {ch.name}
                            </span>
                            {ch.member_count != null && (
                              <span className="text-base text-gray-300">{ch.member_count} 人</span>
                            )}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {selectedChannelIds.length > 0 ? (() => {
                            const storedNames = (editingConnector?.config?.channel_names as Record<string, string>) ?? {}
                            return selectedChannelIds.map((id) => {
                              const name = storedNames[id] ?? id
                              return (
                                <span key={id} className="flex items-center gap-1 rounded-lg bg-sky-50 px-2 py-0.5 text-xs text-sky-700">
                                  # {name}
                                  <button
                                    type="button"
                                    onClick={() => setSelectedChannelIds((prev) => prev.filter((c) => c !== id))}
                                    className="ml-0.5 text-sky-400 hover:text-red-500"
                                  >
                                    ×
                                  </button>
                                </span>
                              )
                            })
                          })() : (
                            <p className="text-base text-gray-400">尚未選擇頻道</p>
                          )}
                        </div>
                        <p className="text-base text-gray-400">
                          若要新增頻道，請輸入 Token 重新載入頻道清單↓
                        </p>
                      </div>
                    )}
                  </div>

                  {/* 重新驗證 Token（可選，可新增頻道） */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-600">
                      重新載入頻道清單
                      <span className="ml-1.5 font-normal text-gray-400">（選填，輸入 Token 後點擊驗證可重新選擇頻道）</span>
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={connectorToken}
                        onChange={(e) => { setConnectorToken(e.target.value); setConnectorError('') }}
                        onKeyDown={(e) => e.key === 'Enter' && connectorToken.trim() && handleValidateTokenForEdit()}
                        placeholder="xoxp-... （不填則保留原 Token）"
                        className="flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-mono placeholder-gray-300 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-200"
                      />
                      <button
                        type="button"
                        onClick={handleValidateTokenForEdit}
                        disabled={!connectorToken.trim() || connectorValidating}
                        className="flex items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-600 hover:bg-sky-100 disabled:opacity-50"
                      >
                        {connectorValidating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}
                        {connectorValidating ? '載入中…' : '載入頻道'}
                      </button>
                    </div>
                  </div>

                  {/* 設定列 */}
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="mb-1.5 block text-xs font-medium text-gray-600">同步頻率</label>
                      <select
                        value={connectorInterval}
                        onChange={(e) => setConnectorInterval(Number(e.target.value))}
                        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none"
                      >
                        <option value={30}>每 30 分鐘</option>
                        <option value={60}>每 1 小時</option>
                        <option value={360}>每 6 小時</option>
                        <option value={720}>每 12 小時</option>
                        <option value={1440}>每天</option>
                        <option value={0}>只手動同步</option>
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="mb-1.5 block text-xs font-medium text-gray-600">同步範圍</label>
                      <select
                        value={connectorDaysLookback}
                        onChange={(e) => setConnectorDaysLookback(Number(e.target.value))}
                        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none"
                      >
                        <option value={7}>最近 7 天</option>
                        <option value={30}>最近 30 天</option>
                        <option value={90}>最近 90 天</option>
                        <option value={180}>最近 180 天</option>
                      </select>
                    </div>
                  </div>

                  {connectorError && (
                    <p className="rounded-lg bg-red-50 px-3 py-2 text-base text-red-500">{connectorError}</p>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
              {connectorModalStep === 'channels' && (
                <button
                  type="button"
                  onClick={() => { setConnectorModalStep('token'); setConnectorError('') }}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  上一步
                </button>
              )}
              <button
                type="button"
                onClick={() => setConnectorModalOpen(false)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                取消
              </button>
              {connectorModalStep === 'token' && (
                <button
                  type="button"
                  onClick={handleValidateToken}
                  disabled={!connectorToken.trim() || connectorValidating}
                  className="flex items-center gap-1.5 rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50"
                >
                  {connectorValidating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}
                  {connectorValidating ? '驗證中…' : '驗證並載入頻道'}
                </button>
              )}
              {connectorModalStep === 'channels' && (
                <button
                  type="button"
                  onClick={handleCreateConnector}
                  disabled={selectedChannelIds.length === 0 || connectorSaving}
                  className="flex items-center gap-1.5 rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50"
                >
                  {connectorSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  {connectorSaving ? '建立中…' : '建立並立即同步'}
                </button>
              )}
              {connectorModalStep === 'edit' && (
                <button
                  type="button"
                  onClick={handleSaveEditConnector}
                  disabled={selectedChannelIds.length === 0 || connectorSaving}
                  className="flex items-center gap-1.5 rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50"
                >
                  {connectorSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {connectorSaving ? '儲存中…' : '儲存變更'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ 刪除 Connector 確認 ══════════════════════════════════════════ */}
      <ConfirmModal
        open={deleteConnectorTarget != null}
        title="刪除連接器"
        message={`確定要刪除「${deleteConnectorTarget?.display_name ?? ''}」？\n連接器刪除後不會自動移除已同步的文件。`}
        confirmText="刪除"
        variant="danger"
        onConfirm={handleDeleteConnector}
        onCancel={() => setDeleteConnectorTarget(null)}
      />

      {/* ══ 批次刪除確認 ════════════════════════════════════════════════ */}
      <ConfirmModal
        open={confirmBatchDeleteOpen}
        title="批次刪除知識條目"
        message={`確定要刪除已選取的 ${selectedChunkIds.size} 筆條目？\n刪除後無法復原。`}
        confirmText="確認刪除"
        variant="danger"
        onConfirm={() => { setConfirmBatchDeleteOpen(false); void handleBatchDelete() }}
        onCancel={() => setConfirmBatchDeleteOpen(false)}
      />

    </div>
  )
}
