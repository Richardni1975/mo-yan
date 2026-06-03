import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { generateRoomCode, isWeChatBrowser } from '../utils/helpers'
import { STORAGE_KEYS } from '../utils/constants'
import {
  saveProfileLocally,
  loadProfileLocally,
  broadcastProfile,
  listenForProfileUpdates,
  isSupabaseConfigured,
} from '../utils/supabase'

export function HomePage() {
  const navigate = useNavigate()
  const [realName, setRealName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [error, setError] = useState('')
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle')
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640)

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 读取本地存储的真实姓名
  useEffect(() => {
    const profile = loadProfileLocally()
    if (profile.realName) setRealName(profile.realName)
  }, [])

  // 监听其他设备同步过来的真实姓名
  useEffect(() => {
    const unsubscribe = listenForProfileUpdates((data) => {
      // 如果广播的用户ID与当前设备相同，则更新本地
      const localUserId = localStorage.getItem(STORAGE_KEYS.USER_ID)
      if (data.userId !== localUserId) return
      if (data.realName) {
        setRealName(data.realName)
        saveProfileLocally(data.nickname, data.realName)
      }
    })
    return unsubscribe
  }, [])

  // 保存真实姓名并同步到云端
  const handleSaveRealName = () => {
    if (!realName.trim()) {
      setError('请输入真实姓名')
      return
    }
    setSyncStatus('syncing')
    
    // 保存本地（用真实姓名作为昵称，去掉重复输入）
    saveProfileLocally(realName.trim(), realName.trim())
    
    // 广播到 Supabase（其他设备会收到同步）
    if (isSupabaseConfigured()) {
      broadcastProfile(realName.trim(), realName.trim())
      setSyncStatus('synced')
    } else {
      setSyncStatus('synced')
    }
    
    setTimeout(() => setSyncStatus('idle'), 2000)
  }

  const handleCreate = () => {
    const name = realName.trim() || '用户'
    if (!realName.trim()) {
      setError('请输入姓名')
      return
    }
    const code = generateRoomCode()
    // 保存姓名
    saveProfileLocally(name, name)
    navigate(`/room/${code}`, {
      state: { nickname: name, realName: name },
    })
  }

  const handleJoin = () => {
    const name = realName.trim() || '用户'
    if (!realName.trim()) {
      setError('请输入姓名')
      return
    }
    if (!joinCode.trim()) {
      setError('请输入房间号')
      return
    }
    // 保存姓名
    saveProfileLocally(name, name)
    navigate(`/room/${joinCode.trim().toUpperCase()}`, {
      state: { nickname: name, realName: name },
    })
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
      <div style={{ textAlign: 'center', marginBottom: isMobile ? 30 : 40, zIndex: 1 }}>
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
          默言无声
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
          gap: 12,
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

        {/* 真实姓名 */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <input
              className="input-underline"
              value={realName}
              onChange={(e) => { setRealName(e.target.value); setError('') }}
              placeholder="输入真实姓名（登录后显示为此名）"
              style={{ fontSize: isMobile ? '0.9rem' : '1rem', padding: '10px 4px', textAlign: 'center' }}
            />
          </div>
          <button
            className="btn btn-sm"
            onClick={handleSaveRealName}
            disabled={syncStatus === 'syncing'}
            style={{
              flexShrink: 0,
              padding: isMobile ? '6px 10px' : '6px 14px',
              fontSize: '0.75rem',
              color: syncStatus === 'synced' ? 'var(--bamboo-green)' : 'var(--ink-blue)',
              border: '1px solid',
              borderColor: syncStatus === 'synced' ? 'var(--bamboo-green)' : 'var(--ink-blue)',
              background: syncStatus === 'synced' ? 'rgba(143,188,143,0.1)' : 'transparent',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {syncStatus === 'syncing' ? '⏳ 同步中...' :
             syncStatus === 'synced' ? '✓ 已同步' :
             syncStatus === 'error' ? '✗ 同步失败' : '保存'}
          </button>
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
        默言无声 · 静默而谈
      </div>
    </div>
  )
}
