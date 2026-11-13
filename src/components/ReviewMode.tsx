import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { addReview, db, STATUS_LABEL, type Status } from '../db'
import { daysSince, fmtRelative } from '../util'
import { Score, StatusBadge } from './ScoreBadge'

const Editor = lazy(() => import('./Editor'))

/** 专注复盘：只看一个策略，说说用下来怎么样 */
export default function ReviewMode() {
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const id = params.get('s') ?? ''
  const fromCheckIn = params.get('from') === 'checkin'
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<{ text: string; tone: 'pos' | 'neg' | 'info' } | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflow, setOverflow] = useState(false)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const s = useLiveQuery(() => db.strategies.get(id).then((x) => x ?? null), [id])
  const topic = useLiveQuery(() => (s ? db.topics.get(s.topicId) : undefined), [s?.topicId])
  const reviews = useLiveQuery(() => db.reviews.where('strategyId').equals(id).reverse().sortBy('createdAt'), [id])

  useEffect(() => { noteRef.current?.focus() }, [s?.id])
  // 正文超出折叠高度时才显示「展开全文」
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setOverflow(el.scrollHeight > el.clientHeight + 4))
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  })

  const back = () => {
    if (fromCheckIn) navigate('/')
    else if (location.key !== 'default') navigate(-1)
    else navigate(`/strategy/${id}`)
  }

  async function act(delta: number) {
    if (!s || busy) return
    if (delta === 0 && !note.trim()) { noteRef.current?.focus(); return }
    setBusy(true)
    const changed = await addReview(s.id, delta, note.trim())
    const sign = delta > 0 ? '+1' : delta < 0 ? '−1' : '记下了'
    setFlash(changed
      ? { text: `${sign}，${changed === 'kept' ? '达到留存线，已留存' : '达到淘汰线，已淘汰'}`, tone: changed === 'kept' ? 'pos' : 'neg' }
      : { text: sign, tone: delta > 0 ? 'pos' : delta < 0 ? 'neg' : 'info' })
    setTimeout(back, changed ? 1400 : 700)
  }

  if (s === undefined) return <div className="review-shell" />

  return (
    <div className="review-shell">
      <header className="review-bar">
        <button className="btn ghost sm" onClick={back}>← 返回</button>
        <div className="review-scope">复盘</div>
        <div />
      </header>

      <main className="review-main">
        {!s || !topic ? (
          <div className="review-done">
            <p className="muted">这个策略已不存在。</p>
            <button className="btn" onClick={() => navigate('/')}>回到总览</button>
          </div>
        ) : (
          <section className="review-card">
            <div className="review-topic"><span className="dot" style={{ background: topic.color }} />{topic.name}</div>
            <h1 className="review-title">{s.title || '未命名策略'}</h1>
            <div className="review-meta">
              <StatusBadge status={s.status} />
              <Score score={s.score} />
              <span className="muted sm">
                已使用 {daysSince(s.createdAt)} 天 · {reviews?.length ? `上次复盘 ${fmtRelative(reviews[0].createdAt)}` : '还没复盘过'}
              </span>
              {s.status !== 'eliminated' && (
                <span className="review-hint">
                  {s.status === 'trial' ? `再 +${topic.keepAt - s.score} 留存 · 再 −${s.score - topic.eliminateAt} 淘汰` : `再 −${s.score - topic.eliminateAt} 淘汰`}
                </span>
              )}
            </div>

            {s.content.trim() && (
              <div ref={contentRef} className={`review-content ${expanded ? 'open' : ''}`}>
                <Suspense fallback={null}><Editor key={s.id} value={s.content} readOnly /></Suspense>
                {!expanded && overflow && <button className="review-expand" onClick={() => setExpanded(true)}>展开全文</button>}
              </div>
            )}

            {reviews && reviews.some((r) => r.note || r.statusChange) && (
              <div className="review-history">
                <div className="label">之前说过</div>
                {reviews.filter((r) => r.note || r.statusChange).slice(0, 3).map((r) => (
                  <div key={r.id} className="review-history-row">
                    <span className={`delta ${r.delta > 0 ? 'pos' : r.delta < 0 ? 'neg' : ''}`}>{r.delta > 0 ? `+${r.delta}` : r.delta < 0 ? r.delta : '·'}</span>
                    <span>{r.note || (r.statusChange && `${STATUS_LABEL[r.statusChange.from as Status]} → ${STATUS_LABEL[r.statusChange.to as Status]}`)}</span>
                    <span className="muted sm">{fmtRelative(r.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}

            {s.status === 'eliminated' ? (
              <div className="review-ask">
                <p className="muted">这个策略已经淘汰了。想再试一次的话，可以在策略页的「⋯」里恢复试用。</p>
                <Link to={`/strategy/${s.id}`} className="btn">去策略页</Link>
              </div>
            ) : (
              <div className="review-ask">
                <label htmlFor="review-note">这段时间用下来怎么样？</label>
                <textarea id="review-note" ref={noteRef} rows={4} value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="写下感受、观察或想调整的地方（选「只记录」时必填）" />
                <div className="review-actions">
                  <button className="btn neg lg" disabled={busy} onClick={() => act(-1)}>不好用 −1</button>
                  <button className="btn lg" disabled={busy} onClick={() => act(0)} title="不改变分数，只记下这次观察">只记录</button>
                  <button className="btn pos lg" disabled={busy} onClick={() => act(1)}>好用 +1</button>
                </div>
              </div>
            )}
            {flash && <div className={`review-flash ${flash.tone}`}>{flash.text}</div>}
          </section>
        )}
      </main>
    </div>
  )
}
