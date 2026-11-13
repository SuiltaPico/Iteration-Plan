import { useState } from 'react'
import { Link } from 'react-router-dom'
import { askAt, isDue, snoozeAsk, type Strategy, type Topic } from '../db'
import { daysSince } from '../util'

const KEY = 'iteration-plan.checkin-day'
const today = () => new Date().toDateString()
function askedToday() {
  try { return localStorage.getItem(KEY) === today() } catch { return false }
}
export function markAsked() {
  try { localStorage.setItem(KEY, today()) } catch { /* 存储不可用时每次打开都可能再问 */ }
}

/** 「问一问」：每天最多主动问一个策略，挑最久没聊过的那个 */
export default function CheckIn({ strategies, topics, last }: { strategies: Strategy[]; topics: Map<string, Topic>; last: Map<string, number> }) {
  const [hidden, setHidden] = useState(askedToday)
  if (hidden) return null
  const s = strategies
    .filter((x) => isDue(x, last.get(x.id), topics.get(x.topicId)))
    .sort((a, b) => askAt(a, last.get(a.id), topics.get(a.topicId)) - askAt(b, last.get(b.id), topics.get(b.topicId)))[0]
  if (!s) return null
  const t = topics.get(s.topicId)
  const since = last.get(s.id)
  const lead = since
    ? `距离上次聊「${s.title}」已经 ${daysSince(since)} 天了`
    : `「${s.title}」已经用了 ${daysSince(s.createdAt)} 天`

  return (
    <section className="checkin" aria-label="问一问">
      <div className="checkin-text">
        <span className="checkin-eyebrow">{t && <><span className="dot" style={{ background: t.color }} />{t.name} · </>}问一问</span>
        <p>{lead}，你觉得它怎么样？</p>
      </div>
      <div className="checkin-actions">
        <button className="btn ghost" onClick={async () => { await snoozeAsk(s.id); markAsked(); setHidden(true) }}>过几天再问</button>
        <Link className="btn primary" to={`/review?s=${s.id}&from=checkin`} onClick={markAsked}>说说看</Link>
      </div>
    </section>
  )
}
