/** Estimator API client */
import { apiFetch } from './client'

export interface EstimatorField {
  key: string
  label: string
  unit: string
  type: 'number' | 'percent' | 'currency'
}

export interface EstimatorOutput {
  key: string
  label: string
  formula: string
}

export interface EstimatorSchemaData {
  fields: EstimatorField[]
  outputs: EstimatorOutput[]
}

export interface EstimatorTemplate {
  id: string
  name: string
  schema_data: EstimatorSchemaData
  created_at: string
  updated_at: string
}

export async function listEstimatorTemplates(): Promise<EstimatorTemplate[]> {
  return apiFetch<EstimatorTemplate[]>('/estimator/templates')
}

export async function createEstimatorTemplate(
  name: string,
  schema_data: EstimatorSchemaData,
): Promise<EstimatorTemplate> {
  return apiFetch<EstimatorTemplate>('/estimator/templates', {
    method: 'POST',
    body: JSON.stringify({ name, schema_data }),
  })
}

export async function updateEstimatorTemplate(
  id: string,
  name: string,
  schema_data: EstimatorSchemaData,
): Promise<EstimatorTemplate> {
  return apiFetch<EstimatorTemplate>(`/estimator/templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name, schema_data }),
  })
}

export async function deleteEstimatorTemplate(id: string): Promise<void> {
  await apiFetch<void>(`/estimator/templates/${id}`, { method: 'DELETE' })
}
