/** Widget 管理 API（需登入） */
import { apiFetch } from './client'

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

export function listWidgetSessions(kbId: number): Promise<WidgetSessionItem[]> {
  return apiFetch<WidgetSessionItem[]>(`/widget-admin/kb/${kbId}/sessions`)
}

export function getWidgetSessionMessages(sessionId: string): Promise<WidgetSessionDetail> {
  return apiFetch<WidgetSessionDetail>(`/widget-admin/sessions/${sessionId}/messages`)
}
