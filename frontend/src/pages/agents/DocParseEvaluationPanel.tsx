/**
 * 投標評估面板
 * - 應備文件 Checklist（doc_checklist）
 * - 技術規範矩陣（tech_matrix）
 */
import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Download,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import {
  classifyEvaluation,
  getEvaluation,
  patchEvalItem,
  type EvalCapability,
  type EvalItem,
  type EvalRiskLevel,
  type EvalStatus,
} from '@/api/documentParse'

interface Props {
  resultId: number
  fileName: string
}

// ── 常數 ─────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<EvalStatus, string> = {
  todo: '待辦',
  in_progress: '進行中',
  done: '完成',
}
const STATUS_COLOR: Record<EvalStatus, string> = {
  todo: 'bg-gray-100 text-gray-500',
  in_progress: 'bg-amber-100 text-amber-700',
  done: 'bg-emerald-100 text-emerald-700',
}

const CAP_LABEL: Record<EvalCapability, string> = {
  meet: '符合',
  custom: '需客製',
  outsource: '需分包',
  unknown: '未知',
}
const CAP_COLOR: Record<EvalCapability, string> = {
  meet: 'bg-emerald-100 text-emerald-700',
  custom: 'bg-amber-100 text-amber-700',
  outsource: 'bg-orange-100 text-orange-700',
  unknown: 'bg-gray-100 text-gray-500',
}

const RISK_LABEL: Record<EvalRiskLevel, string> = { high: '高', medium: '中', low: '低' }
const RISK_COLOR: Record<EvalRiskLevel, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-emerald-100 text-emerald-700',
}

// ── 小元件：下拉選單 ──────────────────────────────────────────────────────────

function BadgeSelect<T extends string>({
  value,
  options,
  labelMap,
  colorMap,
  onChange,
  placeholder = '—',
}: {
  value: T | null
  options: T[]
  labelMap: Record<T, string>
  colorMap: Record<T, string>
  onChange: (v: T | null) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const colorCls = value ? colorMap[value] : 'bg-gray-100 text-gray-400'
  const label = value ? labelMap[value] : placeholder

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-medium transition-opacity hover:opacity-80 ${colorCls}`}
      >
        {label}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-28 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => { onChange(opt); setOpen(false) }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 ${value === opt ? 'font-semibold' : ''}`}
            >
              <span className={`h-2 w-2 rounded-full ${colorMap[opt].split(' ')[0]}`} />
              {labelMap[opt]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 主元件 ────────────────────────────────────────────────────────────────────

export default function DocParseEvaluationPanel({ resultId, fileName }: Props) {
  const [items, setItems] = useState<EvalItem[]>([])
  const [loading, setLoading] = useState(false)
  const [classifying, setClassifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCite, setShowCite] = useState(false)

  const docItems = items.filter((i) => i.item_type === 'doc_checklist')
  const techItems = items.filter((i) => i.item_type === 'tech_matrix')
  const riskItems = items.filter((i) => i.item_type === 'risk_matrix')

  // 載入評估資料
  useEffect(() => {
    setLoading(true)
    setError(null)
    getEvaluation(resultId)
      .then(setItems)
      .catch((e: Error) => { setError(e.message); setItems([]) })
      .finally(() => setLoading(false))
  }, [resultId])

  async function handleClassify() {
    setClassifying(true)
    setError(null)
    try {
      const result = await classifyEvaluation(resultId)
      setItems(result)
    } catch (e) {
      setError(String(e))
    } finally {
      setClassifying(false)
    }
  }

  async function updateItem(id: number, patch: Partial<EvalItem>) {
    // 樂觀更新
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))
    try {
      const updated = await patchEvalItem(resultId, id, patch)
      setItems((prev) => prev.map((i) => (i.id === id ? updated : i)))
    } catch {
      // 失敗時回滾（重新載入）
      getEvaluation(resultId).then(setItems).catch(() => {})
    }
  }

  // 匯出 Markdown
  function exportMarkdown() {
    const lines: string[] = [`# 投標評估：${fileName}`, '']

    if (riskItems.length > 0) {
      lines.push('## 風險注意事項', '')
      lines.push('| # | 風險描述 | 嚴重程度 | 備註 |')
      lines.push('|---|---------|---------|------|')
      riskItems.forEach((item, i) => {
        const risk = item.risk_level ? RISK_LABEL[item.risk_level as EvalRiskLevel] : '—'
        lines.push(`| ${i + 1} | ${item.item_key} | ${risk} | ${item.note ?? ''} |`)
      })
      lines.push('')
    }

    if (docItems.length > 0) {
      lines.push('## 應備文件 Checklist', '')
      lines.push('| # | 文件名稱 | 必/選附 | 負責人 | 截止日 | 狀態 | 備註 |')
      lines.push('|---|---------|---------|--------|--------|------|------|')
      docItems.forEach((item, i) => {
        const mandatory = item.mandatory === null ? '—' : item.mandatory ? '必附' : '選附'
        const status = item.status ? STATUS_LABEL[item.status as EvalStatus] : '—'
        lines.push(
          `| ${i + 1} | ${item.item_key} | ${mandatory} | ${item.assignee ?? '—'} | ${item.due_date ?? '—'} | ${status} | ${item.note ?? ''} |`,
        )
      })
      lines.push('')
    }

    if (techItems.length > 0) {
      lines.push('## 技術規範矩陣', '')
      lines.push('| # | 規格描述 | 原文依據 | 能力評估 | 風險等級 | 備註 |')
      lines.push('|---|---------|---------|---------|---------|------|')
      techItems.forEach((item, i) => {
        const cap = item.capability ? CAP_LABEL[item.capability as EvalCapability] : '—'
        const risk = item.risk_level ? RISK_LABEL[item.risk_level as EvalRiskLevel] : '—'
        lines.push(
          `| ${i + 1} | ${item.item_key} | ${item.cite ?? '—'} | ${cap} | ${risk} | ${item.note ?? ''} |`,
        )
      })
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileName.replace(/\.pdf$/i, '')}_投標評估.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>載入中…</span>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 工具列 */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-2.5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleClassify()}
            disabled={classifying}
            className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
          >
            {classifying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {items.length > 0 ? '重新分析' : 'AI 建立評估'}
          </button>
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => void getEvaluation(resultId).then(setItems).catch(() => {})}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              title="重新整理"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <>
              <label className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-gray-500 hover:bg-gray-50 select-none">
                <input
                  type="checkbox"
                  checked={showCite}
                  onChange={(e) => setShowCite(e.target.checked)}
                  className="rounded accent-sky-500"
                />
                原文依據
              </label>
              <button
                type="button"
                onClick={exportMarkdown}
                title="匯出 Markdown"
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <Download className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 錯誤 */}
      {error && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 空白提示 */}
      {items.length === 0 && !error && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-gray-400">
          <Sparkles className="h-8 w-8 opacity-30" />
          <p className="text-base">點擊「AI 建立評估」自動分析應備文件與技術規範</p>
        </div>
      )}

      {/* 主體內容 */}
      {items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-gray-100">

          {/* ── 應備文件 Checklist ─────────────────────────────────────── */}
          {docItems.length > 0 && (
            <section>
              <div className="flex items-center gap-2 bg-sky-50 px-5 py-2 border-b border-sky-100">
                <CheckCircle2 className="h-4 w-4 text-sky-600" />
                <h3 className="text-base font-semibold text-sky-800">應備文件 Checklist</h3>
                <span className="ml-auto text-sm text-sky-500">
                  {docItems.filter((i) => i.status === 'done').length} / {docItems.length} 完成
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50 text-xs text-gray-400">
                      <th className="w-8 px-3 py-2 text-left font-normal">#</th>
                      <th className="px-3 py-2 text-left font-normal">文件名稱</th>
                      <th className="w-20 px-3 py-2 text-center font-normal">必/選附</th>
                      <th className="w-28 px-3 py-2 text-left font-normal">負責人</th>
                      <th className="w-32 px-3 py-2 text-left font-normal">截止日</th>
                      <th className="w-24 px-3 py-2 text-center font-normal">狀態</th>
                      <th className="w-36 px-3 py-2 text-left font-normal">備註</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {docItems.map((item, idx) => (
                      <DocChecklistRow
                        key={item.id}
                        idx={idx + 1}
                        item={item}
                        showCite={showCite}
                        onUpdate={(patch) => void updateItem(item.id, patch)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ── 技術規範矩陣 ───────────────────────────────────────────── */}
          {techItems.length > 0 && (
            <section>
              <div className="flex items-center gap-2 bg-indigo-50 px-5 py-2 border-b border-indigo-100">
                <AlertCircle className="h-4 w-4 text-indigo-600" />
                <h3 className="text-base font-semibold text-indigo-800">技術規範矩陣</h3>
                <span className="ml-auto text-sm text-indigo-400">
                  {techItems.filter((i) => i.capability === 'meet').length} 符合 ／{' '}
                  {techItems.filter((i) => i.risk_level === 'high').length} 高風險
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50 text-xs text-gray-400">
                      <th className="w-8 px-3 py-2 text-left font-normal">#</th>
                      <th className="px-3 py-2 text-left font-normal">規格描述</th>
                      <th className="w-24 px-3 py-2 text-center font-normal">能力評估</th>
                      <th className="w-20 px-3 py-2 text-center font-normal">風險</th>
                      <th className="w-40 px-3 py-2 text-left font-normal">備註</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {techItems.map((item, idx) => (
                      <TechMatrixRow
                        key={item.id}
                        idx={idx + 1}
                        item={item}
                        showCite={showCite}
                        onUpdate={(patch) => void updateItem(item.id, patch)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ── 風險注意事項 ────────────────────────────────────────────── */}
          {riskItems.length > 0 && (
            <section>
              <div className="flex items-center gap-2 bg-rose-50 px-5 py-2 border-b border-rose-100">
                <AlertCircle className="h-4 w-4 text-rose-600" />
                <h3 className="text-base font-semibold text-rose-800">風險注意事項</h3>
                <span className="ml-auto text-sm text-rose-400">
                  {riskItems.filter((i) => i.risk_level === 'high').length} 高風險 ／{' '}
                  {riskItems.filter((i) => !i.risk_level).length} 待評估
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50 text-xs text-gray-400">
                      <th className="w-8 px-3 py-2 text-left font-normal">#</th>
                      <th className="px-3 py-2 text-left font-normal">風險描述</th>
                      <th className="w-20 px-3 py-2 text-center font-normal">嚴重程度</th>
                      <th className="w-40 px-3 py-2 text-left font-normal">備註</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {riskItems.map((item, idx) => (
                      <RiskMatrixRow
                        key={item.id}
                        idx={idx + 1}
                        item={item}
                        showCite={showCite}
                        onUpdate={(patch) => void updateItem(item.id, patch)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

// ── 應備文件列 ────────────────────────────────────────────────────────────────

function DocChecklistRow({
  idx,
  item,
  showCite,
  onUpdate,
}: {
  idx: number
  item: EvalItem
  showCite: boolean
  onUpdate: (patch: Partial<EvalItem>) => void
}) {
  const [editingAssignee, setEditingAssignee] = useState(false)
  const [assigneeVal, setAssigneeVal] = useState(item.assignee ?? '')
  const [editingNote, setEditingNote] = useState(false)
  const [noteVal, setNoteVal] = useState(item.note ?? '')

  function commitAssignee() {
    setEditingAssignee(false)
    const v = assigneeVal.trim() || null
    if (v !== item.assignee) onUpdate({ assignee: v })
  }

  function commitNote() {
    setEditingNote(false)
    const v = noteVal.trim() || null
    if (v !== item.note) onUpdate({ note: v })
  }

  const isDone = item.status === 'done'

  return (
    <>
      <tr className={`transition-colors hover:bg-gray-50/60 ${isDone ? 'opacity-60' : ''}`}>
        <td className="px-3 py-2.5 text-gray-400 align-top">{idx}</td>

        {/* 文件名稱 */}
        <td className="px-3 py-2.5 align-top">
          <span className={`text-gray-800 ${isDone ? 'line-through' : ''}`}>{item.item_key}</span>
        </td>

        {/* 必附 / 選附 */}
        <td className="px-3 py-2.5 text-center align-top">
          <button
            type="button"
            onClick={() => onUpdate({ mandatory: !item.mandatory })}
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors hover:opacity-80 ${
              item.mandatory === null
                ? 'bg-gray-100 text-gray-400'
                : item.mandatory
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-slate-100 text-slate-500'
            }`}
          >
            {item.mandatory === null ? '—' : item.mandatory ? '必附' : '選附'}
          </button>
        </td>

        {/* 負責人 */}
        <td className="px-3 py-2.5 align-top">
          {editingAssignee ? (
            <input
              autoFocus
              value={assigneeVal}
              onChange={(e) => setAssigneeVal(e.target.value)}
              onBlur={commitAssignee}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitAssignee()
                if (e.key === 'Escape') setEditingAssignee(false)
              }}
              placeholder="填入姓名"
              className="w-full rounded border border-sky-300 px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-sky-300"
            />
          ) : (
            <span
              onClick={() => { setAssigneeVal(item.assignee ?? ''); setEditingAssignee(true) }}
              className="cursor-text rounded px-1 text-gray-700 hover:bg-sky-50"
            >
              {item.assignee ?? <span className="text-gray-300">點擊填入</span>}
            </span>
          )}
        </td>

        {/* 截止日 */}
        <td className="px-3 py-2.5 align-top">
          <input
            type="date"
            value={item.due_date ?? ''}
            onChange={(e) => onUpdate({ due_date: e.target.value || null })}
            className="rounded border border-gray-200 px-1.5 py-0.5 text-sm text-gray-700 focus:border-sky-300 focus:outline-none"
          />
        </td>

        {/* 狀態 */}
        <td className="px-3 py-2.5 text-center align-top">
          <BadgeSelect<EvalStatus>
            value={item.status as EvalStatus | null}
            options={['todo', 'in_progress', 'done']}
            labelMap={STATUS_LABEL}
            colorMap={STATUS_COLOR}
            onChange={(v) => onUpdate({ status: v })}
          />
        </td>

        {/* 備註 */}
        <td className="px-3 py-2.5 align-top">
          {editingNote ? (
            <input
              autoFocus
              value={noteVal}
              onChange={(e) => setNoteVal(e.target.value)}
              onBlur={commitNote}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitNote()
                if (e.key === 'Escape') setEditingNote(false)
              }}
              placeholder="備註"
              className="w-full rounded border border-sky-300 px-1.5 py-0.5 text-sm focus:outline-none"
            />
          ) : (
            <span
              onClick={() => { setNoteVal(item.note ?? ''); setEditingNote(true) }}
              className="cursor-text rounded px-1 text-gray-600 hover:bg-sky-50"
            >
              {item.note ?? <span className="text-gray-300">—</span>}
            </span>
          )}
        </td>
      </tr>

      {showCite && item.cite && (
        <tr className={isDone ? 'opacity-60' : ''}>
          <td />
          <td colSpan={6} className="px-3 pb-2.5">
            <div className="rounded-md border-l-2 border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
              「{item.cite}」
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── 技術規範列 ────────────────────────────────────────────────────────────────

function TechMatrixRow({
  idx,
  item,
  showCite,
  onUpdate,
}: {
  idx: number
  item: EvalItem
  showCite: boolean
  onUpdate: (patch: Partial<EvalItem>) => void
}) {
  const [editingNote, setEditingNote] = useState(false)
  const [noteVal, setNoteVal] = useState(item.note ?? '')

  function commitNote() {
    setEditingNote(false)
    const v = noteVal.trim() || null
    if (v !== item.note) onUpdate({ note: v })
  }

  return (
    <>
      <tr className="transition-colors hover:bg-gray-50/60">
        <td className="px-3 py-2.5 text-gray-400 align-top">{idx}</td>

        {/* 規格描述 */}
        <td className="px-3 py-2.5 align-top">
          <span className="text-gray-800 leading-relaxed">{item.item_key}</span>
        </td>

        {/* 能力評估 */}
        <td className="px-3 py-2.5 text-center align-top">
          <BadgeSelect<EvalCapability>
            value={item.capability as EvalCapability | null}
            options={['meet', 'custom', 'outsource', 'unknown']}
            labelMap={CAP_LABEL}
            colorMap={CAP_COLOR}
            onChange={(v) => onUpdate({ capability: v })}
          />
        </td>

        {/* 風險等級 */}
        <td className="px-3 py-2.5 text-center align-top">
          <BadgeSelect<EvalRiskLevel>
            value={item.risk_level as EvalRiskLevel | null}
            options={['high', 'medium', 'low']}
            labelMap={RISK_LABEL}
            colorMap={RISK_COLOR}
            onChange={(v) => onUpdate({ risk_level: v })}
            placeholder="設定"
          />
        </td>

        {/* 備註 */}
        <td className="px-3 py-2.5 align-top">
          {editingNote ? (
            <input
              autoFocus
              value={noteVal}
              onChange={(e) => setNoteVal(e.target.value)}
              onBlur={commitNote}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitNote()
                if (e.key === 'Escape') setEditingNote(false)
              }}
              placeholder="備註"
              className="w-full rounded border border-sky-300 px-1.5 py-0.5 text-sm focus:outline-none"
            />
          ) : (
            <span
              onClick={() => { setNoteVal(item.note ?? ''); setEditingNote(true) }}
              className="cursor-text rounded px-1 text-gray-600 hover:bg-sky-50"
            >
              {item.note ?? <span className="text-gray-300">—</span>}
            </span>
          )}
        </td>
      </tr>

      {showCite && item.cite && (
        <tr>
          <td />
          <td colSpan={4} className="px-3 pb-2.5">
            <div className="rounded-md border-l-2 border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
              「{item.cite}」
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── 風險注意事項列 ─────────────────────────────────────────────────────────────

function RiskMatrixRow({
  idx,
  item,
  showCite,
  onUpdate,
}: {
  idx: number
  item: EvalItem
  showCite: boolean
  onUpdate: (patch: Partial<EvalItem>) => void
}) {
  const [editingNote, setEditingNote] = useState(false)
  const [noteVal, setNoteVal] = useState(item.note ?? '')

  function commitNote() {
    setEditingNote(false)
    const v = noteVal.trim() || null
    if (v !== item.note) onUpdate({ note: v })
  }

  const isHigh = item.risk_level === 'high'

  return (
    <>
      <tr className={`transition-colors hover:bg-gray-50/60 ${isHigh ? 'bg-red-50/30' : ''}`}>
        <td className="px-3 py-2.5 text-gray-400 align-top">{idx}</td>

        {/* 風險描述 */}
        <td className="px-3 py-2.5 align-top">
          <span className={`leading-relaxed ${isHigh ? 'font-medium text-red-800' : 'text-gray-800'}`}>
            {item.item_key}
          </span>
        </td>

        {/* 嚴重程度 */}
        <td className="px-3 py-2.5 text-center align-top">
          <BadgeSelect<EvalRiskLevel>
            value={item.risk_level as EvalRiskLevel | null}
            options={['high', 'medium', 'low']}
            labelMap={RISK_LABEL}
            colorMap={RISK_COLOR}
            onChange={(v) => onUpdate({ risk_level: v })}
            placeholder="設定"
          />
        </td>

        {/* 備註 */}
        <td className="px-3 py-2.5 align-top">
          {editingNote ? (
            <input
              autoFocus
              value={noteVal}
              onChange={(e) => setNoteVal(e.target.value)}
              onBlur={commitNote}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitNote()
                if (e.key === 'Escape') setEditingNote(false)
              }}
              placeholder="備註（如：需法務確認）"
              className="w-full rounded border border-sky-300 px-1.5 py-0.5 text-sm focus:outline-none"
            />
          ) : (
            <span
              onClick={() => { setNoteVal(item.note ?? ''); setEditingNote(true) }}
              className="cursor-text rounded px-1 text-gray-600 hover:bg-sky-50"
            >
              {item.note ?? <span className="text-gray-300">—</span>}
            </span>
          )}
        </td>
      </tr>

      {showCite && item.cite && (
        <tr className={isHigh ? 'bg-red-50/30' : ''}>
          <td />
          <td colSpan={3} className="px-3 pb-2.5">
            <div className="rounded-md border-l-2 border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
              「{item.cite}」
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
