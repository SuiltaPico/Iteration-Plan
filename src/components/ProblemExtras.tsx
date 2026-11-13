import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { addIdea, deleteIdea, fmtMetric, ideaToDraft, metricStat, STATUS_LABEL, versionSince, type Idea, type Problem, type Review, type Strategy, type UsageLog } from '../db'

/** 同一问题下各候选在指标上的对比（当前版本起） */
export function ProblemCompare({ problem, strategies, logs, reviews }: { problem: Problem; strategies: Strategy[]; logs: UsageLog[]; reviews: Review[] }) {
  const metrics = problem.metrics ?? []
  const cands = strategies.filter((s) => !s.isDraft)
  if (!metrics.length || !cands.length) return null
  const rows = cands.map((s) => {
    const since = versionSince(s, reviews.filter((r) => r.strategyId === s.id))
    const mine = logs.filter((l) => l.strategyId === s.id)
    return { s, stats: metrics.map((m) => metricStat(m, mine, since)) }
  })
  const best = metrics.map((m, i) => {
    const vals = rows.map((r) => r.stats[i].value).filter((v): v is number => v !== null)
    if (vals.length < 2) return null
    return m.better === 'higher' ? Math.max(...vals) : Math.min(...vals)
  })
  const hasBase = metrics.some((m) => m.baseline !== undefined)
  return (
    <div className="compare-wrap">
      <table className="compare">
        <thead>
          <tr>
            <th>候选</th>
            {metrics.map((m) => <th key={m.id}>{m.name}<small>{m.agg === 'sum' ? '累计' : '平均'} · {m.better === 'higher' ? '越大越好' : '越小越好'}</small></th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ s, stats }) => (
            <tr key={s.id} className={s.status === 'eliminated' ? 'dim' : ''}>
              <td><Link to={`/strategy/${s.id}`}>{s.title}</Link> <span className={`badge badge-${s.status}`}>{STATUS_LABEL[s.status]}</span></td>
              {metrics.map((m, i) => (
                <td key={m.id} className={best[i] !== null && stats[i].value === best[i] ? 'best' : ''}>
                  {fmtMetric(stats[i].value, m)}{stats[i].n > 0 && <small>{stats[i].n} 次</small>}
                </td>
              ))}
            </tr>
          ))}
          {hasBase && (
            <tr className="base-row">
              <td>不用任何策略（基线）</td>
              {metrics.map((m) => <td key={m.id}>{m.baseline !== undefined ? fmtMetric(m.baseline, { ...m, agg: 'avg' }) : '—'}</td>)}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

const isUrl = (s?: string) => !!s && /^https?:\/\//.test(s)

/** 想法池：还没开始试的做法，一句话加来源，想试时转成候选策略（草稿） */
export function IdeaBox({ topicId, problemId, ideas }: { topicId: string; problemId?: string; ideas: Idea[] }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [source, setSource] = useState('')
  const navigate = useNavigate()
  const key = problemId ?? 'topic'
  return (
    <div className={`ideas ${open ? 'open' : ''}`}>
      <button className="ideas-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? '▾' : '▸'} 想法池{ideas.length ? ` · ${ideas.length}` : ''}
      </button>
      {open && (
        <div className="ideas-body">
          {ideas.map((x) => (
            <div key={x.id} className="idea">
              <div className="idea-text">
                {x.text}
                {x.source && <span className="muted sm"> · {isUrl(x.source) ? <a href={x.source} target="_blank" rel="noreferrer">来源</a> : x.source}</span>}
              </div>
              <button className="btn sm" onClick={async () => { const s = await ideaToDraft(x.id); if (s) navigate(`/strategy/${s.id}`) }}>转成候选</button>
              <button className="icon-btn" title="删除这个想法" onClick={() => deleteIdea(x.id)}>×</button>
            </div>
          ))}
          <form className="idea-add" onSubmit={async (e) => {
            e.preventDefault()
            if (!text.trim()) return
            await addIdea(topicId, text.trim(), { problemId, source: source.trim() || undefined })
            setText(''); setSource('')
          }}>
            <input id={`idea-text-${key}`} value={text} onChange={(e) => setText(e.target.value)} placeholder="一句话记下想试的做法" />
            <input id={`idea-src-${key}`} value={source} onChange={(e) => setSource(e.target.value)} placeholder="来源（书、链接、谁说的）" className="src" />
            <button className="btn sm" disabled={!text.trim()}>记下</button>
          </form>
        </div>
      )}
    </div>
  )
}
