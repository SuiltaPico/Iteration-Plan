import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { addReview, db, deleteStrategy, setStatus, STATUS_LABEL, updateStrategy, type Strategy } from '../db'
import { Score, ScoreMeter, StatusBadge } from './ScoreBadge'
import { confirmDialog } from './Dialogs'
import { contentChanged, flushEditors, openAi } from '../bus'
import { daysSince, fmtDate } from '../util'

const Editor = lazy(() => import('./Editor'))

export default function StrategyPage() {
  const { id = '' } = useParams()
  const strategy = useLiveQuery(() => db.strategies.get(id).then((x) => x ?? null), [id])
  if (strategy === undefined) return null
  if (!strategy) return <div className="page"><p className="muted">策略不存在</p></div>
  return <StrategyView key={strategy.id} s={strategy} />
}

function StrategyView({ s }: { s: Strategy }) {
  const navigate = useNavigate()
  const topic = useLiveQuery(() => db.topics.get(s.topicId), [s.topicId])
  const topics = useLiveQuery(() => db.topics.orderBy('order').toArray(), [])
  const reviews = useLiveQuery(() => db.reviews.where('strategyId').equals(s.id).reverse().sortBy('createdAt'), [s.id])
  const [title, setTitle] = useState(s.title)
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(true)
  const [flash, setFlash] = useState('')
  const timer = useRef<number | undefined>(undefined)
  const pending = useRef<string | null>(null)

  // 内容自动保存（防抖）
  const flush = () => {
    if (pending.current !== null) {
      updateStrategy(s.id, { content: pending.current })
      pending.current = null
      setSaved(true)
    }
  }
  const onContent = (md: string) => {
    pending.current = md
    setSaved(false)
    clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, 600)
  }
  useEffect(() => () => { clearTimeout(timer.current); flush() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // AI 运行前先保存未落盘的内容；AI 改写正文后重新载入编辑器
  const [seed, setSeed] = useState({ content: s.content, rev: 0 })
  useEffect(() => flushEditors.on(() => { clearTimeout(timer.current); flush() }), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => contentChanged.on(async (id) => {
    if (id !== s.id) return
    clearTimeout(timer.current)
    pending.current = null
    setSaved(true)
    const fresh = await db.strategies.get(id)
    if (fresh) setSeed((p) => ({ content: fresh.content, rev: p.rev + 1 }))
  }), [s.id])

  const titleInit = useRef(true)
  const lastTitle = useRef(s.title)
  useEffect(() => {
    // 外部（AI）改了标题时同步到输入框
    if (s.title !== lastTitle.current && s.title !== title) { titleInit.current = true; setTitle(s.title) }
    lastTitle.current = s.title
  }, [s.title]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (titleInit.current) { titleInit.current = false; return }
    const t = window.setTimeout(() => updateStrategy(s.id, { title }), 400)
    return () => clearTimeout(t)
  }, [title, s.id])

  async function review(delta: number) {
    const changed = await addReview(s.id, delta, note.trim())
    setNote('')
    if (changed) setFlash(changed === 'eliminated' ? '分数触及淘汰线，策略已被淘汰' : '分数达到留存线，策略已留存 🎉')
  }

  async function manual(to: Strategy['status']) {
    const msg = to === 'eliminated' ? '手动淘汰' : s.status === 'eliminated' ? '恢复试用（分数归零）' : to === 'kept' ? '手动留存' : '转回试用'
    await setStatus(s.id, to, note.trim() || msg)
    setNote('')
    setFlash('')
  }

  async function remove() {
    if (!(await confirmDialog('删除这个策略？此操作不可撤销。', { ok: '删除' }))) return
    const tid = s.topicId
    pending.current = null
    await deleteStrategy(s.id)
    navigate(`/topic/${tid}`)
  }

  if (!topic) return null

  return (
    <div className="page strategy-page">
      <div className="crumbs">
        <Link to={`/topic/${topic.id}`}><span className="dot" style={{ background: topic.color }} />{topic.name}</Link>
        <span>/</span>
        <span className="muted">{saved ? '已保存' : '保存中…'}</span>
      </div>

      <div className="strategy-layout">
        <article className="doc">
          <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="策略标题" />
          <div className="doc-meta">
            <StatusBadge status={s.status} />
            <span className="muted sm">创建于 {fmtDate(s.createdAt)} · 已使用 {daysSince(s.createdAt)} 天</span>
            <span style={{ flex: 1 }} />
            <button className="btn sm" onClick={() => openAi.emit({ prompt: s.content.trim() ? '帮我完善这个策略的正文，补充具体做法和判断有效的标准' : `根据标题「${title}」帮我写这个策略的正文`, send: true })}>✦ AI 帮写</button>
          </div>
          <Suspense fallback={<div className="editor muted" style={{ padding: '16px 48px' }}>加载编辑器…</div>}>
            <Editor key={seed.rev} value={seed.content} onChange={onContent} />
          </Suspense>
        </article>

        <aside className="panel">
          <div className="panel-card">
            <div className="score-head">
              <Score score={s.score} size="lg" />
              <div>
                <div className="sm muted">当前分数</div>
                <StatusBadge status={s.status} />
              </div>
            </div>
            <ScoreMeter score={s.score} topic={topic} />

            {s.status !== 'eliminated' ? (
              <>
                <textarea className="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="这段时间用下来怎么样？（可选）" />
                <div className="review-btns">
                  <button className="btn neg" onClick={() => review(-1)}>👎 不好用 −1</button>
                  <button className="btn pos" onClick={() => review(1)}>👍 好用 +1</button>
                </div>
                <button className="btn ghost sm full" onClick={() => review(0)} disabled={!note.trim()}>只记录观察，不打分</button>
              </>
            ) : (
              <p className="muted sm">这个策略已被淘汰。如果想再试一次，可以恢复试用。</p>
            )}
            {flash && <div className="flash">{flash}</div>}

            <div className="manual">
              {s.status !== 'eliminated' && <button className="link-btn danger" onClick={() => manual('eliminated')}>手动淘汰</button>}
              {s.status === 'eliminated' && <button className="btn ghost sm" onClick={() => manual('trial')}>恢复试用</button>}
              {s.status === 'trial' && <button className="link-btn" onClick={() => manual('kept')}>直接留存</button>}
              {s.status === 'kept' && <button className="link-btn" onClick={() => manual('trial')}>转回试用</button>}
            </div>
          </div>

          <div className="panel-card">
            <h3 className="sec-title">复盘记录</h3>
            {reviews?.length ? (
              <ol className="timeline">
                {reviews.map((r) => (
                  <li key={r.id}>
                    <span className={`delta ${r.delta > 0 ? 'pos' : r.delta < 0 ? 'neg' : ''}`}>
                      {r.delta > 0 ? `+${r.delta}` : r.delta < 0 ? r.delta : '·'}
                    </span>
                    <div>
                      {r.statusChange && (
                        <div className="status-change">{STATUS_LABEL[r.statusChange.from]} → <b>{STATUS_LABEL[r.statusChange.to]}</b></div>
                      )}
                      {r.note && <div>{r.note}</div>}
                      <div className="muted sm">{fmtDate(r.createdAt)} · 分数 {r.scoreAfter}</div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : <p className="muted sm">还没有复盘记录</p>}
          </div>

          <div className="panel-card">
            <label className="field">
              <span>所属主题</span>
              <select className="select" value={s.topicId} onChange={(e) => updateStrategy(s.id, { topicId: e.target.value })}>
                {topics?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <button className="link-btn danger" onClick={remove}>删除策略</button>
          </div>
        </aside>
      </div>
    </div>
  )
}
