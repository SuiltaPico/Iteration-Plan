import type { Status, Topic } from '../db'
import { STATUS_LABEL } from '../db'

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>
}

export function Score({ score, size = 'md' }: { score: number; size?: 'md' | 'lg' }) {
  const cls = score > 0 ? 'pos' : score < 0 ? 'neg' : 'zero'
  return <span className={`score score-${cls} score-${size}`}>{score > 0 ? `+${score}` : score}</span>
}

/** 分数在 [淘汰线, 留存线] 区间内的位置 */
export function ScoreMeter({ score, topic }: { score: number; topic: Topic }) {
  const lo = topic.eliminateAt, hi = topic.keepAt
  const pct = Math.min(1, Math.max(0, (score - lo) / (hi - lo))) * 100
  return (
    <div className="meter" title={`淘汰线 ${lo} · 留存线 +${hi}`}>
      <div className="meter-track">
        <div className="meter-zero" style={{ left: `${((0 - lo) / (hi - lo)) * 100}%` }} />
        <div className="meter-dot" style={{ left: `${pct}%` }} />
      </div>
      <div className="meter-labels"><span>{lo}</span><span>+{hi}</span></div>
    </div>
  )
}
