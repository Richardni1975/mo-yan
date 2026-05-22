import type { ConnectionState } from '../utils/types'

interface Props {
  state: ConnectionState
}

const labels: Record<ConnectionState, string> = {
  connected: '已连接',
  connecting: '重连中…',
  disconnected: '已断开',
}

export function ConnectionStatus({ state }: Props) {
  return (
    <div className="flex-center" style={{ gap: 6, fontSize: '0.75rem', color: 'var(--ink-light)' }}>
      <span className={`dot dot-${state}`} />
      <span>{labels[state]}</span>
    </div>
  )
}
