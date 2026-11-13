import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import TopicDialog from './TopicDialog'
import BackupDialog from './BackupDialog'
import SyncDialog, { syncLabel, useSyncState } from './SyncDialog'
import { openAi } from '../bus'

export default function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const topics = useLiveQuery(() => db.topics.orderBy('order').toArray(), [])
  const [creating, setCreating] = useState(false)
  const [backup, setBackup] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const sync = useSyncState()
  const navigate = useNavigate()


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
        <NavLink to="/me" className="nav-item">
          <span className="nav-icon">◇</span>关于我
        </NavLink>
        <NavLink to="/predictions" className="nav-item">
          <span className="nav-icon">△</span>预测
        </NavLink>
        <div className="nav-section">
          <span>主题</span>
          <button className="icon-btn" title="新建主题" onClick={(e) => { e.stopPropagation(); setCreating(true) }}>＋</button>
        </div>
        {topics?.map((t) => (
          <NavLink key={t.id} to={`/topic/${t.id}`} className="nav-item">
            <span className="dot" style={{ background: t.color }} />
            <span className="nav-name">{t.name}</span>
          </NavLink>
        ))}
        {topics?.length === 0 && (
          <button className="nav-empty" onClick={() => setCreating(true)}>还没有主题，点这里创建一个</button>
        )}
      </nav>
      <button className={`sync-status s-${sync.kind}`} onClick={() => setSyncing(true)} title={sync.kind === 'error' ? sync.message : undefined}>
        <span className="sync-dot" />{syncLabel(sync)}
      </button>
      {syncing && <SyncDialog onClose={() => setSyncing(false)} />}
      <div className="sidebar-foot">
        <button className="btn ghost sm" onClick={() => { openAi.emit({}); onNavigate() }}>✦ AI 助手</button>
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
