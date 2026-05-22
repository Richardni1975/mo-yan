import type { MESSAGE_TYPES, VOTE_MODES } from './constants'

// ===== Message Types =====

export interface BaseMessage {
  id: string
  type: string
  senderId: string
  senderName: string
  timestamp: number
}

export interface ChatMessage extends BaseMessage {
  type: typeof MESSAGE_TYPES.CHAT
  content: string
  isAnonymous: boolean
}

export interface SignalMessage extends BaseMessage {
  type: typeof MESSAGE_TYPES.SIGNAL
  signalType: 'offer' | 'answer' | 'ice-candidate' | 'screen-stopped'
  targetId: string
  signal: unknown
}

export interface SystemMessage extends BaseMessage {
  type: typeof MESSAGE_TYPES.SYSTEM
  content: string
}

export interface ScreenshotMessage extends BaseMessage {
  type: typeof MESSAGE_TYPES.SCREENSHOT
  data: string // base64 JPEG
  frameSeq: number
}

export type RoomMessage = ChatMessage | SignalMessage | SystemMessage | ScreenshotMessage

// ===== Participant =====

export interface Participant {
  id: string
  name: string
  isSharing: boolean
  isAnonymous: boolean
  joinedAt: number
}

// ===== Voting =====

export type VoteMode = (typeof VOTE_MODES)[keyof typeof VOTE_MODES]

export interface VoteOption {
  id: string
  label: string
}

export interface Vote {
  id: string
  title: string
  options: VoteOption[]
  mode: VoteMode
  creatorId: string
  isActive: boolean
  createdAt: number
}

export interface VoteResult {
  optionId: string
  count: number
  voters?: string[] // 仅在实名模式下填充
}

// ===== Screen Share =====

export type ShareMode = 'webrtc' | 'screenshot' | 'idle'

// ===== Audio Call =====

export interface AudioUser {
  id: string
  muted: boolean
  speaking: boolean
  startedAt: number
}

// ===== Connection =====

export type ConnectionState = 'connected' | 'connecting' | 'disconnected'

// ===== Room =====

export interface RoomInfo {
  roomId: string
  participantCount: number
  createdAt: number
}

// ===== Bandwidth Stats =====

export interface BandwidthStats {
  uploadBps: number
  downloadBps: number
  rtt: number
  timestamp: number
}
