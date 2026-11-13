import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Strategy } from '../db'
import CheckIn from './CheckIn'
import StrategyCard, { useLastReviews } from './StrategyCard'
import TopicDialog from './TopicDialog'
import { openAi } from '../bus'

export default function Overview() {
  const topics = useLiveQuery(() => db.topics.orderBy('order').toArray(), [])
  const strategies = useLiveQuery(() => db.strategies.toArray(), [])
  const problems = useLiveQuery(() => db.problems.toArray(), [])
  const last = useLastReviews()
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  const byTopic = useMemo(() => {
    const m = new Map<string, Strategy[]>()
    strategies?.forEach((s) => {
      const arr = m.get(s.topicId) ?? []
      arr.push(s)
      m.set(s.topicId, arr)
    })
    return m
  }, [strategies])

  if (!topics || !strategies) return null
  const pname = new Map((problems ?? []).map((p) => [p.id, p.title]))

  const real = strategies.filter((s) => !s.isDraft)
  const topicMap = new Map(topics.map((t) => [t.id, t]))

  const query = q.trim().toLowerCase()
  const hits = query
    ? strategies.filter((s) => s.title.toLowerCase().includes(query) || s.content.toLowerCase().includes(query))
    : null

  if (topics.length === 0) {
    return (
      <div className="page">
        <CheckIn strategies={[]} topics={new Map()} last={last} />
        <div className="hero-empty">
          <h1>用迭代的方式管理你的策略</h1>
          <p>建一个<b>主题</b>（比如「早起」「阅读」「投资」），在里面写下<b>策略</b>，用一段时间后复盘：执行了有效 +1、无效 −1。<br />分数只是记录，留下还是<b>淘汰</b>由你决定（也可以让 AI 帮你判断）。</p>
          <div className="hero-actions">
            <button className="btn primary lg" onClick={() => setCreating(true)}>创建第一个主题</button>
            <button className="btn lg" onClick={() => openAi.emit({ prompt: '我想改进：' })}>✦ 让 AI 帮我起步</button>
          </div>
        </div>
        {creating && <TopicDialog onClose={(t) => { setCreating(false); if (t) navigate(`/topic/${t.id}`) }} />}
      </div>
    )
  }

  return (
    <div className="page">
      <header className="page-head">
        <div className="head-text">
          <h1>总览</h1>
        </div>
        <div className="head-actions">
          <input className="search" placeholder="搜索策略…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn ghost" onClick={() => openAi.emit({ prompt: '帮我建一个主题：' })}>✦ AI 生成</button>
        </div>
      </header>

      {!hits && <CheckIn strategies={real} topics={topicMap} last={last} />}

      {hits ? (
        <section>
          <h3 className="sec-title">搜索结果（{hits.length}）</h3>
          <div className="grid">
            {hits.map((s) => <StrategyCard key={s.id} s={s} topic={topicMap.get(s.topicId)} showTopic last={last.get(s.id)} problem={s.problemId ? pname.get(s.problemId) : undefined} />)}
          </div>
        </section>
      ) : (
        <div className="topic-boards">
            {topics.map((t) => {
              const all = byTopic.get(t.id) ?? []
              const list = all.filter((s) => !s.isDraft && s.status !== 'eliminated').sort((a, b) => b.score - a.score)
              return (
                <section key={t.id} className="board">
                  <Link to={`/topic/${t.id}`} className="board-head">
                    <span className="dot" style={{ background: t.color }} />
                    <h2>{t.name}</h2>
                    <span className="arrow">→</span>
                  </Link>
                  {t.description && <p className="board-desc">{t.description}</p>}
                  {list.length ? (
                    <div className="grid">
                      {list.map((s) => <StrategyCard key={s.id} s={s} topic={t} last={last.get(s.id)} problem={s.problemId ? pname.get(s.problemId) : undefined} />)}
                    </div>
                  ) : (
                    <p className="muted empty-line">暂无在用策略</p>
                  )}
                </section>
              )
            })}
        </div>
      )}
    </div>
  )
}
