import { apiFetch } from './client'

export interface ChatInsightsSummary {
  request_count: number
  success_count: number
  error_count: number
  pending_count: number
  total_prompt_tokens: number
  total_completion_tokens: number
  total_tokens: number
  avg_total_tokens_per_request: number | null
}

export interface ChatInsightsByModelRow {
  llm_model: string | null
  provider: string | null
  request_count: number
  success_count: number
  error_count: number
  total_prompt_tokens: number
  total_completion_tokens: number
  total_tokens: number
}

export interface ChatInsightsByStatusRow {
  status: string
  count: number
}

export interface ChatInsightsErrorCodeRow {
  error_code: string
  count: number
}

export interface ChatInsightsDailyRow {
  day: string
  request_count: number
  success_count: number
  error_count: number
  total_tokens: number
}

export interface ChatInsightsOverview {
  tenant_id: string
  start: string
  end: string
  summary: ChatInsightsSummary
  by_model: ChatInsightsByModelRow[]
  by_status: ChatInsightsByStatusRow[]
  top_error_codes: ChatInsightsErrorCodeRow[]
  by_day: ChatInsightsDailyRow[]
}

/** 租戶 Chat LLM 用量總覽（需 admin / super_admin）；start／end 為 YYYY-MM-DD（台北日曆日） */
export async function getChatInsightsOverview(params?: {
  start?: string
  end?: string
}): Promise<ChatInsightsOverview> {
  const q = new URLSearchParams()
  if (params?.start) q.set('start', params.start)
  if (params?.end) q.set('end', params.end)
  const qs = q.toString()
  return apiFetch<ChatInsightsOverview>(`/chat/insights/overview${qs ? `?${qs}` : ''}`)
}

/** B-1 */
export interface ChatInsightsUsersSummary {
  tenant_id: string
  start: string
  end: string
  active_users: number
  total_requests_attributed: number
  requests_without_user: number
  total_tokens_attributed: number
  avg_requests_per_active_user: number | null
  avg_tokens_per_active_user: number | null
}

/** B-2／B-3 */
export interface ChatInsightsLeaderboardRow {
  user_id: number
  display_label: string
  username: string | null
  request_count: number
  total_tokens: number
  last_activity_at: string | null
}

export interface ChatInsightsLeaderboard {
  tenant_id: string
  start: string
  end: string
  sort: string
  anonymize: boolean
  rows: ChatInsightsLeaderboardRow[]
}

export interface ChatInsightsUserThreadRow {
  thread_id: string
  title: string | null
  agent_id: string
  last_message_at: string | null
  request_count_in_range: number
  total_tokens_in_range: number
}

export interface ChatInsightsUserThreads {
  tenant_id: string
  user_id: number
  start: string
  end: string
  display_label: string
  threads: ChatInsightsUserThreadRow[]
}

export async function getChatInsightsUsersSummary(params?: {
  start?: string
  end?: string
}): Promise<ChatInsightsUsersSummary> {
  const q = new URLSearchParams()
  if (params?.start) q.set('start', params.start)
  if (params?.end) q.set('end', params.end)
  const qs = q.toString()
  return apiFetch<ChatInsightsUsersSummary>(`/chat/insights/users-summary${qs ? `?${qs}` : ''}`)
}

export async function getChatInsightsUsersLeaderboard(params: {
  start?: string
  end?: string
  limit?: number
  sort?: 'tokens' | 'requests'
  anonymize?: boolean
}): Promise<ChatInsightsLeaderboard> {
  const q = new URLSearchParams()
  if (params.start) q.set('start', params.start)
  if (params.end) q.set('end', params.end)
  if (params.limit != null) q.set('limit', String(params.limit))
  if (params.sort) q.set('sort', params.sort)
  if (params.anonymize) q.set('anonymize', 'true')
  const qs = q.toString()
  return apiFetch<ChatInsightsLeaderboard>(`/chat/insights/users-leaderboard?${qs}`)
}

export async function getChatInsightsUserThreads(
  userId: number,
  params: { start?: string; end?: string; anonymize?: boolean }
): Promise<ChatInsightsUserThreads> {
  const q = new URLSearchParams()
  if (params.start) q.set('start', params.start)
  if (params.end) q.set('end', params.end)
  if (params.anonymize) q.set('anonymize', 'true')
  const qs = q.toString()
  return apiFetch<ChatInsightsUserThreads>(
    `/chat/insights/users/${userId}/threads${qs ? `?${qs}` : ''}`
  )
}

/** 儲存空間（無日期區間；Chat 對話／附件存量） */
export interface ChatInsightsStorageTotals {
  thread_count: number
  chat_attachment_link_count: number
  chat_attachment_distinct_files: number
  chat_attachment_total_bytes: number
}

export interface ChatInsightsStorageUserThreadsRow {
  user_id: number
  display_label: string
  username: string | null
  thread_count: number
}

export interface ChatInsightsStorageUserFilesRow {
  user_id: number
  display_label: string
  username: string | null
  distinct_file_count: number
  total_bytes: number
}

export interface ChatInsightsStorage {
  tenant_id: string
  anonymize: boolean
  totals: ChatInsightsStorageTotals
  top_users_by_thread_count: ChatInsightsStorageUserThreadsRow[]
  top_users_by_chat_attachment_bytes: ChatInsightsStorageUserFilesRow[]
  top_users_by_chat_attachment_file_count: ChatInsightsStorageUserFilesRow[]
}

export async function getChatInsightsStorage(params?: {
  limit?: number
  anonymize?: boolean
}): Promise<ChatInsightsStorage> {
  const q = new URLSearchParams()
  if (params?.limit != null) q.set('limit', String(params.limit))
  if (params?.anonymize) q.set('anonymize', 'true')
  const qs = q.toString()
  return apiFetch<ChatInsightsStorage>(`/chat/insights/storage${qs ? `?${qs}` : ''}`)
}
