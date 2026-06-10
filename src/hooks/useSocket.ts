import { useCallback, useEffect, useRef, useState } from 'react'
import { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../utils/supabase'
import { CHANNEL_PREFIX } from '../utils/constants'
import type { ConnectionState, RoomMessage } from '../utils/types'

interface UseSocketOptions {
  roomId: string
  userId: string
  userName: string
  onMessage: (msg: RoomMessage) => void
  onParticipantsChange: (participants: Array<{ id: string; name: string; isSharing: boolean }>) => void
}

export function useSocket({ roomId, userId, userName, onMessage, onParticipantsChange }: UseSocketOptions) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const channelRef = useRef<RealtimeChannel | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const joinAttemptRef = useRef(0)
  const reconnectingRef = useRef(false) // 防止 removeChannel 的 CLOSED 事件触发二次重连

  // 用 ref 保持回调引用稳定，避免父组件重新渲染导致 joinRoom 变化 → 反复重连
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage
  const onParticipantsChangeRef = useRef(onParticipantsChange)
  onParticipantsChangeRef.current = onParticipantsChange

  const MAX_RECONNECT = 10

  const joinRoom = useCallback(() => {
    if (!mountedRef.current) return

    // 超过最大重连次数后不再尝试
    if (joinAttemptRef.current > MAX_RECONNECT) {
      console.error('[墨言] 已达到最大重连次数 (' + MAX_RECONNECT + '), 放弃连接')
      setConnectionState('disconnected')
      reconnectingRef.current = false
      return
    }

    // 标记正在主动重连，防止 removeChannel 触发的 CLOSED 事件启动二次重连
    reconnectingRef.current = true

    // 清理旧 channel
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }

    setConnectionState('connecting')
    joinAttemptRef.current++
    console.log('[墨言] 正在连接房间, 尝试次数:', joinAttemptRef.current)

    const channelName = `${CHANNEL_PREFIX}${roomId}`
    const channel = supabase.channel(channelName, {
      config: {
        broadcast: { self: true },
        presence: { key: userId },
      },
    })

    // 广播消息
    channel.on('broadcast', { event: 'message' }, (payload) => {
      if (!mountedRef.current) return
      onMessageRef.current(payload.payload as RoomMessage)
    })

    // 在线状态变化
    channel.on('presence', { event: 'sync' }, () => {
      if (!mountedRef.current) return
      try {
        const state = channel.presenceState()
        const participants = Object.entries(state).map(([id, infos]) => {
          const info = ((infos as Array<Record<string, unknown>>)?.[0] ?? {}) as Record<string, unknown>
          return {
            id,
            name: (info.name as string) ?? '未知',
            isSharing: (info.isSharing as boolean) ?? false,
          }
        })
        onParticipantsChangeRef.current(participants)
      } catch {
        // presence parsing error
      }
    })

    channel.subscribe((status) => {
      if (!mountedRef.current) return

      if (status === 'SUBSCRIBED') {
        setConnectionState('connected')
        // 连接成功，重置重连尝试计数和标记
        joinAttemptRef.current = 0
        reconnectingRef.current = false
        console.log('[墨言] 房间连接成功')
        // 加入时发送一次在线状态即可，Supabase 自动维护心跳
        channel.track({
          user_id: userId,
          name: userName,
          online_at: new Date().toISOString(),
          isSharing: false,
        }).catch(() => {})
      } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED' || status === 'TIMED_OUT') {
        // 如果正在主动重连中（joinRoom 已清理旧通道），跳过 CLOSED 事件触发的二次重连
        if (reconnectingRef.current) {
          console.log('[墨言] 正在重连中，跳过旧通道的', status, '事件')
          return
        }
        setConnectionState('disconnected')
        console.warn('[墨言] 连接断开，准备重连')
        // 指数退避重连
        const attempt = joinAttemptRef.current
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000) * (0.8 + Math.random() * 0.4)
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current) joinRoom()
        }, delay)
      }
    })

    channelRef.current = channel
  }, [roomId, userId, userName])

  const leaveRoom = useCallback(() => {
    mountedRef.current = false
    reconnectingRef.current = false
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
    setConnectionState('disconnected')
    // 重置重连计数，以便下次进入房间能正常重连
    joinAttemptRef.current = 0
  }, [])

  const broadcast = useCallback((message: RoomMessage) => {
    try {
      channelRef.current?.send({
        type: 'broadcast',
        event: 'message',
        payload: message,
      })
    } catch {
      // broadcast failed silently
    }
  }, [])

  const updatePresence = useCallback((data: Record<string, unknown>) => {
    try {
      channelRef.current?.track(data)
    } catch {
      // track failed silently
    }
  }, [])

  // cleanup on unmount
  useEffect(() => {
    mountedRef.current = true
    // 移动端: 页面隐藏/关闭时自动退出（beforeunload 在手机上不可靠）
    const handlePageHide = () => { leaveRoom() }
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') leaveRoom()
    }
    window.addEventListener('pagehide', handlePageHide)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      document.removeEventListener('visibilitychange', handleVisibility)
      leaveRoom()
    }
  }, [leaveRoom])

  return { connectionState, joinRoom, leaveRoom, broadcast, updatePresence }
}
