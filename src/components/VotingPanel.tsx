import { useState } from 'react'
import { generateId } from '../utils/helpers'
import type { Vote, VoteResult, VoteMode } from '../utils/types'
import { VOTE_MODES } from '../utils/constants'

interface Props {
  votes: Vote[]
  results: Record<string, VoteResult[]>
  currentUserId: string
  currentUserName: string
  onCreateVote: (title: string, options: string[], mode: VoteMode) => void
  onCastVote: (voteId: string, optionId: string, isAnonymous: boolean) => void
  onEndVote: (voteId: string) => void
  isAnonymous: boolean
}

export function VotingPanel({
  votes,
  results,
  currentUserId,
  currentUserName,
  onCreateVote,
  onCastVote,
  onEndVote,
  isAnonymous,
}: Props) {
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [mode, setMode] = useState<VoteMode>(VOTE_MODES.ANONYMOUS)

  const handleCreate = () => {
    if (!title.trim() || options.filter((o) => o.trim()).length < 2) return
    onCreateVote(title.trim(), options.filter((o) => o.trim()), mode)
    setTitle('')
    setOptions(['', ''])
    setShowCreate(false)
  }

  const addOption = () => setOptions([...options, ''])

  const isActive = (v: Vote) => v.isActive
  const activeVotes = votes.filter(isActive)
  const endedVotes = votes.filter((v) => !v.isActive)

  return (
    <div className="panel" style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', maxHeight: 260 }}>
      <div className="panel-header" style={{ padding: '6px 10px', fontSize: '0.78rem' }}>
        <span>投票</span>
        <button className="btn btn-sm btn-ghost" onClick={() => setShowCreate(!showCreate)}
          style={{ fontSize: '0.7rem', padding: '2px 6px' }}>
          {showCreate ? '取消' : '+ 发起'}
        </button>
      </div>

      <div className="panel-body" style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
        {/* 创建投票表单 */}
        {showCreate && (
          <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              className="input-underline"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="投票标题"
              style={{ fontSize: '0.85rem' }}
            />
            {options.map((opt, i) => (
              <div key={i} style={{ display: 'flex', gap: 4 }}>
                <input
                  className="input-underline"
                  value={opt}
                  onChange={(e) => {
                    const next = [...options]
                    next[i] = e.target.value
                    setOptions(next)
                  }}
                  placeholder={`选项 ${i + 1}`}
                  style={{ fontSize: '0.85rem' }}
                />
                {options.length > 2 && (
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => setOptions(options.filter((_, j) => j !== i))}
                    style={{ color: 'var(--vermilion)' }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button className="btn btn-sm btn-ghost" onClick={addOption} style={{ alignSelf: 'flex-start' }}>
              + 添加选项
            </button>

            <div style={{ display: 'flex', gap: 8, fontSize: '0.8rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="radio"
                  name="voteMode"
                  checked={mode === VOTE_MODES.REAL_NAME}
                  onChange={() => setMode(VOTE_MODES.REAL_NAME)}
                />
                实名
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="radio"
                  name="voteMode"
                  checked={mode === VOTE_MODES.ANONYMOUS}
                  onChange={() => setMode(VOTE_MODES.ANONYMOUS)}
                />
                匿名
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="radio"
                  name="voteMode"
                  checked={mode === VOTE_MODES.MIXED}
                  onChange={() => setMode(VOTE_MODES.MIXED)}
                />
                混合
              </label>
            </div>

            <button className="btn btn-sm btn-primary" onClick={handleCreate} style={{ alignSelf: 'center' }}>
              发起投票
            </button>
          </div>
        )}

        {/* 进行中的投票 */}
        {activeVotes.map((vote) => {
          const voteResults = results[vote.id] ?? []
          const totalVotes = voteResults.reduce((sum, r) => sum + r.count, 0)
          return (
            <div key={vote.id} style={{ marginBottom: 12 }}>
              <div className="flex-between" style={{ marginBottom: 4 }}>
                <strong style={{ fontSize: '0.85rem' }}>{vote.title}</strong>
                <span style={{ fontSize: '0.7rem', color: 'var(--ink-light)' }}>
                  {totalVotes} 票 | {vote.mode === 'real_name' ? '实名' : vote.mode === 'anonymous' ? '匿名' : '混合'}
                </span>
              </div>
              {voteResults.map((result) => {
                const option = vote.options.find((o) => o.id === result.optionId)
                const pct = totalVotes > 0 ? (result.count / totalVotes) * 100 : 0
                return (
                  <div key={result.optionId} style={{ marginBottom: 4 }}>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => onCastVote(vote.id, result.optionId, isAnonymous)}
                      style={{
                        width: '100%',
                        justifyContent: 'flex-start',
                        padding: '4px 8px',
                        fontSize: '0.8rem',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ flex: 1 }}>{option?.label ?? '?'}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--ink-light)', minWidth: 32, textAlign: 'right' }}>
                        {result.count} 票
                      </div>
                    </button>
                    {/* 进度条 */}
                    <div
                      style={{
                        height: 3,
                        background: 'var(--paper-dark)',
                        borderRadius: 2,
                        overflow: 'hidden',
                        marginTop: 2,
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: '100%',
                          background: 'var(--ink-blue)',
                          borderRadius: 2,
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                    {vote.mode === 'real_name' && result.voters && result.voters.length > 0 && (
                      <div style={{ fontSize: '0.65rem', color: 'var(--ink-light)', paddingLeft: 4 }}>
                        {result.voters.join('、')}
                      </div>
                    )}
                  </div>
                )
              })}
              {vote.creatorId === currentUserId && (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => onEndVote(vote.id)}
                  style={{ color: 'var(--vermilion)', fontSize: '0.75rem', marginTop: 4 }}
                >
                  结束投票
                </button>
              )}
            </div>
          )
        })}

        {/* 已结束的投票 */}
        {endedVotes.length > 0 && (
          <>
            <div className="separator" />
            <div style={{ fontSize: '0.75rem', color: 'var(--ink-light)', marginBottom: 8 }}>
              已结束的投票
            </div>
            {endedVotes.map((vote) => {
              const voteResults = results[vote.id] ?? []
              const totalVotes = voteResults.reduce((sum, r) => sum + r.count, 0)
              const winner = voteResults.reduce((best, r) => (r.count > (best?.count ?? 0) ? r : best), voteResults[0])
              const winningOption = winner ? vote.options.find((o) => o.id === winner.optionId) : null
              return (
                <div key={vote.id} style={{ marginBottom: 8, opacity: 0.7 }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{vote.title}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--ink-light)' }}>
                    结果：{winningOption?.label ?? '无'}（{winner?.count ?? 0}/{totalVotes} 票）
                  </div>
                </div>
              )
            })}
          </>
        )}

        {votes.length === 0 && !showCreate && (
          <div style={{ textAlign: 'center', color: 'var(--ink-light)', fontSize: '0.85rem', paddingTop: 20 }}>
            暂无投票
          </div>
        )}
      </div>
    </div>
  )
}
