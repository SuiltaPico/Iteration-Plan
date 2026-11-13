import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { convertAllPending, db } from './db'
import { toast } from './components/Dialogs'
import { startSync } from './sync/engine'
import './styles.css'

const root = createRoot(document.getElementById('root')!)

db.open()
  .then(async () => {
    // 上次关闭页面时还没保存的修改，转成草稿
    const n = await convertAllPending().catch(() => 0)
    if (n) setTimeout(() => toast('上次未保存的修改已存为草稿'), 600)
    startSync()
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

// 安装到桌面 / 离线可用（只在正式构建里注册；不支持的环境静默跳过）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}
