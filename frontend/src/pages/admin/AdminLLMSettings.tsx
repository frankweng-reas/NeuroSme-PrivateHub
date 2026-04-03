/** Admin：租戶 LLM 設定（admin / super_admin） */
import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Pencil, Plus, Trash2, ChevronDown, ChevronUp, Eye, EyeOff, Zap } from 'lucide-react'
import {
  createLLMConfig,
  deleteLLMConfig,
  getLLMProviderOptions,
  listLLMConfigs,
  testLLMConfig,
  updateLLMConfig,
} from '@/api/llmConfigs'
import type { LLMProviderConfigCreate, LLMProviderConfigUpdate, LLMTestResult } from '@/api/llmConfigs'
import { getMe } from '@/api/users'
import { ApiError } from '@/api/client'
import { useToast } from '@/contexts/ToastContext'
import type { LLMProviderConfig } from '@/types'

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  twcc: '台智雲 TWCC',
}

const PROVIDER_COLORS: Record<string, string> = {
  openai: 'bg-green-100 text-green-800',
  gemini: 'bg-blue-100 text-blue-800',
  twcc: 'bg-orange-100 text-orange-800',
}

interface FormState {
  provider: string
  label: string
  api_key: string
  api_base_url: string
  default_model: string
  available_models_text: string
  is_active: boolean
}

const EMPTY_FORM: FormState = {
  provider: 'openai',
  label: '',
  api_key: '',
  api_base_url: '',
  default_model: '',
  available_models_text: '',
  is_active: true,
}

export default function AdminLLMSettings() {
  const { showToast } = useToast()
  const [configs, setConfigs] = useState<LLMProviderConfig[]>([])
  const [providerOptions, setProviderOptions] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 表單
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)

  // 展開/收合各筆設定
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  // 刪除確認
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null)

  // 測試連通
  const [testingId, setTestingId] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<Record<number, LLMTestResult>>({})
  const [currentTenantId, setCurrentTenantId] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    Promise.all([listLLMConfigs(), getLLMProviderOptions(), getMe()])
      .then(([cfgs, opts, me]) => {
        const tid = (me.tenant_id ?? '').trim()
        setCurrentTenantId(tid || null)
        const raw = Array.isArray(cfgs) ? cfgs : []
        // 後端已依 tenant 過濾；前端再比對 tenant_id，避免誤顯其他租戶列
        const scoped = tid ? raw.filter((c) => (c.tenant_id ?? '').trim() === tid) : raw
        setConfigs(scoped)
        setProviderOptions(opts && typeof opts === 'object' ? opts : {})
      })
      .catch((err) => {
        setError(
          err instanceof ApiError && err.status === 403
            ? err.detail ?? '需 admin 或 super_admin 權限'
            : err instanceof ApiError && err.detail
              ? err.detail
              : '無法載入 LLM 設定'
        )
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

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
      api_base_url: cfg.api_base_url ?? '',
      default_model: cfg.default_model ?? '',
      available_models_text: (cfg.available_models ?? []).join('\n'),
      is_active: cfg.is_active,
    })
    setShowApiKey(false)
    setShowForm(true)
  }

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSave() {
    if (!form.provider) {
      showToast('請選擇 Provider', 'error')
      return
    }
    setSaving(true)
    try {
      const availableModels = form.available_models_text
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)

      if (editingId !== null) {
        const body: LLMProviderConfigUpdate = {
          label: form.label || null,
          api_base_url: form.api_base_url || null,
          default_model: form.default_model || null,
          available_models: availableModels.length > 0 ? availableModels : null,
          is_active: form.is_active,
        }
        if (form.api_key.trim()) {
          body.api_key = form.api_key.trim()
        }
        await updateLLMConfig(editingId, body)
        showToast('LLM 設定已更新', 'success')
      } else {
        const body: LLMProviderConfigCreate = {
          provider: form.provider,
          label: form.label || null,
          api_key: form.api_key.trim() || null,
          api_base_url: form.api_base_url || null,
          default_model: form.default_model || null,
          available_models: availableModels.length > 0 ? availableModels : null,
          is_active: form.is_active,
        }
        await createLLMConfig(body)
        showToast('LLM 設定已新增', 'success')
      }
      setShowForm(false)
      load()
    } catch (err) {
      const msg = err instanceof ApiError ? (err.detail ?? err.message) : '儲存失敗'
      showToast(msg, 'error')
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
      const msg = err instanceof ApiError ? (err.detail ?? err.message) : '刪除失敗'
      showToast(msg, 'error')
    }
  }

  async function handleTest(id: number) {
    setTestingId(id)
    setTestResults((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    try {
      const result = await testLLMConfig(id)
      setTestResults((prev) => ({ ...prev, [id]: result }))
      if (!expandedIds.has(id)) {
        setExpandedIds((prev) => new Set([...prev, id]))
      }
    } catch (err) {
      const msg = err instanceof ApiError ? (err.detail ?? err.message) : '測試失敗'
      setTestResults((prev) => ({ ...prev, [id]: { ok: false, elapsed_ms: 0, error: msg } }))
    } finally {
      setTestingId(null)
    }
  }

  const defaultModelsForProvider = providerOptions[form.provider] ?? []

  return (
    <div className="space-y-6 text-lg">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <KeyRound className="h-6 w-6 text-gray-600" />
          <div>
            <h2 className="text-xl font-bold text-gray-800">LLM 設定（租戶）</h2>
            {currentTenantId ? (
              <p className="text-lg text-gray-500 mt-0.5">
                <span className="text-gray-600">
                  目前租戶 ID：<code className="rounded bg-gray-100 px-1.5 py-0.5">{currentTenantId}</code>
                </span>
              </p>
            ) : null}
          </div>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-gray-700 px-4 py-2 text-lg font-medium text-white hover:bg-gray-600 transition-colors"
        >
          <Plus className="h-4 w-4" />
          新增設定
        </button>
      </div>

      {/* 說明卡片 */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-lg text-amber-800">
        Key 會加密後存入資料庫。正式環境請由維運設定伺服端加密金鑰。
      </div>

      {/* 錯誤 */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-lg text-red-700">
          {error}
        </div>
      )}

      {/* 載入中 */}
      {loading && (
        <div className="text-center py-8 text-gray-400 text-lg">載入中...</div>
      )}

      {/* 設定列表 */}
      {!loading && !error && (
        <div className="space-y-3">
          {configs.length === 0 && (
            <div className="rounded-lg border-2 border-dashed border-gray-200 py-12 text-center text-gray-400 text-lg">
              <KeyRound className="mx-auto h-10 w-10 mb-3 opacity-30" />
              <p>尚無 LLM 設定</p>
              <p className="text-lg mt-1">點擊「新增設定」加入 OpenAI / Gemini / 台智雲的 API Key</p>
            </div>
          )}

          {configs.map((cfg) => {
            const isExpanded = expandedIds.has(cfg.id)
            const colorClass = PROVIDER_COLORS[cfg.provider] ?? 'bg-gray-100 text-gray-800'
            return (
              <div
                key={cfg.id}
                className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden"
              >
                {/* 主列 */}
                <div className="flex items-center justify-between px-5 py-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-lg font-semibold ${colorClass}`}>
                      {PROVIDER_LABELS[cfg.provider] ?? cfg.provider}
                    </span>
                    <span className="font-medium text-gray-800 truncate text-lg">
                      {cfg.label || `${PROVIDER_LABELS[cfg.provider] ?? cfg.provider} 設定`}
                    </span>
                    {!cfg.is_active && (
                      <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-lg text-gray-500">
                        停用
                      </span>
                    )}
                    {cfg.api_key_masked && (
                      <span className="shrink-0 rounded bg-gray-50 border border-gray-200 px-2 py-0.5 font-mono text-lg text-gray-500">
                        {cfg.api_key_masked}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleTest(cfg.id)}
                      disabled={testingId === cfg.id}
                      className="flex items-center gap-1 rounded px-2 py-1.5 text-lg font-medium text-gray-500 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-50 transition-colors"
                      title="測試連通"
                    >
                      <Zap className={`h-3.5 w-3.5 ${testingId === cfg.id ? 'animate-pulse' : ''}`} />
                      {testingId === cfg.id ? '測試中...' : '測試'}
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

                {/* 展開詳情 */}
                {isExpanded && (
                  <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 space-y-2 text-lg">
                    <Row label="租戶 ID" value={cfg.tenant_id} mono />
                    <Row label="Provider" value={cfg.provider} />
                    <Row label="預設 Model" value={cfg.default_model ?? '（未設定）'} />
                    {cfg.api_base_url && <Row label="API Base URL" value={cfg.api_base_url} mono />}
                    {cfg.available_models && cfg.available_models.length > 0 && (
                      <div className="flex gap-2">
                        <span className="w-32 shrink-0 text-gray-500 text-lg">可選 Models</span>
                        <div className="flex flex-wrap gap-1">
                          {cfg.available_models.map((m) => (
                            <span key={m} className="rounded bg-white border border-gray-200 px-2 py-0.5 font-mono text-lg text-gray-600">
                              {m}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* 測試結果 */}
                    {testResults[cfg.id] && (
                      <div className={`mt-2 rounded-lg border px-4 py-3 text-lg ${
                        testResults[cfg.id].ok
                          ? 'border-green-200 bg-green-50 text-green-800'
                          : 'border-red-200 bg-red-50 text-red-800'
                      }`}>
                        <div className="flex items-center gap-2 font-semibold">
                          <span>{testResults[cfg.id].ok ? '✅ 連通成功' : '❌ 連通失敗'}</span>
                          {testResults[cfg.id].elapsed_ms > 0 && (
                            <span className="text-lg font-normal opacity-70">
                              {testResults[cfg.id].elapsed_ms} ms
                            </span>
                          )}
                        </div>
                        {testResults[cfg.id].reply && (
                          <div className="mt-1 text-lg opacity-80">
                            模型回覆：<span className="font-mono">{testResults[cfg.id].reply}</span>
                          </div>
                        )}
                        {testResults[cfg.id].error && (
                          <div className="mt-1 text-lg font-mono break-all opacity-90">
                            {testResults[cfg.id].error}
                          </div>
                        )}
                      </div>
                    )}
                    <Row label="建立時間" value={new Date(cfg.created_at).toLocaleString('zh-TW')} />
                    <Row label="更新時間" value={new Date(cfg.updated_at).toLocaleString('zh-TW')} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 新增/編輯 表單 Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-800">
                {editingId !== null ? '編輯 LLM 設定' : '新增 LLM 設定'}
              </h3>
              <button
                onClick={() => setShowForm(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {/* Provider */}
              <Field label="Provider" required>
                <select
                  disabled={editingId !== null}
                  value={form.provider}
                  onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value, default_model: '', available_models_text: '' }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-lg focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:bg-gray-50"
                >
                  <option value="openai">OpenAI</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="twcc">台智雲 TWCC</option>
                </select>
              </Field>

              {/* Label */}
              <Field label="顯示名稱">
                <input
                  type="text"
                  placeholder="例：OpenAI（公司帳號）"
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-lg focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              </Field>

              {/* API Key */}
              <Field label={editingId !== null ? 'API Key（留空表示不變更）' : 'API Key'}>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    placeholder={editingId !== null ? '不填則保留原 Key' : 'sk-...'}
                    value={form.api_key}
                    onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    tabIndex={-1}
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>

              {/* API Base URL */}
              <Field
                label="API Base URL"
                required={form.provider === 'twcc'}
                hint={
                  form.provider === 'twcc'
                    ? '台智雲必填，例：https://api-ams.twcc.ai/api/models/conversation'
                    : '選填，用於 Azure OpenAI 或 OpenAI-compatible Proxy'
                }
              >
                <input
                  type="text"
                  placeholder={
                    form.provider === 'twcc'
                      ? 'https://api-ams.twcc.ai/api/models/conversation'
                      : 'https://your-proxy.example.com/v1'
                  }
                  value={form.api_base_url}
                  onChange={(e) => setForm((f) => ({ ...f, api_base_url: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              </Field>

              {/* Default Model */}
              <Field label="預設 Model">
                <div className="space-y-1.5">
                  <input
                    type="text"
                    placeholder="例：gpt-4o-mini"
                    value={form.default_model}
                    onChange={(e) => setForm((f) => ({ ...f, default_model: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
                  />
                  {defaultModelsForProvider.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {defaultModelsForProvider.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, default_model: m }))}
                          className="rounded bg-gray-100 px-2 py-0.5 text-lg text-gray-600 hover:bg-gray-200 transition-colors"
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </Field>

              {/* Available Models */}
              <Field label="可選 Models（每行一個）">
                <textarea
                  rows={4}
                  placeholder={defaultModelsForProvider.join('\n') || '每行一個 model id'}
                  value={form.available_models_text}
                  onChange={(e) => setForm((f) => ({ ...f, available_models_text: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-gray-400 resize-none"
                />
                {defaultModelsForProvider.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        available_models_text: defaultModelsForProvider.join('\n'),
                      }))
                    }
                    className="text-lg text-blue-600 hover:underline mt-1"
                  >
                    使用預設清單
                  </button>
                )}
              </Field>

              {/* Is Active */}
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={form.is_active}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                  className="h-4 w-4 rounded border-gray-300 text-gray-700"
                />
                <label htmlFor="is_active" className="text-lg text-gray-700">
                  啟用此設定（停用後 chat 將 fallback 至環境變數）
                </label>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-lg text-gray-600 hover:bg-gray-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-gray-700 px-4 py-2 text-lg font-medium text-white hover:bg-gray-600 disabled:opacity-50 transition-colors"
              >
                {saving ? '儲存中...' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 刪除確認 Modal */}
      {deleteTarget !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl p-6 space-y-4">
            <h3 className="text-lg font-semibold text-gray-800">確認刪除？</h3>
            <p className="text-lg text-gray-500">刪除後此 Provider 的 API Key 將無法復原，系統將 fallback 至環境變數。</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-lg text-gray-600 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={() => handleDelete(deleteTarget)}
                className="rounded-lg bg-red-600 px-4 py-2 text-lg font-medium text-white hover:bg-red-500"
              >
                確認刪除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="w-32 shrink-0 text-gray-500 text-lg">{label}</span>
      <span className={`text-gray-800 break-all text-lg ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1.5 block text-lg font-medium text-gray-700">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-lg text-gray-400">{hint}</p>}
    </div>
  )
}
