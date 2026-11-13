import Dexie, { type EntityTable } from 'dexie'

export type Status = 'trial' | 'kept' | 'eliminated'

export interface Topic {
  id: string
  name: string
  description: string
  color: string
  /** 分数 ≥ keepAt 时，试用中的策略自动转为「已留存」 */
  keepAt: number
  /** 分数 ≤ eliminateAt 时，策略自动「淘汰」 */
  eliminateAt: number
  order: number
  createdAt: number
  updatedAt: number
}

export interface Strategy {
  id: string
  topicId: string
  title: string
  content: string
  score: number
  status: Status
  createdAt: number
  updatedAt: number
  statusChangedAt: number
  /** 草稿：不参与复盘打分，自动保存；正式发布后才开始试用 */
  isDraft?: boolean
  /** 草稿来源：由哪个策略的未保存修改克隆而来 */
  draftOf?: string
  /** 下次主动「问一问」的时间；复盘或「过几天再问」时更新 */
  nextAskAt?: number
}

/** 正式策略在编辑器里尚未保存的修改（离开页面后会被转成草稿策略） */
export interface PendingEdit {
  strategyId: string
  title: string
  content: string
  updatedAt: number
}

export interface Review {
  id: string
  strategyId: string
  delta: number
  note: string
  scoreAfter: number
  statusChange?: { from: Status; to: Status }
  createdAt: number
}

export const db = new Dexie('iteration-plan') as Dexie & {
  topics: EntityTable<Topic, 'id'>
  strategies: EntityTable<Strategy, 'id'>
  reviews: EntityTable<Review, 'id'>
  pending: EntityTable<PendingEdit, 'strategyId'>
}

db.version(1).stores({
  topics: 'id, order, createdAt',
  strategies: 'id, topicId, status, score, updatedAt, createdAt',
  reviews: 'id, strategyId, createdAt',
})
db.version(2).stores({
  pending: 'strategyId',
})

export const STATUS_LABEL: Record<Status, string> = {
  trial: '试用中',
  kept: '已留存',
  eliminated: '已淘汰',
}

export const TOPIC_COLORS = ['#4f46e5', '#0891b2', '#059669', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#7c3aed', '#475569']

const uid = () => crypto.randomUUID()

export async function createTopic(input: Pick<Topic, 'name' | 'description' | 'color' | 'keepAt' | 'eliminateAt'>) {
  const now = Date.now()
  const last = await db.topics.orderBy('order').last()
  const topic: Topic = { ...input, id: uid(), order: (last?.order ?? 0) + 1, createdAt: now, updatedAt: now }
  await db.topics.add(topic)
  return topic
}

export async function updateTopic(id: string, patch: Partial<Topic>) {
  await db.topics.update(id, { ...patch, updatedAt: Date.now() })
}

export async function deleteTopic(id: string) {
  await db.transaction('rw', db.topics, db.strategies, db.reviews, db.pending, async () => {
    const ids = await db.strategies.where('topicId').equals(id).primaryKeys()
    await db.pending.bulkDelete(ids)
    await db.reviews.where('strategyId').anyOf(ids).delete()
    await db.strategies.bulkDelete(ids)
    await db.topics.delete(id)
  })
}

export async function createStrategy(topicId: string, title = '未命名策略', opts: { content?: string; isDraft?: boolean; draftOf?: string } = {}) {
  const now = Date.now()
  const s: Strategy = {
    id: uid(), topicId, title, content: opts.content ?? '', score: 0, status: 'trial',
    createdAt: now, updatedAt: now, statusChangedAt: now,
    ...(opts.isDraft ? { isDraft: true } : {}), ...(opts.draftOf ? { draftOf: opts.draftOf } : {}),
  }
  await db.strategies.add(s)
  return s
}

export async function updateStrategy(id: string, patch: Partial<Strategy>) {
  await db.strategies.update(id, { ...patch, updatedAt: Date.now() })
}

export async function deleteStrategy(id: string) {
  await db.transaction('rw', db.strategies, db.reviews, db.pending, async () => {
    await db.pending.delete(id)
    await db.reviews.where('strategyId').equals(id).delete()
    await db.strategies.delete(id)
  })
}

function nextStatus(cur: Status, score: number, t: Topic): Status {
  if (cur !== 'eliminated' && score <= t.eliminateAt) return 'eliminated'
  if (cur === 'trial' && score >= t.keepAt) return 'kept'
  return cur
}

/** 复盘打分：记录一次评价，并按主题阈值自动转换状态 */
export async function addReview(strategyId: string, delta: number, note: string) {
  return db.transaction('rw', db.topics, db.strategies, db.reviews, async () => {
    const s = await db.strategies.get(strategyId)
    if (!s) return
    const t = await db.topics.get(s.topicId)
    if (!t) return
    const score = s.score + delta
    const status = nextStatus(s.status, score, t)
    const now = Date.now()
    await db.reviews.add({
      id: uid(), strategyId, delta, note, scoreAfter: score, createdAt: now,
      statusChange: status !== s.status ? { from: s.status, to: status } : undefined,
    })
    await db.strategies.update(strategyId, {
      score, status, updatedAt: now, nextAskAt: now + askInterval(status),
      ...(status !== s.status ? { statusChangedAt: now } : {}),
    })
    return status !== s.status ? status : undefined
  })
}

/** 手动改变状态（淘汰 / 恢复试用 / 直接留存） */
export async function setStatus(strategyId: string, to: Status, note: string) {
  await db.transaction('rw', db.strategies, db.reviews, async () => {
    const s = await db.strategies.get(strategyId)
    if (!s || s.status === to) return
    // 从淘汰恢复时分数归零，重新开始试用
    const score = s.status === 'eliminated' && to !== 'eliminated' ? 0 : s.score
    const now = Date.now()
    await db.reviews.add({
      id: uid(), strategyId, delta: score - s.score, note, scoreAfter: score, createdAt: now,
      statusChange: { from: s.status, to },
    })
    await db.strategies.update(strategyId, { status: to, score, updatedAt: now, statusChangedAt: now })
  })
}

export interface Backup {
  app: 'iteration-plan'
  version: 1
  exportedAt: number
  topics: Topic[]
  strategies: Strategy[]
  reviews: Review[]
}

export async function exportAll(): Promise<Backup> {
  const [topics, strategies, reviews] = await Promise.all([db.topics.toArray(), db.strategies.toArray(), db.reviews.toArray()])
  return { app: 'iteration-plan', version: 1, exportedAt: Date.now(), topics, strategies, reviews }
}

export async function importAll(data: Backup) {
  if (data?.app !== 'iteration-plan') throw new Error('不是有效的备份文件')
  await db.transaction('rw', db.topics, db.strategies, db.reviews, db.pending, async () => {
    await Promise.all([db.topics.clear(), db.strategies.clear(), db.reviews.clear(), db.pending.clear()])
    await db.topics.bulkAdd(data.topics)
    await db.strategies.bulkAdd(data.strategies)
    await db.reviews.bulkAdd(data.reviews)
  })
}

/** 把一条未保存的修改克隆成草稿策略，并清掉这条修改。返回新草稿（原策略不存在或无实际改动时返回 undefined） */
export async function pendingToDraft(strategyId: string) {
  return db.transaction('rw', db.strategies, db.pending, async () => {
    const p = await db.pending.get(strategyId)
    if (!p) return
    await db.pending.delete(strategyId)
    const s = await db.strategies.get(strategyId)
    if (!s || (p.title === s.title && p.content === s.content)) return
    return createStrategy(s.topicId, `${p.title || s.title}（草稿）`, { content: p.content, isDraft: true, draftOf: s.id })
  })
}

/** 启动时把上次没来得及处理的未保存修改（例如直接关掉了页面）转成草稿 */
export async function convertAllPending() {
  const ids = await db.pending.toCollection().primaryKeys()
  for (const id of ids) await pendingToDraft(id)
  return ids.length
}

/** 草稿发布为正式策略（开始试用，分数从 0 起） */
export async function publishDraft(id: string) {
  const now = Date.now()
  await db.strategies.update(id, { isDraft: false, draftOf: undefined, score: 0, status: 'trial', createdAt: now, statusChangedAt: now, updatedAt: now })
}

/** 用草稿内容覆盖原策略，并删除草稿 */
export async function mergeDraftIntoOriginal(draftId: string) {
  return db.transaction('rw', db.strategies, db.reviews, db.pending, async () => {
    const d = await db.strategies.get(draftId)
    if (!d?.draftOf) return
    const orig = await db.strategies.get(d.draftOf)
    if (!orig) return
    await db.strategies.update(orig.id, { title: d.title.replace(/（草稿）$/, ''), content: d.content, updatedAt: Date.now() })
    await db.pending.delete(orig.id)
    await deleteStrategy(draftId)
    return orig.id
  })
}

/** 每个策略最近一次复盘时间 */
export async function lastReviewMap() {
  const m = new Map<string, number>()
  await db.reviews.each((r) => { if ((m.get(r.strategyId) ?? 0) < r.createdAt) m.set(r.strategyId, r.createdAt) })
  return m
}

const DAY = 86400000
/** 多久问一次：试用中的策略 7 天，已留存的 30 天 */
export const askInterval = (st: Status) => (st === 'kept' ? 30 : 7) * DAY
/** 该不该主动问一问这个策略（last = 最近一次复盘时间） */
export function askAt(s: Strategy, last?: number) {
  return s.nextAskAt ?? (last ?? s.createdAt) + askInterval(s.status)
}
export const isDue = (s: Strategy, last?: number) =>
  !s.isDraft && s.status !== 'eliminated' && Date.now() >= askAt(s, last)

/** 「过几天再问」 */
export async function snoozeAsk(id: string, days = 3) {
  await db.strategies.update(id, { nextAskAt: Date.now() + days * DAY })
}
