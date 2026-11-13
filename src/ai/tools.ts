import { tool } from 'ai'
import { z } from 'zod'
import {
  addReview, createStrategy, createTopic, db, deleteStrategy, setStatus, STATUS_LABEL,
  TOPIC_COLORS, updateStrategy, updateTopic,
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

export const tools = {
  list_topics: tool({
    description: '列出所有主题，包含各状态的策略数量与留存线/淘汰线。',
    inputSchema: z.object({}),
    execute: async () => {
      const [topics, strategies] = await Promise.all([db.topics.orderBy('order').toArray(), db.strategies.toArray()])
      return topics.map((t) => {
        const mine = strategies.filter((s) => s.topicId === t.id)
        return {
          id: t.id, name: t.name, description: t.description, keepAt: t.keepAt, eliminateAt: t.eliminateAt,
          trial: mine.filter((s) => s.status === 'trial').length,
          kept: mine.filter((s) => s.status === 'kept').length,
          eliminated: mine.filter((s) => s.status === 'eliminated').length,
        }
      })
    },
  }),

  list_strategies: tool({
    description: '列出策略（可按主题、状态筛选），返回标题、分数、状态、使用天数和正文摘要。',
    inputSchema: z.object({
      topicId: z.string().optional().describe('只看某个主题'),
      status: statusEnum.optional().describe('trial=试用中, kept=已留存, eliminated=已淘汰'),
    }),
    execute: async ({ topicId, status }) => {
      let list = topicId ? await db.strategies.where('topicId').equals(topicId).toArray() : await db.strategies.toArray()
      if (status) list = list.filter((s) => s.status === status)
      return list.map((s) => ({
        id: s.id, topicId: s.topicId, title: s.title, score: s.score, status: s.status,
        daysInUse: daysSince(s.createdAt), excerpt: excerpt(s.content, 120),
      }))
    },
  }),

  get_strategy: tool({
    description: '读取一个策略的完整 Markdown 正文与复盘记录。',
    inputSchema: z.object({ id: z.string() }),
    execute: async ({ id }) => {
      const s = await mustStrategy(id)
      const t = await db.topics.get(s.topicId)
      const reviews = await db.reviews.where('strategyId').equals(id).sortBy('createdAt')
      return {
        ...s, topicName: t?.name, createdAt: fmtDate(s.createdAt), updatedAt: fmtDate(s.updatedAt),
        daysInUse: daysSince(s.createdAt),
        reviews: reviews.slice(-30).map((r) => ({
          at: fmtDate(r.createdAt), delta: r.delta, note: r.note, scoreAfter: r.scoreAfter,
          statusChange: r.statusChange ? `${STATUS_LABEL[r.statusChange.from]}→${STATUS_LABEL[r.statusChange.to]}` : undefined,
        })),
      }
    },
  }),

  create_topic: tool({
    description: '新建主题。',
    inputSchema: z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      keepAt: z.number().int().min(1).optional().describe('留存线，默认 3'),
      eliminateAt: z.number().int().max(-1).optional().describe('淘汰线，默认 -3'),
    }),
    execute: async ({ name, description, keepAt, eliminateAt }) => {
      const used = new Set((await db.topics.toArray()).map((t) => t.color))
      const color = TOPIC_COLORS.find((c) => !used.has(c)) ?? TOPIC_COLORS[Math.floor(Math.random() * TOPIC_COLORS.length)]
      const t = await createTopic({ name, description: description ?? '', color, keepAt: keepAt ?? 3, eliminateAt: eliminateAt ?? -3 })
      return { id: t.id, name: t.name }
    },
  }),

  update_topic: tool({
    description: '修改主题的名称、说明或阈值。',
    inputSchema: z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      keepAt: z.number().int().min(1).optional(),
      eliminateAt: z.number().int().max(-1).optional(),
    }),
    execute: async ({ id, ...patch }) => {
      await mustTopic(id)
      await updateTopic(id, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)))
      return { ok: true }
    },
  }),

  create_strategy: tool({
    description: '在主题下新建策略（状态为试用中，分数 0）。content 为 Markdown 正文。',
    inputSchema: z.object({
      topicId: z.string(),
      title: z.string().min(1),
      content: z.string().describe('Markdown 正文'),
    }),
    execute: async ({ topicId, title, content }) => {
      await mustTopic(topicId)
      const s = await createStrategy(topicId, title)
      await updateStrategy(s.id, { content })
      return { id: s.id, title }
    },
  }),

  update_strategy: tool({
    description: '修改策略的标题、Markdown 正文，或移动到其他主题。content 会整体替换原正文。',
    inputSchema: z.object({
      id: z.string(),
      title: z.string().min(1).optional(),
      content: z.string().optional().describe('完整的新 Markdown 正文'),
      topicId: z.string().optional(),
    }),
    execute: async ({ id, title, content, topicId }) => {
      await mustStrategy(id)
      if (topicId) await mustTopic(topicId)
      const patch = Object.fromEntries(Object.entries({ title, content, topicId }).filter(([, v]) => v !== undefined))
      await updateStrategy(id, patch)
      if (content !== undefined) contentChanged.emit(id)
      return { ok: true }
    },
  }),

  add_review: tool({
    description: '给策略记一次复盘：delta=1 好用，-1 不好用，0 只记录观察。达到主题阈值会自动留存或淘汰。只在用户明确要求打分时调用。',
    inputSchema: z.object({
      id: z.string(),
      delta: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
      note: z.string().describe('复盘备注'),
    }),
    execute: async ({ id, delta, note }) => {
      await mustStrategy(id)
      const changed = await addReview(id, delta, note)
      const s = await db.strategies.get(id)
      return { score: s?.score, status: s?.status, statusChanged: changed ?? null }
    },
  }),

  set_status: tool({
    description: '手动改变策略状态（淘汰、留存、恢复试用）。从淘汰恢复时分数归零。只在用户明确要求时调用。',
    inputSchema: z.object({ id: z.string(), status: statusEnum, note: z.string().optional() }),
    execute: async ({ id, status, note }) => {
      await mustStrategy(id)
      await setStatus(id, status, note || 'AI 助手操作')
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
