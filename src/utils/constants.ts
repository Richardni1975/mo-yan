/** 共享 ICE 服务器配置（STUN + TURN 中继） */
export const ICE_SERVERS: RTCIceServer[] = [
  // Google STUN（NAT 打洞）
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: ['stun:stun2.l.google.com:19302', 'stun:stun3.l.google.com:19302'] },
  { urls: ['stun:stun4.l.google.com:19302'] },
  // 免费 TURN 中继 #1 — TCP 端口，防火墙友好
  {
    urls: [
      'turn:openrelay.metered.ca:443?transport=tcp',
      'turns:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  // 免费 TURN 中继 #2 — UDP 端口
  {
    urls: [
      'turn:openrelay.metered.ca:80?transport=udp',
      'turn:openrelay.metered.ca:3478?transport=udp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
]

/** 房间最大参与者数量 */
export const MAX_PARTICIPANTS = 20

/** 心跳间隔（毫秒） */
export const HEARTBEAT_INTERVAL = 30000

/** 心跳超时（毫秒）——超过此时间未收到心跳视为离线 */
export const HEARTBEAT_TIMEOUT = 60000

/** 断线重连指数退避初始间隔（毫秒） */
export const RECONNECT_BASE_DELAY = 1000

/** 断线重连最大间隔（毫秒） */
export const RECONNECT_MAX_DELAY = 30000

/** 单条聊天消息最大字符数（防止大文本阻塞广播通道） */
export const MAX_CHAT_LENGTH = 4000

/** 聊天内存中保留的最大消息数（超出释放，但全量存于 Supabase） */
export const MAX_CACHED_MESSAGES = 500

/** 虚拟滚动每项固定高度（px），用于快速估算滚动容器尺寸 */
export const VIRTUAL_ITEM_HEIGHT = 72

/** 屏幕共享：默认帧率上限 */
export const SCREENSHARE_MAX_FPS = 2

/** 屏幕共享：带宽充足时的目标帧率 */
export const SCREENSHARE_HIGH_FPS = 2

/** 屏幕共享：带宽不足时降级帧率 */
export const SCREENSHARE_LOW_FPS = 1

/** 屏幕共享：静止时帧率（停止上传） */
export const SCREENSHARE_IDLE_FPS = 0

/** 脏矩形检测：变化像素占比阈值，高于此值切换为全帧模式 */
export const DIRTY_RECT_THRESHOLD = 0.15

/** 截图 JPEG 质量（降级模式） */
export const SCREENSHOT_QUALITY = 0.6

/** 截图最大分辨率 */
export const SCREENSHOT_MAX_WIDTH = 1280
export const SCREENSHOT_MAX_HEIGHT = 720

/** 带宽降级：触发降级的上传码率阈值（bps） */
export const BANDWIDTH_DOWNGRADE_THRESHOLD = 2_000_000 // 2 Mbps

/** 带宽降级：持续低于阈值多少秒后触发降级 */
export const BANDWIDTH_DOWNGRADE_SECONDS = 5

/** 输入框防抖间隔（毫秒） */
export const INPUT_DEBOUNCE_MS = 300

/** 视频通话：最多显示视频的人数 */
export const VIDEO_MAX_PARTICIPANTS = 4

/** 视频通话：摄像头采集宽度 */
export const VIDEO_CAMERA_WIDTH = 640

/** 视频通话：摄像头采集高度 */
export const VIDEO_CAMERA_HEIGHT = 360

/** 视频通话：摄像头帧率 */
export const VIDEO_CAMERA_FPS = 15

/** 语音通话：最多同时发言人数 */
export const AUDIO_MAX_SPEAKERS = 6
/** 语音通话：说话音量检测阈值（RMS 归一化值），高于此值视为在说话 */
export const AUDIO_VAD_THRESHOLD = 0.025
/** 语音通话：VAD 检测间隔（毫秒） */
export const AUDIO_VAD_INTERVAL = 300
/** 语音通话：静音持续多久（毫秒）后取消 speaking 状态 */
export const AUDIO_VAD_IDLE_MS = 1500

/** Supabase Realtime 频道名前缀 */
export const CHANNEL_PREFIX = 'room:'

/** 消息类型枚举 */
export const MESSAGE_TYPES = {
  CHAT: 'chat',
  SIGNAL: 'signal',
  SYSTEM: 'system',
  SCREENSHOT: 'screenshot',
} as const

/** 投票模式 */
export const VOTE_MODES = {
  REAL_NAME: 'real_name',
  ANONYMOUS: 'anonymous',
  MIXED: 'mixed',
} as const

/** LocalStorage key */
export const STORAGE_KEYS = {
  NICKNAME: 'mo_yan_nickname',
  ANONYMOUS: 'mo_yan_anonymous',
  USER_ID: 'mo_yan_user_id',
  REAL_NAME: 'mo_yan_real_name',
  PROFILE_SYNCED: 'mo_yan_profile_synced',
} as const
