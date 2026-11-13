import { CRITERIA_LABEL, LOG_RESULT_LABEL, OUTCOME_LABEL, outcomeOf, STATUS_LABEL, versionOf, type Backup, type Strategy } from '../db'
import { fmtDate } from '../util'

/** 文件名里不能用的字符换掉，保持可读 */
const safe = (s: string) => (s.trim() || '未命名').replace(/[\\/:*?"<>|#\n\r\t]/g, '-').replace(/\s+/g, ' ').slice(0, 80)

/** 把数据写成一组可读的 Markdown 文件：每个策略一篇，每个主题有打法和踩过的坑 */
export function toMarkdownFiles(d: Backup): Record<string, string> {
  const files: Record<string, string> = {}
  const problems = d.problems ?? []
  const used = new Set<string>()
  const unique = (path: string, id: string) => {
    let p = path
    if (used.has(p.toLowerCase())) p = path.replace(/\.md$/, ` (${id.slice(0, 6)}).md`)
    used.add(p.toLowerCase())
    return p
  }
  const index: string[] = ['# 迭代策略', '', '由「迭代策略」自动同步生成。数据以 `data.json` 为准，这些 Markdown 文件方便阅读和搜索，手动修改不会同步回应用。', '']

  const profile = d.meta?.find((m) => m.key === 'profile')?.value?.trim()
  if (profile) {
    files['关于我.md'] = `# 关于我\n\n${profile}\n`
    index.push('- [关于我](关于我.md)', '')
  }

  for (const t of [...d.topics].sort((a, b) => a.order - b.order)) {
    const dir = unique(safe(t.name), t.id)
    const mine = d.strategies.filter((s) => s.topicId === t.id && !s.isDraft)
    const tp = problems.filter((p) => p.topicId === t.id).sort((a, b) => a.order - b.order)
    const pname = (s: Strategy) => tp.find((p) => p.id === s.problemId)?.title ?? '未归类'
    index.push(`## ${t.name}`, '', `[打法](${encodeURI(`${dir}/打法.md`)}) · [踩过的坑](${encodeURI(`${dir}/踩过的坑.md`)})`, '')

    const groups = [...tp.map((p) => p.title), '未归类']
    for (const g of groups) {
      const list = mine.filter((s) => pname(s) === g).sort((a, b) => b.score - a.score)
      if (!list.length) continue
      index.push(`### ${g}`, '')
      for (const s of list) {
        const path = unique(`${dir}/${safe(g)}/${safe(s.title)}.md`, s.id)
        files[path] = strategyMd(s, d, g)
        index.push(`- [${s.title}](${encodeURI(path)}) — ${STATUS_LABEL[s.status]} ${s.score > 0 ? '+' : ''}${s.score}`)
      }
      index.push('')
    }

    const kept = mine.filter((s) => s.status === 'kept')
    files[`${dir}/打法.md`] = [`# ${t.name} · 打法`, '', kept.length ? '' : '还没有留存的策略。',
      ...groups.flatMap((g) => {
        const list = kept.filter((s) => pname(s) === g)
        return list.length ? [`## ${g}`, '', ...list.flatMap((s) => [`### ${s.title}`, '', ...(s.criteria?.trim() ? [`> 判断标准：${s.criteria.trim()}`, ''] : []), s.content.trim(), ''])] : []
      })].join('\n')

    const dead = mine.filter((s) => s.status === 'eliminated').sort((a, b) => b.statusChangedAt - a.statusChangedAt)
    files[`${dir}/踩过的坑.md`] = [`# ${t.name} · 踩过的坑`, '', dead.length ? '' : '还没有淘汰过策略。',
      ...dead.flatMap((s) => [`## ${s.title}`, '', `${pname(s)} · 淘汰于 ${fmtDate(s.statusChangedAt).slice(0, 10)}`, '', s.lesson?.trim() || '（没写原因）', ''])].join('\n')
  }
  files['README.md'] = index.join('\n')
  return files
}

function strategyMd(s: Strategy, d: Backup, problem: string) {
  const reviews = d.reviews.filter((r) => r.strategyId === s.id).sort((a, b) => a.createdAt - b.createdAt)
  const logs = (d.logs ?? []).filter((l) => l.strategyId === s.id).sort((a, b) => a.createdAt - b.createdAt)
  const parent = s.parentId ? d.strategies.find((x) => x.id === s.parentId) : undefined
  const fm = [
    '---', `id: ${s.id}`, `问题: ${problem}`, `状态: ${STATUS_LABEL[s.status]}`, `分数: ${s.score}`, `版本: ${versionOf(s)}`,
    `创建: ${fmtDate(s.createdAt).slice(0, 10)}`, ...(parent ? [`改自: ${parent.title}`] : []), '---', '',
  ]
  const body = [
    `# ${s.title}`, '',
    ...(s.criteria?.trim() ? [`> 判断标准：${s.criteria.trim()}`, ''] : []),
    s.content.trim(), '',
    ...(s.status === 'eliminated' && s.lesson?.trim() ? ['## 淘汰原因', '', s.lesson.trim(), ''] : []),
    ...(logs.length ? ['## 使用记录', '', ...logs.map((l) => `- ${fmtDate(l.createdAt)}${l.result ? ` 【${LOG_RESULT_LABEL[l.result]}】` : ''} ${l.note}`), ''] : []),
    ...(reviews.length ? ['## 复盘记录', '', ...reviews.map((r) => {
      if (r.event) return `- ${fmtDate(r.createdAt)} —— 开始第 ${r.version} 版 ——`
      const head = r.statusChange ? `${STATUS_LABEL[r.statusChange.from]} → ${STATUS_LABEL[r.statusChange.to]}` : OUTCOME_LABEL[outcomeOf(r)]
      return `- ${fmtDate(r.createdAt)} v${r.version ?? 1} 【${head}】${r.criteriaMet ? `（标准${CRITERIA_LABEL[r.criteriaMet]}）` : ''} ${r.note}`.trimEnd()
    }), ''] : []),
  ]
  return [...fm, ...body].join('\n')
}
