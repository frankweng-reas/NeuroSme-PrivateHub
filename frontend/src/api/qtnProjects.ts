import { apiFetch } from './client'

export interface QtnProjectItem {
  project_id: string
  project_name: string
  project_desc: string | null
  created_at: string
}

export async function createQtnProject(params: {
  agent_id: string
  project_name: string
  project_desc?: string | null
}): Promise<QtnProjectItem> {
  return apiFetch<QtnProjectItem>('/qtn-projects/', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export async function listQtnProjects(agentId: string): Promise<QtnProjectItem[]> {
  return apiFetch<QtnProjectItem[]>(
    `/qtn-projects/?agent_id=${encodeURIComponent(agentId)}`
  )
}
