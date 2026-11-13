import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { createStrategy, db, deleteTopic, STATUS_LABEL, type Status } from '../db'
import StrategyCard from './StrategyCard'
import TopicDialog from './TopicDialog'
import { confirmDialog } from './Dialogs'
import { openAi } from '../bus'

type Filter = 'active' | Status | 'all'
type Sort = 'score' | 'updated' | 'created'

export default function TopicPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const topic = useLiveQuery(() => db.topics.get(id).then((x) => x ?? null), [id])
  const strategies = useLiveQuery(() => db.strategies.where('topicId').equals(id).toArray(), [id])
  const [filter, setFilter] = useState<Filter>('active')
  const [sort, setSort] = useState<Sort>('score')
  const [editing, setEditing] = useState(false)

  if (topic === undefined || !strategies) return null
  if (!topic) return <div className="page"><p className="muted">主题不存在</p></div>

  const count = (f: Filter) => strategies.filter((s) => match(s.status, f)).length
  const list = strategies
    .filter((s) => match(s.status, filter))
    .sort((a, b) => sort === 'score' ? b.score - a.score || b.updatedAt - a.updatedAt : sort === 'updated' ? b.updatedAt - a.updatedAt : b.createdAt - a.createdAt)

  async function add() {
    const s = await createStrategy(id)
    navigate(`/strategy/${s.id}`)
  }

  async function remove() {
    if (!(await confirmDialog(`删除主题「${topic!.name}」及其下 ${strategies!.length} 个策略？此操作不可撤销。`, { ok: '删除' }))) return
    await deleteTopic(id)
    navigate('/')
  }

  const tabs: Filter[] = ['active', 'trial', 'kept', 'eliminated', 'all']
  const tabLabel = (f: Filter) => f === 'active' ? '在用' : f === 'all' ? '全部' : STATUS_LABEL[f]

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1><span className="dot lg" style={{ background: topic.color }} />{topic.name}</h1>
          {topic.description && <p className="muted">{topic.description}</p>}
          <p className="muted sm">留存线 +{topic.keepAt} · 淘汰线 {topic.eliminateAt}</p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => openAi.emit({ prompt: '为当前主题再想 3 个新策略' })}>✦ AI 写策略</button>
          <button className="btn" onClick={() => openAi.emit({ prompt: '分析当前主题的策略和复盘记录，给我改进建议', send: true })}>✦ AI 复盘</button>
          <button className="btn ghost" onClick={() => setEditing(true)}>编辑主题</button>
          <button className="btn ghost danger" onClick={remove}>删除</button>
          <button className="btn primary" onClick={add}>＋ 新建策略</button>
        </div>
      </header>

      <div className="toolbar">
        <div className="tabs">
          {tabs.map((f) => (
            <button key={f} className={`tab ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
              {tabLabel(f)} <span className="tab-count">{count(f)}</span>
            </button>
          ))}
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="select">
          <option value="score">按分数</option>
          <option value="updated">最近更新</option>
          <option value="created">最近创建</option>
        </select>
      </div>

      {list.length ? (
        <div className="grid">
          {list.map((s) => <StrategyCard key={s.id} s={s} topic={topic} />)}
        </div>
      ) : (
        <div className="empty">
          <p className="muted">{strategies.length ? '这里没有策略' : '这个主题还没有策略'}</p>
          {!strategies.length && <button className="btn primary" onClick={add}>写下第一个策略</button>}
        </div>
      )}
      {editing && <TopicDialog topic={topic} onClose={() => setEditing(false)} />}
    </div>
  )
}

function match(st: Status, f: Filter) {
  if (f === 'all') return true
  if (f === 'active') return st !== 'eliminated'
  return st === f
}
