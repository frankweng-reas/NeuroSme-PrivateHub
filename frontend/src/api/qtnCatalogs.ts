import { apiFetch } from './client'

export interface QtnCatalogItem {
  catalog_id: string
  tenant_id: string
  catalog_name: string
  content: string | null
  is_default: boolean
  created_at: string
}

export async function deleteQtnCatalog(catalogId: string): Promise<void> {
  return apiFetch(`/qtn-catalogs/${catalogId}`, { method: 'DELETE' })
}

export async function createQtnCatalog(params: {
  catalog_name: string
  content: string
  is_default?: boolean
}): Promise<QtnCatalogItem> {
  return apiFetch<QtnCatalogItem>('/qtn-catalogs/', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export async function listQtnCatalogs(): Promise<QtnCatalogItem[]> {
  return apiFetch<QtnCatalogItem[]>('/qtn-catalogs/')
}
