import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { addReview, db, isDue, lastReviewMap, STATUS_LABEL, type Status } from '../db'
import { daysSince, fmtRelative } from '../util'
import { Score, StatusBadge } from './ScoreBadge'

const Editor = lazy(() => import('./Editor'))

interface Tally { up: number; down: number; note: number; kept: number; eliminated: number }

/** 专注复盘：一次只看一个策略，打完分进入下一个 */
export default function ReviewMode() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [queue, setQueue] = useState<string[] | null>(null)
  const [idx, setIdx] = useState(0)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<{ text: string; tone: 'pos' | 'neg' | 'info' } | null>(null)
  const [tally, setTally] = useState<Tally>({ up: 0, down: 0, note: 0, kept: 0, eliminated: 0 })
  const [expanded, setExpanded] = useState(false)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState(false)

  const single = params.get('s')
  const topicId = params.get('topic')
  const onlyDue = params.get('due') === '1'

  // 进入时固定一份队列：最久没复盘的排前面
  useEffect(() => {
    (async () => {
      if (single) { setQueue([single]); return }
      const [all, last] = await Promise.all([db.strategies.toArray(), lastReviewMap()])
      const list = all
        .filter((s) => !s.isDraft && s.status !== 'eliminated' && (!topicId || s.topicId === topicId))
        .filter((s) => !onlyDue || isDue(s, last.get(s.id)))
        .sort((a, b) => (last.get(a.id) ?? a.createdAt) - (last.get(b.id) ?? b.createdAt))
      setQueue(list.map((s) => s.id))
    })()
  }, [single, topicId, onlyDue])

  const id = queue?.[idx]
  const s = useLiveQuery(() => (id ? db.strategies.get(id) : undefined), [id])
  const topic = useLiveQuery(() => (s ? db.topics.get(s.topicId) : undefined), [s?.topicId])
  const reviews = useLiveQuery(() => (id ? db.reviews.where('strategyId').equals(id).reverse().sortBy('createdAt') : []), [id])
  const scopeTopic = useLiveQuery(() => (topicId ? db.topics.get(topicId) : undefined), [topicId])

  useEffect(() => { setExpanded(false); setNote(''); noteRef.current?.focus() }, [id])
  // 正文超出折叠高度时才显示「展开全文」
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setOverflow(el.scrollHeight > el.clientHeight + 4))
    const inner = el.firstElementChild
    ro.observe(el)
    if (inner) ro.observe(inner)
    return () => ro.disconnect()
  })

  const exit = () => navigate(single ? `/strategy/${single}` : topicId ? `/topic/${topicId}` : '/')

  async function act(delta: number) {
    if (!s || busy) return
    if (delta === 0 && !note.trim()) { noteRef.current?.focus(); return }
    setBusy(true)
    const changed = await addReview(s.id, delta, note.trim())
    setTally((t) => ({
      ...t,
      up: t.up + (delta > 0 ? 1 : 0), down: t.down + (delta < 0 ? 1 : 0), note: t.note + (delta === 0 ? 1 : 0),
      kept: t.kept + (changed === 'kept' ? 1 : 0), eliminated: t.eliminated + (changed === 'eliminated' ? 1 : 0),
    }))
    const sign = delta > 0 ? '+1' : delta < 0 ? '−1' : '已记录'
    setFlash(changed
      ? { text: `${sign}，达到${changed === 'kept' ? '留存线，已留存' : '淘汰线，已淘汰'}`, tone: changed === 'kept' ? 'pos' : 'neg' }
      : { text: `${sign}`, tone: delta > 0 ? 'pos' : delta < 0 ? 'neg' : 'info' })
    setTimeout(() => { setFlash(null); setIdx((i) => i + 1); setBusy(false) }, changed ? 1300 : 550)
  }

  const progress = useMemo(() => (queue?.length ? Math.min(idx, queue.length) / queue.length : 0), [idx, queue])

  if (!queue) return <div className="review-shell" />
  const done = idx >= queue.length

  return (
    <div className="review-shell">
      <header className="review-bar">
        <button className="btn ghost sm" onClick={exit}>← 退出复盘</button>
        <div className="review-scope">
          {single ? '单个策略' : scopeTopic ? scopeTopic.name : '全部主题'}
          {onlyDue && ' · 待复盘'}
        </div>
        <div className="review-count">{queue.length ? `${Math.min(idx + 1, queue.length)} / ${queue.length}` : ''}</div>
        <div className="review-progress"><div style={{ width: `${progress * 100}%` }} /></div>
      </header>

      <main className="review-main">
        {queue.length === 0 ? (
          <div className="review-done">
            <h1>没有需要复盘的策略</h1>
            <p className="muted">{onlyDue ? '最近都复盘过了。' : '这里还没有在用的策略。'}</p>
            <button className="btn primary" onClick={exit}>返回</button>
          </div>
        ) : done ? (
          <div className="review-done">
            <h1>复盘完成</h1>
            <div className="tally">
              <div><b className="pos">{tally.up}</b><span>好用</span></div>
              <div><b className="neg">{tally.down}</b><span>不好用</span></div>
              <div><b>{tally.note}</b><span>只记录</span></div>
            </div>
            {(tally.kept > 0 || tally.eliminated > 0) && (
              <p className="muted">本次 {tally.kept > 0 && `留存 ${tally.kept} 个`}{tally.kept > 0 && tally.eliminated > 0 && '，'}{tally.eliminated > 0 && `淘汰 ${tally.eliminated} 个`}</p>
            )}
            <div className="row-btns center">
              <button className="btn primary" onClick={exit}>完成</button>
            </div>
          </div>
        ) : s && topic ? (
          <section className="review-card" key={s.id}>
            <div className="review-topic"><span className="dot" style={{ background: topic.color }} />{topic.name}</div>
            <h1 className="review-title">{s.title || '未命名策略'}</h1>
            <div className="review-meta">
              <StatusBadge status={s.status} />
              <Score score={s.score} />
              <span className="muted sm">
                已使用 {daysSince(s.createdAt)} 天 · {reviews?.length ? `上次复盘 ${fmtRelative(reviews[0].createdAt)}` : '还没复盘过'}
              </span>
              <span className="review-hint">
                {s.status === 'trial' ? `再 +${topic.keepAt - s.score} 留存 · 再 −${s.score - topic.eliminateAt} 淘汰` : `再 −${s.score - topic.eliminateAt} 淘汰`}
              </span>
            </div>

            {s.content.trim() && (
              <div ref={contentRef} className={`review-content ${expanded ? 'open' : ''}`}>
                <Suspense fallback={null}><Editor key={s.id} value={s.content} readOnly /></Suspense>
                {!expanded && overflow && <button className="review-expand" onClick={() => setExpanded(true)}>展开全文</button>}
              </div>
            )}

            {reviews && reviews.length > 0 && (
              <div className="review-history">
                <div className="label">之前的复盘</div>
                {reviews.filter((r) => r.note || r.statusChange).slice(0, 3).map((r) => (
                  <div key={r.id} className="review-history-row">
                    <span className={`delta ${r.delta > 0 ? 'pos' : r.delta < 0 ? 'neg' : ''}`}>{r.delta > 0 ? `+${r.delta}` : r.delta < 0 ? r.delta : '·'}</span>
                    <span>{r.note || (r.statusChange && `${STATUS_LABEL[r.statusChange.from as Status]} → ${STATUS_LABEL[r.statusChange.to as Status]}`)}</span>
                    <span className="muted sm">{fmtRelative(r.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="review-ask">
              <label htmlFor="review-note">这段时间用下来怎么样？</label>
              <textarea id="review-note" ref={noteRef} rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="写一句感受或观察（可选，「只记录」时必填）"
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) act(1) }} />
              <div className="review-actions">
                <button className="btn neg lg" disabled={busy} onClick={() => act(-1)}>不好用 −1</button>
                <button className="btn lg" disabled={busy} onClick={() => act(0)} title="不改变分数，只记下这次观察">只记录</button>
                <button className="btn pos lg" disabled={busy} onClick={() => act(1)}>好用 +1</button>
              </div>
              <div className="review-skip">
                <button className="link-btn" disabled={busy} onClick={() => setIdx((i) => i + 1)}>跳过这个</button>
                <Link to={`/strategy/${s.id}`} className="link-btn">去编辑策略</Link>
              </div>
            </div>
            {flash && <div className={`review-flash ${flash.tone}`}>{flash.text}</div>}
          </section>
        ) : (
          <div className="review-done">
            <p className="muted">这个策略已不存在。</p>
            <button className="btn" onClick={() => setIdx((i) => i + 1)}>下一个</button>
          </div>
        )}
      </main>
    </div>
  )
}
