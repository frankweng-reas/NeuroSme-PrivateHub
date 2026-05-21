import { apiFetch } from './client'

export interface BotKbItem {
  knowledge_base_id: number
  sort_order: number
}

export interface BotKbResponse {
  knowledge_base_id: number
  name: string
  sort_order: number
}

export type BotContactLinkType = 'phone' | 'email' | 'line' | 'form' | 'url'

export interface BotContactLink {
  type: BotContactLinkType
  label: string
  value: string
}

export type BotFaqType = 'popular' | 'common'

export interface BotFaq {
  id: number
  question: string
  answer: string
  sort_order: number
  is_active: boolean
  faq_type: BotFaqType
}

export interface Bot {
  id: number
  name: string
  description: string | null
  is_active: boolean
  system_prompt: string | null
  fallback_message: string | null
  fallback_message_enabled: boolean
  answer_mode: 'rag' | 'direct'
  model_name: string | null
  public_token: string | null
  widget_title: string | null
  widget_logo_url: string | null
  widget_color: string | null
  widget_lang: string | null
  widget_voice_enabled: boolean
  widget_voice_prompt: string | null
  home_enabled: boolean
  home_greeting: string | null
  home_quick_questions: string | null  // JSON string[]（保留欄位）
  popular_faq_enabled: boolean
  common_faq_enabled: boolean
  contact_enabled: boolean
  contact_links: string | null         // JSON BotContactLink[]
  access_mode: 'public' | 'authenticated'
  knowledge_bases: BotKbResponse[]
  created_by: number | null
  created_at: string
}

export async function listBots(): Promise<Bot[]> {
  return apiFetch<Bot[]>('/bots')
}

export async function getBot(id: number): Promise<Bot> {
  return apiFetch<Bot>(`/bots/${id}`)
}

export async function createBot(data: {
  name: string
  description?: string
  system_prompt?: string
  fallback_message?: string
  fallback_message_enabled?: boolean
  model_name?: string
  knowledge_base_ids?: BotKbItem[]
}): Promise<Bot> {
  return apiFetch<Bot>('/bots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function updateBot(
  id: number,
  data: {
    name?: string
    description?: string
    is_active?: boolean
    system_prompt?: string
    fallback_message?: string
    fallback_message_enabled?: boolean
    answer_mode?: 'rag' | 'direct'
    model_name?: string
    knowledge_base_ids?: BotKbItem[]
    widget_title?: string
    widget_logo_url?: string
    widget_color?: string
    widget_lang?: string
    widget_voice_enabled?: boolean
    widget_voice_prompt?: string
    home_enabled?: boolean
    home_greeting?: string
    home_quick_questions?: string
    popular_faq_enabled?: boolean
    common_faq_enabled?: boolean
    contact_enabled?: boolean
    contact_links?: string
    access_mode?: 'public' | 'authenticated'
  }
): Promise<Bot> {
  return apiFetch<Bot>(`/bots/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function deleteBot(id: number): Promise<void> {
  return apiFetch<void>(`/bots/${id}`, { method: 'DELETE' })
}

export async function generateBotToken(id: number): Promise<Bot> {
  return apiFetch<Bot>(`/bots/${id}/generate-token`, { method: 'POST' })
}

export async function revokeBotToken(id: number): Promise<Bot> {
  return apiFetch<Bot>(`/bots/${id}/token`, { method: 'DELETE' })
}

// ── Bot Query Stats ────────────────────────────────────────────────────────────

export interface BotQueryStatsSummary {
  total_queries: number
  hit_count: number
  zero_hit_count: number
  hit_rate: number
}

export interface BotQueryItem {
  query: string
  count: number
  hit: boolean
  last_asked_at: string
}

export interface BotQueryStatsResponse {
  summary: BotQueryStatsSummary
  queries: BotQueryItem[]
  total: number
  offset: number
}

export type BotQueryStatsView = 'top_queries' | 'zero_hit'

// ── Bot FAQ ────────────────────────────────────────────────────────────────────

export async function listBotFaqs(botId: number, faqType?: BotFaqType): Promise<BotFaq[]> {
  const qs = faqType ? `?faq_type=${faqType}` : ''
  return apiFetch<BotFaq[]>(`/bots/${botId}/faqs${qs}`)
}

export async function createBotFaq(botId: number, data: { question: string; answer: string; sort_order?: number; faq_type?: BotFaqType }): Promise<BotFaq> {
  return apiFetch<BotFaq>(`/bots/${botId}/faqs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function updateBotFaq(
  botId: number,
  faqId: number,
  data: { question?: string; answer?: string; sort_order?: number; is_active?: boolean }
): Promise<BotFaq> {
  return apiFetch<BotFaq>(`/bots/${botId}/faqs/${faqId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function deleteBotFaq(botId: number, faqId: number): Promise<void> {
  return apiFetch<void>(`/bots/${botId}/faqs/${faqId}`, { method: 'DELETE' })
}

export async function reorderBotFaqs(botId: number, items: { id: number; sort_order: number }[]): Promise<void> {
  return apiFetch<void>(`/bots/${botId}/faqs/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(items),
  })
}

// ── Bot Query Stats ────────────────────────────────────────────────────────────

export async function getBotQueryStats(
  botId: number,
  params: { days?: number; view?: BotQueryStatsView; limit?: number; offset?: number } = {}
): Promise<BotQueryStatsResponse> {
  const q = new URLSearchParams()
  if (params.days !== undefined) q.set('days', String(params.days))
  if (params.view) q.set('view', params.view)
  if (params.limit !== undefined) q.set('limit', String(params.limit))
  if (params.offset !== undefined) q.set('offset', String(params.offset))
  const qs = q.toString()
  return apiFetch<BotQueryStatsResponse>(`/bots/${botId}/query-stats${qs ? `?${qs}` : ''}`)
}
