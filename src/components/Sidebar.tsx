import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import TopicDialog from './TopicDialog'
import BackupDialog from './BackupDialog'

export default function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const topics = useLiveQuery(() => db.topics.orderBy('order').toArray(), [])
  const strategies = useLiveQuery(() => db.strategies.toArray(), [])
  const [creating, setCreating] = useState(false)
  const [backup, setBackup] = useState(false)
  const navigate = useNavigate()

  const counts = new Map<string, number>()
  strategies?.forEach((s) => {
    if (s.status !== 'eliminated') counts.set(s.topicId, (counts.get(s.topicId) ?? 0) + 1)
  })

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="logo">↗</span>
        <span>迭代策略</span>
      </div>
      <nav onClick={onNavigate}>
        <NavLink to="/" end className="nav-item">
          <span className="nav-icon">◎</span>总览
        </NavLink>
        <div className="nav-section">
          <span>主题</span>
          <button className="icon-btn" title="新建主题" onClick={(e) => { e.stopPropagation(); setCreating(true) }}>＋</button>
        </div>
        {topics?.map((t) => (
          <NavLink key={t.id} to={`/topic/${t.id}`} className="nav-item">
            <span className="dot" style={{ background: t.color }} />
            <span className="nav-name">{t.name}</span>
            <span className="nav-count">{counts.get(t.id) ?? 0}</span>
          </NavLink>
        ))}
        {topics?.length === 0 && (
          <button className="nav-empty" onClick={() => setCreating(true)}>还没有主题，点这里创建一个</button>
        )}
      </nav>
      <div className="sidebar-foot">
        <button className="btn ghost sm" onClick={() => setBackup(true)}>备份与恢复</button>
      </div>
      {backup && <BackupDialog onClose={() => setBackup(false)} />}
      {creating && (
        <TopicDialog onClose={(t) => {
          setCreating(false)
          if (t) { navigate(`/topic/${t.id}`); onNavigate() }
        }} />
      )}
    </aside>
  )
}
