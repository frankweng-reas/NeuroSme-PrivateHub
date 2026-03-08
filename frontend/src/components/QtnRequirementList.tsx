/** 需求描述：使用 SourceListManager + QtnSourceAdapter，UI 與 SourceFileManager 統一 */
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import SourceListManager from '@/components/SourceListManager'
import { createQtnSourceAdapter } from '@/adapters/qtnSourceAdapter'

export interface QtnRequirementListProps {
  projectId: string | null
  collapsible?: boolean
}

export default function QtnRequirementList({
  projectId,
  collapsible = true,
}: QtnRequirementListProps) {
  const [collapsed, setCollapsed] = useState(false)
  const adapter = useMemo(
    () => (projectId ? createQtnSourceAdapter(projectId, 'REQUIREMENT') : null),
    [projectId]
  )

  if (!projectId) {
    return (
      <div className="flex h-full min-h-0 flex-col rounded-xl border border-gray-200 bg-gray-50/50">
        <div className="rounded-t-xl bg-emerald-100 px-4 py-3">
          <h4 className="text-base font-medium text-gray-700">需求描述</h4>
        </div>
        <p className="px-4 py-4 text-base text-gray-500">請先選擇專案</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-gray-200 bg-gray-50/50">
      <button
        type="button"
        className={`flex shrink-0 w-full items-center justify-between rounded-t-xl bg-emerald-100 px-4 py-3 text-left ${collapsible ? '' : 'cursor-default'}`}
        onClick={collapsible ? () => setCollapsed((c) => !c) : undefined}
      >
        <h4 className="text-base font-medium text-gray-700">需求描述</h4>
        {collapsible && (
          <span className="text-gray-500">
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </span>
        )}
      </button>
      {!collapsed && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-gray-200">
          <SourceListManager adapter={adapter!} title="" showHelp={false} hideHeader={true} />
        </div>
      )}
    </div>
  )
}
