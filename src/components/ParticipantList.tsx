import type { Participant } from '../utils/types'

interface Props {
  participants: Array<{ id: string; name: string; isSharing: boolean }>
  currentUserId: string
  sharerId: string | null
}

export function ParticipantList({ participants, currentUserId, sharerId }: Props) {
  return (
    <div className="panel" style={{ width: 130, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ padding: '6px 10px', fontSize: '0.78rem' }}>
        <span>参与者</span>
        <span style={{ fontSize: '0.68rem', color: 'var(--ink-light)' }}>
          {participants.length}/20
        </span>
      </div>
      <div className="panel-body" style={{ padding: '4px 0', flex: 1, overflowY: 'auto' }}>
        {participants.length === 0 ? (
          <p style={{ padding: '12px 10px', textAlign: 'center', color: 'var(--ink-light)', fontSize: '0.75rem' }}>
            暂无
          </p>
        ) : (
          <ul>
            {participants.map((p) => (
              <li key={p.id} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 10px', fontSize: '0.75rem',
                background: p.id === currentUserId ? 'rgba(44,95,110,0.06)' : undefined,
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: 'var(--ink-dark)', opacity: 0.5, flexShrink: 0,
                }} />
                <span style={{
                  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {p.name}
                </span>
                {p.id === sharerId && (
                  <span style={{ fontSize: '0.6rem', color: 'var(--ink-blue)' }}>共享</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
