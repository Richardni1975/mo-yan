import { createClient } from '@supabase/supabase-js'

// 从环境变量读取 Supabase 配置，需在项目根目录 .env 文件中设置
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: {
    params: {
      eventsPerSecond: 10,
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
