/** 使用者頭像圓圈：有圖片則顯示圖片，否則顯示 initials + 色彩 */

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function nameToColor(name: string): string {
  const COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#8b5cf6', '#ec4899', '#10b981']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return COLORS[h % COLORS.length]
}

interface AvatarCircleProps {
  avatarB64?: string | null
  name: string
  size?: number
}

export function AvatarCircle({ avatarB64, name, size = 80 }: AvatarCircleProps) {
  if (avatarB64) {
    return (
      <img
        src={avatarB64}
        alt="avatar"
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    )
  }
  const initials = getInitials(name || 'U')
  const bg = nameToColor(name || 'U')
  return (
    <div
      style={{
        width: size, height: size, borderRadius: '50%', background: bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontWeight: 700, fontSize: size * 0.36,
        userSelect: 'none', flexShrink: 0,
      }}
    >
      {initials}
    </div>
  )
}
