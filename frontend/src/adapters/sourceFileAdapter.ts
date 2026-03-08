import {
  listSourceFiles,
  uploadSourceFile,
  createSourceFileFromText,
  updateSourceFileSelected,
  renameSourceFile,
  deleteSourceFile,
  getSourceFile,
  updateSourceFileContent,
} from '@/api/sourceFiles'
import type { SourceListAdapter } from './sourceListAdapter'

export function createSourceFileAdapter(agentId: string): SourceListAdapter {
  return {
    config: {
      supportsCheckbox: true,
      fileAccept: '.csv',
      fileUploadLabel: '選擇 CSV 檔案（可多選）',
      emptyMessage: '尚無來源檔案',
    },
    list: async () => {
      const items = await listSourceFiles(agentId)
      return items.map((f) => ({
        id: String(f.id),
        file_name: f.file_name,
        is_selected: f.is_selected,
      }))
    },
    createFromText: async ({ file_name, content }) => {
      const item = await createSourceFileFromText(agentId, file_name, content)
      return {
        id: String(item.id),
        file_name: item.file_name,
        is_selected: item.is_selected,
      }
    },
    uploadFile: async (file) => {
      const item = await uploadSourceFile(agentId, file)
      return {
        id: String(item.id),
        file_name: item.file_name,
        is_selected: item.is_selected,
      }
    },
    update: async ({ id, file_name, content, is_selected }) => {
      const numId = parseInt(id, 10)
      if (is_selected !== undefined) {
        const item = await updateSourceFileSelected(numId, is_selected)
        return {
          id: String(item.id),
          file_name: item.file_name,
          is_selected: item.is_selected,
        }
      }
      if (file_name !== undefined) {
        const item = await renameSourceFile(numId, file_name)
        return {
          id: String(item.id),
          file_name: item.file_name,
          is_selected: item.is_selected,
        }
      }
      if (content !== undefined) {
        const item = await updateSourceFileContent(numId, content)
        return {
          id: String(item.id),
          file_name: item.file_name,
          is_selected: item.is_selected,
        }
      }
      const items = await listSourceFiles(agentId)
      const found = items.find((f) => String(f.id) === id)
      if (!found) throw new Error('Not found')
      return {
        id: String(found.id),
        file_name: found.file_name,
        is_selected: found.is_selected,
      }
    },
    delete: (id) => deleteSourceFile(parseInt(id, 10)),
    getContent: async (id) => {
      const detail = await getSourceFile(parseInt(id, 10))
      return detail.content
    },
  }
}
