/**
 * Agent BI API：multi-step tool calling 分析（Dev Lab 用）
 * POST /api/v1/chat/completions-agent-bi-stream (SSE)
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
  | 'agent_step'
  | 'done'
  | 'error'

export interface AgentBiEvent {
  type: AgentBiEventType
  content?: string
  step?: number
  query?: string
  phase?: 'running' | 'done'
  success?: boolean
  stage?: string
  error_stage?: string
  chart_data?: Record<string, unknown> | null
}

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

  const res = await fetch(`${API_BASE}/chat/completions-agent-bi-stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      content: req.question,   // 後端用 content
      model: req.model,
      project_id: req.project_id,
      agent_id: req.agent_id ?? '',
      schema_id: req.schema_id ?? '',
      user_prompt: '',
      system_prompt: '',
      data: '',
      messages: [],
    }),
    signal,
  })

  if (!res.ok) {
    let detail: string | undefined
    try {
      const text = await res.text()
      try {
        const body = JSON.parse(text)
        detail = typeof body?.detail === 'string' ? body.detail
          : Array.isArray(body?.detail) && body.detail[0]?.msg ? body.detail[0].msg : undefined
      } catch {
        detail = text || undefined
      }
    } catch { /* ignore */ }
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
      const raw = JSON.parse(match[1])

      // agent_step 進度事件
      if (raw.type === 'agent_step') {
        onEvent({ type: 'agent_step', step: raw.step, query: raw.query, phase: raw.phase, success: raw.success })
        return
      }

      // stage: done 完成事件
      if (raw.stage === 'done') {
        finalContent = raw.content ?? ''
        if (raw.error_stage) {
          onEvent({ type: 'error', content: raw.content, stage: raw.stage, error_stage: raw.error_stage })
        } else {
          onEvent({ type: 'done', content: raw.content, chart_data: raw.chart_data as Record<string, unknown> | null, stage: raw.stage })
        }
        return
      }
    } catch { /* ignore */ }
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
