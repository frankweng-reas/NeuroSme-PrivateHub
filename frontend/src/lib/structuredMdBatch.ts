import { toMarkdownStream } from '@/api/docRefiner'

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
  }
}

export type BatchFileStatus = 'pending' | 'processing' | 'saved' | 'error'

export interface BatchFileItem {
  id: string
  file: File
  status: BatchFileStatus
  error?: string
  outputName?: string
}

export interface BatchSummary {
  total: number
  saved: number
  failed: number
}

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

export async function pickOutputDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!isFileSystemAccessSupported() || !window.showDirectoryPicker) {
    throw new Error('此瀏覽器不支援選擇資料夾，請使用 Chrome 或 Edge')
  }
  return window.showDirectoryPicker({ mode: 'readwrite' })
}

function basenameWithoutExt(filename: string): string {
  return filename.replace(/\.pdf$/i, '') || 'document'
}

function outputFilename(file: File): string {
  return `${basenameWithoutExt(file.name)}.md`
}

async function writeMarkdownToDirectory(
  dir: FileSystemDirectoryHandle,
  filename: string,
  content: string,
): Promise<void> {
  const handle = await dir.getFileHandle(filename, { create: true })
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()
}

function downloadMarkdownFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown; charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export interface BatchFileProgress {
  status: string
  chunk?: { current: number; total: number }
}

async function convertFileToMarkdown(
  file: File,
  model: string | undefined,
  signal: AbortSignal,
  pdfMode: 'text' | 'image' | 'auto' = 'auto',
  onProgress?: (info: BatchFileProgress) => void,
): Promise<string> {
  let content = ''
  for await (const event of toMarkdownStream(file, model, signal, pdfMode)) {
    if (event.type === 'extract_progress') {
      onProgress?.({
        status: event.detail || `第 ${event.page}/${event.page_count} 頁`,
      })
    } else if (event.type === 'meta') {
      content = ''
      onProgress?.({
        status: 'AI 結構化中…',
        chunk: { current: 0, total: event.chunk_total },
      })
    } else if (event.type === 'md_chunk') {
      const sep = content && !content.endsWith('\n') ? '\n\n' : content ? '\n' : ''
      content += sep + event.content
      onProgress?.({
        status: 'AI 結構化中…',
        chunk: { current: event.chunk, total: event.chunk_total },
      })
    } else if (event.type === 'done') {
      return content
    } else if (event.type === 'error') {
      throw new Error(event.detail)
    }
  }
  if (!content.trim()) {
    throw new Error('未收到 Markdown 內容')
  }
  return content
}

export interface RunBatchOptions {
  files: File[]
  outputDir?: FileSystemDirectoryHandle | null
  model?: string
  pdfMode?: 'text' | 'image' | 'auto'
  signal?: AbortSignal
  onFileStart?: (index: number, file: File) => void
  onFileProgress?: (index: number, file: File, info: BatchFileProgress) => void
  onFileDone?: (index: number, file: File, outputName: string) => void
  onFileError?: (index: number, file: File, error: string) => void
}

export async function runBatch(options: RunBatchOptions): Promise<BatchSummary> {
  const { files, outputDir, model, pdfMode = 'auto', signal, onFileStart, onFileProgress, onFileDone, onFileError } = options
  let saved = 0
  let failed = 0

  for (let i = 0; i < files.length; i++) {
    if (signal?.aborted) break
    const file = files[i]
    onFileStart?.(i, file)
    const outName = outputFilename(file)

    try {
      const markdown = await convertFileToMarkdown(
        file,
        model,
        signal ?? new AbortController().signal,
        pdfMode,
        (info) => onFileProgress?.(i, file, info),
      )
      if (outputDir) {
        await writeMarkdownToDirectory(outputDir, outName, markdown)
      } else {
        downloadMarkdownFile(outName, markdown)
      }
      saved++
      onFileDone?.(i, file, outName)
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : '轉換失敗'
      onFileError?.(i, file, msg)
    }
  }

  return { total: files.length, saved, failed }
}

export function isStructuredMdFile(file: File): boolean {
  return /\.pdf$/i.test(file.name)
}

export function isBatchItemRunnable(status: BatchFileStatus): boolean {
  return status === 'pending' || status === 'error'
}

export function createBatchItems(files: File[]): BatchFileItem[] {
  return files.map((file, idx) => ({
    id: `${file.name}-${file.size}-${idx}`,
    file,
    status: 'pending' as const,
  }))
}
