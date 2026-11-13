import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface MenuItem { label: string; onClick: () => void; danger?: boolean; hidden?: boolean }

/** 「⋯」更多操作菜单 */
export default function Menu({ items, label = '更多操作', trigger, triggerClass = 'btn ghost icon' }: { items: MenuItem[]; label?: ReactNode; trigger?: ReactNode; triggerClass?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <div className="menu" ref={ref}>
      <button className={triggerClass} aria-label={typeof label === 'string' ? label : '更多操作'} title={typeof label === 'string' ? label : undefined} aria-expanded={open} onClick={() => setOpen(!open)}>{trigger ?? '⋯'}</button>
      {open && (
        <div className="menu-pop" role="menu" aria-label={typeof label === 'string' ? label : undefined}>
          {items.filter((i) => !i.hidden).map((i) => (
            <button key={i.label} role="menuitem" className={i.danger ? 'danger' : ''} onClick={() => { setOpen(false); i.onClick() }}>{i.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}
