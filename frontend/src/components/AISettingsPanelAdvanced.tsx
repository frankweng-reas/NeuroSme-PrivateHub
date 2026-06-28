/** 進階設定：從 Skill 庫開窗選取並套用 User Prompt */
import { useCallback, useEffect, useState } from 'react'
import { X, Zap } from 'lucide-react'
import { listLlmSkills, type LlmSkill } from '@/api/llmSkills'
import SkillPickerModal from '@/components/SkillPickerModal'

// ── AISettingsPanelAdvanced ───────────────────────────────────────────────────

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
  const [showSkillModal, setShowSkillModal] = useState(false)
  const [appliedSkillTitle, setAppliedSkillTitle] = useState<string | null>(null)

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

  function handleApplySkill(skill: LlmSkill) {
    onUserPromptChange(skill.prompt)
    setAppliedSkillTitle(skill.title)
    setShowSkillModal(false)
    onToast(`已套用：${skill.title}`)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <h3 className="shrink-0 text-[14px] font-semibold uppercase tracking-wide text-blue-600">
        進階設定
      </h3>

      {/* Skill 選擇按鈕 */}
      <div className="flex shrink-0 items-center gap-2">
        <label className="shrink-0 text-[16px] font-medium text-gray-700">Skill</label>
        <button
          type="button"
          disabled={skillsLoading}
          onClick={() => setShowSkillModal(true)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-left text-[15px] text-gray-600 hover:border-teal-400 hover:bg-teal-50/30 disabled:opacity-50 transition-colors"
        >
          <Zap className="h-4 w-4 shrink-0 text-teal-600" />
          <span className="truncate">
            {skillsLoading ? '載入中…' : appliedSkillTitle ?? '選擇 Skill 套用…'}
          </span>
        </button>
        {appliedSkillTitle && (
          <button
            type="button"
            onClick={() => { setAppliedSkillTitle(null); onUserPromptChange('') }}
            className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            title="清除 Skill"
          >
            <X className="h-4 w-4" />
          </button>
        )}
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

      {showSkillModal && (
        <SkillPickerModal
          skills={skills}
          onApply={handleApplySkill}
          onClose={() => setShowSkillModal(false)}
        />
      )}
    </div>
  )
}
