/** agent_id 含 customer 時使用：客戶型 agent 專用 UI */
import AgentHeader from '@/components/AgentHeader'
import type { Agent } from '@/types'

interface AgentCustomerUIProps {
  agent: Agent
}

export default function AgentCustomerUI({ agent }: AgentCustomerUIProps) {
  return (
    <div className="flex h-full flex-col p-4">
      <AgentHeader agent={agent} />

      {/* Content 容器 - B 工程師開發 */}
      <div className="mt-4 flex flex-1 flex-col rounded-lg border-2 border-gray-200 bg-white p-8 shadow-sm">
        <p className="text-lg text-gray-500">開發中...</p>
      </div>
    </div>
  )
}
