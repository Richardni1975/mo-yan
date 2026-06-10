import { useCallback, useEffect, useRef, useState } from 'react'
import { generateId } from '../utils/helpers'
import { MESSAGE_TYPES } from '../utils/constants'
import { supabase, isSupabaseConfigured } from '../utils/supabase'
import type { RoomMessage, Vote, VoteMode, VoteOption, VoteResult } from '../utils/types'

const TABLE_NAME = 'room_votes'
const LS_PREFIX = 'mo_yan_votes_'

function lsKey(roomId: string) { return LS_PREFIX + roomId }

interface VoteState {
  votes: Vote[]
  results: Record<string, VoteResult[]>
  votesCast: Record<string, Record<string, string>>
}

function saveLocal(roomId: string, state: VoteState) {
  try { localStorage.setItem(lsKey(roomId), JSON.stringify(state)) } catch {}
}
function loadLocal(roomId: string): VoteState | null {
  try {
    const raw = localStorage.getItem(lsKey(roomId))
    return raw ? JSON.parse(raw) as VoteState : null
  } catch { return null }
}

interface UseVotingOptions {
  userId: string
  userName: string
  roomId: string
  broadcast: (msg: RoomMessage) => void
}

interface UseVotingReturn {
  votes: Vote[]
  results: Record<string, VoteResult[]>
  createVote: (title: string, options: string[], mode: VoteMode) => void
  castVote: (voteId: string, optionId: string, isAnonymous: boolean) => void
  endVote: (voteId: string) => void
  handleVoteMessage: (msg: RoomMessage) => void
}

export function useVoting({ userId, userName, roomId, broadcast }: UseVotingOptions): UseVotingReturn {
  const [votes, setVotes] = useState<Vote[]>([])
  const [results, setResults] = useState<Record<string, VoteResult[]>>({})
  const [votesCast, setVotesCast] = useState<Record<string, Record<string, string>>>({})
  const loadedRef = useRef(false)
  const stateRef = useRef<VoteState>({ votes: [], results: {}, votesCast: {} })

  const syncStateRef = useCallback((next: VoteState) => {
    stateRef.current = next
    saveLocal(roomId, next)
  }, [roomId])

  // 持久化到 Supabase（后台静默）
  const saveToSupabase = useCallback((state: VoteState) => {
    if (!isSupabaseConfigured()) return
    supabase.from(TABLE_NAME).upsert({
      room_id: roomId,
      data: state,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'room_id' }).then(({ error }) => {
      if (error && error.code !== '42P01') {
        console.warn('[Vote] Supabase 保存失败:', error.message)
      }
    }).catch(() => {})
  }, [roomId])

  // 加入房间时加载历史投票
  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true

    const load = async () => {
      let state: VoteState | null = null

      // 1. 尝试 Supabase
      if (isSupabaseConfigured()) {
        try {
          const { data, error } = await supabase
            .from(TABLE_NAME)
            .select('data')
            .eq('room_id', roomId)
            .maybeSingle()

          if (!error && data?.data) {
            state = data.data as VoteState
            console.log('[Vote] 从 Supabase 加载了投票数据')
          } else if (error && error.code !== '42P01') {
            console.warn('[Vote] Supabase 加载失败:', error.message)
          }
        } catch (err) {
          console.warn('[Vote] Supabase 异常:', err)
        }
      }

      // 2. 兜底 localStorage
      if (!state) {
        state = loadLocal(roomId)
        if (state) console.log('[Vote] 从本地加载了投票数据')
      }

      if (state && (state.votes.length > 0 || Object.keys(state.results).length > 0)) {
        stateRef.current = state
        setVotes(state.votes)
        setResults(state.results)
        setVotesCast(state.votesCast)
      }
    }

    load()
  }, [roomId, saveToSupabase])

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

    const nextVotes = [...stateRef.current.votes, vote]
    const nextResults = { ...stateRef.current.results, [vote.id]: initialResults }
    const next: VoteState = {
      votes: nextVotes,
      results: nextResults,
      votesCast: stateRef.current.votesCast,
    }

    setVotes(nextVotes)
    setResults(nextResults)
    syncStateRef(next)
    saveToSupabase(next)

    // 广播创建投票
    broadcast({
      id: generateId(),
      type: MESSAGE_TYPES.SYSTEM,
      senderId: userId,
      senderName: userName,
      timestamp: Date.now(),
      content: JSON.stringify({ _vote: vote, _results: initialResults }),
    })
  }, [userId, userName, broadcast, syncStateRef, saveToSupabase])

  const castVote = useCallback((voteId: string, optionId: string, isAnonymous: boolean) => {
    const current = stateRef.current
    const vote = current.votes.find((v) => v.id === voteId)
    if (!vote || !vote.isActive) return
    if (current.votesCast[voteId]?.[userId]) return

    const nextResults: Record<string, VoteResult[]> = {}
    for (const [vid, vrs] of Object.entries(current.results)) {
      if (vid === voteId) {
        nextResults[vid] = vrs.map((r) => {
          if (r.optionId === optionId) {
            return {
              ...r,
              count: r.count + 1,
              voters: r.voters ? [...r.voters, isAnonymous ? 'momo' : userName] : undefined,
            }
          }
          return r
        })
      } else {
        nextResults[vid] = vrs
      }
    }

    const nextVotesCast = {
      ...current.votesCast,
      [voteId]: { ...current.votesCast[voteId], [userId]: optionId },
    }
    const next: VoteState = { votes: current.votes, results: nextResults, votesCast: nextVotesCast }

    setResults(nextResults)
    setVotesCast(nextVotesCast)
    syncStateRef(next)
    saveToSupabase(next)

    broadcast({
      id: generateId(),
      type: MESSAGE_TYPES.SYSTEM,
      senderId: userId,
      senderName: userName,
      timestamp: Date.now(),
      content: JSON.stringify({ _voteCast: { voteId, optionId, isAnonymous, voterName: userName } }),
    })
  }, [userId, userName, broadcast, syncStateRef, saveToSupabase])

  const endVote = useCallback((voteId: string) => {
    const nextVotes = stateRef.current.votes.map((v) =>
      v.id === voteId ? { ...v, isActive: false } : v
    )
    const next: VoteState = { ...stateRef.current, votes: nextVotes }

    setVotes(nextVotes)
    syncStateRef(next)
    saveToSupabase(next)

    broadcast({
      id: generateId(),
      type: MESSAGE_TYPES.SYSTEM,
      senderId: userId,
      senderName: userName,
      timestamp: Date.now(),
      content: JSON.stringify({ _voteEnd: { voteId } }),
    })
  }, [userId, userName, broadcast, syncStateRef, saveToSupabase])

  const handleVoteMessage = useCallback((msg: RoomMessage) => {
    if (msg.type !== MESSAGE_TYPES.SYSTEM) return

    try {
      const parsed = JSON.parse(msg.content)

      if (parsed._vote) {
        const current = stateRef.current
        if (current.votes.some((v) => v.id === parsed._vote.id)) return

        const nextVotes = [...current.votes, parsed._vote]
        const nextResults = { ...current.results }
        if (parsed._results) {
          nextResults[parsed._vote.id] = parsed._results
        }
        const next: VoteState = { ...current, votes: nextVotes, results: nextResults }

        setVotes(nextVotes)
        setResults(nextResults)
        syncStateRef(next)
        saveToSupabase(next)
      } else if (parsed._voteCast) {
        const { voteId, optionId } = parsed._voteCast
        const current = stateRef.current

        const nextResults: Record<string, VoteResult[]> = {}
        for (const [vid, vrs] of Object.entries(current.results)) {
          if (vid === voteId) {
            nextResults[vid] = vrs.map((r) => {
              if (r.optionId === optionId) {
                return { ...r, count: r.count + 1 }
              }
              return r
            })
          } else {
            nextResults[vid] = vrs
          }
        }
        const next: VoteState = { ...current, results: nextResults }

        setResults(nextResults)
        syncStateRef(next)
        saveToSupabase(next)
      } else if (parsed._voteEnd) {
        const nextVotes = stateRef.current.votes.map((v) =>
          v.id === parsed._voteEnd.voteId ? { ...v, isActive: false } : v
        )
        const next: VoteState = { ...stateRef.current, votes: nextVotes }

        setVotes(nextVotes)
        syncStateRef(next)
        saveToSupabase(next)
      }
    } catch {
      // not a vote message
    }
  }, [syncStateRef, saveToSupabase])

  return { votes, results, createVote, castVote, endVote, handleVoteMessage }
}
