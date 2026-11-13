import { lazy, Suspense, useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Overview from './components/Overview'
import TopicPage from './components/TopicPage'
import StrategyPage from './components/StrategyPage'
import { DialogHost } from './components/Dialogs'
import { openAi } from './bus'

const AiPanel = lazy(() => import('./components/AiPanel'))

export default function App() {
  const [navOpen, setNavOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiLoaded, setAiLoaded] = useState(false)

  useEffect(() => openAi.on(() => { setAiLoaded(true); setAiOpen(true) }), [])

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
          <Route path="*" element={<Overview />} />
        </Routes>
      </main>
      {aiLoaded && (
        <Suspense fallback={null}>
          <AiPanel open={aiOpen} onClose={() => setAiOpen(false)} />
        </Suspense>
      )}
      {!aiOpen && (
        <button className="ai-fab" onClick={() => openAi.emit({})} aria-label="打开 AI 助手">✦ AI</button>
      )}
      <DialogHost />
    </div>
  )
}
