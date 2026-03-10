import { apiFetch } from './client'

export interface QtnProjectItem {
  project_id: string
  project_name: string
  project_desc: string | null
  created_at: string
  qtn_draft?: Record<string, unknown> | null
  qtn_final?: Record<string, unknown> | null
  status?: string
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

export async function updateQtnProject(
  agentId: string,
  projectId: string,
  params: { project_name: string; project_desc?: string | null }
): Promise<QtnProjectItem> {
  return apiFetch<QtnProjectItem>(
    `/qtn-projects/${encodeURIComponent(projectId)}?agent_id=${encodeURIComponent(agentId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(params),
    }
  )
}

export async function getNextQuotationNo(agentId: string): Promise<{ quotation_no: string }> {
  return apiFetch<{ quotation_no: string }>(
    `/qtn-projects/next-quotation-no?agent_id=${encodeURIComponent(agentId)}`
  )
}

export async function updateQtnDraft(
  agentId: string,
  projectId: string,
  qtnDraft: Record<string, unknown> | null
): Promise<QtnProjectItem> {
  return apiFetch<QtnProjectItem>(
    `/qtn-projects/${encodeURIComponent(projectId)}/qtn-draft?agent_id=${encodeURIComponent(agentId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ qtn_draft: qtnDraft }),
    }
  )
}

export async function updateQtnFinal(
  agentId: string,
  projectId: string,
  qtnFinal: Record<string, unknown> | null
): Promise<QtnProjectItem> {
  return apiFetch<QtnProjectItem>(
    `/qtn-projects/${encodeURIComponent(projectId)}/qtn-final?agent_id=${encodeURIComponent(agentId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ qtn_final: qtnFinal }),
    }
  )
}

export async function updateQtnStatus(
  agentId: string,
  projectId: string,
  status: string
): Promise<QtnProjectItem> {
  return apiFetch<QtnProjectItem>(
    `/qtn-projects/${encodeURIComponent(projectId)}/status?agent_id=${encodeURIComponent(agentId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }
  )
}

export async function deleteQtnProject(agentId: string, projectId: string): Promise<void> {
  await apiFetch(
    `/qtn-projects/${encodeURIComponent(projectId)}?agent_id=${encodeURIComponent(agentId)}`,
    { method: 'DELETE' }
  )
}
