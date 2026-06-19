/**
 * Agent BI API：multi-step tool calling 分析
 * POST /api/v1/agent/bi-stream (SSE)
 */
import { TOKEN_KEY } from '@/contexts/AuthContext'

const API_BASE = '/api/v1'

export interface AgentBiRequest {
  project_id: string
  model: string
  question: string
  agent_id?: string
  schema_id?: string
}

export type AgentBiEventType =
  | 'start'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'done'
  | 'error'

export interface AgentBiEvent {
  type: AgentBiEventType
  content?: string
  step?: number
  tool?: string
  intent?: Record<string, unknown>
  success?: boolean
  result?: string
  chart_data?: unknown
}

/**
 * 呼叫 Agent BI stream endpoint，每次收到 SSE 事件時呼叫 onEvent callback。
 * 回傳最終的 done 事件 content（或拋出錯誤）。
 */
export async function agentBiStream(
  req: AgentBiRequest,
  onEvent: (event: AgentBiEvent) => void,
  signal?: AbortSignal,
): Promise<string> {
  const token = localStorage.getItem(TOKEN_KEY)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }

  const res = await fetch(`${API_BASE}/agent/bi-stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify(req),
    signal,
  })

  if (!res.ok) {
    let detail: string | undefined
    try {
      const text = await res.text()
      try {
        const body = JSON.parse(text)
        detail =
          typeof body?.detail === 'string'
            ? body.detail
            : Array.isArray(body?.detail) && body.detail[0]?.msg
              ? body.detail[0].msg
              : undefined
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
  let finalContent = ''

  function processBlock(block: string): void {
    const match = block.match(/^data:\s*(.+)$/m)
    if (!match) return
    try {
      const event = JSON.parse(match[1]) as AgentBiEvent
      onEvent(event)
      if (event.type === 'done') {
        finalContent = event.content ?? ''
      }
    } catch {
      /* ignore parse error */
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: true })

    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      if (block.trim()) processBlock(block)
    }

    if (done) break
  }

  return finalContent
}
