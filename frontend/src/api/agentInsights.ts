import { apiFetch } from './client'

// ── Health ──────────────────────────────────────────────────────────────────

export interface AgentHealthCard {
  agent_type: string
  total: number
  success: number
  error: number
  success_rate: number       // 0.0–1.0
  p50_latency_ms: number | null
}

export interface RecentError {
  id: number
  agent_type: string
  model: string | null
  latency_ms: number | null
  created_at: string
}

export interface AgentHealthResponse {
  start: string
  end: string
  cards: AgentHealthCard[]
  recent_errors: RecentError[]
}

// ── Daily Trend ──────────────────────────────────────────────────────────────

export interface DailyAgentRow {
  day: string           // YYYY-MM-DD
  agent_type: string
  request_count: number
  p50_latency_ms: number | null
}

export interface AgentDailyTrendResponse {
  start: string
  end: string
  rows: DailyAgentRow[]
}

// ── Ranking ──────────────────────────────────────────────────────────────────

export interface AgentRankRow {
  agent_type: string
  current: number
  previous: number
  delta: number
}

export interface AgentRankingResponse {
  current_start: string
  current_end: string
  previous_start: string
  previous_end: string
  rows: AgentRankRow[]
}

// ── Tokens ───────────────────────────────────────────────────────────────────

export interface AgentTokenRow {
  agent_type: string
  is_embedding: boolean
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface UserTokenRow {
  user_id: number | null
  total_tokens: number
}

export interface AgentTokenResponse {
  start: string
  end: string
  by_agent: AgentTokenRow[]
  top_users: UserTokenRow[]
}

// ── Users Tab ─────────────────────────────────────────────────────────────────

export interface UsersOverviewResponse {
  start: string
  end: string
  active_users: number
  avg_tokens_per_user: number | null
  multi_agent_users: number
  high_error_users: number
}

export interface UserAgentStat {
  agent_type: string
  request_count: number
  total_tokens: number
}

export interface UserLeaderboardRow {
  user_id: number
  display_label: string
  username: string | null
  total_requests: number
  total_tokens: number
  error_count: number
  error_rate: number
  active_days: number
  last_activity_at: string
  agents: UserAgentStat[]
}

export interface UsersLeaderboardResponse {
  start: string
  end: string
  rows: UserLeaderboardRow[]
}

export interface UserAgentBreakdownRow {
  agent_type: string
  request_count: number
  total_tokens: number
  error_count: number
  error_rate: number
  last_activity_at: string
}

export interface UserBreakdownResponse {
  user_id: number
  display_label: string
  start: string
  end: string
  agents: UserAgentBreakdownRow[]
}

export interface UserChatThreadRow {
  thread_id: string
  title: string | null
  agent_id: string
  request_count_in_range: number
  total_tokens_in_range: number
  last_message_at: string | null
}

export interface UserChatThreadsResponse {
  user_id: number
  display_label: string
  start: string
  end: string
  threads: UserChatThreadRow[]
}

export interface UserOcrHistoryRow {
  id: number
  config_name: string
  filename: string
  status: string
  total_tokens: number | null
  created_at: string
}

export interface UserOcrHistoryResponse {
  user_id: number
  display_label: string
  start: string
  end: string
  rows: UserOcrHistoryRow[]
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

function buildParams(params?: { start?: string; end?: string }): string {
  const q = new URLSearchParams()
  if (params?.start) q.set('start', params.start)
  if (params?.end) q.set('end', params.end)
  const s = q.toString()
  return s ? `?${s}` : ''
}

export async function getAgentInsightsHealth(
  params?: { start?: string; end?: string },
): Promise<AgentHealthResponse> {
  return apiFetch(`/agent-insights/health${buildParams(params)}`)
}

export async function getAgentInsightsDailyTrend(
  params?: { start?: string; end?: string },
): Promise<AgentDailyTrendResponse> {
  return apiFetch(`/agent-insights/daily-trend${buildParams(params)}`)
}

export async function getAgentInsightsRanking(
  params?: { start?: string; end?: string },
): Promise<AgentRankingResponse> {
  return apiFetch(`/agent-insights/ranking${buildParams(params)}`)
}

export async function getAgentInsightsTokens(
  params?: { start?: string; end?: string },
): Promise<AgentTokenResponse> {
  return apiFetch(`/agent-insights/tokens${buildParams(params)}`)
}

export async function getAgentInsightsUsersOverview(
  params?: { start?: string; end?: string },
): Promise<UsersOverviewResponse> {
  return apiFetch(`/agent-insights/users/overview${buildParams(params)}`)
}

export async function getAgentInsightsUsersLeaderboard(params: {
  start?: string
  end?: string
  sort?: string
  limit?: number
  anonymize?: boolean
}): Promise<UsersLeaderboardResponse> {
  const q = new URLSearchParams()
  if (params.start) q.set('start', params.start)
  if (params.end) q.set('end', params.end)
  if (params.sort) q.set('sort', params.sort)
  if (params.limit != null) q.set('limit', String(params.limit))
  if (params.anonymize != null) q.set('anonymize', String(params.anonymize))
  const s = q.toString()
  return apiFetch(`/agent-insights/users/leaderboard${s ? `?${s}` : ''}`)
}

export async function getAgentInsightsUsersSearch(params: {
  q: string
  start?: string
  end?: string
  anonymize?: boolean
}): Promise<UsersLeaderboardResponse> {
  const qs = new URLSearchParams()
  qs.set('q', params.q)
  if (params.start) qs.set('start', params.start)
  if (params.end) qs.set('end', params.end)
  if (params.anonymize != null) qs.set('anonymize', String(params.anonymize))
  return apiFetch(`/agent-insights/users/search?${qs.toString()}`)
}

export async function getAgentInsightsUserBreakdown(
  userId: number,
  params?: { start?: string; end?: string; anonymize?: boolean },
): Promise<UserBreakdownResponse> {
  const q = new URLSearchParams()
  if (params?.start) q.set('start', params.start)
  if (params?.end) q.set('end', params.end)
  if (params?.anonymize != null) q.set('anonymize', String(params.anonymize))
  const s = q.toString()
  return apiFetch(`/agent-insights/users/${userId}/breakdown${s ? `?${s}` : ''}`)
}

export async function getAgentInsightsUserChatThreads(
  userId: number,
  params?: { start?: string; end?: string; anonymize?: boolean },
): Promise<UserChatThreadsResponse> {
  const q = new URLSearchParams()
  if (params?.start) q.set('start', params.start)
  if (params?.end) q.set('end', params.end)
  if (params?.anonymize != null) q.set('anonymize', String(params.anonymize))
  const s = q.toString()
  return apiFetch(`/agent-insights/users/${userId}/chat-threads${s ? `?${s}` : ''}`)
}

export async function getAgentInsightsUserOcrHistory(
  userId: number,
  params?: { start?: string; end?: string; anonymize?: boolean },
): Promise<UserOcrHistoryResponse> {
  const q = new URLSearchParams()
  if (params?.start) q.set('start', params.start)
  if (params?.end) q.set('end', params.end)
  if (params?.anonymize != null) q.set('anonymize', String(params.anonymize))
  const s = q.toString()
  return apiFetch(`/agent-insights/users/${userId}/ocr-history${s ? `?${s}` : ''}`)
}
