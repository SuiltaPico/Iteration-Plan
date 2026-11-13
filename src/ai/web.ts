import { tool } from 'ai'
import { z } from 'zod'
import { webKeyOf, type AiSettings } from './settings'

/** DeepSeek Search / Fetch API：POST /v1/tools/search 与 /v1/tools/fetch */
async function call(s: AiSettings, path: string, body: unknown) {
  const key = webKeyOf(s)
  if (!key) throw new Error('没有可用的 DeepSeek API Key，请在 AI 设置的「联网」里填写。')
  let res: Response
  try {
    res = await fetch(`${(s.webBase || 'https://api.deepseek.com').replace(/\/+$/, '')}/v1/tools/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('连不上 DeepSeek 联网接口：可能是网络问题，或该接口不允许浏览器直接调用。')
  }
  if (!res.ok) {
    let msg = ''
    try { const j = await res.json(); msg = j?.error?.message ?? j?.message ?? '' } catch { /* 忽略 */ }
    if (res.status === 401) throw new Error('DeepSeek API Key 无效。')
    if (res.status === 402) throw new Error('DeepSeek 账户余额不足。')
    if (res.status === 429) throw new Error('联网请求太频繁，请稍后再试。')
    throw new Error(`DeepSeek 联网接口返回 ${res.status}${msg ? `：${msg}` : ''}`)
  }
  return res.json()
}

const pick = (o: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) if (typeof o[k] === 'string' && o[k]) return o[k] as string
  return undefined
}
const MAX_PAGE = 24000

export async function webSearch(s: AiSettings, query: string, count = 8) {
  const r = await call(s, 'search', { query, count })
  const list = (Array.isArray(r?.results) ? r.results : []) as Record<string, unknown>[]
  return {
    results: list.map((x) => ({
      title: pick(x, 'title') ?? '',
      url: pick(x, 'url', 'link') ?? '',
      site: pick(x, 'site_name', 'site'),
      date: pick(x, 'date', 'published_at', 'publish_time'),
      summary: (pick(x, 'summary', 'snippet', 'content') ?? '').slice(0, 900),
      score: typeof x.rerank_score === 'number' ? x.rerank_score : undefined,
    })),
  }
}

export function webTools(s: AiSettings) {
  return {
    web_search: tool({
      description: '用 DeepSeek 搜索网页。需要最新信息、外部资料、别人的经验或方法时使用。返回标题、链接、站点、日期和摘要；需要细读时再用 web_fetch。',
      inputSchema: z.object({
        query: z.string().min(1).max(128).describe('搜索词，最多 128 字，支持 site:、-site:、引号短语'),
        count: z.number().int().min(1).max(20).optional().describe('结果数，默认 8'),
      }),
      execute: ({ query, count }) => webSearch(s, query, count ?? 8),
    }),

    web_fetch: tool({
      description: '用 DeepSeek 读取一个网页，返回标题和 Markdown 正文（过长会截断）。只读用户给出或 web_search 找到的链接。',
      inputSchema: z.object({ url: z.string().url().describe('http/https 链接') }),
      execute: async ({ url }) => {
        const r = await call(s, 'fetch', { url })
        const content = String(r?.content ?? '')
        return {
          title: String(r?.title ?? ''),
          content: content.length > MAX_PAGE ? `${content.slice(0, MAX_PAGE)}\n\n…（正文过长，已截断）` : content,
        }
      },
    }),
  }
}
