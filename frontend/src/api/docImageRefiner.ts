import { apiFetch } from './client'
import { TOKEN_KEY } from '@/contexts/AuthContext'

const API_BASE = '/api/v1'

export interface ExtractionTopic {
  name: string
  hint: string
}

export interface DocImageConfig {
  id: number
  name: string
  model: string
  extraction_topics: ExtractionTopic[]
  created_at: string
  updated_at: string
}

export interface DocImageHistoryItem {
  id: number
  filename: string
  raw_text: string
  result_markdown: string
  status: string
  error_message: string | null
  created_at: string
}

// ── Config CRUD ───────────────────────────────────────────────────────────────

export async function listDocImageConfigs(): Promise<DocImageConfig[]> {
  return apiFetch<DocImageConfig[]>('/doc-refiner/image-config')
}

export async function createDocImageConfig(body: {
  name: string
  model: string
  extraction_topics: ExtractionTopic[]
}): Promise<DocImageConfig> {
  return apiFetch<DocImageConfig>('/doc-refiner/image-config', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function updateDocImageConfig(
  id: number,
  body: Partial<{
    name: string
    model: string
    extraction_topics: ExtractionTopic[]
  }>,
): Promise<DocImageConfig> {
  return apiFetch<DocImageConfig>(`/doc-refiner/image-config/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export async function deleteDocImageConfig(id: number): Promise<void> {
  return apiFetch<void>(`/doc-refiner/image-config/${id}`, { method: 'DELETE' })
}

// ── Processing ────────────────────────────────────────────────────────────────

export async function processDocImage(configId: number, file: File, model?: string): Promise<DocImageHistoryItem> {
  const fd = new FormData()
  fd.append('file', file)
  if (model) fd.append('model', model)
  return apiFetch<DocImageHistoryItem>(`/doc-refiner/image-config/${configId}/process`, {
    method: 'POST',
    body: fd,
    timeout: 300_000, // 多頁 PDF OCR 可能需要較長時間
  })
}

// ── History ───────────────────────────────────────────────────────────────────

export async function listDocImageHistory(configId: number): Promise<DocImageHistoryItem[]> {
  return apiFetch<DocImageHistoryItem[]>(`/doc-refiner/image-config/${configId}/history`)
}

export async function updateDocImageHistoryMarkdown(
  configId: number,
  historyId: number,
  resultMarkdown: string,
): Promise<DocImageHistoryItem> {
  return apiFetch<DocImageHistoryItem>(`/doc-refiner/image-config/${configId}/history/${historyId}`, {
    method: 'PATCH',
    body: JSON.stringify({ result_markdown: resultMarkdown }),
  })
}

export async function deleteDocImageHistoryItem(configId: number, historyId: number): Promise<void> {
  return apiFetch<void>(`/doc-refiner/image-config/${configId}/history/${historyId}`, { method: 'DELETE' })
}

// ── KB 匯入（reuse doc-refiner 的 importMdToKB）────────────────────────────

export interface ImportMdToKBRequest {
  title: string
  markdown: string
  kb_id?: number
  new_kb_name?: string
  doc_type?: string
}

export interface ImportToKBResponse {
  kb_name: string
  imported_count: number
}

export async function importDocImageToKB(req: ImportMdToKBRequest): Promise<ImportToKBResponse> {
  const token = localStorage.getItem(TOKEN_KEY)
  const payload = { doc_type: 'doc_image', ...req }
  const res = await fetch(`${API_BASE}/doc-refiner/import-md-to-kb`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch { /* ignore */ }
    throw new Error(detail || '匯入失敗')
  }
  return res.json() as Promise<ImportToKBResponse>
}
