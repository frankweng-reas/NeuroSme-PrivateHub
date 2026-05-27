import { apiFetch } from './client'

export interface LlmSkill {
  id: number
  title: string
  category: string | null
  description: string | null
  prompt: string
  sort_order: number
  created_at: string
  updated_at: string
}

export async function listLlmSkills(): Promise<LlmSkill[]> {
  return apiFetch<LlmSkill[]>('/llm-skills')
}

export async function createLlmSkill(body: {
  title: string
  category?: string | null
  description?: string | null
  prompt: string
  sort_order?: number
}): Promise<LlmSkill> {
  return apiFetch<LlmSkill>('/llm-skills', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function updateLlmSkill(
  id: number,
  body: {
    title?: string
    category?: string | null
    description?: string | null
    prompt?: string
    sort_order?: number
  },
): Promise<LlmSkill> {
  return apiFetch<LlmSkill>(`/llm-skills/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export async function deleteLlmSkill(id: number): Promise<void> {
  await apiFetch<void>(`/llm-skills/${id}`, { method: 'DELETE' })
}
