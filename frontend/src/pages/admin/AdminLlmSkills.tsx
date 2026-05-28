/** Admin：LLM Skills 管理 — 維護 tenant 共用的 prompt 範本 */
import { useCallback, useEffect, useState } from 'react'
import { GripVertical, Pencil, Plus, Trash2, X, Zap } from 'lucide-react'
import { ApiError } from '@/api/client'
import {
  listLlmSkills,
  createLlmSkill,
  updateLlmSkill,
  deleteLlmSkill,
  type LlmSkill,
} from '@/api/llmSkills'
import ConfirmModal from '@/components/ConfirmModal'
import { useToast } from '@/contexts/ToastContext'

// ── 編輯 Modal ────────────────────────────────────────────────────────────────

interface SkillFormModalProps {
  skill: LlmSkill | null  // null = 新增
  onClose: () => void
  onSaved: (skill: LlmSkill) => void
}

function SkillFormModal({ skill, onClose, onSaved }: SkillFormModalProps) {
  const [title, setTitle] = useState(skill?.title ?? '')
  const [category, setCategory] = useState(skill?.category ?? '')
  const [description, setDescription] = useState(skill?.description ?? '')
  const [prompt, setPrompt] = useState(skill?.prompt ?? '')
  const [sortOrder, setSortOrder] = useState(String(skill?.sort_order ?? 0))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = useCallback(async () => {
    if (!title.trim()) { setError('請輸入 Skill 名稱'); return }
    if (!prompt.trim()) { setError('請輸入 Prompt 內容'); return }
    setSaving(true)
    setError('')
    try {
      const body = {
        title: title.trim(),
        category: category.trim() || null,
        description: description.trim() || null,
        prompt: prompt.trim(),
        sort_order: Number(sortOrder) || 0,
      }
      const result = skill
        ? await updateLlmSkill(skill.id, body)
        : await createLlmSkill(body)
      onSaved(result)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '儲存失敗，請重試')
    } finally {
      setSaving(false)
    }
  }, [title, category, description, prompt, sortOrder, skill, onSaved])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative z-10 flex w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-teal-600" />
            <h2 className="text-lg font-semibold text-gray-800">
              {skill ? '編輯 Skill' : '新增 Skill'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 overflow-y-auto px-6 py-5">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Skill 名稱 <span className="text-red-500">*</span>
            </label>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="例：拜訪感謝信、週報範本"
              className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">分類</label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              maxLength={100}
              placeholder="例：Email、報告、FAQ（選填，用於分群顯示）"
              className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">簡短說明</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              placeholder="讓用戶快速了解此 Skill 的用途（選填）"
              className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <div className="flex flex-1 flex-col">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Prompt 內容 <span className="text-red-500">*</span>
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={10}
              placeholder="請根據以上內容，寫一封商業 Email……"
              className="w-full resize-y rounded-xl border border-gray-300 px-4 py-3 font-mono text-sm text-gray-800 placeholder:text-gray-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
            <p className="mt-1 text-xs text-gray-400">
              用戶套用後，此 Prompt 會帶入「對 AI 的指令」欄位，可再自行調整。
            </p>
          </div>

          <div className="w-28">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">排序（數字越小越前）</label>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-800 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-gray-300 px-5 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="rounded-xl bg-teal-700 px-5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
          >
            {saving ? '儲存中…' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 主元件 ────────────────────────────────────────────────────────────────────

export default function AdminLlmSkills() {
  const [skills, setSkills] = useState<LlmSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formTarget, setFormTarget] = useState<LlmSkill | 'new' | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LlmSkill | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const { showToast } = useToast()

  const loadSkills = useCallback(() => {
    setLoading(true)
    setError(null)
    listLlmSkills()
      .then(setSkills)
      .catch((e) => setError(e instanceof ApiError && e.status === 403 ? '需要 admin 權限' : '載入失敗'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadSkills() }, [loadSkills])

  const handleSaved = useCallback((saved: LlmSkill) => {
    setSkills((prev) => {
      const exists = prev.find((s) => s.id === saved.id)
      return exists
        ? prev.map((s) => (s.id === saved.id ? saved : s))
        : [saved, ...prev]
    })
    setFormTarget(null)
    showToast(formTarget === 'new' ? 'Skill 已新增' : 'Skill 已更新', 'success')
  }, [formTarget, showToast])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    setDeleteLoading(true)
    try {
      await deleteLlmSkill(deleteTarget.id)
      setSkills((prev) => prev.filter((s) => s.id !== deleteTarget.id))
      showToast('Skill 已刪除', 'success')
    } catch {
      showToast('刪除失敗', 'error')
    } finally {
      setDeleteLoading(false)
      setDeleteTarget(null)
    }
  }, [deleteTarget, showToast])

  return (
    <div className="space-y-6">
      {/* 編輯 Modal */}
      {formTarget !== null && (
        <SkillFormModal
          skill={formTarget === 'new' ? null : formTarget}
          onClose={() => setFormTarget(null)}
          onSaved={handleSaved}
        />
      )}

      {/* 刪除確認 Modal */}
      <ConfirmModal
        open={deleteTarget !== null}
        title="刪除 Skill"
        message={`確定要刪除「${deleteTarget?.title}」？此操作無法復原。`}
        confirmText={deleteLoading ? '刪除中...' : '刪除'}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* 頁首 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Zap className="h-6 w-6 text-teal-600" />
          <div>
            <h1 className="text-xl font-bold text-gray-800">LLM Skills 管理</h1>
            <p className="text-sm text-gray-500">維護 tenant 共用的 prompt 範本，供 Writing Agent 等工具套用</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setFormTarget('new')}
          className="flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
        >
          <Plus className="h-4 w-4" />
          新增 Skill
        </button>
      </div>

      {/* 狀態 */}
      {loading && (
        <div className="flex justify-center py-16 text-gray-400">載入中…</div>
      )}
      {error && (
        <div className="rounded-xl bg-red-50 px-5 py-4 text-sm text-red-600">{error}</div>
      )}

      {/* 列表 */}
      {!loading && !error && skills.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-20 text-gray-400">
          <Zap className="h-10 w-10 opacity-30" />
          <p className="text-base">尚未建立任何 Skill</p>
          <button
            type="button"
            onClick={() => setFormTarget('new')}
            className="mt-1 rounded-xl bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
          >
            建立第一個 Skill
          </button>
        </div>
      )}

      {!loading && !error && skills.length > 0 && (() => {
        // 按 category 分群（無分類歸入「未分類」，放最後）
        const grouped = new Map<string, LlmSkill[]>()
        for (const s of skills) {
          const key = s.category?.trim() || '未分類'
          if (!grouped.has(key)) grouped.set(key, [])
          grouped.get(key)!.push(s)
        }
        // 有分類的排前面，「未分類」放最後
        const sortedKeys = [...grouped.keys()].sort((a, b) => {
          if (a === '未分類') return 1
          if (b === '未分類') return -1
          return a.localeCompare(b, 'zh-TW')
        })

        return (
          <div className="space-y-6">
            {sortedKeys.map((cat) => (
              <div key={cat}>
                {/* 分類標題 */}
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded-full bg-teal-50 px-3 py-0.5 text-xs font-semibold text-teal-700">
                    {cat}
                  </span>
                  <span className="text-xs text-gray-400">{grouped.get(cat)!.length} 個</span>
                </div>

                {/* 該分類的 skill 列表 */}
                <div className="overflow-hidden rounded-2xl border border-gray-200 shadow-sm">
                    <table className="w-full table-fixed text-sm">
                    <colgroup>
                      <col className="w-8" />
                      <col className="w-[40%]" />
                      <col className="w-[40%]" />
                      <col className="w-16" />
                      <col className="w-20" />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        <th className="px-4 py-3" />
                        <th className="px-4 py-3">名稱</th>
                        <th className="px-4 py-3">說明</th>
                        <th className="px-4 py-3 text-center">排序</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {grouped.get(cat)!.map((skill) => (
                        <tr key={skill.id} className="group bg-white hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-300">
                            <GripVertical className="h-4 w-4" />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-gray-800">{skill.title}</span>
                              {skill.category && (
                                <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700">
                                  {skill.category}
                                </span>
                              )}
                            </div>
                            <div className="mt-1 max-w-xs truncate font-mono text-xs text-gray-400">{skill.prompt}</div>
                          </td>
                          <td className="px-4 py-3 text-gray-500">
                            <div className="truncate">
                              {skill.description || <span className="text-gray-300">—</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center text-gray-500">{skill.sort_order}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                              <button
                                type="button"
                                onClick={() => setFormTarget(skill)}
                                className="rounded-lg p-1.5 text-gray-500 hover:bg-teal-50 hover:text-teal-700"
                                title="編輯"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(skill)}
                                className="rounded-lg p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600"
                                title="刪除"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )
      })()}
    </div>
  )
}
