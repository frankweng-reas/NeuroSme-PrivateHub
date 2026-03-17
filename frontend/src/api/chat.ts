import { apiFetch } from './client'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  agent_id?: string // chat.py 必填；chat_dev 不填
  project_id?: string // quotation_parse 時可填，改從 qtn_sources 取參考資料
  prompt_type?: string // 空或 analysis → system_prompt_analysis.md；quotation_parse → system_prompt_quotation_1_parse.md
  system_prompt: string
  user_prompt: string
  data: string
  model: string
  messages: ChatMessage[]
  content: string
}

export interface ChatUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface ChatResponse {
  content: string
  model: string
  usage: ChatUsage | null
  finish_reason: string | null
}

export async function chatCompletions(req: ChatRequest): Promise<ChatResponse> {
  return apiFetch<ChatResponse>('/chat/completions', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

/** dev-test-chat 專用：不讀 md 檔，完全使用 request 的 system_prompt */
export async function chatCompletionsDev(req: ChatRequest): Promise<ChatResponse> {
  return apiFetch<ChatResponse>('/chat/dev/completions', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

/** 測試用：compute flow（意圖萃取 + 後端計算 + 文字生成） */
export interface ChatResponseCompute {
  content: string
  model: string
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  chart_data?: {
    labels: string[]
    data?: number[]
    datasets?: { label: string; data: number[] }[]
    chartType: 'pie' | 'bar' | 'line'
    valueSuffix?: string
    title?: string
  }
  debug?: Record<string, unknown>
}

/** Tool Calling 路徑：意圖萃取 → Backend 計算 → 文字生成 */
export async function chatCompletionsComputeTool(req: ChatRequest): Promise<ChatResponseCompute> {
  return apiFetch<ChatResponseCompute>('/chat/completions-compute-tool', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

/** dev-test-intent-to-data：僅需 project_id，從 DuckDB 載入資料 */
export interface IntentToComputeByProjectRequest {
  project_id: string
  intent: Record<string, unknown>
}

export interface IntentToComputeResponse {
  chart_result: Record<string, unknown> | null
  error_detail?: string | null
}

export async function intentToComputeByProject(
  req: IntentToComputeByProjectRequest
): Promise<IntentToComputeResponse> {
  return apiFetch<IntentToComputeResponse>('/chat/intent-to-compute-by-project', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

/** 傳入 intent + rows，無需 project（手動貼資料測試用） */
export interface IntentToComputeRawRequest {
  intent: Record<string, unknown>
  rows: Record<string, unknown>[]
}

export async function intentToComputeRaw(req: IntentToComputeRawRequest): Promise<IntentToComputeResponse> {
  return apiFetch<IntentToComputeResponse>('/chat/intent-to-compute-raw', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}
