import { apiFetch } from './client'
import type { LLMProviderConfig, LLMModelEntry } from '@/types'

// ── Tenant Config ─────────────────────────────────────────────────────────────

export interface TenantConfig {
  tenant_id: string
  default_llm_provider: string | null
  default_llm_model: string | null
  analysis_llm_model: string | null
  embedding_provider: string
  embedding_model: string
  embedding_locked_at: string | null
  embedding_version: number
  speech_provider: string | null
  speech_base_url: string | null
  speech_api_key_masked: string | null
  speech_model: string | null
  updated_at: string
}

export interface DefaultLLMUpdate {
  provider: string
  model: string
}

export interface EmbeddingMigrateRequest {
  provider: string
  model: string
  confirm: boolean
}

export async function getTenantConfig(): Promise<TenantConfig> {
  return apiFetch<TenantConfig>('/llm-configs/tenant-config')
}

export async function updateDefaultLLM(body: DefaultLLMUpdate): Promise<TenantConfig> {
  return apiFetch<TenantConfig>('/llm-configs/tenant-config/default-model', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export async function updateAnalysisModel(model: string | null): Promise<TenantConfig> {
  return apiFetch<TenantConfig>('/llm-configs/tenant-config/analysis-model', {
    method: 'PATCH',
    body: JSON.stringify({ model: model ?? null }),
  })
}

export async function migrateEmbedding(body: EmbeddingMigrateRequest): Promise<TenantConfig> {
  return apiFetch<TenantConfig>('/llm-configs/tenant-config/embedding/migrate', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export interface EmbeddingTestResult {
  ok: boolean
  elapsed_ms: number
  model: string
  dimensions?: number
  error?: string
}

export async function testEmbedding(): Promise<EmbeddingTestResult> {
  return apiFetch<EmbeddingTestResult>('/llm-configs/tenant-config/embedding/test', {
    method: 'POST',
    timeout: 25_000,
  })
}

export interface EmbeddingTestCandidateRequest {
  provider: string
  model: string
}

export interface EmbeddingTestCandidateResult extends EmbeddingTestResult {
  provider?: string
  dim_warning?: string | null
}

/** 測試候選的 embedding provider/model（尚未儲存），不影響現有向量資料 */
export async function testEmbeddingCandidate(
  body: EmbeddingTestCandidateRequest
): Promise<EmbeddingTestCandidateResult> {
  return apiFetch<EmbeddingTestCandidateResult>('/llm-configs/tenant-config/embedding/test-candidate', {
    method: 'POST',
    body: JSON.stringify(body),
    timeout: 25_000,
  })
}

// ── Provider Configs ──────────────────────────────────────────────────────────

export interface LLMProviderConfigCreate {
  provider: string
  label?: string | null
  api_key?: string | null
  api_base_url?: string | null
  gcp_project_id?: string | null
  gcp_region?: string | null
  available_models?: LLMModelEntry[] | null
  is_active?: boolean
}

export interface LLMProviderConfigUpdate {
  label?: string | null
  api_key?: string | null
  api_base_url?: string | null
  gcp_project_id?: string | null
  gcp_region?: string | null
  available_models?: LLMModelEntry[] | null
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
  note?: string | null
}

export { type LLMModelEntry }

/** 依租戶 DB 的 llm_provider_config 組合模型清單（需登入），依使用者 allowed_models 過濾 */
export async function getLLMModelOptions(): Promise<LLMModelOption[]> {
  return apiFetch<LLMModelOption[]>('/llm-configs/model-options')
}

/** 管理介面專用：回傳租戶全部模型，不套用 per-user 過濾（需 admin） */
export async function getAllLLMModelOptions(): Promise<LLMModelOption[]> {
  return apiFetch<LLMModelOption[]>('/llm-configs/all-model-options')
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

// ── Speech Config ──────────────────────────────────────────────────────────────

export interface SpeechConfigUpdate {
  provider?: string | null
  base_url?: string | null
  api_key?: string | null
  model?: string | null
}

export interface SpeechTestResult {
  ok: boolean
  elapsed_ms?: number
  base_url?: string
  error?: string
}

export async function updateSpeechConfig(body: SpeechConfigUpdate): Promise<TenantConfig> {
  return apiFetch<TenantConfig>('/llm-configs/tenant-config/speech', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export async function testSpeechConfig(): Promise<SpeechTestResult> {
  return apiFetch<SpeechTestResult>('/llm-configs/tenant-config/speech/test', {
    method: 'POST',
  })
}

/** 測試候選的語音服務連線（尚未儲存），不影響現有設定
 *  - local：ping base_url/health
 *  - openai / custom:{id}：從 LLMProviderConfig 取 api_base_url，打 /v1/models
 */
export async function testSpeechCandidate(params: { base_url?: string; provider: string }): Promise<SpeechTestResult> {
  return apiFetch<SpeechTestResult>('/llm-configs/tenant-config/speech/test-candidate', {
    method: 'POST',
    body: JSON.stringify({ base_url: params.base_url ?? '', provider: params.provider }),
    timeout: 12_000,
  })
}

export interface LLMTestResult {
  ok: boolean
  elapsed_ms: number
  reply?: string
  error?: string
}

/** 測試 LLM provider 連通性（可指定 model） */
export async function testLLMConfig(id: number, model?: string): Promise<LLMTestResult> {
  return apiFetch<LLMTestResult>(`/llm-configs/${id}/test`, {
    method: 'POST',
    body: JSON.stringify({ model: model ?? null }),
  })
}
