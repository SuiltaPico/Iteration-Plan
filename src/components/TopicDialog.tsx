import { useState } from 'react'
import { TOPIC_COLORS, createTopic, updateTopic, type Topic } from '../db'

interface Props {
  topic?: Topic
  onClose: (created?: Topic) => void
}

export default function TopicDialog({ topic, onClose }: Props) {
  const [name, setName] = useState(topic?.name ?? '')
  const [description, setDescription] = useState(topic?.description ?? '')
  const [color, setColor] = useState(topic?.color ?? TOPIC_COLORS[Math.floor(Math.random() * TOPIC_COLORS.length)])
  const [keepAt, setKeepAt] = useState(topic?.keepAt ?? 3)
  const [eliminateAt, setEliminateAt] = useState(topic?.eliminateAt ?? -3)

  const valid = name.trim() && keepAt > 0 && eliminateAt < 0

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    const data = { name: name.trim(), description: description.trim(), color, keepAt, eliminateAt }
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
        <div className="row2">
          <label className="field">
            <span>留存线（分数 ≥ 此值自动留存）</span>
            <input type="number" min={1} value={keepAt} onChange={(e) => setKeepAt(Number(e.target.value))} />
          </label>
          <label className="field">
            <span>淘汰线（分数 ≤ 此值自动淘汰）</span>
            <input type="number" max={-1} value={eliminateAt} onChange={(e) => setEliminateAt(Number(e.target.value))} />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={() => onClose()}>取消</button>
          <button type="submit" className="btn primary" disabled={!valid}>{topic ? '保存' : '创建'}</button>
        </div>
      </form>
    </div>
  )
}
