import type { Status } from '../db'
import { STATUS_LABEL } from '../db'

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>
}

export function Score({ score, size = 'md' }: { score: number; size?: 'md' | 'lg' }) {
  const cls = score > 0 ? 'pos' : score < 0 ? 'neg' : 'zero'
  return <span className={`score score-${cls} score-${size}`}>{score > 0 ? `+${score}` : score}</span>
}
