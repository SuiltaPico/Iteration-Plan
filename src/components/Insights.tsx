import { fmtMetric, LOG_RESULT_LABEL, metricStat, type LogResult, type Metric, type UsageLog } from '../db'
import Sparkline from './Sparkline'

/** 当前版本在各指标上的表现：数值、次数、与基线对比、趋势 */
export function MetricSummary({ metrics, logs, since }: { metrics: Metric[]; logs: UsageLog[]; since: number }) {
  if (!metrics.length) return null
  return (
    <div className="metric-summary">
      {metrics.map((m) => {
        const st = metricStat(m, logs, since)
        const vsBase = st.value !== null && m.baseline !== undefined && m.agg === 'avg'
          ? (m.better === 'lower' ? st.value <= m.baseline : st.value >= m.baseline) : null
        return (
          <div key={m.id} className="metric-row">
            <div className="metric-head">
              <span className="metric-name">{m.name}<small>{m.agg === 'sum' ? '累计' : '平均'}</small></span>
              <span className={`metric-value ${vsBase === true ? 'pos' : vsBase === false ? 'neg' : ''}`}>{fmtMetric(st.value, m)}</span>
            </div>
            <div className="metric-sub muted sm">
              {st.n ? `记了 ${st.n} 次` : '还没有数据，记一笔时可以填'}
              {m.baseline !== undefined && <> · 基线 {fmtMetric(m.baseline, { ...m, agg: 'avg' })}{vsBase !== null && (vsBase ? '，好于基线' : '，不如基线')}</>}
            </div>
            <Sparkline series={st.series} label={m.name} format={(v) => fmtMetric(v, m)}
              refLine={m.agg === 'sum' ? 0 : m.baseline} refLabel={m.agg === 'sum' ? '0' : '基线'} />
          </div>
        )
      })}
    </div>
  )
}

/** 按情境拆开看结果：同一个策略在不同情况下是否表现不同 */
export function SituationBreakdown({ logs }: { logs: UsageLog[] }) {
  const tagged = logs.filter((l) => l.tags?.length)
  if (!tagged.length) return null
  const m = new Map<string, Record<LogResult | 'none', number>>()
  for (const l of tagged) for (const t of l.tags!) {
    const row = m.get(t) ?? { good: 0, meh: 0, bad: 0, none: 0 }
    row[l.result ?? 'none']++
    m.set(t, row)
  }
  const rows = [...m.entries()].sort((a, b) => Object.values(b[1]).reduce((x, y) => x + y) - Object.values(a[1]).reduce((x, y) => x + y))
  return (
    <table className="situ">
      <thead><tr><th>情境</th><th>{LOG_RESULT_LABEL.good}</th><th>{LOG_RESULT_LABEL.meh}</th><th>{LOG_RESULT_LABEL.bad}</th></tr></thead>
      <tbody>
        {rows.map(([t, r]) => (
          <tr key={t}><td>{t}</td><td className={r.good ? 'pos' : 'zero'}>{r.good}</td><td className={r.meh ? 'warn' : 'zero'}>{r.meh}</td><td className={r.bad ? 'neg' : 'zero'}>{r.bad}</td></tr>
        ))}
      </tbody>
    </table>
  )
}
