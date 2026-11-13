import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  createProblem, createStrategy, db, deleteProblem, deleteTopic, updateProblem, updateStrategy,
  type Problem, type Strategy, type Topic,
} from '../db'
import StrategyCard, { useLastReviews } from './StrategyCard'
import TopicDialog from './TopicDialog'
import Menu from './Menu'
import { confirmDialog } from './Dialogs'
import { openAi } from '../bus'
import { fmtDate } from '../util'

const Editor = lazy(() => import('./Editor'))

type View = 'strategies' | 'playbook' | 'lessons'
const VIEWS: { key: View; label: string }[] = [
  { key: 'strategies', label: '策略' },
  { key: 'playbook', label: '打法' },
  { key: 'lessons', label: '踩过的坑' },
]

export default function TopicPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const view = (params.get('view') as View) || 'strategies'
  const topic = useLiveQuery(() => db.topics.get(id).then((x) => x ?? null), [id])
  const problems = useLiveQuery(() => db.problems.where('topicId').equals(id).sortBy('order'), [id])
  const strategies = useLiveQuery(() => db.strategies.where('topicId').equals(id).toArray(), [id])
  const [editing, setEditing] = useState(false)
  const [problemDialog, setProblemDialog] = useState<Problem | 'new' | null>(null)

  // 面包屑里的「问题」链接：滚动到对应分组
  useEffect(() => {
    if (!location.hash || !problems) return
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' })
  }, [location.hash, problems])

  if (topic === undefined || !strategies || !problems) return null
  if (!topic) return <div className="page"><p className="muted">主题不存在</p></div>

  async function addStrategy(problemId?: string) {
    const s = await createStrategy(id, '未命名策略', { isDraft: true, problemId })
    navigate(`/strategy/${s.id}`)
  }

  async function remove() {
    if (!(await confirmDialog(`删除主题「${topic!.name}」及其下 ${strategies!.length} 个策略？此操作不可撤销。`, { ok: '删除' }))) return
    await deleteTopic(id)
    navigate('/')
  }

  const eliminated = strategies.filter((s) => !s.isDraft && s.status === 'eliminated')

  return (
    <div className="page">
      <header className="page-head">
        <div className="head-text">
          <h1><span className="dot lg" style={{ background: topic.color }} />{topic.name}</h1>
          {topic.description && <p className="muted">{topic.description}</p>}
          <p className="muted sm">复盘有效 +1、无效 −1；到 +{topic.keepAt} 留存，到 {topic.eliminateAt} 淘汰</p>
        </div>
        <div className="head-actions">
          <button className="btn ghost" onClick={() => openAi.emit({ prompt: '为当前主题想几个值得试的问题和候选策略' })}>✦ AI 出主意</button>
          <button className="btn primary" onClick={() => setProblemDialog('new')}>＋ 新问题</button>
          <Menu items={[
            { label: '编辑主题', onClick: () => setEditing(true) },
            { label: 'AI 分析与建议', onClick: () => openAi.emit({ prompt: '分析当前主题的策略、复盘记录和踩过的坑，给我改进建议', send: true }) },
            { label: '删除主题', onClick: remove, danger: true },
          ]} />
        </div>
      </header>

      <div className="seg view-seg" role="tablist">
        {VIEWS.map((v) => (
          <button key={v.key} role="tab" aria-selected={view === v.key} className={view === v.key ? 'on' : ''}
            onClick={() => setParams(v.key === 'strategies' ? {} : { view: v.key }, { replace: true })}>{v.label}</button>
        ))}
      </div>

      {view === 'strategies' && (
        <StrategiesView topic={topic} problems={problems} strategies={strategies} eliminatedCount={eliminated.length}
          onAdd={addStrategy} onNewProblem={() => setProblemDialog('new')} onEditProblem={(p) => setProblemDialog(p)}
          onLessons={() => setParams({ view: 'lessons' }, { replace: true })} />
      )}
      {view === 'playbook' && <PlaybookView problems={problems} strategies={strategies} />}
      {view === 'lessons' && <LessonsView problems={problems} strategies={eliminated} />}

      {editing && <TopicDialog topic={topic} onClose={() => setEditing(false)} />}
      {problemDialog && (
        <ProblemDialog topicId={id} problem={problemDialog === 'new' ? undefined : problemDialog} onClose={() => setProblemDialog(null)} />
      )}
    </div>
  )
}

/* ---------------- 策略：按问题分组的候选策略 ---------------- */

function StrategiesView({ topic, problems, strategies, eliminatedCount, onAdd, onNewProblem, onEditProblem, onLessons }: {
  topic: Topic; problems: Problem[]; strategies: Strategy[]; eliminatedCount: number
  onAdd: (problemId?: string) => void; onNewProblem: () => void; onEditProblem: (p: Problem) => void; onLessons: () => void
}) {
  const last = useLastReviews()
  const live = strategies.filter((s) => s.isDraft || s.status !== 'eliminated')
  const rank = (s: Strategy) => (s.isDraft ? 0 : s.status === 'kept' ? 2 : 1)
  const sort = (list: Strategy[]) => list.sort((a, b) => rank(b) - rank(a) || b.score - a.score || b.updatedAt - a.updatedAt)
  const loose = sort(live.filter((s) => !s.problemId || !problems.some((p) => p.id === s.problemId)))

  if (problems.length === 0 && live.length === 0) {
    return (
      <div className="empty">
        <p>先写下这个主题里你想解决的<b>问题</b>，比如「什么时候卖出」「怎么记住新概念」。</p>
        <p className="muted sm">每个问题下放几种候选策略，各自试用、复盘，留下最适合你的那个。</p>
        <div className="row-btns">
          <button className="btn primary" onClick={onNewProblem}>＋ 新问题</button>
          <button className="btn" onClick={() => onAdd()}>先直接写策略</button>
        </div>
        {eliminatedCount > 0 && <button className="link-btn" onClick={onLessons}>已淘汰 {eliminatedCount} 个，去看踩过的坑</button>}
      </div>
    )
  }

  return (
    <div className="problems">
      {problems.map((p) => {
        const list = sort(live.filter((s) => s.problemId === p.id))
        const winner = list.find((s) => !s.isDraft && s.status === 'kept')
        const rivals = list.filter((s) => !s.isDraft && s.status === 'trial')
        return (
          <section key={p.id} id={`p-${p.id}`} className="problem">
            <div className="problem-head">
              <div className="problem-title">
                <h2>{p.title}</h2>
                {p.description && <p className="muted sm">{p.description}</p>}
              </div>
              <button className="btn sm" onClick={() => onAdd(p.id)}>＋ 候选策略</button>
              <Menu items={[
                { label: '编辑问题', onClick: () => onEditProblem(p) },
                { label: '让 AI 想几个候选策略', onClick: () => openAi.emit({ prompt: `为问题「${p.title}」想 2~3 个候选策略，避开踩过的坑`, send: true }) },
                {
                  label: '删除问题', danger: true, onClick: async () => {
                    if (await confirmDialog(`删除问题「${p.title}」？其下的策略会移到「未归类」，不会被删除。`, { ok: '删除问题' })) deleteProblem(p.id)
                  },
                },
              ]} />
            </div>
            {winner && rivals.length > 0 && (
              <p className="problem-note">「{winner.title}」已经留存。其他候选还在试用，比较一下要不要让它们退场。</p>
            )}
            {list.length ? (
              <div className="grid">{list.map((s) => <StrategyCard key={s.id} s={s} topic={topic} last={last.get(s.id)} />)}</div>
            ) : (
              <button className="empty-line add-line" onClick={() => onAdd(p.id)}>还没有候选策略，写一个</button>
            )}
          </section>
        )
      })}

      {loose.length > 0 && (
        <section className="problem">
          <div className="problem-head">
            <div className="problem-title">
              <h2 className="muted">未归类</h2>
              {problems.length > 0 && <p className="muted sm">放进某个问题里，才能看出它在跟谁比。在策略页「⋯ → 移动到…」里选问题。</p>}
            </div>
            <button className="btn sm" onClick={() => onAdd()}>＋ 策略</button>
          </div>
          <div className="grid">{loose.map((s) => <StrategyCard key={s.id} s={s} topic={topic} last={last.get(s.id)} />)}</div>
        </section>
      )}

      <div className="problems-foot">
        <button className="btn" onClick={onNewProblem}>＋ 新问题</button>
        {eliminatedCount > 0 && <button className="link-btn" onClick={onLessons}>已淘汰 {eliminatedCount} 个，去看踩过的坑</button>}
      </div>
    </div>
  )
}

/* ---------------- 打法：当前留存的策略，决策时直接翻 ---------------- */

function PlaybookView({ problems, strategies }: { problems: Problem[]; strategies: Strategy[] }) {
  const kept = strategies.filter((s) => !s.isDraft && s.status === 'kept').sort((a, b) => b.score - a.score)
  if (!kept.length) {
    return (
      <div className="empty">
        <p>还没有留存的策略。</p>
        <p className="muted sm">试用中的策略复盘到留存线后，会出现在这里，汇成你在这个主题上的打法。</p>
      </div>
    )
  }
  const groups: { title: string; list: Strategy[] }[] = [
    ...problems.map((p) => ({ title: p.title, list: kept.filter((s) => s.problemId === p.id) })),
    { title: '其他', list: kept.filter((s) => !s.problemId || !problems.some((p) => p.id === s.problemId)) },
  ].filter((g) => g.list.length)
  return (
    <div className="playbook">
      {groups.map((g) => (
        <section key={g.title} className="playbook-group">
          <h2>{g.title}</h2>
          {g.list.map((s) => (
            <article key={s.id} className="playbook-item">
              <Link to={`/strategy/${s.id}`} className="playbook-title">{s.title}</Link>
              {s.criteria?.trim() && <p className="playbook-criteria"><span>判断标准</span>{s.criteria}</p>}
              {s.content.trim() && (
                <Suspense fallback={null}><Editor key={`${s.id}-${s.updatedAt}`} value={s.content} readOnly /></Suspense>
              )}
            </article>
          ))}
        </section>
      ))}
    </div>
  )
}

/* ---------------- 踩过的坑：淘汰的策略和教训 ---------------- */

function LessonsView({ problems, strategies }: { problems: Problem[]; strategies: Strategy[] }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [text, setText] = useState('')
  const pname = new Map(problems.map((p) => [p.id, p.title]))
  const list = [...strategies].sort((a, b) => b.statusChangedAt - a.statusChangedAt)
  if (!list.length) {
    return (
      <div className="empty">
        <p>还没有淘汰过策略。</p>
        <p className="muted sm">策略被淘汰时记下为什么不行，会汇总在这里。AI 出主意时也会参考这些教训。</p>
      </div>
    )
  }
  return (
    <ul className="lessons">
      {list.map((s) => (
        <li key={s.id} className="lesson">
          <div className="lesson-head">
            <Link to={`/strategy/${s.id}`} className="lesson-title">{s.title}</Link>
            <span className="muted sm">{s.problemId && pname.get(s.problemId) ? `${pname.get(s.problemId)} · ` : ''}淘汰于 {fmtDate(s.statusChangedAt).slice(0, 10)}</span>
          </div>
          {editing === s.id ? (
            <div className="lesson-editor">
              <textarea id={`lesson-${s.id}`} autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="为什么不行？学到了什么？" />
              <div className="row-btns end">
                <button className="btn ghost sm" onClick={() => setEditing(null)}>取消</button>
                <button className="btn primary sm" onClick={async () => { await updateStrategy(s.id, { lesson: text.trim() }); setEditing(null) }}>保存</button>
              </div>
            </div>
          ) : s.lesson ? (
            <p className="lesson-text" onDoubleClick={() => { setEditing(s.id); setText(s.lesson ?? '') }}>{s.lesson}</p>
          ) : (
            <button className="link-btn" onClick={() => { setEditing(s.id); setText('') }}>还没写原因，记一下</button>
          )}
        </li>
      ))}
    </ul>
  )
}

/* ---------------- 问题弹窗 ---------------- */

function ProblemDialog({ topicId, problem, onClose }: { topicId: string; problem?: Problem; onClose: () => void }) {
  const [title, setTitle] = useState(problem?.title ?? '')
  const [description, setDescription] = useState(problem?.description ?? '')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    if (problem) await updateProblem(problem.id, { title: title.trim(), description: description.trim() })
    else await createProblem(topicId, title.trim(), description.trim())
    onClose()
  }
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={save}>
        <h2>{problem ? '编辑问题' : '新问题'}</h2>
        <label className="field">
          <span>要解决的问题</span>
          <input id="problem-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：什么时候卖出？怎么记住新概念？" />
        </label>
        <label className="field">
          <span>补充说明（可选）</span>
          <textarea id="problem-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="现在的困扰、约束条件" />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>取消</button>
          <button type="submit" className="btn primary" disabled={!title.trim()}>{problem ? '保存' : '创建'}</button>
        </div>
      </form>
    </div>
  )
}
