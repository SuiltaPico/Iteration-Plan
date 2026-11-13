import { useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, exportAll, importAll } from '../db'
import TopicDialog from './TopicDialog'

export default function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const topics = useLiveQuery(() => db.topics.orderBy('order').toArray(), [])
  const strategies = useLiveQuery(() => db.strategies.toArray(), [])
  const [creating, setCreating] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const counts = new Map<string, number>()
  strategies?.forEach((s) => {
    if (s.status !== 'eliminated') counts.set(s.topicId, (counts.get(s.topicId) ?? 0) + 1)
  })

  async function doExport() {
    const data = await exportAll()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `迭代策略备份-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function doImport(file: File) {
    try {
      const data = JSON.parse(await file.text())
      if (!confirm('导入会覆盖当前所有数据，确定继续吗？')) return
      await importAll(data)
      navigate('/')
      alert('导入成功')
    } catch (e) {
      alert('导入失败：' + (e as Error).message)
    }
  }

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
        <button className="btn ghost sm" onClick={doExport}>导出备份</button>
        <button className="btn ghost sm" onClick={() => fileRef.current?.click()}>导入</button>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) doImport(f)
        }} />
      </div>
      {creating && (
        <TopicDialog onClose={(t) => {
          setCreating(false)
          if (t) { navigate(`/topic/${t.id}`); onNavigate() }
        }} />
      )}
    </aside>
  )
}
