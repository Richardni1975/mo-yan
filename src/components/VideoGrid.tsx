import { memo, useRef, useEffect } from 'react'
import { VIDEO_MAX_PARTICIPANTS } from '../utils/constants'

interface VideoUser {
  id: string
  startedAt: number
}

interface Props {
  localStream: MediaStream | null
  remoteStreams: Map<string, MediaStream>
  videoUsers: VideoUser[]
  currentUserId: string
  participants: Array<{ id: string; name: string }>
}

export const VideoGrid = memo(function VideoGrid({ localStream, remoteStreams, videoUsers, currentUserId, participants }: Props) {
  const localVideoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream
    }
  }, [localStream])

  // 按开启时间排序，取前 VIDEO_MAX_PARTICIPANTS 个
  const sorted = [...videoUsers]
    .filter((u) => participants.some((p) => p.id === u.id))
    .sort((a, b) => a.startedAt - b.startedAt)

  const videoSlots = sorted.slice(0, VIDEO_MAX_PARTICIPANTS)
  const slots = videoSlots.length > 0 ? videoSlots : []
  // 固定 grid 为 2×2，不足的留空
  const gridSlots: (VideoUser | null)[] = [...slots]
  while (gridSlots.length < 4) gridSlots.push(null)

  const getName = (uid: string) => participants.find((p) => p.id === uid)?.name ?? '未知'

  return (
    <div style={{
      flex: 1, minHeight: 0,
      display: 'grid', gridTemplateColumns: '1fr 1fr',
      gridTemplateRows: '1fr 1fr',
      gap: 4, padding: 4,
      background: 'var(--ink-darkest)',
      borderRadius: '0 0 var(--radius-sm) var(--radius-sm)',
    }}>
      {gridSlots.map((user, i) => {
        if (!user) {
          return (
            <div key={`empty-${i}`} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,255,255,0.04)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--ink-light)', fontSize: '0.75rem',
            }}>
              {i === 0 && slots.length === 0 ? '暂无视频' : ''}
            </div>
          )
        }

        const isMe = user.id === currentUserId
        const stream = isMe ? localStream : remoteStreams.get(user.id)

        return (
          <div key={user.id} style={{
            position: 'relative',
            background: 'rgba(0,0,0,0.3)',
            borderRadius: 'var(--radius-sm)',
            overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {stream ? (
              <VideoTile videoRef={isMe ? localVideoRef : undefined}
                stream={isMe ? undefined : stream}
                remoteId={isMe ? undefined : user.id}
                remoteStreams={remoteStreams} />
            ) : (
              <div style={{
                fontSize: '1.5rem', opacity: 0.3,
                color: '#fff',
              }}>
                🎥
              </div>
            )}
            <span style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              padding: '2px 6px',
              background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
              color: '#fff', fontSize: '0.65rem',
              textAlign: 'left', pointerEvents: 'none',
            }}>
              {getName(user.id)}{isMe ? ' (我)' : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
})

/** 单个视频 tile，负责挂载 video 元素 */
const VideoTile = memo(function VideoTile({ videoRef, stream, remoteId, remoteStreams }: {
  videoRef?: React.RefObject<HTMLVideoElement>
  stream?: MediaStream
  remoteId?: string
  remoteStreams: Map<string, MediaStream>
}) {
  const elRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef?.current) {
      // local stream handled by parent's ref
      return
    }
    const el = elRef.current
    if (el && remoteId && remoteStreams.has(remoteId)) {
      el.srcObject = remoteStreams.get(remoteId)!
      // 显式调用 play() 以确保音频在浏览器自动播放策略下也能正常播放
      el.play().catch(() => {
        // 自动播放被浏览器拒绝，静默处理（用户可能需要手动交互）
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteId, remoteStreams.get(remoteId ?? '')])

  // local video - parent ref handles it
  if (videoRef) {
    return (
      <video ref={videoRef} autoPlay playsInline muted
        style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    )
  }

  // remote video
  return (
    <video ref={elRef} autoPlay playsInline
      style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
  )
})
