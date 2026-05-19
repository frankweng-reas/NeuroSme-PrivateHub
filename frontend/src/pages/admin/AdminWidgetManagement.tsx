/** Admin Bot 部署管理：列出所有 Bot，由 admin 統一開通 / 撤銷 Widget Token */
import { useEffect, useState } from 'react'
import {
  CheckCircle2, CircleOff, Code2, Copy, Lock, Loader2,
  RefreshCw, Unlock, Wifi, WifiOff, X,
} from 'lucide-react'
import { listBots, generateBotToken, revokeBotToken, type Bot } from '@/api/bots'
import { useToast } from '@/contexts/ToastContext'

const EMBED_CODE = (origin: string, token: string, color: string) =>
  [
    `<!-- NeuroSme Bot Widget -->`,
    `<button id="ns-btn" onclick="nsTgl()"`,
    `  style="position:fixed;bottom:24px;right:24px;z-index:10000;`,
    `         width:56px;height:56px;border-radius:50%;border:none;`,
    `         background:${color};color:#fff;font-size:26px;`,
    `         cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.2)">💬</button>`,
    `<iframe id="ns-ifr" frameborder="0"`,
    `  style="display:none;position:fixed;bottom:88px;right:24px;z-index:9999;`,
    `         width:400px;height:600px;`,
    `         border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.18)"></iframe>`,
    `<script>`,
    `function nsTgl() {`,
    `  var f = document.getElementById('ns-ifr');`,
    `  var b = document.getElementById('ns-btn');`,
    `  var o = f.style.display !== 'none';`,
    `  if (!o && !f.src) f.src = '${origin}/widget/bot/${token}?embed=1';`,
    `  f.style.display = o ? 'none' : 'block';`,
    `  b.innerHTML = o ? '💬' : '✕';`,
    `}`,
    `<\/script>`,
  ].join('\n')

/** Embed Code Modal */
function EmbedModal({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const [copied, setCopied] = useState<'link' | 'embed' | null>(null)
  const origin = window.location.origin
  const widgetUrl = `${origin}/widget/bot/${bot.public_token!}`
  const color = bot.widget_color || '#1A3A52'
  const embedCode = EMBED_CODE(origin, bot.public_token!, color)

  const copy = (text: string, type: 'link' | 'embed') => {
    navigator.clipboard.writeText(text)
    setCopied(type)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">嵌入碼 — {bot.name}</h3>
            <p className="mt-0.5 text-sm text-gray-400">複製後貼入目標網頁 &lt;body&gt; 尾端</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {/* Widget URL */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Widget 連結</label>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={widgetUrl}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-700 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => copy(widgetUrl, 'link')}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                {copied === 'link'
                  ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                  : <Copy className="h-4 w-4" />}
                複製
              </button>
            </div>
          </div>

          {/* Embed Code */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">Embed Code</label>
              <button
                type="button"
                onClick={() => copy(embedCode, 'embed')}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
              >
                {copied === 'embed'
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  : <Copy className="h-3.5 w-3.5" />}
                複製
              </button>
            </div>
            <textarea
              readOnly
              rows={10}
              value={embedCode}
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-600 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex justify-end border-t px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  )
}

type FilterAccess = 'all' | 'public' | 'authenticated'
type FilterDeploy = 'all' | 'deployed' | 'undeployed'
type FilterStatus = 'all' | 'active' | 'inactive'

export default function AdminWidgetManagement() {
  const [bots, setBots] = useState<Bot[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const [embedBot, setEmbedBot] = useState<Bot | null>(null)
  const { showToast } = useToast()

  const [filterAccess, setFilterAccess] = useState<FilterAccess>('all')
  const [filterDeploy, setFilterDeploy] = useState<FilterDeploy>('all')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    listBots()
      .then(setBots)
      .catch(() => setBots([]))
      .finally(() => setLoading(false))
  }, [])

  const updateBot = (updated: Bot) =>
    setBots((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))

  const filteredBots = bots.filter((b) => {
    if (search && !b.name.toLowerCase().includes(search.toLowerCase())) return false
    if (filterAccess === 'public' && b.access_mode !== 'public') return false
    if (filterAccess === 'authenticated' && b.access_mode !== 'authenticated') return false
    if (filterDeploy === 'deployed' && !b.public_token) return false
    if (filterDeploy === 'undeployed' && b.public_token) return false
    if (filterStatus === 'active' && !b.is_active) return false
    if (filterStatus === 'inactive' && b.is_active) return false
    return true
  })

  const hasFilter = filterAccess !== 'all' || filterDeploy !== 'all' || filterStatus !== 'all' || search !== ''

  const handleGenerate = async (bot: Bot) => {
    setActionLoading(bot.id)
    try {
      const updated = await generateBotToken(bot.id)
      updateBot(updated)
      showToast(`「${bot.name}」已開通部署`)
    } catch {
      showToast('開通失敗，請稍後再試', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleRevoke = async (bot: Bot) => {
    if (!window.confirm(`確定要停用「${bot.name}」的 Widget？現有連結將立即失效。`)) return
    setActionLoading(bot.id)
    try {
      const updated = await revokeBotToken(bot.id)
      updateBot(updated)
      showToast(`「${bot.name}」Widget 已停用`)
    } catch {
      showToast('停用失敗，請稍後再試', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleReset = async (bot: Bot) => {
    if (!window.confirm(`確定要重設「${bot.name}」的 Widget Token？舊連結將立即失效。`)) return
    setActionLoading(bot.id)
    try {
      const updated = await generateBotToken(bot.id)
      updateBot(updated)
      showToast(`「${bot.name}」Token 已重設`)
    } catch {
      showToast('重設失敗，請稍後再試', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const deployed = bots.filter((b) => b.public_token).length

  return (
    <>
      {embedBot && <EmbedModal bot={embedBot} onClose={() => setEmbedBot(null)} />}

      <div className="space-y-5">
        {/* 頁首 */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Bot 部署管理</h1>
            <p className="mt-1 text-sm text-gray-500">
              開通後，Bot Widget 可嵌入外部網站。Token 由管理員統一管理；Bot 內容設定請至 KB Bot Builder。
            </p>
          </div>
          {!loading && bots.length > 0 && (
            <span className="shrink-0 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-600">
              已部署 {deployed} / {bots.length}
            </span>
          )}
        </div>

        {/* Filter Bar */}
        {!loading && bots.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            {/* 搜尋 */}
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜尋 Bot 名稱…"
              className="h-8 w-48 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:border-sky-400 focus:outline-none"
            />

            <div className="h-4 w-px bg-gray-300" />

            {/* 存取控制 */}
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-400 mr-1">存取控制</span>
              {([
                { v: 'all',           label: '全部' },
                { v: 'public',        label: '🔓 公開' },
                { v: 'authenticated', label: '🔒 內部認證' },
              ] as { v: FilterAccess; label: string }[]).map(({ v, label }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setFilterAccess(v)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    filterAccess === v
                      ? 'bg-sky-500 text-white'
                      : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="h-4 w-px bg-gray-300" />

            {/* 部署狀態 */}
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-400 mr-1">部署</span>
              {([
                { v: 'all',        label: '全部' },
                { v: 'deployed',   label: '已部署' },
                { v: 'undeployed', label: '未部署' },
              ] as { v: FilterDeploy; label: string }[]).map(({ v, label }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setFilterDeploy(v)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    filterDeploy === v
                      ? 'bg-sky-500 text-white'
                      : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="h-4 w-px bg-gray-300" />

            {/* 服務狀態 */}
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-400 mr-1">服務</span>
              {([
                { v: 'all',      label: '全部' },
                { v: 'active',   label: '運行中' },
                { v: 'inactive', label: '已暫停' },
              ] as { v: FilterStatus; label: string }[]).map(({ v, label }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setFilterStatus(v)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    filterStatus === v
                      ? 'bg-sky-500 text-white'
                      : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* 重置 */}
            {hasFilter && (
              <>
                <div className="h-4 w-px bg-gray-300" />
                <button
                  type="button"
                  onClick={() => { setFilterAccess('all'); setFilterDeploy('all'); setFilterStatus('all'); setSearch('') }}
                  className="text-xs text-gray-400 hover:text-gray-600 underline"
                >
                  清除篩選
                </button>
              </>
            )}

            <span className="ml-auto text-xs text-gray-400">
              顯示 {filteredBots.length} / {bots.length} 筆
            </span>
          </div>
        )}

        {/* 表格 */}
        {loading ? (
          <div className="flex flex-1 items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
          </div>
        ) : bots.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 py-16">
            <p className="text-sm text-gray-400">目前沒有 Bot，請先至 KB Bot Builder 建立 Bot。</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Bot 名稱</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">服務狀態</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">部署狀態</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {filteredBots.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-400">
                      沒有符合條件的 Bot
                    </td>
                  </tr>
                ) : filteredBots.map((bot) => (
                  <tr key={bot.id} className="hover:bg-gray-50">
                    {/* 名稱 */}
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">{bot.name}</p>
                      {bot.description && (
                        <p className="mt-0.5 max-w-xs truncate text-xs text-gray-400">{bot.description}</p>
                      )}
                      <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        bot.access_mode === 'authenticated'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {bot.access_mode === 'authenticated'
                          ? <><Lock className="h-2.5 w-2.5" />內部認證</>
                          : <><Unlock className="h-2.5 w-2.5" />公開</>}
                      </span>
                    </td>

                    {/* 服務狀態 */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        bot.is_active
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {bot.is_active ? '運行中' : '已暫停'}
                      </span>
                    </td>

                    {/* 部署狀態 */}
                    <td className="px-4 py-3">
                      {bot.public_token ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-700">
                          <Wifi className="h-3 w-3" />已部署
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-400">
                          <WifiOff className="h-3 w-3" />未部署
                        </span>
                      )}
                    </td>

                    {/* 操作 */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {actionLoading === bot.id && (
                          <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                        )}
                        {!bot.public_token ? (
                          <button
                            type="button"
                            onClick={() => handleGenerate(bot)}
                            disabled={actionLoading === bot.id}
                            className="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs text-sky-700 transition-colors hover:bg-sky-100 disabled:opacity-50"
                          >
                            <Wifi className="h-3.5 w-3.5" />開通部署
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => setEmbedBot(bot)}
                              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-50"
                            >
                              <Code2 className="h-3.5 w-3.5" />嵌入碼
                            </button>
                            <button
                              type="button"
                              onClick={() => handleReset(bot)}
                              disabled={actionLoading === bot.id}
                              className="inline-flex items-center gap-1 rounded-lg border border-orange-200 px-2.5 py-1 text-xs text-orange-600 transition-colors hover:bg-orange-50 disabled:opacity-50"
                              title="重設 Token（舊連結將失效）"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />重設 Token
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRevoke(bot)}
                              disabled={actionLoading === bot.id}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                            >
                              <CircleOff className="h-3.5 w-3.5" />停用
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>

            </table>
          </div>
        )}
      </div>
    </>
  )
}
