import { apiFetch } from './client'

export interface QtnSourceItem {
  source_id: string
  project_id: string
  source_type: string
  file_name: string
  content: string | null
  created_at: string
}

export async function createQtnSource(params: {
  project_id: string
  source_type: 'OFFERING' | 'REQUIREMENT'
  file_name: string
  content?: string | null
}): Promise<QtnSourceItem> {
  return apiFetch<QtnSourceItem>('/qtn-sources/', {
    method: 'POST',
    body: JSON.stringify({
      ...params,
      content: params.content ?? null,
    }),
  })
}

export async function listQtnSources(
  projectId: string,
  sourceType?: 'OFFERING' | 'REQUIREMENT'
): Promise<QtnSourceItem[]> {
  const params = new URLSearchParams({ project_id: projectId })
  if (sourceType) params.set('source_type', sourceType)
  return apiFetch<QtnSourceItem[]>(`/qtn-sources/?${params}`)
}

export async function updateQtnSource(
  sourceId: string,
  params: { file_name?: string; content?: string }
): Promise<QtnSourceItem> {
  return apiFetch<QtnSourceItem>(`/qtn-sources/${encodeURIComponent(sourceId)}`, {
    method: 'PATCH',
    body: JSON.stringify(params),
  })
}

export async function deleteQtnSource(sourceId: string): Promise<void> {
  await apiFetch<undefined>(`/qtn-sources/${encodeURIComponent(sourceId)}`, {
    method: 'DELETE',
  })
}
