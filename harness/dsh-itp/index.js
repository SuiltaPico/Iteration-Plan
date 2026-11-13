// 策略迭代插件（最小机制）
//   注入：每轮把策略和它们的账交给模型
//   工具：itp_record 记这局用没用某条策略；itp_propose 提新策略；itp_decide 拍板
//   成绩：goal 结束时运行评分命令拿客观分数（模型改不了）；账面 = 用它的局平均分 vs 没用它的局平均分
// 系统只记账、摆证据，不替任何人做决定。数据就是一个 JSON 文件。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'itp'
export const inject = ['systemPrompt', 'tools']

const MIN_EVIDENCE = 3
const load = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { strategies: [], logs: [] })
const save = (f, d) => writeFileSync(f, JSON.stringify(d, null, 2))
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const fmt = (x) => (x === null ? '—' : x.toFixed(1))

/** 每局分数（同一局取最后一次），以及某条策略用过/没用过的局 */
export function ledger(d, id) {
  const score = new Map()
  for (const l of d.logs) if (l.type === 'score' && typeof l.score === 'number') score.set(String(l.episode), l.score)
  const used = new Set(d.logs.filter((l) => l.type === 'record' && l.strategy === id && l.outcome === 'used').map((l) => String(l.episode)))
  const u = [...score].filter(([e]) => used.has(e)).map(([, s]) => s)
  const n = [...score].filter(([e]) => !used.has(e)).map(([, s]) => s)
  return { uses: u.length, usedAvg: avg(u), otherAvg: avg(n), others: n.length }
}
const describe = (d, s) => {
  const t = ledger(d, s.id)
  const diff = t.usedAvg !== null && t.otherAvg !== null ? `，差 ${t.usedAvg - t.otherAvg >= 0 ? '+' : ''}${(t.usedAvg - t.otherAvg).toFixed(1)}` : ''
  return `用过 ${t.uses} 局 平均 ${fmt(t.usedAvg)} 分；没用的 ${t.others} 局 平均 ${fmt(t.otherAvg)} 分${diff}`
}
const text = (t) => [{ type: 'text', text: t }]
const okOut = { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, message: { type: 'string', required: true } } }, render: (_a, v) => text(v.message) }

export function apply(ctx, config = {}) {
  const file = config.file ?? process.env.ITP_FILE
  if (!file) return
  const episode = () => process.env.ITP_EPISODE ?? 'unknown'
  const scoreCommand = config.scoreCommand ?? process.env.ITP_SCORE_CMD

  ctx.systemPrompt.context({
    name: 'itp-strategies', order: 900, interpolate: false,
    text: () => {
      const d = load(file)
      const live = d.strategies.filter((s) => s.status !== 'eliminated')
      const dead = d.strategies.filter((s) => s.status === 'eliminated')
      const scored = d.logs.filter((l) => l.type === 'score').length
      return ['<itp-strategies>',
        `跨任务积累的做事策略（kept=已留存，trial=试用中）。每局结束后有一个客观分数（模型无法影响），目前已有 ${scored} 局有分数。`,
        '每条策略后面是账：用了它的局平均几分，没用它的局平均几分。',
        ...live.map((s) => `- [${s.id}|${s.status}] ${s.title}\n    账：${describe(d, s)}`),
        dead.length ? '已淘汰（不要再用，教训供参考）：' : '',
        ...dead.map((s) => `- [${s.id}] ${s.title} —— 教训：${s.lesson ?? ''}`),
        '',
        '规矩：',
        '1. 合适的策略就照做；不适合当前情况的可以不用。',
        '2. 任务结束前（标记 goal 完成或受阻之前），对每条活着的策略调用一次 itp_record：这局是否真的按它做了（used/unused），一句话写具体怎么用的。好坏由客观分数判断，你只需如实说用没用。',
        '3. 这局学到可复用、具体、可执行、和现有策略不重复的做法，用 itp_propose 提成试用策略，并写清楚它适用的条件。',
        `4. 拍板（itp_decide）要看账：至少用过 ${MIN_EVIDENCE} 局、且用它的平均分明显高于不用它，才考虑 keep；明显更低就退回 trial 或淘汰。已留存的策略账面变差也要处理。证据不足就不要拍板。`,
        '</itp-strategies>'].filter((x) => x !== '').join('\n')
    },
  })

  ctx.tools.register(defineTool({
    name: 'itp_record',
    description: '记录这局任务里是否真的按某条策略做了（used / unused）。好坏由客观分数自动判断。',
    parameters: {
      strategy_id: { type: 'string', required: true, description: '策略 id，如 s2' },
      outcome: { type: 'string', required: true, enum: ['used', 'unused'], description: 'used | unused' },
      note: { type: 'string', required: true, description: '一句话：具体怎么用的，或为什么没用' },
    },
    output: okOut,
    async execute(a) {
      const d = load(file)
      const s = d.strategies.find((x) => x.id === a.strategy_id)
      if (!s) return { ok: false, message: `没有策略 ${a.strategy_id}` }
      d.logs = d.logs.filter((l) => !(l.type === 'record' && l.strategy === s.id && String(l.episode) === episode()))
      d.logs.push({ type: 'record', at: Date.now(), episode: episode(), strategy: s.id, outcome: a.outcome, note: a.note })
      save(file, d)
      return { ok: true, message: `已记录：${s.id} 本局 ${a.outcome}` }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'itp_propose',
    description: '提出一条新的试用策略（具体、可执行、写清适用条件、可复用到以后的任务）。',
    parameters: {
      title: { type: 'string', required: true, description: '策略本身，一句话，包含适用条件' },
      why: { type: 'string', required: true, description: '这局发生了什么让你想到它' },
    },
    output: okOut,
    async execute(a) {
      const d = load(file)
      const id = 's' + (d.strategies.reduce((m, s) => Math.max(m, +s.id.slice(1) || 0), 0) + 1)
      d.strategies.push({ id, title: a.title, status: 'trial', by: 'ai', why: a.why, createdAt: Date.now(), episode: episode() })
      d.logs.push({ type: 'propose', at: Date.now(), episode: episode(), strategy: id, note: a.why })
      save(file, d)
      return { ok: true, message: `已加入试用：${id} ${a.title}` }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'itp_decide',
    description: '根据账面拍板：keep（留存）、trial（退回试用）、eliminate（淘汰，必须写教训）。',
    parameters: {
      strategy_id: { type: 'string', required: true, description: '策略 id' },
      decision: { type: 'string', required: true, enum: ['keep', 'trial', 'eliminate'], description: 'keep | trial | eliminate' },
      reason: { type: 'string', required: true, description: '依据（引用账面数字）；淘汰时写成以后可借鉴的教训' },
    },
    output: okOut,
    async execute(a) {
      const d = load(file)
      const s = d.strategies.find((x) => x.id === a.strategy_id)
      if (!s) return { ok: false, message: `没有策略 ${a.strategy_id}` }
      const t = ledger(d, s.id)
      s.status = { keep: 'kept', trial: 'trial', eliminate: 'eliminated' }[a.decision]
      if (a.decision === 'eliminate') s.lesson = a.reason
      d.logs.push({ type: 'decide', at: Date.now(), episode: episode(), strategy: s.id, decision: a.decision, evidence: t, note: 'AI 判断：' + a.reason })
      save(file, d)
      const warn = t.uses < MIN_EVIDENCE ? `（提醒：它只有 ${t.uses} 局有分数的使用记录，证据偏少）` : ''
      return { ok: true, message: `${s.id} → ${s.status}。账：${describe(d, s)}${warn}` }
    },
  }))

  ctx.on('goal/changed', ({ change }) => {
    const g = change.goal
    if (!g || !['complete', 'block'].includes(change.operation)) return
    const d = load(file)
    d.logs.push({ type: 'goal', at: Date.now(), episode: episode(), goal: g.objective, result: g.phase, rounds: g.roundsStarted,
      strategies: d.strategies.filter((s) => s.status !== 'eliminated').map((s) => s.id) })
    if (scoreCommand) {
      try {
        const r = JSON.parse(execSync(scoreCommand, { encoding: 'utf8', timeout: 10000 }))
        if (typeof r.score === 'number') d.logs.push({ type: 'score', at: Date.now(), episode: episode(), score: r.score, source: 'scoreCommand', detail: r.detail })
      } catch { /* 拿不到分数就不记，外部评测可以事后补 */ }
    }
    save(file, d)
  })
}
