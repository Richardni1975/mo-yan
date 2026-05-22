import { useEffect, useRef } from 'react'
import type { AudioUser } from '../utils/types'

interface Props {
  audioUsers: AudioUser[]
  speakingUsers: string[]
  currentUserId: string
  participants: Array<{ id: string; name: string }>
  isEnabled: boolean
  isMuted: boolean
}

export function VoiceControls({
  audioUsers,
  speakingUsers,
  currentUserId,
  participants,
  isEnabled,
  isMuted,
}: Props) {
  if (!isEnabled) return null

  const getName = (uid: string) => participants.find((p) => p.id === uid)?.name ?? '未知'

  // 按说话状态排序：说话中 > 非说话
  const sorted = [...audioUsers].sort((a, b) => {
    if (a.speaking && !b.speaking) return -1
    if (!a.speaking && b.speaking) return 1
    return a.startedAt - b.startedAt
  })

  return (
    <div style={{
      fontSize: '0.7rem',
      color: 'var(--ink-medium)',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      flexWrap: 'wrap',
      maxWidth: 200,
    }}>
      {sorted.length === 0 ? (
        <span style={{ color: 'var(--ink-light)' }}>等待加入…</span>
      ) : (
        sorted.map((u) => {
          const isMe = u.id === currentUserId
          const isSpeaking = u.speaking
          return (
            <span key={u.id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '1px 6px',
              borderRadius: 'var(--radius-sm)',
              background: isSpeaking ? 'rgba(192,57,43,0.08)' : 'transparent',
              transition: 'background 0.2s',
            }}>
              {/* 墨点说话指示器 */}
              <InkDot active={isSpeaking} muted={u.muted} />
              <span style={{
                fontSize: '0.68rem',
                color: isSpeaking ? 'var(--vermilion)' : 'var(--ink-medium)',
                transition: 'color 0.2s',
              }}>
                {isMe ? `${getName(u.id)} (我)` : getName(u.id)}
                {u.muted && ' (静音)'}
              </span>
            </span>
          )
        })
      )}
    </div>
  )
}

/** 水墨风格的说话状态圆点 */
function InkDot({ active, muted }: { active: boolean; muted: boolean }) {
  const dotRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = dotRef.current
    if (!el) return

    if (active) {
      el.style.transform = 'scale(1.3)'
      el.style.boxShadow = '0 0 6px rgba(192,57,43,0.4)'
    } else {
      el.style.transform = 'scale(1)'
      el.style.boxShadow = 'none'
    }
  }, [active])

  return (
    <span
      ref={dotRef}
      style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: muted
          ? 'var(--ink-light)'
          : active
            ? 'var(--vermilion)'
            : 'var(--bamboo-green)',
        opacity: muted ? 0.4 : active ? 1 : 0.7,
        display: 'inline-block',
        flexShrink: 0,
        transition: 'transform 0.25s ease, box-shadow 0.25s ease, background 0.25s',
      }}
    />
  )
}
