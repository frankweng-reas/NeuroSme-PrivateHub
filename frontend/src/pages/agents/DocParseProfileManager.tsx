/**
 * Parse Profile 管理 Modal
 * - 列出所有 profile
 * - 新增 / 編輯（結構化表單：sections + fields）
 * - 刪除（軟刪）
 */
import { useEffect, useState } from 'react'
import {
  ChevronDown, ChevronRight, Copy, Loader2, Plus, Save, Trash2, X,
} from 'lucide-react'
import { TOKEN_KEY } from '@/contexts/AuthContext'

const API_BASE = '/api/v1'
const FIELD_TYPES = ['text', 'text_list', 'currency', 'datetime', 'doc_list'] as const
type FieldType = typeof FIELD_TYPES[number]

// ── 型別 ───────────────────────────────────────────────────────────────────────
interface ProfileField {
  key: string
  label: string
  type: FieldType
  hint: string
}

interface ProfileSection {
  id: string
  label: string
  fields: ProfileField[]
}

interface ProfileDefinition {
  sections: ProfileSection[]
}

interface ProfileRow {
  id: string   // profile_id
  name: string
}

interface ProfileDetail {
  id: string
  name: string
  definition: ProfileDefinition
}

// ── API helpers ────────────────────────────────────────────────────────────────
function authHeader() {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeader(), ...(init?.headers ?? {}) } as HeadersInit,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string }
    throw new Error(body.detail ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

// ── 空白初始值 ─────────────────────────────────────────────────────────────────
function emptyProfile(): ProfileDetail {
  return { id: '', name: '', definition: { sections: [] } }
}
function emptySection(): ProfileSection {
  return { id: '', label: '', fields: [] }
}
function emptyField(): ProfileField {
  return { key: '', label: '', type: 'text', hint: '' }
}

// ── Props ──────────────────────────────────────────────────────────────────────
interface Props {
  onClose: () => void
  onSaved: () => void  // 儲存後通知父層刷新下拉
}

// ══════════════════════════════════════════════════════════════════════════════
export default function DocParseProfileManager({ onClose, onSaved }: Props) {
  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<ProfileDetail | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 展開狀態（section id → boolean）
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  // 每個 section 的新欄位草稿
  const [newFieldDraft, setNewFieldDraft] = useState<Record<string, ProfileField>>({})
  // 新 section 草稿
  const [newSection, setNewSection] = useState<ProfileSection | null>(null)

  // ── 載入清單 ─────────────────────────────────────────────────────────────────
  async function loadProfiles() {
    setLoading(true)
    try {
      const rows = await apiFetch<ProfileRow[]>('/document-parse/profiles')
      setProfiles(rows)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadProfiles() }, [])

  // ── 選取 profile → 載入詳情 ──────────────────────────────────────────────────
  async function selectProfile(id: string) {
    setError(null)
    setIsNew(false)
    setNewSection(null)
    try {
      const detail = await apiFetch<ProfileDetail>(`/document-parse/profiles/${id}`)
      setEditing(detail)
      setSelectedId(id)
      const exp: Record<string, boolean> = {}
      detail.definition.sections.forEach((s) => { exp[s.id] = true })
      setExpanded(exp)
    } catch (e) {
      setError(String(e))
    }
  }

  // ── 新增空白 profile ──────────────────────────────────────────────────────────
  function startNew() {
    setEditing(emptyProfile())
    setSelectedId(null)
    setIsNew(true)
    setExpanded({})
    setNewSection(null)
    setError(null)
  }

  // ── 複製現有 profile（直接建立，不需手動儲存）────────────────────────────────
  async function duplicateProfile(e: React.MouseEvent, id: string, name: string) {
    e.stopPropagation()
    setError(null)
    try {
      const detail = await apiFetch<ProfileDetail>(`/document-parse/profiles/${id}`)
      // 自動產生不重複的新 ID：原 ID 加上 timestamp 後綴
      const newId = `${id}-copy-${Date.now().toString(36)}`
      const newName = `${name}（副本）`
      const body = { profile_id: newId, profile_name: newName, definition: detail.definition }
      const created = await apiFetch<ProfileDetail>('/document-parse/profiles', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      await loadProfiles()
      onSaved()
      // 直接開啟新建立的 profile 供用戶修改名稱／ID
      const exp: Record<string, boolean> = {}
      created.definition.sections.forEach((s) => { exp[s.id] = true })
      setEditing(created)
      setSelectedId(created.id)
      setIsNew(false)
      setExpanded(exp)
      setNewSection(null)
    } catch (err) {
      setError(String(err))
    }
  }

  // ── 儲存 ─────────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!editing) return
    if (!editing.id.trim()) { setError('請填寫 Profile ID'); return }
    if (!editing.name.trim()) { setError('請填寫 Profile 名稱'); return }

    setSaving(true)
    setError(null)
    try {
      const body = { profile_id: editing.id, profile_name: editing.name, definition: editing.definition }
      if (isNew) {
        await apiFetch<ProfileDetail>('/document-parse/profiles', { method: 'POST', body: JSON.stringify(body) })
      } else {
        await apiFetch<ProfileDetail>(`/document-parse/profiles/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) })
      }
      await loadProfiles()
      setIsNew(false)
      setSelectedId(editing.id)
      onSaved()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  // ── 刪除 ─────────────────────────────────────────────────────────────────────
  async function handleDelete(id: string) {
    if (!confirm(`確定刪除「${id}」？`)) return
    setDeleting(id)
    try {
      await apiFetch(`/document-parse/profiles/${id}`, { method: 'DELETE' })
      await loadProfiles()
      if (selectedId === id) { setEditing(null); setSelectedId(null) }
      onSaved()
    } catch (e) {
      setError(String(e))
    } finally {
      setDeleting(null)
    }
  }

  // ── Section helpers ───────────────────────────────────────────────────────────
  function updateSection(sIdx: number, patch: Partial<ProfileSection>) {
    if (!editing) return
    const sections = editing.definition.sections.map((s, i) => i === sIdx ? { ...s, ...patch } : s)
    setEditing({ ...editing, definition: { sections } })
  }
  function removeSection(sIdx: number) {
    if (!editing) return
    const sections = editing.definition.sections.filter((_, i) => i !== sIdx)
    setEditing({ ...editing, definition: { sections } })
  }
  function commitNewSection() {
    if (!newSection || !newSection.id.trim() || !newSection.label.trim()) { setError('區段 ID 和名稱為必填'); return }
    if (!editing) return
    const sections = [...editing.definition.sections, { ...newSection, fields: [] }]
    setEditing({ ...editing, definition: { sections } })
    setExpanded((prev) => ({ ...prev, [newSection.id]: true }))
    setNewSection(null)
  }

  // ── Field helpers ─────────────────────────────────────────────────────────────
  function updateField(sIdx: number, fIdx: number, patch: Partial<ProfileField>) {
    if (!editing) return
    const sections = editing.definition.sections.map((s, i) => {
      if (i !== sIdx) return s
      return { ...s, fields: s.fields.map((f, j) => j === fIdx ? { ...f, ...patch } : f) }
    })
    setEditing({ ...editing, definition: { sections } })
  }
  function removeField(sIdx: number, fIdx: number) {
    if (!editing) return
    const sections = editing.definition.sections.map((s, i) =>
      i === sIdx ? { ...s, fields: s.fields.filter((_, j) => j !== fIdx) } : s
    )
    setEditing({ ...editing, definition: { sections } })
  }
  function commitNewField(sIdx: number, secId: string) {
    const draft = newFieldDraft[secId] ?? emptyField()
    if (!draft.key.trim() || !draft.label.trim()) { setError('欄位 key 和名稱為必填'); return }
    if (!editing) return
    const sections = editing.definition.sections.map((s, i) =>
      i === sIdx ? { ...s, fields: [...s.fields, { ...draft }] } : s
    )
    setEditing({ ...editing, definition: { sections } })
    setNewFieldDraft((prev) => ({ ...prev, [secId]: emptyField() }))
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative z-10 flex h-[90vh] w-[95vw] max-w-7xl overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── 左側：Profile 清單 ─────────────────────────────────────────────── */}
        <div className="flex w-80 shrink-0 flex-col border-r border-gray-100 bg-gray-50">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <span className="text-base font-semibold text-gray-700">Parse Profile</span>
            <button type="button" onClick={onClose} className="rounded p-0.5 text-gray-400 hover:bg-gray-200">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {loading ? (
              <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-gray-400" /></div>
            ) : profiles.map((p) => (
              <div
                key={p.id}
                className={`flex cursor-pointer items-center justify-between gap-1 px-3 py-2 text-sm transition-colors ${selectedId === p.id ? 'bg-sky-50 text-sky-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
                onClick={() => void selectProfile(p.id)}
              >
                <span className="min-w-0 truncate">{p.name}</span>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={(e) => void duplicateProfile(e, p.id, p.name)}
                    title="複製此 Profile"
                    className="rounded p-0.5 text-gray-400 hover:bg-sky-100 hover:text-sky-600"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void handleDelete(p.id) }}
                    disabled={deleting === p.id}
                    title="刪除"
                    className="rounded p-0.5 text-gray-400 hover:bg-red-100 hover:text-red-600 disabled:opacity-50"
                  >
                    {deleting === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-100 p-3">
            <button
              type="button"
              onClick={startNew}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-sky-500 py-2 text-sm font-medium text-white hover:bg-sky-600"
            >
              <Plus className="h-3.5 w-3.5" />新增 Profile
            </button>
          </div>
        </div>

        {/* ── 右側：編輯區 ───────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {!editing ? (
            <div className="flex flex-1 items-center justify-center text-gray-400">← 選擇或新增 Profile</div>
          ) : (
            <>
              {/* 標頭 */}
              <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-6 py-3">
                <span className="text-base font-semibold text-gray-800">
                  {isNew ? '新增 Profile' : `編輯：${editing.name}`}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={saving}
                    className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    儲存
                  </button>
                </div>
              </div>

              {error && (
                <div className="mx-6 mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
              )}

              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                {/* 基本欄位 */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-500">Profile ID（英數 -_）</label>
                    <input
                      value={editing.id}
                      onChange={(e) => setEditing({ ...editing, id: e.target.value })}
                      disabled={!isNew}
                      placeholder="tender-gov-tw"
                      className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-sky-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-500">Profile 名稱</label>
                    <input
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      placeholder="標案解析（政府採購）"
                      className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-sky-400 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Sections */}
                {editing.definition.sections.map((section, sIdx) => (
                  <div key={section.id || sIdx} className="rounded-xl border border-gray-200 overflow-hidden">
                    {/* Section 標題列 */}
                    <div
                      className="flex cursor-pointer items-center justify-between bg-gray-50 px-4 py-2"
                      onClick={() => setExpanded((prev) => ({ ...prev, [section.id]: !prev[section.id] }))}
                    >
                      <div className="flex items-center gap-2">
                        {expanded[section.id]
                          ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                          : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
                        <input
                          value={section.label}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updateSection(sIdx, { label: e.target.value })}
                          placeholder="區段名稱"
                          className="rounded border border-transparent bg-transparent px-1 text-sm font-medium text-gray-700 hover:border-gray-300 focus:border-sky-400 focus:outline-none"
                        />
                        <span className="text-xs text-gray-400">id: {section.id}</span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeSection(sIdx) }}
                        className="rounded p-0.5 text-gray-400 hover:bg-red-100 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {expanded[section.id] && (
                      <div className="divide-y divide-gray-50">
                        {/* 欄位列表 */}
                        {section.fields.map((field, fIdx) => (
                          <div key={field.key || fIdx} className="grid grid-cols-[120px_100px_80px_1fr_28px] items-center gap-2 px-4 py-2">
                            <input
                              value={field.key}
                              onChange={(e) => updateField(sIdx, fIdx, { key: e.target.value })}
                              placeholder="key"
                              className="rounded border border-gray-200 px-2 py-1 text-xs font-mono focus:border-sky-400 focus:outline-none"
                            />
                            <input
                              value={field.label}
                              onChange={(e) => updateField(sIdx, fIdx, { label: e.target.value })}
                              placeholder="名稱"
                              className="rounded border border-gray-200 px-2 py-1 text-xs focus:border-sky-400 focus:outline-none"
                            />
                            <select
                              value={field.type}
                              onChange={(e) => updateField(sIdx, fIdx, { type: e.target.value as FieldType })}
                              className="rounded border border-gray-200 px-1 py-1 text-xs focus:border-sky-400 focus:outline-none"
                            >
                              {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <input
                              value={field.hint}
                              onChange={(e) => updateField(sIdx, fIdx, { hint: e.target.value })}
                              placeholder="提示語（給 LLM 看）"
                              className="rounded border border-gray-200 px-2 py-1 text-xs focus:border-sky-400 focus:outline-none"
                            />
                            <button type="button" onClick={() => removeField(sIdx, fIdx)} className="rounded p-0.5 text-gray-300 hover:text-red-500">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}

                        {/* 新增欄位列 */}
                        <div className="grid grid-cols-[120px_100px_80px_1fr_28px] items-center gap-2 bg-gray-50 px-4 py-2">
                          <input
                            value={(newFieldDraft[section.id] ?? emptyField()).key}
                            onChange={(e) => setNewFieldDraft((p) => ({ ...p, [section.id]: { ...(p[section.id] ?? emptyField()), key: e.target.value } }))}
                            placeholder="key"
                            className="rounded border border-dashed border-gray-300 px-2 py-1 text-xs font-mono focus:border-sky-400 focus:outline-none"
                          />
                          <input
                            value={(newFieldDraft[section.id] ?? emptyField()).label}
                            onChange={(e) => setNewFieldDraft((p) => ({ ...p, [section.id]: { ...(p[section.id] ?? emptyField()), label: e.target.value } }))}
                            placeholder="名稱"
                            className="rounded border border-dashed border-gray-300 px-2 py-1 text-xs focus:border-sky-400 focus:outline-none"
                          />
                          <select
                            value={(newFieldDraft[section.id] ?? emptyField()).type}
                            onChange={(e) => setNewFieldDraft((p) => ({ ...p, [section.id]: { ...(p[section.id] ?? emptyField()), type: e.target.value as FieldType } }))}
                            className="rounded border border-dashed border-gray-300 px-1 py-1 text-xs focus:border-sky-400 focus:outline-none"
                          >
                            {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                          <input
                            value={(newFieldDraft[section.id] ?? emptyField()).hint}
                            onChange={(e) => setNewFieldDraft((p) => ({ ...p, [section.id]: { ...(p[section.id] ?? emptyField()), hint: e.target.value } }))}
                            placeholder="提示語"
                            className="rounded border border-dashed border-gray-300 px-2 py-1 text-xs focus:border-sky-400 focus:outline-none"
                          />
                          <button type="button" onClick={() => commitNewField(sIdx, section.id)} className="rounded p-0.5 text-sky-500 hover:text-sky-700">
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* 新增 Section 表單 */}
                {newSection ? (
                  <div className="rounded-xl border border-dashed border-sky-300 bg-sky-50 p-3">
                    <p className="mb-2 text-xs font-medium text-sky-600">新增區段</p>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <input
                        value={newSection.id}
                        onChange={(e) => setNewSection({ ...newSection, id: e.target.value })}
                        placeholder="ID（英數 _）"
                        className="rounded border border-sky-200 px-2 py-1.5 text-sm focus:border-sky-400 focus:outline-none"
                      />
                      <input
                        value={newSection.label}
                        onChange={(e) => setNewSection({ ...newSection, label: e.target.value })}
                        placeholder="名稱（如：基本資訊）"
                        className="rounded border border-sky-200 px-2 py-1.5 text-sm focus:border-sky-400 focus:outline-none"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={commitNewSection} className="rounded-lg bg-sky-500 px-3 py-1 text-sm font-medium text-white hover:bg-sky-600">確認新增</button>
                      <button type="button" onClick={() => setNewSection(null)} className="rounded-lg border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-50">取消</button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setNewSection(emptySection())}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-gray-200 py-2.5 text-sm text-gray-400 hover:border-gray-300 hover:text-gray-500"
                  >
                    <Plus className="h-3.5 w-3.5" />新增區段
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
