interface Props {
  isAnonymous: boolean
  onToggleAnonymous: () => void
}

export function SettingsPanel({ isAnonymous, onToggleAnonymous }: Props) {
  return (
    <div className="panel" style={{ width: 260 }}>
      <div className="panel-header">
        <span>设置</span>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* 匿名模式开关 */}
        <div className="flex-between">
          <div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>匿名模式</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--ink-light)' }}>
              开启后新消息显示为「momo」
            </div>
          </div>
          <button
            onClick={onToggleAnonymous}
            style={{
              width: 44,
              height: 24,
              borderRadius: 12,
              border: 'none',
              background: isAnonymous ? 'var(--ink-blue)' : 'var(--border-color)',
              position: 'relative',
              cursor: 'pointer',
              transition: 'background var(--transition-fast)',
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: 2,
                left: isAnonymous ? 22 : 2,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: '#fff',
                transition: 'left var(--transition-fast)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
              }}
            />
          </button>
        </div>

        {isAnonymous && (
          <div
            style={{
              padding: '8px 12px',
              background: 'var(--paper-dark)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.8rem',
              color: 'var(--ink-medium)',
            }}
          >
            你的昵称将隐藏，其他参与者看到你的消息显示为「momo」
          </div>
        )}
      </div>
    </div>
  )
}
