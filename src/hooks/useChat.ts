import { useCallback, useRef, useState } from 'react'
import { generateId } from '../utils/helpers'
import { MAX_CACHED_MESSAGES, MESSAGE_TYPES } from '../utils/constants'
import type { ChatMessage, RoomMessage } from '../utils/types'

interface UseChatOptions {
  userId: string
  userName: string
  broadcast: (msg: RoomMessage) => void
}

interface UseChatReturn {
  messages: ChatMessage[]
  sendMessage: (content: string, isAnonymous: boolean) => void
  addMessage: (msg: ChatMessage) => void
  addHistory: (msgs: ChatMessage[]) => void
  clearMessages: () => void
}

export function useChat({ userId, userName, broadcast }: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const seqRef = useRef(0)

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

    // 本地立即追加（broadcast self=true 时远端也会收到，但本地先显示）
    setMessages((prev) => {
      const next = [...prev, msg]
      return next.length > MAX_CACHED_MESSAGES
        ? next.slice(next.length - MAX_CACHED_MESSAGES)
        : next
    })
  }, [userId, userName, broadcast])

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => {
      // 避免重复
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
