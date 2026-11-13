import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  addReview, CRITERIA_LABEL, db, OUTCOME_LABEL, outcomeOf, outcomeTally, setStatus, skippedRecently, STATUS_LABEL, versionOf,
  type CriteriaMet, type Outcome, type Status,
} from '../db'
import { daysSince, fmtRelative } from '../util'
import { Score, StatusBadge } from './ScoreBadge'
import { LogRow } from './QuickLog'
import EmojiPicker from './EmojiPicker'

const Editor = lazy(() => import('./Editor'))

/** 专注复盘：只看一个策略，说说用下来怎么样 */
export default function ReviewMode() {
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const id = params.get('s') ?? ''
  const fromCheckIn = params.get('from') === 'checkin'
  const [note, setNote] = useState('')
  const [met, setMet] = useState<CriteriaMet | undefined>()
  const [decision, setDecision] = useState<Status | undefined>()
  const [emoji, setEmoji] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<{ text: string; tone: 'pos' | 'neg' | 'info' } | null>(null)
  const [askLesson, setAskLesson] = useState(false)
  const [lesson, setLesson] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [overflow, setOverflow] = useState(false)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const backTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => clearTimeout(backTimer.current), [])

  const s = useLiveQuery(() => db.strategies.get(id).then((x) => x ?? null), [id])
  const topic = useLiveQuery(() => (s ? db.topics.get(s.topicId) : undefined), [s?.topicId])
  const problem = useLiveQuery(() => (s?.problemId ? db.problems.get(s.problemId) : undefined), [s?.problemId])
  const reviews = useLiveQuery(() => db.reviews.where('strategyId').equals(id).reverse().sortBy('createdAt'), [id])
  const logs = useLiveQuery(() => db.logs.where('strategyId').equals(id).reverse().sortBy('createdAt'), [id])

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

  async function act(outcome: Outcome) {
    if (!s || busy) return
    if (outcome === 'note' && !note.trim()) { noteRef.current?.focus(); return }
    setBusy(true)
    await addReview(s.id, outcome, note.trim(), s.criteria?.trim() && outcome !== 'skipped' && outcome !== 'note' ? met : undefined, emoji)
    const label = outcome === 'worked' ? '+1' : outcome === 'failed' ? '−1' : outcome === 'skipped' ? '记下了：没怎么执行' : '记下了'
    const to = decision && decision !== s.status ? decision : undefined
    if (to === 'eliminated') {
      // 决定淘汰：趁热记下教训，记完再改状态
      setFlash(null)
      setAskLesson(true)
      setBusy(false)
      return
    }
    if (to) await setStatus(s.id, to, to === 'kept' ? '复盘时决定留存' : '复盘时决定继续试用')
    setFlash(to === 'kept'
      ? { text: `${label}，已留存`, tone: 'pos' }
      : to === 'trial' ? { text: `${label}，转回试用`, tone: 'info' }
      : { text: label, tone: outcome === 'worked' ? 'pos' : outcome === 'failed' ? 'neg' : 'info' })
    backTimer.current = window.setTimeout(back, to ? 1200 : 700)
  }

  async function eliminate(withLesson: boolean) {
    if (s) await setStatus(s.id, 'eliminated', '复盘时决定淘汰', withLesson && lesson.trim() ? lesson.trim() : undefined)
    back()
  }

  if (s === undefined) return <div className="review-shell" />

  const skipped = s && reviews ? skippedRecently(s, reviews) : 0
  const tally = s && reviews ? outcomeTally(s, reviews) : { worked: 0, failed: 0, skipped: 0 }
  const history = (reviews ?? []).filter((r) => r.note || r.statusChange)
  const lastReviewAt = (reviews ?? []).find((r) => !r.event)?.createdAt ?? 0
  const newLogs = (logs ?? []).filter((l) => l.createdAt > lastReviewAt)

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
        ) : askLesson ? (
          <section className="review-card">
            <div className="review-topic"><span className="dot" style={{ background: topic.color }} />{topic.name}{problem && <> · {problem.title}</>}</div>
            <h1 className="review-title">淘汰「{s.title}」</h1>
            <div className="review-ask">
              <label htmlFor="review-lesson">为什么不行？学到了什么？</label>
              <textarea id="review-lesson" autoFocus rows={4} value={lesson} onChange={(e) => setLesson(e.target.value)}
                placeholder="例如：需要每天固定时间，但我的作息不规律，执行不了。下次找不依赖固定时间的做法。" />
              <p className="muted sm">会记在「{topic.name}」的「踩过的坑」里，以后你和 AI 出主意时都能参考。</p>
              <div className="row-btns end">
                <button className="btn ghost" onClick={() => eliminate(false)}>不写，直接淘汰</button>
                <button className="btn danger-fill" disabled={!lesson.trim()} onClick={() => eliminate(true)}>记下并淘汰</button>
              </div>
            </div>
          </section>
        ) : (
          <section className="review-card">
            <div className="review-topic"><span className="dot" style={{ background: topic.color }} />{topic.name}{problem && <> · {problem.title}</>}</div>
            <h1 className="review-title">{s.title || '未命名策略'}</h1>
            <div className="review-meta">
              <StatusBadge status={s.status} />
              <Score score={s.score} />
              {versionOf(s) > 1 && <span className="ver">v{versionOf(s)}</span>}
              <span className="muted sm">
                已使用 {daysSince(s.createdAt)} 天 · {lastReviewAt ? `上次复盘 ${fmtRelative(lastReviewAt)}` : '还没复盘过'}
              </span>
              {tally.worked + tally.failed + tally.skipped > 0 && (
                <span className="review-hint">{versionOf(s) > 1 ? '这一版' : '累计'}：有效 {tally.worked} · 无效 {tally.failed} · 没执行 {tally.skipped}</span>
              )}
            </div>

            {topic.goal?.trim() && (
              <div className="goal-box"><span className="goal-label">{topic.name}的目标</span>{topic.goal}</div>
            )}

            {s.criteria?.trim() && (
              <div className="criteria-box">
                <div className="label">怎么判断有效</div>
                <p>{s.criteria}</p>
              </div>
            )}

            {skipped >= 2 && (
              <div className="adherence">
                最近 {skipped} 次复盘都是「没怎么执行」。问题可能不在效果，而在太难坚持。
                考虑把它<Link to={`/strategy/${s.id}`}>简化成更容易做到的版本</Link>（存为新版本重新试用）。
              </div>
            )}

            {s.content.trim() && (
              <div ref={contentRef} className={`review-content ${expanded ? 'open' : ''}`}>
                <Suspense fallback={null}><Editor key={s.id} value={s.content} readOnly /></Suspense>
                {!expanded && overflow && <button className="review-expand" onClick={() => setExpanded(true)}>展开全文</button>}
              </div>
            )}

            {newLogs.length > 0 && (
              <div className="review-history">
                <div className="label">{lastReviewAt ? '上次复盘以来' : '这段时间'}记了 {newLogs.length} 笔</div>
                {newLogs.slice(0, 8).map((l) => <LogRow key={l.id} l={l} />)}
                {newLogs.length > 8 && <span className="muted sm">还有 {newLogs.length - 8} 笔较早的记录</span>}
              </div>
            )}

            {history.length > 0 && (
              <div className="review-history">
                <div className="label">之前说过</div>
                {history.slice(0, 3).map((r) => (
                  <div key={r.id} className="review-history-row">
                    <span className={`delta ${r.delta > 0 ? 'pos' : r.delta < 0 ? 'neg' : ''}`}>{r.event ? 'v' : r.delta > 0 ? `+${r.delta}` : r.delta < 0 ? r.delta : '·'}</span>
                    {r.emoji && <span className="log-emoji">{r.emoji}</span>}
                    <span>
                      {!r.event && outcomeOf(r) === 'skipped' && <span className="muted">没怎么执行 · </span>}
                      {r.note || (r.statusChange && `${STATUS_LABEL[r.statusChange.from as Status]} → ${STATUS_LABEL[r.statusChange.to as Status]}`)}
                    </span>
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
                <label htmlFor="review-note">这段时间用下来怎么样？{topic.goal?.trim() && '让你离目标更近了吗？'}</label>
                {s.criteria?.trim() && (
                  <div className="met-row">
                    <span className="muted sm">对照判断标准：</span>
                    {(Object.keys(CRITERIA_LABEL) as CriteriaMet[]).map((k) => (
                      <button key={k} className={`chip ${met === k ? 'on' : ''}`} onClick={() => setMet(met === k ? undefined : k)}>{CRITERIA_LABEL[k]}</button>
                    ))}
                  </div>
                )}
                <EmojiPicker value={emoji} onChange={setEmoji} />
                <textarea id="review-note" ref={noteRef} rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="写下感受、观察或想调整的地方（选「只记录」时必填）" />
                <div className="met-row">
                  <span className="muted sm">这次的决定：</span>
                  {(s.status === 'kept'
                    ? [['kept', '继续保留'], ['trial', '转回试用'], ['eliminated', '淘汰']]
                    : [['trial', '继续试用'], ['kept', '留存'], ['eliminated', '淘汰']]
                  ).map(([k, label]) => (
                    <button key={k} className={`chip ${(decision ?? s.status) === k ? 'on' : ''} ${k === 'eliminated' ? 'chip-danger' : ''}`}
                      onClick={() => setDecision(k as Status)}>{label}</button>
                  ))}
                </div>
                <div className="review-actions">
                  <button className="btn pos lg" disabled={busy} onClick={() => act('worked')}>{OUTCOME_LABEL.worked} <small>+1</small></button>
                  <button className="btn neg lg" disabled={busy} onClick={() => act('failed')}>{OUTCOME_LABEL.failed} <small>−1</small></button>
                  <button className="btn lg" disabled={busy} onClick={() => act('skipped')} title="不计分。多次没执行会提示你简化策略">{OUTCOME_LABEL.skipped}</button>
                </div>
                <button className="link-btn" disabled={busy} onClick={() => act('note')}>只记录观察，不评价</button>
              </div>
            )}
            {flash && <div className={`review-flash ${flash.tone}`}>{flash.text}</div>}
          </section>
        )}
      </main>
    </div>
  )
}
