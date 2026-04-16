import { apiFetch, TOKEN_KEY } from './client'

export interface KmDocument {
  id: number
  filename: string
  content_type: string | null
  size_bytes: number | null
  scope: 'private' | 'public'
  status: 'pending' | 'processing' | 'ready' | 'error'
  error_message: string | null
  chunk_count: number | null
  created_at: string
}

export async function listKmDocuments(scope?: 'private' | 'public'): Promise<KmDocument[]> {
  const params = scope ? `?scope=${scope}` : ''
  return apiFetch<KmDocument[]>(`/km/documents${params}`)
}

export async function deleteKmDocument(docId: number): Promise<void> {
  return apiFetch<void>(`/km/documents/${docId}`, { method: 'DELETE' })
}

export async function uploadKmDocument(
  file: File,
  scope: 'private' | 'public',
  onProgress?: (percent: number) => void
): Promise<KmDocument> {
  const form = new FormData()
  form.append('file', file)
  form.append('scope', scope)

  // 使用 XMLHttpRequest 支援進度回報
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const token = localStorage.getItem(TOKEN_KEY)

    xhr.open('POST', '/api/v1/km/documents')
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as KmDocument)
        } catch {
          reject(new Error('回應解析失敗'))
        }
      } else {
        let detail = `HTTP ${xhr.status}`
        try {
          const body = JSON.parse(xhr.responseText) as { detail?: string }
          if (typeof body?.detail === 'string') detail = body.detail
        } catch {
          /* ignore */
        }
        reject(new Error(detail))
      }
    }
    xhr.onerror = () => reject(new Error('網路錯誤'))
    xhr.send(form)
  })
}
