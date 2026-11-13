/** 极简事件总线：AI 改了策略正文后通知编辑器刷新；AI 运行前让编辑器先落盘 */
type Fn<T> = (v: T) => void

function channel<T>() {
  const subs = new Set<Fn<T>>()
  return {
    on(fn: Fn<T>) { subs.add(fn); return () => { subs.delete(fn) } },
    emit(v: T) { subs.forEach((f) => f(v)) },
  }
}

export const contentChanged = channel<string>()
export const flushEditors = channel<void>()

/** 打开 AI 面板；prompt 预填输入框，send=true 时直接发送 */
export const openAi = (() => {
  const ch = channel<{ prompt?: string; send?: boolean }>()
  let queued: { prompt?: string; send?: boolean } | null = null
  let ready = false
  return {
    /** AI 面板挂载时调用：接收面板尚未加载时发出的请求 */
    attach(fn: (v: { prompt?: string; send?: boolean }) => void) {
      const off = ch.on(fn)
      ready = true
      if (queued) { const q = queued; queued = null; fn(q) }
      return () => { off(); ready = false }
    },
    on: ch.on,
    emit(v: { prompt?: string; send?: boolean }) {
      if (!ready && v.prompt) queued = v
      ch.emit(v)
    },
  }
})()
