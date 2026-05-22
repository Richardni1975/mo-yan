import { useRef, useState, useCallback, useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { formatTime } from '../utils/helpers'
import { VIRTUAL_ITEM_HEIGHT } from '../utils/constants'
import type { ChatMessage } from '../utils/types'
interface Props {
  messages: ChatMessage[]
  onSend: (content: string) => void
  isAnonymous: boolean
}

export function ChatPanel({ messages, onSend, isAnonymous }: Props) {
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 虚拟滚动
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => VIRTUAL_ITEM_HEIGHT,
    overscan: 10,
  })

  // 新消息自动滚到底
  const prevLengthRef = useRef(messages.length)
  useEffect(() => {
    if (messages.length > prevLengthRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
    prevLengthRef.current = messages.length
  }, [messages.length])

  const handleSend = useCallback(() => {
    if (!input.trim()) return
    onSend(input.trim())
    setInput('')
    inputRef.current?.focus()
  }, [input, onSend])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  return (
    <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="panel-header" style={{ padding: '6px 10px', fontSize: '0.78rem' }}>
        <span>聊天</span>
        <span style={{ fontSize: '0.68rem', color: 'var(--ink-light)' }}>
          {messages.length} 条
        </span>
      </div>

      {/* 消息列表 */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 10px', minHeight: 0 }}>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--ink-light)', fontSize: '0.85rem', paddingTop: 40 }}>
            暂无消息
          </div>
        ) : (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const msg = messages[virtualItem.index]
              return (
                <div
                  key={msg.id}
                  className="msg-enter"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: virtualItem.size,
                    transform: `translateY(${virtualItem.start}px)`,
                    padding: '4px 0',
                  }}
                >
                  <div style={{ fontSize: '0.7rem', color: 'var(--ink-light)', marginBottom: 2 }}>
                    {msg.senderName}
                    <span style={{ marginLeft: 6, fontSize: '0.65rem' }}>{formatTime(new Date(msg.timestamp))}</span>
                  </div>
                  <div style={{ fontSize: '0.85rem', lineHeight: 1.5, wordBreak: 'break-word' }}>
                    {msg.content}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div style={{
        borderTop: '1px solid var(--border-color)',
        padding: '4px 8px',
        display: 'flex', gap: 4, alignItems: 'center',
      }}>
        <input ref={inputRef} className="input-underline"
          value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isAnonymous ? '匿名发送…' : '输入消息…'}
          style={{ fontSize: '0.8rem' }} />
        <button className="btn btn-sm btn-primary" onClick={handleSend} disabled={!input.trim()}
          style={{ fontSize: '0.7rem', padding: '2px 8px' }}>
          发送
        </button>
      </div>
    </div>
  )
}
