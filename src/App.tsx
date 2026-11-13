import { useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Overview from './components/Overview'
import TopicPage from './components/TopicPage'
import StrategyPage from './components/StrategyPage'

export default function App() {
  const [navOpen, setNavOpen] = useState(false)
  return (
    <div className={`app ${navOpen ? 'nav-open' : ''}`}>
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
    </div>
  )
}
