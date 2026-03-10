import { apiFetch } from './client'
import type { Company } from '@/types'

/** 取得公司列表（需 admin 權限） */
export async function listCompanies(): Promise<Company[]> {
  return apiFetch<Company[]>('/companies/')
}

/** 新增公司 */
export async function createCompany(data: Partial<Company>): Promise<Company> {
  return apiFetch<Company>('/companies/', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

/** 更新公司 */
export async function updateCompany(id: string, data: Partial<Company>): Promise<Company> {
  return apiFetch<Company>(`/companies/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

/** 刪除公司 */
export async function deleteCompany(id: string): Promise<void> {
  return apiFetch(`/companies/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}
