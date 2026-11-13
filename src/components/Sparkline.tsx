import { fmtDate } from '../util'

/** 单指标趋势小图：2px 线、末端圆点、可选参照线（基线或 0），每个点悬停显示日期和数值 */
export default function Sparkline({ series, refLine, refLabel, format, label }: {
  series: { at: number; v: number }[]
  refLine?: number
  refLabel?: string
  format: (v: number) => string
  label: string
}) {
  if (series.length < 2) return null
  const W = 160, H = 36, PX = 4, PY = 5
  const vs = series.map((p) => p.v)
  const lo = Math.min(...vs, refLine ?? Infinity), hi = Math.max(...vs, refLine ?? -Infinity)
  const span = hi - lo || 1
  const x = (i: number) => PX + (i / (series.length - 1)) * (W - PX * 2)
  const y = (v: number) => PY + (1 - (v - lo) / span) * (H - PY * 2)
  const d = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('')
  const last = series[series.length - 1]
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}趋势，最新 ${format(last.v)}`}>
      {refLine !== undefined && (
        <line x1={PX} x2={W - PX} y1={y(refLine)} y2={y(refLine)} className="spark-ref"><title>{refLabel}</title></line>
      )}
      <path d={d} className="spark-line" />
      <circle cx={x(series.length - 1)} cy={y(last.v)} r={3} className="spark-end" />
      {series.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.v)} r={8} className="spark-hit"><title>{`${fmtDate(p.at).slice(5)}：${format(p.v)}`}</title></circle>
      ))}
    </svg>
  )
}
