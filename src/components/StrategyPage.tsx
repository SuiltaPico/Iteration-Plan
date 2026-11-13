import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  createStrategy, db, deleteStrategy, mergeDraftIntoOriginal, pendingToDraft, publishDraft, setStatus,
  STATUS_LABEL, updateStrategy, type Status, type Strategy,
} from '../db'
import { Score, ScoreMeter, StatusBadge } from './ScoreBadge'
import { confirmDialog, toast } from './Dialogs'
import Menu from './Menu'
import { contentChanged, flushEditors, openAi } from '../bus'
import { daysSince, fmtDate, fmtRelative } from '../util'

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
  const original = useLiveQuery(() => (s.draftOf ? db.strategies.get(s.draftOf) : undefined), [s.draftOf])
  const isDraft = !!s.isDraft

  // 编辑中的文档（标题 + 正文）。正式策略需要手动保存；草稿自动保存。
  const [title, setTitle] = useState(s.title)
  const [seed, setSeed] = useState({ content: s.content, rev: 0 })
  const doc = useRef({ title: s.title, content: s.content })
  const [dirty, setDirty] = useState(false)
  const [moving, setMoving] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const skipDraftOnLeave = useRef(false)
  const sRef = useRef(s)
  sRef.current = s

  const isDirty = () => doc.current.title !== sRef.current.title || doc.current.content !== sRef.current.content

  /** 落盘：草稿直接保存；正式策略写入「未保存修改」暂存 */
  const persist = useCallback(async () => {
    clearTimeout(timer.current)
    const cur = sRef.current
    if (cur.isDraft) {
      if (isDirty()) await updateStrategy(cur.id, { title: doc.current.title, content: doc.current.content })
    } else if (isDirty()) {
      await db.pending.put({ strategyId: cur.id, ...doc.current, updatedAt: Date.now() })
    } else {
      await db.pending.delete(cur.id)
    }
  }, [])

  const onEdit = () => {
    setDirty(isDirty())
    clearTimeout(timer.current)
    timer.current = window.setTimeout(persist, isDraft ? 600 : 400)
  }
  const onContent = (md: string) => { doc.current.content = md; onEdit() }
  const onTitle = (t: string) => { setTitle(t); doc.current.title = t; onEdit() }

  // 离开页面：正式策略的未保存修改另存为草稿
  useEffect(() => () => {
    clearTimeout(timer.current)
    const cur = sRef.current
    if (skipDraftOnLeave.current) return
    if (cur.isDraft) { if (isDirty()) updateStrategy(cur.id, { ...doc.current }); return }
    if (!isDirty()) return
    db.pending.put({ strategyId: cur.id, ...doc.current, updatedAt: Date.now() })
      .then(() => pendingToDraft(cur.id))
      .then((d) => d && toast(`未保存的修改已存为草稿「${d.title}」`))
  }, [])

  // AI 运行前先落盘；AI 改写后重新载入
  useEffect(() => flushEditors.on(() => { persist() }), [persist])
  useEffect(() => contentChanged.on(async (id) => {
    if (id !== s.id) return
    clearTimeout(timer.current)
    await db.pending.delete(id)
    const fresh = await db.strategies.get(id)
    if (!fresh) return
    doc.current = { title: fresh.title, content: fresh.content }
    setTitle(fresh.title)
    setSeed((p) => ({ content: fresh.content, rev: p.rev + 1 }))
    setDirty(false)
  }), [s.id])
  // 外部（AI）只改了标题时同步
  const lastTitle = useRef(s.title)
  useEffect(() => {
    if (s.title !== lastTitle.current && doc.current.title === lastTitle.current) {
      doc.current.title = s.title
      setTitle(s.title)
    }
    lastTitle.current = s.title
    setDirty(isDirty())
  }, [s.title, s.content])

  async function save() {
    if (isDraft || !isDirty()) return
    clearTimeout(timer.current)
    await updateStrategy(s.id, { ...doc.current })
    await db.pending.delete(s.id)
    setDirty(false)
    toast('已保存')
  }

  async function saveAsNew() {
    clearTimeout(timer.current)
    const n = await createStrategy(s.topicId, doc.current.title.trim() || '未命名策略', { content: doc.current.content })
    await db.pending.delete(s.id)
    skipDraftOnLeave.current = true
    toast('已另存为新策略，原策略保持不变')
    navigate(`/strategy/${n.id}`)
  }

  async function discard() {
    if (!(await confirmDialog('放弃未保存的修改，恢复到上次保存的版本？', { ok: '放弃修改' }))) return
    clearTimeout(timer.current)
    await db.pending.delete(s.id)
    doc.current = { title: s.title, content: s.content }
    setTitle(s.title)
    setSeed((p) => ({ content: s.content, rev: p.rev + 1 }))
    setDirty(false)
  }

  // Ctrl/Cmd + S
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (isDraft) persist(); else save() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function publish() {
    await persist()
    await publishDraft(s.id)
    toast('已发布，开始试用')
  }
  async function mergeBack() {
    if (!original) return
    if (!(await confirmDialog(`用这份草稿覆盖原策略「${original.title}」的标题和正文？草稿随后删除，原策略的分数和复盘记录保留。`, { ok: '覆盖原策略' }))) return
    await persist()
    skipDraftOnLeave.current = true
    const id = await mergeDraftIntoOriginal(s.id)
    if (id) { toast('已覆盖原策略'); navigate(`/strategy/${id}`) }
  }
  async function remove() {
    if (!(await confirmDialog(isDraft ? '删除这份草稿？' : '删除这个策略和它的复盘记录？此操作不可撤销。', { ok: '删除' }))) return
    skipDraftOnLeave.current = true
    const tid = s.topicId
    await deleteStrategy(s.id)
    navigate(`/topic/${tid}`)
  }
  async function manual(to: Status) {
    const msg = to === 'eliminated' ? '手动淘汰' : s.status === 'eliminated' ? '恢复试用（分数归零）' : to === 'kept' ? '手动留存' : '转回试用'
    await setStatus(s.id, to, msg)
    toast(msg)
  }

  if (!topic) return null

  const aiPrompt = doc.current.content.trim()
    ? '帮我完善这个策略的正文，补充具体做法和判断有效的标准'
    : `根据标题「${doc.current.title}」帮我写这个策略的正文`

  return (
    <div className="strategy-page">
      <div className="doc-bar">
        <div className="crumbs">
          <Link to={`/topic/${topic.id}`}><span className="dot" style={{ background: topic.color }} />{topic.name}</Link>
          <span className="sep">/</span>
          <span className="crumb-title">{title || '未命名策略'}</span>
        </div>
        <div className="doc-actions">
          {isDraft ? (
            <>
              <span className="save-state">草稿 · 自动保存</span>
              <button className="btn ghost danger" onClick={remove}>删除草稿</button>
              {original && <button className="btn" onClick={mergeBack}>覆盖原策略</button>}
              <button className="btn primary" onClick={publish}>开始试用</button>
            </>
          ) : (
            <>
              {dirty && <span className="save-state dirty"><i />未保存</span>}
              {dirty && <button className="btn ghost" onClick={discard}>放弃</button>}
              <button className="btn" disabled={!dirty} onClick={saveAsNew}>另存为新策略</button>
              <button className="btn primary" disabled={!dirty} onClick={save} title="Ctrl/⌘ + S">保存</button>
            </>
          )}
          <span className="bar-sep" />
          <button className="btn ghost" onClick={() => openAi.emit({ prompt: aiPrompt, send: true })}>✦ AI 帮写</button>
          <Menu items={[
            { label: '移动到其他主题…', onClick: () => setMoving(true) },
            { label: '直接留存', onClick: () => manual('kept'), hidden: isDraft || s.status !== 'trial' },
            { label: '转回试用', onClick: () => manual('trial'), hidden: isDraft || s.status !== 'kept' },
            { label: '恢复试用（分数归零）', onClick: () => manual('trial'), hidden: isDraft || s.status !== 'eliminated' },
            { label: '手动淘汰', onClick: () => manual('eliminated'), hidden: isDraft || s.status === 'eliminated', danger: true },
            { label: isDraft ? '删除草稿' : '删除策略', onClick: remove, danger: true },
          ]} />
        </div>
      </div>

      <div className="strategy-layout">
        <article className="doc">
          <input id="strategy-title" className="title-input" value={title} onChange={(e) => onTitle(e.target.value)} placeholder="策略标题" />
          <div className="doc-meta">
            {isDraft ? <span className="badge badge-draft">草稿</span> : <StatusBadge status={s.status} />}
            <span className="muted sm">{isDraft ? `编辑于 ${fmtRelative(s.updatedAt)}` : `创建于 ${fmtDate(s.createdAt).slice(0, 10)} · 已使用 ${daysSince(s.createdAt)} 天`}</span>
          </div>
          <Suspense fallback={<div className="editor muted" style={{ padding: '16px 56px' }}>加载编辑器…</div>}>
            <Editor key={seed.rev} value={seed.content} onChange={onContent} />
          </Suspense>
        </article>

        <aside className="rail">
          {isDraft ? (
            <section className="rail-card">
              <h4>这是一份草稿</h4>
              <p className="muted sm">
                {original
                  ? <>来自 <Link to={`/strategy/${original.id}`}>「{original.title}」</Link> 未保存的修改。可以「开始试用」作为新策略，或「覆盖原策略」。</>
                  : '草稿会自动保存，不参与复盘打分。写好后点「开始试用」。'}
              </p>
            </section>
          ) : (
            <section className="rail-card">
              <div className="rail-score">
                <Score score={s.score} size="lg" />
                <div>
                  <StatusBadge status={s.status} />
                  <div className="muted sm">{reviews?.length ? `复盘 ${reviews.length} 次 · 上次 ${fmtRelative(reviews[0].createdAt)}` : '还没复盘过'}</div>
                </div>
              </div>
              <ScoreMeter score={s.score} topic={topic} />
              {s.status !== 'eliminated' && (
                <Link to={`/review?s=${s.id}`} className="btn primary full center">复盘</Link>
              )}
            </section>
          )}

          {!isDraft && reviews && reviews.length > 0 && (
            <section className="rail-card">
              <h4>复盘记录</h4>
              <ol className="timeline">
                {reviews.map((r) => (
                  <li key={r.id}>
                    <span className={`delta ${r.delta > 0 ? 'pos' : r.delta < 0 ? 'neg' : ''}`}>
                      {r.delta > 0 ? `+${r.delta}` : r.delta < 0 ? r.delta : '·'}
                    </span>
                    <div className="tl-body">
                      {r.statusChange && <div className="status-change">{STATUS_LABEL[r.statusChange.from]} → <b>{STATUS_LABEL[r.statusChange.to]}</b></div>}
                      {r.note && <div>{r.note}</div>}
                      <div className="muted sm">{fmtDate(r.createdAt)} · 分数 {r.scoreAfter}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </aside>
      </div>

      {moving && topics && (
        <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && setMoving(false)}>
          <div className="modal">
            <h2>移动到主题</h2>
            <div className="move-list">
              {topics.map((t) => (
                <button key={t.id} className={`move-item ${t.id === s.topicId ? 'on' : ''}`} onClick={async () => {
                  await updateStrategy(s.id, { topicId: t.id }); setMoving(false); toast(`已移动到「${t.name}」`)
                }}>
                  <span className="dot" style={{ background: t.color }} />{t.name}{t.id === s.topicId && <span className="muted sm">（当前）</span>}
                </button>
              ))}
            </div>
            <div className="modal-actions"><button className="btn ghost" onClick={() => setMoving(false)}>取消</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
