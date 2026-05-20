/**
 * Bot Widget 公開頁面：/widget/bot/:token
 * - 不需要登入
 * - ?embed=1 → iframe 模式
 * - 訪客表單已移除，改為匿名 session 自動建立
 * - 若 Bot 啟用首頁面（home_enabled），新訪客先看首頁面再進對話
 */
import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { I18nextProvider, useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronRight,
  Globe,
  HelpCircle,
  Loader2,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  RotateCcw,
  X,
} from 'lucide-react'
import {
  botWidgetChatStream,
  botWidgetTranscribeAudio,
  checkBotWidgetSession,
  createBotWidgetSession,
  getBotWidgetInfo,
  widgetLogin,
  type BotWidgetContactLink,
  type BotWidgetFaqItem,
  type BotWidgetInfo,
} from '@/api/widget_bot_public'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import widgetI18n from '@/i18n/widgetI18n'
import AgentChat, { type Message } from '@/components/AgentChat'
import VoiceInput from '@/components/VoiceInput'

// ── 型別 ──────────────────────────────────────────────────────────────────────

interface StoredSession {
  sessionId: string
  messages: Message[]
}

// ── 常數 ──────────────────────────────────────────────────────────────────────

const SESSION_KEY = (token: string) => `bot_widget_session_${token}`
const AUTH_KEY = (token: string) => `bot_widget_auth_${token}`
const POPULAR_PREVIEW = 3   // 預設顯示幾筆熱門問題

/** 新訪客是否應先看到首頁（歡迎語 / 熱門 FAQ） */
function shouldShowWidgetHome(info: Pick<BotWidgetInfo, 'home_enabled' | 'popular_faq_enabled' | 'popular_faqs'>): boolean {
  return info.home_enabled || (info.popular_faq_enabled && info.popular_faqs.length > 0)
}

function loadWidgetAuthToken(token: string): string | null {
  try { return localStorage.getItem(AUTH_KEY(token)) } catch { return null }
}
function saveWidgetAuthToken(token: string, jwt: string) {
  try { localStorage.setItem(AUTH_KEY(token), jwt) } catch {}
}
function clearWidgetAuthToken(token: string) {
  try { localStorage.removeItem(AUTH_KEY(token)) } catch {}
}

function loadSession(token: string): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY(token))
    return raw ? (JSON.parse(raw) as StoredSession) : null
  } catch {
    return null
  }
}

function saveSession(token: string, data: StoredSession) {
  try {
    localStorage.setItem(SESSION_KEY(token), JSON.stringify(data))
  } catch { /* iframe / 無痕儲存被拒 */ }
}

function clearSession(token: string) {
  try { localStorage.removeItem(SESSION_KEY(token)) } catch { /* ignore */ }
}

function genSessionId() {
  return (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2))
}

// ── 熱門問題卡片 ──────────────────────────────────────────────────────────────

function PopularFaqCards({
  faqs,
  color,
}: {
  faqs: BotWidgetFaqItem[]
  color: string
}) {
  const [openId, setOpenId] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)

  const visible = showAll ? faqs : faqs.slice(0, POPULAR_PREVIEW)
  const hasMore = faqs.length > POPULAR_PREVIEW

  return (
    <div className="flex flex-col gap-2">
      {visible.map((faq, idx) => {
        const isOpen = openId === faq.id
        return (
          <div
            key={faq.id}
            className="overflow-hidden rounded-2xl bg-white"
            style={{
              boxShadow: isOpen
                ? `0 2px 12px 0 ${color}28`
                : '0 1px 4px 0 rgba(0,0,0,0.07)',
              border: isOpen ? `1.5px solid ${color}40` : '1.5px solid transparent',
              transition: 'border-color 0.18s, box-shadow 0.18s',
            }}
          >
            <button
              type="button"
              onClick={() => setOpenId(isOpen ? null : faq.id)}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
            >
              {/* 序號 badge */}
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{ backgroundColor: isOpen ? color : color + 'aa' }}
              >
                {idx + 1}
              </span>

              {/* 問題文字 */}
              <span
                className="flex-1 text-sm font-medium leading-snug"
                style={{ color: isOpen ? color : '#1f2937' }}
              >
                {faq.question}
              </span>

              {/* 箭頭 */}
              <span
                className="shrink-0 transition-transform duration-200"
                style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
              >
                <ChevronRight className="h-4 w-4 text-gray-300" />
              </span>
            </button>

            {/* 答案 */}
            {isOpen && (
              <div
                className="px-4 pb-4 pt-1 text-sm leading-relaxed text-gray-600"
                style={{ borderTop: `1px solid ${color}20` }}
              >
                <div
                  className="faq-answer rounded-xl px-4 py-3 text-sm leading-relaxed text-gray-600"
                  style={{ backgroundColor: color + '0d' }}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkBreaks]}
                    components={{
                      a: ({ children, href, ...props }) => {
                        const safeHref =
                          href && !/^https?:\/\//i.test(href) && !href.startsWith('mailto:')
                            ? `https://${href}`
                            : href
                        return (
                          <a
                            className="text-blue-600 underline hover:text-blue-800"
                            target="_blank"
                            rel="noopener noreferrer"
                            href={safeHref}
                            {...props}
                          >
                            {children}
                          </a>
                        )
                      },
                      p: ({ children, ...props }) => (
                        <p className="mb-1.5 last:mb-0 leading-relaxed" {...props}>
                          {children}
                        </p>
                      ),
                      ul: ({ children, ...props }) => (
                        <ul className="mb-1.5 ml-4 list-disc space-y-0.5" {...props}>{children}</ul>
                      ),
                      ol: ({ children, ...props }) => (
                        <ol className="mb-1.5 ml-4 list-decimal space-y-0.5" {...props}>{children}</ol>
                      ),
                      strong: ({ children, ...props }) => (
                        <strong className="font-semibold text-gray-800" {...props}>{children}</strong>
                      ),
                      code: ({ children, ...props }) => (
                        <code className="rounded bg-gray-100 px-1 py-0.5 text-xs font-mono text-gray-700" {...props}>
                          {children}
                        </code>
                      ),
                    }}
                  >
                    {faq.answer}
                  </ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* 顯示更多 */}
      {hasMore && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-1 flex w-full items-center justify-center gap-1 py-2 text-sm font-medium transition-colors"
          style={{ color }}
        >
          顯示更多
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

// ── 常見問題 Sheet（底部滑出）────────────────────────────────────────────────

function FaqSheet({
  faqs,
  color,
  title,
  onClose,
}: {
  faqs: BotWidgetFaqItem[]
  color: string
  title: string
  onClose: () => void
}) {
  return (
    <div
      className="absolute inset-0 z-50 flex flex-col justify-end"
      style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[78%] flex-col overflow-hidden rounded-t-2xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sheet header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3">
          <span className="text-sm font-semibold text-gray-800">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* 卡片列表 */}
        <div className="overflow-y-auto p-4">
          <PopularFaqCards faqs={faqs} color={color} />
        </div>
      </div>
    </div>
  )
}

// ── 聯絡資訊 Sheet ────────────────────────────────────────────────────────────

const CONTACT_ICON: Record<string, React.ReactNode> = {
  phone: <Phone className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
  line:  <MessageCircle className="h-4 w-4" />,
  form:  <Globe className="h-4 w-4" />,
  url:   <Globe className="h-4 w-4" />,
}

function buildContactHref(type: string, value: string): string {
  if (type === 'phone') return `tel:${value.replace(/\s/g, '')}`
  if (type === 'email') return `mailto:${value}`
  if (/^https?:\/\//i.test(value)) return value
  return `https://${value}`
}

function ContactSheet({
  links,
  color,
  title,
  onClose,
}: {
  links: BotWidgetContactLink[]
  color: string
  title: string
  onClose: () => void
}) {
  return (
    <div
      className="absolute inset-0 z-50 flex flex-col justify-end"
      style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[70%] flex-col overflow-hidden rounded-t-2xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3">
          <span className="text-sm font-semibold text-gray-800">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* 聯絡項目 */}
        <div className="overflow-y-auto p-4 space-y-2">
          {links.map((lk, idx) => (
            <a
              key={idx}
              href={buildContactHref(lk.type, lk.value)}
              target={lk.type === 'phone' || lk.type === 'email' ? '_self' : '_blank'}
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3.5 shadow-sm transition-colors hover:bg-gray-50"
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
                style={{ backgroundColor: color }}
              >
                {CONTACT_ICON[lk.type] ?? <Globe className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800">{lk.label}</p>
                <p className="truncate text-xs text-gray-400">{lk.value}</p>
              </div>
              <Globe className="h-3.5 w-3.5 shrink-0 text-gray-300" />
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── 認證登入頁 ────────────────────────────────────────────────────────────────

function LoginPage({
  title,
  color,
  logoUrl,
  onLogin,
}: {
  title: string
  color: string
  logoUrl?: string | null
  onLogin: (email: string, password: string) => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) return
    setLoading(true)
    setError(null)
    try {
      await onLogin(email.trim(), password)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '登入失敗，請稍後再試')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* 品牌區 */}
      <div className="shrink-0 px-6 pb-8 pt-10 text-center"
        style={{ background: `linear-gradient(160deg, ${color}18 0%, transparent 70%)` }}>
        {logoUrl ? (
          <img src={logoUrl} alt="logo" className="mx-auto mb-4 h-16 w-16 rounded-2xl object-cover shadow" />
        ) : (
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl shadow"
            style={{ backgroundColor: color }}>
            <MessageCircle className="h-8 w-8 text-white" />
          </div>
        )}
        <p className="text-lg font-semibold text-gray-800">{title}</p>
        <p className="mt-1 text-sm text-gray-500">請登入後繼續</p>
      </div>

      {/* 表單 */}
      <div className="mx-5 mt-2">
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">密碼</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-400"
            />
          </div>
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading || !email.trim() || !password}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-base font-semibold text-white transition-opacity disabled:opacity-50"
            style={{ backgroundColor: color }}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? '登入中...' : '登入'}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-gray-400">
          本 Widget 僅限授權人員使用
        </p>
      </div>
    </div>
  )
}

// ── 首頁面 ────────────────────────────────────────────────────────────────────

interface HomePageProps {
  info: BotWidgetInfo
  color: string
}

function HomePage({ info, color }: HomePageProps) {
  const { t } = useTranslation('widget')
  const greeting = info.home_greeting || t('home.greeting_default')

  const hasPopular = info.popular_faq_enabled && info.popular_faqs.length > 0

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">

      {/* ── 歡迎語區（需啟用首頁面）──────────────────────────────── */}
      {info.home_enabled && (
      <div
        className="shrink-0 px-5 pb-5 pt-6"
        style={{
          background: `linear-gradient(160deg, ${color}18 0%, transparent 70%)`,
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
            style={{ backgroundColor: color + '25' }}
          >
            <MessageSquare className="h-5 w-5" style={{ color }} />
          </div>
          <p className="text-base font-semibold leading-snug text-gray-800">
            {greeting}
          </p>
        </div>
      </div>
      )}

      {/* ── 熱門問題 ──────────────────────────────────────────────── */}
      {hasPopular && (
        <div className={`flex flex-1 flex-col px-4 pb-4${info.home_enabled ? '' : ' pt-5'}`}>
          <div className="mb-3 flex items-center gap-2">
            <span
              className="h-3.5 w-1 rounded-full"
              style={{ backgroundColor: color }}
            />
            <p className="text-sm font-semibold text-gray-700">
              {t('home.popular_questions')}
            </p>
          </div>
          <PopularFaqCards faqs={info.popular_faqs} color={color} />
        </div>
      )}
    </div>
  )
}

// ── 首頁 input bar ────────────────────────────────────────────────────────────

function HomeComposer({
  onSubmit,
  isLoading,
  placeholder,
}: {
  onSubmit: (text: string) => void
  isLoading: boolean
  placeholder: string
}) {
  const [input, setInput] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || isLoading) return
    setInput('')
    if (ref.current) { ref.current.style.height = 'auto' }
    onSubmit(text)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex gap-2 border-t border-gray-100 bg-white px-3 pb-2 pt-2"
    >
      <textarea
        ref={ref}
        rows={1}
        value={input}
        onChange={(e) => {
          setInput(e.target.value)
          e.target.style.height = 'auto'
          e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (!isLoading && input.trim()) handleSubmit(e as unknown as React.FormEvent)
          }
        }}
        placeholder={placeholder}
        disabled={isLoading}
        className="min-h-[44px] max-h-[160px] min-w-0 flex-1 resize-none overflow-y-auto rounded-lg border border-gray-300 px-3 py-2.5 text-[16px] leading-snug focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
      />
      <button
        type="submit"
        disabled={isLoading || !input.trim()}
        className="min-h-[44px] min-w-[64px] rounded-2xl bg-gray-800 px-4 py-2 text-[16px] font-medium text-white transition-colors hover:bg-gray-900 disabled:opacity-40"
      >
        送出
      </button>
    </form>
  )
}

// ── 內層元件（需要 i18n context）────────────────────────────────────────────

function WidgetBotInner({ token, isEmbed, langOverride }: { token: string; isEmbed: boolean; langOverride: string }) {
  const { t } = useTranslation('widget')

  const [info, setInfo] = useState<BotWidgetInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [phase, setPhase] = useState<'loading' | 'login' | 'home' | 'chat'>('loading')

  const [widgetAuthToken, setWidgetAuthToken] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [voiceAutoSendText, setVoiceAutoSendText] = useState('')
  const [showFaqSheet, setShowFaqSheet] = useState(false)
  const [showContactSheet, setShowContactSheet] = useState(false)

  // ── 載入 Bot info ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) { setLoadError('載入失敗，請確認連結是否正確'); return }
    getBotWidgetInfo(token)
      .then(async (data) => {
        setInfo(data)

        // Authenticated 模式：檢查本地是否有有效的 auth token
        if (data.access_mode === 'authenticated') {
          const savedAuthToken = loadWidgetAuthToken(token)
          if (savedAuthToken) {
            // 嘗試用既有 token 繼續（驗證是否仍有效）
            try {
              const stored = loadSession(token)
              if (stored) {
                const { valid } = await checkBotWidgetSession(token, stored.sessionId, savedAuthToken)
                if (valid) {
                  setWidgetAuthToken(savedAuthToken)
                  setSessionId(stored.sessionId)
                  setMessages(stored.messages)
                  setPhase('chat')
                  return
                }
              }
              // token 有效但無 session，進首頁/對話
              setWidgetAuthToken(savedAuthToken)
              setPhase(shouldShowWidgetHome(data) ? 'home' : 'chat')
              return
            } catch {
              // token 過期或無效 → 清除，要求重新登入
              clearWidgetAuthToken(token)
              clearSession(token)
            }
          }
          setPhase('login')
          return
        }

        // Public 模式：既有流程
        const stored = loadSession(token)
        if (stored) {
          try {
            const { valid } = await checkBotWidgetSession(token, stored.sessionId)
            if (!valid) {
              clearSession(token)
              setPhase(shouldShowWidgetHome(data) ? 'home' : 'chat')
              return
            }
          } catch {
            // 驗證失敗時保守處理：仍使用本地 session
          }
          setSessionId(stored.sessionId)
          setMessages(stored.messages)
          setPhase('chat')
        } else {
          setPhase(shouldShowWidgetHome(data) ? 'home' : 'chat')
        }
      })
      .catch((e: unknown) => {
        setLoadError(e instanceof Error ? e.message : '載入失敗，請確認連結是否正確')
        setPhase('loading')
      })
  }, [token])

  // ── 依語言優先序切換 ─────────────────────────────────────────────────────────
  useEffect(() => {
    const lang = langOverride || info?.lang || 'zh-TW'
    widgetI18n.changeLanguage(lang)
  }, [langOverride, info?.lang])

  // ── embed 模式：讓 html/body/root 填滿 iframe ─────────────────────────────
  useEffect(() => {
    if (!isEmbed) return
    const style = document.createElement('style')
    style.textContent = 'html,body,#root{height:100%;margin:0;padding:0;overflow:hidden}'
    document.head.appendChild(style)
    return () => { style.remove() }
  }, [isEmbed])

  // ── Widget 登入（authenticated 模式）─────────────────────────────────────────
  async function handleWidgetLogin(email: string, password: string) {
    const resp = await widgetLogin(token, email, password)
    const jwt = resp.access_token
    saveWidgetAuthToken(token, jwt)
    setWidgetAuthToken(jwt)
    setPhase(info && shouldShowWidgetHome(info) ? 'home' : 'chat')
  }

  // ── 送出訊息 ────────────────────────────────────────────────────────────────
  async function handleSend(text: string) {
    if (!text || isLoading) return

    // 從首頁面送出第一則訊息時，立即切換到聊天模式
    setPhase('chat')

    let sid = sessionId
    if (!sid) {
      sid = genSessionId()
      try {
        await createBotWidgetSession(token, { session_id: sid }, widgetAuthToken ?? undefined)
        setSessionId(sid)
        saveSession(token, { sessionId: sid, messages: [] })
      } catch {
        setChatError(t('error.generic'))
        return
      }
    }

    setChatError(null)

    const startIdx = messages.length + 1
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setIsLoading(true)

    let assistantText = ''
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

    try {
      await botWidgetChatStream(
        token,
        {
          session_id: sid,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          content: text,
        },
        {
          onDelta: (chunk) => {
            assistantText += chunk
            setMessages((prev) => {
              const next = [...prev]
              if (next[startIdx]) next[startIdx] = { ...next[startIdx], content: assistantText }
              return next
            })
          },
          onDone: (content?) => {
            if (content) assistantText = content
            setMessages((prev) => {
              const next = [...prev]
              if (next[startIdx]) next[startIdx] = { ...next[startIdx], content: assistantText }
              return next
            })
            saveSession(token, {
              sessionId: sid,
              messages: [...messages, { role: 'user', content: text }, { role: 'assistant', content: assistantText }],
            })
            setIsLoading(false)
          },
          onError: (msg) => {
            setMessages((prev) => prev.slice(0, startIdx))
            setChatError(msg)
            setIsLoading(false)
          },
        },
        widgetAuthToken ?? undefined,
      )
    } catch {
      setMessages((prev) => prev.slice(0, startIdx))
      setIsLoading(false)
    }
  }

  // ── 清除對話 ─────────────────────────────────────────────────────────────────
  function handleReset() {
    clearSession(token)
    setMessages([])
    setSessionId('')
    setChatError(null)
    if (info?.home_enabled) setPhase('home')
    else setPhase('chat')
  }

  // ── 登出（authenticated 模式）─────────────────────────────────────────────────
  function handleLogout() {
    clearSession(token)
    clearWidgetAuthToken(token)
    setMessages([])
    setSessionId('')
    setWidgetAuthToken(null)
    setChatError(null)
    setPhase('login')
  }

  const color = info?.color ?? '#1A3A52'

  // ── 錯誤頁 ──────────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="rounded-xl border border-red-200 bg-white px-8 py-10 text-center shadow">
          <p className="text-lg font-medium text-red-600">{t('error.load_failed')}</p>
          <p className="mt-2 text-base text-gray-500">{loadError}</p>
        </div>
      </div>
    )
  }

  // ── 載入中 ──────────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div
      className={`relative flex flex-col ${isEmbed ? '' : 'mx-auto max-w-lg shadow-xl'}`}
      style={{
        height: '100dvh',
        minHeight: isEmbed ? '100%' : '100vh',
        backgroundColor: '#f8f9fb',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* ── Header ── */}
      <div
        className="flex shrink-0 items-center gap-3 px-4 py-3"
        style={{ backgroundColor: color }}
      >
        {info?.logo_url ? (
          <img src={info.logo_url} alt="logo" className="h-8 w-8 rounded-full object-cover" />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
            <MessageCircle className="h-4 w-4 text-white" />
          </div>
        )}
        <span className="flex-1 text-base font-semibold text-white">
          {info?.title ?? ''}
        </span>
        {info?.contact_enabled && (info?.contact_links?.length ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => setShowContactSheet(true)}
            className="rounded-lg p-1.5 text-white/70 transition-colors hover:bg-white/15 hover:text-white"
            title="聯絡我們"
          >
            <Phone className="h-4 w-4" />
          </button>
        )}
        {info?.common_faq_enabled && (info?.common_faqs?.length ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => setShowFaqSheet(true)}
            className="rounded-lg p-1.5 text-white/70 transition-colors hover:bg-white/15 hover:text-white"
            title={t('home.faq')}
          >
            <HelpCircle className="h-4 w-4" />
          </button>
        )}
        {info?.access_mode === 'authenticated' ? (
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg p-1.5 text-white/70 transition-colors hover:bg-white/15 hover:text-white"
            title="登出"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleReset}
            className="rounded-lg p-1.5 text-white/70 transition-colors hover:bg-white/15 hover:text-white"
            title={t('chat.reset_title')}
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* ── 登入（authenticated 模式）── */}
      {phase === 'login' && info && (
        <LoginPage
          title={info.title}
          color={color}
          logoUrl={info.logo_url}
          onLogin={handleWidgetLogin}
        />
      )}

      {/* ── 首頁面 ── */}
      {phase === 'home' && info && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <HomePage info={info} color={color} />
          <HomeComposer
            onSubmit={handleSend}
            isLoading={isLoading}
            placeholder={t('chat.input_placeholder')}
          />
        </div>
      )}

      {/* ── Chat ── */}
      {phase === 'chat' && (
        <div className="flex flex-1 flex-col overflow-hidden">
          {chatError && (
            <div className="mx-4 mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {chatError}
            </div>
          )}
          <AgentChat
            messages={messages}
            onSubmit={handleSend}
            isLoading={isLoading}
            emptyPlaceholder={t('chat.greeting')}
            headerTitle=""
            showChart={false}
            showPdf={false}
            compact
            appendAndSendText={voiceAutoSendText}
            composerLeading={info?.voice_enabled ? (
              <VoiceInput
                hideLangSelector
                transcribe={(blob, filename, lang) =>
                  botWidgetTranscribeAudio(token, blob, filename, lang, widgetAuthToken ?? undefined)
                }
                onTranscript={(text, autoSend) => {
                  if (autoSend) {
                    setVoiceAutoSendText(text)
                    setTimeout(() => setVoiceAutoSendText(''), 50)
                  }
                }}
                onError={(msg) => setChatError(msg)}
                disabled={isLoading}
                buttonClassName="flex min-h-[44px] min-w-0 items-center justify-center rounded-xl bg-gray-100 px-3 text-gray-500 transition-colors hover:bg-gray-200 disabled:opacity-40"
              />
            ) : undefined}
          />
        </div>
      )}

      {/* ── 常見問題 Sheet ── */}
      {showFaqSheet && info?.common_faqs && (
        <FaqSheet
          faqs={info.common_faqs}
          color={color}
          title={t('home.faq')}
          onClose={() => setShowFaqSheet(false)}
        />
      )}

      {/* ── 聯絡資訊 Sheet ── */}
      {showContactSheet && info?.contact_links && (
        <ContactSheet
          links={info.contact_links}
          color={color}
          title="聯絡我們"
          onClose={() => setShowContactSheet(false)}
        />
      )}
    </div>
  )
}

// ── 外層：注入 i18n Provider ──────────────────────────────────────────────────

export default function WidgetBotPage() {
  const { token = '' } = useParams<{ token: string }>()
  const [searchParams] = useSearchParams()
  const isEmbed = searchParams.get('embed') === '1'
  const langOverride = searchParams.get('lang') ?? ''

  return (
    <I18nextProvider i18n={widgetI18n}>
      <WidgetBotInner token={token} isEmbed={isEmbed} langOverride={langOverride} />
    </I18nextProvider>
  )
}
