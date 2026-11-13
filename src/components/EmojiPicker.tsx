import { REVIEW_EMOJIS } from '../db'

/** 给复盘或记录挂一个 emoji（可不选，再点一次取消） */
export default function EmojiPicker({ value, onChange }: { value?: string; onChange: (v?: string) => void }) {
  return (
    <div className="emoji-row" role="radiogroup" aria-label="心情">
      {REVIEW_EMOJIS.map((e) => (
        <button key={e} type="button" role="radio" aria-checked={value === e} className={`emoji ${value === e ? 'on' : ''}`}
          onClick={() => onChange(value === e ? undefined : e)}>{e}</button>
      ))}
    </div>
  )
}

/** 情境标签：从已有标签里点选，或输入新的（回车添加） */
export function TagPicker({ value, options, onChange }: { value: string[]; options: string[]; onChange: (v: string[]) => void }) {
  const all = [...new Set([...options, ...value])]
  return (
    <div className="tag-row">
      {all.map((t) => (
        <button key={t} type="button" className={`chip ${value.includes(t) ? 'on' : ''}`}
          onClick={() => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t])}>{t}</button>
      ))}
      <input id="tag-input" className="tag-input" placeholder="＋ 新情境，回车添加"
        onKeyDown={(e) => {
          const v = e.currentTarget.value.trim()
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && v) {
            e.preventDefault()
            if (!value.includes(v)) onChange([...value, v])
            e.currentTarget.value = ''
          }
        }} />
    </div>
  )
}
