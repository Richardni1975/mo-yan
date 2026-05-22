import { useCallback, useState } from 'react'
import { formatDateTime } from '../utils/helpers'
import type { ChatMessage, Vote, VoteResult } from '../utils/types'

interface Props {
  messages: ChatMessage[]
  votes: Vote[]
  results: Record<string, VoteResult[]>
}

export function ExportPanel({ messages, votes, results }: Props) {
  const [exporting, setExporting] = useState<'chat' | 'vote' | null>(null)

  const exportChat = useCallback(
    (format: 'txt' | 'html') => {
      setExporting('chat')
      try {
        if (messages.length === 0) {
          alert('暂无聊天记录可导出')
          return
        }

        let content: string
        let mime: string
        let ext: string

        if (format === 'html') {
          content = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>墨言 - 聊天记录</title></head><body>
<h1>墨言 - 聊天记录</h1>
<p>导出时间：${formatDateTime(new Date())}</p>
<hr/>
${messages
  .map(
    (m) =>
      `<div style="margin:8px 0">
        <strong>${m.senderName}</strong>
        <span style="color:#999;font-size:12px">${formatDateTime(new Date(m.timestamp))}</span>
        <p>${escapeHtml(m.content)}</p>
      </div>`
  )
  .join('')}
</body></html>`
          mime = 'text/html'
          ext = 'html'
        } else {
          content = `墨言 - 聊天记录
导出时间：${formatDateTime(new Date())}
${'='.repeat(40)}

${messages
  .map((m) => `[${formatDateTime(new Date(m.timestamp))}] ${m.senderName}:\n${m.content}`)
  .join('\n\n---\n\n')}`
          mime = 'text/plain'
          ext = 'txt'
        }

        downloadFile(content, mime, `墨言_聊天记录.${ext}`)
      } finally {
        setExporting(null)
      }
    },
    [messages]
  )

  const exportVotes = useCallback(
    (format: 'txt' | 'html') => {
      setExporting('vote')
      try {
        if (votes.length === 0) {
          alert('暂无投票记录可导出')
          return
        }

        let content: string
        let mime: string
        let ext: string

        if (format === 'html') {
          content = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>墨言 - 投票结果</title></head><body>
<h1>墨言 - 投票结果</h1>
<p>导出时间：${formatDateTime(new Date())}</p>
<hr/>
${votes
  .map((vote) => {
    const voteResults = results[vote.id] ?? []
    const total = voteResults.reduce((s, r) => s + r.count, 0)
    const modeLabel = vote.mode === 'real_name' ? '实名' : vote.mode === 'anonymous' ? '匿名' : '混合'
    return `<div style="margin:16px 0">
      <h2>${vote.title}</h2>
      <p>模式：${modeLabel} | 总票数：${total}</p>
      <ul>
        ${voteResults
          .map((r) => {
            const opt = vote.options.find((o) => o.id === r.optionId)
            return `<li>${opt?.label ?? '?'}：${r.count} 票${r.voters ? `（${r.voters.join('、')}）` : ''}</li>`
          })
          .join('')}
      </ul>
    </div>`
  })
  .join('')}
</body></html>`
          mime = 'text/html'
          ext = 'html'
        } else {
          const lines: string[] = ['墨言 - 投票结果', `导出时间：${formatDateTime(new Date())}`, '='.repeat(40), '']
          votes.forEach((vote) => {
            const voteResults = results[vote.id] ?? []
            const total = voteResults.reduce((s, r) => s + r.count, 0)
            const modeLabel = vote.mode === 'real_name' ? '实名' : vote.mode === 'anonymous' ? '匿名' : '混合'
            lines.push(`【${vote.title}】`)
            lines.push(`模式：${modeLabel} | 总票数：${total}`)
            voteResults.forEach((r) => {
              const opt = vote.options.find((o) => o.id === r.optionId)
              lines.push(`  ${opt?.label ?? '?'}：${r.count} 票${r.voters ? `（${r.voters.join('、')}）` : ''}`)
            })
            lines.push('')
          })
          content = lines.join('\n')
          mime = 'text/plain'
          ext = 'txt'
        }

        downloadFile(content, mime, `墨言_投票结果.${ext}`)
      } finally {
        setExporting(null)
      }
    },
    [votes, results]
  )

  return (
    <div className="panel" style={{ width: 180, flexShrink: 0 }}>
      <div className="panel-header">
        <span>导出</span>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.8rem' }}>
        <div style={{ fontWeight: 600, fontSize: '0.75rem', color: 'var(--ink-light)' }}>聊天记录</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn-sm btn-secondary" onClick={() => exportChat('txt')} disabled={exporting !== null}>
            TXT
          </button>
          <button className="btn btn-sm btn-secondary" onClick={() => exportChat('html')} disabled={exporting !== null}>
            HTML
          </button>
        </div>
        <div style={{ fontWeight: 600, fontSize: '0.75rem', color: 'var(--ink-light)', marginTop: 4 }}>投票结果</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn-sm btn-secondary" onClick={() => exportVotes('txt')} disabled={exporting !== null}>
            TXT
          </button>
          <button className="btn btn-sm btn-secondary" onClick={() => exportVotes('html')} disabled={exporting !== null}>
            HTML
          </button>
        </div>
      </div>
    </div>
  )
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function downloadFile(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
