import { useCallback, useEffect, useRef, useState } from 'react'
import SimplePeer from 'simple-peer'
import { generateId } from '../utils/helpers'
import {
  MESSAGE_TYPES,
  SCREENSHARE_HIGH_FPS,
  SCREENSHARE_LOW_FPS,
  SCREENSHARE_IDLE_FPS,
  SCREENSHOT_QUALITY,
  SCREENSHOT_MAX_WIDTH,
  SCREENSHOT_MAX_HEIGHT,
  DIRTY_RECT_THRESHOLD,
  BANDWIDTH_DOWNGRADE_THRESHOLD,
  BANDWIDTH_DOWNGRADE_SECONDS,
} from '../utils/constants'
import type { ConnectionState, RoomMessage, ShareMode, SignalMessage, ScreenshotMessage } from '../utils/types'

interface UseScreenShareOptions {
  userId: string
  broadcast: (msg: RoomMessage) => void
  /** 房间内其他用户的 ID 列表（含当前共享者信息） */
  peerUserIds: string[]
  onError?: (error: string) => void
}

interface UseScreenShareReturn {
  /** 当前共享模式 */
  shareMode: ShareMode
  /** 当前共享者 ID */
  sharerId: string | null
  /** 远端 WebRTC 流（viewer 侧） */
  remoteStream: MediaStream | null
  /** 截图模式下的当前帧 URL（object URL，viewer 侧） */
  screenshotUrl: string | null
  /** 带宽估测值（bps） */
  uploadBps: number
  /** 开始共享（用户操作入口） */
  startShare: () => Promise<void>
  /** 停止共享 */
  stopShare: () => void
  /** 处理收到的消息（由父组件连接 socket 消息） */
  handleMessage: (msg: RoomMessage) => void
  /** 处理新加入的远端用户 */
  handlePeerJoined: (newUserId: string) => void
}

export function useScreenShare({
  userId,
  broadcast,
  peerUserIds,
  onError,
}: UseScreenShareOptions): UseScreenShareReturn {
  // ===== State =====
  const [shareMode, setShareMode] = useState<ShareMode>('idle')
  const [sharerId, setSharerId] = useState<string | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)
  const [uploadBps, setUploadBps] = useState(0)

  // ===== Refs =====
  const screenStreamRef = useRef<MediaStream | null>(null)
  const peersRef = useRef<Map<string, SimplePeer.Instance>>(new Map())
  const captureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const statsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const degradeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const prevFrameDataRef = useRef<ImageData | null>(null)
  const frameSeqRef = useRef(0)
  const belowThresholdRef = useRef(false)
  const currentModeRef = useRef<ShareMode>('idle')
  const sharerIdRef = useRef<string | null>(null)
  const peerUserIdsRef = useRef<string[]>([])
  const degradeCountRef = useRef(0)
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 保持 peerUserIds 引用最新
  const prevPeerIdsRef = useRef<string[]>([])
  useEffect(() => {
    peerUserIdsRef.current = peerUserIds
    prevPeerIdsRef.current = peerUserIds
  }, [peerUserIds])

  // ===== WebRTC Peer Management =====

  /** Sharer: 为某个 viewer 创建 peer connection */
  const createSharerPeer = useCallback((targetId: string) => {
    if (peersRef.current.has(targetId)) return
    if (!screenStreamRef.current) return

    const peer = new SimplePeer({
      initiator: true,
      stream: screenStreamRef.current,
      trickle: true,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      },
    })

    peer.on('signal', (signal) => {
      const signalMsg: RoomMessage = {
        id: generateId(),
        type: MESSAGE_TYPES.SYSTEM,
        senderId: userId,
        senderName: '',
        timestamp: Date.now(),
        content: JSON.stringify({ _signal: { targetId, signal } }),
      }
      broadcast(signalMsg)
    })

    peer.on('error', (err) => {
      console.warn(`[ScreenShare] Peer error (${targetId}):`, err.message)
      peersRef.current.delete(targetId)
    })

    peer.on('close', () => {
      peersRef.current.delete(targetId)
    })

    peersRef.current.set(targetId, peer)
  }, [userId, broadcast])

  /** Sharer: 为所有当前 viewer 创建 peer */
  const connectToAllViewers = useCallback(() => {
    const targets = peerUserIdsRef.current.filter((id) => id !== userId)
    targets.forEach((targetId) => createSharerPeer(targetId))
  }, [userId, createSharerPeer])

  /** Sharer: 为新加入的 viewer 创建 peer */
  const handlePeerJoined = useCallback((newUserId: string) => {
    if (newUserId === userId) return
    if (currentModeRef.current !== 'webrtc') return
    if (sharerIdRef.current !== userId) return
    createSharerPeer(newUserId)
  }, [userId, createSharerPeer])

  // 当有新参与者加入时，如果正在共享屏幕，自动创建 peer 连接
  useEffect(() => {
    if (currentModeRef.current !== 'webrtc') return
    if (sharerIdRef.current !== userId) return
    peerUserIds.forEach((id) => {
      if (id !== userId && !peersRef.current.has(id)) {
        createSharerPeer(id)
      }
    })
  }, [peerUserIds, userId, createSharerPeer])

  // ===== Screenshot Capture (Fallback Mode) =====

  const initCapture = useCallback((stream: MediaStream) => {
    // 创建隐藏 video 元素用于捕捉屏幕画面
    const video = document.createElement('video')
    video.srcObject = stream
    video.playsInline = true
    video.muted = true
    video.autoplay = true
    video.style.position = 'fixed'
    video.style.opacity = '0'
    video.style.pointerEvents = 'none'
    video.style.width = '1px'
    video.style.height = '1px'
    document.body.appendChild(video)
    video.play()

    const canvas = document.createElement('canvas')
    canvas.width = SCREENSHOT_MAX_WIDTH
    canvas.height = SCREENSHOT_MAX_HEIGHT
    const ctx = canvas.getContext('2d')!

    videoRef.current = video
    canvasRef.current = canvas
    ctxRef.current = ctx
    prevFrameDataRef.current = null
  }, [])

  const cleanupCapture = useCallback(() => {
    if (captureTimerRef.current) {
      clearInterval(captureTimerRef.current)
      captureTimerRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.srcObject = null
      videoRef.current.remove()
      videoRef.current = null
    }
    if (canvasRef.current) {
      canvasRef.current = null
    }
    ctxRef.current = null
    prevFrameDataRef.current = null
  }, [])

  /** 截图并发送（被定时器驱动） */
  const captureAndSendFrame = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (!video || !canvas || !ctx) return

    // 页面不可见时暂停截图
    if (document.hidden) return

    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

      // 脏矩形检测：与上一帧对比变化量
      let changedPixels = 1.0 // 默认全帧
      if (prevFrameDataRef.current) {
        const prev = prevFrameDataRef.current.data
        const curr = imageData.data
        let diffCount = 0
        const total = prev.length
        // 采样检测（每 8 个像素检查一个以提升性能）
        const step = 8
        for (let i = 0; i < total; i += step * 4) {
          if (
            Math.abs(prev[i] - curr[i]) > 10 ||
            Math.abs(prev[i + 1] - curr[i + 1]) > 10 ||
            Math.abs(prev[i + 2] - curr[i + 2]) > 10
          ) {
            diffCount++
          }
        }
        changedPixels = diffCount / (total / (step * 4))
      }

      prevFrameDataRef.current = imageData

      // 静止时跳过上传
      if (changedPixels < 0.01) return

      // 变化剧烈时降低质量
      const quality = changedPixels > DIRTY_RECT_THRESHOLD ? SCREENSHOT_QUALITY : SCREENSHOT_QUALITY * 1.2

      canvas.toBlob(
        (blob) => {
          if (!blob) return
          const reader = new FileReader()
          reader.onloadend = () => {
            const base64 = reader.result as string
            frameSeqRef.current++
            const screenshotMsg: ScreenshotMessage = {
              id: generateId(),
              type: MESSAGE_TYPES.SCREENSHOT,
              senderId: userId,
              senderName: '',
              timestamp: Date.now(),
              data: base64,
              frameSeq: frameSeqRef.current,
            }
            broadcast(screenshotMsg)
          }
          reader.readAsDataURL(blob)
        },
        'image/jpeg',
        Math.min(quality, 0.85),
      )
    } catch {
      // capture error
    }
  }, [userId, broadcast])

  const startScreenshotCapture = useCallback(() => {
    if (captureTimerRef.current) return
    const interval = 1000 / SCREENSHARE_HIGH_FPS
    captureTimerRef.current = setInterval(captureAndSendFrame, interval)
  }, [captureAndSendFrame])

  const stopScreenshotCapture = useCallback(() => {
    if (captureTimerRef.current) {
      clearInterval(captureTimerRef.current)
      captureTimerRef.current = null
    }
  }, [])

  // ===== Bandwidth Monitoring =====

  const startBandwidthMonitoring = useCallback(() => {
    if (statsTimerRef.current) return

    // navigator.connection API (Chrome)
    const conn = (navigator as { connection?: { downlink: number; rtt: number } }).connection
    if (conn) {
      setUploadBps(conn.downlink * 1_000_000)
    }

    statsTimerRef.current = setInterval(async () => {
      // 尝试从 WebRTC peer 获取 stats
      let sendingBps = 0
      const firstPeer = peersRef.current.values().next().value
      if (firstPeer) {
        try {
          const pc = (firstPeer as unknown as { _pc: RTCPeerConnection })._pc
          if (pc) {
            const stats = await pc.getStats()
            stats.forEach((report) => {
              if (report.type === 'outbound-rtp' && report.kind === 'video') {
                sendingBps = report.targetBitrate ?? report.bitrate ?? 0
                if (!sendingBps && report.bytesSent && report.timestamp) {
                  sendingBps = (report.bytesSent * 8) / 1_000_000
                }
              }
            })
          }
        } catch {
          // ignore
        }
      }

      // 如果没有 WebRTC 连接，用 Connection API
      if (!sendingBps && conn) {
        sendingBps = conn.downlink * 1_000_000
      }

      // 截图模式下估算：JPEG 平均大小 * FPS * 8
      if (!sendingBps && currentModeRef.current === 'screenshot') {
        sendingBps = BANDWIDTH_DOWNGRADE_THRESHOLD * 0.8 // 截图模式一般带宽较低
      }

      if (sendingBps > 0) {
        setUploadBps(sendingBps)

        // 降级 / 恢复逻辑
        if (currentModeRef.current === 'webrtc') {
          if (sendingBps < BANDWIDTH_DOWNGRADE_THRESHOLD && !belowThresholdRef.current) {
            belowThresholdRef.current = true
            degradeTimerRef.current = setTimeout(() => {
              degradeCountRef.current++
              if (currentModeRef.current === 'webrtc') {
                switchToScreenshotMode()
              }
            }, BANDWIDTH_DOWNGRADE_SECONDS * 1000)
          } else if (sendingBps >= BANDWIDTH_DOWNGRADE_THRESHOLD) {
            belowThresholdRef.current = false
            if (degradeTimerRef.current) {
              clearTimeout(degradeTimerRef.current)
              degradeTimerRef.current = null
            }
          }
        } else if (currentModeRef.current === 'screenshot') {
          // 截图模式下，如果带宽恢复，尝试切回 WebRTC
          if (sendingBps >= BANDWIDTH_DOWNGRADE_THRESHOLD * 1.5 && degradeCountRef.current > 0) {
            degradeCountRef.current--
            if (degradeCountRef.current <= 0 && screenStreamRef.current) {
              switchToWebRTCMode()
            }
          }
        }
      }
    }, 2000)
  }, [])

  const stopBandwidthMonitoring = useCallback(() => {
    if (statsTimerRef.current) {
      clearInterval(statsTimerRef.current)
      statsTimerRef.current = null
    }
    if (degradeTimerRef.current) {
      clearTimeout(degradeTimerRef.current)
      degradeTimerRef.current = null
    }
    belowThresholdRef.current = false
  }, [])

  // ===== Mode Switching =====

  const switchToScreenshotMode = useCallback(() => {
    currentModeRef.current = 'screenshot'
    setShareMode('screenshot')

    // 停止 WebRTC peers
    peersRef.current.forEach((p) => p.destroy())
    peersRef.current.clear()

    // 通知房间降级
    const sysMsg: RoomMessage = {
      id: generateId(),
      type: MESSAGE_TYPES.SYSTEM,
      senderId: userId,
      senderName: '',
      timestamp: Date.now(),
      content: JSON.stringify({ _shareMode: { mode: 'screenshot' } }),
    }
    broadcast(sysMsg)

    // 开始截图模式
    startScreenshotCapture()
  }, [userId, broadcast, startScreenshotCapture])

  const switchToWebRTCMode = useCallback(() => {
    currentModeRef.current = 'webrtc'
    setShareMode('webrtc')

    stopScreenshotCapture()

    // 重新建立 WebRTC 连接
    if (screenStreamRef.current) {
      connectToAllViewers()
    }

    // 通知房间恢复
    const sysMsg: RoomMessage = {
      id: generateId(),
      type: MESSAGE_TYPES.SYSTEM,
      senderId: userId,
      senderName: '',
      timestamp: Date.now(),
      content: JSON.stringify({ _shareMode: { mode: 'webrtc' } }),
    }
    broadcast(sysMsg)
  }, [userId, broadcast, connectToAllViewers, stopScreenshotCapture])

  // ===== Public API =====

  const startShare = useCallback(async () => {
    try {
      // 请求屏幕共享（先尝试带系统音频，失败则回退到仅视频）
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 15 },
          } as MediaTrackConstraints,
          audio: true,
        })
      } catch (audioErr) {
        console.warn('[ScreenShare] 系统音频不可用，回退到无音频模式:', audioErr)
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 15 },
          } as MediaTrackConstraints,
          audio: false,
        })
      }

      screenStreamRef.current = stream
      currentModeRef.current = 'webrtc'
      setShareMode('webrtc')
      setSharerId(userId)
      sharerIdRef.current = userId
      degradeCountRef.current = 0

      // 监听共享停止（用户点击浏览器的"停止共享"按钮）
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        stopShare()
      })

      // 初始化截图捕获备用
      initCapture(stream)

      // 广播开始共享
      const sysMsg: RoomMessage = {
        id: generateId(),
        type: MESSAGE_TYPES.SYSTEM,
        senderId: userId,
        senderName: '',
        timestamp: Date.now(),
        content: JSON.stringify({ _shareStart: { sharerId: userId } }),
      }
      broadcast(sysMsg)

      // 为所有 viewer 创建 peer
      connectToAllViewers()

      // 启动心跳广播：每 5 秒发一次 _shareStart，让后来加入的观众能发现共享
      heartbeatTimerRef.current = setInterval(() => {
        if (currentModeRef.current === 'idle') {
          if (heartbeatTimerRef.current) { clearInterval(heartbeatTimerRef.current); heartbeatTimerRef.current = null }
          return
        }
        broadcast({
          id: generateId(),
          type: MESSAGE_TYPES.SYSTEM,
          senderId: userId,
          senderName: '',
          timestamp: Date.now(),
          content: JSON.stringify({ _shareStart: { sharerId: userId } }),
        })
      }, 5000)

      // 启动带宽监控
      startBandwidthMonitoring()
    } catch (err) {
      const msg = err instanceof Error ? err.message : '屏幕共享启动失败'
      onError?.(msg)
      // 用户取消或浏览器拒绝
      if (`${err}`.includes('Permission denied') || `${err}`.includes('AbortError')) {
        return
      }
      setShareMode('idle')
    }
  }, [userId, broadcast, connectToAllViewers, initCapture, startBandwidthMonitoring, onError])

  const stopShare = useCallback(() => {
    // 停止心跳
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current)
      heartbeatTimerRef.current = null
    }
    // 停止捕获
    stopScreenshotCapture()
    cleanupCapture()
    stopBandwidthMonitoring()

    // 释放流
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop())
      screenStreamRef.current = null
    }

    // 销毁所有 peer
    peersRef.current.forEach((p) => p.destroy())
    peersRef.current.clear()

    // 重置状态
    currentModeRef.current = 'idle'
    setShareMode('idle')
    setSharerId(null)
    setRemoteStream(null)
    setScreenshotUrl(null)
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
  }, [userId, broadcast, stopScreenshotCapture, cleanupCapture, stopBandwidthMonitoring])

  // ===== Viewer Peer Management =====

  const viewerPeerRef = useRef<SimplePeer.Instance | null>(null)

  const createViewerPeer = useCallback((sharerSideId: string) => {
    viewerPeerRef.current?.destroy()

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
      // 将 signal 中继给共享者
      const signalMsg: RoomMessage = {
        id: generateId(),
        type: MESSAGE_TYPES.SYSTEM,
        senderId: userId,
        senderName: '',
        timestamp: Date.now(),
        content: JSON.stringify({ _signal: { targetId: sharerSideId, signal } }),
      }
      broadcast(signalMsg)
    })

    peer.on('stream', (stream) => {
      setRemoteStream(stream)
    })

    peer.on('error', (err) => {
      console.warn('[ScreenShare] Viewer peer error:', err.message)
    })

    viewerPeerRef.current = peer
  }, [userId, broadcast])

  // ===== Message Handling =====

  const handleMessage = useCallback((msg: RoomMessage) => {
    if (msg.type !== MESSAGE_TYPES.SYSTEM && msg.type !== MESSAGE_TYPES.SCREENSHOT) return

    if (msg.type === MESSAGE_TYPES.SCREENSHOT) {
      // Viewer 收到截图帧
      const shot = msg as ScreenshotMessage
      const url = URL.createObjectURL(dataURLToBlob(shot.data))
      setScreenshotUrl(url)
      // 旧 URL 在下次渲染时回收
      return
    }

    try {
      const data = JSON.parse(msg.content)

      if (data._shareStart) {
        // 有人开始共享（或心跳）
        const sid = data._shareStart.sharerId
        if (sid === userId) return
        // 如果已经连接到同一个共享者，只更新状态，不重建 peer
        if (sharerIdRef.current === sid && viewerPeerRef.current && !viewerPeerRef.current.destroyed) {
          setSharerId(sid)
          setShareMode('webrtc')
          currentModeRef.current = 'webrtc'
          return
        }
        setSharerId(sid)
        setShareMode('webrtc')
        currentModeRef.current = 'webrtc'
        sharerIdRef.current = sid

        // 作为 viewer，创建 peer connection
        createViewerPeer(sid)
      } else if (data._shareStop) {
        // 共享结束
        setShareMode('idle')
        setSharerId(null)
        setRemoteStream(null)
        setScreenshotUrl(null)
        currentModeRef.current = 'idle'
        sharerIdRef.current = null
        viewerPeerRef.current?.destroy()
        viewerPeerRef.current = null
      } else if (data._shareMode) {
        // 模式切换
        const mode = data._shareMode.mode as ShareMode
        currentModeRef.current = mode
        setShareMode(mode)
        if (mode === 'webrtc') {
          // Viewer: 切回 WebRTC，重建 peer
          const sid = sharerIdRef.current
          if (sid && sid !== userId) {
            viewerPeerRef.current?.destroy()
            viewerPeerRef.current = null
            createViewerPeer(sid)
          }
        }
      } else if (data._rejoin) {
        // Viewer 断线重连，通知共享者重建 peer
        const { sharerId: sid } = data._rejoin
        if (sid === userId && screenStreamRef.current) {
          // 我是共享者：无论当前在 webrtc 还是 screenshot 模式，都为重连 viewer 重建出站 peer
          const rejoinerId = msg.senderId
          if (rejoinerId !== userId && !peersRef.current.has(rejoinerId)) {
            if (currentModeRef.current === 'screenshot') {
              // 截图模式：切换回 webrtc 以便为 viewer 提供实时画面
              console.log(`[ScreenShare] screenshot mode → switching to webrtc for rejoining viewer ${rejoinerId}`)
              switchToWebRTCMode()
            }
            console.log(`[ScreenShare] re-creating sharer peer for rejoining viewer ${rejoinerId}`)
            createSharerPeer(rejoinerId)
          }
          // 同步播 _shareStart 让 viewer 确认共享状态（信令丢失兜底）
          broadcast({
            id: generateId(),
            type: MESSAGE_TYPES.SYSTEM,
            senderId: userId,
            senderName: '',
            timestamp: Date.now(),
            content: JSON.stringify({ _shareStart: { sharerId: userId } }),
          })
        } else if (sid === sharerIdRef.current || !sharerIdRef.current) {
          // 我是 viewer：重新初始化状态并创建 viewer peer
          if (sid !== userId) {
            setSharerId(sid)
            setShareMode('webrtc')
            currentModeRef.current = 'webrtc'
            sharerIdRef.current = sid
            viewerPeerRef.current?.destroy()
            viewerPeerRef.current = null
            createViewerPeer(sid)
          }
        }
      } else if (data._signal) {
        // 处理 signaling 数据
        const { targetId, signal } = data._signal
        if (targetId === userId) {
          // 这个 signal 是发给我的
          if (signal.type === 'offer') {
            // Sharer 发来的 offer
            // 如果 sharerIdRef 为空（新加入者未收到 _shareStart），用 msg.senderId 推断
            const sharerFromOffer = sharerIdRef.current || msg.senderId
            if (!viewerPeerRef.current && sharerFromOffer && sharerFromOffer !== userId) {
              setSharerId(sharerFromOffer)
              setShareMode('webrtc')
              currentModeRef.current = 'webrtc'
              sharerIdRef.current = sharerFromOffer
              createViewerPeer(sharerFromOffer)
            }
            try {
              viewerPeerRef.current?.signal(signal)
            } catch { /* ignore */ }
          } else if (signal.type === 'answer') {
            // Viewer 的 answer，sharer 处理
            const senderId = msg.senderId
            const peer = peersRef.current.get(senderId)
            if (peer && signal.type !== 'candidate') {
              try { peer.signal(signal) } catch { /* ignore */ }
            }
          } else {
            // ICE candidate
            const senderId = msg.senderId
            const peer = peersRef.current.get(senderId)
            if (peer) {
              try { peer.signal(signal) } catch { /* ignore */ }
            } else {
              try { viewerPeerRef.current?.signal(signal) } catch { /* ignore */ }
            }
          }
        }
      }
    } catch {
      // JSON parse failed, not a structured message
    }
  }, [userId, createSharerPeer, createViewerPeer])

  // ===== Helpers =====

  function dataURLToBlob(dataURL: string): Blob {
    const parts = dataURL.split(',')
    const mime = parts[0]?.match(/:(.*?);/)?.[1] ?? 'image/jpeg'
    const binary = atob(parts[1]!)
    const array = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      array[i] = binary.charCodeAt(i)
    }
    return new Blob([array], { type: mime })
  }

  // ===== Cleanup =====
  useEffect(() => {
    return () => {
      stopShare()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    shareMode,
    sharerId,
    remoteStream,
    screenshotUrl,
    uploadBps,
    startShare,
    stopShare,
    handleMessage,
    handlePeerJoined,
  }
}
