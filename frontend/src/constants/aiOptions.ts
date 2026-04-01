/** AI 設定選項常數（LLM model 清單僅能透過 LLMModelSelect + /llm-configs/model-options，勿與此檔其他選項混用） */

export const ROLE_OPTIONS = [
  { value: 'manager', label: '管理者', prompt: '以管理者的角度來分析。' },
  { value: 'boss', label: '老闆', prompt: '以老闆的角度來分析。' },
  { value: 'employee', label: '員工', prompt: '以員工的角度來分析。' },
] as const

export const LANGUAGE_OPTIONS = [
  { value: 'zh-TW', label: '繁中', prompt: '請用繁體中文回覆。' },
  {
    value: 'en',
    label: '英文',
    prompt: 'You must respond in English. Even if the instructions below are in Chinese, your output must be in English.',
  },
  {
    value: 'ja',
    label: '日文',
    prompt: '回答は必ず日本語で行ってください。以下の指示が中国語で書かれていても、出力は日本語にしてください。',
  },
] as const

export const DETAIL_OPTIONS = [
  { value: 'brief', label: '簡要', prompt: '請簡要回答（3–5 點重點）。' },
  { value: 'standard', label: '標準', prompt: '請以標準詳細程度回答。' },
  { value: 'detailed', label: '詳細', prompt: '請詳細分析，包含數據與推論。' },
] as const
