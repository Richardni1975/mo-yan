import { useCallback, useEffect, useRef, useState } from 'react'
import { generateId } from '../utils/helpers'
import { MAX_CACHED_MESSAGES, MESSAGE_TYPES } from '../utils/constants'
import { supabase, isSupabaseConfigured } from '../utils/supabase'
import type { ChatMessage, RoomMessage } from '../utils/types'

const TABLE_NAME = 'chat_messages'

interface UseChatOptions {
  userId: string
  userName: string
  roomId: string
  broadcast: (msg: RoomMessage) => void
}

interface UseChatReturn {
  messages: ChatMessage[]
  sendMessage: (content: string, isAnonymous: boolean) => void
  addMessage: (msg: ChatMessage) => void
  addHistory: (msgs: ChatMessage[]) => void
  clearMessages: () => void
}

export function useChat({ userId, userName, roomId, broadcast }: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const seqRef = useRef(0)
  const loadedRef = useRef(false)

  // 加入房间时从 Supabase 加载历史消息
  useEffect(() => {
    if (loadedRef.current) return
    if (!isSupabaseConfigured()) return

    loadedRef.current = true

    const loadHistory = async () => {
      try {
        const { data, error } = await supabase
          .from(TABLE_NAME)
          .select('*')
          .eq('room_id', roomId)
          .order('timestamp', { ascending: true })
          .limit(MAX_CACHED_MESSAGES)

        if (error) {
          // 表不存在时静默降级，使用纯内存模式
          if (error.code === '42P01') {
            console.log('[Chat] chat_messages 表不存在，使用纯内存模式。请在 Supabase 中创建该表以启用持久化。')
          } else {
            console.warn('[Chat] 加载历史消息失败:', error.message)
          }
          return
        }

        if (data && data.length > 0) {
          const history: ChatMessage[] = data.map((row: Record<string, unknown>) => ({
            id: row.id as string,
            type: MESSAGE_TYPES.CHAT,
            senderId: row.sender_id as string,
            senderName: row.sender_name as string,
            timestamp: row.timestamp as number,
            content: row.content as string,
            isAnonymous: row.is_anonymous as boolean,
          }))
          setMessages(history)
          console.log(`[Chat] 已加载 ${history.length} 条历史消息`)
        }
      } catch (err) {
        console.warn('[Chat] 加载历史消息异常，使用纯内存模式:', err)
      }
    }

    loadHistory()
  }, [roomId])

  const sendMessage = useCallback((content: string, isAnonymous: boolean) => {
    if (!content.trim()) return
    const msg: ChatMessage = {
      id: generateId(),
      type: MESSAGE_TYPES.CHAT,
      senderId: userId,
      senderName: isAnonymous ? 'momo' : userName,
      timestamp: Date.now(),
      content: content.trim(),
      isAnonymous,
    }
    seqRef.current++

    broadcast(msg)

    // 本地立即追加
    setMessages((prev) => {
      const next = [...prev, msg]
      return next.length > MAX_CACHED_MESSAGES
        ? next.slice(next.length - MAX_CACHED_MESSAGES)
        : next
    })

    // 持久化到 Supabase（后台静默进行）
    if (isSupabaseConfigured()) {
      supabase.from(TABLE_NAME).insert({
        id: msg.id,
        room_id: roomId,
        sender_id: msg.senderId,
        sender_name: msg.senderName,
        content: msg.content,
        is_anonymous: msg.isAnonymous,
        timestamp: msg.timestamp,
      }).then(({ error }) => {
        if (error && error.code !== '42P01') {
          console.warn('[Chat] 保存消息失败:', error.message)
        }
      }).catch(() => {})
    }
  }, [userId, userName, roomId, broadcast])

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev
      const next = [...prev, msg]
      return next.length > MAX_CACHED_MESSAGES
        ? next.slice(next.length - MAX_CACHED_MESSAGES)
        : next
    })
  }, [])

  const addHistory = useCallback((msgs: ChatMessage[]) => {
    setMessages(msgs.slice(-MAX_CACHED_MESSAGES))
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
    seqRef.current = 0
  }, [])

  return { messages, sendMessage, addMessage, addHistory, clearMessages }
}
