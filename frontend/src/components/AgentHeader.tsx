/** Agent 頁面共用 header：icon + 標題 + 返回連結 */
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import AgentIcon from '@/components/AgentIcon'
import type { Agent } from '@/types'

interface AgentHeaderProps {
  agent: Agent
  className?: string
}

export default function AgentHeader({ agent, className = '' }: AgentHeaderProps) {
  return (
    <header
      className={`flex-shrink-0 rounded-2xl border-b border-gray-300/50 px-6 py-4 shadow-md ${className}`.trim()}
      style={{ backgroundColor: '#4b5563' }}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <AgentIcon iconName={agent.icon_name} className="h-6 w-6 text-white" />
          <h1 className="text-2xl font-bold text-white">{agent.agent_name}</h1>
        </div>
        <Link
          to="/"
          className="flex items-center text-white transition-opacity hover:opacity-80"
          aria-label="返回"
        >
          <ArrowLeft className="h-6 w-6" />
        </Link>
      </div>
    </header>
  )
}
