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

  const real = strategies.filter((s) => !s.isDraft)
  const stat = { trial: 0, kept: 0, eliminated: 0 }
  real.forEach((s) => stat[s.status]++)
  const topicMap = new Map(topics.map((t) => [t.id, t]))

  const query = q.trim().toLowerCase()
  const hits = query
    ? strategies.filter((s) => s.title.toLowerCase().includes(query) || s.content.toLowerCase().includes(query))
    : null

  if (topics.length === 0) {
    return (
      <div className="page">
        <div className="hero-empty">
          <h1>用迭代的方式管理你的策略</h1>
          <p>建一个<b>主题</b>（比如「早起」「阅读」「投资」），在里面写下<b>策略</b>，用一段时间后复盘打分：<br />好用就 +1，分数到留存线自动<b>留存</b>；不好用就 −1，到淘汰线自动<b>淘汰</b>。</p>
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
          <div className="stat-row">
            <span><b>{stat.trial}</b> 试用中</span>
            <span><b>{stat.kept}</b> 已留存</span>
            <span><b>{stat.eliminated}</b> 已淘汰</span>
          </div>
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
            {hits.map((s) => <StrategyCard key={s.id} s={s} topic={topicMap.get(s.topicId)} showTopic last={last.get(s.id)} />)}
          </div>
        </section>
      ) : (
        <div className="topic-boards">
            {topics.map((t) => {
              const all = byTopic.get(t.id) ?? []
              const list = all.filter((s) => !s.isDraft && s.status !== 'eliminated').sort((a, b) => b.score - a.score)
              const drafts = all.filter((s) => s.isDraft).length
              const elim = all.filter((s) => !s.isDraft && s.status === 'eliminated').length
              return (
                <section key={t.id} className="board">
                  <Link to={`/topic/${t.id}`} className="board-head">
                    <span className="dot" style={{ background: t.color }} />
                    <h2>{t.name}</h2>
                    <span className="muted sm">
                      {list.length} 个在用{elim ? ` · ${elim} 个已淘汰` : ''}{drafts ? ` · ${drafts} 份草稿` : ''}
                    </span>
                    <span className="arrow">→</span>
                  </Link>
                  {t.description && <p className="board-desc">{t.description}</p>}
                  {list.length ? (
                    <div className="grid">
                      {list.map((s) => <StrategyCard key={s.id} s={s} topic={t} last={last.get(s.id)} />)}
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
