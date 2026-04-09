/** Chat 管理洞察「用量」分頁：recharts 圖表（A 區塊 UX 強化） */
import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ChatInsightsOverview } from '@/api/chatInsights'

/** 模型長條圖與狀態圓餅圖共用圖表區高度（tailwind h-80 = 20rem） */
const USAGE_MODEL_PIE_CHART_H = 'h-80'

/** 白底專用：色階偏 600–800，避免過淺／螢光造成刺眼 */
const C = {
  success: '#047857',
  /** 請求狀態圓餅「success」扇區（與堆疊長條成功色分開，便於品牌色） */
  pieSuccess: '#4A412A',
  error: '#b91c1c',
  pending: '#b45309',
  other: '#5b21b6',
  tokensLine: '#0369a1',
  pieOther: '#6b21a8',
}

/** 模型 Top 10 長條：單一品牌色 */
const MODEL_BAR_COLOR = '#674C47'

/** 錯誤碼長條：深紅—赭色系，不做淺粉 */
const ERROR_BAR_HEAT = [
  '#991b1b',
  '#7f1d1d',
  '#9a3412',
  '#92400e',
  '#78350f',
  '#881337',
  '#701a75',
  '#4c1d95',
  '#1e3a8a',
  '#0f766e',
  '#713f12',
  '#57534e',
]

const GRID_STROKE = '#e5e7eb'

const TOOLTIP_BASE = {
  fontSize: 12,
  borderRadius: 8,
  border: '1px solid #e5e7eb',
  color: '#111827',
  backgroundColor: '#ffffff',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
} as const

function tickK(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function DailyTrendChart({ overview }: { overview: ChatInsightsOverview }) {
  const data = useMemo(
    () =>
      overview.by_day.map((d) => ({
        label: d.day.slice(5),
        dayFull: d.day,
        success: d.success_count,
        error: d.error_count,
        other: Math.max(0, d.request_count - d.success_count - d.error_count),
        tokens: d.total_tokens,
      })),
    [overview.by_day]
  )
  const hasData = data.some((x) => x.success + x.error + x.other > 0 || x.tokens > 0)
  if (!hasData) return null

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h4 className="mb-1 text-sm font-medium text-gray-900">每日趨勢</h4>
      <p className="mb-3 text-xs text-gray-500">
        橫軸為<strong className="font-medium text-gray-700">台北日曆日</strong>；堆疊長條為請求（成功／失敗／其他）；深青折線為 total tokens（右軸）。
      </p>
      <div className="h-[280px] w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: '#6b7280' }}
              tickMargin={6}
              interval="preserveStartEnd"
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 10, fill: '#6b7280' }}
              tickFormatter={tickK}
              width={44}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 10, fill: '#6b7280' }}
              tickFormatter={tickK}
              width={44}
            />
            <Tooltip contentStyle={TOOLTIP_BASE} labelFormatter={(label, payload) => {
                const row = payload?.[0]?.payload as { dayFull?: string } | undefined
                return row?.dayFull ?? String(label)
              }}
              formatter={(value, name) => {
                const v = Number(value ?? 0)
                const n = String(name ?? '')
                if (n === 'Total tokens') return [formatIntTooltip(v), 'tokens']
                return [formatIntTooltip(v), n]
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="left" dataKey="success" stackId="req" fill={C.success} name="成功請求" radius={[0, 0, 0, 0]} />
            <Bar yAxisId="left" dataKey="error" stackId="req" fill={C.error} name="失敗請求" radius={[0, 0, 0, 0]} />
            <Bar
              yAxisId="left"
              dataKey="other"
              stackId="req"
              fill={C.other}
              name="其他請求"
              radius={[2, 2, 0, 0]}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="tokens"
              stroke={C.tokensLine}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 5, fill: C.tokensLine, stroke: '#fff', strokeWidth: 2 }}
              name="Total tokens"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function formatIntTooltip(n: number) {
  return n.toLocaleString('zh-TW')
}

function ModelTokensBarChart({ overview }: { overview: ChatInsightsOverview }) {
  const data = useMemo(() => {
    const rows = [...overview.by_model]
      .sort((a, b) => b.total_tokens - a.total_tokens)
      .slice(0, 10)
      .map((r) => {
        const m = (r.llm_model ?? '—').trim()
        const short = m.length > 36 ? `${m.slice(0, 34)}…` : m
        const name = `${short}${r.provider ? ` (${r.provider})` : ''}`
        return { name, tokens: r.total_tokens, requests: r.request_count }
      })
    return rows.reverse()
  }, [overview.by_model])

  if (data.length === 0) return null

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h4 className="mb-1 text-sm font-medium text-gray-900">模型 total tokens（Top 10）</h4>
      <p className="mb-3 text-xs text-gray-500">橫向長條方便比對長模型名稱。</p>
      <div className={`w-full min-w-0 shrink-0 ${USAGE_MODEL_PIE_CHART_H}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart layout="vertical" data={data} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={tickK} />
            <YAxis
              type="category"
              dataKey="name"
              width={148}
              tick={{ fontSize: 9, fill: '#4b5563' }}
              interval={0}
            />
            <Tooltip contentStyle={TOOLTIP_BASE} formatter={(v) => [formatIntTooltip(Number(v ?? 0)), 'Total tokens']} />
            <Bar dataKey="tokens" name="tokens" fill={MODEL_BAR_COLOR} radius={[0, 4, 4, 0]} barSize={14} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function StatusPieChart({ overview }: { overview: ChatInsightsOverview }) {
  const data = useMemo(() => {
    const colorOf = (s: string) => {
      if (s === 'success') return C.pieSuccess
      if (s === 'error') return C.error
      if (s === 'pending') return C.pending
      return C.pieOther
    }
    return overview.by_status
      .filter((x) => x.count > 0)
      .map((x) => ({
        name: x.status,
        value: x.count,
        fill: colorOf(x.status),
      }))
  }, [overview.by_status])

  if (data.length === 0) return null

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h4 className="mb-1 text-sm font-medium text-gray-900">請求狀態分布</h4>
      <p className="mb-3 text-xs text-gray-500">對應 A-3 依狀態匯總。</p>
      <div className={`w-full min-w-0 shrink-0 ${USAGE_MODEL_PIE_CHART_H}`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="42%"
              outerRadius="72%"
              paddingAngle={2}
              label={({ name, percent }) =>
                `${name ?? ''} ${(((percent ?? 0) as number) * 100).toFixed(0)}%`
              }
            >
              {data.map((entry, i) => (
                <Cell key={`${entry.name}-${i}`} fill={entry.fill} stroke="#ffffff" strokeWidth={1.5} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_BASE} formatter={(v) => formatIntTooltip(Number(v ?? 0))} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function TopErrorsBarChart({ overview }: { overview: ChatInsightsOverview }) {
  const data = useMemo(() => {
    return [...overview.top_error_codes]
      .slice(0, 12)
      .map((r) => ({ code: r.error_code || '（空）', count: r.count }))
      .reverse()
  }, [overview.top_error_codes])

  if (data.length === 0) return null

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h4 className="mb-1 text-sm font-medium text-gray-900">失敗 error_code（Top 12）</h4>
      <div className="h-[200px] w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart layout="vertical" data={data} margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: '#6b7280' }} />
            <YAxis type="category" dataKey="code" width={100} tick={{ fontSize: 9, fill: '#4b5563' }} />
            <Tooltip contentStyle={TOOLTIP_BASE} />
            <Bar dataKey="count" name="次數" radius={[0, 4, 4, 0]} barSize={12}>
              {data.map((_, i) => (
                <Cell key={`err-${i}`} fill={ERROR_BAR_HEAT[i % ERROR_BAR_HEAT.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function ChatInsightsUsageCharts({ overview }: { overview: ChatInsightsOverview }) {
  return (
    <div className="space-y-6">
      <DailyTrendChart overview={overview} />
      <div className="grid gap-6 lg:grid-cols-2 lg:items-stretch">
        <ModelTokensBarChart overview={overview} />
        <StatusPieChart overview={overview} />
      </div>
      <TopErrorsBarChart overview={overview} />
    </div>
  )
}
