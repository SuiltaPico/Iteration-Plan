import { EMOJIS } from '../db'

/** 挂一个 emoji（可不选，再点一次取消） */
export default function EmojiPicker({ value, onChange }: { value?: string; onChange: (v?: string) => void }) {
  return (
    <div className="emoji-row" role="radiogroup" aria-label="心情">
      {EMOJIS.map((e) => (
        <button key={e} type="button" role="radio" aria-checked={value === e} className={`emoji ${value === e ? 'on' : ''}`}
          onClick={() => onChange(value === e ? undefined : e)}>{e}</button>
      ))}
    </div>
  )
}
