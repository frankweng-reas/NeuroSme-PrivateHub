/** Bot Widget 管理 API（需登入） */
import { apiFetch } from './client'

export type ConversationChannel = 'all' | 'widget' | 'fb' | 'line' | 'external'

export interface WidgetSessionItem {
  session_id: string
  visitor_name: string | null
  visitor_email: string | null
  visitor_phone: string | null
  message_count: number
  created_at: string
  last_active_at: string
}

export interface WidgetMessageItem {
  id: number
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface WidgetSessionDetail extends WidgetSessionItem {
  messages: WidgetMessageItem[]
}

export interface ConversationThreadItem {
  thread_key: string
  channel: string
  channel_label: string
  title: string
  subtitle: string | null
  message_count: number
  created_at: string
  last_active_at: string
  visitor_email?: string | null
  visitor_phone?: string | null
  external_user_id?: string | null
}

export interface ConversationThreadDetail extends ConversationThreadItem {
  messages: WidgetMessageItem[]
}

export function listBotConversations(
  botId: number,
  channel: ConversationChannel = 'all',
): Promise<ConversationThreadItem[]> {
  const params = new URLSearchParams({ channel })
  return apiFetch<ConversationThreadItem[]>(
    `/widget-admin/bot/${botId}/conversations?${params.toString()}`,
  )
}

export function getConversationDetail(threadKey: string): Promise<ConversationThreadDetail> {
  const params = new URLSearchParams({ thread_key: threadKey })
  return apiFetch<ConversationThreadDetail>(`/widget-admin/conversations/detail?${params.toString()}`)
}

/** @deprecated 請改用 listBotConversations */
export function listBotWidgetSessions(botId: number): Promise<WidgetSessionItem[]> {
  return apiFetch<WidgetSessionItem[]>(`/widget-admin/bot/${botId}/sessions`)
}

/** @deprecated 請改用 getConversationDetail */
export function getBotWidgetSessionMessages(sessionId: string): Promise<WidgetSessionDetail> {
  return apiFetch<WidgetSessionDetail>(`/widget-admin/bot-sessions/${sessionId}/messages`)
}
