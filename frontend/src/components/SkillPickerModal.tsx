/** 共用 Skill 選擇 Modal — 左欄分類、右欄卡片、搜尋、預覽 sub-modal */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X, Zap } from 'lucide-react'
import type { LlmSkill } from '@/api/llmSkills'

export interface SkillPickerModalProps {
  skills: LlmSkill[]
  onApply: (skill: LlmSkill) => void
  onClose: () => void
}

export default function SkillPickerModal({ skills, onApply, onClose }: SkillPickerModalProps) {
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState<string>('全部')
  const [previewSkill, setPreviewSkill] = useState<LlmSkill | null>(null)

  const categories = ['全部', ...Array.from(new Set(
    skills.map((s) => s.category?.trim() || '未分類')
  )).sort((a, b) => {
    if (a === '未分類') return 1
    if (b === '未分類') return -1
    return a.localeCompare(b, 'zh-TW')
  })]

  const filtered = skills.filter((s) => {
    const matchCat = catFilter === '全部' || (s.category?.trim() || '未分類') === catFilter
    const q = search.trim().toLowerCase()
    const matchSearch = !q || s.title.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q)
    return matchCat && matchSearch
  })

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
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
                  <div
                    key={skill.id}
                    className="group flex items-start justify-between rounded-xl border border-gray-200 bg-white p-4 hover:border-teal-300 hover:bg-teal-50/30 transition-colors"
                  >
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
    </div>,
    document.body,
  )
}
