/** 基本設定：使用模型（顯示）、角色/語言、詳略/範例問題 */
import {
  DETAIL_OPTIONS,
  LANGUAGE_OPTIONS,
  ROLE_OPTIONS,
} from '@/constants/aiOptions'

export interface AISettingsPanelBasicProps {
  analysisModel?: string | null   // 由 tenant 設定，唯讀顯示
  role?: string
  onRoleChange?: (v: string) => void
  language: string
  onLanguageChange: (v: string) => void
  detailLevel: string
  onDetailLevelChange: (v: string) => void
  exampleQuestionsCount: string
  onExampleQuestionsCountChange: (v: string) => void
}

export default function AISettingsPanelBasic({
  analysisModel,
  role,
  onRoleChange,
  language,
  onLanguageChange,
  detailLevel,
  onDetailLevelChange,
  exampleQuestionsCount,
  onExampleQuestionsCountChange,
}: AISettingsPanelBasicProps) {
  return (
    <div className="shrink-0">
      <h3 className="mb-2 text-[14px] font-semibold uppercase tracking-wide text-blue-600">
        基本設定
      </h3>
      <div className="flex flex-col gap-y-2">

        {/* 第 1 行：使用模型（全寬，唯讀） */}
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[16px] font-medium text-gray-700">使用模型</span>
          <span className="min-w-0 flex-1 truncate rounded-lg border border-gray-200 bg-gray-100 px-2 py-1.5 text-[15px] font-mono text-gray-600">
            {analysisModel ?? <span className="text-amber-500 font-sans not-italic">未設定（請至 LLM 設定配置）</span>}
          </span>
        </div>

        {/* 第 2 行：角色 / 語言 */}
        <div className="grid grid-cols-2 gap-x-4">
          {role !== undefined && onRoleChange !== undefined && (
            <div className="flex items-center gap-2">
              <label className="shrink-0 text-[16px] font-medium text-gray-700">角色</label>
              <select
                value={role}
                onChange={(e) => onRoleChange(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[16px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
              >
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="shrink-0 text-[16px] font-medium text-gray-700">語言</label>
            <select
              value={language}
              onChange={(e) => onLanguageChange(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[16px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 第 3 行：詳略 / 範例問題 */}
        <div className="grid grid-cols-2 gap-x-4">
          <div className="flex items-center gap-2">
            <label className="shrink-0 text-[16px] font-medium text-gray-700">詳略</label>
            <select
              value={detailLevel}
              onChange={(e) => onDetailLevelChange(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[16px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
            >
              {DETAIL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="shrink-0 text-[16px] font-medium text-gray-700">範例問題</label>
            <select
              value={exampleQuestionsCount}
              onChange={(e) => onExampleQuestionsCountChange(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[16px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
            >
              <option value="0">0</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </div>
        </div>

      </div>
    </div>
  )
}
