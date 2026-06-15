/**
 * Estimator Agent UI
 * 左欄：情境範本清單 + 新增/編輯
 * 右欄：執行試算表單 + 結果 + 串接 Writing Agent
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { evaluate } from 'mathjs'
import {
  ChevronLeft, ChevronRight, Calculator, Plus, Pencil, Trash2,
  Play, Save, X, GripVertical, ArrowRight, Loader2, FileText, Copy, Check,
} from 'lucide-react'
import AgentHeader from '@/components/AgentHeader'
import ErrorModal from '@/components/ErrorModal'
import {
  listEstimatorTemplates, createEstimatorTemplate, updateEstimatorTemplate,
  deleteEstimatorTemplate,
  type EstimatorTemplate, type EstimatorField, type EstimatorOutput, type EstimatorSchemaData,
} from '@/api/estimator'
import type { Agent } from '@/types'

interface Props { agent: Agent }

const HEADER_COLOR = '#1a3352'
const NS_WRITING_INIT_KEY = 'ns_writing_init'

// ── IRR（Newton-Raphson）───────────────────────────────────────────────────
function calcIRR(capex: number, annualCF: number, years: number): number {
  if (annualCF <= 0) return NaN
  let r = 0.1
  for (let i = 0; i < 200; i++) {
    const pv = Array.from({ length: years }, (_, k) => annualCF / Math.pow(1 + r, k + 1)).reduce((a, b) => a + b, 0)
    const npv = -capex + pv
    const dpv = Array.from({ length: years }, (_, k) => -annualCF * (k + 1) / Math.pow(1 + r, k + 2)).reduce((a, b) => a + b, 0)
    if (dpv === 0) break
    const rNew = r - npv / dpv
    if (Math.abs(rNew - r) < 1e-8) return rNew
    r = rNew
  }
  return r
}

// ── 公式計算 ──────────────────────────────────────────────────────────────
function runFormulas(
  outputs: EstimatorOutput[],
  inputs: Record<string, number>,
): Record<string, number | null> {
  const results: Record<string, number | null> = {}
  for (const out of outputs) {
    try {
      const scope = { ...inputs, ...results }
      const f = out.formula.trim()
      // 特殊函式：IRR(capex, annualCF, years)
      const irrMatch = f.match(/^IRR\(([^,]+),([^,]+),([^)]+)\)$/i)
      if (irrMatch) {
        const c = evaluate(irrMatch[1].trim(), scope) as number
        const cf = evaluate(irrMatch[2].trim(), scope) as number
        const y = Math.round(evaluate(irrMatch[3].trim(), scope) as number)
        results[out.key] = calcIRR(c, cf, y)
      } else {
        const val = evaluate(f, scope)
        results[out.key] = typeof val === 'number' ? val : null
      }
    } catch {
      results[out.key] = null
    }
  }
  return results
}

// ── 格式化輸出數字 ─────────────────────────────────────────────────────────
function fmtOutput(val: number | null, field: EstimatorOutput, _inputFields: EstimatorField[]): string {
  if (val === null || isNaN(val)) return '—'
  // 找對應的 input field 確認 type（output 沒有 type，靠名稱猜）
  const key = field.key.toLowerCase()
  if (key === 'irr' || key.includes('irr')) return `${(val * 100).toFixed(1)}%`
  if (key.includes('rate') || key.includes('ratio')) return `${(val * 100).toFixed(1)}%`
  if (Math.abs(val) >= 10000) return `NT$${Math.round(val).toLocaleString('zh-TW')}`
  if (Number.isInteger(val) || Math.abs(val) >= 100) return val.toFixed(1)
  return val.toFixed(2)
}

// ── 範例範本 ───────────────────────────────────────────────────────────────
const EXAMPLE_TEMPLATES: Array<{ name: string; schema_data: EstimatorSchemaData }> = [
  {
    name: '停車場智慧支付試算',
    schema_data: {
      fields: [
        { key: 'dailyTrips',  label: '每日進場車次', unit: '輛',  type: 'number' },
        { key: 'avgDuration', label: '平均停車時長', unit: '小時', type: 'number' },
        { key: 'hourlyRate',  label: '每小時費率',   unit: '元',  type: 'number' },
        { key: 'feeRate',     label: '代收費率',     unit: '%',   type: 'percent' },
        { key: 'capex',       label: '設備投資',     unit: '元',  type: 'currency' },
        { key: 'years',       label: '合約年限',     unit: '年',  type: 'number' },
      ],
      outputs: [
        { key: 'annualRevenue', label: '年收費總額',   formula: 'dailyTrips * avgDuration * hourlyRate * 365' },
        { key: 'annualIncome',  label: '年代收費收入', formula: 'annualRevenue * feeRate / 100' },
        { key: 'payback',       label: '回收年限',     formula: 'capex / annualIncome' },
        { key: 'irr',           label: 'IRR',          formula: 'IRR(capex, annualIncome, years)' },
      ],
    },
  },
  {
    name: '太陽能電廠投資評估',
    schema_data: {
      fields: [
        { key: 'capacity',    label: '裝置容量',   unit: 'kW',    type: 'number' },
        { key: 'sunHours',    label: '日照時數',   unit: '小時/日', type: 'number' },
        { key: 'feedInRate',  label: '電費躉購價', unit: '元/度',  type: 'number' },
        { key: 'capex',       label: '系統造價',   unit: '元',     type: 'currency' },
        { key: 'years',       label: '合約年限',   unit: '年',     type: 'number' },
      ],
      outputs: [
        { key: 'annualKwh',    label: '年發電量',   formula: 'capacity * sunHours * 365' },
        { key: 'annualIncome', label: '年收入',     formula: 'annualKwh * feedInRate' },
        { key: 'payback',      label: '回收年限',   formula: 'capex / annualIncome' },
        { key: 'irr',          label: 'IRR',        formula: 'IRR(capex, annualIncome, years)' },
      ],
    },
  },
]

// ── 空範本 ─────────────────────────────────────────────────────────────────
function emptySchema(): EstimatorSchemaData {
  return { fields: [], outputs: [] }
}

function newField(): EstimatorField {
  return { key: '', label: '', unit: '', type: 'number' }
}

function newOutput(): EstimatorOutput {
  return { key: '', label: '', formula: '' }
}

// ── 相對時間 ───────────────────────────────────────────────────────────────
function relTime(iso: string): string {
  const d = new Date(iso), now = new Date()
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  if (diff < 7) return `${diff} 天前`
  return d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })
}

// ────────────────────────────────────────────────────────────────────────────
export default function AgentEstimatorUI({ agent }: Props) {
  const [templates, setTemplates] = useState<EstimatorTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // 當前模式
  type Mode = 'idle' | 'edit' | 'run'
  const [mode, setMode] = useState<Mode>('idle')
  const [editTarget, setEditTarget] = useState<EstimatorTemplate | null>(null)
  const [runTarget, setRunTarget] = useState<EstimatorTemplate | null>(null)

  // 編輯表單狀態
  const [editName, setEditName] = useState('')
  const [editSchema, setEditSchema] = useState<EstimatorSchemaData>(emptySchema())
  const [saving, setSaving] = useState(false)

  // 試算狀態
  const [inputVals, setInputVals] = useState<Record<string, string>>({})
  const [calcResults, setCalcResults] = useState<Record<string, number | null> | null>(null)

  const [errorModal, setErrorModal] = useState<{ title: string; message: string } | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [previewCopied, setPreviewCopied] = useState(false)

  // Formula textarea 游標插入
  const formulaRefs = useRef<Record<string, HTMLInputElement | null>>({})

  // ── 載入範本 ───────────────────────────────────────────────────────────
  const loadTemplates = useCallback(async () => {
    try {
      const list = await listEstimatorTemplates()
      setTemplates(list)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadTemplates() }, [loadTemplates])

  // ── 載入範例範本 ──────────────────────────────────────────────────────
  async function handleLoadExamples() {
    setSeeding(true)
    try {
      const created: EstimatorTemplate[] = []
      for (const ex of EXAMPLE_TEMPLATES) {
        const t = await createEstimatorTemplate(ex.name, ex.schema_data)
        created.push(t)
      }
      setTemplates(prev => [...created, ...prev])
    } catch (e) {
      const msg = e instanceof Error ? e.message : '載入失敗'
      setErrorModal({ title: '載入範例失敗', message: msg })
    } finally {
      setSeeding(false)
    }
  }

  // ── 編輯模式 ──────────────────────────────────────────────────────────
  function startNew() {
    setEditTarget(null)
    setEditName('新情境')
    setEditSchema(emptySchema())
    setMode('edit')
  }

  function startEdit(t: EstimatorTemplate) {
    setEditTarget(t)
    setEditName(t.name)
    setEditSchema(JSON.parse(JSON.stringify(t.schema_data)))
    setMode('edit')
  }

  async function handleSave() {
    if (!editName.trim()) return
    setSaving(true)
    try {
      if (editTarget) {
        const updated = await updateEstimatorTemplate(editTarget.id, editName, editSchema)
        setTemplates(prev => prev.map(t => t.id === updated.id ? updated : t))
      } else {
        const created = await createEstimatorTemplate(editName, editSchema)
        setTemplates(prev => [created, ...prev])
      }
      setMode('idle')
    } catch (e) {
      const msg = e instanceof Error ? e.message : '儲存失敗'
      setErrorModal({ title: '儲存失敗', message: msg })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (!window.confirm('確定刪除此情境範本？')) return
    try {
      await deleteEstimatorTemplate(id)
      setTemplates(prev => prev.filter(t => t.id !== id))
      if (runTarget?.id === id || editTarget?.id === id) setMode('idle')
    } catch (e) {
      const msg = e instanceof Error ? e.message : '刪除失敗'
      setErrorModal({ title: '刪除失敗', message: msg })
    }
  }

  // ── 試算模式 ──────────────────────────────────────────────────────────
  function startRun(t: EstimatorTemplate) {
    setRunTarget(t)
    const defaults: Record<string, string> = {}
    t.schema_data.fields.forEach(f => { defaults[f.key] = '' })
    setInputVals(defaults)
    setCalcResults(null)
    setMode('run')
  }

  function handleCalculate() {
    if (!runTarget) return
    const nums: Record<string, number> = {}
    for (const f of runTarget.schema_data.fields) {
      nums[f.key] = parseFloat(inputVals[f.key] ?? '0') || 0
    }
    const results = runFormulas(runTarget.schema_data.outputs, nums)
    setCalcResults(results)
  }

  function buildProposalContent(): { title: string; content: string; userPrompt: string } | null {
    if (!runTarget || !calcResults) return null
    const lines: string[] = [`# ${runTarget.name} 試算結果\n`]
    lines.push('## 輸入參數')
    for (const f of runTarget.schema_data.fields) {
      lines.push(`- ${f.label}：${inputVals[f.key] ?? ''} ${f.unit}`)
    }
    lines.push('\n## 試算結果')
    for (const o of runTarget.schema_data.outputs) {
      const v = calcResults[o.key]
      lines.push(`- ${o.label}：${fmtOutput(v, o, runTarget.schema_data.fields)}`)
    }
    const content = lines.join('\n')
    const userPrompt = `請根據以上試算結果，撰寫一份專業的業務提案（Proposal），包含：執行摘要、財務效益說明、合作建議與下一步。`
    const title = `${runTarget.name} Proposal`
    return { title, content, userPrompt }
  }

  function handleOpenWriting() {
    const data = buildProposalContent()
    if (!data) return
    try {
      localStorage.setItem(NS_WRITING_INIT_KEY, JSON.stringify(data))
      window.open(`/agent/default:writing`, '_blank')
    } catch { /* ignore */ }
  }

  // ── 編輯 Schema helpers ───────────────────────────────────────────────
  function insertVarAtCursor(outputIdx: number, varKey: string) {
    const ref = formulaRefs.current[`out-${outputIdx}`]
    if (!ref) {
      setEditSchema(prev => ({
        ...prev,
        outputs: prev.outputs.map((o, i) =>
          i === outputIdx ? { ...o, formula: o.formula + varKey } : o
        ),
      }))
      return
    }
    const start = ref.selectionStart ?? ref.value.length
    const end = ref.selectionEnd ?? ref.value.length
    const before = ref.value.slice(0, start)
    const after = ref.value.slice(end)
    const newVal = before + varKey + after
    setEditSchema(prev => ({
      ...prev,
      outputs: prev.outputs.map((o, i) =>
        i === outputIdx ? { ...o, formula: newVal } : o
      ),
    }))
    setTimeout(() => {
      ref.focus()
      ref.setSelectionRange(start + varKey.length, start + varKey.length)
    }, 0)
  }

  const availableVars = (outputIdx: number) => [
    ...editSchema.fields.map(f => ({ key: f.key, label: f.label, color: 'sky' })),
    ...editSchema.outputs.slice(0, outputIdx).map(o => ({ key: o.key, label: o.label, color: 'emerald' })),
  ]

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="relative flex h-full flex-col p-4 text-[18px]">
      <AgentHeader agent={agent} headerBackgroundColor={HEADER_COLOR} />

      <div className="mt-4 flex min-h-0 flex-1 gap-3 overflow-hidden">

        {/* ── 左欄 Sidebar ── */}
        <div
          className={`flex shrink-0 flex-col overflow-hidden rounded-xl shadow-md transition-[width] duration-200 ${sidebarCollapsed ? 'w-12' : 'w-80'}`}
          style={{ backgroundColor: HEADER_COLOR }}
        >
          {/* Header */}
          <div className={`shrink-0 flex items-center border-b border-white/20 py-2.5 gap-2 ${sidebarCollapsed ? 'px-2 justify-center' : 'pl-3 pr-2'}`}>
            {sidebarCollapsed ? (
              <button onClick={() => setSidebarCollapsed(false)} className="flex w-full items-center justify-center rounded-lg p-1.5 text-white/70 hover:bg-white/10" title="展開">
                <ChevronRight className="h-5 w-5" />
              </button>
            ) : (
              <>
                <button
                  onClick={startNew}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-white/15 px-3 py-2 text-base font-medium text-white hover:bg-white/25 transition-colors"
                >
                  <Plus className="h-4 w-4" />新增情境
                </button>
                <button onClick={() => setSidebarCollapsed(true)} className="shrink-0 rounded-lg px-1.5 py-1 text-white/50 hover:bg-white/10 hover:text-white" title="折疊">
                  <ChevronLeft className="h-5 w-5" />
                </button>
              </>
            )}
          </div>

          {/* 範本清單 */}
          <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto py-2 px-1.5">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-white/40" />
              </div>
            ) : templates.length === 0 && !sidebarCollapsed ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center px-3">
                <Calculator className="h-8 w-8 text-white/30" />
                <p className="text-base text-white/50">尚無情境範本</p>
                <button
                  onClick={handleLoadExamples}
                  disabled={seeding}
                  className="flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-sm text-white hover:bg-white/25 disabled:opacity-50 transition-colors"
                >
                  {seeding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  載入範例範本
                </button>
              </div>
            ) : (
              templates.map(t => {
                const isActive = (mode === 'edit' && editTarget?.id === t.id) || (mode === 'run' && runTarget?.id === t.id)
                return (
                  <div
                    key={t.id}
                    className={`group flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors ${isActive ? 'bg-sky-500/30 text-white' : 'text-white/65 hover:bg-white/10 hover:text-white'} ${sidebarCollapsed ? 'justify-center' : ''}`}
                  >
                    {sidebarCollapsed ? (
                      <Calculator className="h-4 w-4 shrink-0" aria-label={t.name} />
                    ) : (
                      <>
                        <div className="min-w-0 flex-1 cursor-pointer" onClick={() => startRun(t)}>
                          <p className="truncate text-base font-medium leading-tight">{t.name}</p>
                          <p className={`text-sm ${isActive ? 'text-white/60' : 'text-white/35'}`}>{relTime(t.updated_at)}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                          <button onClick={() => startRun(t)} className="rounded p-1 hover:bg-white/10 text-white/60 hover:text-white" title="執行試算">
                            <Play className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => startEdit(t)} className="rounded p-1 hover:bg-white/10 text-white/60 hover:text-white" title="編輯範本">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={e => handleDelete(e, t.id)} className="rounded p-1 hover:bg-white/10 text-white/40 hover:text-red-300" title="刪除">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )
              })
            )}
          </nav>
        </div>

        {/* ── 右欄 ── */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 shadow-sm bg-white">

          {/* IDLE */}
          {mode === 'idle' && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-gray-400">
              <Calculator className="h-16 w-16 opacity-20" />
              <p className="text-lg">選擇左側情境執行試算，或新增情境範本</p>
            </div>
          )}

          {/* EDIT MODE */}
          {mode === 'edit' && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {/* 標題列 */}
              <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-3">
                <div className="flex items-center gap-3">
                  <input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    placeholder="情境名稱"
                    className="text-xl font-semibold text-gray-800 border-b-2 border-transparent focus:border-sky-400 outline-none bg-transparent px-1"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setMode('idle')} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100">
                    <X className="h-4 w-4" />取消
                  </button>
                  <button onClick={handleSave} disabled={saving} className="flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}儲存
                  </button>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 gap-0 overflow-hidden">

                {/* 左半：欄位設定 */}
                <div className="flex min-h-0 w-1/2 flex-col overflow-y-auto border-r border-gray-100 px-5 py-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-base font-semibold text-gray-700">輸入欄位</h3>
                    <button
                      onClick={() => setEditSchema(p => ({ ...p, fields: [...p.fields, newField()] }))}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-sky-600 hover:bg-sky-50"
                    >
                      <Plus className="h-3.5 w-3.5" />新增欄位
                    </button>
                  </div>
                  <div className="flex flex-col gap-2">
                    {editSchema.fields.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
                        <GripVertical className="h-4 w-4 shrink-0 text-gray-300" />
                        <input value={f.label} onChange={e => setEditSchema(p => ({ ...p, fields: p.fields.map((x, j) => j === i ? { ...x, label: e.target.value } : x) }))} placeholder="欄位名稱" className="min-w-0 flex-1 rounded border border-gray-200 px-2 py-1 text-sm outline-none focus:border-sky-400" />
                        <input value={f.key} onChange={e => setEditSchema(p => ({ ...p, fields: p.fields.map((x, j) => j === i ? { ...x, key: e.target.value.replace(/\s/g, '_') } : x) }))} placeholder="key" className="w-24 rounded border border-gray-200 px-2 py-1 text-sm font-mono outline-none focus:border-sky-400" />
                        <input value={f.unit} onChange={e => setEditSchema(p => ({ ...p, fields: p.fields.map((x, j) => j === i ? { ...x, unit: e.target.value } : x) }))} placeholder="單位" className="w-14 rounded border border-gray-200 px-2 py-1 text-sm outline-none focus:border-sky-400" />
                        <button onClick={() => setEditSchema(p => ({ ...p, fields: p.fields.filter((_, j) => j !== i) }))} className="shrink-0 rounded p-1 text-red-300 hover:bg-red-50 hover:text-red-500">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    {editSchema.fields.length === 0 && (
                      <p className="py-4 text-center text-sm text-gray-400">尚無欄位，點擊「新增欄位」</p>
                    )}
                  </div>
                </div>

                {/* 右半：輸出公式設定 */}
                <div className="flex min-h-0 w-1/2 flex-col overflow-y-auto px-5 py-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-base font-semibold text-gray-700">輸出公式</h3>
                    <button
                      onClick={() => setEditSchema(p => ({ ...p, outputs: [...p.outputs, newOutput()] }))}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-sky-600 hover:bg-sky-50"
                    >
                      <Plus className="h-3.5 w-3.5" />新增輸出
                    </button>
                  </div>
                  <div className="flex flex-col gap-3">
                    {editSchema.outputs.map((o, i) => (
                      <div key={i} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <div className="mb-2 flex items-center gap-2">
                          <input value={o.label} onChange={e => setEditSchema(p => ({ ...p, outputs: p.outputs.map((x, j) => j === i ? { ...x, label: e.target.value } : x) }))} placeholder="輸出名稱" className="min-w-0 flex-1 rounded border border-gray-200 px-2 py-1 text-sm outline-none focus:border-sky-400" />
                          <input value={o.key} onChange={e => setEditSchema(p => ({ ...p, outputs: p.outputs.map((x, j) => j === i ? { ...x, key: e.target.value.replace(/\s/g, '_') } : x) }))} placeholder="key" className="w-24 rounded border border-gray-200 px-2 py-1 text-sm font-mono outline-none focus:border-sky-400" />
                          <button onClick={() => setEditSchema(p => ({ ...p, outputs: p.outputs.filter((_, j) => j !== i) }))} className="shrink-0 rounded p-1 text-red-300 hover:bg-red-50 hover:text-red-500">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {/* 可用變數 */}
                        <div className="mb-1.5 flex flex-wrap gap-1">
                          {availableVars(i).map(v => (
                            <button key={v.key} onClick={() => insertVarAtCursor(i, v.key)} title={`插入 ${v.key}`}
                              className={`rounded-full px-2 py-0.5 text-xs font-mono ${v.color === 'sky' ? 'bg-sky-100 text-sky-700 hover:bg-sky-200' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}>
                              {v.label}
                            </button>
                          ))}
                          <button onClick={() => insertVarAtCursor(i, 'IRR(capex, annualIncome, years)')}
                            className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-mono text-violet-700 hover:bg-violet-200">
                            IRR(...)
                          </button>
                        </div>
                        {/* 公式輸入 */}
                        <input
                          ref={el => { formulaRefs.current[`out-${i}`] = el }}
                          value={o.formula}
                          onChange={e => setEditSchema(p => ({ ...p, outputs: p.outputs.map((x, j) => j === i ? { ...x, formula: e.target.value } : x) }))}
                          placeholder="公式，例如：dailyTrips * 2.5 * 60 * 365"
                          className="w-full rounded border border-gray-200 bg-white px-2 py-1 text-sm font-mono outline-none focus:border-sky-400"
                        />
                      </div>
                    ))}
                    {editSchema.outputs.length === 0 && (
                      <p className="py-4 text-center text-sm text-gray-400">尚無輸出，點擊「新增輸出」</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* RUN MODE */}
          {mode === 'run' && runTarget && (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {/* 標題 */}
              <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-3">
                <div className="flex items-center gap-2">
                  <Calculator className="h-5 w-5 text-sky-600" />
                  <h2 className="text-lg font-semibold text-gray-800">{runTarget.name}</h2>
                </div>
                <button onClick={() => startEdit(runTarget)} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100">
                  <Pencil className="h-4 w-4" />編輯範本
                </button>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-0 md:flex-row">

                {/* 輸入表單 */}
                <div className="flex w-full flex-col gap-4 border-b border-gray-100 px-6 py-5 md:w-1/2 md:border-b-0 md:border-r">
                  <h3 className="text-base font-semibold text-gray-600">輸入參數</h3>
                  {runTarget.schema_data.fields.map(f => (
                    <div key={f.key} className="flex flex-col gap-1">
                      <label className="text-sm font-medium text-gray-700">
                        {f.label}{f.unit ? <span className="ml-1 text-gray-400">（{f.unit}）</span> : null}
                      </label>
                      <input
                        type="number"
                        value={inputVals[f.key] ?? ''}
                        onChange={e => setInputVals(p => ({ ...p, [f.key]: e.target.value }))}
                        placeholder="0"
                        className="rounded-lg border border-gray-200 px-3 py-2 text-base outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-200"
                      />
                    </div>
                  ))}
                  <button
                    onClick={handleCalculate}
                    className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-sky-600 py-2.5 text-base font-medium text-white hover:bg-sky-700 transition-colors"
                  >
                    <Calculator className="h-5 w-5" />開始試算
                  </button>
                </div>

                {/* 試算結果 */}
                <div className="flex w-full flex-col gap-4 px-6 py-5 md:w-1/2">
                  <h3 className="text-base font-semibold text-gray-600">試算結果</h3>
                  {!calcResults ? (
                    <div className="flex flex-1 flex-col items-center justify-center py-12 text-gray-300">
                      <ArrowRight className="mb-2 h-10 w-10" />
                      <p className="text-sm">填入參數後點擊試算</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-col gap-3">
                        {runTarget.schema_data.outputs.map(o => {
                          const val = calcResults[o.key]
                          return (
                            <div key={o.key} className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                              <span className="text-base text-gray-600">{o.label}</span>
                              <span className="text-lg font-semibold text-gray-900">
                                {fmtOutput(val, o, runTarget.schema_data.fields)}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                      <button
                        onClick={() => setShowPreview(true)}
                        className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 py-2.5 text-base font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                      >
                        <FileText className="h-5 w-5" />預覽傳入 Writing Agent 的內容
                      </button>
                      <button
                        onClick={handleOpenWriting}
                        className="flex items-center justify-center gap-2 rounded-xl border border-sky-200 bg-sky-50 py-2.5 text-base font-medium text-sky-700 hover:bg-sky-100 transition-colors"
                      >
                        <ArrowRight className="h-5 w-5" />在 Writing Agent 生成 Proposal
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {errorModal && (
        <ErrorModal
          open
          title={errorModal.title}
          message={errorModal.message}
          onClose={() => setErrorModal(null)}
        />
      )}

      {showPreview && (() => {
        const data = buildProposalContent()
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowPreview(false)}>
            <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-gray-500" />
                  <span className="text-base font-semibold text-gray-800">傳入 Writing Agent 的內容預覽</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      if (!data) return
                      await navigator.clipboard.writeText(`${data.content}\n\n---\n\n${data.userPrompt}`)
                      setPreviewCopied(true)
                      setTimeout(() => setPreviewCopied(false), 2000)
                    }}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 transition-colors"
                  >
                    {previewCopied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    {previewCopied ? '已複製' : '複製'}
                  </button>
                  <button onClick={() => setShowPreview(false)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
              {/* Content */}
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {data ? (
                  <>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">content（參考資料）</p>
                    <pre className="mb-4 whitespace-pre-wrap rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700 font-mono">{data.content}</pre>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">userPrompt（AI 指令）</p>
                    <pre className="whitespace-pre-wrap rounded-lg border border-sky-100 bg-sky-50 p-4 text-sm text-sky-800 font-mono">{data.userPrompt}</pre>
                  </>
                ) : (
                  <p className="text-sm text-gray-400">無資料</p>
                )}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
