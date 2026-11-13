import { APICallError, generateText, stepCountIs, streamText, type LanguageModel, type ModelMessage } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { AiSettings } from './settings'
import { tools } from './tools'
import { db, getProfile } from '../db'

export function buildModel(s: AiSettings): LanguageModel {
  const baseURL = s.baseURL.trim().replace(/\/+$/, '')
  if (s.protocol === 'anthropic') {
    return createAnthropic({
      baseURL,
      apiKey: s.apiKey.trim(),
      // 浏览器直连 Anthropic API 需要显式声明
      headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
    })(s.model.trim())
  }
  return createOpenAICompatible({ name: 'custom', baseURL, apiKey: s.apiKey.trim() })(s.model.trim())
}

export interface PageContext {
  topicId?: string
  strategyId?: string
}

async function describeContext(ctx: PageContext) {
  if (ctx.strategyId) {
    const s = await db.strategies.get(ctx.strategyId)
    if (s) {
      const t = await db.topics.get(s.topicId)
      const p = await db.pending.get(s.id)
      const draftNote = s.isDraft ? '这是一份草稿（不参与打分）。' : ''
      const pendingNote = p ? `\n用户在编辑器里有尚未保存的修改，用户说的「这个策略」以编辑器里的版本为准；如果你改写正文，请以它为基础：\n标题：${p.title}\n正文：\n${p.content}` : ''
      return `用户正在查看策略「${s.title}」(id: ${s.id})，所属主题「${t?.name}」(id: ${s.topicId})。${draftNote}用户说「这个策略」「当前策略」时指它。${pendingNote}`
    }
  }
  if (ctx.topicId) {
    const t = await db.topics.get(ctx.topicId)
    if (t) return `用户正在查看主题「${t.name}」(id: ${t.id})。用户说「这个主题」「当前主题」时指它。`
  }
  return '用户正在总览页。'
}

async function systemPrompt(ctx: PageContext) {
  const today = new Date().toISOString().slice(0, 10)
  return `你是「迭代策略」应用里的 AI 助手，帮用户管理个人策略。今天是 ${today}。

## 应用模型
- 主题：一个想改进的领域（如投资、自我管理、学习、AI 使用）。每个主题有留存线（默认 +3）和淘汰线（默认 -3）。
- 问题：主题下要解决的一件具体的事（如「什么时候卖出」「怎么记住新概念」）。同一问题下的策略互为候选解法，通过复盘比较，留下最适合用户的。
- 策略：一条具体可执行的做法。包含 Markdown 正文和「判断标准」（criteria：怎么判断有效，1-2 个可观察的信号）。新策略状态为「试用中」，分数 0。status 为 draft 的是草稿，不参与打分。
- 复盘结果：worked 执行了且有效 +1；failed 执行了但无效 -1；skipped 没怎么执行，不计分；note 只记录观察。分数 ≥ 留存线自动「已留存」，≤ 淘汰线自动「已淘汰」。
- 版本：策略大改后会存为新版本，分数清零重新试用；复盘记录带版本号，评价时只看当前版本的表现。
- 踩过的坑：淘汰的策略带 lesson（为什么不行）。
- 使用记录：用户每次实际用了某个策略时「记一笔」（情况和结果，不计分），是复盘时最可靠的依据。
- 关于我：跨主题提炼出的用户个人规律，见下方。

## 工作方式
- 你可以直接用工具读写数据，改动会立即生效，不需要再向用户确认。
- 需要 id 时先用 list_topics / list_problems / list_strategies 查，不要编造 id。
- 出主意或新建策略前，先用 list_lessons 看这个主题踩过的坑，不要推荐同类已失败的做法；也不要和已有策略重复。
- 新建策略时放进合适的问题（没有就先 create_problem），并一定写 criteria。
- 策略正文的写法：开头一句话说明目的；「做法」用列表写清具体、可执行的步骤（何时、做什么、做多少）；需要时加「注意」。判断标准写在 criteria 字段，不要写进正文。篇幅适中，不写空话。
- 润色或补全某个策略时，先 get_strategy 读原文，保留用户原有的意思和细节，再用 update_strategy 写回。
- 给复盘建议时，看当前版本的复盘：多次「没怎么执行」说明太难坚持，建议简化而不是淘汰；「执行了但无效」才说明做法本身不对；对照判断标准是否达到。同一问题下已有留存的策略时，提示其他候选是否该退场。只给建议，不要擅自打分、淘汰或删除。
- 出任何主意都要符合「关于我」里的规律（例如用户坚持不了需要固定时间的做法，就别推荐这类）。
- 提炼「关于我」时：读各主题的踩过的坑（list_lessons）、复盘里的「没怎么执行」、使用记录和留存的策略，归纳 3~8 条跨主题的规律，每条写清依据（来自哪些策略或教训）；保留用户自己写的内容，用 update_profile 写回。
- 打分（add_review）、改状态（set_status）、删除（delete_strategy）只在用户明确要求时执行。
- 用中文回复。完成操作后用一两句话说明做了什么，不要复述整篇正文。

## 关于我
${(await getProfile()).trim().slice(0, 4000) || '（还没有内容）'}

## 当前页面
${await describeContext(ctx)}`
}

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; id: string; name: string; input: unknown }
  | { type: 'tool-result'; id: string; output: unknown }
  | { type: 'tool-error'; id: string; error: string }

/** 跑一轮对话（含多步工具调用），返回本轮新增的消息，供下一轮继续 */
export async function runAgent(opts: {
  settings: AiSettings
  history: ModelMessage[]
  context: PageContext
  signal: AbortSignal
  onEvent: (e: AgentEvent) => void
}): Promise<ModelMessage[]> {
  let streamError: unknown
  const result = streamText({
    model: buildModel(opts.settings),
    instructions: await systemPrompt(opts.context),
    messages: opts.history,
    tools,
    stopWhen: stepCountIs(25),
    abortSignal: opts.signal,
    onError: ({ error }) => { streamError = error },
  })
  for await (const part of result.fullStream) {
    switch (part.type) {
      case 'text-delta': opts.onEvent({ type: 'text', text: part.text }); break
      case 'tool-call': opts.onEvent({ type: 'tool-call', id: part.toolCallId, name: part.toolName, input: part.input }); break
      case 'tool-result': opts.onEvent({ type: 'tool-result', id: part.toolCallId, output: part.output }); break
      case 'tool-error': opts.onEvent({ type: 'tool-error', id: part.toolCallId, error: errorText(part.error) }); break
      case 'error': streamError = part.error; break
    }
  }
  if (streamError) throw streamError
  return (await result.response).messages
}

export async function testConnection(s: AiSettings) {
  const r = await generateText({ model: buildModel(s), prompt: '只回复两个字：你好' })
  return r.text.trim()
}

export function errorText(e: unknown): string {
  if (APICallError.isInstance(e)) {
    const status = e.statusCode
    if (status === 401 || status === 403) return `鉴权失败（${status}）：请检查 API Key 是否正确、是否有权限使用该模型。`
    if (status === 404) return `接口或模型不存在（404）：请检查 Base URL 和模型名。${short(e.responseBody)}`
    if (status === 429) return '请求太频繁或额度不足（429），请稍后再试或检查账户余额。'
    if (status) return `接口返回错误 ${status}：${short(e.responseBody) || e.message}`
  }
  const msg = e instanceof Error ? e.message : String(e)
  if (/Failed to fetch|NetworkError|Load failed|CORS/i.test(msg)) {
    return '无法连接接口：可能是 Base URL 写错、网络不通，或该服务不允许浏览器直接调用（跨域限制）。可以换一个支持浏览器访问的服务商或中转地址。'
  }
  return msg
}

function short(s?: string) {
  if (!s) return ''
  try {
    const j = JSON.parse(s)
    return String(j?.error?.message ?? j?.message ?? s).slice(0, 200)
  } catch {
    return s.slice(0, 200)
  }
}
