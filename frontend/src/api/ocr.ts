import { apiFetch } from './client'

export interface OcrOutputField {
  name: string
  hint: string
}

export interface OcrConfig {
  id: number
  name: string
  data_type_label: string
  model: string
  output_fields: OcrOutputField[]
  created_at: string
  updated_at: string
}

export interface OcrHistoryItem {
  id: number
  filename: string
  raw_text: string
  extracted_fields: Record<string, string | null>
  status: string
  error_message: string | null
  created_at: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  } | null
}

export interface OcrTemplate {
  id: string
  label: string
  data_type_label: string
  fields: OcrOutputField[]
}

export async function listOcrTemplates(): Promise<OcrTemplate[]> {
  return apiFetch<OcrTemplate[]>('/ocr/templates')
}

export async function listOcrConfigs(): Promise<OcrConfig[]> {
  return apiFetch<OcrConfig[]>('/ocr')
}

export async function createOcrConfig(body: {
  name: string
  data_type_label: string
  model: string
  output_fields: OcrOutputField[]
}): Promise<OcrConfig> {
  return apiFetch<OcrConfig>('/ocr', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function updateOcrConfig(
  id: number,
  body: Partial<{
    name: string
    data_type_label: string
    model: string
    output_fields: OcrOutputField[]
  }>,
): Promise<OcrConfig> {
  return apiFetch<OcrConfig>(`/ocr/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export async function deleteOcrConfig(id: number): Promise<void> {
  return apiFetch<void>(`/ocr/${id}`, { method: 'DELETE' })
}

export async function extractOcr(configId: number, file: File): Promise<OcrHistoryItem> {
  const fd = new FormData()
  fd.append('file', file)
  return apiFetch<OcrHistoryItem>(`/ocr/${configId}/extract`, {
    method: 'POST',
    body: fd,
    timeout: 200_000,  // vision 模型最長 180s，留緩衝
  })
}

export async function listOcrHistory(configId: number): Promise<OcrHistoryItem[]> {
  return apiFetch<OcrHistoryItem[]>(`/ocr/${configId}/history`)
}

export async function deleteOcrHistoryItem(configId: number, historyId: number): Promise<void> {
  return apiFetch<void>(`/ocr/${configId}/history/${historyId}`, { method: 'DELETE' })
}

export async function updateOcrHistoryFields(
  configId: number,
  historyId: number,
  extractedFields: Record<string, string | null>,
): Promise<OcrHistoryItem> {
  return apiFetch<OcrHistoryItem>(`/ocr/${configId}/history/${historyId}`, {
    method: 'PATCH',
    body: JSON.stringify({ extracted_fields: extractedFields }),
  })
}

export function ocrExportCsvUrl(configId: number): string {
  return `/api/v1/ocr/${configId}/history/export/csv`
}
