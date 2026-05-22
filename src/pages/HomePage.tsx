import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { generateRoomCode, isWeChatBrowser } from '../utils/helpers'
import { STORAGE_KEYS } from '../utils/constants'

export function HomePage() {
  const navigate = useNavigate()
  const [nickname, setNickname] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [error, setError] = useState('')
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640)

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 读取本地存储的昵称
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.NICKNAME)
    if (saved) setNickname(saved)
  }, [])

  const handleCreate = () => {
    if (!nickname.trim()) {
      setError('请先输入昵称')
      return
    }
    const code = generateRoomCode()
    localStorage.setItem(STORAGE_KEYS.NICKNAME, nickname.trim())
    navigate(`/room/${code}`, { state: { nickname: nickname.trim() } })
  }

  const handleJoin = () => {
    if (!nickname.trim()) {
      setError('请先输入昵称')
      return
    }
    if (!joinCode.trim()) {
      setError('请输入房间号')
      return
    }
    localStorage.setItem(STORAGE_KEYS.NICKNAME, nickname.trim())
    navigate(`/room/${joinCode.trim().toUpperCase()}`, { state: { nickname: nickname.trim() } })
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: isMobile ? 24 : 40,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* 水墨装饰 - 远山 */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: isMobile ? 180 : 300,
          background: `
            radial-gradient(ellipse 120% 100% at 10% 110%, rgba(44,95,110,0.08) 0%, transparent 70%),
            radial-gradient(ellipse 100% 100% at 30% 100%, rgba(26,26,26,0.04) 0%, transparent 60%),
            radial-gradient(ellipse 80% 80% at 70% 100%, rgba(44,95,110,0.06) 0%, transparent 60%),
            radial-gradient(ellipse 140% 100% at 90% 110%, rgba(26,26,26,0.05) 0%, transparent 70%)
          `,
          pointerEvents: 'none',
        }}
      />

      {/* 墨点装饰 - 移动端隐藏 */}
      {!isMobile && (
        <>
          <div className="ink-dot" style={{ width: 200, height: 200, top: '10%', right: '15%', opacity: 0.3 }} />
          <div className="ink-dot" style={{ width: 120, height: 120, bottom: '20%', left: '10%', opacity: 0.2 }} />
        </>
      )}

      {/* Logo 区域 */}
      <div style={{ textAlign: 'center', marginBottom: isMobile ? 40 : 60, zIndex: 1 }}>
        <h1
          style={{
            fontFamily: 'var(--font-title)',
            fontSize: isMobile ? '2.8rem' : '4rem',
            fontWeight: 900,
            color: 'var(--ink-darkest)',
            letterSpacing: '0.3em',
            marginBottom: 12,
            userSelect: 'none',
          }}
        >
          墨言
        </h1>
        <p style={{ color: 'var(--ink-medium)', fontSize: isMobile ? '0.85rem' : '1rem', letterSpacing: '0.1em' }}>
          多人实时沟通 · 屏幕共享 · 匿名讨论
        </p>
      </div>

      {/* 操作区 */}
      <div
        style={{
          zIndex: 1,
          width: '100%',
          maxWidth: 400,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {/* 微信浏览器提示 */}
        {isWeChatBrowser() && (
          <div style={{
            padding: '12px 16px',
            background: '#fff3cd',
            border: '1px solid #ffc107',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.8rem',
            color: '#856404',
            lineHeight: 1.5,
            textAlign: 'left',
          }}>
            <strong>⚠ 检测到微信内置浏览器</strong><br />
            微信不支持视频通话功能，请点击右上角 <strong>···</strong>，选择「在浏览器中打开」。
          </div>
        )}

        {/* 昵称 */}
        <div>
          <input
            className="input-underline"
            value={nickname}
            onChange={(e) => { setNickname(e.target.value); setError('') }}
            placeholder="输入你的昵称"
            style={{ fontSize: isMobile ? '0.9rem' : '1rem', padding: '10px 4px', textAlign: 'center' }}
          />
        </div>

        {/* 创建房间 */}
        <button
          className="btn btn-primary"
          onClick={handleCreate}
          style={{ width: '100%', padding: isMobile ? '10px 20px' : '12px 24px', fontSize: isMobile ? '0.9rem' : '1rem' }}
        >
          创建房间
        </button>

        {/* 分隔线 */}
        <div className="flex-center" style={{ gap: 16, color: 'var(--ink-light)', fontSize: '0.85rem' }}>
          <div className="separator" style={{ flex: 1, margin: 0 }} />
          <span>或</span>
          <div className="separator" style={{ flex: 1, margin: 0 }} />
        </div>

        {/* 加入房间 */}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input-underline"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            placeholder="输入房间号"
            style={{ fontSize: isMobile ? '0.85rem' : '1rem', padding: '10px 4px', textAlign: 'center', letterSpacing: '0.15em', flex: 1 }}
            maxLength={6}
          />
          <button className="btn btn-secondary" onClick={handleJoin} style={{ flexShrink: 0, padding: isMobile ? '8px 16px' : undefined }}>
            加入
          </button>
        </div>

        {/* 错误提示 */}
        {error && (
          <p style={{ color: 'var(--vermilion)', fontSize: '0.85rem', textAlign: 'center' }}>
            {error}
          </p>
        )}
      </div>

      {/* 底部落款 */}
      <div
        style={{
          position: 'absolute',
          bottom: isMobile ? 12 : 20,
          zIndex: 1,
          fontSize: isMobile ? '0.7rem' : '0.75rem',
          color: 'var(--ink-light)',
          fontFamily: 'var(--font-title)',
        }}
      >
        墨言 · 以墨会言
      </div>
    </div>
  )
}
