import { Link } from 'react-router-dom'
import type { Strategy, Topic } from '../db'
import { addReview } from '../db'
import { daysSince, excerpt, fmtRelative } from '../util'
import { Score, StatusBadge } from './ScoreBadge'

export default function StrategyCard({ s, topic, showTopic }: { s: Strategy; topic?: Topic; showTopic?: boolean }) {
  const quick = (delta: number) => (e: React.MouseEvent) => {
    e.preventDefault()
    addReview(s.id, delta, '')
  }
  return (
    <Link to={`/strategy/${s.id}`} className={`card strategy-card st-${s.status}`}>
      <div className="card-top">
        <Score score={s.score} />
        <div className="card-title">{s.title || '未命名策略'}</div>
        <StatusBadge status={s.status} />
      </div>
      {s.content && <p className="card-excerpt">{excerpt(s.content)}</p>}
      <div className="card-foot">
        {showTopic && topic && (
          <span className="topic-chip"><span className="dot" style={{ background: topic.color }} />{topic.name}</span>
        )}
        <span className="muted">
          {s.status === 'eliminated' ? `淘汰于 ${fmtRelative(s.statusChangedAt)}` : `已使用 ${daysSince(s.createdAt)} 天`}
        </span>
        {s.status !== 'eliminated' && (
          <span className="quick">
            <button className="qbtn neg" title="不好用 −1" onClick={quick(-1)}>−1</button>
            <button className="qbtn pos" title="好用 +1" onClick={quick(1)}>+1</button>
          </span>
        )}
      </div>
    </Link>
  )
}
