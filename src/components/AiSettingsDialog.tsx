import { useState } from 'react'
import { isDeepSeek, PRESETS, saveSettings, webKeyOf, type AiSettings } from '../ai/settings'
import { webSearch } from '../ai/web'
import { errorText, testConnection } from '../ai/agent'

export default function AiSettingsDialog({ initial, onClose }: { initial: AiSettings; onClose: () => void }) {
  const [s, setS] = useState(initial)
  const [showKey, setShowKey] = useState(false)
  const [test, setTest] = useState<{ state: 'idle' | 'busy' | 'ok' | 'fail'; msg?: string }>({ state: 'idle' })
  const [webTest, setWebTest] = useState<{ state: 'idle' | 'busy' | 'ok' | 'fail'; msg?: string }>({ state: 'idle' })
  const set = (patch: Partial<AiSettings>) => { setS({ ...s, ...patch }); setTest({ state: 'idle' }) }
  const valid = s.baseURL.trim() && s.apiKey.trim() && s.model.trim()

  async function runTest() {
    setTest({ state: 'busy' })
    try {
      const text = await testConnection(s)
      setTest({ state: 'ok', msg: `连接成功，模型回复：${text.slice(0, 40)}` })
    } catch (e) {
      setTest({ state: 'fail', msg: errorText(e) })
    }
  }

  async function runWebTest() {
    setWebTest({ state: 'busy' })
    try {
      const r = await webSearch(s, 'DeepSeek', 1)
      setWebTest({ state: 'ok', msg: r.results.length ? `联网可用，搜到：${r.results[0].title.slice(0, 40)}` : '联网可用（这次没有搜索结果）' })
    } catch (e) {
      setWebTest({ state: 'fail', msg: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal wide" onSubmit={(e) => { e.preventDefault(); if (valid) { saveSettings(s); onClose() } }}>
        <h2>AI 设置</h2>
        <div className="field">
          <span>快速填入</span>
          <div className="row-btns">
            {PRESETS.map((p) => (
              <button type="button" key={p.label} className="btn sm" onClick={() => set({ ...p.s, model: p.s.model || s.model })}>{p.label}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>接口协议</span>
          <div className="seg">
            <button type="button" className={s.protocol === 'openai' ? 'on' : ''} onClick={() => set({ protocol: 'openai' })}>OpenAI 兼容</button>
            <button type="button" className={s.protocol === 'anthropic' ? 'on' : ''} onClick={() => set({ protocol: 'anthropic' })}>Anthropic</button>
          </div>
        </div>
        <label className="field">
          <span>Base URL</span>
          <input id="ai-base" value={s.baseURL} onChange={(e) => set({ baseURL: e.target.value })}
            placeholder={s.protocol === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1'} />
        </label>
        <label className="field">
          <span>API Key</span>
          <div className="input-row">
            <input id="ai-key" type={showKey ? 'text' : 'password'} value={s.apiKey} onChange={(e) => set({ apiKey: e.target.value })} placeholder="sk-…" autoComplete="off" />
            <button type="button" className="btn sm ghost" onClick={() => setShowKey(!showKey)}>{showKey ? '隐藏' : '显示'}</button>
          </div>
        </label>
        <label className="field">
          <span>模型</span>
          <input id="ai-model" value={s.model} onChange={(e) => set({ model: e.target.value })} placeholder="模型名，例如 claude-opus-5-5 / deepseek-chat" />
        </label>
        <p className="muted sm">API Key 只保存在当前浏览器的本地存储里，请求由浏览器直接发给你填的地址，不经过任何其他服务器。模型需要支持工具调用（function calling）。</p>
        <div className="web-box">
          <label className="switch-row">
            <input id="ai-web" type="checkbox" checked={!!s.webTools} onChange={(e) => { setS({ ...s, webTools: e.target.checked }); setWebTest({ state: 'idle' }) }} />
            <span><b>联网</b>：让 AI 用 DeepSeek 的搜索和网页读取</span>
          </label>
          {s.webTools && (
            <>
              <div className="input-row">
                <input id="ai-web-key" type="password" value={s.webKey ?? ''} onChange={(e) => { setS({ ...s, webKey: e.target.value }); setWebTest({ state: 'idle' }) }}
                  placeholder={isDeepSeek(s) ? '留空则沿用上面的 DeepSeek Key' : 'DeepSeek API Key（sk-…）'} autoComplete="off" />
                <button type="button" className="btn sm" disabled={!webKeyOf(s) || webTest.state === 'busy'} onClick={runWebTest}>测试联网</button>
              </div>
              <small className="muted">主模型用什么都可以（Claude、DeepSeek…），搜索和读取网页走 DeepSeek 的 Search / Fetch API，按次计费。</small>
              {webTest.state !== 'idle' && <div className={`test-msg ${webTest.state}`}>{webTest.state === 'busy' ? '正在测试…' : webTest.msg}</div>}
            </>
          )}
        </div>
        {test.state !== 'idle' && (
          <div className={`test-msg ${test.state}`}>{test.state === 'busy' ? '正在测试…' : test.msg}</div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn ghost" disabled={!valid || test.state === 'busy'} onClick={runTest}>测试连接</button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn ghost" onClick={onClose}>取消</button>
          <button type="submit" className="btn primary" disabled={!valid}>保存</button>
        </div>
      </form>
    </div>
  )
}
