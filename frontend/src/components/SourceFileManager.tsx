/** 來源檔案管理：使用 SourceListManager + SourceFileAdapter */
import { useMemo } from 'react'
import SourceListManager from '@/components/SourceListManager'
import { createSourceFileAdapter } from '@/adapters/sourceFileAdapter'

export interface SourceFileManagerProps {
  agentId: string
  onError?: (message: string) => void
  headerActions?: React.ReactNode
}

export default function SourceFileManager({
  agentId,
  onError,
  headerActions,
}: SourceFileManagerProps) {
  const adapter = useMemo(() => createSourceFileAdapter(agentId), [agentId])

  return (
    <SourceListManager
      adapter={adapter}
      title="來源"
      showHelp={true}
      helpUrl="/help-sourcefile.md"
      headerActions={headerActions}
      onError={onError}
    />
  )
}
