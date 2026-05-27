import { apiFetch } from './client'

export interface WritingDoc {
  id: number
  title: string
  content: string | null
  user_prompt: string | null
  draft: string | null
  created_at: string
  updated_at: string
}

export async function listWritingDocs(): Promise<WritingDoc[]> {
  return apiFetch<WritingDoc[]>('/writing-documents')
}

export async function createWritingDoc(body: {
  title: string
  content?: string | null
  user_prompt?: string | null
}): Promise<WritingDoc> {
  return apiFetch<WritingDoc>('/writing-documents', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function updateWritingDoc(
  id: number,
  body: {
    title?: string
    content?: string | null
    user_prompt?: string | null
    draft?: string | null
  },
): Promise<WritingDoc> {
  return apiFetch<WritingDoc>(`/writing-documents/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export async function deleteWritingDoc(id: number): Promise<void> {
  await apiFetch<void>(`/writing-documents/${id}`, { method: 'DELETE' })
}
