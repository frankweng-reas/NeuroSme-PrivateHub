import { TOKEN_KEY } from '@/contexts/AuthContext'
import { apiFetch } from './client'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  agent_id?: string // chat.py 必填；chat_dev 不填
  project_id?: string // quotation_parse 時可填，改從 qtn_sources 取參考資料
  prompt_type?: string // 空或 analysis → system_prompt_analysis.md；quotation_parse → system_prompt_quotation_1_parse.md
  schema_id?: string // dev-test-compute-tool：覆寫專案 schema
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

/** SSE 串流階段 */
export type ComputeStage = 'intent' | 'compute' | 'text'

/** SSE 串流版：每個階段 emit 進度，onStage 回傳目前階段 */
export async function chatCompletionsComputeToolStream(
  req: ChatRequest,
  onStage: (stage: ComputeStage) => void
): Promise<ChatResponseCompute> {
  const API_BASE = '/api/v1'
  const token = localStorage.getItem(TOKEN_KEY)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  const res = await fetch(`${API_BASE}/chat/completions-compute-tool-stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    let detail: string | undefined
    try {
      const text = await res.text()
      try {
        const body = JSON.parse(text)
        if (typeof body?.detail === 'string') detail = body.detail
        else if (Array.isArray(body?.detail) && body.detail[0]?.msg) detail = body.detail[0].msg
      } catch {
        detail = text || undefined
      }
    } catch {
      /* ignore */
    }
    throw new Error(detail || `API Error: ${res.status}`)
  }
  const reader = res.body?.getReader()
  if (!reader) throw new Error('無法讀取串流')
  const decoder = new TextDecoder()
  let buffer = ''
  let result: ChatResponseCompute | null = null
  function processBlock(block: string): void {
    const match = block.match(/^data:\s*(.+)$/m)
    if (!match) return
    try {
      const data = JSON.parse(match[1]) as { stage: string; content?: string; chart_data?: unknown; model?: string; usage?: Record<string, number> }
      if (data.stage === 'intent') onStage('intent')
      else if (data.stage === 'compute') onStage('compute')
      else if (data.stage === 'text') onStage('text')
      else if (data.stage === 'done') {
        result = {
          content: data.content ?? '',
          model: data.model ?? '',
          usage: data.usage ?? undefined,
          chart_data: data.chart_data as ChatResponseCompute['chart_data'],
        }
      }
    } catch {
      /* ignore parse error */
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = done ? '' : (parts.pop() ?? '')
    for (const block of parts) {
      processBlock(block)
    }
    if (done) {
      if (buffer.trim()) processBlock(buffer)
      break
    }
  }
  if (!result) throw new Error('串流未回傳完成事件')
  return result
}

/** Test compute_engine：DuckDB 名稱 + intent（不含 rows，由後端讀檔） */
export interface ComputeEngineRequest {
  duckdb_name: string
  intent: Record<string, unknown>
  schema_id?: string
}

export interface ComputeEngineResponse {
  chart_result: Record<string, unknown> | null
  error_detail?: string | null
  /** 後端除錯資訊，含 sql、sql_params、sql_pushdown 等 */
  debug?: Record<string, unknown>
  /** 與 debug.sql 相同 */
  generated_sql?: string | null
}

export async function computeEngine(req: ComputeEngineRequest): Promise<ComputeEngineResponse> {
  return apiFetch<ComputeEngineResponse>('/chat/compute-engine', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

/** Pipeline Inspector（開發用）：一次跑完 intent / SQL / result，回傳所有中間值 */
export interface PipelineInspectRequest {
  question: string
  project_id: string
  schema_id?: string
  model?: string
  user_prompt?: string
}

export interface PipelineInspectResponse {
  injected_prompt: string
  intent_raw: string
  intent: Record<string, unknown> | null
  intent_usage: Record<string, number> | null
  sql: string | null
  sql_params: unknown[] | null
  chart_result: Record<string, unknown> | null
  error: string | null
  stage_failed: string | null
}

export async function pipelineInspect(req: PipelineInspectRequest): Promise<PipelineInspectResponse> {
  return apiFetch<PipelineInspectResponse>('/chat/pipeline-inspect', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}
