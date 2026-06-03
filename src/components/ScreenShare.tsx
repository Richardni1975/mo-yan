import type { ShareMode } from '../utils/types'
import { isScreenShareSupported } from '../utils/helpers'

interface Props {
  shareMode: ShareMode
  remoteStream: MediaStream | null
  screenshotUrl: string | null
  uploadBps: number
  isSharer: boolean
  sharerName: string | null
  onStartShare: () => void
  onStopShare: () => void
}

export function ScreenShare({
  shareMode, remoteStream, screenshotUrl, uploadBps,
  isSharer, sharerName, onStartShare, onStopShare,
}: Props) {
  const supported = isScreenShareSupported()

  return (
    <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="panel-header" style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
        {shareMode !== 'idle' && (
          <span style={{ fontSize: '0.7rem', color: 'var(--ink-light)' }}>
            {shareMode === 'webrtc' ? 'WebRTC' : '截图'} | {(uploadBps / 1_000_000).toFixed(1)} Mbps
          </span>
        )}
        {!isSharer && shareMode === 'idle' && (
          <button className="btn btn-sm btn-primary" onClick={onStartShare}
            disabled={!supported} style={{ fontSize: '0.7rem', padding: '2px 10px' }}>
            {!supported ? '不支持' : '共享屏幕'}
          </button>
        )}
        {isSharer && (
          <button className="btn btn-sm btn-secondary" onClick={onStopShare}
            style={{ fontSize: '0.7rem', padding: '2px 10px' }}>
            停止共享
          </button>
        )}
      </div>

      <div style={{
        flex: 1, minHeight: 0,
        background: 'var(--ink-darkest)', borderRadius: '0 0 var(--radius-sm) var(--radius-sm)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', position: 'relative',
      }}>
        {remoteStream ? (
          <video autoPlay playsInline
            ref={(el) => { if (el && remoteStream) el.srcObject = remoteStream }}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : screenshotUrl ? (
          <img src={screenshotUrl} alt="共享屏幕"
            style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--ink-light)', fontSize: '0.8rem' }}>
            {sharerName ? `${sharerName} 正在共享屏幕` : '暂无共享'}
          </div>
        )}

        {sharerName && (
          <span style={{
            position: 'absolute', bottom: 6, left: 6,
            padding: '1px 6px', background: 'rgba(0,0,0,0.55)',
            color: '#fff', fontSize: '0.7rem', borderRadius: 'var(--radius-sm)',
          }}>{sharerName}</span>
        )}
        {shareMode === 'screenshot' && (
          <span style={{
            position: 'absolute', top: 6, right: 6,
            padding: '1px 6px', background: 'rgba(192,57,43,0.8)',
            color: '#fff', fontSize: '0.65rem', borderRadius: 'var(--radius-sm)',
          }}>降级</span>
        )}
      </div>
    </div>
  )
}
