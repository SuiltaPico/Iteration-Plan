import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  addPrediction, calibration, db, deletePrediction, PREDICTION_LABEL, resolvePrediction, type Prediction, type PredictionOutcome,
} from '../db'
import { fmtDate, fmtRelative } from '../util'
import { confirmDialog } from './Dialogs'
import { openAi } from '../bus'

/** 预测与校准：做决定前写下预期和把握，到期对照结果，看自己的「七成把握」到底有几成 */
export default function PredictionsPage() {
  const list = useLiveQuery(() => db.predictions.orderBy('createdAt').reverse().toArray(), []) ?? []
  const topics = useLiveQuery(() => db.topics.orderBy('order').toArray(), []) ?? []
  const tname = new Map(topics.map((t) => [t.id, t.name]))
  const open = list.filter((p) => !p.outcome).sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
  const done = list.filter((p) => p.outcome).sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0))
  const cal = calibration(done)

  return (
    <div className="page predictions-page">
      <header className="page-head">
        <div className="head-text">
          <h1>预测</h1>
          <p className="muted">做重要决定前写下你预期会怎样、有几成把握；到期后对照结果。时间长了就知道自己在哪些事上偏自信、哪些事上偏保守。</p>
        </div>
        {done.length >= 5 && (
          <div className="head-actions">
            <button className="btn" onClick={() => openAi.emit({ prompt: '分析我的预测记录和校准情况：哪些领域偏自信、哪些偏保守，有什么规律，值得的话写进「关于我」', send: true })}>✦ AI 分析我的判断</button>
          </div>
        )}
      </header>

      <NewPrediction topics={topics} />

      <section className="pred-section">
        <h3 className="sec-title">待验证</h3>
        {open.length ? open.map((p) => <OpenItem key={p.id} p={p} topic={p.topicId ? tname.get(p.topicId) : undefined} />)
          : <p className="muted sm">没有待验证的预测。</p>}
      </section>

      {done.length > 0 && (
        <section className="pred-section">
          <h3 className="sec-title">校准</h3>
          <div className="compare-wrap">
            <table className="compare calib">
              <thead><tr><th>当时的把握</th><th>次数</th><th>实际说中</th><th>判断</th></tr></thead>
              <tbody>
                {cal.map((b) => (
                  <tr key={b.lo} className={b.n ? '' : 'dim'}>
                    <td>{b.lo}–{b.hi}%</td>
                    <td>{b.n}</td>
                    <td>{b.rate === null ? '—' : `${Math.round(b.rate * 100)}%`}</td>
                    <td>{b.rate === null || b.n < 3 ? <span className="muted">样本太少</span>
                      : b.rate * 100 < b.lo - 5 ? <span className="neg">偏自信</span>
                      : b.rate * 100 > b.hi + 5 ? <span className="warn">偏保守</span>
                      : <span className="pos">基本准</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted sm">「部分说中」按一半计。每档至少 3 次才下判断。</p>
        </section>
      )}

      {done.length > 0 && (
        <section className="pred-section">
          <h3 className="sec-title">已验证</h3>
          {done.map((p) => (
            <div key={p.id} className="pred done">
              <div className="pred-main">
                <div className="pred-text">{p.statement}</div>
                <div className="muted sm">{p.topicId && tname.get(p.topicId) ? `${tname.get(p.topicId)} · ` : ''}把握 {p.confidence}% · {fmtDate(p.createdAt).slice(0, 10)} 写下</div>
                {p.resolvedNote && <div className="pred-note">{p.resolvedNote}</div>}
              </div>
              <span className={`pred-outcome o-${p.outcome}`}>{PREDICTION_LABEL[p.outcome!]}</span>
              <button className="icon-btn" title="删除" onClick={async () => { if (await confirmDialog('删除这条预测？', { ok: '删除' })) deletePrediction(p.id) }}>×</button>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

function NewPrediction({ topics }: { topics: { id: string; name: string }[] }) {
  const [statement, setStatement] = useState('')
  const [confidence, setConfidence] = useState(70)
  const [due, setDue] = useState('')
  const [topicId, setTopicId] = useState('')
  return (
    <form className="pred-new" onSubmit={async (e) => {
      e.preventDefault()
      if (!statement.trim()) return
      await addPrediction({ statement: statement.trim(), confidence, dueAt: due ? new Date(`${due}T23:59:00`).getTime() : undefined, topicId: topicId || undefined })
      setStatement(''); setDue('')
    }}>
      <textarea id="pred-statement" rows={2} value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="我预计……（具体到能判断对错，例如：这只股票三个月内不会跌破 20 元）" />
      <div className="pred-controls">
        <label className="pred-conf">把握 <input id="pred-conf" type="range" min={50} max={99} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} /><b>{confidence}%</b></label>
        <label className="pred-due">见分晓 <input id="pred-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <select className="select" value={topicId} onChange={(e) => setTopicId(e.target.value)} aria-label="主题">
          <option value="">不关联主题</option>
          {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button className="btn primary" disabled={!statement.trim()}>写下</button>
      </div>
    </form>
  )
}

function OpenItem({ p, topic }: { p: Prediction; topic?: string }) {
  const [resolving, setResolving] = useState<PredictionOutcome | null>(null)
  const [note, setNote] = useState('')
  const overdue = p.dueAt !== undefined && p.dueAt <= Date.now()
  return (
    <div className={`pred ${overdue ? 'due' : ''}`}>
      <div className="pred-main">
        <div className="pred-text">{p.statement}</div>
        <div className="muted sm">
          {topic ? `${topic} · ` : ''}把握 {p.confidence}% · {p.dueAt ? (overdue ? `已到期（${fmtDate(p.dueAt).slice(0, 10)}）` : `${fmtDate(p.dueAt).slice(0, 10)} 见分晓`) : `写于 ${fmtRelative(p.createdAt)}`}
        </div>
        {resolving && (
          <div className="pred-resolve">
            <input id={`pred-note-${p.id}`} autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="实际怎样了？（可选）" />
            <button className="btn sm primary" onClick={() => resolvePrediction(p.id, resolving, note.trim())}>确定：{PREDICTION_LABEL[resolving]}</button>
            <button className="btn sm ghost" onClick={() => setResolving(null)}>取消</button>
          </div>
        )}
      </div>
      {!resolving && (
        <div className="pred-actions">
          {(Object.keys(PREDICTION_LABEL) as PredictionOutcome[]).map((k) => (
            <button key={k} className={`chip o-${k}`} onClick={() => setResolving(k)}>{PREDICTION_LABEL[k]}</button>
          ))}
          <button className="icon-btn" title="删除" onClick={async () => { if (await confirmDialog('删除这条预测？', { ok: '删除' })) deletePrediction(p.id) }}>×</button>
        </div>
      )}
    </div>
  )
}

