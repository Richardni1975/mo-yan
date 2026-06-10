import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { useSocket } from '../hooks/useSocket'
import { useChat } from '../hooks/useChat'
import { useVoting } from '../hooks/useVoting'
import { useScreenShare } from '../hooks/useScreenShare'
import { useVideoCall } from '../hooks/useVideoCall'
import { useAudioCall } from '../hooks/useAudioCall'
import { ScreenShare } from '../components/ScreenShare'
import { VideoGrid } from '../components/VideoGrid'
import { VoiceControls } from '../components/VoiceControls'
import { AudioRenderer } from '../components/AudioRenderer'
import { ChatPanel } from '../components/ChatPanel'
import { ParticipantList } from '../components/ParticipantList'
import { VotingPanel } from '../components/VotingPanel'
import { ConnectionStatus } from '../components/ConnectionStatus'
import { DebugOverlay } from '../components/DebugOverlay'
import { generateId, formatDateTime, getLanIP } from '../utils/helpers'
import { isSupabaseConfigured } from '../utils/supabase'
import { MESSAGE_TYPES, STORAGE_KEYS } from '../utils/constants'
import type { RoomMessage, ChatMessage } from '../utils/types'

export function MeetingRoom() {
  const { roomId } = useParams<{ roomId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  // 优先使用真实姓名，如果没有则使用昵称
  const [nickname] = useState(() => {
    const state = location.state as { nickname?: string; realName?: string } | null
    const realName = state?.realName ?? localStorage.getItem(STORAGE_KEYS.REAL_NAME) ?? ''
    const nick = state?.nickname ?? localStorage.getItem(STORAGE_KEYS.NICKNAME) ?? '用户'
    // 如果有真实姓名就显示真实姓名，否则显示昵称
    return realName || nick
  })
  const [userId] = useState(() => generateId())
  const [isAnonymous, setIsAnonymous] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.ANONYMOUS) === 'true'
  })
  const [participants, setParticipants] = useState<Array<{ id: string; name: string; isSharing: boolean }>>([])
  const [sharerName, setSharerName] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showVote, setShowVote] = useState(false)
  const [showExitConfirm, setShowExitConfirm] = useState(false)

  // 移动端检测
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640)
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight)
  useEffect(() => {
    const onResize = () => {
      setIsMobile(window.innerWidth < 640)
      setViewportHeight(window.innerHeight)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const effectiveRoomId = roomId ?? 'unknown'

  // ===== Socket =====
  const { connectionState, joinRoom, leaveRoom, broadcast, updatePresence } = useSocket({
    roomId: effectiveRoomId,
    userId,
    userName: nickname,
    onMessage: (msg) => handleIncomingMessage(msg),
    onParticipantsChange: (ps) => setParticipants(ps),
  })

  // ===== Chat =====
  const chat = useChat({ userId, userName: nickname, roomId: effectiveRoomId, broadcast })

  // ===== Voting =====
  const voting = useVoting({ userId, userName: nickname, broadcast })

  // ===== Screen Share =====
  const screenShare = useScreenShare({
    userId,
    broadcast,
    peerUserIds: participants.map((p) => p.id),
    onError: (err) => alert(err),
  })

  // ===== Video Call =====
  const videoCall = useVideoCall({
    userId,
    broadcast,
    peerUserIds: participants.map((p) => p.id),
    onError: (err) => alert(err),
  })

  // ===== Audio Call =====
  const audioCall = useAudioCall({
    userId,
    userName: nickname,
    broadcast,
    peerUserIds: participants.map((p) => p.id),
    isVideoEnabled: videoCall.isEnabled,
    videoStreamRef: videoCall.localStream,
    onError: (err) => alert(err),
  })

  // 互斥：开启摄像头时停止共享，开启共享时关闭摄像头
  const handleStartShare = useCallback(() => {
    if (videoCall.isEnabled) videoCall.stopVideo()
    screenShare.startShare()
  }, [videoCall, screenShare])

  const handleStartVideo = useCallback(() => {
    if (screenShare.shareMode !== 'idle') screenShare.stopShare()
    videoCall.startVideo()
  }, [videoCall, screenShare])

  // ===== 消息路由 =====
  const handleIncomingMessage = useCallback(
    (msg: RoomMessage) => {
      if (msg.senderId === userId) return
      if (msg.type === MESSAGE_TYPES.CHAT) {
        chat.addMessage(msg as ChatMessage)
      } else if (msg.type === MESSAGE_TYPES.SCREENSHOT) {
        screenShare.handleMessage(msg)
      } else if (msg.type === MESSAGE_TYPES.SYSTEM) {
        try {
          const data = JSON.parse(msg.content)
          if (data._signal || data._shareStart || data._shareStop || data._shareMode || data._rejoin) {
            screenShare.handleMessage(msg)
          }
          if (data._videoStart || data._videoStop || data._videoSignal) {
            videoCall.handleMessage(msg)
          }
          if (data._vote || data._voteCast || data._voteEnd) {
            voting.handleVoteMessage(msg)
          }
          if (data._audioStart || data._audioStop || data._audioSignal || data._audioMute) {
            audioCall.handleMessage(msg)
          }
        } catch { /* 纯文本系统消息 */ }
      }
    },
    [userId, chat, screenShare, videoCall, voting, audioCall]
  )

  // ===== 查找共享者名称 =====
  useEffect(() => {
    if (screenShare.sharerId) {
      const p = participants.find((p) => p.id === screenShare.sharerId)
      setSharerName(p?.name ?? null)
    } else {
      setSharerName(null)
    }
  }, [screenShare.sharerId, participants])

  // ===== 重新连接后恢复共享观看（带重试机制） =====
  useEffect(() => {
    if (screenShare.sharerId) return // 已连接共享者，无需恢复
    const activeSharer = participants.find((p) => p.isSharing && p.id !== userId)
    if (!activeSharer) return

    const sharerId = activeSharer.id
    let retryCount = 0
    const MAX_RETRIES = 5
    let timers: ReturnType<typeof setTimeout>[] = []

    const sendRejoin = () => {
      if (screenShare.sharerId) {
        // 已成功连接，停止重试
        timers.forEach(clearTimeout)
        return
      }
      console.log(`[Rejoin] 发送 rejoin (sharer=${sharerId}) 尝试 #${retryCount + 1}`)
      broadcast({
        id: generateId(),
        type: MESSAGE_TYPES.SYSTEM,
        senderId: userId,
        senderName: '',
        timestamp: Date.now(),
        content: JSON.stringify({ _rejoin: { sharerId: sharerId } }),
      })
      retryCount++
      if (retryCount < MAX_RETRIES) {
        // 指数退避：1s, 2s, 4s, 8s, 16s... 最大间隔 16s
        const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 16000)
        const timer = setTimeout(sendRejoin, delay)
        timers.push(timer)
      }
    }

    // 首次发送：先等 500ms 确保 socket 就绪
    const initialTimer = setTimeout(sendRejoin, 500)
    timers.push(initialTimer)

    return () => {
      timers.forEach(clearTimeout)
    }
  }, [participants, userId, screenShare.sharerId, screenShare.shareMode, broadcast])


  // ===== 共享状态同步到在线状态 =====
  useEffect(() => {
    updatePresence({
      user_id: userId,
      name: nickname,
      online_at: new Date().toISOString(),
      isSharing: screenShare.sharerId === userId,
    })
  }, [screenShare.sharerId, userId, nickname, updatePresence])

  // ===== 加入房间 =====
  useEffect(() => {
    if (roomId) joinRoom()
    return () => leaveRoom()
  }, [roomId, joinRoom, leaveRoom])

  // ===== 加载诊断（帮助排查移动端访问问题） =====
  useEffect(() => {
    console.log('[默言无声] 页面已加载。房间 ID:', roomId)
    window.addEventListener('error', (e) => {
      console.error('[默言无声] 加载时未捕获错误:', e.error?.message ?? e.message)
    })
  }, [])

  // ===== 匿名模式 =====
  const toggleAnonymous = useCallback(() => {
    setIsAnonymous((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEYS.ANONYMOUS, String(next))
      return next
    })
  }, [])

  // ===== 退出房间（含程序退出） =====
  const handleExit = useCallback(() => {
    leaveRoom()
    setShowExitConfirm(false)
    navigate('/')
    // 如果是在 PWA/独立窗口中打开，尝试关闭窗口
    try {
      if ((window.navigator as { standalone?: boolean }).standalone || window.matchMedia('(display-mode: standalone)').matches) {
        window.close()
      }
    } catch { /* 静默处理 */ }
  }, [leaveRoom, navigate])

  // ===== 发送消息 =====
  const handleSendMessage = useCallback((content: string) => {
    chat.sendMessage(content, isAnonymous)
  }, [chat, isAnonymous])

  // ===== 复制房间链接 =====
  const HTTPS_PROXY_PORT = 5174
  const [copying, setCopying] = useState(false)
  const handleCopyLink = useCallback(async () => {
    if (copying) return
    setCopying(true)
    const hostname = window.location.hostname
    let url: string
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      // 电脑端：生成 HTTPS 局域网地址供手机用
      const lanIP = await getLanIP()
      if (lanIP !== 'localhost') {
        url = `https://${lanIP}:${HTTPS_PROXY_PORT}/room/${effectiveRoomId}`
      } else {
        url = `${window.location.protocol}//localhost:${window.location.port}/room/${effectiveRoomId}`
      }
    } else {
      // 已是局域网地址，直接复制当前地址
      url = `${window.location.protocol}//${hostname}:${window.location.port}/room/${effectiveRoomId}`
    }
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
    setCopying(false)
  }, [effectiveRoomId, copying])

  // ===== 导出 =====
  // 一键导出全部（聊天 + 投票）为 TXT
  const doExportAllTxt = useCallback(() => {
    if (chat.messages.length === 0 && voting.votes.length === 0) {
      alert('暂无聊天记录和投票记录')
      return
    }
    const time = formatDateTime(new Date())
    let txt = `═══════════════════════════════════\n`
    txt += `  默言无声 · 会议记录\n`
    txt += `  房间: ${effectiveRoomId}\n`
    txt += `  导出时间: ${time}\n`
    txt += `═══════════════════════════════════\n\n`

    // 聊天记录
    if (chat.messages.length > 0) {
      txt += `━━━ 聊天记录 (${chat.messages.length} 条) ━━━\n\n`
      chat.messages.forEach((m) => {
        const ts = formatDateTime(new Date(m.timestamp))
        txt += `[${ts}] ${m.senderName}：\n`
        txt += `  ${m.content}\n\n`
      })
    }

    // 投票结果
    if (voting.votes.length > 0) {
      txt += `━━━ 投票结果 ━━━\n\n`
      voting.votes.forEach((vote) => {
        const vr = voting.results[vote.id] ?? []
        const total = vr.reduce((s, r) => s + r.count, 0)
        const modeLabel = vote.mode === 'real_name' ? '实名' : vote.mode === 'anonymous' ? '匿名' : '混合'
        txt += `▸ ${vote.title}\n`
        txt += `  模式: ${modeLabel} | 总票数: ${total}\n`
        vr.forEach((r) => {
          const opt = vote.options.find((o) => o.id === r.optionId)
          const voters = r.voters ? `（${r.voters.join('、')}）` : ''
          txt += `  - ${opt?.label ?? '?'}: ${r.count} 票${voters}\n`
        })
        txt += `\n`
      })
    }

    txt += `═══════════════════════════════════\n`
    txt += `  由「默言无声」生成\n`
    txt += `  https://mo-yan.pages.dev\n`
    txt += `═══════════════════════════════════\n`

    const ok = downloadFile(txt, 'text/plain', `默言无声_会议记录_${effectiveRoomId}.txt`)
    if (ok) setShowExport(false)
  }, [chat.messages, voting.votes, voting.results, effectiveRoomId])

  const doExportChat = useCallback(() => {
    if (chat.messages.length === 0) { alert('暂无聊天记录'); return }
    const time = formatDateTime(new Date())
    const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>默言无声 - 聊天记录</title></head><body>
<h1>默言无声 - 聊天记录</h1><p>导出时间：${time}</p><hr/>
${chat.messages.map(m => `<div style="margin:8px 0"><strong>${m.senderName}</strong> <span style="color:#999;font-size:12px">${formatDateTime(new Date(m.timestamp))}</span><p>${escapeHtml(m.content)}</p></div>`).join('')}
</body></html>`
    const ok = downloadFile(html, 'text/html', `默言无声_聊天记录.html`)
    if (ok) setShowExport(false)
  }, [chat.messages])

  const doExportVotes = useCallback(() => {
    if (voting.votes.length === 0) { alert('暂无投票记录'); return }
    const time = formatDateTime(new Date())
    const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>默言无声 - 投票结果</title></head><body>
<h1>默言无声 - 投票结果</h1><p>导出时间：${time}</p><hr/>
${voting.votes.map(vote => {
  const vr = voting.results[vote.id] ?? []
  const total = vr.reduce((s, r) => s + r.count, 0)
  const modeLabel = vote.mode === 'real_name' ? '实名' : vote.mode === 'anonymous' ? '匿名' : '混合'
  return `<div style="margin:16px 0"><h2>${vote.title}</h2><p>模式：${modeLabel} | 总票数：${total}</p><ul>${vr.map(r => { const opt = vote.options.find(o => o.id === r.optionId); return `<li>${opt?.label ?? '?'}：${r.count} 票${r.voters ? `（${r.voters.join('、')}）` : ''}</li>` }).join('')}</ul></div>`
}).join('')}
</body></html>`
    const ok = downloadFile(html, 'text/html', `默言无声_投票结果.html`)
    if (ok) setShowExport(false)
  }, [voting.votes, voting.results])

  if (!isSupabaseConfigured()) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div className="panel" style={{ maxWidth: 500, width: '100%', textAlign: 'center' }}>
          <div className="panel-body" style={{ padding: 40 }}>
            <h2 style={{ marginBottom: 16 }}>需要配置 Supabase</h2>
            <p style={{ color: 'var(--ink-medium)', marginBottom: 24 }}>请在项目根目录创建 <code>.env</code> 文件，写入 Supabase 配置后重启。</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: viewportHeight, display: 'flex', flexDirection: 'column', background: 'var(--paper-light)' }}>
      {/* ===== 顶部导航 ===== */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: isMobile ? 3 : 12,
        padding: isMobile ? '4px 4px' : '6px 16px',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--paper-white)', flexShrink: 0,
        height: isMobile ? 38 : 44, overflow: 'hidden',
      }}>
        {/* Logo + 房间号 + 复制 */}
        <button className="btn btn-sm mobile-only"
          onClick={handleExit}
          style={{
            fontSize: '0.75rem', padding: '2px 5px', lineHeight: 1,
            color: 'var(--ink-light)', background: 'transparent', border: 'none',
            flexShrink: 0,
          }}>
          ✕
        </button>
        <h2 style={{ fontFamily: 'var(--font-title)', fontSize: isMobile ? '0.8rem' : '1.05rem', letterSpacing: '0.08em', cursor: 'pointer', flexShrink: 0 }}
          onClick={() => navigate('/')}>默言无声</h2>
        <span style={{
          fontSize: '0.65rem', color: 'var(--ink-light)', fontFamily: 'monospace',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          maxWidth: isMobile ? 56 : 'none',
        }}>{effectiveRoomId}</span>
        <button className="btn btn-sm btn-ghost" onClick={handleCopyLink}
          style={{ fontSize: '0.6rem', padding: '1px 4px', color: copied ? 'var(--bamboo-green)' : 'var(--ink-light)', flexShrink: 0 }}>
          {copied ? '✓' : '📋'}
        </button>

        <span className="desktop-only" style={{ fontSize: '0.7rem', color: 'var(--ink-medium)', opacity: 0.4 }}>|</span>
        <span className="desktop-only" style={{ fontSize: '0.75rem', color: 'var(--ink-medium)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{nickname}</span>

        <div style={{ flex: 1 }} />

        {/* 桌面端：语音 + 摄像头 + 匿名 + 导出 */}
        <div className="desktop-only" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className={`btn btn-sm ${audioCall.isEnabled ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => audioCall.isEnabled ? audioCall.stopAudio() : audioCall.startAudio()}
            style={{ fontSize: '0.75rem', padding: '3px 10px' }}>
            {audioCall.isEnabled ? '🎤 挂断' : '🎤 语音'}
          </button>
          {audioCall.isEnabled && (
            <button className={`btn btn-sm ${audioCall.isMuted ? 'btn-secondary' : 'btn-ghost'}`}
              onClick={audioCall.toggleMute}
              style={{ fontSize: '0.75rem', padding: '3px 10px', minWidth: 40 }}>
              {audioCall.isMuted ? '🔇 静音' : '🔊 麦克风'}
            </button>
          )}
          <button className={`btn btn-sm ${videoCall.isEnabled ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => videoCall.isEnabled ? videoCall.stopVideo() : handleStartVideo()}
            style={{ fontSize: '0.75rem', padding: '3px 10px' }}>
            {videoCall.isEnabled ? '🎥 关闭摄像头' : '🎥 摄像头'}
          </button>
          <button className={`btn btn-sm ${isAnonymous ? 'btn-primary' : 'btn-secondary'}`}
            onClick={toggleAnonymous}
            title={isAnonymous ? '当前为匿名模式，点击切换为实名' : '当前为实名模式，点击切换为匿名'}
            style={{ fontSize: '0.75rem', padding: '3px 10px' }}>
            {isAnonymous ? '🙈 匿名' : '👤 实名'}
          </button>
          <button className="btn btn-sm"
            onClick={() => { leaveRoom(); navigate('/') }}
            style={{ fontSize: '0.75rem', padding: '3px 10px', color: 'var(--paper-white)', background: 'var(--vermilion)', border: '1px solid var(--vermilion-dark)' }}>
            退出
          </button>

          <button className="btn btn-sm btn-ghost" onClick={doExportAllTxt}
            style={{ fontSize: '0.7rem', padding: '3px 8px', color: 'var(--bamboo-green)' }}>
            📄 保存记录
          </button>
        </div>

        {/* 移动端按钮行：🎤 🎥 🙈 🗳️ 📤 */}
        <div className="mobile-only" style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
          <button
            onClick={() => audioCall.isEnabled ? audioCall.toggleMute() : audioCall.startAudio()}
            style={{
              fontSize: '0.85rem', padding: '2px 5px', lineHeight: 1, border: 'none',
              background: audioCall.isEnabled ? 'var(--ink-blue)' : 'transparent',
              color: audioCall.isEnabled ? '#fff' : 'var(--ink-medium)',
              borderRadius: 'var(--radius-sm)', cursor: 'pointer',
            }}>
            {audioCall.isEnabled ? (audioCall.isMuted ? '🔇' : '🎤') : '🎤'}
          </button>
          {audioCall.isEnabled && (
            <button onClick={audioCall.stopAudio}
              style={{
                fontSize: '0.6rem', padding: '2px 3px', border: 'none',
                background: 'transparent', color: 'var(--vermilion)',
                borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              }}>
              挂断
            </button>
          )}
          <button
            onClick={() => videoCall.isEnabled ? videoCall.stopVideo() : handleStartVideo()}
            style={{
              fontSize: '0.85rem', padding: '2px 5px', lineHeight: 1, border: 'none',
              background: videoCall.isEnabled ? 'var(--ink-blue)' : 'transparent',
              color: videoCall.isEnabled ? '#fff' : 'var(--ink-medium)',
              borderRadius: 'var(--radius-sm)', cursor: 'pointer',
            }}>
            🎥
          </button>
          <button
            onClick={toggleAnonymous}
            style={{
              fontSize: '0.85rem', padding: '2px 5px', lineHeight: 1, border: 'none',
              background: isAnonymous ? 'var(--ink-blue)' : 'transparent',
              color: isAnonymous ? '#fff' : 'var(--ink-medium)',
              borderRadius: 'var(--radius-sm)', cursor: 'pointer',
            }}>
            {isAnonymous ? '🙈' : '👤'}
          </button>
          <button
            onClick={() => setShowVote(!showVote)}
            style={{
              fontSize: '0.85rem', padding: '2px 5px', lineHeight: 1, border: 'none',
              background: showVote ? 'var(--ink-blue)' : 'transparent',
              color: showVote ? '#fff' : 'var(--ink-medium)',
              borderRadius: 'var(--radius-sm)', cursor: 'pointer',
            }}>
            🗳️
          </button>
          {/* 导出 */}
          <button
            onClick={doExportAllTxt}
            style={{
              fontSize: '0.85rem', padding: '2px 5px', lineHeight: 1, border: 'none',
              background: 'transparent', color: 'var(--bamboo-green)',
              borderRadius: 'var(--radius-sm)', cursor: 'pointer',
            }}>
            📄
          </button>
        </div>

        <ConnectionStatus state={connectionState} />
      </header>

      {/* ===== 主体 ===== */}
      {isMobile ? (
        /* ----- 移动端：垂直布局 ----- */
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, padding: 4, overflow: 'hidden' }}>
          {/* 参与者横条 */}
          <div className="panel" style={{ flexShrink: 0, overflow: 'hidden' }}>
            <div style={{
              display: 'flex', gap: 4, padding: '4px 8px', overflowX: 'auto', whiteSpace: 'nowrap',
              scrollbarWidth: 'none', fontSize: '0.7rem',
            }}>
              {participants.length === 0 ? (
                <span style={{ color: 'var(--ink-light)' }}>暂无参与者</span>
              ) : participants.map((p) => (
                <span key={p.id} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                  background: p.id === userId ? 'rgba(44,95,110,0.1)' : 'var(--paper-dark)',
                  flexShrink: 0,
                }}>
                  <span style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: p.id === screenShare.sharerId ? 'var(--ink-blue)' : 'var(--ink-light)',
                    flexShrink: 0,
                  }} />
                  {p.name}
                  {p.id === screenShare.sharerId && <span style={{ fontSize: '0.6rem', color: 'var(--ink-blue)' }}>共享</span>}
                </span>
              ))}
            </div>
            {/* 移动端语音状态条 */}
            {audioCall.isEnabled && (
              <div style={{ padding: '2px 8px 4px 8px', borderTop: '1px solid var(--border-color)' }}>
                <VoiceControls audioUsers={audioCall.audioUsers} speakingUsers={audioCall.speakingUsers}
                  currentUserId={userId} participants={participants}
                  isEnabled={audioCall.isEnabled} isMuted={audioCall.isMuted} />
              </div>
            )}
          </div>

          {/* 屏幕共享 / 视频 — 仅在非空闲时显示 */}
          {(screenShare.shareMode !== 'idle' || (videoCall.isEnabled && videoCall.videoUsers.length > 0)) && (
            <div style={{ flexShrink: 0, maxHeight: screenShare.shareMode !== 'idle' ? '35vh' : '35vh' }}>
              {screenShare.shareMode !== 'idle' ? (
                <>
                  <ScreenShare shareMode={screenShare.shareMode} remoteStream={screenShare.remoteStream}
                    screenshotUrl={screenShare.screenshotUrl} uploadBps={screenShare.uploadBps}
                    isSharer={screenShare.sharerId === userId} sharerName={sharerName}
                    onStartShare={handleStartShare} onStopShare={screenShare.stopShare} />
                  {/* 移动端：共享控制按钮 */}
                  <div style={{
                    display: 'flex', gap: 4, padding: '4px 0',
                    justifyContent: 'center',
                  }}>
                    {screenShare.sharerId && screenShare.sharerId !== userId && (
                      <button className="btn btn-sm btn-ghost"
                        onClick={() => {
                          const sharer = participants.find(p => p.id === screenShare.sharerId)
                          if (sharer) {
                            broadcast({
                              id: generateId(),
                              type: MESSAGE_TYPES.SYSTEM,
                              senderId: userId,
                              senderName: '',
                              timestamp: Date.now(),
                              content: JSON.stringify({ _rejoin: { sharerId: screenShare.sharerId } }),
                            })
                          }
                        }}
                        style={{ fontSize: '0.65rem', padding: '2px 8px', color: 'var(--ink-blue)' }}>
                        重新连接共享
                      </button>
                    )}
                    {screenShare.sharerId === userId && (
                      <button className="btn btn-sm btn-secondary"
                        onClick={screenShare.stopShare}
                        style={{ fontSize: '0.65rem', padding: '2px 8px' }}>
                        停止共享
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: '33vh' }}>
                  <div className="panel-header" style={{ padding: '4px 8px', fontSize: '0.72rem' }}>
                    <span>视频 {videoCall.videoUsers.length}/{videoCall.remoteStreams.size + 1}</span>
                  </div>
                  <MobileVideoGrid
                    localStream={videoCall.localStream}
                    remoteStreams={videoCall.remoteStreams}
                    videoUsers={videoCall.videoUsers}
                    currentUserId={userId}
                    participants={participants}
                  />
                </div>
              )}
            </div>
          )}

          {/* 聊天 */}
          <ChatPanel messages={chat.messages} onSend={handleSendMessage} isAnonymous={isAnonymous} />

          {/* 投票（折叠） */}
          {showVote && (
            <div style={{ flexShrink: 0, maxHeight: '40vh' }}>
              <VotingPanel votes={voting.votes} results={voting.results}
                currentUserId={userId} currentUserName={nickname}
                onCreateVote={voting.createVote}
                onCastVote={(vid, oid) => voting.castVote(vid, oid, isAnonymous)}
                onEndVote={voting.endVote} isAnonymous={isAnonymous} />
            </div>
          )}

        </div>
      ) : (
        /* ----- 桌面端：水平布局 ----- */
        <div style={{ flex: 1, display: 'flex', gap: 8, padding: 8, overflow: 'hidden' }}>
          {/* 左侧：参与者列表 */}
          <div style={{ width: 130, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <ParticipantList participants={participants} currentUserId={userId} sharerId={screenShare.sharerId} />
            {audioCall.isEnabled && (
              <div className="panel" style={{ padding: '4px 8px' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--ink-light)', marginBottom: 2 }}>语音</div>
                <VoiceControls audioUsers={audioCall.audioUsers} speakingUsers={audioCall.speakingUsers}
                  currentUserId={userId} participants={participants}
                  isEnabled={audioCall.isEnabled} isMuted={audioCall.isMuted} />
              </div>
            )}
          </div>

          {/* 中间：屏幕共享 / 视频 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {screenShare.shareMode !== 'idle' ? (
              <ScreenShare shareMode={screenShare.shareMode} remoteStream={screenShare.remoteStream}
                screenshotUrl={screenShare.screenshotUrl} uploadBps={screenShare.uploadBps}
                isSharer={screenShare.sharerId === userId} sharerName={sharerName}
                onStartShare={handleStartShare} onStopShare={screenShare.stopShare} />
            ) : videoCall.isEnabled && videoCall.videoUsers.length > 0 ? (
              <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div className="panel-header" style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
                  <span>视频 {videoCall.videoUsers.length}/{videoCall.remoteStreams.size + 1}</span>
                  {!screenShare.sharerId && (
                    <button className="btn btn-sm btn-primary" onClick={handleStartShare}
                      style={{ fontSize: '0.7rem', padding: '2px 10px' }}>
                      共享屏幕
                    </button>
                  )}
                </div>
                <VideoGrid localStream={videoCall.localStream} remoteStreams={videoCall.remoteStreams}
                  videoUsers={videoCall.videoUsers} currentUserId={userId} participants={participants} />
              </div>
            ) : (
              <ScreenShare shareMode={screenShare.shareMode} remoteStream={screenShare.remoteStream}
                screenshotUrl={screenShare.screenshotUrl} uploadBps={screenShare.uploadBps}
                isSharer={screenShare.sharerId === userId} sharerName={sharerName}
                onStartShare={handleStartShare} onStopShare={screenShare.stopShare} />
            )}
          </div>

          {/* 右侧：聊天 + 投票 */}
          <div style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <ChatPanel messages={chat.messages} onSend={handleSendMessage} isAnonymous={isAnonymous} />
            <VotingPanel votes={voting.votes} results={voting.results}
              currentUserId={userId} currentUserName={nickname}
              onCreateVote={voting.createVote}
              onCastVote={(vid, oid) => voting.castVote(vid, oid, isAnonymous)}
              onEndVote={voting.endVote} isAnonymous={isAnonymous} />
          </div>
        </div>
      )}
      {/* ===== 退出确认弹窗 ===== */}
      {showExitConfirm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.45)',
        }} onClick={() => setShowExitConfirm(false)}>
          <div className="panel" style={{
            width: isMobile ? '85vw' : 340, maxWidth: 360,
            margin: 0, textAlign: 'center',
          }} onClick={e => e.stopPropagation()}>
            <div className="panel-body" style={{ padding: isMobile ? 28 : 32 }}>
              <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🍂</div>
              <h3 style={{ fontFamily: 'var(--font-title)', marginBottom: 8, fontSize: '1.1rem' }}>
                确认退出房间？
              </h3>
              <p style={{ color: 'var(--ink-medium)', fontSize: '0.85rem', marginBottom: 24, lineHeight: 1.6 }}>
                退出后将断开与房间的连接，<br/>如需再次加入请重新输入房间号。
              </p>
              <div style={{ display: 'flex', gap: 12 }}>
                <button className="btn btn-secondary" onClick={() => setShowExitConfirm(false)}
                  style={{ flex: 1, padding: '10px 0', fontSize: '0.85rem' }}>
                  取消
                </button>
                <button className="btn btn-primary" onClick={handleExit}
                  style={{ flex: 1, padding: '10px 0', fontSize: '0.85rem' }}>
                  确认退出
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <AudioRenderer streams={(() => {
        // 合并音频流：优先使用纯音频流，补充视频通话中的音频轨道
        // 避免同一用户的音频被双重播放（视频流和音频流来自同一麦克风）
        const allAudioStreams = new Map(audioCall.remoteStreams)
        videoCall.remoteStreams.forEach((stream, uid) => {
          if (!allAudioStreams.has(uid)) {
            allAudioStreams.set(uid, stream)
          }
        })
        return allAudioStreams
      })()} />
      <DebugOverlay />
    </div>
  )
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"')
}

function downloadFile(content: string, mime: string, filename: string): boolean {
  try {
    const blob = new Blob(['﻿' + content], { type: `${mime};charset=utf-8` })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    // Toast 提示
    showToast(`已下载: ${filename}`)
    setTimeout(() => {
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }, 800)
    return true
  } catch (err) {
    console.error('[Export] 下载失败:', err)
    alert('下载失败，请重试')
    return false
  }
}

// 简易 toast 提示
function showToast(msg: string) {
  const el = document.createElement('div')
  el.textContent = msg
  el.style.cssText = `
    position:fixed; bottom:24px; left:50%; transform:translateX(-50%); z-index:9999;
    background:#2c5f6e; color:#fff; padding:8px 20px; border-radius:6px;
    font-size:0.85rem; box-shadow:0 4px 12px rgba(0,0,0,0.25);
    animation: toastIn 0.3s ease;
  `
  document.body.appendChild(el)
  setTimeout(() => {
    el.style.opacity = '0'
    el.style.transition = 'opacity 0.3s'
    setTimeout(() => document.body.removeChild(el), 300)
  }, 2000)
}

/**
 * 针对移动端的视频网格组件
 * - 强制加上了 playsInline、muted、autoPlay 属性，解决 iOS Safari / 微信内置浏览器黑屏问题
 * - 手动调用 play() 以绕过自动播放策略
 */
function MobileVideoGrid({
  localStream,
  remoteStreams,
  videoUsers,
  currentUserId,
  participants,
}: {
  localStream: MediaStream | null
  remoteStreams: Map<string, MediaStream>
  videoUsers: Array<{ id: string; startedAt: number }>
  currentUserId: string
  participants: Array<{ id: string; name: string }>
}) {
  const getName = (id: string) => participants.find((p) => p.id === id)?.name ?? '未知'

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
        padding: 4,
        background: '#000',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      {/* 本地视频 */}
      {localStream && (
        <video
          autoPlay
          playsInline
          muted
          ref={(el) => {
            if (el) {
              el.srcObject = localStream
              el.play().catch(() => {
                // 自动播放被拒绝，静默处理
              })
            }
          }}
          style={{ width: '45%', maxHeight: 150, objectFit: 'cover' }}
        />
      )}

      {/* 远程视频 */}
      {Array.from(remoteStreams.entries()).map(([id, stream]) => (
        <video
          key={id}
          autoPlay
          playsInline
          ref={(el) => {
            if (el) {
              el.srcObject = stream
              el.play().catch(() => {
                // 自动播放被拒绝，静默处理
              })
            }
          }}
          style={{ width: '45%', maxHeight: 150, objectFit: 'cover' }}
        />
      ))}

      {/* 无视频占位 */}
      {!localStream && remoteStreams.size === 0 && (
        <span
          style={{
            color: '#fff',
            fontSize: '0.7rem',
            textAlign: 'center',
            width: '100%',
            padding: 8,
          }}
        >
          等待视频启动…
        </span>
      )}
    </div>
  )
}
