/** 生成唯一 ID */
export function generateId(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 11)
}

/** 生成 6 位房间码（大写字母 + 数字，易读） */
export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

/** 格式化时间（HH:mm） */
export function formatTime(date: Date): string {
  const d = date instanceof Date ? date : new Date(date)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

/** 格式化日期时间（YYYY-MM-DD HH:mm） */
export function formatDateTime(date: Date): string {
  const d = date instanceof Date ? date : new Date(date)
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 防抖 */
export function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

/** 指数退避延迟计算 */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const delay = Math.min(baseMs * Math.pow(2, attempt), maxMs)
  // 加 10% 随机抖动，避免所有客户端同时重连
  return delay * (0.9 + Math.random() * 0.2)
}

/** 在页面关闭 / 刷新前执行清理（使用 sendBeacon 保证送达） */
export function sendBeacon(url: string, data: Record<string, unknown>): void {
  try {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
    navigator.sendBeacon(url, blob)
  } catch {
    // sendBeacon 失败静默处理
  }
}

/** 检测是否在微信内置浏览器中打开 */
export function isWeChatBrowser(): boolean {
  return /MicroMessenger/i.test(navigator.userAgent)
}

/** 检测浏览器是否支持屏幕共享 */
export function isScreenShareSupported(): boolean {
  return !!(navigator.mediaDevices?.getDisplayMedia)
}

/** 安全的 JSON 解析 */
export function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

/** 判断是否为私有局域网 IP */
function isPrivateIP(ip: string): boolean {
  if (ip.startsWith('10.')) return true
  if (ip.startsWith('192.168.')) return true
  if (ip.startsWith('172.')) {
    const second = parseInt(ip.split('.')[1], 10)
    if (second >= 16 && second <= 31) return true
  }
  return false
}

/** 通过 WebRTC ICE 获取本机局域网 IP（用于分享链接时替换 localhost） */
let cachedLanIP: string | null = null
export function getLanIP(): Promise<string> {
  if (cachedLanIP) return Promise.resolve(cachedLanIP)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('localhost'), 2000)
    try {
      const pc = new RTCPeerConnection()
      pc.createDataChannel('')
      pc.createOffer().then((offer) => pc.setLocalDescription(offer)).catch(() => {})
      pc.onicecandidate = (e) => {
        if (!e.candidate) return
        const ip = e.candidate.candidate.split(' ')[4]
        if (ip && isPrivateIP(ip)) {
          clearTimeout(timer)
          cachedLanIP = ip
          pc.close()
          resolve(ip)
        }
      }
    } catch {
      clearTimeout(timer)
      resolve('localhost')
    }
  })
}
