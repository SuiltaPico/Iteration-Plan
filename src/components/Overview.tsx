import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, STATUS_LABEL, type Strategy } from '../db'
import StrategyCard from './StrategyCard'
import TopicDialog from './TopicDialog'
import { fmtRelative } from '../util'
import { openAi } from '../bus'

export default function Overview() {
  const topics = useLiveQuery(() => db.topics.orderBy('order').toArray(), [])
  const strategies = useLiveQuery(() => db.strategies.toArray(), [])
  const recent = useLiveQuery(() => db.reviews.orderBy('createdAt').reverse().limit(8).toArray(), [])
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

  const stat = { trial: 0, kept: 0, eliminated: 0 }
  strategies.forEach((s) => stat[s.status]++)
  const topicMap = new Map(topics.map((t) => [t.id, t]))
  const sMap = new Map(strategies.map((s) => [s.id, s]))

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
        <div>
          <h1>总览</h1>
          <p className="muted">{topics.length} 个主题 · 试用中 {stat.trial} · 已留存 {stat.kept} · 已淘汰 {stat.eliminated}</p>
        </div>
        <div className="head-actions">
          <input className="search" placeholder="搜索策略…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn" onClick={() => openAi.emit({ prompt: '帮我建一个主题：' })}>✦ AI 生成</button>
          <button className="btn" onClick={() => openAi.emit({ prompt: '看看我所有的策略，给我复盘建议', send: true })}>✦ AI 复盘</button>
        </div>
      </header>

      {hits ? (
        <section>
          <h3 className="sec-title">搜索结果（{hits.length}）</h3>
          <div className="grid">
            {hits.map((s) => <StrategyCard key={s.id} s={s} topic={topicMap.get(s.topicId)} showTopic />)}
          </div>
        </section>
      ) : (
        <div className="overview-layout">
          <div className="topic-boards">
            {topics.map((t) => {
              const list = (byTopic.get(t.id) ?? []).filter((s) => s.status !== 'eliminated').sort((a, b) => b.score - a.score)
              const elim = (byTopic.get(t.id) ?? []).length - list.length
              return (
                <section key={t.id} className="board" style={{ '--topic': t.color } as React.CSSProperties}>
                  <Link to={`/topic/${t.id}`} className="board-head">
                    <span className="dot" style={{ background: t.color }} />
                    <h2>{t.name}</h2>
                    <span className="muted sm">{list.length} 个在用{elim ? ` · ${elim} 个已淘汰` : ''}</span>
                    <span className="arrow">→</span>
                  </Link>
                  {t.description && <p className="board-desc">{t.description}</p>}
                  {list.length ? (
                    <div className="grid">
                      {list.map((s) => <StrategyCard key={s.id} s={s} topic={t} />)}
                    </div>
                  ) : (
                    <p className="muted empty-line">暂无在用策略</p>
                  )}
                </section>
              )
            })}
          </div>
          <aside className="activity">
            <h3 className="sec-title">最近复盘</h3>
            {recent?.length ? (
              <ul className="activity-list">
                {recent.map((r) => {
                  const s = sMap.get(r.strategyId)
                  if (!s) return null
                  return (
                    <li key={r.id}>
                      <Link to={`/strategy/${s.id}`}>
                        <span className={`delta ${r.delta > 0 ? 'pos' : r.delta < 0 ? 'neg' : ''}`}>
                          {r.delta > 0 ? `+${r.delta}` : r.delta || '·'}
                        </span>
                        <span className="act-body">
                          <span className="act-title">{s.title || '未命名策略'}</span>
                          <span className="muted sm">{r.statusChange ? `→ ${STATUS_LABEL[r.statusChange.to]}${r.note ? ' · ' : ''}` : ''}{r.note || (r.statusChange ? '' : '复盘')} · {fmtRelative(r.createdAt)}</span>
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            ) : <p className="muted sm">还没有复盘记录。用一段时间后，回来给策略打分吧。</p>}
          </aside>
        </div>
      )}
    </div>
  )
}
