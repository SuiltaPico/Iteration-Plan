import { db, exportAll, replaceAll, type Backup } from '../db'
import { contentChanged } from '../bus'
import { github, GhConflict, GhError, type GhConfig } from './github'
import { mergeBackups, sameData } from './merge'
import { toMarkdownFiles } from './markdown'

const KEY = 'iteration-plan.sync'
export type SyncConfig = GhConfig
export type SyncState =
  | { kind: 'off' }
  | { kind: 'idle'; at?: number }
  | { kind: 'syncing' }
  | { kind: 'error'; message: string; at: number }

export function loadSyncConfig(): SyncConfig | null {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null } catch { return null }
}
function lastAt(): number | undefined {
  try { return Number(localStorage.getItem(`${KEY}.at`)) || undefined } catch { return undefined }
}

let state: SyncState = loadSyncConfig() ? { kind: 'idle', at: lastAt() } : { kind: 'off' }
const listeners = new Set<(s: SyncState) => void>()
const set = (s: SyncState) => { state = s; listeners.forEach((f) => f(s)) }
export const getSyncState = () => state
export function onSyncState(fn: (s: SyncState) => void) { listeners.add(fn); return () => { listeners.delete(fn) } }

export function saveSyncConfig(cfg: SyncConfig | null) {
  try {
    if (cfg) localStorage.setItem(KEY, JSON.stringify(cfg))
    else { localStorage.removeItem(KEY); localStorage.removeItem(`${KEY}.at`) }
  } catch { /* 存储不可用时同步设置只在本次有效 */ }
  set(cfg ? { kind: 'idle', at: lastAt() } : { kind: 'off' })
  if (cfg) syncNow()
}

let running: Promise<void> | null = null
let again = false
let applying = false

/** 立即同步：拉取远端 → 按记录合并 → 写回本地 → 有变化就推送一次提交 */
export function syncNow(): Promise<void> {
  if (running) { again = true; return running }
  running = (async () => {
    try {
      do {
        again = false
        await syncOnce()
      } while (again)
    } finally {
      running = null
    }
  })()
  return running
}

async function syncOnce() {
  const cfg = loadSyncConfig()
  if (!cfg) { set({ kind: 'off' }); return }
  set({ kind: 'syncing' })
  try {
    const gh = github(cfg)
    for (let attempt = 0; ; attempt++) {
      let head = await gh.head()
      const remoteText = head ? await gh.read('data.json') : null
      let remote: Backup | null = null
      if (remoteText) {
        try { remote = JSON.parse(remoteText) } catch { throw new GhError('仓库里的 data.json 不是有效的数据文件，请检查是否被手动改坏。') }
        if (remote?.app !== 'iteration-plan') throw new GhError('仓库里的 data.json 不是迭代策略的数据，请换一个仓库。')
      }
      const local = await exportAll()
      const merged = mergeBackups(local, remote)
      if (!sameData(merged, local)) await applyLocal(local, merged)
      if (sameData(merged, remote)) break
      const files = toMarkdownFiles(merged)
      const oldPaths = remote ? Object.keys(toMarkdownFiles(remote)) : []
      files['data.json'] = JSON.stringify({ ...merged, exportedAt: Date.now() }, null, 1)
      if (!head) head = await gh.ensureBranch()
      try {
        await gh.commit(head, files, oldPaths, `同步 ${new Date().toLocaleString('zh-CN', { hour12: false })}`)
        break
      } catch (e) {
        if (e instanceof GhConflict && attempt < 3) continue // 远端刚被其他设备推进：重新拉取合并
        throw e
      }
    }
    const at = Date.now()
    try { localStorage.setItem(`${KEY}.at`, String(at)) } catch { /* 忽略 */ }
    set({ kind: 'idle', at })
  } catch (e) {
    set({ kind: 'error', message: e instanceof Error ? e.message : String(e), at: Date.now() })
  }
}

/** 把合并结果写回本地，并让正在打开的编辑器刷新（有未保存修改的策略除外） */
async function applyLocal(local: Backup, merged: Backup) {
  applying = true
  try {
    await replaceAll(merged)
  } finally {
    applying = false
  }
  const before = new Map(local.strategies.map((s) => [s.id, s]))
  const pending = new Set(await db.pending.toCollection().primaryKeys())
  for (const s of merged.strategies) {
    const o = before.get(s.id)
    if (o && (o.content !== s.content || o.title !== s.title || o.criteria !== s.criteria) && !pending.has(s.id)) contentChanged.emit(s.id)
  }
  const prof = (b: Backup) => b.meta?.find((m) => m.key === 'profile')?.value
  if (prof(local) !== prof(merged)) contentChanged.emit('profile')
}

let timer: number | undefined
/** 本地数据变化后，稍等几秒再同步，合并连续的修改 */
export function scheduleSync(delay = 4000) {
  if (applying || !loadSyncConfig()) return
  clearTimeout(timer)
  timer = window.setTimeout(() => { syncNow() }, delay)
}

/** 启动：监听数据变化，打开页面、回到页面、每 5 分钟都同步一次 */
export function startSync() {
  for (const t of [db.topics, db.problems, db.strategies, db.reviews, db.logs, db.meta, db.tombstones, db.predictions, db.ideas]) {
    t.hook('creating', () => { scheduleSync() })
    t.hook('updating', () => { scheduleSync() })
    t.hook('deleting', () => { scheduleSync() })
  }
  window.addEventListener('focus', () => scheduleSync(500))
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(500) })
  window.setInterval(() => { if (document.visibilityState === 'visible' && loadSyncConfig()) syncNow() }, 5 * 60 * 1000)
  if (loadSyncConfig()) syncNow()
}
