import { useEffect, useRef, useState } from 'react'

const MAX_LOGS = 200

interface LogEntry {
  text: string
  time: string
}

// 全局日志数组，所有组件都可以直接 push
const globalLogs: LogEntry[] = []
let notifyReact: (() => void) | null = null

/** 供其他模块直接调用，推送调试日志到屏幕面板 */
export function pushDebugLog(text: string) {
  const entry: LogEntry = { text, time: new Date().toLocaleTimeString() }
  globalLogs.push(entry)
  if (globalLogs.length > MAX_LOGS) globalLogs.shift()
  notifyReact?.()
}

export function DebugOverlay() {
  const [visible, setVisible] = useState(false)
  const [, forceUpdate] = useState(0)

  useEffect(() => {
    notifyReact = () => forceUpdate(n => n + 1)
    return () => { notifyReact = null }
  }, [])

  return (
    <>
      <button
        onClick={() => setVisible(!visible)}
        style={{
          position: 'fixed', top: '50%', left: 10, transform: 'translateY(-50%)', zIndex: 99999,
          width: 36, height: 36, borderRadius: 8,
          background: visible ? 'rgba(239,68,68,0.9)' : 'rgba(0,0,0,0.7)',
          color: '#fff', border: 'none', cursor: 'pointer',
          fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'monospace',
        }}
        title={visible ? '关闭日志' : '显示调试日志'}
      >
        {visible ? '✕' : '🐛'}
      </button>

      {visible && (
        <div
          style={{
            position: 'fixed', top: 'calc(50% + 40px)', left: 10, zIndex: 99999,
            width: 'calc(100vw - 24px)', maxWidth: 520, maxHeight: '50vh',
            overflowY: 'auto',
            background: 'rgba(0,0,0,0.88)', color: '#0f0',
            fontFamily: 'monospace', fontSize: 11, lineHeight: 1.5,
            padding: '6px 8px', borderRadius: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, borderBottom: '1px solid #333', paddingBottom: 4 }}>
            <span style={{ color: '#888' }}>📋 调试日志 ({globalLogs.length})</span>
            <button
              onClick={() => { globalLogs.length = 0; forceUpdate(n => n + 1) }}
              style={{ background: 'none', border: 'none', color: '#f66', cursor: 'pointer', fontSize: 10 }}
            >清空</button>
          </div>
          {globalLogs.length === 0 && <div style={{ color: '#888' }}>等待日志...</div>}
          {globalLogs.map((entry, i) => (
            <div key={i}>{entry.time} {entry.text}</div>
          ))}
        </div>
      )}
    </>
  )
}
