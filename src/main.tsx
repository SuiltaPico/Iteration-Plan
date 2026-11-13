import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { db } from './db'
import './styles.css'

const root = createRoot(document.getElementById('root')!)

db.open()
  .then(() => {
    root.render(
      <StrictMode>
        <HashRouter>
          <App />
        </HashRouter>
      </StrictMode>,
    )
  })
  .catch((e) => {
    root.render(
      <div className="hero-empty">
        <h1>无法使用本地存储</h1>
        <p>这个应用把数据保存在浏览器的 IndexedDB 里，但当前环境不允许访问（可能是隐私/无痕模式，或站点数据被禁用）。请换成普通窗口再打开。</p>
        <p className="muted sm">{String(e?.message ?? e)}</p>
      </div>,
    )
  })
