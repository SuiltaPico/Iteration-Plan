import { useEffect, useState } from 'react'

/** 页内确认框与提示条（不依赖 window.confirm / alert，嵌入环境里也能用） */
type ConfirmReq = { message: string; ok: string; danger: boolean; resolve: (v: boolean) => void }
let pushConfirm: ((r: ConfirmReq) => void) | null = null
let pushToast: ((m: string) => void) | null = null

export function confirmDialog(message: string, opts: { ok?: string; danger?: boolean } = {}) {
  return new Promise<boolean>((resolve) => {
    if (!pushConfirm) return resolve(false)
    pushConfirm({ message, ok: opts.ok ?? '确定', danger: opts.danger ?? true, resolve })
  })
}

export function toast(message: string) {
  pushToast?.(message)
}

export function DialogHost() {
  const [req, setReq] = useState<ConfirmReq | null>(null)
  const [msg, setMsg] = useState<{ text: string; id: number } | null>(null)

  useEffect(() => {
    pushConfirm = setReq
    pushToast = (text) => setMsg({ text, id: Date.now() })
    return () => { pushConfirm = null; pushToast = null }
  }, [])

  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 2600)
    return () => clearTimeout(t)
  }, [msg])

  const close = (v: boolean) => { req?.resolve(v); setReq(null) }

  return (
    <>
      {req && (
        <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && close(false)}
          onKeyDown={(e) => e.key === 'Escape' && close(false)}>
          <div className="modal confirm" role="alertdialog">
            <p>{req.message}</p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => close(false)}>取消</button>
              <button autoFocus className={`btn ${req.danger ? 'danger-fill' : 'primary'}`} onClick={() => close(true)}>{req.ok}</button>
            </div>
          </div>
        </div>
      )}
      {msg && <div key={msg.id} className="toast" role="status">{msg.text}</div>}
    </>
  )
}
