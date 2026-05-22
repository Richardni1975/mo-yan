import { useCallback, useRef, useState } from 'react'
import SimplePeer, { type SignalData } from 'simple-peer'
import { generateId } from '../utils/helpers'
import { MESSAGE_TYPES } from '../utils/constants'
import type { RoomMessage, SignalMessage, ShareMode } from '../utils/types'

interface PeerInfo {
  peer: SimplePeer.Instance
  userId: string
  connected: boolean
}

interface UseWebRTCOptions {
  userId: string
  broadcast: (msg: RoomMessage) => void
  onSignal: (handler: (msg: SignalMessage) => void) => void
}

interface UseWebRTCReturn {
  /** 远端屏幕共享流映射（viewerId → MediaStream） */
  remoteStreams: Map<string, MediaStream>
  /** 当前共享模式 */
  shareMode: ShareMode
  /** 开始 WebRTC 屏幕共享 */
  startScreenShare: (stream: MediaStream) => Promise<void>
  /** 停止屏幕共享 */
  stopScreenShare: () => void
  /** 当前共享者 ID */
  sharerId: string | null
  /** 作为 viewer 处理收到的信号 */
  handleSignal: (msg: SignalMessage) => void
  /** 获取 sharer 的 RTCPeerConnection（用于带宽监控） */
  getSharerPC: () => RTCPeerConnection | null
  /** 设置要连接的远端用户列表 */
  setRemotePeers: (userIds: string[]) => void
  /** 清理某用户的连接 */
  removePeer: (userId: string) => void
}

export function useWebRTC({ userId, broadcast, onSignal }: UseWebRTCOptions): UseWebRTCReturn {
  const peersRef = useRef<Map<string, PeerInfo>>(new Map())
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map())
  const [shareMode, setShareMode] = useState<ShareMode>('idle')
  const [sharerId, setSharerId] = useState<string | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const signalHandlerRef = useRef<((msg: SignalMessage) => void) | null>(null)

  // 注册信号处理器
  onSignal((msg) => {
    signalHandlerRef.current?.(msg)
  })

  const createSharerPeer = useCallback((targetId: string, stream: MediaStream): SimplePeer.Instance => {
    const peer = new SimplePeer({
      initiator: true,
      stream,
      trickle: true,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      },
    })

    peer.on('signal', (signal) => {
      const signalMsg: SignalMessage = {
        id: generateId(),
        type: MESSAGE_TYPES.SIGNAL,
        signalType: signal.type === 'offer' ? 'offer' : 'ice-candidate',
        senderId: userId,
        senderName: '',
        targetId,
        signal,
        timestamp: Date.now(),
      }
      broadcast(signalMsg)
    })

    peer.on('connect', () => {
      const info = peersRef.current.get(targetId)
      if (info) {
        info.connected = true
        peersRef.current.set(targetId, info)
      }
    })

    peer.on('error', (err) => {
      console.warn(`[WebRTC] Peer error (${targetId}):`, err.message)
      peersRef.current.delete(targetId)
    })

    peer.on('close', () => {
      peersRef.current.delete(targetId)
    })

    return peer
  }, [userId, broadcast])

  const createViewerPeer = useCallback((): SimplePeer.Instance => {
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
      if (!sharerIdRef.current) return
      const signalMsg: SignalMessage = {
        id: generateId(),
        type: MESSAGE_TYPES.SIGNAL,
        signalType: signal.type === 'answer' ? 'answer' : 'ice-candidate',
        senderId: userId,
        senderName: '',
        targetId: sharerIdRef.current,
        signal,
        timestamp: Date.now(),
      }
      broadcast(signalMsg)
    })

    peer.on('stream', (stream) => {
      const sid = sharerIdRef.current
      if (sid) {
        setRemoteStreams((prev) => {
          const next = new Map(prev)
          next.set(sid, stream)
          return next
        })
      }
    })

    peer.on('error', (err) => {
      console.warn('[WebRTC] Viewer peer error:', err.message)
    })

    peer.on('close', () => {
      //
    })

    return peer
  }, [userId, broadcast])

  const sharerIdRef = useRef<string | null>(null)
  const viewerPeerRef = useRef<SimplePeer.Instance | null>(null)

  const startScreenShare = useCallback(async (stream: MediaStream) => {
    screenStreamRef.current = stream
    setShareMode('webrtc')
    setSharerId(userId)
    sharerIdRef.current = userId

    // 广播通知所有 viewer 开始共享
    const sysMsg: RoomMessage = {
      id: generateId(),
      type: MESSAGE_TYPES.SYSTEM,
      senderId: userId,
      senderName: '',
      timestamp: Date.now(),
      content: JSON.stringify({ _shareStart: { sharerId: userId } }),
    }
    broadcast(sysMsg)
  }, [userId, broadcast])

  const stopScreenShare = useCallback(() => {
    // 关闭所有 sharer peer
    peersRef.current.forEach((info) => {
      info.peer.destroy()
    })
    peersRef.current.clear()

    // 释放屏幕共享流
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop())
      screenStreamRef.current = null
    }

    setRemoteStreams(new Map())
    setShareMode('idle')
    setSharerId(null)
    sharerIdRef.current = null

    // 广播停止
    const sysMsg: RoomMessage = {
      id: generateId(),
      type: MESSAGE_TYPES.SYSTEM,
      senderId: userId,
      senderName: '',
      timestamp: Date.now(),
      content: JSON.stringify({ _shareStop: {} }),
    }
    broadcast(sysMsg)
  }, [userId, broadcast])

  const setRemotePeers = useCallback((userIds: string[]) => {
    // 如果当前用户是共享者，为所有新用户创建 peer
    if (sharerIdRef.current !== userId) return
    if (!screenStreamRef.current) return

    userIds.forEach((targetId) => {
      if (targetId === userId) return
      if (peersRef.current.has(targetId)) return

      const peer = createSharerPeer(targetId, screenStreamRef.current!)
      peersRef.current.set(targetId, { peer, userId: targetId, connected: false })
    })
  }, [userId, createSharerPeer])

  const handleSignal = useCallback((msg: SignalMessage) => {
    // 如果 signal 是发给自己的
    if (msg.targetId !== userId) return

    if (msg.signalType === 'offer') {
      // Viewer 收到了 sharer 的 offer
      // (sharer initiates so this won't happen normally in our setup)
      // 但为了健壮性，保留处理逻辑
    } else if (msg.signalType === 'answer') {
      // Sharer 收到 viewer 的 answer
      const peerInfo = peersRef.current.get(msg.senderId)
      if (peerInfo && !peerInfo.connected) {
        peerInfo.peer.signal(msg.signal as SignalData)
      }
    } else if (msg.signalType === 'ice-candidate') {
      const peerInfo = peersRef.current.get(msg.senderId)
      if (peerInfo) {
        peerInfo.peer.signal(msg.signal as SignalData)
      } else if (msg.senderId === sharerIdRef.current && viewerPeerRef.current) {
        // viewer 收到 sharer 的 ICE candidate
        try {
          viewerPeerRef.current.signal(msg.signal as SignalData)
        } catch {
          // ignore
        }
      }
    }
  }, [userId])

  const getSharerPC = useCallback((): RTCPeerConnection | null => {
    // 如果有 viewer peer，返回它的原生 RTCPeerConnection
    if (viewerPeerRef.current) {
      return (viewerPeerRef.current as unknown as { _pc: RTCPeerConnection })._pc ?? null
    }
    // 如果是 sharer，返回第一个 peer 的 connection
    const first = peersRef.current.values().next().value
    if (first) {
      return (first.peer as unknown as { _pc: RTCPeerConnection })._pc ?? null
    }
    return null
  }, [])

  const removePeer = useCallback((targetId: string) => {
    const peerInfo = peersRef.current.get(targetId)
    if (peerInfo) {
      peerInfo.peer.destroy()
      peersRef.current.delete(targetId)
    }
  }, [])

  return {
    remoteStreams,
    shareMode,
    startScreenShare,
    stopScreenShare,
    sharerId,
    handleSignal,
    getSharerPC,
    setRemotePeers,
    removePeer,
  }
}
