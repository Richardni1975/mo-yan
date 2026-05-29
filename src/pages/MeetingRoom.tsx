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
  const [nickname] = useState(() => {
    return (location.state as { nickname?: string })?.nickname ?? localStorage.getItem(STORAGE_KEYS.NICKNAME) ?? '用户'
  })
  const [userId] = useState(() => generateId())
  const [isAnonymous, setIsAnonymous] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.ANONYMOUS) === 'true'
  })
  const [participants, setParticipants] = useState<Array<{ id: string; name: string; isSharing: boolean }>>([])
  const [sharerName, setSharerName] = useState<string | null>(null)
  const [showExport, setShowExport] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)
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
  const chat = useChat({ userId, userName: nickname, broadcast })

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
          if (data._signal || data._shareStart || data._shareStop || data._shareMode) {
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

  // ===== 重新连接后恢复共享观看 =====
  useEffect(() => {
    if (screenShare.sharerId) return // 已连接共享者，无需恢复
    const activeSharer = participants.find((p) => p.isSharing && p.id !== userId)
    if (!activeSharer) return
    // 广播重新加入通知：共享者重建出站 peer，自己重建 viewer peer
    broadcast({
      id: generateId(),
      type: MESSAGE_TYPES.SYSTEM,
      senderId: userId,
      senderName: '',
      timestamp: Date.now(),
      content: JSON.stringify({ _rejoin: { sharerId: activeSharer.id } }),
    })
  }, [participants, userId, screenShare, broadcast])

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
    console.log('[墨言] 页面已加载。房间 ID:', roomId)
    window.addEventListener('error', (e) => {
      console.error('[墨言] 加载时未捕获错误:', e.error?.message ?? e.message)
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
  const doExportChat = useCallback(() => {
    if (chat.messages.length === 0) { alert('暂无聊天记录'); return }
    const time = formatDateTime(new Date())
    const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>墨言 - 聊天记录</title></head><body>
<h1>墨言 - 聊天记录</h1><p>导出时间：${time}</p><hr/>
${chat.messages.map(m => `<div style="margin:8px 0"><strong>${m.senderName}</strong> <span style="color:#999;font-size:12px">${formatDateTime(new Date(m.timestamp))}</span><p>${escapeHtml(m.content)}</p></div>`).join('')}
</body></html>`
    downloadFile(html, 'text/html', `墨言_聊天记录.html`)
    setShowExport(false)
  }, [chat.messages])

  const doExportVotes = useCallback(() => {
    if (voting.votes.length === 0) { alert('暂无投票记录'); return }
    const time = formatDateTime(new Date())
    const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>墨言 - 投票结果</title></head><body>
<h1>墨言 - 投票结果</h1><p>导出时间：${time}</p><hr/>
${voting.votes.map(vote => {
  const vr = voting.results[vote.id] ?? []
  const total = vr.reduce((s, r) => s + r.count, 0)
  const modeLabel = vote.mode === 'real_name' ? '实名' : vote.mode === 'anonymous' ? '匿名' : '混合'
  return `<div style="margin:16px 0"><h2>${vote.title}</h2><p>模式：${modeLabel} | 总票数：${total}</p><ul>${vr.map(r => { const opt = vote.options.find(o => o.id === r.optionId); return `<li>${opt?.label ?? '?'}：${r.count} 票${r.voters ? `（${r.voters.join('、')}）` : ''}</li>` }).join('')}</ul></div>`
}).join('')}
</body></html>`
    downloadFile(html, 'text/html', `墨言_投票结果.html`)
    setShowExport(false)
  }, [voting.votes, voting.results])

  // 点击外部关闭导出菜单
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setShowExport(false)
      }
    }
    if (showExport) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showExport])

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
        display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 12,
        padding: isMobile ? '4px 8px' : '6px 16px',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--paper-white)', flexShrink: 0,
        height: isMobile ? 36 : 44,
      }}>
        {/* Logo + 房间号 + 复制 */}
        <h2 style={{ fontFamily: 'var(--font-title)', fontSize: isMobile ? '0.9rem' : '1.05rem', letterSpacing: '0.15em', cursor: 'pointer', flexShrink: 0 }}
          onClick={() => navigate('/')}>墨言</h2>
        <span style={{ fontSize: '0.7rem', color: 'var(--ink-light)', fontFamily: 'monospace' }}>{effectiveRoomId}</span>
        <button className="btn btn-sm btn-ghost" onClick={handleCopyLink}
          style={{ fontSize: '0.6rem', padding: '1px 4px', color: copied ? 'var(--bamboo-green)' : 'var(--ink-light)', flexShrink: 0 }}>
          {copied ? '已复制' : '复制'}
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

          <div ref={exportRef} style={{ position: 'relative' }}>
            <button className="btn btn-sm btn-secondary" onClick={() => setShowExport(!showExport)}
              style={{ fontSize: '0.75rem', padding: '3px 10px' }}>
              导出
            </button>
            {showExport && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 100,
                background: 'var(--paper-white)', border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)', boxShadow: '0 2px 8px var(--shadow-color)',
                minWidth: 150, overflow: 'hidden',
              }}>
                <button onClick={doExportChat} style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px',
                  fontSize: '0.8rem', color: 'var(--ink-dark)', transition: 'background 0.15s',
                }} onMouseEnter={e => (e.target as HTMLElement).style.background = 'var(--paper-dark)'}
                  onMouseLeave={e => (e.target as HTMLElement).style.background = 'transparent'}>
                  导出聊天记录 (HTML)
                </button>
                <button onClick={doExportVotes} style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px',
                  fontSize: '0.8rem', color: 'var(--ink-dark)',
                }} onMouseEnter={e => (e.target as HTMLElement).style.background = 'var(--paper-dark)'}
                  onMouseLeave={e => (e.target as HTMLElement).style.background = 'transparent'}>
                  导出投票结果 (HTML)
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 移动端：语音 + 摄像头 + 匿名 + 投票 */}
        <div className="mobile-only" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className={`btn btn-sm ${audioCall.isEnabled ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => audioCall.isEnabled ? audioCall.toggleMute() : audioCall.startAudio()}
            style={{ fontSize: '0.65rem', padding: '2px 6px' }}>
            {audioCall.isEnabled ? (audioCall.isMuted ? '🔇' : '🎤') : '🎤'}
          </button>
          {audioCall.isEnabled && (
            <button className="btn btn-sm btn-ghost" onClick={audioCall.stopAudio}
              style={{ fontSize: '0.55rem', padding: '2px 4px', color: 'var(--vermilion)' }}>
              挂断
            </button>
          )}
          <button className={`btn btn-sm ${videoCall.isEnabled ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => videoCall.isEnabled ? videoCall.stopVideo() : handleStartVideo()}
            style={{ fontSize: '0.65rem', padding: '2px 6px' }}>
            {videoCall.isEnabled ? '🎥' : '🎥'}
          </button>
          <button className={`btn btn-sm ${isAnonymous ? 'btn-primary' : 'btn-secondary'}`}
            onClick={toggleAnonymous}
            style={{ fontSize: '0.65rem', padding: '2px 6px' }}>
            {isAnonymous ? '🙈' : '👤'}
          </button>
          <button className="btn btn-sm btn-ghost"
            onClick={() => setShowVote(!showVote)}
            style={{ fontSize: '0.65rem', padding: '2px 6px' }}>
            投票
          </button>
          <button className="btn btn-sm"
            onClick={handleExit}
            style={{ fontSize: '0.65rem', padding: '2px 8px', color: 'var(--paper-white)', background: 'var(--vermilion)', border: '1px solid var(--vermilion-dark)' }}>
            退出
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
                  <VideoGrid localStream={videoCall.localStream} remoteStreams={videoCall.remoteStreams}
                    videoUsers={videoCall.videoUsers} currentUserId={userId} participants={participants} />
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

          {/* 移动端底部退出按钮条 */}
          <div className="mobile-only" style={{
            flexShrink: 0, padding: '8px 4px', borderTop: '1px solid var(--border-color)',
            background: 'var(--paper-white)',
          }}>
            <button className="btn"
              onClick={() => setShowExitConfirm(true)}
              style={{
                width: '100%', padding: '10px 20px', fontSize: '0.85rem',
                color: 'var(--paper-white)', background: 'var(--vermilion)',
                border: '1px solid var(--vermilion-dark)', borderRadius: 'var(--radius-md)',
                letterSpacing: '0.1em',
              }}>
              退出房间
            </button>
          </div>
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

      <AudioRenderer streams={audioCall.remoteStreams} />
      <DebugOverlay />
    </div>
  )
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function downloadFile(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}
