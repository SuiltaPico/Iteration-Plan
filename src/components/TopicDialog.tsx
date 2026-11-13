import { useState } from 'react'
import { DEFAULT_ASK_DAYS, TOPIC_COLORS, createTopic, updateTopic, type Topic } from '../db'

interface Props {
  topic?: Topic
  onClose: (created?: Topic) => void
}

export default function TopicDialog({ topic, onClose }: Props) {
  const [name, setName] = useState(topic?.name ?? '')
  const [description, setDescription] = useState(topic?.description ?? '')
  const [goal, setGoal] = useState(topic?.goal ?? '')
  const [color, setColor] = useState(topic?.color ?? TOPIC_COLORS[Math.floor(Math.random() * TOPIC_COLORS.length)])
  const [askTrial, setAskTrial] = useState(topic?.askDaysTrial ?? DEFAULT_ASK_DAYS.trial)
  const [askKept, setAskKept] = useState(topic?.askDaysKept ?? DEFAULT_ASK_DAYS.kept)

  const valid = name.trim() && askTrial >= 1 && askKept >= 1

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    const data = { name: name.trim(), description: description.trim(), goal: goal.trim(), color, askDaysTrial: askTrial, askDaysKept: askKept }
    if (topic) {
      await updateTopic(topic.id, data)
      onClose()
    } else {
      onClose(await createTopic(data))
    }
  }

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={save}>
        <h2>{topic ? '编辑主题' : '新建主题'}</h2>
        <label className="field">
          <span>名称</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：早起、阅读、投资、写作" />
        </label>
        <label className="field">
          <span>目标</span>
          <textarea id="topic-goal" rows={2} value={goal} onChange={(e) => setGoal(e.target.value)}
            placeholder="在这个主题上想达到什么？例如：两年内形成一套不靠盯盘、能长期跑赢指数的投资方法" />
          <small className="muted">判断一条策略「有效」的参照：复盘和 AI 都会对照它。可以随时改，旧目标会保留。</small>
        </label>
        <label className="field">
          <span>说明（可选）</span>
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="这个主题想解决什么问题？" />
        </label>
        <div className="field">
          <span>颜色</span>
          <div className="colors">
            {TOPIC_COLORS.map((c) => (
              <button type="button" key={c} className={`swatch ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
            ))}
          </div>
        </div>
        <div className="field">
          <span>多久问一次「你觉得它怎么样」</span>
          <div className="ask-row">
            <label>试用中每 <input id="ask-trial" type="number" min={1} value={askTrial} onChange={(e) => setAskTrial(Number(e.target.value))} /> 天</label>
            <label>已留存每 <input id="ask-kept" type="number" min={1} value={askKept} onChange={(e) => setAskKept(Number(e.target.value))} /> 天</label>
          </div>
          <small className="muted">按这个领域的反馈周期来定：习惯类可以一周，投资可能要一个月甚至更久。</small>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={() => onClose()}>取消</button>
          <button type="submit" className="btn primary" disabled={!valid}>{topic ? '保存' : '创建'}</button>
        </div>
      </form>
    </div>
  )
}
