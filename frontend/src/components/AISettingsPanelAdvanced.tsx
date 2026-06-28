/** 進階設定：從 Skill 庫選取並套用 User Prompt */
import { useCallback, useEffect, useState } from 'react'
import { listLlmSkills, type LlmSkill } from '@/api/llmSkills'

export interface AISettingsPanelAdvancedProps {
  userPrompt: string
  onUserPromptChange: (v: string) => void
  onToast: (msg: string) => void
}

export default function AISettingsPanelAdvanced({
  userPrompt,
  onUserPromptChange,
  onToast,
}: AISettingsPanelAdvancedProps) {
  const [skills, setSkills] = useState<LlmSkill[]>([])
  const [skillsLoading, setSkillsLoading] = useState(true)
  const [selectedSkillId, setSelectedSkillId] = useState<number | null>(null)

  const fetchSkills = useCallback(async () => {
    setSkillsLoading(true)
    try {
      const list = await listLlmSkills()
      setSkills(list)
    } catch {
      setSkills([])
    } finally {
      setSkillsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSkills()
  }, [fetchSkills])

  function handleSelectSkill(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value
    if (val === '') {
      setSelectedSkillId(null)
      return
    }
    const id = Number(val)
    const skill = skills.find((s) => s.id === id)
    if (skill) {
      setSelectedSkillId(id)
      onUserPromptChange(skill.prompt)
      onToast(`已套用：${skill.title}`)
    }
  }

  // 依 category 分組顯示
  const grouped = skills.reduce<Record<string, LlmSkill[]>>((acc, s) => {
    const cat = s.category ?? '其他'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(s)
    return acc
  }, {})
  const categories = Object.keys(grouped).sort()

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <h3 className="shrink-0 text-[14px] font-semibold uppercase tracking-wide text-blue-600">
        進階設定
      </h3>

      {/* Skill 選擇 */}
      <div className="flex min-w-0 shrink-0 w-full items-center gap-2">
        <label className="shrink-0 text-[16px] font-medium text-gray-700">Skill</label>
        <select
          value={selectedSkillId ?? ''}
          onChange={handleSelectSkill}
          disabled={skillsLoading}
          className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[16px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:opacity-50"
        >
          <option value="">選擇 Skill 套用…</option>
          {categories.map((cat) => (
            <optgroup key={cat} label={cat}>
              {grouped[cat].map((s) => (
                <option key={s.id} value={s.id} title={s.description ?? undefined}>
                  {s.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {skills.length === 0 && !skillsLoading && (
        <p className="text-[13px] text-gray-400">尚無 Skill，請管理員至後台新增。</p>
      )}

      {/* User Prompt 文字框 */}
      <div className="min-h-0 flex-1">
        <textarea
          value={userPrompt}
          onChange={(e) => onUserPromptChange(e.target.value)}
          placeholder="User Prompt（選填），如格式、資料辭典等；可直接輸入或先選 Skill 套用"
          className="h-full min-h-[80px] w-full resize-y rounded-lg border border-gray-300 bg-white p-2 text-[16px] text-gray-800 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
        />
      </div>
    </div>
  )
}
