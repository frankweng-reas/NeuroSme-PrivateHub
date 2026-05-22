/**
 * KB Bot 訊息整合設定頁面
 * 支援多平台：FB Messenger（已支援）、LINE / WhatsApp（即將推出）
 */
import { useEffect, useState } from 'react'
import { Check, Copy, Eye, EyeOff, Loader2, Trash2 } from 'lucide-react'
import {
  deleteFbIntegration,
  getFbIntegration,
  saveFbIntegration,
  type FbIntegration,
} from '@/api/bots'
import ConfirmModal from '@/components/ConfirmModal'
import ErrorModal from '@/components/ErrorModal'
import type { Bot } from '@/api/bots'

interface Props {
  canManage: boolean
  selectedBot: Bot | null
}

// ── FB Messenger 設定子元件 ───────────────────────────────────────────────────

interface FbPanelProps {
  botId: number
  canManage: boolean
}

function FbPanel({ botId, canManage }: FbPanelProps) {
  const [data, setData] = useState<FbIntegration | null>(null)
  const [loading, setLoading] = useState(true)
  const [tokenInput, setTokenInput] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copiedWebhook, setCopiedWebhook] = useState(false)
  const [copiedVerify, setCopiedVerify] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    getFbIntegration(botId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [botId])

  const handleSave = async () => {
    if (!tokenInput.trim()) return
    setSaving(true)
    try {
      const result = await saveFbIntegration(botId, tokenInput.trim())
      setData(result)
      setTokenInput('')
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : '儲存失敗，請稍後再試')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    try {
      await deleteFbIntegration(botId)
      setData(prev => prev ? { ...prev, enabled: false, page_access_token_masked: null } : null)
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : '移除失敗，請稍後再試')
    } finally {
      setDeleteTarget(false)
    }
  }

  const copy = async (text: string, setter: (v: boolean) => void) => {
    await navigator.clipboard.writeText(text)
    setter(true)
    setTimeout(() => setter(false), 2000)
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> 載入中…
      </div>
    )
  }

  return (
    <div className="space-y-4 pt-1">
      {/* Webhook URL + Verify Token */}
      {(data?.webhook_url || data?.verify_token) && (
        <div className="space-y-3">
          {data.webhook_url && (
            <CopyField
              label="Webhook URL（填入 FB Developer Console）"
              value={data.webhook_url}
              copied={copiedWebhook}
              onCopy={() => copy(data.webhook_url, setCopiedWebhook)}
            />
          )}
          {data.verify_token && (
            <CopyField
              label="Verify Token（填入 FB Developer Console）"
              value={data.verify_token}
              copied={copiedVerify}
              onCopy={() => copy(data.verify_token, setCopiedVerify)}
            />
          )}
          {data.enabled && data.page_access_token_masked && (
            <div>
              <p className="mb-1 text-xs font-medium text-gray-500">Page Access Token</p>
              <p className="font-mono text-sm text-gray-800">{data.page_access_token_masked}</p>
            </div>
          )}
          {data.enabled && data.connected_at && (
            <p className="text-xs text-gray-400">
              連線時間：{new Date(data.connected_at).toLocaleString('zh-TW')}
            </p>
          )}
        </div>
      )}

      {/* 設定說明 */}
      <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 space-y-2">
        <p className="text-sm font-semibold text-gray-800">設定步驟</p>
        <ol className="list-decimal list-inside space-y-1.5 text-sm text-gray-600">
          <li>複製上方的 <strong className="text-gray-900">Webhook URL</strong> 與 <strong className="text-gray-900">Verify Token</strong></li>
          <li>前往 <a href="https://developers.facebook.com" target="_blank" rel="noreferrer" className="text-indigo-600 underline hover:text-indigo-800">FB Developer Console</a>，在 Webhooks 設定填入並驗證</li>
          <li>取得粉專的 <strong className="text-gray-900">Page Access Token</strong></li>
          <li>貼入下方並儲存，即完成啟用</li>
          <li>訂閱 <code className="rounded bg-gray-200 px-1 py-0.5 text-xs text-gray-800">messages</code> 事件</li>
        </ol>
      </div>

      {/* 輸入 Token */}
      {canManage && (
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-gray-700">
            {data?.enabled ? '更新 Page Access Token' : '貼上 Page Access Token'}
          </label>
          <div className="flex">
            <input
              type={showToken ? 'text' : 'password'}
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              placeholder="EAAxxxxxxxxxxxxx..."
              className="flex-1 rounded-l-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <button
              type="button"
              onClick={() => setShowToken(v => !v)}
              className="rounded-r-lg border border-l-0 border-gray-300 bg-gray-50 px-3 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            >
              {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !tokenInput.trim()}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {data?.enabled ? '更新' : '儲存並啟用'}
            </button>
            {data?.enabled && (
              <button
                type="button"
                onClick={() => setDeleteTarget(true)}
                className="flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4" />
                移除整合
              </button>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={deleteTarget}
        title="移除 FB Messenger 整合"
        message="確定要移除此 Bot 的 FB Messenger 整合嗎？移除後 FB 訊息將無法自動回覆。"
        confirmText="確認移除"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(false)}
      />
      <ErrorModal open={!!errorMsg} message={errorMsg ?? ''} onClose={() => setErrorMsg(null)} />
    </div>
  )
}

// ── 平台卡片 ──────────────────────────────────────────────────────────────────

interface PlatformDef {
  key: string
  name: string
  description: string
  icon: React.ReactNode
  available: boolean
}

const PLATFORMS: PlatformDef[] = [
  {
    key: 'fb',
    name: 'Facebook Messenger',
    description: '讓 FB 粉專自動用 Bot 回答訊息',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#1877F2]">
        <path d="M12 2C6.477 2 2 6.145 2 11.243c0 2.821 1.29 5.338 3.33 7.07V22l3.036-1.67c.81.225 1.667.346 2.634.346 5.523 0 10-4.145 10-9.243S17.523 2 12 2zm1.05 12.454l-2.547-2.717-4.97 2.717 5.467-5.8 2.61 2.717 4.907-2.717-5.467 5.8z"/>
      </svg>
    ),
    available: true,
  },
  {
    key: 'line',
    name: 'LINE',
    description: '讓 LINE 官方帳號自動用 Bot 回答訊息',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#00B900]">
        <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/>
      </svg>
    ),
    available: false,
  },
  {
    key: 'whatsapp',
    name: 'WhatsApp',
    description: '讓 WhatsApp Business 自動用 Bot 回答訊息',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#25D366]">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
      </svg>
    ),
    available: false,
  },
]

// ── 主元件 ────────────────────────────────────────────────────────────────────

export default function AgentKbBotMessaging({ canManage, selectedBot }: Props) {
  const [expandedKey, setExpandedKey] = useState<string | null>('fb')

  if (!selectedBot) {
    return (
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <p className="text-base text-gray-500">請先在左側選擇 Bot</p>
      </div>
    )
  }

  if (!selectedBot.public_token) {
    return (
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="rounded-xl border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-800">
          此 Bot 尚未開通 Widget Token。請先到「部署」tab 產生 public token，才能啟用訊息整合。
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-5 py-5 space-y-3">
      <p className="text-sm text-gray-500 mb-1">選擇要整合的訊息平台</p>

      {PLATFORMS.map(platform => (
        <div key={platform.key} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          {/* 平台標題列（點擊展開） */}
          <button
            type="button"
            onClick={() => {
              if (!platform.available) return
              setExpandedKey(prev => prev === platform.key ? null : platform.key)
            }}
            className={`w-full flex items-center gap-3 px-5 py-4 text-left transition-colors ${
              platform.available ? 'hover:bg-gray-50 cursor-pointer' : 'cursor-default'
            }`}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100">
              {platform.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">{platform.name}</p>
              <p className="text-xs text-gray-500">{platform.description}</p>
            </div>
            {platform.available ? (
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                expandedKey === platform.key
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-gray-100 text-gray-600'
              }`}>
                {expandedKey === platform.key ? '收起' : '設定'}
              </span>
            ) : (
              <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-400">
                即將推出
              </span>
            )}
          </button>

          {/* 展開內容 */}
          {platform.available && expandedKey === platform.key && (
            <div className="border-t border-gray-100 px-5 pb-5">
              {platform.key === 'fb' && (
                <FbPanel botId={selectedBot.id} canManage={canManage} />
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── 共用元件 ──────────────────────────────────────────────────────────────────

function CopyField({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string
  value: string
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-gray-500">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 font-mono text-sm text-gray-800">
          {value}
        </code>
        <button
          type="button"
          onClick={onCopy}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:border-gray-400 hover:bg-gray-50 hover:text-gray-900"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? '已複製' : '複製'}
        </button>
      </div>
    </div>
  )
}
