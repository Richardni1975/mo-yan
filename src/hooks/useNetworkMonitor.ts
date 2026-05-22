import { useCallback, useRef, useState } from 'react'
import { BANDWIDTH_DOWNGRADE_THRESHOLD, BANDWIDTH_DOWNGRADE_SECONDS } from '../utils/constants'
import type { BandwidthStats } from '../utils/types'

interface UseNetworkMonitorReturn {
  /** 当前估测的上传带宽（bps） */
  uploadBps: number
  /** 是否应降级为截图模式 */
  shouldDegrade: boolean
  /** 开始监控指定 RTCPeerConnection */
  startMonitoring: (pc: RTCPeerConnection) => void
  /** 停止监控 */
  stopMonitoring: () => void
}

export function useNetworkMonitor(): UseNetworkMonitorReturn {
  const [uploadBps, setUploadBps] = useState(0)
  const [shouldDegrade, setShouldDegrade] = useState(false)
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const degradeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const belowThresholdRef = useRef(false)

  const startMonitoring = useCallback((pc: RTCPeerConnection) => {
    // 用 Connection API 做参考（Chrome）
    const conn = (navigator as { connection?: { downlink: number; rtt: number } }).connection
    if (conn) {
      setUploadBps(conn.downlink * 1_000_000) // 下行带宽作为上行参考
    }

    // 定期通过 getStats 获取实际上行速率
    if (statsIntervalRef.current) clearInterval(statsIntervalRef.current)
    statsIntervalRef.current = setInterval(async () => {
      try {
        const stats = await pc.getStats()
        let sendingBps = 0
        stats.forEach((report) => {
          if (report.type === 'outbound-rtp' && report.kind === 'video') {
            const bytesSent = report.bytesSent ?? 0
            const timestamp = report.timestamp ?? 0
            // Use the accumulated bytes to calculate rate
            // simple-peer / getStats reports values differently across browsers
            sendingBps = report.targetBitrate ?? report.bitrate ?? 0
            if (!sendingBps && report.bytesSent && report.timestamp) {
              sendingBps = (report.bytesSent * 8) / 1_000_000 // rough Mbps estimate
            }
          }
        })

        if (sendingBps > 0) {
          setUploadBps(sendingBps)
          const isBelow = sendingBps < BANDWIDTH_DOWNGRADE_THRESHOLD

          if (isBelow && !belowThresholdRef.current) {
            // 首次低于阈值，开始计时
            belowThresholdRef.current = true
            degradeTimerRef.current = setTimeout(() => {
              setShouldDegrade(true)
            }, BANDWIDTH_DOWNGRADE_SECONDS * 1000)
          } else if (!isBelow) {
            belowThresholdRef.current = false
            if (degradeTimerRef.current) {
              clearTimeout(degradeTimerRef.current)
              degradeTimerRef.current = null
            }
            setShouldDegrade(false)
          }
        }
      } catch {
        // getStats may fail if peer connection is closed
      }
    }, 2000) // 每 2 秒检查一次
  }, [])

  const stopMonitoring = useCallback(() => {
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current)
      statsIntervalRef.current = null
    }
    if (degradeTimerRef.current) {
      clearTimeout(degradeTimerRef.current)
      degradeTimerRef.current = null
    }
    belowThresholdRef.current = false
    setShouldDegrade(false)
    setUploadBps(0)
  }, [])

  return { uploadBps, shouldDegrade, startMonitoring, stopMonitoring }
}
