/** 洞察報表等：日期以 Asia/Taipei 日曆解讀（與後端 chat_insights 一致） */

const TAIPEI_TZ = 'Asia/Taipei'

/** 目前「台北」的 YYYY-MM-DD */
export function taipeiTodayYmd(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TAIPEI_TZ }).format(new Date())
}

/**
 * 自某台北日往回首 n 個日曆日（n=0 回傳同日；n=29 約為「含今日共 30 天」的起日）。
 * 以 +08:00 正午錨點再減日，避免邊界誤差。
 */
export function taipeiYmdMinusCalendarDays(fromYmd: string, days: number): string {
  const anchor = Date.parse(`${fromYmd}T12:00:00+08:00`)
  const ms = anchor - days * 24 * 60 * 60 * 1000
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TAIPEI_TZ }).format(new Date(ms))
}

/** ISO 時間戳在台北顯示（YYYY/MM/DD HH:mm:ss） */
export function formatIsoInTaipeiDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: TAIPEI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d)
}
