import { useEffect, useState } from 'react'
import { getSyncState, loadSyncConfig, onSyncState, saveSyncConfig, syncNow, type SyncState } from '../sync/engine'
import { fmtRelative } from '../util'
import { confirmDialog } from './Dialogs'

export function useSyncState() {
  const [s, setS] = useState<SyncState>(getSyncState)
  useEffect(() => onSyncState(setS), [])
  return s
}

export function syncLabel(s: SyncState) {
  switch (s.kind) {
    case 'off': return '未开启同步'
    case 'syncing': return '同步中…'
    case 'error': return '同步失败'
    case 'idle': return s.at ? `已同步 · ${fmtRelative(s.at)}` : '等待同步'
  }
}

export default function SyncDialog({ onClose }: { onClose: () => void }) {
  const cfg = loadSyncConfig()
  const [repo, setRepo] = useState(cfg?.repo ?? '')
  const [branch, setBranch] = useState(cfg?.branch ?? 'main')
  const [token, setToken] = useState(cfg?.token ?? '')
  const [show, setShow] = useState(false)
  const state = useSyncState()
  const valid = /^[\w.-]+\/[\w.-]+$/.test(repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '')) && token.trim()

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    saveSyncConfig({ ...cfg, repo: repo.trim(), branch: branch.trim() || 'main', token: token.trim() })
  }

  async function disconnect() {
    if (!(await confirmDialog('停止同步？本地数据和仓库里的数据都会保留，只是不再自动同步。', { ok: '停止同步' }))) return
    saveSyncConfig(null)
    setToken('')
  }

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal wide" onSubmit={save}>
        <h2>同步到 GitHub</h2>
        <p className="muted sm">
          数据会存进你的一个 GitHub 仓库：<code>data.json</code> 是完整数据，另有每个策略一篇的 Markdown，方便阅读和搜索。
          多台设备填同一个仓库就能同步，同一条记录以较新的修改为准。
        </p>
        <label className="field">
          <span>仓库（建议私有，可以是空仓库）</span>
          <input id="sync-repo" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="你的用户名/iteration-plan-data" autoComplete="off" />
        </label>
        <label className="field">
          <span>分支</span>
          <input id="sync-branch" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
        </label>
        <label className="field">
          <span>Token</span>
          <div className="input-row">
            <input id="sync-token" type={show ? 'text' : 'password'} value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_… 或 github_pat_…" autoComplete="off" />
            <button type="button" className="btn sm ghost" onClick={() => setShow(!show)}>{show ? '隐藏' : '显示'}</button>
          </div>
          <small className="muted">
            在 <a href="https://github.com/settings/tokens/new?scopes=repo&description=iteration-plan" target="_blank" rel="noreferrer">GitHub 生成一个 token</a>（勾选 repo 权限即可）。
            Token 只保存在这个浏览器里，请求直接发给 GitHub。
          </small>
        </label>
        {state.kind !== 'off' && (
          <div className={`test-msg ${state.kind === 'error' ? 'fail' : state.kind === 'idle' && state.at ? 'ok' : ''}`}>
            {state.kind === 'error' ? state.message : syncLabel(state)}
          </div>
        )}
        <div className="modal-actions">
          {cfg && <button type="button" className="btn ghost danger" onClick={disconnect}>停止同步</button>}
          <span style={{ flex: 1 }} />
          {cfg && <button type="button" className="btn" disabled={state.kind === 'syncing'} onClick={() => syncNow()}>立即同步</button>}
          <button type="button" className="btn ghost" onClick={onClose}>关闭</button>
          <button type="submit" className="btn primary" disabled={!valid || state.kind === 'syncing'}>{cfg ? '保存' : '开始同步'}</button>
        </div>
      </form>
    </div>
  )
}
