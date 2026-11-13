import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Overview from './components/Overview'
import TopicPage from './components/TopicPage'
import StrategyPage from './components/StrategyPage'
import ProfilePage from './components/ProfilePage'
import { DialogHost } from './components/Dialogs'
import { openAi } from './bus'
import ReviewMode from './components/ReviewMode'
import QuickLog from './components/QuickLog'

const AiPanel = lazy(() => import('./components/AiPanel'))

export default function App() {
  const [navOpen, setNavOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiLoaded, setAiLoaded] = useState(false)

  useEffect(() => openAi.on(() => { setAiLoaded(true); setAiOpen(true) }), [])
  const { pathname, search } = useLocation()

  // 复盘是专注模式：不显示侧边栏和 AI
  if (pathname.startsWith('/review')) return <><ReviewMode key={search} /><DialogHost /></>
  if (pathname.startsWith('/log')) return <><QuickLog /><DialogHost /></>

  return (
    <div className={`app ${navOpen ? 'nav-open' : ''} ${aiOpen ? 'ai-open' : ''}`}>
      <Sidebar onNavigate={() => setNavOpen(false)} />
      <div className="scrim" onClick={() => setNavOpen(false)} />
      <main className="main">
        <button className="menu-btn" onClick={() => setNavOpen(true)} aria-label="打开菜单">☰</button>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/topic/:id" element={<TopicPage />} />
          <Route path="/strategy/:id" element={<StrategyPage />} />
          <Route path="/me" element={<ProfilePage />} />
          <Route path="*" element={<Overview />} />
        </Routes>
      </main>
      {aiLoaded && (
        <Suspense fallback={null}>
          <AiPanel open={aiOpen} onClose={() => setAiOpen(false)} />
        </Suspense>
      )}
      {!aiOpen && (
        <div className="fabs">
          <Link className="fab log-fab" to="/log" aria-label="记一笔">＋ 记一笔</Link>
          <button className="fab ai-fab" onClick={() => openAi.emit({})} aria-label="打开 AI 助手">✦ AI</button>
        </div>
      )}
      <DialogHost />
    </div>
  )
}
