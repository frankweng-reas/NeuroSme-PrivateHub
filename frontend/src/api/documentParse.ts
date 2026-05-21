import { TOKEN_KEY } from '@/contexts/AuthContext'

const API_BASE = '/api/v1'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ParseProfile {
  id: string
  name: string
}

export interface ParseField {
  key: string
  label: string
  type: 'text' | 'currency' | 'datetime' | 'text_list' | 'doc_list'
  value: string | string[] | null
  cite: string | null
  not_found: boolean
}

export interface ParseSection {
  id: string
  label: string
  fields: ParseField[]
}

export interface ParseUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export type ParseStreamEvent =
  | { type: 'meta'; profile_name: string; page_count: number; char_count: number; chunk_total: number }
  | { type: 'progress'; chunk: number; chunk_total: number; status: string }
  | { type: 'done'; result_id: number | null; sections: ParseSection[]; usage: ParseUsage; model: string }
  | { type: 'error'; detail: string }

export interface ParseResultSummary {
  id: number
  profile_id: string
  profile_name: string
  file_name: string
  page_count: number | null
  model: string
  created_at: string
}

export interface ParseResultDetail extends ParseResultSummary {
  sections: ParseSection[]
  usage: ParseUsage | null
}

// ── API calls ────────────────────────────────────────────────────────────────

export async function listParseProfiles(): Promise<ParseProfile[]> {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const res = await fetch(`${API_BASE}/document-parse/profiles`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error(`取得解析設定失敗 (${res.status})`)
  return res.json() as Promise<ParseProfile[]>
}

export async function listParseResults(limit = 20, offset = 0): Promise<ParseResultSummary[]> {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const res = await fetch(`${API_BASE}/document-parse/results?limit=${limit}&offset=${offset}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error(`取得解析歷史失敗 (${res.status})`)
  return res.json() as Promise<ParseResultSummary[]>
}

export async function getParseResult(id: number): Promise<ParseResultDetail> {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const res = await fetch(`${API_BASE}/document-parse/results/${id}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error(`取得解析結果失敗 (${res.status})`)
  return res.json() as Promise<ParseResultDetail>
}

export async function deleteParseResult(id: number): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const res = await fetch(`${API_BASE}/document-parse/results/${id}`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error(`刪除解析結果失敗 (${res.status})`)
}

export async function patchResultField(
  resultId: number,
  sectionId: string,
  fieldKey: string,
  value: string | string[] | null,
): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const res = await fetch(`${API_BASE}/document-parse/results/${resultId}/fields`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ section_id: sectionId, field_key: fieldKey, value }),
  })
  if (!res.ok) throw new Error(`更新欄位失敗 (${res.status})`)
}

// ── Evaluation Types ─────────────────────────────────────────────────────────

export type EvalItemType = 'doc_checklist' | 'tech_matrix' | 'risk_matrix'
export type EvalStatus = 'todo' | 'in_progress' | 'done'
export type EvalCapability = 'meet' | 'custom' | 'outsource' | 'unknown'
export type EvalRiskLevel = 'high' | 'medium' | 'low'

export interface EvalItem {
  id: number
  item_type: EvalItemType
  item_key: string
  cite: string | null
  sort_order: number
  // doc_checklist
  mandatory: boolean | null
  assignee: string | null
  due_date: string | null   // "YYYY-MM-DD"
  status: EvalStatus | null
  // tech_matrix
  capability: EvalCapability | null
  risk_level: EvalRiskLevel | null
  // shared
  note: string | null
}

export type EvalItemPatch = Partial<Pick<
  EvalItem,
  'mandatory' | 'assignee' | 'due_date' | 'status' | 'capability' | 'risk_level' | 'note'
>>

// ── Evaluation API ───────────────────────────────────────────────────────────

function apiError(action: string, status: number): Error {
  if (status === 401) return new Error('登入已過期，請重新整理頁面後再試')
  return new Error(`${action}失敗 (${status})`)
}

export async function getEvaluation(resultId: number): Promise<EvalItem[]> {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const res = await fetch(`${API_BASE}/document-parse/results/${resultId}/evaluation`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw apiError('取得評估', res.status)
  return res.json() as Promise<EvalItem[]>
}

export async function classifyEvaluation(resultId: number): Promise<EvalItem[]> {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const res = await fetch(
    `${API_BASE}/document-parse/results/${resultId}/evaluation/classify`,
    {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  )
  if (!res.ok) throw apiError('AI 分類', res.status)
  return res.json() as Promise<EvalItem[]>
}

export async function patchEvalItem(
  resultId: number,
  itemId: number,
  patch: EvalItemPatch,
): Promise<EvalItem> {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const res = await fetch(
    `${API_BASE}/document-parse/results/${resultId}/evaluation/${itemId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(patch),
    },
  )
  if (!res.ok) throw apiError('更新評估項目', res.status)
  return res.json() as Promise<EvalItem>
}

export async function* parseDocumentStream(
  file: File,
  profileId: string,
  model?: string,
  signal?: AbortSignal,
): AsyncGenerator<ParseStreamEvent> {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const fd = new FormData()
  fd.append('file', file)
  fd.append('profile_id', profileId)
  if (model) fd.append('model', model)

  const res = await fetch(`${API_BASE}/document-parse/parse`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
    signal,
  })

  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch { /* ignore */ }
    yield { type: 'error', detail }
    return
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''
    for (const block of blocks) {
      const dataLine = block.split('\n').find((l) => l.startsWith('data: '))
      if (!dataLine) continue
      try {
        yield JSON.parse(dataLine.slice(6)) as ParseStreamEvent
      } catch { /* skip malformed */ }
    }
  }
}
