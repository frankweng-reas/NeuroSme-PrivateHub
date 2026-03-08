/** 來源清單 Adapter 介面：統一 UI，僅資料來源不同 */

export interface SourceListItem {
  id: string
  file_name: string
  is_selected?: boolean
  content?: string | null
}

export interface SourceListAdapterConfig {
  /** 是否支援 checkbox 選用 */
  supportsCheckbox: boolean
  /** 檔案上傳 accept，如 ".csv" 或 ".csv,.txt,.md,.json" */
  fileAccept?: string
  /** 檔案上傳區塊說明文字 */
  fileUploadLabel?: string
  /** 空列表提示 */
  emptyMessage?: string
}

export interface SourceListAdapter {
  config: SourceListAdapterConfig
  list: () => Promise<SourceListItem[]>
  createFromText: (params: { file_name: string; content: string }) => Promise<SourceListItem>
  uploadFile: (file: File) => Promise<SourceListItem>
  update: (params: {
    id: string
    file_name?: string
    content?: string
    is_selected?: boolean
  }) => Promise<SourceListItem>
  delete: (id: string) => Promise<void>
  /** 取得內容（當 list 不含 content 時需額外取得） */
  getContent?: (id: string) => Promise<string>
}
