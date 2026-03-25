/**
 * 測試頁：新 compute_engine（佈局雛形）。路徑 /dev-test-compute-engine
 */
import { useEffect, useState } from 'react'
import { Copy } from 'lucide-react'
import { computeEngine, type ComputeEngineResponse } from '@/api/chat'
import { ApiError } from '@/api/client'

const LS_DUCKDB = 'neurosme:test-compute-engine:duckdb-name'
const LS_SCHEMA_ID = 'neurosme:test-compute-engine:schema-id'
const LS_INTENT = 'neurosme:test-compute-engine:intent-json'
const LS_SQL_MANUAL = 'neurosme:test-compute-engine:sql-manual'

function readStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

/** 後端組好 SQL 後放在 generated_sql 或 debug.sql */
function sqlFromResponse(res: ComputeEngineResponse | null): string {
  if (!res) return ''
  const top = res.generated_sql
  if (typeof top === 'string' && top.trim()) return top
  const s = res.debug && typeof res.debug.sql === 'string' ? res.debug.sql : ''
  return s
}

function blockersFrom(res: ComputeEngineResponse | null): string[] {
  const b = res?.debug?.blockers
  return Array.isArray(b) ? b.filter((x): x is string => typeof x === 'string') : []
}

export default function TestComputeEngine() {
  const [duckdbName, setDuckdbName] = useState(() => readStored(LS_DUCKDB, ''))
  const [schemaId, setSchemaId] = useState(() => readStored(LS_SCHEMA_ID, ''))
  const [intentJson, setIntentJson] = useState(() => readStored(LS_INTENT, ''))
  const [manualSql, setManualSql] = useState(() => readStored(LS_SQL_MANUAL, ''))
  const [resultText, setResultText] = useState<string>('')
  const [apiResult, setApiResult] = useState<ComputeEngineResponse | null>(null)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(LS_DUCKDB, duckdbName)
      localStorage.setItem(LS_SCHEMA_ID, schemaId)
      localStorage.setItem(LS_INTENT, intentJson)
      localStorage.setItem(LS_SQL_MANUAL, manualSql)
    } catch {
      /* quota / private mode */
    }
  }, [duckdbName, schemaId, intentJson, manualSql])

  const displaySql = sqlFromResponse(apiResult)
  const displaySqlBlockers = blockersFrom(apiResult)
  const sqlTextareaValue =
    displaySql ||
    (displaySqlBlockers.length > 0
      ? `（此 intent 尚未組出 SQL）\n${displaySqlBlockers.map((s) => `- ${s}`).join('\n')}`
      : apiResult
        ? '（此回應沒有 SQL，見下方 JSON）'
        : '發送後會顯示後端組好的 SQL。')

  const [copySqlHint, setCopySqlHint] = useState<string>('')
  const [copyIntentHint, setCopyIntentHint] = useState<string>('')

  async function copyIntentToClipboard() {
    const text = intentJson
    setCopyIntentHint('')
    try {
      await navigator.clipboard.writeText(text)
      setCopyIntentHint('已複製')
      window.setTimeout(() => setCopyIntentHint(''), 2000)
    } catch {
      setCopyIntentHint('複製失敗')
      window.setTimeout(() => setCopyIntentHint(''), 2500)
    }
  }

  async function copySqlToClipboard() {
    const text = displaySql.trim()
    if (!text) return
    setCopySqlHint('')
    try {
      await navigator.clipboard.writeText(text)
      setCopySqlHint('已複製')
      window.setTimeout(() => setCopySqlHint(''), 2000)
    } catch {
      setCopySqlHint('複製失敗')
      window.setTimeout(() => setCopySqlHint(''), 2500)
    }
  }

  async function handleSend() {
    setResultText('')
    setApiResult(null)
    let intentObj: Record<string, unknown>
    try {
      intentObj = JSON.parse(intentJson || '{}') as Record<string, unknown>
    } catch {
      setResultText('Intent JSON 解析失敗，請檢查語法。')
      return
    }
    const name = duckdbName.trim()
    if (!name) {
      setResultText('請填 DuckDB 名稱。')
      return
    }
    setSending(true)
    try {
      const sid = schemaId.trim()
      const res = await computeEngine({
        duckdb_name: name,
        intent: intentObj,
        ...(sid ? { schema_id: sid } : {}),
      })
      setApiResult(res)
      const payload = {
        chart_result: res.chart_result,
        error_detail: res.error_detail ?? null,
        debug: res.debug ?? {},
        generated_sql: res.generated_sql ?? null,
      }
      setResultText(JSON.stringify(payload, null, 2))
    } catch (e) {
      setApiResult(null)
      const msg =
        e instanceof ApiError ? e.detail || e.message : e instanceof Error ? e.message : String(e)
      setResultText(`請求失敗：${msg}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="force-light-form-widgets box-border flex min-h-[100dvh] w-full flex-1 flex-col px-4 py-4 md:min-h-0">
      <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row md:items-stretch">
        <section
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
          aria-label="左側容器"
        >
          <div className="flex shrink-0 flex-col gap-2 border-b border-slate-200 p-4">
            <h2 className="text-sm font-medium text-slate-500">DuckDB 名稱</h2>
            <label htmlFor="test-compute-duckdb-name" className="sr-only">
              DuckDB database 名稱
            </label>
            <input
              id="test-compute-duckdb-name"
              type="text"
              value={duckdbName}
              onChange={(e) => setDuckdbName(e.target.value)}
              placeholder="例如 my_db.duckdb 或邏輯名稱"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1 scheme-light [color-scheme:light]"
            />
          </div>
          <div className="flex shrink-0 flex-col gap-2 border-b border-slate-200 p-4">
            <h2 className="text-sm font-medium text-slate-500">schema_id</h2>
            <label htmlFor="test-compute-schema-id" className="sr-only">
              bi_schemas.id
            </label>
            <input
              id="test-compute-schema-id"
              type="text"
              value={schemaId}
              onChange={(e) => setSchemaId(e.target.value)}
              placeholder="bi_schemas 的 id（可覆寫 intent 內 schema_id）"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1 scheme-light [color-scheme:light]"
            />
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-slate-500">Intent JSON（可貼上）</h2>
              <div className="flex items-center gap-2">
                {copyIntentHint ? (
                  <span className="text-xs text-slate-500" aria-live="polite">
                    {copyIntentHint}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => void copyIntentToClipboard()}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-800"
                  title="複製 JSON（與 dev-test-compute-tool 相同：純文字，貼上無黑底）"
                >
                  <Copy className="h-4 w-4" />
                  複製
                </button>
              </div>
            </div>
            <label htmlFor="test-compute-intent-json" className="sr-only">
              貼上 intent JSON 內容
            </label>
            {/* compute-tool 意圖區用 pre；此頁需可編輯故仍用 textarea。無黑底請用「複製」或 Cmd+Shift+V 純文字貼上。 */}
            <textarea
              id="test-compute-intent-json"
              value={intentJson}
              onChange={(e) => setIntentJson(e.target.value)}
              placeholder='{"intent": "...", ...}'
              spellCheck={false}
              className="min-h-[120px] w-full flex-1 basis-0 resize-y overflow-x-auto rounded-lg border border-gray-200 bg-slate-50 p-4 font-mono text-sm leading-relaxed text-slate-800 placeholder:text-slate-400 scheme-light [color-scheme:light] selection:bg-slate-200 selection:text-slate-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            />
            <button
              type="button"
              disabled={sending}
              onClick={() => void handleSend()}
              className="mt-1 w-full shrink-0 rounded-md bg-slate-800 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-slate-900 disabled:opacity-50"
            >
              {sending ? '計算中…' : '發送'}
            </button>
          </div>
        </section>

        <section
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          aria-label="右側容器"
        >
          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-slate-500">產生的 SQL</h2>
              <div className="flex items-center gap-2">
                {copySqlHint ? (
                  <span className="text-xs text-slate-500" aria-live="polite">
                    {copySqlHint}
                  </span>
                ) : null}
                <button
                  type="button"
                  disabled={!displaySql.trim()}
                  onClick={() => void copySqlToClipboard()}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  複製 SQL
                </button>
              </div>
            </div>
            <label htmlFor="test-compute-generated-sql" className="sr-only">
              後端產生的 SQL
            </label>
            {/* readOnly textarea 在部分瀏覽器／深色模式下會單獨變黑底；改與下方 JSON 相同的淺色 pre */}
            <pre
              id="test-compute-generated-sql"
              tabIndex={0}
              className="min-h-[100px] w-full flex-1 basis-0 overflow-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50/80 p-3 font-mono text-xs leading-relaxed text-slate-800 outline-none selection:bg-slate-200 selection:text-slate-900 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1"
            >
              {sqlTextareaValue}
            </pre>
            <div className="mt-2 flex shrink-0 flex-col gap-1.5">
              <h2 className="text-sm font-medium text-slate-500">SQL</h2>
              <label htmlFor="test-compute-sql-manual" className="sr-only">
                手動編輯或貼上的 SQL
              </label>
              <textarea
                id="test-compute-sql-manual"
                value={manualSql}
                onChange={(e) => setManualSql(e.target.value)}
                placeholder="SQL"
                spellCheck={false}
                className="min-h-[100px] w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs leading-relaxed text-slate-900 placeholder:text-slate-400 scheme-light [color-scheme:light] selection:bg-slate-200 selection:text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1"
              />
            </div>
            {(() => {
              const dbg = apiResult?.debug
              const params = dbg && Array.isArray(dbg.sql_params) ? dbg.sql_params : null
              return params && params.length > 0 ? (
                <p className="shrink-0 font-mono text-[11px] text-slate-600">
                  params (順序對應 ?): {JSON.stringify(params)}
                </p>
              ) : null
            })()}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 border-t border-slate-200 pt-2">
            <h2 className="shrink-0 text-sm font-medium text-slate-500">回應 JSON</h2>
            <pre className="min-h-[120px] flex-1 basis-0 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50/80 p-3 font-mono text-xs text-slate-800 selection:bg-slate-200 selection:text-slate-900">
              {resultText ||
                '發送後顯示 chart_result、error_detail、debug。請填 schema_id 或於 Intent 內帶 schema_id。'}
            </pre>
          </div>
        </section>
      </div>
    </div>
  )
}
