/** Admin：租戶 LLM 設定（admin / super_admin） */
import { useCallback, useEffect, useState } from 'react'
import { Mic } from 'lucide-react'
import {
  HelpCircle,
  KeyRound,
  Archive,
  Pencil,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Zap,
  Lock,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Loader2,
} from 'lucide-react'
import HelpModal from '@/components/HelpModal'
import { TOKEN_KEY } from '@/contexts/AuthContext'
import {
  createLLMConfig,
  deleteLLMConfig,
  getLLMProviderOptions,
  getTenantConfig,
  listLLMConfigs,
  migrateEmbedding,
  testEmbeddingCandidate,
  testLLMConfig,
  updateAnalysisModel,
  updateDefaultLLM,
  updateLLMConfig,
  updateSpeechConfig,
  testSpeechCandidate,
} from '@/api/llmConfigs'
import type {
  EmbeddingTestCandidateResult,
  LLMProviderConfigCreate,
  LLMProviderConfigUpdate,
  LLMTestResult,
  SpeechTestResult,
  TenantConfig,
} from '@/api/llmConfigs'
import type { LLMModelEntry } from '@/types'
import { getMe } from '@/api/users'
import { ApiError } from '@/api/client'
import { useToast } from '@/contexts/ToastContext'
import type { LLMProviderConfig } from '@/types'
import ConfirmModal from '@/components/ConfirmModal'

// ── Constants ─────────────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  gemini: 'Google AI Studio',
  custom: '自訂（OpenAI 相容）',
  vertex: 'Google Vertex AI',
  twcc: '台智雲 TWCC',
  local: '本機模型 (Local)',
  anthropic: 'Anthropic',
}

const PROVIDER_COLORS: Record<string, string> = {
  openai: 'bg-green-200 text-green-900',
  gemini: 'bg-blue-200 text-blue-900',
  custom: 'bg-gray-200 text-gray-900',
  vertex: 'bg-cyan-200 text-cyan-900',
  twcc: 'bg-orange-200 text-orange-900',
  local: 'bg-purple-200 text-purple-900',
  anthropic: 'bg-amber-200 text-amber-900',
}

const PROVIDER_CARD_COLORS: Record<string, string> = {
  openai: 'border-green-100 bg-green-50/50',
  gemini: 'border-blue-100 bg-blue-50/50',
  custom: 'border-gray-100 bg-gray-50/50',
  vertex: 'border-cyan-100 bg-cyan-50/50',
  twcc:   'border-orange-100 bg-orange-50/50',
  local:  'border-purple-100 bg-purple-50/50',
  anthropic: 'border-amber-100 bg-amber-50/50',
}

// 系統固定 1024 維，以下為各 provider 的預設建議模型（可自訂輸入）
const EMBEDDING_MODEL_DEFAULTS: Record<string, string> = {
  openai: 'text-embedding-3-small',
  gemini: 'text-embedding-004',
  vertex: 'text-embedding-004',
  local:  'bge-m3-4096',
}

// 語音服務預設 model
const SPEECH_MODEL_DEFAULTS: Record<string, string> = {
  local:  'Systran/faster-whisper-medium',
  openai: 'whisper-1',
  custom: '',
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface FormState {
  provider: string
  label: string
  api_key: string
  api_key_masked: string
  api_base_url: string
  gcp_project_id: string
  gcp_region: string
  available_models_entries: LLMModelEntry[]
  is_active: boolean
}

const EMPTY_FORM: FormState = {
  provider: 'openai',
  label: '',
  api_key: '',
  api_key_masked: '',
  api_base_url: '',
  gcp_project_id: '',
  gcp_region: '',
  available_models_entries: [],
  is_active: true,
}

// model → test key：`{configId}:{model}`
type TestKey = string
function testKey(configId: number, model: string): TestKey {
  return `${configId}:${model}`
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AdminLLMSettings() {
  const { showToast } = useToast()

  // data
  const [tenantConfig, setTenantConfig] = useState<TenantConfig | null>(null)
  const [configs, setConfigs] = useState<LLMProviderConfig[]>([])
  const [providerOptions, setProviderOptions] = useState<Record<string, string[]>>({})
  // loading / error
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // provider CRUD form
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)

  // expand / collapse provider cards
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set())
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null)

  // per-model test results  key = `{configId}:{model}`
  const [testingKey, setTestingKey] = useState<TestKey | null>(null)
  const [testResultModal, setTestResultModal] = useState<{ model: string; result: LLMTestResult } | null>(null)

  // reference models popup
  const [showRefModal, setShowRefModal] = useState(false)

  // default LLM edit
  const [showDefaultLLMForm, setShowDefaultLLMForm] = useState(false)
  const [defaultLLMForm, setDefaultLLMForm] = useState({ provider: '', model: '' })
  const [savingDefaultLLM, setSavingDefaultLLM] = useState(false)

  // embedding config
  const [showEmbeddingForm, setShowEmbeddingForm] = useState(false)
  // 遷移流程 modal（全程不自動關閉，僅用戶按「關閉」才關）
  const [showEmbeddingMigrateModal, setShowEmbeddingMigrateModal] = useState(false)
  const [embeddingMigrateStep, setEmbeddingMigrateStep] = useState<'confirm' | 'saving' | 'reindexing' | 'done' | 'error'>('confirm')
  const [migrateLogs, setMigrateLogs] = useState<string[]>([])
  // embeddingMode: 'local' = 本機模型；'custom' = 自訂（openai / gemini / ...）
  const [embeddingMode, setEmbeddingMode] = useState<'local' | 'custom'>('local')
  const [embeddingForm, setEmbeddingForm] = useState({ provider: 'local', model: '' })
  const [savingEmbedding, setSavingEmbedding] = useState(false)

  // embedding candidate test (in modal - before saving)
  const [testingEmbeddingCandidate, setTestingEmbeddingCandidate] = useState(false)
  const [embeddingCandidateResult, setEmbeddingCandidateResult] = useState<EmbeddingTestCandidateResult | null>(null)

  // speech config
  const [showSpeechForm, setShowSpeechForm] = useState(false)
  const [speechMode, setSpeechMode] = useState<'local' | 'custom'>('local')
  const [speechForm, setSpeechForm] = useState({ provider: 'local', base_url: '', api_key: '', model: '' })
  const [savingSpeech, setSavingSpeech] = useState(false)
  const [_showSpeechApiKey, setShowSpeechApiKey] = useState(false)
  // candidate test in modal (only for local)
  const [testingSpeechCandidate, setTestingSpeechCandidate] = useState(false)
  const [speechCandidateResult, setSpeechCandidateResult] = useState<SpeechTestResult | null>(null)
  const [showDisableSpeechConfirm, setShowDisableSpeechConfirm] = useState(false)
  const [disablingSpeech, setDisablingSpeech] = useState(false)

  // analysis model edit
  const [showAnalysisModelForm, setShowAnalysisModelForm] = useState(false)
  const [analysisModelForm, setAnalysisModelForm] = useState({ provider: 'openai', model: '' })
  const [savingAnalysisModel, setSavingAnalysisModel] = useState(false)

  // help modal
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [showBackupHelpModal, setShowBackupHelpModal] = useState(false)

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    Promise.all([listLLMConfigs(), getLLMProviderOptions(), getMe(), getTenantConfig()])
      .then(([cfgs, opts, me, tc]) => {
        const tid = (me.tenant_id ?? '').trim()
        const raw = Array.isArray(cfgs) ? cfgs : []
        const scoped = tid ? raw.filter((c) => (c.tenant_id ?? '').trim() === tid) : raw
        setConfigs(scoped)
        setProviderOptions(opts && typeof opts === 'object' ? opts : {})
        setTenantConfig(tc)
      })
      .catch((err) => {
        setError(
          err instanceof ApiError && err.status === 403
            ? err.detail ?? '需 admin 或 super_admin 權限'
            : err instanceof ApiError && err.detail
              ? err.detail
              : '無法載入 LLM 設定',
        )
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // ── Provider CRUD ─────────────────────────────────────────────────────────

  function openCreate() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowApiKey(false)
    setShowForm(true)
  }

  function openEdit(cfg: LLMProviderConfig) {
    setEditingId(cfg.id)
    setForm({
      provider: cfg.provider,
      label: cfg.label ?? '',
      api_key: '',
      api_key_masked: cfg.api_key_masked ?? '',
      api_base_url: cfg.api_base_url ?? '',
      gcp_project_id: cfg.gcp_project_id ?? '',
      gcp_region: cfg.gcp_region ?? '',
      available_models_entries: cfg.available_models ?? [],
      is_active: cfg.is_active,
    })
    setShowApiKey(false)
    setShowForm(true)
  }

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleSave() {
    if (!form.provider) { showToast('請選擇 Provider', 'error'); return }
    setSaving(true)
    try {
      const availableModels = form.available_models_entries.filter((e) => e.model.trim())

      if (editingId !== null) {
        const body: LLMProviderConfigUpdate = {
          label: form.label || null,
          api_base_url: form.api_base_url || null,
          gcp_project_id: form.provider === 'vertex' ? (form.gcp_project_id || null) : undefined,
          gcp_region: form.provider === 'vertex' ? (form.gcp_region || null) : undefined,
          available_models: availableModels,
          is_active: form.is_active,
        }
        if (form.api_key.trim()) body.api_key = form.api_key.trim()
        await updateLLMConfig(editingId, body)
        showToast('LLM 設定已更新', 'success')
      } else {
        const body: LLMProviderConfigCreate = {
          provider: form.provider,
          label: form.label || null,
          api_key: form.api_key.trim() || null,
          api_base_url: form.api_base_url || null,
          gcp_project_id: form.provider === 'vertex' ? (form.gcp_project_id || null) : undefined,
          gcp_region: form.provider === 'vertex' ? (form.gcp_region || null) : undefined,
          available_models: availableModels,
          is_active: true,
        }
        await createLLMConfig(body)
        showToast('LLM 設定已新增', 'success')
      }
      setShowForm(false)
      load()
    } catch (err) {
      showToast(err instanceof ApiError ? (err.detail ?? err.message) : '儲存失敗', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteLLMConfig(id)
      showToast('已刪除', 'success')
      setDeleteTarget(null)
      load()
    } catch (err) {
      showToast(err instanceof ApiError ? (err.detail ?? err.message) : '刪除失敗', 'error')
    }
  }

  async function handleToggleActive(cfg: LLMProviderConfig) {
    setTogglingIds((prev) => new Set([...prev, cfg.id]))
    try {
      await updateLLMConfig(cfg.id, { is_active: !cfg.is_active })
      showToast(cfg.is_active ? '已停用' : '已啟用', 'success')
      load()
    } catch (err) {
      showToast(err instanceof ApiError ? (err.detail ?? err.message) : '操作失敗', 'error')
    } finally {
      setTogglingIds((prev) => { const n = new Set(prev); n.delete(cfg.id); return n })
    }
  }

  // ── Per-model test ─────────────────────────────────────────────────────────

  async function handleTestModel(configId: number, model: string) {
    const key = testKey(configId, model)
    setTestingKey(key)
    try {
      const result = await testLLMConfig(configId, model)
      setTestResultModal({ model, result })
    } catch (err) {
      const msg = err instanceof ApiError ? (err.detail ?? err.message) : '測試失敗'
      const result: LLMTestResult = { ok: false, elapsed_ms: 0, error: msg }
      setTestResultModal({ model, result })
    } finally {
      setTestingKey(null)
    }
  }

  // ── Default LLM update ────────────────────────────────────────────────────

  /**
   * 從 model ID（如 local:3/gemma4:26b、custom:8/gpt-4o）推導出 form 的 provider 值。
   * local / custom 多實例時帶 :{id}，其他 provider 直接回傳 default_llm_provider。
   */
  function inferProviderFromModel(model: string, fallbackProvider: string): string {
    if (model.startsWith('local:')) {
      const slash = model.indexOf('/')
      return slash >= 0 ? model.slice(0, slash) : model  // → "local:3"
    }
    if (model.startsWith('custom:')) {
      const slash = model.indexOf('/')
      return slash >= 0 ? model.slice(0, slash) : model  // → "custom:8"
    }
    return fallbackProvider
  }

  /** Provider 下拉選單：動態從 configs 建立，local/custom 各實例獨立一項 */
  const defaultLLMProviderOptions = configs
    .filter((c) => c.is_active)
    .reduce<{ value: string; label: string }[]>((acc, cfg) => {
      if (cfg.provider === 'local') {
        acc.push({ value: `local:${cfg.id}`, label: `本機・${cfg.label || `#${cfg.id}`}` })
      } else if (cfg.provider === 'custom') {
        acc.push({ value: `custom:${cfg.id}`, label: `自訂・${cfg.label || `#${cfg.id}`}` })
      } else if (!acc.some((o) => o.value === cfg.provider)) {
        acc.push({ value: cfg.provider, label: PROVIDER_LABELS[cfg.provider] ?? cfg.provider })
      }
      return acc
    }, [])

  function openDefaultLLMForm() {
    const model = tenantConfig?.default_llm_model ?? ''
    const fallback = tenantConfig?.default_llm_provider ?? 'gemini'
    setDefaultLLMForm({
      provider: inferProviderFromModel(model, fallback),
      model,
    })
    setShowDefaultLLMForm(true)
  }

  async function handleSaveDefaultLLM() {
    if (!defaultLLMForm.provider || !defaultLLMForm.model.trim()) {
      showToast('請填寫 Provider 與 Model', 'error'); return
    }
    setSavingDefaultLLM(true)
    // 傳給後端的 provider 去掉 :{id} 後綴（後端只需要 "local" / "custom"）
    const apiProvider = defaultLLMForm.provider.includes(':')
      ? defaultLLMForm.provider.split(':')[0]
      : defaultLLMForm.provider
    try {
      const tc = await updateDefaultLLM({ provider: apiProvider, model: defaultLLMForm.model.trim() })
      setTenantConfig(tc)
      setShowDefaultLLMForm(false)
      showToast('預設 LLM 已更新', 'success')
    } catch (err) {
      showToast(err instanceof ApiError ? (err.detail ?? err.message) : '儲存失敗', 'error')
    } finally {
      setSavingDefaultLLM(false)
    }
  }

  // ── Analysis model config ──────────────────────────────────────────────

  function openAnalysisModelForm() {
    const current = tenantConfig?.analysis_llm_model ?? ''
    // 嘗試從 "provider/model" 格式解析 provider
    const slashIdx = current.indexOf('/')
    const guessedProvider = slashIdx > 0 ? current.slice(0, slashIdx) : 'openai'
    const validProvider = Object.keys(PROVIDER_LABELS).includes(guessedProvider) ? guessedProvider : 'openai'
    setAnalysisModelForm({ provider: validProvider, model: current })
    setShowAnalysisModelForm(true)
  }

  async function handleSaveAnalysisModel() {
    setSavingAnalysisModel(true)
    try {
      const model = analysisModelForm.model.trim() || null
      const tc = await updateAnalysisModel(model)
      setTenantConfig(tc)
      setShowAnalysisModelForm(false)
      showToast(model ? '分析模型已設定' : '分析模型已清除', 'success')
    } catch (err) {
      showToast(err instanceof ApiError ? (err.detail ?? err.message) : '儲存失敗', 'error')
    } finally {
      setSavingAnalysisModel(false)
    }
  }

  // ── Embedding config ─────────────────────────────────────────────────────

  /** 將 embeddingForm.provider 轉成 embed_texts_sync 用的基礎 provider 字串 */
  function baseProvider(provider: string): string {
    if (provider.startsWith('custom:')) return 'custom'
    if (provider.startsWith('local:')) return 'local'
    return provider
  }

  /** 從 provider 字串（含 custom:{id} / local:{id} 格式）解析顯示用 label */
  function resolveEmbeddingLabel(provider: string): string {
    if (provider.startsWith('custom:')) {
      const id = parseInt(provider.split(':')[1])
      const cfg = configs.find((c) => c.id === id)
      return cfg?.label || `自訂 #${id}`
    }
    if (provider.startsWith('local:')) {
      const id = parseInt(provider.split(':')[1])
      const cfg = configs.find((c) => c.id === id)
      return cfg?.label ? `本機・${cfg.label}` : `本機 #${id}`
    }
    return PROVIDER_LABELS[provider] ?? provider
  }

  /** 從 provider 字串解析顯示用 color class */
  function resolveEmbeddingColor(provider: string): string {
    return PROVIDER_COLORS[baseProvider(provider)] ?? 'bg-gray-100 text-gray-700'
  }

  // ── Speech config helpers ─────────────────────────────────────────────────

  /** 從 provider 字串（含 custom:{id} / local:{id} 格式）解析 STT 顯示用 label */
  function resolveSpeechLabel(provider: string): string {
    if (!provider) return '未設定'
    if (provider === 'local') return '本機模型 (Local)'
    if (provider.startsWith('custom:')) {
      const id = parseInt(provider.split(':')[1])
      const cfg = configs.find((c) => c.id === id)
      return cfg?.label ? `自訂・${cfg.label}` : `自訂 #${id}`
    }
    if (provider.startsWith('local:')) {
      const id = parseInt(provider.split(':')[1])
      const cfg = configs.find((c) => c.id === id)
      return cfg?.label ? `本機・${cfg.label}` : `本機 #${id}`
    }
    return PROVIDER_LABELS[provider] ?? provider
  }

  /** 從 provider 字串解析 STT 顯示用 color class */
  function resolveSpeechColor(provider: string): string {
    if (!provider) return 'bg-gray-100 text-gray-700'
    return PROVIDER_COLORS[baseProvider(provider)] ?? 'bg-gray-100 text-gray-700'
  }

  function openEmbeddingForm() {
    const currentProvider = tenantConfig?.embedding_provider ?? 'local'
    const currentModel = tenantConfig?.embedding_model ?? ''
    const isLocal = currentProvider === 'local' || currentProvider.startsWith('local:')
    const mode: 'local' | 'custom' = isLocal ? 'local' : 'custom'

    const localConfigs = configs.filter((c) => c.is_active && c.provider === 'local')
    const nonLocalConfigs = configs.filter((c) => c.is_active && c.provider !== 'local')

    let resolvedProvider: string
    if (isLocal) {
      // 若已存 local:{id}，沿用；否則選第一個 local config
      if (currentProvider.startsWith('local:')) {
        resolvedProvider = currentProvider
      } else {
        const first = localConfigs[0]
        resolvedProvider = first ? `local:${first.id}` : 'local'
      }
    } else if (nonLocalConfigs.some((c) => {
      const key = c.provider === 'custom' ? `custom:${c.id}` : c.provider
      return key === currentProvider
    })) {
      resolvedProvider = currentProvider
    } else {
      // fallback 到第一個非 local active config
      const first = nonLocalConfigs[0]
      resolvedProvider = first ? (first.provider === 'custom' ? `custom:${first.id}` : first.provider) : 'openai'
    }

    const resolvedModel = currentModel || EMBEDDING_MODEL_DEFAULTS[baseProvider(resolvedProvider)] || ''

    setEmbeddingMode(mode)
    setEmbeddingForm({ provider: resolvedProvider, model: resolvedModel })
    setEmbeddingCandidateResult(null)
    setShowEmbeddingForm(true)
  }

  async function handleTestEmbeddingCandidate() {
    if (!embeddingForm.provider || !embeddingForm.model.trim()) {
      showToast('請先選擇 Provider 並輸入 Model', 'error')
      return
    }
    setTestingEmbeddingCandidate(true)
    setEmbeddingCandidateResult(null)
    try {
      const result = await testEmbeddingCandidate({
        provider: embeddingForm.provider,
        model: embeddingForm.model.trim(),
      })
      setEmbeddingCandidateResult(result)
      if (result.ok && !result.dim_warning) {
        showToast('測試成功：連線正常，維度正確', 'success')
      } else if (result.ok && result.dim_warning) {
        showToast(`測試連線成功，但${result.dim_warning}`, 'error')
      }
    } catch (err) {
      const msg = err instanceof ApiError ? (err.detail ?? err.message) : '測試失敗'
      showToast(msg, 'error')
      setEmbeddingCandidateResult({ ok: false, elapsed_ms: 0, model: embeddingForm.model, error: msg })
    } finally {
      setTestingEmbeddingCandidate(false)
    }
  }

  async function handleSaveEmbedding() {
    if (!embeddingForm.provider || !embeddingForm.model.trim()) {
      showToast('請選擇 Provider 與 Model', 'error'); return
    }
    if (!embeddingCandidateResult?.ok) {
      showToast('請先點擊「測試連線」確認設定正確', 'error'); return
    }
    // embedding_provider 已設定過（含 migration 後 locked_at 被清空的狀態）→ 需走確認流程
    const hasExisting = !!tenantConfig?.embedding_provider
    if (hasExisting) {
      setMigrateLogs([])
      setEmbeddingMigrateStep('confirm')
      setShowEmbeddingMigrateModal(true)
      return
    }
    // 第一次設定，直接儲存
    await _doMigrateEmbedding(false)
  }

  function _appendMigrateLog(msg: string) {
    setMigrateLogs((prev) => [...prev, msg])
  }

  async function _doMigrateEmbedding(needsReindex: boolean) {
    if (needsReindex) {
      setEmbeddingMigrateStep('saving')
      _appendMigrateLog('步驟 1/3：正在儲存新的 embedding 設定...')
    }
    setSavingEmbedding(true)
    try {
      const tc = await migrateEmbedding({
        provider: embeddingForm.provider,
        model: embeddingForm.model.trim(),
        confirm: true,
      })
      setTenantConfig(tc)
      setEmbeddingCandidateResult(null)

      if (needsReindex) {
        _appendMigrateLog('步驟 2/3：設定已儲存，開始重建向量索引...')
        setEmbeddingMigrateStep('reindexing')
        _startReindexStream()
      } else {
        setShowEmbeddingForm(false)
        setShowEmbeddingMigrateModal(false)
        setEmbeddingForm({ provider: 'openai', model: '' })
        showToast('Embedding Model 已設定', 'success')
      }
    } catch (err) {
      const msg = err instanceof ApiError ? (err.detail ?? err.message) : '儲存失敗'
      _appendMigrateLog(`❌ 儲存失敗：${msg}`)
      setEmbeddingMigrateStep('error')
      showToast(msg, 'error')
    } finally {
      setSavingEmbedding(false)
    }
  }

  function _startReindexStream() {
    const url = '/api/v1/llm-configs/tenant-config/embedding/reindex-stream'
    const token = localStorage.getItem(TOKEN_KEY) ?? ''
    _appendMigrateLog('步驟 3/3：連線重建服務中...')

    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          _appendMigrateLog(`❌ 重建服務連線失敗（HTTP ${res.status}）`)
          setEmbeddingMigrateStep('error')
          return
        }
        _appendMigrateLog('已連線，開始處理文件...')
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const evt = JSON.parse(line.slice(6))
              if (evt.type === 'start') {
                _appendMigrateLog(`找到 ${evt.total} 份文件待重建`)
              } else if (evt.type === 'progress') {
                _appendMigrateLog(`✓ [${evt.index}/${evt.total}] ${evt.filename}`)
              } else if (evt.type === 'error' && evt.filename) {
                _appendMigrateLog(`✗ [${evt.index}/${evt.total}] ${evt.filename}：${evt.message}`)
              } else if (evt.type === 'error' && evt.message) {
                _appendMigrateLog(`❌ ${evt.message}`)
                setEmbeddingMigrateStep('error')
              } else if (evt.type === 'done') {
                _appendMigrateLog(`完成：${evt.success} 份成功${evt.failed > 0 ? `，${evt.failed} 份失敗` : ''}`)
                setEmbeddingMigrateStep('done')
                getTenantConfig().then((tc) => setTenantConfig(tc)).catch(() => {})
              }
            } catch { /* ignore parse errors */ }
          }
        }
        setEmbeddingMigrateStep((s) => (s === 'reindexing' ? 'done' : s))
      })
      .catch((e) => {
        _appendMigrateLog(`❌ 重建連線錯誤：${String(e)}`)
        setEmbeddingMigrateStep('error')
      })
  }

  function _closeEmbeddingMigrateModal() {
    setShowEmbeddingMigrateModal(false)
    setShowEmbeddingForm(false)
    setEmbeddingForm({ provider: 'openai', model: '' })
    setMigrateLogs([])
    setEmbeddingMigrateStep('confirm')
  }

  function openSpeechForm() {
    const currentProvider = tenantConfig?.speech_provider ?? 'local'
    const isLocal = currentProvider === 'local' || currentProvider.startsWith('local:')
    const mode: 'local' | 'custom' = isLocal ? 'local' : 'custom'

    const localConfigs = configs.filter((c) => c.is_active && c.provider === 'local')
    const nonLocalSpeechConfigs = configs.filter((c) => c.is_active && c.provider !== 'local')

    let resolvedProvider = currentProvider
    if (isLocal) {
      // 若已是 local:{id} 格式且 config 仍存在，保留；否則 fallback 到第一個 local config
      if (currentProvider.startsWith('local:')) {
        const id = parseInt(currentProvider.split(':')[1])
        const stillExists = localConfigs.some((c) => c.id === id)
        if (!stillExists) {
          const first = localConfigs[0]
          resolvedProvider = first ? `local:${first.id}` : 'local'
        }
      } else {
        // 舊格式 'local' → 升級成 local:{id}
        const first = localConfigs[0]
        resolvedProvider = first ? `local:${first.id}` : 'local'
      }
    } else {
      // 解析目前設定的 provider key（可能是 "custom:8" 或 "openai" 等）
      const matchFound = nonLocalSpeechConfigs.some((c) => {
        const key = c.provider === 'custom' ? `custom:${c.id}` : c.provider
        return key === currentProvider
      })
      if (!matchFound) {
        const first = nonLocalSpeechConfigs[0]
        resolvedProvider = first
          ? (first.provider === 'custom' ? `custom:${first.id}` : first.provider)
          : 'openai'
      }
    }

    const resolvedModel = tenantConfig?.speech_model
      || SPEECH_MODEL_DEFAULTS[baseProvider(resolvedProvider)]
      || ''

    setSpeechMode(mode)
    setSpeechForm({
      provider: resolvedProvider,
      base_url: tenantConfig?.speech_base_url ?? '',
      api_key: '',
      model: resolvedModel,
    })
    setShowSpeechApiKey(false)
    // 若目前已設定為 local 並已存有 base_url，視為已驗證（儲存過的設定）
    const preVerified = isLocal && !!tenantConfig?.speech_base_url
    setSpeechCandidateResult(preVerified ? { ok: true, elapsed_ms: 0 } : null)
    setShowSpeechForm(true)
  }

  async function handleSaveSpeech() {
    if (!speechForm.provider) { showToast('請選擇 Provider', 'error'); return }
    if (speechMode === 'local') {
      if (!speechForm.base_url.trim()) { showToast('本機模型需填寫 Base URL', 'error'); return }
      if (!speechCandidateResult?.ok) { showToast('請先點擊「測試連線」確認設定正確', 'error'); return }
    } else {
      if (!speechForm.model.trim()) { showToast('請填寫模型名稱', 'error'); return }
    }
    setSavingSpeech(true)
    try {
      const tc = await updateSpeechConfig({
        provider: speechForm.provider,
        base_url: speechMode === 'local' ? (speechForm.base_url.trim() || null) : null,
        api_key: speechForm.api_key || undefined,
        model: speechForm.model.trim() || null,
      })
      setTenantConfig(tc)
      setShowSpeechForm(false)
      showToast('語音設定已儲存', 'success')
    } catch (err) {
      showToast(err instanceof ApiError ? (err.detail ?? err.message) : '儲存失敗', 'error')
    } finally {
      setSavingSpeech(false)
    }
  }

  async function handleTestSpeechCandidate() {
    if (speechMode === 'local' && !speechForm.base_url.trim()) {
      showToast('請先填寫 Base URL', 'error')
      return
    }
    setTestingSpeechCandidate(true)
    setSpeechCandidateResult(null)
    try {
      const result = await testSpeechCandidate({
        provider: speechForm.provider,
        base_url: speechMode === 'local' ? speechForm.base_url.trim() : undefined,
      })
      setSpeechCandidateResult(result)
      if (result.ok) showToast('測試成功：語音服務連線正常', 'success')
    } catch (err) {
      const msg = err instanceof ApiError ? (err.detail ?? err.message) : '測試失敗'
      setSpeechCandidateResult({ ok: false, error: msg })
    } finally {
      setTestingSpeechCandidate(false)
    }
  }

  async function handleDisableSpeech() {
    setDisablingSpeech(true)
    try {
      const tc = await updateSpeechConfig({ provider: '' })
      setTenantConfig(tc)
      showToast('語音功能已停用', 'success')
    } catch (err) {
      showToast(err instanceof ApiError ? (err.detail ?? err.message) : '停用失敗', 'error')
    } finally {
      setDisablingSpeech(false)
      setShowDisableSpeechConfirm(false)
    }
  }

  const defaultModelsForProvider = providerOptions[form.provider] ?? []

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8 text-lg">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <KeyRound className="h-6 w-6 text-gray-600" />
          <div>
            <h2 className="text-lg font-bold text-gray-800">LLM 設定</h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHelpModal(true)}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-base text-gray-500 hover:border-gray-300 hover:text-gray-700 hover:bg-gray-50 transition-colors"
            title="模型選型指南"
          >
            <HelpCircle className="h-4 w-4" />
            模型選型指南
          </button>
          <button
            onClick={() => setShowBackupHelpModal(true)}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-base text-gray-500 hover:border-gray-300 hover:text-gray-700 hover:bg-gray-50 transition-colors"
            title="備份策略"
          >
            <Archive className="h-4 w-4" />
            備份策略
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
      )}
      {loading && (
        <div className="text-center py-8 text-gray-400">載入中...</div>
      )}

      {!loading && !error && (
        <>
          {/* ════════════════════════════════════════════════════════════════
              Section 1：租戶預設 AI 設定
          ════════════════════════════════════════════════════════════════ */}
          <section className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-700 border-b border-gray-200 pb-2">
              預設 AI 設定
            </h3>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">

              {/* 預設 LLM */}
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-base font-medium text-gray-500 uppercase tracking-wide">預設 LLM</span>
                  <button
                    onClick={openDefaultLLMForm}
                    className="flex items-center gap-1 rounded px-2 py-1 text-base text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5" /> 變更
                  </button>
                </div>
                {tenantConfig?.default_llm_model ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {(() => {
                        const model = tenantConfig.default_llm_model ?? ''
                        const baseP = tenantConfig.default_llm_provider ?? ''
                        // local 多實例：從 model ID 解析出 config id，顯示 label
                        if (model.startsWith('local:')) {
                          const cfgId = parseInt(model.split(':')[1])
                          const cfg = configs.find((c) => c.id === cfgId)
                          const lbl = cfg?.label ? `本機・${cfg.label}` : `本機模型`
                          return <span className={`rounded-full px-2.5 py-0.5 text-base font-semibold ${PROVIDER_COLORS['local'] ?? 'bg-gray-100 text-gray-700'}`}>{lbl}</span>
                        }
                        return (
                          <span className={`rounded-full px-2.5 py-0.5 text-base font-semibold ${PROVIDER_COLORS[baseP] ?? 'bg-gray-100 text-gray-700'}`}>
                            {PROVIDER_LABELS[baseP] ?? baseP}
                          </span>
                        )
                      })()}
                    </div>
                    <p className="font-mono text-gray-800 text-base break-all">{tenantConfig.default_llm_model}</p>
                  </div>
                ) : (
                  <p className="text-base text-gray-400 italic">尚未設定，點擊「變更」選擇</p>
                )}
              </div>

              {/* Embedding Model */}
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-base font-medium text-gray-500 uppercase tracking-wide">Embedding Model</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={openEmbeddingForm}
                      className="flex items-center gap-1 rounded px-2 py-1 text-base text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" /> 設定
                    </button>
                  </div>
                </div>
                {tenantConfig?.embedding_model ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-base font-semibold ${resolveEmbeddingColor(tenantConfig.embedding_provider ?? '')}`}>
                        {resolveEmbeddingLabel(tenantConfig.embedding_provider ?? '')}
                      </span>
                      <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-base text-gray-500">
                        v{tenantConfig.embedding_version ?? 1}
                      </span>
                    </div>
                    <p className="font-mono text-gray-800 text-base">{tenantConfig.embedding_model}</p>
                    {tenantConfig.embedding_locked_at ? (
                      <div className="flex items-center gap-1 text-base text-gray-400">
                        <Lock className="h-3 w-3" />
                        已鎖定・{new Date(tenantConfig.embedding_locked_at).toLocaleDateString('zh-TW')}
                      </div>
                    ) : (
                      <p className="text-base text-amber-500">尚未鎖定（第一次上傳文件後自動鎖定）</p>
                    )}
                  </div>
                ) : (
                  <p className="text-base text-gray-400 italic">尚未設定，點擊「設定」選擇 Embedding Model</p>
                )}
              </div>

              {/* 語音模型 */}
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-base font-medium text-gray-500 uppercase tracking-wide">語音模型 (STT)</span>
                  <div className="flex items-center gap-1">
                    {tenantConfig?.speech_provider && (
                      <button
                        onClick={() => setShowDisableSpeechConfirm(true)}
                        className="flex items-center gap-1 rounded px-2 py-1 text-base text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      >
                        停用
                      </button>
                    )}
                    <button
                      onClick={openSpeechForm}
                      className="flex items-center gap-1 rounded px-2 py-1 text-base text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" /> 設定
                    </button>
                  </div>
                </div>
                {tenantConfig?.speech_provider ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-base font-semibold ${resolveSpeechColor(tenantConfig.speech_provider)}`}>
                        {resolveSpeechLabel(tenantConfig.speech_provider)}
                      </span>
                    </div>
                    {tenantConfig.speech_model && (
                      <p className="font-mono text-gray-800 text-base">{tenantConfig.speech_model}</p>
                    )}
                    {tenantConfig.speech_base_url && (
                      <p className="font-mono text-base text-gray-400 truncate">{tenantConfig.speech_base_url}</p>
                    )}
                    {tenantConfig.speech_api_key_masked && (
                      <p className="text-base text-gray-400">API Key：{tenantConfig.speech_api_key_masked}</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-base text-gray-400 italic">尚未設定，點擊「設定」啟用語音輸入</p>
                    <div className="flex items-center gap-1.5 text-base text-gray-400">
                      <Mic className="h-3.5 w-3.5" />
                      <span>支援本機 faster-whisper 或 OpenAI Whisper API</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ════════════════════════════════════════════════════════════════
              Section 2：分析模型設定
          ════════════════════════════════════════════════════════════════ */}
          <section className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-700 border-b border-gray-200 pb-2">
              分析模型設定
            </h3>
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <p className="shrink-0 text-sm font-medium text-gray-600">
                    用於 Business Insight 多步驟分析的模型
                  </p>
                  {tenantConfig?.analysis_llm_model ? (
                    <span className="font-mono text-gray-800 text-sm break-all bg-white/70 rounded px-3 py-1.5 border border-indigo-100">
                      {tenantConfig.analysis_llm_model}
                    </span>
                  ) : (
                    <div className="flex items-center gap-1.5 text-sm text-amber-600 bg-amber-50 rounded px-2.5 py-1 border border-amber-100">
                      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                      <span>尚未設定</span>
                    </div>
                  )}
                </div>
                <button
                  onClick={openAnalysisModelForm}
                  className="flex-shrink-0 flex items-center gap-1 rounded px-2 py-1 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  <Pencil className="h-3.5 w-3.5" /> 變更
                </button>
              </div>
            </div>
          </section>

          {/* ════════════════════════════════════════════════════════════════
              Section 3：Provider 連線設定
          ════════════════════════════════════════════════════════════════ */}
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-gray-200 pb-2">
              <h3 className="text-lg font-semibold text-gray-700">Provider 連線設定</h3>
              <button
                onClick={openCreate}
                className="flex items-center gap-2 rounded-lg bg-gray-700 px-4 py-2 text-base font-medium text-white hover:bg-gray-600 transition-colors"
              >
                <Plus className="h-4 w-4" /> 新增 Provider
              </button>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-base text-amber-800">
              API Key 加密後存入資料庫。此設定僅管理「如何連線」，預設 LLM 請在上方「預設 AI 設定」調整。
            </div>

            {configs.length === 0 && (
              <div className="rounded-lg border-2 border-dashed border-gray-200 py-12 text-center text-gray-400">
                <KeyRound className="mx-auto h-10 w-10 mb-3 opacity-30" />
                <p>尚無 Provider 設定</p>
                <p className="text-base mt-1">點擊「新增 Provider」加入 OpenAI / Gemini / 台智雲 / 本機模型的 API Key</p>
              </div>
            )}

            <div className="space-y-3">
              {[...configs].sort((a, b) => (a.provider === 'local' ? -1 : b.provider === 'local' ? 1 : 0)).map((cfg) => {
                const isExpanded = expandedIds.has(cfg.id)
                const isToggling = togglingIds.has(cfg.id)
                const colorClass = PROVIDER_COLORS[cfg.provider] ?? 'bg-gray-100 text-gray-800'
                const models: LLMModelEntry[] = cfg.available_models?.length
                  ? cfg.available_models
                  : (providerOptions[cfg.provider] ?? []).map((m) => ({ model: m }))

                return (
                  <div
                    key={cfg.id}
                    className={`rounded-lg border shadow-sm overflow-hidden transition-opacity ${PROVIDER_CARD_COLORS[cfg.provider] ?? 'border-gray-200 bg-white'} ${cfg.is_active ? '' : 'opacity-60'}`}
                  >
                    {/* Card header */}
                    <div className="flex items-center justify-between px-5 py-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-base font-semibold ${colorClass}`}>
                          {PROVIDER_LABELS[cfg.provider] ?? cfg.provider}
                        </span>
                        <span className="font-medium text-gray-800 truncate">
                          {cfg.label || `${PROVIDER_LABELS[cfg.provider] ?? cfg.provider} 設定`}
                        </span>
                        {!cfg.is_active && (
                          <span className="shrink-0 rounded-full bg-red-100 px-2.5 py-0.5 text-base font-medium text-red-600">停用中</span>
                        )}
                        {cfg.api_key_masked && (
                          <span className="shrink-0 rounded bg-gray-50 border border-gray-200 px-2 py-0.5 font-mono text-base text-gray-500">
                            {cfg.api_key_masked}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => void handleToggleActive(cfg)}
                          disabled={isToggling}
                          className={`rounded px-2 py-1.5 text-base font-medium transition-colors disabled:opacity-50 ${cfg.is_active ? 'text-gray-500 hover:text-orange-600 hover:bg-orange-50' : 'text-gray-500 hover:text-green-600 hover:bg-green-50'}`}
                        >
                          {isToggling
                            ? <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            : cfg.is_active ? '停用' : '啟用'}
                        </button>
                        <button
                          onClick={() => openEdit(cfg)}
                          className="rounded p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                          title="編輯"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(cfg.id)}
                          className="rounded p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="刪除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => toggleExpand(cfg.id)}
                          className="rounded p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                          title={isExpanded ? '收合' : '展開'}
                        >
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Per-model test rows (always visible) */}
                    {models.length > 0 && (
                      <div className="border-t border-gray-100 px-5 py-3 bg-gray-50 space-y-1.5">
                        <p className="text-base font-medium text-gray-400 mb-2">Models</p>
                        {models.map((entry) => {
                          const key = testKey(cfg.id, entry.model)
                          const isTesting = testingKey === key
                          return (
                            <div key={entry.model} className="flex items-center gap-3">
                              <div className="flex-1 min-w-0">
                                <span className="font-mono text-base text-gray-700 truncate block">{entry.model}</span>
                                {entry.note && (
                                  <span className="text-base text-gray-400">{entry.note}</span>
                                )}
                              </div>
                              <button
                                onClick={() => void handleTestModel(cfg.id, entry.model)}
                                disabled={isTesting || !cfg.is_active}
                                className="flex items-center gap-1 rounded px-2 py-1 text-base font-medium text-gray-500 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-40 transition-colors shrink-0"
                              >
                                <Zap className={`h-3.5 w-3.5 ${isTesting ? 'animate-pulse' : ''}`} />
                                {isTesting ? '測試中...' : '測試'}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 space-y-2 text-base">
                        <Row label="租戶 ID" value={cfg.tenant_id} mono />
                        {cfg.api_base_url && <Row label="API Base URL" value={cfg.api_base_url} mono />}
                        {cfg.gcp_project_id && <Row label="GCP Project ID" value={cfg.gcp_project_id} mono />}
                        {cfg.gcp_region && <Row label="GCP Region" value={cfg.gcp_region} mono />}
                        <Row label="建立時間" value={new Date(cfg.created_at).toLocaleString('zh-TW')} />
                        <Row label="更新時間" value={new Date(cfg.updated_at).toLocaleString('zh-TW')} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        </>
      )}

      {/* ── Modal：新增/編輯 Provider ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-xl bg-white shadow-2xl overflow-y-auto max-h-[90vh]">
            <ModalHeader title={editingId !== null ? '編輯 Provider 連線' : '新增 Provider 連線'} onClose={() => setShowForm(false)} />
            <div className="px-6 py-5 space-y-4">

              <Field label="Provider" required>
                <select
                  disabled={editingId !== null}
                  value={form.provider}
                  onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value, available_models_entries: [] }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:bg-gray-50"
                >
                  <option value="openai">OpenAI</option>
                  <option value="gemini">Google AI Studio</option>
                  <option value="vertex">Google Vertex AI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="twcc">台智雲 TWCC</option>
                  <option value="local">本機模型 (Local / Ollama / LM Studio)</option>
                  <option value="custom">自訂（OpenAI 相容 API）</option>
                </select>
              </Field>

              <Field
                label="顯示名稱"
                required={form.provider === 'custom' || form.provider === 'local'}
                hint={
                  form.provider === 'custom'
                    ? '自訂 Provider 需填入名稱以便區分（例：Ardge AI、客戶 LLM Server）'
                    : form.provider === 'local'
                      ? '本機模型 Provider 需填入名稱以便區分（例：辦公室 Ollama、GPU 伺服器）'
                      : undefined
                }
              >
                <input
                  type="text"
                  placeholder={
                    form.provider === 'custom'
                      ? '例：Ardge AI Server'
                      : form.provider === 'local'
                        ? '例：辦公室 Ollama'
                        : '例：OpenAI（公司帳號）'
                  }
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              </Field>

              {/* Vertex AI 專屬欄位 */}
              {form.provider === 'vertex' && (
                <>
                  <Field label="GCP Project ID" required>
                    <input
                      type="text"
                      placeholder="例：my-gcp-project-123"
                      value={form.gcp_project_id}
                      onChange={(e) => setForm((f) => ({ ...f, gcp_project_id: e.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
                    />
                  </Field>
                  <Field label="GCP Region" required hint="Vertex AI 服務所在區域，例：us-central1、asia-east1">
                    <input
                      type="text"
                      placeholder="例：us-central1"
                      value={form.gcp_region}
                      onChange={(e) => setForm((f) => ({ ...f, gcp_region: e.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
                    />
                  </Field>
                </>
              )}

              <Field
                label={
                  form.provider === 'vertex'
                    ? (editingId !== null ? 'Service Account JSON（留空表示不變更；GCP VM 可留空用 ADC）' : 'Service Account JSON（選填，GCP VM 可留空）')
                    : (editingId !== null ? 'API Key（留空表示不變更）' : 'API Key')
                }
                hint={
                  form.provider === 'vertex'
                    ? '貼上 Service Account JSON（選填）。部署在 GCP VM 且已掛預設 SA 時可留空，改以 VM 的 Application Default Credentials 連線'
                    : form.provider === 'local'
                      ? '本機服務通常不需要 API Key，可留空或填任意字串（如 local）'
                      : editingId !== null && form.api_key_masked
                        ? `目前：${form.api_key_masked}`
                        : undefined
                }
              >
                <div className="relative">
                  {form.provider === 'vertex' ? (
                    <textarea
                      rows={5}
                      placeholder={'{\n  "type": "service_account",\n  "project_id": "...",\n  ...\n}'}
                      value={form.api_key}
                      onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
                    />
                  ) : (
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      placeholder={editingId !== null ? '不填則保留原 Key' : 'sk-...'}
                      value={form.api_key}
                      onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-base font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
                    />
                  )}
                  {form.provider !== 'vertex' && (
                    <button
                      type="button"
                      onClick={() => setShowApiKey((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      tabIndex={-1}
                    >
                      {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  )}
                </div>
              </Field>

              {form.provider !== 'vertex' && <Field
                label="API Base URL"
                required={form.provider === 'twcc' || form.provider === 'local' || form.provider === 'custom'}
                hint={
                  form.provider === 'twcc'
                    ? '台智雲必填，例：https://api-ams.twcc.ai/api/models/conversation'
                    : form.provider === 'custom'
                      ? '必填，OpenAI-compatible 服務的 base URL（含 /v1）'
                      : form.provider === 'local'
                        ? undefined
                        : '選填，用於 Azure OpenAI 或 OpenAI-compatible Proxy'
                }
              >
                <input
                  type="text"
                  placeholder={
                    form.provider === 'twcc'
                      ? 'https://api-ams.twcc.ai/api/models/conversation'
                      : form.provider === 'local'
                        ? 'http://192.168.1.10:11434'
                        : form.provider === 'custom'
                          ? 'https://your-llm-server.example.com/ai/v1'
                          : 'https://your-proxy.example.com/v1'
                  }
                  value={form.api_base_url}
                  onChange={(e) => setForm((f) => ({ ...f, api_base_url: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
                {form.provider === 'local' && (
                  <div className="mt-1 space-y-0.5 text-base text-gray-400">
                    <p>設定成 Ollama / LM Studio 服務位址，例：<code className="rounded bg-gray-100 px-1">http://192.168.1.10:11434</code></p>
                    <p>NeuroSme 與 Ollama 在同一台主機時請用：<code className="rounded bg-gray-100 px-1">http://host.docker.internal:11434</code></p>
                  </div>
                )}
                {form.provider === 'custom' && (
                  <p className="mt-1 text-base text-gray-400">填入廠商提供的 API 位址（符合 OpenAI /chat/completions 格式即可）</p>
                )}
              </Field>}

              <Field label="可用 Models">
                <div className="space-y-2">
                  {form.available_models_entries.map((entry, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <div className="flex-1 space-y-1">
                        <input
                          type="text"
                          placeholder={
                            form.provider === 'local'      ? 'Model ID，例：gemma4:26b' :
                            form.provider === 'gemini'     ? 'Model ID，例：gemini/gemini-2.5-flash' :
                            form.provider === 'anthropic'  ? 'Model ID，例：anthropic/claude-3-5-haiku-20241022' :
                            form.provider === 'twcc'       ? 'Model ID，例：twcc/Llama3.3-FFM-70B-32K' :
                            form.provider === 'custom'     ? 'Model ID，例：gemma-4-31b-instruct-gguf' :
                                                             'Model ID，例：gpt-4o-mini'
                          }
                          value={entry.model}
                          onChange={(e) => {
                            const next = [...form.available_models_entries]
                            next[idx] = { ...next[idx], model: e.target.value }
                            setForm((f) => ({ ...f, available_models_entries: next }))
                          }}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
                        />
                        <input
                          type="text"
                          placeholder="備註（選填），例：手寫 ✓  印刷 ✓  雲端"
                          value={entry.note ?? ''}
                          onChange={(e) => {
                            const next = [...form.available_models_entries]
                            next[idx] = { ...next[idx], note: e.target.value }
                            setForm((f) => ({ ...f, available_models_entries: next }))
                          }}
                          className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-base text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const next = form.available_models_entries.filter((_, i) => i !== idx)
                          setForm((f) => ({ ...f, available_models_entries: next }))
                        }}
                        className="mt-1.5 rounded p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, available_models_entries: [...f.available_models_entries, { model: '', note: '' }] }))}
                    className="flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-base text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors w-full justify-center"
                  >
                    <Plus className="h-3.5 w-3.5" /> 新增 Model
                  </button>
                  {defaultModelsForProvider.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowRefModal(true)}
                      className="text-base text-blue-500 hover:underline"
                    >
                      參考設定
                    </button>
                  )}
                </div>
              </Field>

              <Field label="狀態">
                <label className="flex cursor-pointer items-center gap-3">
                  <div
                    onClick={() => setForm((f) => ({ ...f, is_active: !f.is_active }))}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${form.is_active ? 'bg-green-500' : 'bg-gray-300'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                  </div>
                  <span className={`text-base font-medium ${form.is_active ? 'text-green-700' : 'text-gray-400'}`}>
                    {form.is_active ? '啟用中' : '停用中'}
                  </span>
                </label>
              </Field>
            </div>
            <ModalFooter onCancel={() => setShowForm(false)} onConfirm={handleSave} saving={saving} />
          </div>
        </div>
      )}

      {/* ── Modal：變更預設 LLM ── */}
      {showDefaultLLMForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
            <ModalHeader title="變更預設 LLM" onClose={() => setShowDefaultLLMForm(false)} />
            <div className="px-6 py-5 space-y-4">
              <Field label="Provider" required>
                <select
                  value={defaultLLMForm.provider}
                  onChange={(e) => setDefaultLLMForm((f) => ({ ...f, provider: e.target.value, model: '' }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-gray-400"
                >
                  {defaultLLMProviderOptions.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Model" required>
                <input
                  type="text"
                  placeholder="例：gemini/gemini-2.5-flash"
                  value={defaultLLMForm.model}
                  onChange={(e) => setDefaultLLMForm((f) => ({ ...f, model: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
                {/* quick-fill from provider's available models */}
                {(() => {
                  // local:{id} / custom:{id} → 依 id 找 config；其他 provider → 用 provider 字串找
                  const p = defaultLLMForm.provider
                  let cfg: typeof configs[0] | undefined
                  if (p.startsWith('local:') || p.startsWith('custom:')) {
                    const cfgId = parseInt(p.split(':')[1])
                    cfg = configs.find((c) => c.id === cfgId && c.is_active)
                  } else {
                    cfg = configs.find((c) => c.provider === p && c.is_active)
                  }
                  const baseP = p.includes(':') ? p.split(':')[0] : p
                  const ms = cfg?.available_models?.length ? cfg.available_models : (providerOptions[baseP] ?? [])
                  // local 實例的 quick-fill：model 值需加 local:{id}/ 前綴
                  const toModelId = (raw: string) => {
                    if (p.startsWith('local:')) {
                      const bare = raw.startsWith('local/') ? raw.slice(6) : raw
                      return `${p}/${bare}`
                    }
                    return raw
                  }
                  return ms.length > 0 ? (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {ms.map((m) => {
                        const raw = typeof m === 'string' ? m : m.model
                        const mid = toModelId(raw)
                        const display = raw.startsWith('local/') ? raw.slice(6) : raw
                        return (
                          <button
                            key={mid}
                            type="button"
                            onClick={() => setDefaultLLMForm((f) => ({ ...f, model: mid }))}
                            className="rounded bg-gray-100 px-2 py-0.5 text-base text-gray-600 hover:bg-gray-200 transition-colors font-mono"
                          >
                            {display}
                          </button>
                        )
                      })}
                    </div>
                  ) : null
                })()}
              </Field>
            </div>
            <ModalFooter onCancel={() => setShowDefaultLLMForm(false)} onConfirm={handleSaveDefaultLLM} saving={savingDefaultLLM} confirmLabel="儲存" />
          </div>
        </div>
      )}

      {/* ── Modal：分析模型設定 ── */}
      {showAnalysisModelForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
            <ModalHeader title="分析模型設定" onClose={() => setShowAnalysisModelForm(false)} />
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-gray-500">
                用於 Agent BI 多步驟分析，需支援 Function Calling。建議選擇旗艦模型（GPT-4o、Gemini Flash 等）。
              </p>
              <Field label="Provider" required>
                <select
                  value={analysisModelForm.provider}
                  onChange={(e) => setAnalysisModelForm((f) => ({ ...f, provider: e.target.value, model: '' }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-gray-400"
                >
                  {Object.entries(PROVIDER_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </Field>
              <Field label="Model" required>
                {(() => {
                  const cfg = configs.find((c) => c.provider === analysisModelForm.provider && c.is_active)
                  const ms = cfg?.available_models?.length
                    ? cfg.available_models
                    : (providerOptions[analysisModelForm.provider] ?? [])
                  return ms.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {ms.map((m) => {
                        const mid = typeof m === 'string' ? m : m.model
                        const isSelected = analysisModelForm.model === mid
                        return (
                          <button
                            key={mid}
                            type="button"
                            onClick={() => setAnalysisModelForm((f) => ({ ...f, model: mid }))}
                            className={`rounded px-2.5 py-1 text-sm font-mono transition-colors ${isSelected ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                          >
                            {mid}
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <input
                      type="text"
                      placeholder="例：openai/gpt-4o"
                      value={analysisModelForm.model}
                      onChange={(e) => setAnalysisModelForm((f) => ({ ...f, model: e.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
                    />
                  )
                })()}
              </Field>
              {analysisModelForm.model && (
                <p className="text-sm text-gray-500">
                  已選：<span className="font-mono text-gray-800">{analysisModelForm.model}</span>
                </p>
              )}
            </div>
            <ModalFooter
              onCancel={() => setShowAnalysisModelForm(false)}
              onConfirm={handleSaveAnalysisModel}
              saving={savingAnalysisModel}
              confirmLabel="儲存"
            />
          </div>
        </div>
      )}

      {/* ── Modal：設定 Embedding Model ── */}
      {showEmbeddingForm && (() => {
        const isLocked = !!tenantConfig?.embedding_locked_at
        const isAlreadySet = !!tenantConfig?.embedding_model
        // 非 local 的 active configs（每個 config 獨立列出，支援多個自訂 provider）
        const localConfigs = configs.filter((c) => c.is_active && c.provider === 'local')
        const nonLocalConfigs = configs.filter((c) => c.is_active && c.provider !== 'local')
        const hasLocal = localConfigs.length > 0
        const defaultModelForProvider = EMBEDDING_MODEL_DEFAULTS[baseProvider(embeddingForm.provider)] ?? ''
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
              <ModalHeader title="設定 Embedding Model" onClose={() => setShowEmbeddingForm(false)} />
              <div className="px-6 py-5 space-y-4">

                {/* 情境 C：已有向量資料 → 強警告 */}
                {isLocked && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-base text-red-700 space-y-1">
                    <p className="font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="h-4 w-4" /> 已有向量索引，變更需重新編碼索引
                    </p>
                  </div>
                )}

                {/* 情境 B：已設定但尚未鎖定 → 軟提示 */}
                {isAlreadySet && !isLocked && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-base text-amber-700">
                    目前已設定 <code className="rounded bg-amber-100 px-1">{tenantConfig?.embedding_model}</code>，尚無向量資料，可安全變更。
                  </div>
                )}

                {/* 模式選擇：本機 / 自訂 */}
                <Field label="類型" required>
                  <div className="grid grid-cols-2 gap-2">
                    {/* 本機模型 */}
                    <label className={`flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
                      !hasLocal ? 'opacity-40 cursor-not-allowed' :
                      embeddingMode === 'local' ? 'border-gray-400 bg-gray-50' : 'border-gray-200 hover:border-gray-300'
                    }`}>
                      <input
                        type="radio"
                        name="embedding_mode"
                        checked={embeddingMode === 'local'}
                        disabled={!hasLocal}
                        onChange={() => {
                          const first = localConfigs[0]
                          const firstKey = first ? `local:${first.id}` : 'local'
                          setEmbeddingMode('local')
                          setEmbeddingForm((f) => ({
                            ...f,
                            provider: firstKey,
                            model: EMBEDDING_MODEL_DEFAULTS['local'] ?? 'bge-m3-4096',
                          }))
                          setEmbeddingCandidateResult(null)
                        }}
                        className="h-4 w-4 text-gray-600"
                      />
                      <div>
                        <p className="text-base font-medium text-gray-800">本機模型</p>
                        <p className="text-sm text-gray-400">地端 Ollama</p>
                      </div>
                    </label>

                    {/* 自訂 */}
                    <label className={`flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
                      embeddingMode === 'custom' ? 'border-gray-400 bg-gray-50' : 'border-gray-200 hover:border-gray-300'
                    }`}>
                      <input
                        type="radio"
                        name="embedding_mode"
                        checked={embeddingMode === 'custom'}
                        onChange={() => {
                          const firstCfg = nonLocalConfigs[0]
                          const firstKey = firstCfg
                            ? (firstCfg.provider === 'custom' ? `custom:${firstCfg.id}` : firstCfg.provider)
                            : 'openai'
                          setEmbeddingMode('custom')
                          setEmbeddingForm((f) => ({
                            ...f,
                            provider: firstKey,
                            model: EMBEDDING_MODEL_DEFAULTS[baseProvider(firstKey)] ?? '',
                          }))
                          setEmbeddingCandidateResult(null)
                        }}
                        className="h-4 w-4 text-gray-600"
                      />
                      <div>
                        <p className="text-base font-medium text-gray-800">自訂</p>
                        <p className="text-sm text-gray-400">OpenAI、Gemini 等</p>
                      </div>
                    </label>
                  </div>
                </Field>

                {/* 本機模式：選擇哪個 local config（多實例時顯示下拉） */}
                {embeddingMode === 'local' && localConfigs.length > 1 && (
                  <Field label="本機 Provider" required>
                    <select
                      value={embeddingForm.provider}
                      onChange={(e) => {
                        const key = e.target.value
                        setEmbeddingForm((f) => ({
                          ...f,
                          provider: key,
                          model: EMBEDDING_MODEL_DEFAULTS['local'] ?? 'bge-m3-4096',
                        }))
                        setEmbeddingCandidateResult(null)
                      }}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-gray-400 focus:outline-none"
                    >
                      {localConfigs.map((cfg) => (
                        <option key={`local:${cfg.id}`} value={`local:${cfg.id}`}>
                          {cfg.label || `本機 #${cfg.id}`}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}

                {/* 自訂模式：選擇 Provider（每個 config 獨立列出，支援多個自訂） */}
                {embeddingMode === 'custom' && (
                  <Field label="Provider" required>
                    {nonLocalConfigs.length === 0 ? (
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-base text-gray-500">
                        請先至「Provider 連線設定」新增並啟用至少一個非本機 Provider
                      </div>
                    ) : (
                      <select
                        value={embeddingForm.provider}
                        onChange={(e) => {
                          const key = e.target.value
                          setEmbeddingForm((f) => ({
                            ...f,
                            provider: key,
                            model: EMBEDDING_MODEL_DEFAULTS[baseProvider(key)] ?? '',
                          }))
                          setEmbeddingCandidateResult(null)
                        }}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-gray-400 focus:outline-none"
                      >
                        {nonLocalConfigs.map((cfg) => {
                          const key = cfg.provider === 'custom' ? `custom:${cfg.id}` : cfg.provider
                          const label = cfg.provider === 'custom'
                            ? (cfg.label ? `自訂・${cfg.label}` : `自訂 #${cfg.id}`)
                            : (PROVIDER_LABELS[cfg.provider] ?? cfg.provider)
                          return <option key={key} value={key}>{label}</option>
                        })}
                      </select>
                    )}
                  </Field>
                )}

                {/* Model 輸入 */}
                <Field label="Model" required>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={embeddingForm.model}
                      onChange={(e) => {
                        setEmbeddingForm((f) => ({ ...f, model: e.target.value }))
                        setEmbeddingCandidateResult(null)
                      }}
                      placeholder={`例：${defaultModelForProvider || 'text-embedding-3-small'}`}
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-base font-mono focus:border-gray-400 focus:outline-none"
                    />
                    <button
                      onClick={handleTestEmbeddingCandidate}
                      disabled={testingEmbeddingCandidate || !embeddingForm.model.trim()}
                      className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-base font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <Zap className={`h-4 w-4 ${testingEmbeddingCandidate ? 'animate-pulse text-amber-500' : ''}`} />
                      {testingEmbeddingCandidate ? '測試中...' : '測試連線'}
                    </button>
                  </div>
                  {defaultModelForProvider && (
                    <p className="mt-1.5 text-sm text-gray-500">
                      建議：<code className="text-gray-700">{defaultModelForProvider}</code>
                    </p>
                  )}
                </Field>

                {/* 測試結果顯示 */}
                {embeddingCandidateResult && (
                  <div className={`rounded-lg border p-3 text-base ${
                    embeddingCandidateResult.ok && !embeddingCandidateResult.dim_warning
                      ? 'border-green-200 bg-green-50'
                      : embeddingCandidateResult.ok
                        ? 'border-amber-200 bg-amber-50'
                        : 'border-red-200 bg-red-50'
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      {embeddingCandidateResult.ok && !embeddingCandidateResult.dim_warning ? (
                        <span className="text-green-700 font-semibold">✓ 測試成功</span>
                      ) : embeddingCandidateResult.ok ? (
                        <span className="text-amber-700 font-semibold">⚠ 連線成功但維度不符</span>
                      ) : (
                        <span className="text-red-700 font-semibold">✗ 測試失敗</span>
                      )}
                      <span className="text-gray-500 text-sm">({embeddingCandidateResult.elapsed_ms}ms)</span>
                    </div>
                    {embeddingCandidateResult.ok && embeddingCandidateResult.dimensions && (
                      <p className="text-sm text-gray-700">
                        維度：<code className="font-mono">{embeddingCandidateResult.dimensions}</code>
                        {embeddingCandidateResult.dimensions === 1024 ? (
                          <span className="text-green-600 ml-1">✓ 符合系統要求</span>
                        ) : (
                          <span className="text-red-600 ml-1">✗ 需為 1024 維</span>
                        )}
                      </p>
                    )}
                    {embeddingCandidateResult.dim_warning && (
                      <p className="text-sm text-amber-700 mt-1">{embeddingCandidateResult.dim_warning}</p>
                    )}
                    {embeddingCandidateResult.error && (
                      <p className="text-sm text-red-700 mt-1 break-all">{embeddingCandidateResult.error}</p>
                    )}
                  </div>
                )}

                {/* 1024 維警告與說明 */}
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-base text-amber-800">
                  <p className="font-semibold flex items-center gap-1.5 mb-1">
                    <AlertTriangle className="h-4 w-4" /> 重要限制
                  </p>
                  <p>系統使用 <strong>1024 維</strong>向量，請確保選用的 model 支援</p>
                  <p className="mt-1.5 text-sm text-amber-700">
                    例如：OpenAI text-embedding-3-small、Gemini text-embedding-004（可指定 dimensions）、本地 bge-m3-4096
                  </p>
                </div>

              </div>
              <ModalFooter
                onCancel={() => setShowEmbeddingForm(false)}
                onConfirm={handleSaveEmbedding}
                saving={savingEmbedding}
                confirmLabel="儲存"
                confirmDisabled={!embeddingCandidateResult?.ok || !!embeddingCandidateResult?.dim_warning}
              />
            </div>
          </div>
        )
      })()}

      {/* ── Modal：Embedding 遷移（全程不自動關閉） ── */}
      {showEmbeddingMigrateModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl h-[80vh] max-h-[90vh] rounded-xl bg-white shadow-2xl flex flex-col">

            <div className="shrink-0 px-6 pt-6 pb-3 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">Embedding Model 變更</h3>
              <p className="mt-1 text-sm text-gray-500">
                目前步驟：
                {embeddingMigrateStep === 'confirm' && '確認操作'}
                {embeddingMigrateStep === 'saving' && '儲存設定中...'}
                {embeddingMigrateStep === 'reindexing' && '重建索引中...'}
                {embeddingMigrateStep === 'done' && '已完成'}
                {embeddingMigrateStep === 'error' && '發生錯誤'}
              </p>
            </div>

            {embeddingMigrateStep === 'confirm' && (
              <div className="shrink-0 px-6 py-4 space-y-2 text-base text-gray-700">
                <p>此操作將：</p>
                <ul className="space-y-1 pl-4 list-disc text-sm">
                  <li>暫停所有 KB 查詢，直到重建完成</li>
                  <li>清空向量索引，使用新模型 <code className="rounded bg-gray-100 px-1 font-mono text-xs">{embeddingForm.model}</code> 重建</li>
                </ul>
              </div>
            )}

            <div className="flex-1 min-h-0 mx-6 my-3 overflow-y-auto rounded-lg bg-gray-950 p-4 font-mono text-sm space-y-1">
              {migrateLogs.length === 0 && embeddingMigrateStep === 'confirm' && (
                <p className="text-gray-500">按下「確認，開始重建」後，進度會顯示在這裡</p>
              )}
              {migrateLogs.map((log, i) => (
                <p key={i} className="text-gray-200">{log}</p>
              ))}
              {(embeddingMigrateStep === 'saving' || embeddingMigrateStep === 'reindexing') && (
                <p className="text-yellow-400 animate-pulse mt-2">● 處理中，請勿關閉此視窗...</p>
              )}
            </div>

            <div className="shrink-0 flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
              {embeddingMigrateStep === 'confirm' && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowEmbeddingMigrateModal(false)}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-base font-medium text-gray-700 hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => _doMigrateEmbedding(true)}
                    disabled={savingEmbedding}
                    className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-base font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {savingEmbedding ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    確認，開始重建
                  </button>
                </>
              )}
              {(embeddingMigrateStep === 'saving' || embeddingMigrateStep === 'reindexing') && (
                <button
                  type="button"
                  disabled
                  className="rounded-lg bg-gray-400 px-5 py-2 text-base font-medium text-white cursor-not-allowed opacity-60"
                >
                  處理中，請稍候...
                </button>
              )}
              {(embeddingMigrateStep === 'done' || embeddingMigrateStep === 'error') && (
                <button
                  type="button"
                  onClick={_closeEmbeddingMigrateModal}
                  className="rounded-lg bg-gray-800 px-5 py-2 text-base font-medium text-white hover:bg-gray-700"
                >
                  關閉
                </button>
              )}
            </div>

          </div>
        </div>
      )}

      {/* ── Modal：語音模型設定 ── */}
      {showSpeechForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
            <ModalHeader title="語音模型設定 (STT)" onClose={() => setShowSpeechForm(false)} />
            <div className="px-6 py-5 space-y-4">
              {(() => {
                const localConfigs = configs.filter((c) => c.is_active && c.provider === 'local')
                const nonLocalSpeechConfigs = configs.filter((c) => c.is_active && c.provider !== 'local')
                const hasLocal = localConfigs.length > 0
                return (
                  <>
                    {/* 語音服務選擇：本機 / 自訂 */}
                    <Field label="語音服務" required>
                      <div className="space-y-2">
                        {/* 本機模型 */}
                        <label className={`flex items-start gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${speechMode === 'local' ? 'border-gray-400 bg-gray-50' : 'border-gray-200 hover:border-gray-300'}`}>
                          <input
                            type="radio"
                            name="speech_mode"
                            checked={speechMode === 'local'}
                            onChange={() => {
                              setSpeechMode('local')
                              const savedBaseUrl = tenantConfig?.speech_base_url ?? ''
                              const first = localConfigs[0]
                              const firstKey = first ? `local:${first.id}` : 'local'
                              setSpeechForm((f) => ({
                                ...f,
                                provider: firstKey,
                                model: SPEECH_MODEL_DEFAULTS['local'],
                                base_url: savedBaseUrl,
                              }))
                              const prevProvider = tenantConfig?.speech_provider ?? ''
                              const preVerified = (prevProvider === 'local' || prevProvider.startsWith('local:')) && !!savedBaseUrl
                              setSpeechCandidateResult(preVerified ? { ok: true, elapsed_ms: 0 } : null)
                            }}
                            className="mt-1 h-4 w-4 text-gray-600"
                          />
                          <div className="flex-1 min-w-0 space-y-0.5">
                            <span className="rounded-full px-2.5 py-0.5 text-base font-semibold bg-purple-100 text-purple-800">本機模型 (Local)</span>
                            <p className="text-base text-gray-400 mt-1">地端 faster-whisper-server，預設端口 8002</p>
                          </div>
                        </label>
                        {/* 自訂 */}
                        <label className={`flex items-start gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${speechMode === 'custom' ? 'border-gray-400 bg-gray-50' : 'border-gray-200 hover:border-gray-300'}`}>
                          <input
                            type="radio"
                            name="speech_mode"
                            checked={speechMode === 'custom'}
                            onChange={() => {
                              setSpeechMode('custom')
                              const firstCfg = nonLocalSpeechConfigs[0]
                              const firstKey = firstCfg
                                ? (firstCfg.provider === 'custom' ? `custom:${firstCfg.id}` : firstCfg.provider)
                                : 'openai'
                              setSpeechForm((f) => ({
                                ...f,
                                provider: firstKey,
                                model: SPEECH_MODEL_DEFAULTS[baseProvider(firstKey)] ?? '',
                              }))
                              setSpeechCandidateResult(null)
                            }}
                            className="mt-1 h-4 w-4 text-gray-600"
                          />
                          <div className="flex-1 min-w-0 space-y-0.5">
                            <span className="rounded-full px-2.5 py-0.5 text-base font-semibold bg-gray-100 text-gray-700">自訂</span>
                            <p className="text-base text-gray-400 mt-1">使用已設定的 Provider（OpenAI Whisper、自訂 OpenAI 相容端點等）</p>
                          </div>
                        </label>
                      </div>
                    </Field>

                    {/* 本機模型：Base URL + 測試連線 */}
                    {speechMode === 'local' && (
                      <>
                        {/* 本機 Provider 下拉（多個 local config 時顯示） */}
                        {hasLocal && localConfigs.length > 1 && (
                          <Field label="本機 Provider" required>
                            <select
                              value={speechForm.provider}
                              onChange={(e) => {
                                setSpeechForm((f) => ({ ...f, provider: e.target.value }))
                                setSpeechCandidateResult(null)
                              }}
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-gray-400 focus:outline-none"
                            >
                              {localConfigs.map((cfg) => (
                                <option key={cfg.id} value={`local:${cfg.id}`}>
                                  {cfg.label || `本機 #${cfg.id}`}
                                </option>
                              ))}
                            </select>
                          </Field>
                        )}
                        <Field label="模型名稱" hint="">
                          <input
                            type="text"
                            placeholder="Systran/faster-whisper-medium"
                            value={speechForm.model}
                            onChange={(e) => setSpeechForm((f) => ({ ...f, model: e.target.value }))}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
                          />
                        </Field>
                        <Field label="Base URL" required hint="">
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="http://192.168.1.10:8002"
                              value={speechForm.base_url}
                              onChange={(e) => {
                                setSpeechForm((f) => ({ ...f, base_url: e.target.value }))
                                setSpeechCandidateResult(null)
                              }}
                              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-base font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
                            />
                            <button
                              onClick={handleTestSpeechCandidate}
                              disabled={testingSpeechCandidate || !speechForm.base_url.trim()}
                              className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-base font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              <Zap className={`h-4 w-4 ${testingSpeechCandidate ? 'animate-pulse text-amber-500' : ''}`} />
                              {testingSpeechCandidate ? '測試中...' : '測試連線'}
                            </button>
                          </div>
                          <div className="mt-1 space-y-0.5 text-base text-gray-400">
                            <p>設定成 whisper 服務位址，例：<code className="rounded bg-gray-100 px-1">http://192.168.1.10:8002</code></p>
                            <p>NeuroSme 與 Whisper 在同一台主機時請用：<code className="rounded bg-gray-100 px-1">http://host.docker.internal:8002</code></p>
                          </div>
                        </Field>
                        {/* 測試結果 */}
                        {speechCandidateResult && (
                          <div className={`rounded-lg border p-3 text-base ${speechCandidateResult.ok ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                            <div className="flex items-center gap-2">
                              {speechCandidateResult.ok ? (
                                <span className="text-green-700 font-semibold">✓ 連線成功</span>
                              ) : (
                                <span className="text-red-700 font-semibold">✗ 連線失敗</span>
                              )}
                              {speechCandidateResult.elapsed_ms != null && speechCandidateResult.elapsed_ms > 0 && (
                                <span className="text-gray-500 text-sm">({speechCandidateResult.elapsed_ms}ms)</span>
                              )}
                            </div>
                            {speechCandidateResult.error && (
                              <p className="text-sm text-red-700 mt-1 break-all">{speechCandidateResult.error}</p>
                            )}
                          </div>
                        )}
                      </>
                    )}

                    {/* 自訂：Provider 下拉 + 模型輸入 + 測試連線 */}
                    {speechMode === 'custom' && (
                      <>
                        <Field label="Provider" required>
                          {nonLocalSpeechConfigs.length === 0 ? (
                            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-base text-gray-500">
                              請先至「Provider 連線設定」新增並啟用至少一個非本機 Provider
                            </div>
                          ) : (
                            <select
                              value={speechForm.provider}
                              onChange={(e) => {
                                const key = e.target.value
                                setSpeechForm((f) => ({
                                  ...f,
                                  provider: key,
                                  model: SPEECH_MODEL_DEFAULTS[baseProvider(key)] ?? '',
                                }))
                                setSpeechCandidateResult(null)
                              }}
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-gray-400 focus:outline-none"
                            >
                              {nonLocalSpeechConfigs.map((cfg) => {
                                const key = cfg.provider === 'custom' ? `custom:${cfg.id}` : cfg.provider
                                const label = cfg.provider === 'custom'
                                  ? `自訂・${cfg.label || cfg.id}`
                                  : (PROVIDER_LABELS[cfg.provider] ?? cfg.provider)
                                return <option key={cfg.id} value={key}>{label}</option>
                              })}
                            </select>
                          )}
                        </Field>
                        <Field label="模型名稱" required hint="">
                          <input
                            type="text"
                            placeholder={SPEECH_MODEL_DEFAULTS[baseProvider(speechForm.provider)] || '例：whisper-1'}
                            value={speechForm.model}
                            onChange={(e) => setSpeechForm((f) => ({ ...f, model: e.target.value }))}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
                          />
                          <p className="mt-1 text-base text-gray-400">OpenAI Whisper：<code className="rounded bg-gray-100 px-1">whisper-1</code></p>
                        </Field>
                        {/* 測試連線按鈕 */}
                        {nonLocalSpeechConfigs.length > 0 && (
                          <div className="flex flex-col gap-2">
                            <button
                              onClick={handleTestSpeechCandidate}
                              disabled={testingSpeechCandidate}
                              className="flex items-center gap-1.5 self-start rounded-lg border border-gray-300 bg-white px-4 py-2 text-base font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              <Zap className={`h-4 w-4 ${testingSpeechCandidate ? 'animate-pulse text-amber-500' : ''}`} />
                              {testingSpeechCandidate ? '測試中...' : '測試連線'}
                            </button>
                            {speechCandidateResult && (
                              <div className={`rounded-lg border p-3 text-base ${speechCandidateResult.ok ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                                <div className="flex items-center gap-2">
                                  {speechCandidateResult.ok ? (
                                    <span className="text-green-700 font-semibold">✓ 連線成功</span>
                                  ) : (
                                    <span className="text-red-700 font-semibold">✗ 連線失敗</span>
                                  )}
                                  {speechCandidateResult.elapsed_ms != null && speechCandidateResult.elapsed_ms > 0 && (
                                    <span className="text-gray-500 text-sm">({speechCandidateResult.elapsed_ms}ms)</span>
                                  )}
                                </div>
                                {speechCandidateResult.error && (
                                  <p className="text-sm text-red-700 mt-1 break-all">{speechCandidateResult.error}</p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </>
                )
              })()}
            </div>
            <ModalFooter
              onCancel={() => setShowSpeechForm(false)}
              onConfirm={handleSaveSpeech}
              saving={savingSpeech}
              confirmLabel="儲存"
              confirmDisabled={speechMode === 'local' && !speechCandidateResult?.ok}
            />
          </div>
        </div>
      )}

      {/* ── Confirm：停用語音功能 ── */}
      <ConfirmModal
        open={showDisableSpeechConfirm}
        title="停用語音功能"
        message="確定要停用語音功能？停用後使用者將無法使用語音輸入，可隨時重新設定啟用。"
        confirmText={disablingSpeech ? '停用中...' : '確認停用'}
        variant="danger"
        onConfirm={() => void handleDisableSpeech()}
        onCancel={() => setShowDisableSpeechConfirm(false)}
      />

      {/* ── Modal：刪除確認 ── */}
      {deleteTarget !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl p-6 space-y-4">
            <h3 className="text-lg font-semibold text-gray-800">確認刪除？</h3>
            <p className="text-base text-gray-500">刪除後此 Provider 的 API Key 將無法復原。</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteTarget(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-base text-gray-600 hover:bg-gray-50">取消</button>
              <button onClick={() => void handleDelete(deleteTarget)} className="rounded-lg bg-red-600 px-4 py-2 text-base font-medium text-white hover:bg-red-500">確認刪除</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal：測試結果 ── */}
      {testResultModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
            <ModalHeader title="測試結果" onClose={() => setTestResultModal(null)} />
            <div className="px-6 py-5 space-y-4">
              <p className="font-mono text-base text-gray-600 break-all">{testResultModal.model}</p>
              <div className={`rounded-lg border px-5 py-4 space-y-2 ${testResultModal.result.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
                <div className="flex items-center gap-3 text-lg font-semibold">
                  <span>{testResultModal.result.ok ? '✅ 連通成功' : '❌ 連通失敗'}</span>
                  {testResultModal.result.elapsed_ms > 0 && (
                    <span className="text-base font-normal opacity-70">{testResultModal.result.elapsed_ms} ms</span>
                  )}
                </div>
                {testResultModal.result.reply && (
                  <div className="text-base">
                    模型回覆：<span className="font-mono">{testResultModal.result.reply}</span>
                  </div>
                )}
                {testResultModal.result.error && (
                  <div className="text-base font-mono break-all">{testResultModal.result.error}</div>
                )}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setTestResultModal(null)}
                className="rounded-lg bg-gray-700 px-5 py-2 text-base font-medium text-white hover:bg-gray-600 transition-colors"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}



      {/* ── Modal：參考設定 ── */}
      {showRefModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl">
            <ModalHeader title="參考設定（僅供參考）" onClose={() => setShowRefModal(false)} />
            <div className="px-6 py-5 space-y-2">
              <p className="text-base text-gray-500 mb-3">以下為 {form.provider} 常用 Model ID，可手動複製填入：</p>
              <ul className="space-y-1.5">
                {defaultModelsForProvider.map((m) => (
                  <li key={m} className="font-mono text-base text-gray-800 bg-gray-50 rounded-lg px-3 py-2 select-all">{m}</li>
                ))}
              </ul>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setShowRefModal(false)}
                className="rounded-lg bg-gray-700 px-5 py-2 text-base font-medium text-white hover:bg-gray-600 transition-colors"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Online Help：模型選型指南 ── */}
      <HelpModal
        open={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        url="/help-llm-settings.md"
        title="AI 模型選型指南"
      />
      <HelpModal
        open={showBackupHelpModal}
        onClose={() => setShowBackupHelpModal(false)}
        url="/help-backup-strategy.md"
        title="備份策略"
      />
    </div>
  )
}

// ── Shared UI helpers ─────────────────────────────────────────────────────────

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="w-32 shrink-0 text-gray-500 text-base">{label}</span>
      <span className={`text-gray-800 break-all text-base ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-base font-medium text-gray-700">
        {label}{required && <span className="ml-1 text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-base text-gray-400">{hint}</p>}
    </div>
  )
}

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
      <h3 className="text-base font-semibold text-gray-800">{title}</h3>
      <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
    </div>
  )
}

function ModalFooter({
  onCancel, onConfirm, saving, confirmLabel = '儲存', confirmDanger = false, confirmDisabled = false,
}: {
  onCancel: () => void
  onConfirm: () => void
  saving: boolean
  confirmLabel?: string
  confirmDanger?: boolean
  confirmDisabled?: boolean
}) {
  return (
    <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
      <button onClick={onCancel} className="rounded-lg border border-gray-300 px-4 py-2 text-base text-gray-600 hover:bg-gray-50 transition-colors">取消</button>
      <button
        onClick={onConfirm}
        disabled={saving || confirmDisabled}
        className={`rounded-lg px-4 py-2 text-base font-medium text-white disabled:opacity-50 transition-colors ${confirmDanger ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700 hover:bg-gray-600'}`}
      >
        {saving ? '處理中...' : confirmLabel}
      </button>
    </div>
  )
}
