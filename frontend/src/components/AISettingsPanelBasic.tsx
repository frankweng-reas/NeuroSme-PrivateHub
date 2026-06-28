/** 基本設定：使用模型（唯讀顯示）、建議追問數量 */

export interface AISettingsPanelBasicProps {
  analysisModel?: string | null
  exampleQuestionsCount: string
  onExampleQuestionsCountChange: (v: string) => void
}

export default function AISettingsPanelBasic({
  analysisModel,
  exampleQuestionsCount,
  onExampleQuestionsCountChange,
}: AISettingsPanelBasicProps) {
  return (
    <div className="shrink-0">
      <h3 className="mb-2 text-[14px] font-semibold uppercase tracking-wide text-blue-600">
        基本設定
      </h3>
      <div className="flex flex-col gap-y-2">

        {/* 使用模型（唯讀） */}
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[16px] font-medium text-gray-700">使用模型</span>
          <span className="min-w-0 flex-1 truncate rounded-lg border border-gray-200 bg-gray-100 px-2 py-1.5 text-[15px] font-mono text-gray-600">
            {analysisModel ?? <span className="text-amber-500 font-sans not-italic">未設定（請至 LLM 設定配置）</span>}
          </span>
        </div>

        {/* 建議追問數量 */}
        <div className="flex items-center gap-2">
          <label className="shrink-0 text-[16px] font-medium text-gray-700">建議追問</label>
          <select
            value={exampleQuestionsCount}
            onChange={(e) => onExampleQuestionsCountChange(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[16px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
          >
            <option value="0">不顯示</option>
            <option value="1">1 個</option>
            <option value="2">2 個</option>
            <option value="3">3 個</option>
          </select>
        </div>

      </div>
    </div>
  )
}
