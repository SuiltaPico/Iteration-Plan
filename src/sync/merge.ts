import type { Backup, SyncTable, Tombstone } from '../db'

type Rec = { id?: string; key?: string; updatedAt?: number; createdAt?: number }
const keyOf = (r: Rec) => (r.id ?? r.key) as string
const stamp = (r: Rec) => r.updatedAt ?? r.createdAt ?? 0

/** 按记录合并：同一条记录取更新时间较新的一份；删除记录（墓碑）优先，避免已删的数据复活 */
function mergeTable<T extends Rec>(a: T[] = [], b: T[] = [], dead: Set<string>): T[] {
  const m = new Map<string, T>()
  for (const r of [...a, ...b]) {
    const k = keyOf(r)
    if (dead.has(k)) continue
    const cur = m.get(k)
    if (!cur || stamp(r) > stamp(cur)) m.set(k, r)
  }
  return [...m.values()]
}

export function mergeBackups(local: Backup, remote: Backup | null): Backup {
  if (!remote) return local
  const tomb = new Map<string, Tombstone>()
  for (const t of [...(local.tombstones ?? []), ...(remote.tombstones ?? [])]) {
    const cur = tomb.get(t.id)
    if (!cur || t.at > cur.at) tomb.set(t.id, t)
  }
  const dead = (table: SyncTable) => new Set([...tomb.values()].filter((t) => t.table === table).map((t) => t.id))
  const topics = mergeTable(local.topics, remote.topics, dead('topics'))
  const topicIds = new Set(topics.map((t) => t.id))
  const problems = mergeTable(local.problems, remote.problems, dead('problems')).filter((p) => topicIds.has(p.topicId))
  const problemIds = new Set(problems.map((p) => p.id))
  const strategies = mergeTable(local.strategies, remote.strategies, dead('strategies'))
    .filter((s) => topicIds.has(s.topicId))
    .map((s) => (s.problemId && !problemIds.has(s.problemId) ? (({ problemId: _, ...rest }) => rest)(s) : s))
  const sids = new Set(strategies.map((s) => s.id))
  return {
    app: 'iteration-plan',
    version: 3,
    exportedAt: Date.now(),
    topics,
    problems,
    strategies,
    reviews: mergeTable(local.reviews, remote.reviews, dead('reviews')).filter((r) => sids.has(r.strategyId)),
    logs: mergeTable(local.logs, remote.logs, dead('logs')).filter((l) => sids.has(l.strategyId)),
    meta: mergeTable(local.meta, remote.meta, dead('meta')),
    tombstones: [...tomb.values()],
  }
}

/** 比较两份数据的内容是否相同（忽略导出时间和顺序） */
export function sameData(a: Backup, b: Backup | null) {
  if (!b) return false
  const norm = (x: Backup) => JSON.stringify(
    (['topics', 'problems', 'strategies', 'reviews', 'logs', 'meta', 'tombstones'] as const).map((k) =>
      [...((x[k] ?? []) as Rec[])].sort((p, q) => (keyOf(p) < keyOf(q) ? -1 : 1)),
    ),
  )
  return norm(a) === norm(b)
}
