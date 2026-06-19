/**
 * Agent 執行進度彈窗
 * 顯示 agent 正在執行的查詢步驟，完成後自動關閉。
 */
import { useEffect, useRef } from 'react'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import type { AgentStepEvent } from '@/api/chat'

interface Props {
  steps: AgentStepEvent[]
  visible: boolean
  finalizing: boolean   // 所有查詢結束，正在生成最終分析
}

const MAX_QUERY_DISPLAY = 40

function trimQuery(q: string): string {
  return q.length > MAX_QUERY_DISPLAY ? q.slice(0, MAX_QUERY_DISPLAY) + '…' : q
}

export default function AgentProgressOverlay({ steps, visible, finalizing }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [steps, finalizing])

  if (!visible) return null

  // 合併同一 step 的 running/done 狀態：以最新狀態為準
  const stepMap = new Map<number, AgentStepEvent>()
  for (const s of steps) {
    const prev = stepMap.get(s.step)
    if (!prev || s.phase === 'done') stepMap.set(s.step, s)
  }
  const displaySteps = Array.from(stepMap.values()).sort((a, b) => a.step - b.step)

  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-end justify-center pb-24">
      <div
        className="pointer-events-auto w-full max-w-sm rounded-2xl border border-gray-200 bg-white/95 px-4 py-3 shadow-xl backdrop-blur-sm"
        style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}
      >
        {/* 標題 */}
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
          分析中
        </p>

        {/* 步驟列表 */}
        <div className="space-y-1.5">
          {displaySteps.map((s) => (
            <div key={s.step} className="flex items-center gap-2">
              {s.phase === 'running' ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />
              ) : s.success !== false ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
              ) : (
                <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
              )}
              <span className="truncate text-sm text-gray-700">
                {trimQuery(s.query)}
              </span>
            </div>
          ))}

          {/* 最終整理中 */}
          {finalizing && (
            <div className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-purple-500" />
              <span className="text-sm text-gray-500">整理分析中…</span>
            </div>
          )}
        </div>

        <div ref={bottomRef} />
      </div>
    </div>
  )
}
