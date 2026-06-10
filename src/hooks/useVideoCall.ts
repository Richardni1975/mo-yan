import { useCallback, useEffect, useRef, useState } from 'react'
import SimplePeer from 'simple-peer'
import { generateId } from '../utils/helpers'
import { pushDebugLog } from '../components/DebugOverlay'
import {
  MESSAGE_TYPES,
  VIDEO_CAMERA_WIDTH,
  VIDEO_CAMERA_HEIGHT,
  VIDEO_CAMERA_FPS,
  VIDEO_MAX_PARTICIPANTS,
  ICE_SERVERS,
} from '../utils/constants'
import type { RoomMessage } from '../utils/types'

interface UseVideoCallOptions {
  userId: string
  broadcast: (msg: RoomMessage) => void
  peerUserIds: string[]
  onError?: (error: string) => void
}

interface VideoUser {
  id: string
  startedAt: number
}

export interface UseVideoCallReturn {
  localStream: MediaStream | null
  remoteStreams: Map<string, MediaStream>
  videoUsers: VideoUser[]
  isEnabled: boolean
  startVideo: () => Promise<void>
  stopVideo: () => void
  handleMessage: (msg: RoomMessage) => void
}

export function useVideoCall({
  userId,
  broadcast,
  peerUserIds,
  onError,
}: UseVideoCallOptions): UseVideoCallReturn {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map())
  const [videoUsers, setVideoUsers] = useState<VideoUser[]>([])
  const [isEnabled, setIsEnabled] = useState(false)

  const localStreamRef = useRef<MediaStream | null>(null)
  const outboundPeersRef = useRef<Map<string, SimplePeer.Instance>>(new Map())
  const inboundPeersRef = useRef<Map<string, SimplePeer.Instance>>(new Map())
  const videoUsersRef = useRef<VideoUser[]>([])
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map())
  const peerUserIdsRef = useRef<string[]>([])
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const peerCreatedAtRef = useRef<Map<string, number>>(new Map()) // 记录每个 peer 创建时间，防止风暴

  // 保持 peerUserIds 引用最新，避免 startVideo / handleMessage 中的闭包过期
  useEffect(() => {
    peerUserIdsRef.current = peerUserIds
  }, [peerUserIds])

  const syncVideoUsers = useCallback((users: VideoUser[]) => {
    videoUsersRef.current = users
    setVideoUsers(users)
  }, [])

  const addRemoteStream = useCallback((uid: string, stream: MediaStream) => {
    remoteStreamsRef.current.set(uid, stream)
    setRemoteStreams(new Map(remoteStreamsRef.current))
  }, [])

  const removeRemoteStream = useCallback((uid: string) => {
    remoteStreamsRef.current.delete(uid)
    setRemoteStreams(new Map(remoteStreamsRef.current))
  }, [])

  // 判断自己是否有视频席位（前 VIDEO_MAX_PARTICIPANTS 个开启视频的人）
  const hasVideoSlot = useCallback(() => {
    const sorted = [...videoUsersRef.current].sort((a, b) => a.startedAt - b.startedAt)
    const slotIndex = sorted.findIndex((u) => u.id === userId)
    return slotIndex >= 0 && slotIndex < VIDEO_MAX_PARTICIPANTS
  }, [userId])

  // ===== Outbound peers (send my camera) =====

  const createOutboundPeer = useCallback((targetId: string) => {
    if (outboundPeersRef.current.has(targetId)) { console.log(`[video] outbound to ${targetId} already exists`); return }
    if (!localStreamRef.current) { console.log(`[video] cannot create outbound to ${targetId}: no local stream`); return }

    console.log(`[video] create outbound peer to ${targetId}`)
    const peer = new SimplePeer({
      initiator: true,
      stream: localStreamRef.current,
      trickle: true,
      config: { iceServers: ICE_SERVERS },
    })

    peer.on('signal', (signal) => {
      if (signal.type === 'offer') { console.log(`[WebRTC-Debug][outbound-${targetId}] createOffer`); pushDebugLog(`[outbound-${targetId}] createOffer`) }
      if (signal.type === 'candidate') {
        // 从 candidate SDP 字符串提取类型（JSON 序列化可能丢失 RTCIceCandidate.type）
        const candStr = typeof signal.candidate?.candidate === 'string' ? signal.candidate.candidate : ''
        const cType = candStr.includes(' typ host') ? 'host' :
          candStr.includes(' typ srflx') ? 'srflx' :
          candStr.includes(' typ relay') ? 'relay' :
          (signal.candidate === null || signal.candidate === undefined) ? 'end' :
          'other'
        if (cType !== 'end') {
          console.log(`[WebRTC-Debug][outbound-${targetId}] ICE ${cType}`)
          pushDebugLog(`[outbound-${targetId}] onicecandidate type=${cType}`)
        }
      }
      console.log(`[video] outbound to ${targetId} signal:`, signal.type)
      broadcast({
        id: generateId(),
        type: MESSAGE_TYPES.SYSTEM,
        senderId: userId,
        senderName: '',
        timestamp: Date.now(),
        content: JSON.stringify({ _videoSignal: { targetId, signal } }),
      })
    })

    peer.on('error', (err) => {
      console.log(`[video] outbound to ${targetId} error:`, err)
      outboundPeersRef.current.delete(targetId)
    })

    peer.on('connect', () => {
      console.log(`[video] outbound to ${targetId} connected`)
    })

    peer.on('close', () => {
      console.log(`[video] outbound to ${targetId} closed`)
      outboundPeersRef.current.delete(targetId)
    })

    outboundPeersRef.current.set(targetId, peer)
  }, [userId, broadcast])

  const destroyOutboundPeers = useCallback(() => {
    outboundPeersRef.current.forEach((p) => p.destroy())
    outboundPeersRef.current.clear()
  }, [])

  // 补齐遗漏的出站 peer（错峰创建，带 10s 冷却防止风暴）
  // 注意：必须放在 hasVideoSlot 和 createOutboundPeer 之后，避免 TDZ 错误
  const ensureOutboundPeers = useCallback(() => {
    if (!localStreamRef.current) return
    if (!hasVideoSlot()) return
    const now = Date.now()
    let staggerMs = 0
    peerUserIdsRef.current.forEach((id) => {
      if (id === userId) return
      const existing = outboundPeersRef.current.get(id)
      if (!existing || existing.destroyed) {
        const lastCreated = peerCreatedAtRef.current.get(id) ?? 0
        if (now - lastCreated < 10000) return
        if (existing?.destroyed) outboundPeersRef.current.delete(id)
        peerCreatedAtRef.current.set(id, now)
        // 每个 peer 间隔 300ms 创建，避免同一时刻 ICE 风暴
        const delay = staggerMs
        staggerMs += 300
        setTimeout(() => createOutboundPeer(id), delay)
      }
    })
  }, [userId, hasVideoSlot, createOutboundPeer])

  // ===== Inbound peers (receive others' cameras) =====

  const createInboundPeer = useCallback((remoteId: string) => {
    if (inboundPeersRef.current.has(remoteId)) { console.log(`[video] inbound from ${remoteId} already exists`); return }

    console.log(`[video] create inbound peer from ${remoteId}`)
    const peer = new SimplePeer({
      initiator: false,
      trickle: true,
      config: { iceServers: ICE_SERVERS },
    })

    peer.on('signal', (signal) => {
      if (signal.type === 'answer') { console.log(`[WebRTC-Debug][inbound-${remoteId}] createAnswer`); pushDebugLog(`[inbound-${remoteId}] createAnswer`) }
      if (signal.type === 'candidate') {
        const candStr = typeof signal.candidate?.candidate === 'string' ? signal.candidate.candidate : ''
        const cType = candStr.includes(' typ host') ? 'host' :
          candStr.includes(' typ srflx') ? 'srflx' :
          candStr.includes(' typ relay') ? 'relay' :
          (signal.candidate === null || signal.candidate === undefined) ? 'end' :
          'other'
        if (cType !== 'end') {
          console.log(`[WebRTC-Debug][inbound-${remoteId}] ICE ${cType}`)
          pushDebugLog(`[inbound-${remoteId}] onicecandidate type=${cType}`)
        }
      }
      console.log(`[video] inbound from ${remoteId} signal:`, signal.type)
      broadcast({
        id: generateId(),
        type: MESSAGE_TYPES.SYSTEM,
        senderId: userId,
        senderName: '',
        timestamp: Date.now(),
        content: JSON.stringify({ _videoSignal: { targetId: remoteId, signal } }),
      })
    })

    peer.on('stream', (stream) => {
      console.log(`[video] inbound from ${remoteId} got stream, id=`, stream.id)
      console.log(`[WebRTC-Debug][inbound-${remoteId}] ontrack streamId=${stream.id} tracks=${stream.getTracks().length}`);
      pushDebugLog(`[inbound-${remoteId}] ontrack streamId=${stream.id} tracks=${stream.getTracks().length}`);
      addRemoteStream(remoteId, stream)
    })

    peer.on('error', (err) => {
      console.log(`[video] inbound from ${remoteId} error:`, err)
      inboundPeersRef.current.delete(remoteId)
      removeRemoteStream(remoteId)
    })

    peer.on('connect', () => {
      console.log(`[video] inbound from ${remoteId} connected`)
    })

    peer.on('close', () => {
      console.log(`[video] inbound from ${remoteId} closed`)
      inboundPeersRef.current.delete(remoteId)
      removeRemoteStream(remoteId)
    })

    inboundPeersRef.current.set(remoteId, peer)
  }, [userId, broadcast, addRemoteStream, removeRemoteStream])

  const destroyInboundPeers = useCallback(() => {
    inboundPeersRef.current.forEach((p) => p.destroy())
    inboundPeersRef.current.clear()
  }, [])

  // ===== Start / Stop =====

  const startVideo = useCallback(async () => {
    try {
      if (!window.isSecureContext) {
        onError?.('摄像头需要 HTTPS 访问（当前页面不是安全环境）')
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: VIDEO_CAMERA_WIDTH },
          height: { ideal: VIDEO_CAMERA_HEIGHT },
          frameRate: { ideal: VIDEO_CAMERA_FPS },
          facingMode: 'user',
        } as MediaTrackConstraints,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } as MediaTrackConstraints,
      })

      localStreamRef.current = stream
      setLocalStream(stream)
      setIsEnabled(true)

      const startedAt = Date.now()

      // 广播开启视频
      broadcast({
        id: generateId(),
        type: MESSAGE_TYPES.SYSTEM,
        senderId: userId,
        senderName: '',
        timestamp: Date.now(),
        content: JSON.stringify({ _videoStart: { userId, startedAt } }),
      })

      console.log(`[video] startVideo: userId=${userId} videoUsers=[${videoUsersRef.current.map(u=>u.id).join(',')}] peerUserIds=[${peerUserIdsRef.current.join(',')}]`)

      // 把自己加入视频用户列表
      syncVideoUsers([...videoUsersRef.current, { id: userId, startedAt }])

      // 如果有席位，给所有参与者创建出站 peer（包括可能不知道其视频状态的用户）
      const sorted = [...videoUsersRef.current, { id: userId, startedAt }]
        .sort((a, b) => a.startedAt - b.startedAt)
      const myIndex = sorted.findIndex((u) => u.id === userId)
      if (myIndex < VIDEO_MAX_PARTICIPANTS) {
        peerUserIdsRef.current.forEach((id) => {
          if (id !== userId) createOutboundPeer(id)
        })
      }

      // 延迟重试：应对 presence 同步慢导致参与者列表不全的场景
      // 1.5s 和 4s 后各检查一次，补齐遗漏的出站 peer
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      syncTimerRef.current = setTimeout(() => {
        console.log('[video] delayed sync check: peerUserIds=', peerUserIdsRef.current.join(','))
        ensureOutboundPeers()
        syncTimerRef.current = setTimeout(() => {
          console.log('[video] final sync check: peerUserIds=', peerUserIdsRef.current.join(','))
          ensureOutboundPeers()
          syncTimerRef.current = null
        }, 2500)
      }, 1500)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '摄像头启动失败'
      onError?.(msg)
    }
  }, [userId, broadcast, createOutboundPeer, syncVideoUsers, onError, ensureOutboundPeers])

  const stopVideo = useCallback(() => {
    // 清理延迟同步定时器
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current)
      syncTimerRef.current = null
    }
    // 广播关闭
    broadcast({
      id: generateId(),
      type: MESSAGE_TYPES.SYSTEM,
      senderId: userId,
      senderName: '',
      timestamp: Date.now(),
      content: JSON.stringify({ _videoStop: {} }),
    })

    // 释放摄像头
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
    }
    setLocalStream(null)

    // 销毁所有 peer
    destroyOutboundPeers()
    destroyInboundPeers()
    peerCreatedAtRef.current.clear()

    // 清除远端流
    remoteStreamsRef.current.forEach((_, uid) => removeRemoteStream(uid))
    remoteStreamsRef.current.clear()

    // 从视频用户列表移除自己
    syncVideoUsers(videoUsersRef.current.filter((u) => u.id !== userId))
    setIsEnabled(false)
  }, [userId, broadcast, destroyOutboundPeers, destroyInboundPeers, syncVideoUsers, removeRemoteStream])

  // ===== 有新参与者加入时，如果我有视频席位，创建出站 peer =====
  useEffect(() => {
    if (!isEnabled) return
    if (!hasVideoSlot()) return
    peerUserIds.forEach((id) => {
      if (id !== userId && !outboundPeersRef.current.has(id)) {
        createOutboundPeer(id)
      }
    })
  }, [peerUserIds, userId, isEnabled, hasVideoSlot, createOutboundPeer])

  // ===== Message handling =====

  const handleMessage = useCallback((msg: RoomMessage) => {
    if (msg.type !== MESSAGE_TYPES.SYSTEM) return

    try {
      const data = JSON.parse(msg.content)

      if (data._videoStart) {
        const { userId: remoteId, startedAt } = data._videoStart
        if (remoteId === userId) return

        console.log(`[video] _videoStart from=${remoteId} myVideo=${isEnabled} myLocalStream=!!${!!localStreamRef.current} videoUsers=[${videoUsersRef.current.map(u=>u.id).join(',')}]`)

        // 加入视频用户列表
        const exists = videoUsersRef.current.some((u) => u.id === remoteId)
        if (!exists) {
          const newList = [...videoUsersRef.current, { id: remoteId, startedAt }]
          syncVideoUsers(newList)
        }

        // 主动创建 inbound peer 以接收对方的视频流（不等 offer 信号，避免竞态）
        const existingInbound = inboundPeersRef.current.get(remoteId)
        if (!existingInbound || existingInbound.destroyed) {
          if (existingInbound?.destroyed) {
            inboundPeersRef.current.delete(remoteId)
            removeRemoteStream(remoteId)
          }
          createInboundPeer(remoteId)
        }

        // 如果我也有视频，并且对方有席位
        if (isEnabled && localStreamRef.current) {
          const sorted = [...videoUsersRef.current, { id: remoteId, startedAt }]
            .sort((a, b) => a.startedAt - b.startedAt)
          const theirIndex = sorted.findIndex((u) => u.id === remoteId)
          console.log(`[video] _videoStart: theirIndex=${theirIndex} hasOutbound=${outboundPeersRef.current.has(remoteId)}`)
          if (theirIndex < VIDEO_MAX_PARTICIPANTS) {
            const mySorted = [...videoUsersRef.current, { id: remoteId, startedAt }]
              .sort((a, b) => a.startedAt - b.startedAt)
            const myIdx = mySorted.findIndex((u) => u.id === userId)
            if (myIdx < VIDEO_MAX_PARTICIPANTS && !outboundPeersRef.current.has(remoteId)) {
              createOutboundPeer(remoteId)
            }
          }
        }
      } else if (data._videoStop) {
        const remoteId = msg.senderId
        console.log(`[video] _videoStop from=${remoteId}`)

        // 从视频用户列表移除
        syncVideoUsers(videoUsersRef.current.filter((u) => u.id !== remoteId))

        // 清理相关 peer 和流
        inboundPeersRef.current.get(remoteId)?.destroy()
        inboundPeersRef.current.delete(remoteId)
        outboundPeersRef.current.get(remoteId)?.destroy()
        outboundPeersRef.current.delete(remoteId)
        removeRemoteStream(remoteId)
      } else if (data._videoSignal) {
        const { targetId, signal } = data._videoSignal
        if (targetId === userId) {
          console.log(`[video] signal from=${msg.senderId} type=${signal.type} hasLocal=!!${!!localStreamRef.current} hasInbound=${inboundPeersRef.current.has(msg.senderId)} hasOutbound=${outboundPeersRef.current.has(msg.senderId)}`)
          if (signal.type === 'offer') {
            // 关键：防止信令竞态条件导致已有 peer 被销毁
            // 如果已有 connected 的 inbound peer，跳过重复 offer（避免 setRemoteDescription 状态冲突 → simple-peer 内部 destroy）
            const existingInbound = inboundPeersRef.current.get(msg.senderId)
            if (existingInbound) {
              if (existingInbound.connected) {
                console.log(`[video] skip duplicate offer from ${msg.senderId}, inbound already connected`)
                return
              }
              if (existingInbound.destroyed) {
                console.log(`[video] inbound from ${msg.senderId} was destroyed, recreating`)
                inboundPeersRef.current.delete(msg.senderId)
                removeRemoteStream(msg.senderId)
                createInboundPeer(msg.senderId)
              }
            } else {
              createInboundPeer(msg.senderId)
            }
            console.log(`[WebRTC-Debug][inbound-${msg.senderId}] setRemoteDescription (processing offer from=${msg.senderId}) signalingState=${inboundPeersRef.current.get(msg.senderId)?._pc?.signalingState ?? '?'}`);
            pushDebugLog(`[inbound-${msg.senderId}] setRemoteDescription (processing offer)`);
            try {
              inboundPeersRef.current.get(msg.senderId)?.signal(signal)
            } catch {}
          } else if (signal.type === 'answer') {
            // 出站 peer 的 answer
            const peer = outboundPeersRef.current.get(msg.senderId)
            if (peer) {
              console.log(`[WebRTC-Debug][outbound-${msg.senderId}] setRemoteDescription (processing answer from=${msg.senderId})`);
              pushDebugLog(`[outbound-${msg.senderId}] setRemoteDescription (processing answer)`);
              try { peer.signal(signal) } catch {}
            }
          } else {
            // ICE candidate
            let peer = outboundPeersRef.current.get(msg.senderId)
            if (peer) {
              try { peer.signal(signal) } catch {}
            } else {
              peer = inboundPeersRef.current.get(msg.senderId)
              if (peer) {
                try { peer.signal(signal) } catch {}
              }
            }
          }
        }
      }
    } catch {}
  }, [userId, isEnabled, syncVideoUsers, createOutboundPeer, createInboundPeer, removeRemoteStream])

  // ===== Cleanup =====
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop())
      }
      destroyOutboundPeers()
      destroyInboundPeers()
      peerCreatedAtRef.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    localStream,
    remoteStreams,
    videoUsers,
    isEnabled,
    startVideo,
    stopVideo,
    handleMessage,
  }
}
