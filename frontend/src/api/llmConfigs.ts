import { apiFetch } from './client'
import type { LLMProviderConfig } from '@/types'

export interface LLMProviderConfigCreate {
  provider: string
  label?: string | null
  api_key?: string | null
  api_base_url?: string | null
  default_model?: string | null
  available_models?: string[] | null
  is_active?: boolean
}

export interface LLMProviderConfigUpdate {
  label?: string | null
  api_key?: string | null
  api_base_url?: string | null
  default_model?: string | null
  available_models?: string[] | null
  is_active?: boolean | null
}

/** 取得目前租戶的 LLM provider 設定（需 admin 或 super_admin） */
export async function listLLMConfigs(): Promise<LLMProviderConfig[]> {
  return apiFetch<LLMProviderConfig[]>('/llm-configs/')
}

/** 取得各 provider 的預設可選模型清單（無需登入） */
export async function getLLMProviderOptions(): Promise<Record<string, string[]>> {
  return apiFetch<Record<string, string[]>>('/llm-configs/providers')
}

export interface LLMModelOption {
  value: string
  label: string
}

/** 依租戶 DB 的 llm_provider_config 組合模型清單（需登入） */
export async function getLLMModelOptions(): Promise<LLMModelOption[]> {
  return apiFetch<LLMModelOption[]>('/llm-configs/model-options')
}

/** 新增 LLM provider 設定 */
export async function createLLMConfig(body: LLMProviderConfigCreate): Promise<LLMProviderConfig> {
  return apiFetch<LLMProviderConfig>('/llm-configs/', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/** 更新 LLM provider 設定 */
export async function updateLLMConfig(id: number, body: LLMProviderConfigUpdate): Promise<LLMProviderConfig> {
  return apiFetch<LLMProviderConfig>(`/llm-configs/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

/** 刪除 LLM provider 設定 */
export async function deleteLLMConfig(id: number): Promise<void> {
  return apiFetch(`/llm-configs/${id}`, { method: 'DELETE' })
}

export interface LLMTestResult {
  ok: boolean
  elapsed_ms: number
  reply?: string
  error?: string
}

/** 測試 LLM provider 連通性 */
export async function testLLMConfig(id: number): Promise<LLMTestResult> {
  return apiFetch<LLMTestResult>(`/llm-configs/${id}/test`, { method: 'POST' })
}
