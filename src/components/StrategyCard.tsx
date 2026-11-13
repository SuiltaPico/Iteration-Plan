import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Strategy, Topic } from '../db'
import { lastReviewMap } from '../db'
import { daysSince, excerpt, fmtRelative } from '../util'
import { Score, StatusBadge } from './ScoreBadge'

/** 所有策略的最近复盘时间（随复盘记录实时更新） */
export function useLastReviews() {
  return useLiveQuery(lastReviewMap, [], new Map<string, number>())
}

export default function StrategyCard({ s, topic, showTopic, last, problem }: { s: Strategy; topic?: Topic; showTopic?: boolean; last?: number; problem?: string }) {
  const reviewable = !s.isDraft && s.status !== 'eliminated'
  return (
    <article className={`card strategy-card st-${s.isDraft ? 'draft' : s.status}`}>
      <Link to={`/strategy/${s.id}`} className="card-link">
        {problem && <span className="card-problem">{problem}</span>}
        <div className="card-top">
          <h3 className="card-title">{s.title || '未命名策略'}{(s.version ?? 1) > 1 && <span className="ver">v{s.version}</span>}</h3>
          {s.isDraft ? <span className="badge badge-draft">草稿</span> : <StatusBadge status={s.status} />}
        </div>
        <p className="card-excerpt">{s.content ? excerpt(s.content) : <span className="muted">还没有内容</span>}</p>
      </Link>
      <div className="card-foot">
        {!s.isDraft && <Score score={s.score} />}
        {showTopic && topic && (
          <span className="topic-chip"><span className="dot" style={{ background: topic.color }} />{topic.name}</span>
        )}
        <span className="card-meta">
          {s.isDraft ? `编辑于 ${fmtRelative(s.updatedAt)}`
            : s.status === 'eliminated' ? `淘汰于 ${fmtRelative(s.statusChangedAt)}`
            : last ? `上次复盘 ${fmtRelative(last)}` : `已使用 ${daysSince(s.createdAt)} 天 · 未复盘`}
        </span>
        {reviewable && (
          <Link to={`/review?s=${s.id}`} className="review-btn" title="复盘这个策略">复盘</Link>
        )}
      </div>
    </article>
  )
}
