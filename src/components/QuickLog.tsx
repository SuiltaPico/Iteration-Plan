import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { addLog, db, fmtMetric, LOG_RESULT_LABEL, topicTags, type LogResult, type Metric, type Strategy, type UsageLog } from '../db'
import EmojiPicker, { TagPicker } from './EmojiPicker'
import { fmtRelative } from '../util'
import { toast } from './Dialogs'

/** 记一笔：刚用了某个策略，记下当时的情况和结果（不计分，复盘时参考） */
export default function QuickLog() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const id = params.get('s')
  const [q, setQ] = useState('')
  const [note, setNote] = useState('')
  const [result, setResult] = useState<LogResult | undefined>()
  const [values, setValues] = useState<Record<string, string>>({})
  const [tags, setTags] = useState<string[]>([])
  const [emoji, setEmoji] = useState<string | undefined>()
  const noteRef = useRef<HTMLTextAreaElement>(null)

  const topics = useLiveQuery(() => db.topics.orderBy('order').toArray(), [])
  const problems = useLiveQuery(() => db.problems.toArray(), [])
  const strategies = useLiveQuery(() => db.strategies.toArray(), [])
  const recentLogs = useLiveQuery(() => db.logs.orderBy('createdAt').reverse().limit(200).toArray(), [])
  const s = strategies?.find((x) => x.id === id)
  const myLogs = useLiveQuery(() => (id ? db.logs.where('strategyId').equals(id).reverse().sortBy('createdAt') : []), [id])
  const metrics = (s?.problemId && problems?.find((p) => p.id === s.problemId)?.metrics) || []
  const knownTags = useLiveQuery(() => (s ? topicTags(s.topicId) : []), [s?.topicId]) ?? []

  useEffect(() => { if (id) noteRef.current?.focus() }, [id])

  const back = () => (location.key !== 'default' ? navigate(-1) : navigate('/'))

  // 候选：在用的策略，最近记过的排前面
  const candidates = useMemo(() => {
    if (!strategies) return []
    const lastLog = new Map<string, number>()
    recentLogs?.forEach((l) => { if (!lastLog.has(l.strategyId)) lastLog.set(l.strategyId, l.createdAt) })
    const kw = q.trim().toLowerCase()
    return strategies
      .filter((x) => !x.isDraft && x.status !== 'eliminated')
      .filter((x) => !kw || x.title.toLowerCase().includes(kw) || x.content.toLowerCase().includes(kw))
      .sort((a, b) => (lastLog.get(b.id) ?? 0) - (lastLog.get(a.id) ?? 0) || b.updatedAt - a.updatedAt)
  }, [strategies, recentLogs, q])

  const tname = new Map((topics ?? []).map((t) => [t.id, t]))
  const pname = new Map((problems ?? []).map((p) => [p.id, p.title]))

  async function save() {
    if (!s || !note.trim()) { noteRef.current?.focus(); return }
    const nums: Record<string, number> = {}
    for (const m of metrics) {
      const raw = values[m.id]?.trim()
      if (raw && !Number.isNaN(Number(raw))) nums[m.id] = Number(raw)
    }
    await addLog(s.id, note.trim(), result, { values: nums, tags, emoji })
    toast('记下了')
    back()
  }

  const where = (x: Strategy) => {
    const t = tname.get(x.topicId)
    return <>{t && <span className="dot" style={{ background: t.color }} />}{t?.name}{x.problemId && pname.get(x.problemId) ? ` · ${pname.get(x.problemId)}` : ''}</>
  }

  return (
    <div className="review-shell">
      <header className="review-bar">
        <button className="btn ghost sm" onClick={back}>← 返回</button>
        <div className="review-scope">记一笔</div>
        <div />
      </header>
      <main className="review-main">
        {!strategies ? null : !s ? (
          <section className="review-card">
            <h1 className="review-title">刚用了哪个策略？</h1>
            <input id="log-search" className="search full" autoFocus placeholder="搜索策略…" value={q} onChange={(e) => setQ(e.target.value)} />
            {candidates.length ? (
              <div className="pick-list">
                {candidates.map((x) => (
                  <button key={x.id} className="pick-item" onClick={() => setParams({ s: x.id }, { replace: true })}>
                    <span className="pick-title">{x.title || '未命名策略'}</span>
                    <span className="pick-where">{where(x)}</span>
                  </button>
                ))}
              </div>
            ) : <p className="muted">{q ? '没有匹配的策略' : '还没有在用的策略'}</p>}
          </section>
        ) : (
          <section className="review-card">
            <div className="review-topic">{where(s)}</div>
            <h1 className="review-title">{s.title}</h1>
            {s.criteria?.trim() && (
              <div className="criteria-box"><div className="label">怎么判断有效</div><p>{s.criteria}</p></div>
            )}
            <div className="review-ask">
              <label htmlFor="log-note">这次是什么情况，结果怎样？</label>
              <textarea id="log-note" ref={noteRef} rows={4} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="例如：涨到 +18% 时没忍住提前卖了，之后又涨了 10%。"
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save() }} />
              <div className="met-row">
                <span className="muted sm">结果：</span>
                {(Object.keys(LOG_RESULT_LABEL) as LogResult[]).map((k) => (
                  <button key={k} className={`chip ${result === k ? 'on' : ''}`} onClick={() => setResult(result === k ? undefined : k)}>{LOG_RESULT_LABEL[k]}</button>
                ))}
              </div>
              {metrics.length > 0 && (
                <div className="metric-inputs">
                  {metrics.map((m) => (
                    <label key={m.id} className="metric-input">
                      <span>{m.name}</span>
                      <input id={`log-metric-${m.id}`} type="number" step="any" inputMode="decimal" value={values[m.id] ?? ''}
                        placeholder={m.agg === 'sum' ? '这次，例如 350 或 -120' : '这次的数值'}
                        onChange={(e) => setValues({ ...values, [m.id]: e.target.value })} />
                      {m.unit && <em>{m.unit}</em>}
                    </label>
                  ))}
                </div>
              )}
              <div className="field">
                <span className="muted sm">情境（可选）：什么情况下用的</span>
                <TagPicker value={tags} options={knownTags} onChange={setTags} />
              </div>
              <EmojiPicker value={emoji} onChange={setEmoji} />
              <div className="row-btns end">
                {!params.get('fixed') && <button className="btn ghost" onClick={() => setParams({}, { replace: true })}>换一个策略</button>}
                <button className="btn primary" disabled={!note.trim()} onClick={save}>记下</button>
              </div>
              <p className="muted sm">记录不计分，复盘时会列出来，帮你回忆这段时间实际发生了什么。</p>
            </div>
            {myLogs && myLogs.length > 0 && (
              <div className="review-history">
                <div className="label">之前记过</div>
                {myLogs.slice(0, 5).map((l) => <LogRow key={l.id} l={l} metrics={metrics} />)}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}

export function LogRow({ l, onDelete, metrics = [] }: { l: UsageLog; onDelete?: () => void; metrics?: Metric[] }) {
  const vals = metrics.filter((m) => typeof l.values?.[m.id] === 'number')
  return (
    <div className="log-row">
      {l.emoji ? <span className="log-emoji">{l.emoji}</span> : <span className={`log-dot r-${l.result ?? 'none'}`} title={l.result ? LOG_RESULT_LABEL[l.result] : undefined} />}
      <span className="log-note">
        {l.result && <span className={`log-result r-${l.result}`}>{LOG_RESULT_LABEL[l.result]} · </span>}{l.note}
        {(vals.length > 0 || (l.tags?.length ?? 0) > 0) && (
          <span className="log-meta">
            {vals.map((m) => <span key={m.id} className="log-val">{m.name} {fmtMetric(l.values![m.id], m)}</span>)}
            {l.tags?.map((t) => <span key={t} className="log-tag">{t}</span>)}
          </span>
        )}
      </span>
      <span className="muted sm">{fmtRelative(l.createdAt)}</span>
      {onDelete && <button className="icon-btn" title="删除这条记录" onClick={onDelete}>×</button>}
    </div>
  )
}
