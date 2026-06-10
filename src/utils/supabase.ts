import { createClient } from '@supabase/supabase-js'
import { STORAGE_KEYS } from './constants'

// 从环境变量读取 Supabase 配置，需在项目根目录 .env 文件中设置
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: {
    params: {
      eventsPerSecond: 100,
    },
  },
})

/** 检查 Supabase 是否已配置 */
export function isSupabaseConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY)
}

/** 获取当前 Realtime 连接状态 */
export function getConnectionStatus() {
  const channels = supabase.realtime.getChannels()
  if (channels.length === 0) return 'disconnected'
  const statuses = channels.map((ch) => ch.state)
  if (statuses.every((s) => s === 'joined')) return 'connected'
  if (statuses.some((s) => s === 'joining')) return 'connecting'
  return 'disconnected'
}

// ===== 用户身份持久化（设备本地） =====

const USER_ID_KEY = STORAGE_KEYS.USER_ID

/** 获取或创建设备本地用户 ID（一次生成，永久保存） */
export function getOrCreateUserId(): string {
  let userId = localStorage.getItem(USER_ID_KEY)
  if (!userId) {
    userId = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 15)
    localStorage.setItem(USER_ID_KEY, userId)
  }
  return userId
}

// ===== 真实姓名同步（利用 Supabase Realtime 广播机制） =====

const PROFILE_CHANNEL = 'profile-sync'
const PROFILE_EVENT = 'profile_update'

/** 保存昵称和真实姓名到本地 */
export function saveProfileLocally(nickname: string, realName: string) {
  localStorage.setItem(STORAGE_KEYS.NICKNAME, nickname)
  localStorage.setItem(STORAGE_KEYS.REAL_NAME, realName)
  localStorage.setItem(STORAGE_KEYS.PROFILE_SYNCED, 'true')
}

/** 从本地加载真实姓名 */
export function loadProfileLocally(): { nickname: string; realName: string } {
  return {
    nickname: localStorage.getItem(STORAGE_KEYS.NICKNAME) ?? '',
    realName: localStorage.getItem(STORAGE_KEYS.REAL_NAME) ?? '',
  }
}

/** 通过 Supabase Realtime 广播同步真实姓名到其他设备 */
export function broadcastProfile(realName: string, nickname: string): void {
  if (!isSupabaseConfigured()) return
  const userId = getOrCreateUserId()
  try {
    const channel = supabase.channel(PROFILE_CHANNEL, {
      config: { broadcast: { self: false } },
    })
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.send({
          type: 'broadcast',
          event: PROFILE_EVENT,
          payload: { userId, realName, nickname, timestamp: Date.now() },
        })
        // 发送后延迟关闭频道
        setTimeout(() => {
          supabase.removeChannel(channel)
        }, 2000)
      }
    })
  } catch {
    // 静默失败，本地已保存
  }
}

/** 监听 Supabase Realtime 广播，同步真实姓名 */
export function listenForProfileUpdates(
  onUpdate: (data: { userId: string; realName: string; nickname: string }) => void
): () => void {
  if (!isSupabaseConfigured()) return () => {}

  const channel = supabase.channel(PROFILE_CHANNEL, {
    config: { broadcast: { self: false } },
  })

  channel.on('broadcast', { event: PROFILE_EVENT }, (payload) => {
    const data = payload.payload as { userId: string; realName: string; nickname: string; timestamp: number }
    if (data) {
      onUpdate(data)
    }
  })

  channel.subscribe(() => {})
  
  // 返回取消监听的函数
  return () => {
    supabase.removeChannel(channel)
  }
}
