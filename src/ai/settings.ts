export type Protocol = 'openai' | 'anthropic'

export interface AiSettings {
  protocol: Protocol
  baseURL: string
  apiKey: string
  model: string
}

export const PRESETS: { label: string; s: Omit<AiSettings, 'apiKey'> }[] = [
  { label: 'Anthropic', s: { protocol: 'anthropic', baseURL: 'https://api.anthropic.com/v1', model: 'claude-opus-5-5' } },
  { label: 'OpenAI', s: { protocol: 'openai', baseURL: 'https://api.openai.com/v1', model: '' } },
  { label: 'DeepSeek', s: { protocol: 'openai', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat' } },
  { label: 'OpenRouter', s: { protocol: 'openai', baseURL: 'https://openrouter.ai/api/v1', model: '' } },
]

const KEY = 'iteration-plan.ai'
const EMPTY: AiSettings = { protocol: 'openai', baseURL: '', apiKey: '', model: '' }

export function loadSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY
  } catch {
    return EMPTY
  }
}

export function saveSettings(s: AiSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* 存储不可用时只在本次会话生效 */ }
  listeners.forEach((f) => f(s))
}

const listeners = new Set<(s: AiSettings) => void>()
export function onSettings(fn: (s: AiSettings) => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export const isConfigured = (s: AiSettings) => !!(s.baseURL && s.apiKey && s.model)
