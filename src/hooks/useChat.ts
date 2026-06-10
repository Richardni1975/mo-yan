import { useCallback, useEffect, useRef, useState } from 'react'
import { generateId } from '../utils/helpers'
import { MAX_CACHED_MESSAGES, MESSAGE_TYPES } from '../utils/constants'
import { supabase, isSupabaseConfigured } from '../utils/supabase'
import type { ChatMessage, RoomMessage } from '../utils/types'

const TABLE_NAME = 'chat_messages'
const LS_PREFIX = 'mo_yan_chat_'

function lsKey(roomId: string) { return LS_PREFIX + roomId }
function saveLocal(roomId: string, msgs: ChatMessage[]) {
  try { localStorage.setItem(lsKey(roomId), JSON.stringify(msgs.slice(-MAX_CACHED_MESSAGES))) } catch {}
}
function loadLocal(roomId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(lsKey(roomId))
    return raw ? JSON.parse(raw) as ChatMessage[] : []
  } catch { return [] }
}

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
  const msgsRef = useRef<ChatMessage[]>([])
  const loadedRef = useRef(false)

  // 加入房间时加载历史消息（优先 Supabase，兜底 localStorage）
  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true

    const loadHistory = async () => {
      let history: ChatMessage[] = []

      // 1. 尝试从 Supabase 加载
      if (isSupabaseConfigured()) {
        try {
          const { data, error } = await supabase
            .from(TABLE_NAME)
            .select('*')
            .eq('room_id', roomId)
            .order('timestamp', { ascending: true })
            .limit(MAX_CACHED_MESSAGES)

          if (!error && data && data.length > 0) {
            history = data.map((row: Record<string, unknown>) => ({
              id: row.id as string,
              type: MESSAGE_TYPES.CHAT,
              senderId: row.sender_id as string,
              senderName: row.sender_name as string,
              timestamp: row.timestamp as number,
              content: row.content as string,
              isAnonymous: row.is_anonymous as boolean,
            }))
            console.log(`[Chat] 从 Supabase 加载了 ${history.length} 条历史消息`)
          } else if (error && error.code !== '42P01') {
            console.warn('[Chat] Supabase 加载失败, 尝试本地:', error.message)
          }
        } catch (err) {
          console.warn('[Chat] Supabase 异常, 尝试本地:', err)
        }
      }

      // 2. 兜底：从 localStorage 加载
      if (history.length === 0) {
        history = loadLocal(roomId)
        if (history.length > 0) {
          console.log(`[Chat] 从本地加载了 ${history.length} 条历史消息`)
        }
      }

      if (history.length > 0) {
        msgsRef.current = history
        setMessages(history)
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

    broadcast(msg)

    // 本地追加
    const next = [...msgsRef.current, msg].slice(-MAX_CACHED_MESSAGES)
    msgsRef.current = next
    setMessages(next)

    // 持久化到 localStorage（始终保存，兜底）
    saveLocal(roomId, next)

    // 持久化到 Supabase（后台静默）
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
          console.warn('[Chat] Supabase 保存失败:', error.message)
        }
      }).catch(() => {})
    }
  }, [userId, userName, roomId, broadcast])

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev
      const next = [...prev, msg].slice(-MAX_CACHED_MESSAGES)
      msgsRef.current = next
      saveLocal(roomId, next)
      return next
    })
  }, [roomId])

  const addHistory = useCallback((msgs: ChatMessage[]) => {
    const sliced = msgs.slice(-MAX_CACHED_MESSAGES)
    msgsRef.current = sliced
    setMessages(sliced)
    saveLocal(roomId, sliced)
  }, [roomId])

  const clearMessages = useCallback(() => {
    msgsRef.current = []
    setMessages([])
    try { localStorage.removeItem(lsKey(roomId)) } catch {}
  }, [roomId])

  return { messages, sendMessage, addMessage, addHistory, clearMessages }
}
