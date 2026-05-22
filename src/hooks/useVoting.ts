import { useCallback, useState } from 'react'
import { generateId } from '../utils/helpers'
import { MESSAGE_TYPES } from '../utils/constants'
import type { RoomMessage, Vote, VoteMode, VoteOption, VoteResult } from '../utils/types'

interface UseVotingOptions {
  userId: string
  userName: string
  broadcast: (msg: RoomMessage) => void
}

// 内部投票消息
interface VoteCreateMessage {
  type: 'vote-create'
  vote: Vote
  senderId: string
  timestamp: number
}

interface VoteActionMessage {
  type: 'vote-cast'
  voteId: string
  voterId: string
  voterName: string
  optionId: string
  isAnonymous: boolean
  timestamp: number
}

interface VoteEndMessage {
  type: 'vote-end'
  voteId: string
  senderId: string
}

type VoteBusMessage = VoteCreateMessage | VoteActionMessage | VoteEndMessage & { _tag: 'vote' }

interface UseVotingReturn {
  votes: Vote[]
  results: Record<string, VoteResult[]>
  createVote: (title: string, options: string[], mode: VoteMode) => void
  castVote: (voteId: string, optionId: string, isAnonymous: boolean) => void
  endVote: (voteId: string) => void
  handleVoteMessage: (msg: RoomMessage) => void
}

export function useVoting({ userId, userName, broadcast }: UseVotingOptions): UseVotingReturn {
  const [votes, setVotes] = useState<Vote[]>([])
  const [results, setResults] = useState<Record<string, VoteResult[]>>({})
  // 记录每个用户每项投票的选项
  const [votesCast, setVotesCast] = useState<Record<string, Record<string, string>>>({})

  const createVote = useCallback((title: string, options: string[], mode: VoteMode) => {
    const vote: Vote = {
      id: generateId(),
      title,
      options: options.map((label) => ({ id: generateId(), label })),
      mode,
      creatorId: userId,
      isActive: true,
      createdAt: Date.now(),
    }

    const initialResults: VoteResult[] = vote.options.map((opt) => ({
      optionId: opt.id,
      count: 0,
      voters: mode === 'real_name' ? [] : undefined,
    }))

    setVotes((prev) => [...prev, vote])
    setResults((prev) => ({ ...prev, [vote.id]: initialResults }))

    // 广播创建投票（作为系统消息）
    const sysMsg: RoomMessage = {
      id: generateId(),
      type: MESSAGE_TYPES.SYSTEM,
      senderId: userId,
      senderName: userName,
      timestamp: Date.now(),
      content: `${userName} 发起了投票：「${title}」`,
    }
    broadcast(sysMsg)

    // 广播投票数据（仅用于同步，暂用系统消息扩展）
    broadcast({
      ...sysMsg,
      content: JSON.stringify({ _vote: vote, _results: initialResults }),
    } as RoomMessage)
  }, [userId, userName, broadcast])

  const castVote = useCallback((voteId: string, optionId: string, isAnonymous: boolean) => {
    const vote = votes.find((v) => v.id === voteId)
    if (!vote || !vote.isActive) return

    // 检查是否已投过
    if (votesCast[voteId]?.[userId]) return

    setResults((prev) => {
      const updated = { ...prev }
      const voteResults = updated[voteId]?.map((r) => {
        if (r.optionId === optionId) {
          return {
            ...r,
            count: r.count + 1,
            voters: r.voters ? [...r.voters, isAnonymous ? 'momo' : userName] : undefined,
          }
        }
        return r
      })
      updated[voteId] = voteResults ?? []
      return updated
    })

    setVotesCast((prev) => ({
      ...prev,
      [voteId]: { ...prev[voteId], [userId]: optionId },
    }))

    // 广播投票
    const sysMsg: RoomMessage = {
      id: generateId(),
      type: MESSAGE_TYPES.SYSTEM,
      senderId: userId,
      senderName: userName,
      timestamp: Date.now(),
      content: JSON.stringify({
        _voteCast: { voteId, optionId, isAnonymous, voterName: userName },
        _results: results,
      }),
    }
    broadcast(sysMsg)
  }, [votes, userId, userName, broadcast, results, votesCast])

  const endVote = useCallback((voteId: string) => {
    setVotes((prev) =>
      prev.map((v) => (v.id === voteId ? { ...v, isActive: false } : v))
    )

    const sysMsg: RoomMessage = {
      id: generateId(),
      type: MESSAGE_TYPES.SYSTEM,
      senderId: userId,
      senderName: userName,
      timestamp: Date.now(),
      content: JSON.stringify({ _voteEnd: { voteId } }),
    }
    broadcast(sysMsg)
  }, [userId, userName, broadcast])

  const handleVoteMessage = useCallback((msg: RoomMessage) => {
    if (msg.type !== MESSAGE_TYPES.SYSTEM) return
    const content = msg.content

    try {
      const parsed = JSON.parse(content)

      if (parsed._vote) {
        setVotes((prev) => {
          if (prev.some((v) => v.id === parsed._vote.id)) return prev
          return [...prev, parsed._vote]
        })
        if (parsed._results) {
          setResults((prev) => ({ ...prev, [parsed._vote.id]: parsed._results }))
        }
      } else if (parsed._voteCast) {
        const { voteId, optionId } = parsed._voteCast
        setResults((prev) => {
          const updated = { ...prev }
          const voteResults = updated[voteId]?.map((r) => {
            if (r.optionId === optionId) {
              return { ...r, count: r.count + 1 }
            }
            return r
          })
          updated[voteId] = voteResults ?? []
          return updated
        })
      } else if (parsed._voteEnd) {
        setVotes((prev) =>
          prev.map((v) => (v.id === parsed._voteEnd.voteId ? { ...v, isActive: false } : v))
        )
      }
    } catch {
      // not a vote message, ignore
    }
  }, [])

  return { votes, results, createVote, castVote, endVote, handleVoteMessage }
}
