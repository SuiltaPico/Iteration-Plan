import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  createStrategy, CRITERIA_LABEL, db, deleteLog, deleteStrategy, mergeDraftIntoOriginal, OUTCOME_LABEL, outcomeOf, pendingToDraft,
  outcomeTally, publishDraft, saveAsNewVersion, setStatus, skippedRecently, STATUS_LABEL, updateStrategy, versionOf,
  type Status, type Strategy,
} from '../db'
import { Score, StatusBadge } from './ScoreBadge'
import { confirmDialog, toast } from './Dialogs'
import Menu from './Menu'
import { LogRow } from './QuickLog'
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

type Doc = { title: string; content: string; criteria: string }
const docOf = (s: Strategy): Doc => ({ title: s.title, content: s.content, criteria: s.criteria ?? '' })
const sameDoc = (a: Doc, b: Doc) => a.title === b.title && a.content === b.content && a.criteria === b.criteria

function StrategyView({ s }: { s: Strategy }) {
  const navigate = useNavigate()
  const topic = useLiveQuery(() => db.topics.get(s.topicId), [s.topicId])
  const problem = useLiveQuery(() => (s.problemId ? db.problems.get(s.problemId) : undefined), [s.problemId])
  const reviews = useLiveQuery(() => db.reviews.where('strategyId').equals(s.id).reverse().sortBy('createdAt'), [s.id])
  const original = useLiveQuery(() => (s.draftOf ? db.strategies.get(s.draftOf) : undefined), [s.draftOf])
  const parent = useLiveQuery(() => (s.parentId ? db.strategies.get(s.parentId) : undefined), [s.parentId])
  const children = useLiveQuery(() => db.strategies.where('parentId').equals(s.id).toArray(), [s.id])
  const drafts = useLiveQuery(() => db.strategies.filter((x) => x.draftOf === s.id).toArray(), [s.id])
  const logs = useLiveQuery(() => db.logs.where('strategyId').equals(s.id).reverse().sortBy('createdAt'), [s.id])
  const isDraft = !!s.isDraft

  // 编辑中的文档（标题 + 判断标准 + 正文）。正式策略需要手动保存；草稿自动保存。
  const [title, setTitle] = useState(s.title)
  const [criteria, setCriteria] = useState(s.criteria ?? '')
  const [seed, setSeed] = useState({ content: s.content, rev: 0 })
  const doc = useRef<Doc>(docOf(s))
  const [dirty, setDirty] = useState(false)
  const [moving, setMoving] = useState(false)
  const [eliminating, setEliminating] = useState(false)
  const [editingLesson, setEditingLesson] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const skipDraftOnLeave = useRef(false)
  const sRef = useRef(s)
  sRef.current = s

  const isDirty = () => !sameDoc(doc.current, docOf(sRef.current))

  /** 落盘：草稿直接保存；正式策略写入「未保存修改」暂存 */
  const persist = useCallback(async () => {
    clearTimeout(timer.current)
    const cur = sRef.current
    if (cur.isDraft) {
      if (isDirty()) await updateStrategy(cur.id, { ...doc.current })
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
  const onCriteria = (t: string) => { setCriteria(t); doc.current.criteria = t; onEdit() }

  const reload = (d: Doc) => {
    doc.current = { ...d }
    setTitle(d.title)
    setCriteria(d.criteria)
    setSeed((p) => ({ content: d.content, rev: p.rev + 1 }))
    setDirty(false)
  }

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
    if (fresh) reload(docOf(fresh))
  }), [s.id])
  // 外部（AI）改了标题或判断标准时，未被本地修改的字段跟着同步
  const last = useRef(docOf(s))
  useEffect(() => {
    const now = docOf(s)
    if (now.title !== last.current.title && doc.current.title === last.current.title) { doc.current.title = now.title; setTitle(now.title) }
    if (now.criteria !== last.current.criteria && doc.current.criteria === last.current.criteria) { doc.current.criteria = now.criteria; setCriteria(now.criteria) }
    last.current = now
    setDirty(isDirty())
  }, [s.title, s.content, s.criteria])

  async function save() {
    if (isDraft || !isDirty()) return
    clearTimeout(timer.current)
    await updateStrategy(s.id, { ...doc.current })
    await db.pending.delete(s.id)
    setDirty(false)
    toast('已保存')
  }

  async function saveNewVersion() {
    const v = versionOf(s) + 1
    if (!(await confirmDialog(`存为第 ${v} 版？改动较大时用它：分数清零、重新开始试用，之前的复盘记录保留并标为第 ${v - 1} 版。`, { ok: `存为第 ${v} 版`, danger: false }))) return
    clearTimeout(timer.current)
    await saveAsNewVersion(s.id, { ...doc.current })
    setDirty(false)
    toast(`已存为第 ${v} 版，重新开始试用`)
  }

  async function saveAsNew() {
    clearTimeout(timer.current)
    const n = await createStrategy(s.topicId, doc.current.title.trim() || '未命名策略', {
      content: doc.current.content, criteria: doc.current.criteria, problemId: s.problemId, parentId: s.id,
    })
    await db.pending.delete(s.id)
    skipDraftOnLeave.current = true
    toast('已另存为新策略，原策略保持不变')
    navigate(`/strategy/${n.id}`)
  }

  async function discard() {
    if (!(await confirmDialog('放弃未保存的修改，恢复到上次保存的版本？', { ok: '放弃修改' }))) return
    clearTimeout(timer.current)
    await db.pending.delete(s.id)
    reload(docOf(s))
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
    if (!(await confirmDialog(`用这份草稿覆盖原策略「${original.title}」的内容？草稿随后删除，原策略的分数和复盘记录保留。`, { ok: '覆盖原策略' }))) return
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
    const msg = s.status === 'eliminated' ? '恢复试用' : to === 'kept' ? '决定留存' : '转回试用'
    await setStatus(s.id, to, msg)
    toast(msg)
  }

  if (!topic) return null

  const aiPrompt = doc.current.content.trim()
    ? '帮我完善这个策略：补充具体做法，并写清楚怎么判断有效'
    : `根据标题「${doc.current.title}」帮我写这个策略的正文和判断标准`
  const skipped = reviews ? skippedRecently(s, reviews) : 0
  const realChildren = (children ?? []).filter((c) => !c.isDraft)

  return (
    <div className="strategy-page">
      <div className="doc-bar">
        <div className="crumbs">
          <Link to={`/topic/${topic.id}`}><span className="dot" style={{ background: topic.color }} />{topic.name}</Link>
          {problem && <><span className="sep">/</span><Link to={`/topic/${topic.id}#p-${problem.id}`}>{problem.title}</Link></>}
          <span className="sep">/</span>
          <span className="crumb-title">{title || '未命名策略'}</span>
        </div>
        <div className="doc-actions">
          {isDraft ? (
            <>
              <span className="save-state">草稿 · 自动保存</span>
              {original && <button className="btn" onClick={mergeBack}>覆盖原策略</button>}
              <button className="btn primary" onClick={publish}>开始试用</button>
            </>
          ) : (
            <>
              {dirty && <span className="save-state dirty"><i />未保存</span>}
              {dirty && <button className="btn ghost" onClick={discard}>放弃</button>}
              <div className="split">
                <button className="btn primary" disabled={!dirty} onClick={save} title="小改动，分数保留（Ctrl/⌘ + S）">保存</button>
                <Menu label="其他保存方式" trigger="▾" triggerClass="btn primary split-caret" items={[
                  { label: `存为第 ${versionOf(s) + 1} 版（重新试用）`, onClick: saveNewVersion, hidden: !dirty },
                  { label: '另存为新策略', onClick: saveAsNew },
                ]} />
              </div>
            </>
          )}
          <span className="bar-sep" />
          <button className="btn ghost" onClick={() => openAi.emit({ prompt: aiPrompt, send: true })}>✦ AI 帮写</button>
          <Menu items={[
            { label: '移动到…', onClick: () => setMoving(true) },
            { label: '让 AI 判断去留', onClick: () => openAi.emit({ prompt: '根据这个策略的复盘、判断标准和使用记录，判断它该留存、继续试用还是淘汰，证据够就直接执行', send: true }), hidden: isDraft },
            { label: '留存', onClick: () => manual('kept'), hidden: isDraft || s.status !== 'trial' },
            { label: '转回试用', onClick: () => manual('trial'), hidden: isDraft || s.status !== 'kept' },
            { label: '恢复试用', onClick: () => manual('trial'), hidden: isDraft || s.status !== 'eliminated' },
            { label: '淘汰…', onClick: () => setEliminating(true), hidden: isDraft || s.status === 'eliminated', danger: true },
            { label: isDraft ? '删除草稿' : '删除策略', onClick: remove, danger: true },
          ]} />
        </div>
      </div>

      <div className="strategy-layout">
        <article className="doc">
          <input id="strategy-title" className="title-input" value={title} onChange={(e) => onTitle(e.target.value)} placeholder="策略标题" />
          <div className="doc-meta">
            {isDraft ? <span className="badge badge-draft">草稿</span> : <StatusBadge status={s.status} />}
            {!isDraft && versionOf(s) > 1 && <span className="ver">v{versionOf(s)}</span>}
            <span className="muted sm">{isDraft ? `编辑于 ${fmtRelative(s.updatedAt)}` : `创建于 ${fmtDate(s.createdAt).slice(0, 10)} · 已使用 ${daysSince(s.createdAt)} 天`}</span>
          </div>
          <label className="criteria-field">
            <span>怎么判断有效</span>
            <textarea id="strategy-criteria" rows={1} value={criteria} onChange={(e) => onCriteria(e.target.value)}
              placeholder="可观察的信号，例如：两周内入睡时间稳定在 30 分钟内。复盘时会对照它回答。"
              onInput={(e) => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px` }}
              ref={(t) => { if (t) { t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px` } }} />
          </label>
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
                  : '草稿会自动保存，不参与复盘。写好后点「开始试用」。'}
              </p>
            </section>
          ) : (
            <section className="rail-card">
              <div className="rail-score">
                <Score score={s.score} size="lg" />
                <div>
                  <span className="row-inline"><StatusBadge status={s.status} />{versionOf(s) > 1 && <span className="ver">v{versionOf(s)}</span>}</span>
                  <div className="muted sm">{reviews?.some((r) => !r.event) ? `上次复盘 ${fmtRelative(reviews.find((r) => !r.event)!.createdAt)}` : '还没复盘过'}</div>
                </div>
              </div>
              {reviews && (() => { const t = outcomeTally(s, reviews); return t.worked + t.failed + t.skipped > 0 && (
                <div className="tally-line">{versionOf(s) > 1 ? '这一版' : '累计'}：<b className="pos">有效 {t.worked}</b> · <b className="neg">无效 {t.failed}</b> · <b className="warn">没执行 {t.skipped}</b></div>
              ) })()}
              {s.status !== 'eliminated' && (
                <div className="rail-actions">
                  <Link to={`/log?s=${s.id}&fixed=1`} className="btn center">记一笔</Link>
                  <Link to={`/review?s=${s.id}`} className="btn primary center">复盘</Link>
                </div>
              )}
            </section>
          )}

          {!isDraft && skipped >= 2 && (
            <section className="rail-card adherence">
              最近 {skipped} 次复盘都是「没怎么执行」，可能太难坚持。试试把它简化，然后「存为新版本」重新试用。
            </section>
          )}

          {!isDraft && s.status === 'eliminated' && (
            <section className="rail-card">
              <h4>淘汰原因</h4>
              {editingLesson ? (
                <LessonEditor initial={s.lesson ?? ''} onDone={async (v) => {
                  if (v !== undefined) await updateStrategy(s.id, { lesson: v })
                  setEditingLesson(false)
                }} />
              ) : (
                <>
                  {s.lesson ? <p className="lesson-text">{s.lesson}</p> : <p className="muted sm">还没记下为什么不行。</p>}
                  <button className="link-btn" onClick={() => setEditingLesson(true)}>{s.lesson ? '修改' : '记下教训'}</button>
                </>
              )}
            </section>
          )}

          {(parent || realChildren.length > 0 || (drafts?.length ?? 0) > 0) && (
            <section className="rail-card">
              <h4>演化</h4>
              {parent && <p className="sm">改自 <Link to={`/strategy/${parent.id}`}>「{parent.title}」</Link>{parent.status === 'eliminated' && <span className="muted">（已淘汰）</span>}</p>}
              {realChildren.length > 0 && (
                <div className="sm">衍生出：{realChildren.map((c, i) => <span key={c.id}>{i > 0 && '、'}<Link to={`/strategy/${c.id}`}>「{c.title}」</Link></span>)}</div>
              )}
              {drafts && drafts.length > 0 && (
                <div className="sm">未处理的草稿：{drafts.map((c, i) => <span key={c.id}>{i > 0 && '、'}<Link to={`/strategy/${c.id}`}>「{c.title}」</Link></span>)}</div>
              )}
            </section>
          )}

          {!isDraft && logs && logs.length > 0 && (
            <section className="rail-card">
              <h4>使用记录</h4>
              <div className="log-list">
                {logs.slice(0, 6).map((l) => <LogRow key={l.id} l={l} onDelete={async () => {
                  if (await confirmDialog('删除这条使用记录？', { ok: '删除' })) deleteLog(l.id)
                }} />)}
                {logs.length > 6 && <span className="muted sm">共 {logs.length} 笔</span>}
              </div>
            </section>
          )}

          {!isDraft && reviews && reviews.length > 0 && (
            <section className="rail-card">
              <h4>复盘记录</h4>
              <ol className="timeline">
                {reviews.map((r) => r.event === 'new-version' ? (
                  <li key={r.id} className="tl-version"><span>第 {r.version} 版 · {fmtDate(r.createdAt).slice(0, 10)}</span></li>
                ) : (
                  <li key={r.id}>
                    <span className={`delta ${r.delta > 0 ? 'pos' : r.delta < 0 ? 'neg' : ''}`}>
                      {r.delta > 0 ? `+${r.delta}` : r.delta < 0 ? r.delta : '·'}
                    </span>
                    <div className="tl-body">
                      {r.emoji && <span className="tl-emoji">{r.emoji}</span>}
                      {r.statusChange && <div className="status-change">{STATUS_LABEL[r.statusChange.from]} → <b>{STATUS_LABEL[r.statusChange.to]}</b></div>}
                      {!r.statusChange && r.outcome && r.outcome !== 'note' && (
                        <div className={`outcome o-${outcomeOf(r)}`}>{OUTCOME_LABEL[outcomeOf(r)]}{r.criteriaMet && <span className="muted"> · 标准{CRITERIA_LABEL[r.criteriaMet]}</span>}</div>
                      )}
                      {r.note && <div>{r.note}</div>}
                      <div className="muted sm">{fmtDate(r.createdAt)}{versionOf(s) > 1 && ` · v${r.version ?? 1}`}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </aside>
      </div>

      {moving && <MoveDialog s={s} onClose={() => setMoving(false)} />}
      {eliminating && (
        <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && setEliminating(false)}>
          <div className="modal">
            <h2>淘汰「{s.title}」</h2>
            <p className="muted sm">为什么不行？学到了什么？会记在「{topic.name}」的「踩过的坑」里，可以不填。</p>
            <LessonEditor initial="" okLabel="淘汰" danger onDone={async (v) => {
              setEliminating(false)
              if (v === undefined) return
              await setStatus(s.id, 'eliminated', '决定淘汰', v || undefined)
              toast('已淘汰')
            }} />
          </div>
        </div>
      )}
    </div>
  )
}

function LessonEditor({ initial, onDone, okLabel = '保存', danger }: { initial: string; onDone: (v?: string) => void; okLabel?: string; danger?: boolean }) {
  const [v, setV] = useState(initial)
  return (
    <div className="lesson-editor">
      <textarea id="lesson-input" autoFocus rows={3} value={v} onChange={(e) => setV(e.target.value)}
        placeholder="例如：需要每天固定时间，但作息不规律，执行不了。" />
      <div className="row-btns end">
        <button className="btn ghost sm" onClick={() => onDone(undefined)}>取消</button>
        <button className={`btn sm ${danger ? 'danger-fill' : 'primary'}`} onClick={() => onDone(v.trim())}>{okLabel}</button>
      </div>
    </div>
  )
}

function MoveDialog({ s, onClose }: { s: Strategy; onClose: () => void }) {
  const topics = useLiveQuery(() => db.topics.orderBy('order').toArray(), [])
  const [topicId, setTopicId] = useState(s.topicId)
  const problems = useLiveQuery(() => db.problems.where('topicId').equals(topicId).sortBy('order'), [topicId])
  async function move(problemId?: string) {
    await db.strategies.where('id').equals(s.id).modify((x) => {
      x.topicId = topicId
      if (problemId) x.problemId = problemId
      else delete x.problemId
      x.updatedAt = Date.now()
    })
    onClose()
    toast('已移动')
  }
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>移动到</h2>
        <div className="field">
          <span>主题</span>
          <select className="select" value={topicId} onChange={(e) => setTopicId(e.target.value)}>
            {topics?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="field">
          <span>问题</span>
          <div className="move-list">
            {problems?.map((p) => (
              <button key={p.id} className={`move-item ${p.id === s.problemId && topicId === s.topicId ? 'on' : ''}`} onClick={() => move(p.id)}>{p.title}</button>
            ))}
            <button className={`move-item ${!s.problemId && topicId === s.topicId ? 'on' : ''}`} onClick={() => move(undefined)}>
              <span className="muted">未归类</span>
            </button>
          </div>
        </div>
        <div className="modal-actions"><button className="btn ghost" onClick={onClose}>取消</button></div>
      </div>
    </div>
  )
}
