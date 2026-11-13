import { tool } from 'ai'
import { z } from 'zod'
import {
  addLog, addReview, createProblem, LOG_RESULT_LABEL, createStrategy, createTopic, db, deleteStrategy, OUTCOME_LABEL, outcomeOf, setStatus,
  getProfile, setProfile, STATUS_LABEL, TOPIC_COLORS, updateProblem, updateTopic, versionOf,
} from '../db'
import { contentChanged } from '../bus'
import { daysSince, excerpt, fmtDate } from '../util'

const statusEnum = z.enum(['trial', 'kept', 'eliminated'])

async function mustStrategy(id: string) {
  const s = await db.strategies.get(id)
  if (!s) throw new Error(`策略 ${id} 不存在，请先用 list_strategies 查询正确的 id`)
  return s
}
async function mustTopic(id: string) {
  const t = await db.topics.get(id)
  if (!t) throw new Error(`主题 ${id} 不存在，请先用 list_topics 查询正确的 id`)
  return t
}
async function checkProblem(problemId: string | undefined, topicId: string) {
  if (!problemId) return
  const p = await db.problems.get(problemId)
  if (!p || p.topicId !== topicId) throw new Error(`问题 ${problemId} 不在这个主题下，请先用 list_problems 查询`)
}

export const tools = {
  list_topics: tool({
    description: '列出所有主题，包含各状态策略数量和多久问一次。',
    inputSchema: z.object({}),
    execute: async () => {
      const [topics, strategies] = await Promise.all([db.topics.orderBy('order').toArray(), db.strategies.toArray()])
      return topics.map((t) => {
        const mine = strategies.filter((s) => s.topicId === t.id)
        return {
          id: t.id, name: t.name, description: t.description, askDaysTrial: t.askDaysTrial ?? 7, askDaysKept: t.askDaysKept ?? 30,
          drafts: mine.filter((s) => s.isDraft).length,
          trial: mine.filter((s) => !s.isDraft && s.status === 'trial').length,
          kept: mine.filter((s) => !s.isDraft && s.status === 'kept').length,
          eliminated: mine.filter((s) => !s.isDraft && s.status === 'eliminated').length,
        }
      })
    },
  }),

  list_problems: tool({
    description: '列出某个主题下的问题。问题是主题里要解决的具体事情，问题下的策略互为候选解法。',
    inputSchema: z.object({ topicId: z.string() }),
    execute: async ({ topicId }) => {
      const problems = await db.problems.where('topicId').equals(topicId).sortBy('order')
      return problems.map((p) => ({ id: p.id, title: p.title, description: p.description }))
    },
  }),

  create_problem: tool({
    description: '在主题下新建一个问题。',
    inputSchema: z.object({ topicId: z.string(), title: z.string().min(1), description: z.string().optional() }),
    execute: async ({ topicId, title, description }) => {
      await mustTopic(topicId)
      const p = await createProblem(topicId, title, description ?? '')
      return { id: p.id, title: p.title }
    },
  }),

  update_problem: tool({
    description: '修改问题的标题或说明。',
    inputSchema: z.object({ id: z.string(), title: z.string().min(1).optional(), description: z.string().optional() }),
    execute: async ({ id, ...patch }) => {
      if (!(await db.problems.get(id))) throw new Error(`问题 ${id} 不存在`)
      await updateProblem(id, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)))
      return { ok: true }
    },
  }),

  list_strategies: tool({
    description: '列出策略（可按主题、问题、状态筛选），返回标题、所属问题、分数、状态、版本、判断标准和正文摘要。status 为 draft 的是草稿。',
    inputSchema: z.object({
      topicId: z.string().optional().describe('只看某个主题'),
      problemId: z.string().optional().describe('只看某个问题下的候选策略'),
      status: statusEnum.optional().describe('trial=试用中, kept=已留存, eliminated=已淘汰'),
    }),
    execute: async ({ topicId, problemId, status }) => {
      let list = topicId ? await db.strategies.where('topicId').equals(topicId).toArray() : await db.strategies.toArray()
      if (problemId) list = list.filter((s) => s.problemId === problemId)
      if (status) list = list.filter((s) => !s.isDraft && s.status === status)
      return list.map((s) => ({
        id: s.id, topicId: s.topicId, problemId: s.problemId ?? null, title: s.title, score: s.score,
        status: s.isDraft ? 'draft' : s.status, version: versionOf(s), daysInUse: daysSince(s.createdAt),
        criteria: s.criteria ?? '', excerpt: excerpt(s.content, 120),
        ...(s.status === 'eliminated' ? { lesson: s.lesson ?? '' } : {}),
      }))
    },
  }),

  get_strategy: tool({
    description: '读取一个策略的完整 Markdown 正文、判断标准、演化来源和复盘记录（含执行结果与版本）。',
    inputSchema: z.object({ id: z.string() }),
    execute: async ({ id }) => {
      const s = await mustStrategy(id)
      const [t, p, parent] = await Promise.all([
        db.topics.get(s.topicId), s.problemId ? db.problems.get(s.problemId) : undefined, s.parentId ? db.strategies.get(s.parentId) : undefined,
      ])
      const reviews = await db.reviews.where('strategyId').equals(id).sortBy('createdAt')
      const logs = await db.logs.where('strategyId').equals(id).sortBy('createdAt')
      return {
        id: s.id, title: s.title, content: s.content, criteria: s.criteria ?? '', score: s.score,
        status: s.isDraft ? 'draft' : s.status, version: versionOf(s), lesson: s.lesson ?? '',
        topicName: t?.name, problem: p?.title ?? null, derivedFrom: parent ? { id: parent.id, title: parent.title } : null,
        createdAt: fmtDate(s.createdAt), daysInUse: daysSince(s.createdAt),
        usageLogs: logs.slice(-30).map((l) => ({ at: fmtDate(l.createdAt), result: l.result ? LOG_RESULT_LABEL[l.result] : undefined, note: l.note })),
        reviews: reviews.slice(-30).map((r) => ({
          at: fmtDate(r.createdAt), version: r.version ?? 1,
          outcome: r.event ? '开始新版本' : OUTCOME_LABEL[outcomeOf(r)], criteriaMet: r.criteriaMet, note: r.note, scoreAfter: r.scoreAfter,
          statusChange: r.statusChange ? `${STATUS_LABEL[r.statusChange.from]}→${STATUS_LABEL[r.statusChange.to]}` : undefined,
        })),
      }
    },
  }),

  list_lessons: tool({
    description: '读取「踩过的坑」：已淘汰的策略和淘汰原因。出主意前先看，避免重复推荐同类做法。',
    inputSchema: z.object({ topicId: z.string().optional() }),
    execute: async ({ topicId }) => {
      const list = (topicId ? await db.strategies.where('topicId').equals(topicId).toArray() : await db.strategies.toArray())
        .filter((s) => !s.isDraft && s.status === 'eliminated')
      return list.map((s) => ({ id: s.id, topicId: s.topicId, problemId: s.problemId ?? null, title: s.title, lesson: s.lesson ?? '', excerpt: excerpt(s.content, 80) }))
    },
  }),

  get_profile: tool({
    description: '读取「关于我」：用户跨主题的个人规律（什么做法适合 TA、什么坚持不了）。',
    inputSchema: z.object({}),
    execute: async () => ({ content: await getProfile() }),
  }),

  update_profile: tool({
    description: '整体替换「关于我」的 Markdown 内容。先 get_profile 读原文，保留用户自己写的内容，再写回完整内容。',
    inputSchema: z.object({ content: z.string() }),
    execute: async ({ content }) => {
      await setProfile(content)
      contentChanged.emit('profile')
      return { ok: true }
    },
  }),

  create_topic: tool({
    description: '新建主题。',
    inputSchema: z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      askDaysTrial: z.number().int().min(1).optional().describe('试用中的策略多少天问一次，默认 7；按领域反馈周期定'),
      askDaysKept: z.number().int().min(1).optional().describe('已留存的策略多少天问一次，默认 30'),
    }),
    execute: async ({ name, description, askDaysTrial, askDaysKept }) => {
      const used = new Set((await db.topics.toArray()).map((t) => t.color))
      const color = TOPIC_COLORS.find((c) => !used.has(c)) ?? TOPIC_COLORS[Math.floor(Math.random() * TOPIC_COLORS.length)]
      const t = await createTopic({ name, description: description ?? '', color, askDaysTrial, askDaysKept })
      return { id: t.id, name: t.name }
    },
  }),

  update_topic: tool({
    description: '修改主题的名称、说明，或多久主动问一次（天）。',
    inputSchema: z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      askDaysTrial: z.number().int().min(1).optional().describe('试用中的策略多少天问一次'),
      askDaysKept: z.number().int().min(1).optional().describe('已留存的策略多少天问一次'),
    }),
    execute: async ({ id, ...patch }) => {
      await mustTopic(id)
      await updateTopic(id, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)))
      return { ok: true }
    },
  }),

  create_strategy: tool({
    description: '在主题（最好是某个问题）下新建策略，状态为试用中，分数 0。content 为 Markdown 正文，criteria 写怎么判断有效。',
    inputSchema: z.object({
      topicId: z.string(),
      problemId: z.string().optional().describe('所属问题 id；没有合适的问题时可先 create_problem'),
      title: z.string().min(1),
      content: z.string().describe('Markdown 正文'),
      criteria: z.string().describe('怎么判断有效：1-2 个可观察的信号'),
    }),
    execute: async ({ topicId, problemId, title, content, criteria }) => {
      await mustTopic(topicId)
      await checkProblem(problemId, topicId)
      const s = await createStrategy(topicId, title, { content, criteria, problemId })
      return { id: s.id, title }
    },
  }),

  update_strategy: tool({
    description: '修改策略的标题、Markdown 正文、判断标准，或移动到其他主题/问题。content 会整体替换原正文。属于小改动，分数保留。',
    inputSchema: z.object({
      id: z.string(),
      title: z.string().min(1).optional(),
      content: z.string().optional().describe('完整的新 Markdown 正文'),
      criteria: z.string().optional(),
      topicId: z.string().optional(),
      problemId: z.string().nullable().optional().describe('传 null 表示移到未归类'),
    }),
    execute: async ({ id, title, content, criteria, topicId, problemId }) => {
      const s = await mustStrategy(id)
      const tid = topicId ?? s.topicId
      if (topicId) await mustTopic(topicId)
      if (problemId) await checkProblem(problemId, tid)
      await db.strategies.where('id').equals(id).modify((x) => {
        if (title !== undefined) x.title = title
        if (content !== undefined) x.content = content
        if (criteria !== undefined) x.criteria = criteria
        if (topicId) { x.topicId = topicId; if (problemId === undefined) delete x.problemId }
        if (problemId === null) delete x.problemId
        else if (problemId) x.problemId = problemId
        x.updatedAt = Date.now()
      })
      if (content !== undefined || criteria !== undefined || title !== undefined) contentChanged.emit(id)
      return { ok: true }
    },
  }),

  add_review: tool({
    description: '给策略记一次复盘：worked=执行了且有效(+1)，failed=执行了但无效(-1)，skipped=没怎么执行(不计分)，note=只记录观察。只计分，不改变状态。只在用户明确要求时调用。',
    inputSchema: z.object({
      id: z.string(),
      outcome: z.enum(['worked', 'failed', 'skipped', 'note']),
      note: z.string().describe('复盘备注'),
      criteriaMet: z.enum(['yes', 'partly', 'no']).optional().describe('对照判断标准是否达到'),
    }),
    execute: async ({ id, outcome, note, criteriaMet }) => {
      await mustStrategy(id)
      await addReview(id, outcome, note, criteriaMet)
      const s = await db.strategies.get(id)
      return { score: s?.score, status: s?.status }
    },
  }),

  set_status: tool({
    description: '决定策略的状态：kept 留存、eliminated 淘汰、trial 继续/恢复试用。分数不变。用户要求改状态，或请你判断去留时调用；note 写明决定的依据，淘汰时 lesson 写为什么不行。',
    inputSchema: z.object({ id: z.string(), status: statusEnum, note: z.string().optional(), lesson: z.string().optional() }),
    execute: async ({ id, status, note, lesson }) => {
      await mustStrategy(id)
      await setStatus(id, status, note ? `AI 判断：${note}` : 'AI 助手操作', status === 'eliminated' ? lesson : undefined)
      return { ok: true }
    },
  }),

  add_log: tool({
    description: '记一笔使用记录：用户某次实际用了这个策略，当时的情况和结果。不计分。用户描述了一次具体使用经历时调用。',
    inputSchema: z.object({
      id: z.string(),
      note: z.string().min(1),
      result: z.enum(['good', 'meh', 'bad']).optional().describe('good=顺利 meh=一般 bad=不理想'),
    }),
    execute: async ({ id, note, result }) => {
      await mustStrategy(id)
      await addLog(id, note, result)
      return { ok: true }
    },
  }),

  delete_strategy: tool({
    description: '永久删除策略及其复盘记录。只在用户明确要求删除时调用；想放弃一个策略时优先用 set_status 淘汰。',
    inputSchema: z.object({ id: z.string() }),
    execute: async ({ id }) => {
      const s = await mustStrategy(id)
      await deleteStrategy(id)
      return { ok: true, title: s.title }
    },
  }),
}

export type ToolName = keyof typeof tools
