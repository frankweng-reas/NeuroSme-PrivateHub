import {
  createQtnSource,
  deleteQtnSource,
  listQtnSources,
  updateQtnSource,
} from '@/api/qtnSources'
import type { SourceListAdapter } from './sourceListAdapter'

export function createQtnSourceAdapter(
  projectId: string,
  sourceType: 'OFFERING' | 'REQUIREMENT'
): SourceListAdapter {
  return {
    config: {
      supportsCheckbox: false,
      fileAccept: '.csv,.txt,.md,.json',
      fileUploadLabel: '選擇檔案（CSV、TXT 等）',
      emptyMessage: '尚無來源',
    },
    list: async () => {
      const items = await listQtnSources(projectId, sourceType)
      return items.map((s) => ({
        id: s.source_id,
        file_name: s.file_name,
        content: s.content,
      }))
    },
    createFromText: async ({ file_name, content }) => {
      const item = await createQtnSource({
        project_id: projectId,
        source_type: sourceType,
        file_name,
        content,
      })
      return {
        id: item.source_id,
        file_name: item.file_name,
        content: item.content,
      }
    },
    uploadFile: async (file) => {
      const content = await file.text()
      const item = await createQtnSource({
        project_id: projectId,
        source_type: sourceType,
        file_name: file.name,
        content,
      })
      return {
        id: item.source_id,
        file_name: item.file_name,
        content: item.content,
      }
    },
    update: async ({ id, file_name, content }) => {
      const updates: { file_name?: string; content?: string } = {}
      if (file_name !== undefined) updates.file_name = file_name
      if (content !== undefined) updates.content = content
      const item = await updateQtnSource(id, updates)
      return {
        id: item.source_id,
        file_name: item.file_name,
        content: item.content,
      }
    },
    delete: (id) => deleteQtnSource(id),
    getContent: undefined, // list 已含 content
  }
}
