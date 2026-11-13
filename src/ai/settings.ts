export type Protocol = 'openai' | 'anthropic'

export interface AiSettings {
  protocol: Protocol
  baseURL: string
  apiKey: string
  model: string
  /** 联网：让 AI 用 DeepSeek 的 Search / Fetch API 搜索和读取网页 */
  webTools?: boolean
  /** DeepSeek API Key；留空且主接口是 DeepSeek 时沿用主 Key */
  webKey?: string
  /** 测试用：覆盖 DeepSeek 接口地址 */
  webBase?: string
}

export const isDeepSeek = (s: AiSettings) => /deepseek\.com/i.test(s.baseURL)
/** 联网工具实际使用的 key */
export const webKeyOf = (s: AiSettings) => (s.webKey?.trim() || (isDeepSeek(s) ? s.apiKey.trim() : ''))

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
