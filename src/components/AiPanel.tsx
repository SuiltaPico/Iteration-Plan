import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import type { ModelMessage } from 'ai'
import { db, OUTCOME_LABEL, STATUS_LABEL, type Outcome, type Status } from '../db'
import { flushEditors, openAi } from '../bus'
import { isConfigured, loadSettings, onSettings } from '../ai/settings'
import { errorText, runAgent, type PageContext } from '../ai/agent'
import AiSettingsDialog from './AiSettingsDialog'
import MiniMarkdown from './MiniMarkdown'

type ToolPart = { type: 'tool'; id: string; name: string; input: any; output?: any; error?: string }
type Part = { type: 'text'; text: string } | ToolPart
type Item =
  | { role: 'user'; text: string }
  | { role: 'assistant'; parts: Part[] }
  | { role: 'error'; text: string }

function usePageContext(): PageContext {
  const { pathname } = useLocation()
  const m = pathname.match(/^\/(topic|strategy)\/([^/]+)/)
  if (!m) return {}
  return m[1] === 'topic' ? { topicId: m[2] } : { strategyId: m[2] }
}

function suggestions(ctx: PageContext) {
  if (ctx.strategyId) return ['帮我完善这个策略的正文，补充具体做法和判断有效的标准', '把这个策略改写得更具体、更容易执行', '根据复盘记录，这个策略该怎么调整？']
  if (ctx.topicId) return ['帮我梳理这个主题里值得解决的问题，并各给 2 个候选策略', '分析当前主题的策略、复盘和踩过的坑，给我改进建议', '哪些策略一直没怎么执行？帮我简化']
  return ['我想在投资上找到适合自己的卖出方法，帮我建主题、问题和候选策略', '看看我所有的策略，给我复盘建议', '哪些策略试用很久了还没复盘？']
}

export default function AiPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ctx = usePageContext()
  const [settings, setSettings] = useState(loadSettings)
  const [editing, setEditing] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const history = useRef<ModelMessage[]>([])
  const abort = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  const sendRef = useRef<(t: string) => void>(() => {})

  useEffect(() => onSettings(setSettings), [])
  useEffect(() => openAi.attach(({ prompt, send }) => {
    if (prompt && send) setTimeout(() => sendRef.current(prompt), 0)
    else if (prompt !== undefined) { setInput(prompt); setTimeout(() => inputRef.current?.focus(), 50) }
  }), [])
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items])

  const update = (fn: (parts: Part[]) => Part[]) =>
    setItems((prev) => {
      const last = prev[prev.length - 1]
      if (last?.role !== 'assistant') return prev
      return [...prev.slice(0, -1), { role: 'assistant', parts: fn(last.parts) }]
    })

  async function send(text: string) {
    text = text.trim()
    if (!text || busy) return
    if (!isConfigured(settings)) { setEditing(true); setInput(text); return }
    flushEditors.emit()
    setInput('')
    setBusy(true)
    setItems((p) => [...p, { role: 'user', text }, { role: 'assistant', parts: [] }])
    const userMsg: ModelMessage = { role: 'user', content: text }
    const ac = new AbortController()
    abort.current = ac
    try {
      const newMessages = await runAgent({
        settings, history: [...history.current, userMsg], context: ctxRef.current, signal: ac.signal,
        onEvent: (e) => {
          if (e.type === 'text') {
            update((parts) => {
              const last = parts[parts.length - 1]
              return last?.type === 'text' ? [...parts.slice(0, -1), { type: 'text', text: last.text + e.text }] : [...parts, { type: 'text', text: e.text }]
            })
          } else if (e.type === 'tool-call') {
            update((parts) => [...parts, { type: 'tool', id: e.id, name: e.name, input: e.input }])
          } else {
            update((parts) => parts.map((p) => p.type === 'tool' && p.id === e.id
              ? { ...p, ...(e.type === 'tool-result' ? { output: e.output } : { error: e.error }) } : p))
          }
        },
      })
      history.current = [...history.current, userMsg, ...newMessages]
    } catch (e) {
      if (!ac.signal.aborted) setItems((p) => [...p, { role: 'error', text: errorText(e) }])
    } finally {
      setItems((p) => {
        const last = p[p.length - 1]
        return last?.role === 'assistant' && last.parts.length === 0 ? p.slice(0, -1) : p
      })
      setBusy(false)
      abort.current = null
    }
  }
  sendRef.current = send

  function reset() {
    abort.current?.abort()
    history.current = []
    setItems([])
  }

  const configured = isConfigured(settings)

  return (
    <aside className={`ai-panel ${open ? 'open' : ''}`} aria-hidden={!open}>
      <header className="ai-head">
        <span className="ai-title">✦ AI 助手</span>
        <span className="muted sm ai-model" title={settings.model}>{configured ? settings.model : '未配置'}</span>
        <button className="icon-btn" title="新对话" onClick={reset} disabled={busy && false}>⟲</button>
        <button className="icon-btn" title="AI 设置" onClick={() => setEditing(true)}>⚙</button>
        <button className="icon-btn" title="关闭" onClick={onClose}>✕</button>
      </header>

      <div className="ai-list" ref={listRef}>
        {!configured && (
          <div className="ai-setup">
            <p>填入 API Key、Base URL 和模型名，就可以让 AI 帮你建主题、写策略、做复盘分析。</p>
            <button className="btn primary" onClick={() => setEditing(true)}>配置模型</button>
          </div>
        )}
        {configured && items.length === 0 && (
          <div className="ai-empty">
            <p className="muted sm">试试这样问：</p>
            {suggestions(ctx).map((s) => (
              <button key={s} className="ai-suggest" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}
        {items.map((it, i) =>
          it.role === 'user' ? <div key={i} className="bubble user">{it.text}</div>
          : it.role === 'error' ? <div key={i} className="bubble error">{it.text}</div>
          : (
            <div key={i} className="bubble assistant">
              {it.parts.map((p, j) => p.type === 'text'
                ? <MiniMarkdown key={j} text={p.text} />
                : <ToolChip key={j} p={p} />)}
              {busy && i === items.length - 1 && <span className="typing"><i /><i /><i /></span>}
            </div>
          ))}
      </div>

      <form className="ai-input" onSubmit={(e) => { e.preventDefault(); send(input) }}>
        <textarea id="ai-input" ref={inputRef} rows={2} value={input} placeholder="让 AI 帮你建主题、写策略、做复盘…（Enter 发送）"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input) } }} />
        {busy
          ? <button type="button" className="btn" onClick={() => abort.current?.abort()}>停止</button>
          : <button type="submit" className="btn primary" disabled={!input.trim()}>发送</button>}
      </form>
      {editing && <AiSettingsDialog initial={settings} onClose={() => setEditing(false)} />}
    </aside>
  )
}

function ToolChip({ p }: { p: ToolPart }) {
  const sid: string | undefined = p.name.includes('strategy') || p.name === 'add_review' || p.name === 'set_status' || p.name === 'add_log' ? (p.output?.id ?? p.input?.id) : undefined
  const live = useLiveQuery(() => (sid ? db.strategies.get(sid) : undefined), [sid])
  const title = p.input?.title ?? live?.title ?? p.output?.title ?? ''
  const pending = p.output === undefined && !p.error
  let label: React.ReactNode
  switch (p.name) {
    case 'list_topics': label = '查看主题列表'; break
    case 'list_strategies': label = '查看策略列表'; break
    case 'list_problems': label = '查看问题列表'; break
    case 'list_lessons': label = '查看踩过的坑'; break
    case 'get_profile': label = '读取「关于我」'; break
    case 'web_search': label = <>搜索「{p.input?.query}」{Array.isArray(p.output?.results) && <span className="muted"> · {p.output.results.length} 条结果</span>}</>; break
    case 'web_fetch': {
      let host = String(p.input?.url ?? '')
      try { host = new URL(host).hostname } catch { /* 原样显示 */ }
      label = <>读取网页 <a href={p.input?.url} target="_blank" rel="noreferrer">{p.output?.title || host}</a></>
      break
    }
    case 'update_profile': label = <>更新 <Link to="/me">「关于我」</Link></>; break
    case 'add_log': label = <>记一笔「{title}」</>; break
    case 'create_problem': label = <>新建问题「{p.input?.title}」</>; break
    case 'update_problem': label = '修改问题'; break
    case 'get_strategy': label = <>读取策略{title && <>「{title}」</>}</>; break
    case 'create_topic': label = p.output?.id ? <>创建主题 <Link to={`/topic/${p.output.id}`}>「{p.input.name}」</Link></> : <>创建主题「{p.input?.name}」</>; break
    case 'update_topic': label = '修改主题'; break
    case 'create_strategy': label = p.output?.id ? <>创建策略 <Link to={`/strategy/${p.output.id}`}>「{title}」</Link></> : <>创建策略「{title}」</>; break
    case 'update_strategy': label = <>更新策略 {sid ? <Link to={`/strategy/${sid}`}>「{title}」</Link> : null}</>; break
    case 'add_review': label = <>复盘「{title}」：{OUTCOME_LABEL[p.input?.outcome as Outcome] ?? ''}</>; break
    case 'set_status': label = <>「{title}」改为{STATUS_LABEL[p.input?.status as Status] ?? ''}</>; break
    case 'delete_strategy': label = <>删除策略「{p.output?.title ?? ''}」</>; break
    default: label = p.name
  }
  return (
    <div className={`tool-chip ${p.error ? 'err' : pending ? 'pending' : 'done'}`} title={p.error}>
      <span className="tool-icon">{p.error ? '!' : pending ? '…' : '✓'}</span>
      <span>{label}{p.error && <span className="muted"> 失败：{p.error}</span>}</span>
    </div>
  )
}
