import { useEffect, useRef } from 'react'

/**
 * 隐藏的音频播放器：将远程 WebRTC 音频流挂载到 <audio> 元素
 * 这样才能真正通过扬声器播放出来
 */
export function AudioRenderer({ streams }: { streams: Map<string, MediaStream> }) {
  return (
    <div style={{ display: 'none' }}>
      {Array.from(streams.entries()).map(([uid, stream]) => (
        <AudioPlayer key={uid} stream={stream} />
      ))}
    </div>
  )
}

function AudioPlayer({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream
    }
  }, [stream])

  return <audio ref={ref} autoPlay playsInline />
}
