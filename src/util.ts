export function daysSince(ts: number) {
  return Math.max(0, Math.floor((Date.now() - ts) / 86400000))
}

export function fmtDate(ts: number) {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function fmtRelative(ts: number) {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  return fmtDate(ts).slice(0, 10)
}

/** 取 markdown 里的纯文本摘要 */
export function excerpt(md: string, len = 90) {
  const text = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, ' ')
    .replace(/\\(.)/g, '$1')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s*/gm, ' ')
    .replace(/[#>*_`~|]+/g, ' ')
    .replace(/^\s*[-+]\s+/gm, ' ')
    .replace(/\$+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > len ? text.slice(0, len) + '…' : text
}

export function fileToDataURL(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(file)
  })
}
