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
  /** 多久主动问一次（天）：试用中 / 已留存，默认 7 / 30 */
  askDaysTrial?: number
  askDaysKept?: number
  order: number
  createdAt: number
  updatedAt: number
}

/** 主题下要解决的一个具体问题；问题下的策略互为候选解法 */
export interface Problem {
  id: string
  topicId: string
  title: string
  description: string
  order: number
  createdAt: number
  updatedAt: number
}

export interface Strategy {
  id: string
  topicId: string
  /** 所属问题；为空时归在「未归类」 */
  problemId?: string
  title: string
  content: string
  /** 怎么判断有效：复盘时对照着回答 */
  criteria?: string
  score: number
  status: Status
  /** 版本号，大改后「存为新版本」会 +1 并重新试用；旧数据视为 1 */
  version?: number
  /** 演化来源：由哪个策略另存或草稿发布而来 */
  parentId?: string
  /** 淘汰原因 / 教训，汇总为主题的「踩过的坑」 */
  lesson?: string
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
  criteria?: string
  updatedAt: number
}

/** 复盘结果：执行了且有效 / 执行了但无效 / 没怎么执行 / 只记录观察 */
export type Outcome = 'worked' | 'failed' | 'skipped' | 'note'
export type CriteriaMet = 'yes' | 'partly' | 'no'

export interface Review {
  id: string
  strategyId: string
  delta: number
  note: string
  scoreAfter: number
  statusChange?: { from: Status; to: Status }
  /** 旧记录没有，按 delta 推断 */
  outcome?: Outcome
  criteriaMet?: CriteriaMet
  /** 复盘时策略的版本 */
  version?: number
  /** 系统事件（例如开始新版本），不是用户的复盘 */
  event?: 'new-version'
  createdAt: number
}

/** 「记一笔」：某次实际用了这个策略，当时的情况和结果。不计分，复盘时参考 */
export type LogResult = 'good' | 'meh' | 'bad'
export interface UsageLog {
  id: string
  strategyId: string
  note: string
  result?: LogResult
  createdAt: number
}
export const LOG_RESULT_LABEL: Record<LogResult, string> = { good: '顺利', meh: '一般', bad: '不理想' }

/** 杂项键值：profile =「关于我」 */
export interface Meta {
  key: string
  value: string
  updatedAt: number
}

/** 删除记录，同步时避免已删除的数据从其他设备「复活」 */
export interface Tombstone {
  id: string
  table: SyncTable
  at: number
}
export type SyncTable = 'topics' | 'problems' | 'strategies' | 'reviews' | 'logs' | 'meta'

export const db = new Dexie('iteration-plan') as Dexie & {
  topics: EntityTable<Topic, 'id'>
  problems: EntityTable<Problem, 'id'>
  strategies: EntityTable<Strategy, 'id'>
  reviews: EntityTable<Review, 'id'>
  pending: EntityTable<PendingEdit, 'strategyId'>
  logs: EntityTable<UsageLog, 'id'>
  meta: EntityTable<Meta, 'key'>
  tombstones: EntityTable<Tombstone, 'id'>
}

db.version(1).stores({
  topics: 'id, order, createdAt',
  strategies: 'id, topicId, status, score, updatedAt, createdAt',
  reviews: 'id, strategyId, createdAt',
})
db.version(2).stores({
  pending: 'strategyId',
})
db.version(3).stores({
  problems: 'id, topicId, order',
  strategies: 'id, topicId, problemId, parentId, status, score, updatedAt, createdAt',
})
db.version(4).stores({
  logs: 'id, strategyId, createdAt',
  meta: 'key',
  tombstones: 'id',
})

const bury = (table: SyncTable, ids: string[]) => {
  const at = Date.now()
  return db.tombstones.bulkPut(ids.map((id) => ({ id, table, at })))
}

export const STATUS_LABEL: Record<Status, string> = {
  trial: '试用中',
  kept: '已留存',
  eliminated: '已淘汰',
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  worked: '执行了 · 有效',
  failed: '执行了 · 无效',
  skipped: '没怎么执行',
  note: '只记录',
}
export const OUTCOME_DELTA: Record<Outcome, number> = { worked: 1, failed: -1, skipped: 0, note: 0 }
export const CRITERIA_LABEL: Record<CriteriaMet, string> = { yes: '达到', partly: '部分达到', no: '没达到' }

export const outcomeOf = (r: Review): Outcome => r.outcome ?? (r.delta > 0 ? 'worked' : r.delta < 0 ? 'failed' : 'note')
export const versionOf = (s: Strategy) => s.version ?? 1

export const TOPIC_COLORS = ['#4f46e5', '#0891b2', '#059669', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#7c3aed', '#475569']

const uid = () => crypto.randomUUID()
const DAY = 86400000

/* ---------------- 主题 ---------------- */

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
  await db.transaction('rw', [db.topics, db.problems, db.strategies, db.reviews, db.logs, db.pending, db.tombstones], async () => {
    const ids = await db.strategies.where('topicId').equals(id).primaryKeys()
    const reviewIds = await db.reviews.where('strategyId').anyOf(ids).primaryKeys()
    const logIds = await db.logs.where('strategyId').anyOf(ids).primaryKeys()
    const problemIds = await db.problems.where('topicId').equals(id).primaryKeys()
    await Promise.all([
      bury('reviews', reviewIds), bury('logs', logIds), bury('strategies', ids), bury('problems', problemIds), bury('topics', [id]),
    ])
    await db.pending.bulkDelete(ids)
    await db.reviews.bulkDelete(reviewIds)
    await db.logs.bulkDelete(logIds)
    await db.strategies.bulkDelete(ids)
    await db.problems.bulkDelete(problemIds)
    await db.topics.delete(id)
  })
}

/* ---------------- 问题 ---------------- */

export async function createProblem(topicId: string, title: string, description = '') {
  const now = Date.now()
  const siblings = await db.problems.where('topicId').equals(topicId).toArray()
  const p: Problem = {
    id: uid(), topicId, title, description, createdAt: now, updatedAt: now,
    order: siblings.reduce((m, x) => Math.max(m, x.order), 0) + 1,
  }
  await db.problems.add(p)
  return p
}

export async function updateProblem(id: string, patch: Partial<Problem>) {
  await db.problems.update(id, { ...patch, updatedAt: Date.now() })
}

/** 删除问题：其下的策略移到「未归类」 */
export async function deleteProblem(id: string) {
  await db.transaction('rw', db.problems, db.strategies, db.tombstones, async () => {
    const now = Date.now()
    await db.strategies.where('problemId').equals(id).modify((s) => { delete s.problemId; s.updatedAt = now })
    await bury('problems', [id])
    await db.problems.delete(id)
  })
}

/* ---------------- 策略 ---------------- */

export async function createStrategy(
  topicId: string,
  title = '未命名策略',
  opts: { content?: string; criteria?: string; problemId?: string; isDraft?: boolean; draftOf?: string; parentId?: string } = {},
) {
  const now = Date.now()
  const s: Strategy = {
    id: uid(), topicId, title, content: opts.content ?? '', score: 0, status: 'trial', version: 1,
    createdAt: now, updatedAt: now, statusChangedAt: now,
  }
  if (opts.criteria) s.criteria = opts.criteria
  if (opts.problemId) s.problemId = opts.problemId
  if (opts.isDraft) s.isDraft = true
  if (opts.draftOf) s.draftOf = opts.draftOf
  if (opts.parentId) s.parentId = opts.parentId
  await db.strategies.add(s)
  return s
}

export async function updateStrategy(id: string, patch: Partial<Strategy>) {
  await db.strategies.update(id, { ...patch, updatedAt: Date.now() })
}

export async function deleteStrategy(id: string) {
  await db.transaction('rw', [db.strategies, db.reviews, db.logs, db.pending, db.tombstones], async () => {
    const reviewIds = await db.reviews.where('strategyId').equals(id).primaryKeys()
    const logIds = await db.logs.where('strategyId').equals(id).primaryKeys()
    await Promise.all([bury('reviews', reviewIds), bury('logs', logIds), bury('strategies', [id])])
    await db.pending.delete(id)
    await db.reviews.bulkDelete(reviewIds)
    await db.logs.bulkDelete(logIds)
    // 由它衍生的策略不再指向它
    const now = Date.now()
    await db.strategies.where('parentId').equals(id).modify((s) => { delete s.parentId; s.updatedAt = now })
    await db.strategies.delete(id)
  })
}

function nextStatus(cur: Status, score: number, t: Topic): Status {
  if (cur !== 'eliminated' && score <= t.eliminateAt) return 'eliminated'
  if (cur === 'trial' && score >= t.keepAt) return 'kept'
  return cur
}

/** 复盘：按结果计分（有效 +1、无效 −1、没执行和只记录不计分），并按主题阈值自动转换状态 */
export async function addReview(strategyId: string, outcome: Outcome, note: string, criteriaMet?: CriteriaMet) {
  return db.transaction('rw', db.topics, db.strategies, db.reviews, async () => {
    const s = await db.strategies.get(strategyId)
    if (!s) return
    const t = await db.topics.get(s.topicId)
    if (!t) return
    const delta = OUTCOME_DELTA[outcome]
    const score = s.score + delta
    const status = nextStatus(s.status, score, t)
    const now = Date.now()
    const r: Review = {
      id: uid(), strategyId, delta, note, scoreAfter: score, createdAt: now, outcome, version: versionOf(s),
    }
    if (criteriaMet) r.criteriaMet = criteriaMet
    if (status !== s.status) r.statusChange = { from: s.status, to: status }
    await db.reviews.add(r)
    await db.strategies.update(strategyId, {
      score, status, updatedAt: now, nextAskAt: now + askInterval(status, t),
      ...(status !== s.status ? { statusChangedAt: now } : {}),
    })
    return status !== s.status ? status : undefined
  })
}

/** 手动改变状态（淘汰 / 恢复试用 / 直接留存）；淘汰时可以顺便记下教训 */
export async function setStatus(strategyId: string, to: Status, note: string, lesson?: string) {
  await db.transaction('rw', db.strategies, db.reviews, async () => {
    const s = await db.strategies.get(strategyId)
    if (!s || s.status === to) return
    // 从淘汰恢复时分数归零，重新开始试用
    const score = s.status === 'eliminated' && to !== 'eliminated' ? 0 : s.score
    const now = Date.now()
    await db.reviews.add({
      id: uid(), strategyId, delta: score - s.score, note, scoreAfter: score, createdAt: now,
      statusChange: { from: s.status, to }, outcome: 'note', version: versionOf(s),
    })
    await db.strategies.update(strategyId, {
      status: to, score, updatedAt: now, statusChangedAt: now,
      ...(lesson !== undefined ? { lesson } : {}),
    })
  })
}

/** 保存为新版本：内容更新，版本 +1，分数清零重新试用（之前的复盘记录保留，标着旧版本号） */
export async function saveAsNewVersion(strategyId: string, patch: Pick<Strategy, 'title' | 'content'> & { criteria?: string }) {
  await db.transaction('rw', db.topics, db.strategies, db.reviews, db.pending, async () => {
    const s = await db.strategies.get(strategyId)
    if (!s) return
    const t = await db.topics.get(s.topicId)
    const now = Date.now()
    const version = versionOf(s) + 1
    await db.reviews.add({
      id: uid(), strategyId, delta: -s.score, note: `开始第 ${version} 版，分数清零重新试用`, scoreAfter: 0,
      createdAt: now, outcome: 'note', version, event: 'new-version',
      ...(s.status !== 'trial' ? { statusChange: { from: s.status, to: 'trial' as Status } } : {}),
    })
    await db.strategies.update(strategyId, {
      ...patch, version, score: 0, status: 'trial', statusChangedAt: now, updatedAt: now,
      nextAskAt: now + askInterval('trial', t),
    })
    await db.pending.delete(strategyId)
  })
}

/** 最近几次（当前版本）复盘里「没怎么执行」的次数，用来提示策略可能太难坚持 */
export function skippedRecently(s: Strategy, reviews: Review[]) {
  const mine = reviews
    .filter((r) => !r.event && (r.version ?? 1) === versionOf(s) && outcomeOf(r) !== 'note')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 3)
  return mine.filter((r) => outcomeOf(r) === 'skipped').length
}

/* ---------------- 备份 ---------------- */

export interface Backup {
  app: 'iteration-plan'
  version: 1 | 2 | 3
  exportedAt: number
  topics: Topic[]
  problems?: Problem[]
  strategies: Strategy[]
  reviews: Review[]
  logs?: UsageLog[]
  meta?: Meta[]
  tombstones?: Tombstone[]
}

export async function exportAll(): Promise<Backup> {
  const [topics, problems, strategies, reviews, logs, meta, tombstones] = await Promise.all([
    db.topics.toArray(), db.problems.toArray(), db.strategies.toArray(), db.reviews.toArray(),
    db.logs.toArray(), db.meta.toArray(), db.tombstones.toArray(),
  ])
  return { app: 'iteration-plan', version: 3, exportedAt: Date.now(), topics, problems, strategies, reviews, logs, meta, tombstones }
}

/** 用一份完整数据替换本地数据（导入备份、同步合并后写回） */
export async function replaceAll(data: Backup) {
  await db.transaction('rw', [db.topics, db.problems, db.strategies, db.reviews, db.logs, db.meta, db.tombstones], async () => {
    await Promise.all([db.topics.clear(), db.problems.clear(), db.strategies.clear(), db.reviews.clear(), db.logs.clear(), db.meta.clear(), db.tombstones.clear()])
    await db.topics.bulkAdd(data.topics)
    await db.problems.bulkAdd(data.problems ?? [])
    await db.strategies.bulkAdd(data.strategies)
    await db.reviews.bulkAdd(data.reviews)
    await db.logs.bulkAdd(data.logs ?? [])
    await db.meta.bulkAdd(data.meta ?? [])
    await db.tombstones.bulkAdd(data.tombstones ?? [])
  })
}

export async function importAll(data: Backup) {
  if (data?.app !== 'iteration-plan') throw new Error('不是有效的备份文件')
  await db.pending.clear()
  await replaceAll(data)
}

/* ---------------- 草稿 ---------------- */

/** 把一条未保存的修改克隆成草稿策略，并清掉这条修改。返回新草稿（原策略不存在或无实际改动时返回 undefined） */
export async function pendingToDraft(strategyId: string) {
  return db.transaction('rw', db.strategies, db.pending, async () => {
    const p = await db.pending.get(strategyId)
    if (!p) return
    await db.pending.delete(strategyId)
    const s = await db.strategies.get(strategyId)
    if (!s) return
    const criteria = p.criteria ?? s.criteria ?? ''
    if (p.title === s.title && p.content === s.content && criteria === (s.criteria ?? '')) return
    return createStrategy(s.topicId, `${p.title || s.title}（草稿）`, {
      content: p.content, criteria, problemId: s.problemId, isDraft: true, draftOf: s.id,
    })
  })
}

/** 启动时把上次没来得及处理的未保存修改（例如直接关掉了页面）转成草稿 */
export async function convertAllPending() {
  const ids = await db.pending.toCollection().primaryKeys()
  for (const id of ids) await pendingToDraft(id)
  return ids.length
}

/** 草稿发布为正式策略（开始试用，分数从 0 起）；如果是从某个策略改来的，记下演化关系 */
export async function publishDraft(id: string) {
  const now = Date.now()
  await db.strategies.where('id').equals(id).modify((s) => {
    if (s.draftOf) s.parentId = s.draftOf
    delete s.draftOf
    s.isDraft = false
    s.title = s.title.replace(/（草稿）$/, '')
    Object.assign(s, { score: 0, status: 'trial', version: 1, createdAt: now, statusChangedAt: now, updatedAt: now })
  })
}

/** 用草稿内容覆盖原策略，并删除草稿 */
export async function mergeDraftIntoOriginal(draftId: string) {
  return db.transaction('rw', [db.strategies, db.reviews, db.logs, db.pending, db.tombstones], async () => {
    const d = await db.strategies.get(draftId)
    if (!d?.draftOf) return
    const orig = await db.strategies.get(d.draftOf)
    if (!orig) return
    await db.strategies.update(orig.id, {
      title: d.title.replace(/（草稿）$/, ''), content: d.content, criteria: d.criteria, updatedAt: Date.now(),
    })
    await db.pending.delete(orig.id)
    await deleteStrategy(draftId)
    return orig.id
  })
}

/* ---------------- 问一问 ---------------- */

/** 每个策略最近一次复盘时间 */
export async function lastReviewMap() {
  const m = new Map<string, number>()
  await db.reviews.each((r) => {
    if (!r.event && (m.get(r.strategyId) ?? 0) < r.createdAt) m.set(r.strategyId, r.createdAt)
  })
  return m
}

export const DEFAULT_ASK_DAYS = { trial: 7, kept: 30 }
/** 多久问一次：按主题设置，默认试用中 7 天、已留存 30 天 */
export const askInterval = (st: Status, t?: Pick<Topic, 'askDaysTrial' | 'askDaysKept'>) =>
  (st === 'kept' ? t?.askDaysKept ?? DEFAULT_ASK_DAYS.kept : t?.askDaysTrial ?? DEFAULT_ASK_DAYS.trial) * DAY
/** 什么时候该主动问一问这个策略（last = 最近一次复盘时间）。没复盘过时按主题当前设置计算 */
export function askAt(s: Strategy, last?: number, t?: Topic) {
  return s.nextAskAt ?? (last ?? s.createdAt) + askInterval(s.status, t)
}
export const isDue = (s: Strategy, last?: number, t?: Topic) =>
  !s.isDraft && s.status !== 'eliminated' && Date.now() >= askAt(s, last, t)

/** 「过几天再问」 */
export async function snoozeAsk(id: string, days = 3) {
  await db.strategies.update(id, { nextAskAt: Date.now() + days * DAY, updatedAt: Date.now() })
}

/* ---------------- 记一笔 ---------------- */

export async function addLog(strategyId: string, note: string, result?: LogResult) {
  const l: UsageLog = { id: uid(), strategyId, note, createdAt: Date.now() }
  if (result) l.result = result
  await db.logs.add(l)
  return l
}

export async function deleteLog(id: string) {
  await db.transaction('rw', db.logs, db.tombstones, async () => {
    await bury('logs', [id])
    await db.logs.delete(id)
  })
}

/* ---------------- 关于我 ---------------- */

export async function getProfile() {
  return (await db.meta.get('profile'))?.value ?? ''
}
export async function setProfile(value: string) {
  await db.meta.put({ key: 'profile', value, updatedAt: Date.now() })
}
