import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { askAt, db, isDue, PREDICTION_LABEL, resolvePrediction, snoozeAsk, type PredictionOutcome, type Strategy, type Topic } from '../db'
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
  const duePred = useLiveQuery(() => db.predictions.filter((p) => !p.outcome && p.dueAt !== undefined && p.dueAt <= Date.now()).sortBy('dueAt'), [])?.[0]
  if (hidden) return null
  if (duePred) {
    const t = duePred.topicId ? topics.get(duePred.topicId) : undefined
    return (
      <section className="checkin" aria-label="问一问">
        <div className="checkin-text">
          <span className="checkin-eyebrow">{t && <><span className="dot" style={{ background: t.color }} />{t.name} · </>}预测到期了</span>
          <p>「{duePred.statement}」（当时把握 {duePred.confidence}%），说中了吗？</p>
        </div>
        <div className="checkin-actions">
          {(Object.keys(PREDICTION_LABEL) as PredictionOutcome[]).map((k) => (
            <button key={k} className={`btn ${k === 'right' ? 'primary' : ''}`} onClick={async () => { await resolvePrediction(duePred.id, k, ''); markAsked(); setHidden(true) }}>{PREDICTION_LABEL[k]}</button>
          ))}
          <button className="btn ghost" onClick={async () => { await db.predictions.update(duePred.id, { dueAt: Date.now() + 3 * 86400000, updatedAt: Date.now() }); markAsked(); setHidden(true) }}>过几天再看</button>
        </div>
      </section>
    )
  }
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
