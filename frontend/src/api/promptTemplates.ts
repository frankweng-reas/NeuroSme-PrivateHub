import { apiFetch } from './client'

export interface PromptTemplateItem {
  id: number
  name: string
  content: string
  created_at: string
  updated_at: string
}

/** 取得該 agent 的範本列表 */
export async function listPromptTemplates(agentId: string): Promise<PromptTemplateItem[]> {
  return apiFetch<PromptTemplateItem[]>(
    `/prompt-templates/?agent_id=${encodeURIComponent(agentId)}`
  )
}

/** 建立範本 */
export async function createPromptTemplate(
  agentId: string,
  name: string,
  content: string
): Promise<PromptTemplateItem> {
  return apiFetch<PromptTemplateItem>('/prompt-templates/', {
    method: 'POST',
    body: JSON.stringify({
      agent_id: agentId,
      name,
      content,
    }),
  })
}

/** 更新範本 */
export async function updatePromptTemplate(
  id: number,
  data: { name?: string; content?: string }
): Promise<PromptTemplateItem> {
  return apiFetch<PromptTemplateItem>(`/prompt-templates/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

/** 刪除範本 */
export async function deletePromptTemplate(id: number): Promise<void> {
  await apiFetch<undefined>(`/prompt-templates/${id}`, {
    method: 'DELETE',
  })
}
