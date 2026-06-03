import { useCallback, useEffect, useRef, useState } from 'react'
import SimplePeer from 'simple-peer'
import { generateId } from '../utils/helpers'
import {
  AUDIO_MAX_SPEAKERS,
  AUDIO_VAD_THRESHOLD,
  AUDIO_VAD_INTERVAL,
  AUDIO_VAD_IDLE_MS,
  MESSAGE_TYPES,
} from '../utils/constants'
import type { AudioUser, RoomMessage } from '../utils/types'

interface UseAudioCallOptions {
  userId: string
  userName: string
  broadcast: (msg: RoomMessage) => void
  peerUserIds: string[]
  onError?: (error: string) => void
}

/**
 * 发言槽位管理器（FIFO，上限 AUDIO_MAX_SPEAKERS）
 * 当槽位满时新请求者排队，等最老的主动释放后进入
 */
function createSlotManager(max: number) {
  const queue: string[] = []

  function enter(id: string): boolean {
    if (queue.includes(id)) return true
    if (queue.length < max) {
      queue.push(id)
      return true
    }
    return false
  }

  function leave(id: string) {
    const idx = queue.indexOf(id)
    if (idx >= 0) queue.splice(idx, 1)
  }

  function active(): string[] {
    return [...queue]
  }

  function isActive(id: string): boolean {
    return queue.includes(id)
  }

  /** 用新列表替换当前槽位（用于同步远端变更） */
  function replace(list: string[]) {
    queue.length = 0
    queue.push(...list)
  }

  return { enter, leave, active, isActive, replace }
}

export interface UseAudioCallReturn {
  isEnabled: boolean
  isMuted: boolean
  audioUsers: AudioUser[]
  speakingUsers: string[]
  activeSpeakerIds: string[]
  localStream: MediaStream | null
  remoteStreams: Map<string, MediaStream>
  startAudio: () => Promise<void>
  stopAudio: () => void
  toggleMute: () => void
  handleMessage: (msg: RoomMessage) => void
}

export function useAudioCall({
  userId,
  userName,
  broadcast,
  peerUserIds,
  onError,
}: UseAudioCallOptions): UseAudioCallReturn {
  const [isEnabled, setIsEnabled] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [audioUsers, setAudioUsers] = useState<AudioUser[]>([])
  const [speakingUsers, setSpeakingUsers] = useState<string[]>([])
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map())

  const localStreamRef = useRef<MediaStream | null>(null)
  const outboundPeersRef = useRef<Map<string, SimplePeer.Instance>>(new Map())
  const inboundPeersRef = useRef<Map<string, SimplePeer.Instance>>(new Map())
  const audioUsersRef = useRef<AudioUser[]>([])
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map())

  // VAD 相关
  const vadContextsRef = useRef<Map<string, { ctx: AudioContext; analyser: AnalyserNode; source: MediaStreamAudioSourceNode; data: Uint8Array }>>(new Map())
  const vadTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())
  const vadSilenceStartRef = useRef<Map<string, number>>(new Map())
  const speakingUsersRef = useRef<string[]>([])

  // 发言槽位
  const slotManagerRef = useRef(createSlotManager(AUDIO_MAX_SPEAKERS))
  const speakerSlotsRef = useRef<string[]>([])

  const syncAudioUsers = useCallback((users: AudioUser[]) => {
    audioUsersRef.current = users
    setAudioUsers(users)
  }, [])

  const addRemoteStream = useCallback((uid: string, stream: MediaStream) => {
    remoteStreamsRef.current.set(uid, stream)
    setRemoteStreams(new Map(remoteStreamsRef.current))
  }, [])

  const removeRemoteStream = useCallback((uid: string) => {
    remoteStreamsRef.current.delete(uid)
    setRemoteStreams(new Map(remoteStreamsRef.current))
  }, [])

  // ===== 发言槽位同步 =====

  const syncSpeakerSlots = useCallback((ids: string[]) => {
    speakerSlotsRef.current = ids
    slotManagerRef.current.replace(ids)
  }, [])

  // ===== VAD: 开始监听一个远程流的音量 =====

  const startVAD = useCallback((uid: string, stream: MediaStream) => {
    if (vadContextsRef.current.has(uid)) return

    try {
      const ctx = new AudioContext()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount) as unknown as Uint8Array

      vadContextsRef.current.set(uid, { ctx, analyser, source, data })

      const timer = setInterval(() => {
        const entry = vadContextsRef.current.get(uid)
        if (!entry) return

        (entry.analyser as any).getByteFrequencyData(entry.data)
        const sum = entry.data.reduce((a, b) => a + b, 0)
        const rms = sum / entry.data.length / 256 // 归一化到 0~1

        const isSpeaking = rms > AUDIO_VAD_THRESHOLD
        const silenceStart = vadSilenceStartRef.current.get(uid) ?? 0

        if (isSpeaking) {
          vadSilenceStartRef.current.delete(uid)
          // 标记为 speaking
          if (!speakingUsersRef.current.includes(uid)) {
            speakingUsersRef.current = [...speakingUsersRef.current, uid]
            setSpeakingUsers(speakingUsersRef.current)
          }
          // 更新 audioUsers
          audioUsersRef.current = audioUsersRef.current.map((u) =>
            u.id === uid ? { ...u, speaking: true } : u
          )
          setAudioUsers([...audioUsersRef.current])
        } else {
          if (silenceStart === 0) {
            vadSilenceStartRef.current.set(uid, Date.now())
          } else if (Date.now() - silenceStart > AUDIO_VAD_IDLE_MS) {
            // 已静音足够久，取消 speaking
            speakingUsersRef.current = speakingUsersRef.current.filter((id) => id !== uid)
            setSpeakingUsers(speakingUsersRef.current)
            audioUsersRef.current = audioUsersRef.current.map((u) =>
              u.id === uid ? { ...u, speaking: false } : u
            )
            setAudioUsers([...audioUsersRef.current])
            vadSilenceStartRef.current.delete(uid)
          }
        }
      }, AUDIO_VAD_INTERVAL)

      vadTimersRef.current.set(uid, timer)
    } catch {
      // VAD init failed, skip
    }
  }, [])

  const stopVAD = useCallback((uid: string) => {
    const timer = vadTimersRef.current.get(uid)
    if (timer) {
      clearInterval(timer)
      vadTimersRef.current.delete(uid)
    }
    const entry = vadContextsRef.current.get(uid)
    if (entry) {
      entry.ctx.close().catch(() => {})
      vadContextsRef.current.delete(uid)
    }
    vadSilenceStartRef.current.delete(uid)
  }, [])

  // ===== Outbound peers =====

  const createOutboundPeer = useCallback((targetId: string) => {
    if (outboundPeersRef.current.has(targetId)) return
    if (!localStreamRef.current) return

    const peer = new SimplePeer({
      initiator: true,
      stream: localStreamRef.current,
      trickle: true,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      },
    })

    peer.on('signal', (signal) => {
      broadcast({
        id: generateId(),
        type: MESSAGE_TYPES.SYSTEM,
        senderId: userId,
        senderName: '',
        timestamp: Date.now(),
        content: JSON.stringify({ _audioSignal: { targetId, signal } }),
      })
    })

    peer.on('error', () => {
      outboundPeersRef.current.delete(targetId)
    })

    peer.on('close', () => {
      outboundPeersRef.current.delete(targetId)
    })

    outboundPeersRef.current.set(targetId, peer)
  }, [userId, broadcast])

  const destroyOutboundPeers = useCallback(() => {
    outboundPeersRef.current.forEach((p) => p.destroy())
    outboundPeersRef.current.clear()
  }, [])

  // ===== Inbound peers =====

  const createInboundPeer = useCallback((remoteId: string) => {
    if (inboundPeersRef.current.has(remoteId)) return

    const peer = new SimplePeer({
      initiator: false,
      trickle: true,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      },
    })

    peer.on('signal', (signal) => {
      broadcast({
        id: generateId(),
        type: MESSAGE_TYPES.SYSTEM,
        senderId: userId,
        senderName: '',
        timestamp: Date.now(),
        content: JSON.stringify({ _audioSignal: { targetId: remoteId, signal } }),
      })
    })

    peer.on('stream', (stream) => {
      addRemoteStream(remoteId, stream)
      // 对新来的流启动 VAD 监听
      startVAD(remoteId, stream)
    })

    peer.on('error', () => {
      inboundPeersRef.current.delete(remoteId)
      removeRemoteStream(remoteId)
      stopVAD(remoteId)
    })

    peer.on('close', () => {
      inboundPeersRef.current.delete(remoteId)
      removeRemoteStream(remoteId)
      stopVAD(remoteId)
    })

    inboundPeersRef.current.set(remoteId, peer)
  }, [userId, broadcast, addRemoteStream, removeRemoteStream, startVAD, stopVAD])

  const destroyInboundPeers = useCallback(() => {
    inboundPeersRef.current.forEach((p) => p.destroy())
    inboundPeersRef.current.clear()
  }, [])

  // ===== Start / Stop =====

  const startAudio = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } as MediaTrackConstraints,
        video: false,
      })

      localStreamRef.current = stream
      setLocalStream(stream)
      setIsMuted(false)
      setIsEnabled(true)

      const startedAt = Date.now()

      // 申请发言槽位
      slotManagerRef.current.enter(userId)
      syncSpeakerSlots(slotManagerRef.current.active())

      // 广播开启语音
      broadcast({
        id: generateId(),
        type: MESSAGE_TYPES.SYSTEM,
        senderId: userId,
        senderName: '',
        timestamp: Date.now(),
        content: JSON.stringify({
          _audioStart: { userId, startedAt, slotIds: slotManagerRef.current.active() },
        }),
      })

      // 把自己加入音频用户列表
      const me: AudioUser = { id: userId, muted: false, speaking: false, startedAt }
      syncAudioUsers([...audioUsersRef.current, me])

      // 给所有参与者创建出站 peer
      peerUserIds.forEach((id) => {
        if (id !== userId) createOutboundPeer(id)
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '麦克风启动失败'
      onError?.(msg)
    }
  }, [userId, broadcast, peerUserIds, createOutboundPeer, syncAudioUsers, syncSpeakerSlots, onError])

  const stopAudio = useCallback(() => {
    // 广播关闭
    broadcast({
      id: generateId(),
      type: MESSAGE_TYPES.SYSTEM,
      senderId: userId,
      senderName: '',
      timestamp: Date.now(),
      content: JSON.stringify({ _audioStop: {} }),
    })

    // 释放麦克风
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
    }
    setLocalStream(null)

    // 释放发言槽位
    slotManagerRef.current.leave(userId)
    syncSpeakerSlots(slotManagerRef.current.active())

    // 销毁所有 peer
    destroyOutboundPeers()
    destroyInboundPeers()

    // 清除远端流
    remoteStreamsRef.current.forEach((_, uid) => removeRemoteStream(uid))
    remoteStreamsRef.current.clear()

    // 停止所有 VAD
    vadTimersRef.current.forEach((timer, uid) => {
      clearInterval(timer)
      const entry = vadContextsRef.current.get(uid)
      if (entry) entry.ctx.close().catch(() => {})
    })
    vadTimersRef.current.clear()
    vadContextsRef.current.clear()
    vadSilenceStartRef.current.clear()
    speakingUsersRef.current = []
    setSpeakingUsers([])

    // 从音频用户列表移除自己
    syncAudioUsers(audioUsersRef.current.filter((u) => u.id !== userId))
    setIsEnabled(false)
  }, [userId, broadcast, destroyOutboundPeers, destroyInboundPeers, syncAudioUsers, removeRemoteStream, syncSpeakerSlots])

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current
    if (!stream) return

    const newMuted = !isMuted
    setIsMuted(newMuted)

    // 启用/禁用本地音频轨道
    stream.getAudioTracks().forEach((t) => {
      t.enabled = !newMuted
    })

    // 广播静音状态变化
    broadcast({
      id: generateId(),
      type: MESSAGE_TYPES.SYSTEM,
      senderId: userId,
      senderName: '',
      timestamp: Date.now(),
      content: JSON.stringify({ _audioMute: { muted: newMuted } }),
    })

    // 静音时释放发言槽位，取消静音时申请
    if (newMuted) {
      slotManagerRef.current.leave(userId)
      audioUsersRef.current = audioUsersRef.current.map((u) =>
        u.id === userId ? { ...u, muted: true } : u
      )
    } else {
      slotManagerRef.current.enter(userId)
      audioUsersRef.current = audioUsersRef.current.map((u) =>
        u.id === userId ? { ...u, muted: false } : u
      )
    }
    syncSpeakerSlots(slotManagerRef.current.active())
    setAudioUsers([...audioUsersRef.current])
  }, [userId, broadcast, isMuted, syncSpeakerSlots])

  // ===== 有新参与者加入时 =====
  useEffect(() => {
    if (!isEnabled) return
    peerUserIds.forEach((id) => {
      if (id !== userId && !outboundPeersRef.current.has(id)) {
        createOutboundPeer(id)
      }
    })
  }, [peerUserIds, userId, isEnabled, createOutboundPeer])

  // ===== Message handling =====

  const handleMessage = useCallback((msg: RoomMessage) => {
    if (msg.type !== MESSAGE_TYPES.SYSTEM) return

    try {
      const data = JSON.parse(msg.content)

      if (data._audioStart) {
        const { userId: remoteId, startedAt, slotIds } = data._audioStart
        if (remoteId === userId) return

        // 同步远端发言槽位
        if (slotIds && Array.isArray(slotIds)) {
          syncSpeakerSlots(slotIds)
        }

        // 加入音频用户列表
        const exists = audioUsersRef.current.some((u) => u.id === remoteId)
        if (!exists) {
          const newUser: AudioUser = { id: remoteId, muted: false, speaking: false, startedAt }
          syncAudioUsers([...audioUsersRef.current, newUser])
        }

        // 如果有音频在开启，给对方创建出站 peer（避免重复：已有出站或已连接的入站则跳过）
        const existingOut = outboundPeersRef.current.get(remoteId)
        if (isEnabled && localStreamRef.current && !existingOut) {
          createOutboundPeer(remoteId)
        } else if (existingOut?.destroyed) {
          outboundPeersRef.current.delete(remoteId)
          createOutboundPeer(remoteId)
        }
      } else if (data._audioStop) {
        const remoteId = msg.senderId
        if (remoteId === userId) return

        // 从音频用户列表移除
        syncAudioUsers(audioUsersRef.current.filter((u) => u.id !== remoteId))

        // 清理
        inboundPeersRef.current.get(remoteId)?.destroy()
        inboundPeersRef.current.delete(remoteId)
        outboundPeersRef.current.get(remoteId)?.destroy()
        outboundPeersRef.current.delete(remoteId)
        removeRemoteStream(remoteId)
        stopVAD(remoteId)

        // 释放发言槽位
        slotManagerRef.current.leave(remoteId)
        syncSpeakerSlots(slotManagerRef.current.active())
      } else if (data._audioMute) {
        const remoteId = msg.senderId
        const { muted } = data._audioMute
        audioUsersRef.current = audioUsersRef.current.map((u) =>
          u.id === remoteId ? { ...u, muted } : u
        )
        setAudioUsers([...audioUsersRef.current])

        // 静音时释放槽位，取消静音时申请
        if (muted) {
          slotManagerRef.current.leave(remoteId)
        } else {
          slotManagerRef.current.enter(remoteId)
        }
        syncSpeakerSlots(slotManagerRef.current.active())
      } else if (data._audioSignal) {
        const { targetId, signal } = data._audioSignal
        if (targetId === userId) {
          if (signal.type === 'offer') {
            // 防止信令竞态条件：已有 connected 的 inbound peer 则跳过重复 offer
            const existingInbound = inboundPeersRef.current.get(msg.senderId)
            if (existingInbound) {
              if (existingInbound.connected) {
                console.log(`[audio] skip duplicate offer from ${msg.senderId}, inbound already connected`)
                return
              }
              if (existingInbound.destroyed) {
                console.log(`[audio] inbound from ${msg.senderId} was destroyed, recreating`)
                inboundPeersRef.current.delete(msg.senderId)
                removeRemoteStream(msg.senderId)
                stopVAD(msg.senderId)
                createInboundPeer(msg.senderId)
              }
            } else {
              if (!inboundPeersRef.current.has(msg.senderId)) {
                createInboundPeer(msg.senderId)
              }
            }
            try {
              inboundPeersRef.current.get(msg.senderId)?.signal(signal)
            } catch { /* ignore */ }
          } else {
            // answer 或 ICE candidate
            let peer = outboundPeersRef.current.get(msg.senderId)
            if (peer) {
              try { peer.signal(signal) } catch { /* ignore */ }
            } else {
              peer = inboundPeersRef.current.get(msg.senderId)
              if (peer) {
                try { peer.signal(signal) } catch { /* ignore */ }
              }
            }
          }
        }
      }
    } catch { /* JSON parse failed */ }
  }, [userId, isEnabled, syncAudioUsers, createOutboundPeer, createInboundPeer, removeRemoteStream, stopVAD, syncSpeakerSlots])

  // ===== Cleanup =====
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop())
      }
      destroyOutboundPeers()
      destroyInboundPeers()
      vadTimersRef.current.forEach((timer) => clearInterval(timer))
      vadContextsRef.current.forEach((entry) => entry.ctx.close().catch(() => {}))
      vadTimersRef.current.clear()
      vadContextsRef.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    isEnabled,
    isMuted,
    audioUsers,
    speakingUsers,
    activeSpeakerIds: speakerSlotsRef.current,
    localStream,
    remoteStreams,
    startAudio,
    stopAudio,
    toggleMute,
    handleMessage,
  }
}
