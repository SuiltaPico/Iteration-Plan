import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { exportAll, importAll } from '../db'
import { confirmDialog, toast } from './Dialogs'

export default function BackupDialog({ onClose }: { onClose: () => void }) {
  const [json, setJson] = useState('')
  const [paste, setPaste] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => { exportAll().then((d) => setJson(JSON.stringify(d, null, 2))) }, [])

  function download() {
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `迭代策略备份-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(json)
      toast('备份已复制到剪贴板')
    } catch {
      const el = document.getElementById('backup-json') as HTMLTextAreaElement | null
      el?.select()
      toast('无法自动复制，已选中内容，请手动复制')
    }
  }

  async function doImport(text: string) {
    let data
    try { data = JSON.parse(text) } catch { toast('内容不是有效的 JSON'); return }
    if (!(await confirmDialog('导入会覆盖当前所有数据，确定继续吗？', { ok: '覆盖导入' }))) return
    try {
      await importAll(data)
      toast('导入成功')
      navigate('/')
      onClose()
    } catch (e) {
      toast('导入失败：' + (e as Error).message)
    }
  }

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <h2>备份与恢复</h2>
        <p className="muted sm">数据只保存在当前浏览器里。换浏览器或设备前，先导出备份。</p>
        <div className="field">
          <span>导出</span>
          <textarea id="backup-json" rows={4} readOnly value={json} className="mono" />
          <div className="row-btns">
            <button className="btn" onClick={download}>下载 JSON 文件</button>
            <button className="btn" onClick={copy}>复制到剪贴板</button>
          </div>
        </div>
        <div className="field">
          <span>导入（会覆盖当前数据）</span>
          <textarea id="backup-paste" rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="粘贴备份 JSON…" className="mono" />
          <div className="row-btns">
            <button className="btn" onClick={() => fileRef.current?.click()}>选择文件导入</button>
            <button className="btn primary" disabled={!paste.trim()} onClick={() => doImport(paste)}>导入粘贴的内容</button>
          </div>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) doImport(await f.text())
          }} />
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  )
}
