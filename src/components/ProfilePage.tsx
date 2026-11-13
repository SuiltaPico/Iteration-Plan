import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { db, setProfile } from '../db'
import { contentChanged, flushEditors, openAi } from '../bus'
import { fmtRelative } from '../util'

const Editor = lazy(() => import('./Editor'))

const DISTILL = '根据我所有主题的踩过的坑、「没怎么执行」的复盘、使用记录和留存下来的策略，提炼关于我的规律，更新「关于我」。保留我自己写的内容。'

/** 关于我：跨主题提炼出的个人规律。自己可以写，AI 也可以提炼；AI 出主意前会读它 */
export default function ProfilePage() {
  const [seed, setSeed] = useState<{ value: string; rev: number } | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const pending = useRef<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const load = async () => {
    const m = await db.meta.get('profile')
    setUpdatedAt(m?.updatedAt ?? null)
    setSeed((p) => ({ value: m?.value ?? '', rev: (p?.rev ?? 0) + 1 }))
  }

  const flush = async () => {
    clearTimeout(timer.current)
    if (pending.current === null) return
    const v = pending.current
    pending.current = null
    await setProfile(v)
    setUpdatedAt(Date.now())
  }

  useEffect(() => { load() }, [])
  useEffect(() => () => { flush() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => flushEditors.on(() => { flush() }), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => contentChanged.on((id) => { if (id === 'profile') { pending.current = null; load() } }), [])

  return (
    <div className="page profile-page">
      <header className="page-head">
        <div className="head-text">
          <h1>关于我</h1>
          <p className="muted">跨主题看出来的个人规律：什么样的做法适合我、什么样的我坚持不了。AI 出主意前都会先读这一页。</p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={async () => { await flush(); openAi.emit({ prompt: DISTILL, send: true }) }}>✦ 让 AI 提炼</button>
        </div>
      </header>
      <article className="doc profile-doc">
        {seed && (
          <Suspense fallback={null}>
            <Editor key={seed.rev} value={seed.value} onChange={(md) => {
              pending.current = md
              clearTimeout(timer.current)
              timer.current = window.setTimeout(flush, 600)
            }} />
          </Suspense>
        )}
      </article>
      <p className="muted sm profile-foot">{updatedAt ? `更新于 ${fmtRelative(updatedAt)} · 自动保存` : '还没有内容。可以自己写几条，也可以等攒了一些复盘和教训后让 AI 提炼。'}</p>
    </div>
  )
}

