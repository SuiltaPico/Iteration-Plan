/** 极简 GitHub 客户端：读一个文件、把一批文件作为一次提交写进分支 */
export interface GhConfig {
  token: string
  repo: string // owner/name
  branch: string
  apiBase?: string
}

export class GhError extends Error {
  constructor(message: string, public status?: number) { super(message) }
}
export class GhConflict extends GhError {}

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)))

export function github(cfg: GhConfig) {
  const base = (cfg.apiBase || 'https://api.github.com').replace(/\/+$/, '')
  const repo = cfg.repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '')
  const branch = cfg.branch.trim() || 'main'

  async function call(method: string, path: string, body?: unknown, accept = 'application/vnd.github+json') {
    let res: Response
    try {
      res = await fetch(`${base}/repos/${repo}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${cfg.token.trim()}`,
          Accept: accept,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      })
    } catch {
      throw new GhError('连不上 GitHub，请检查网络。')
    }
    return res
  }

  async function json(method: string, path: string, body?: unknown) {
    const res = await call(method, path, body)
    if (res.ok) return res.status === 204 ? null : res.json()
    let msg = ''
    try { msg = (await res.json()).message ?? '' } catch { /* 忽略 */ }
    if (res.status === 401) throw new GhError('Token 无效或已过期，请重新生成。', 401)
    if (res.status === 403) throw new GhError(`没有权限或请求太频繁：${msg}`, 403)
    if (res.status === 404) throw new GhError(`找不到仓库「${repo}」，或 Token 没有访问它的权限。`, 404)
    if (res.status === 422 && path.startsWith('/git/refs/')) throw new GhConflict('远端刚被其他设备更新', 422)
    throw new GhError(`GitHub 返回 ${res.status}：${msg}`, res.status)
  }

  return {
    repo, branch,

    /** 分支最新提交；空仓库或分支不存在时返回 null */
    async head(): Promise<string | null> {
      const res = await call('GET', `/git/ref/heads/${encodeURIComponent(branch)}`)
      if (res.ok) return (await res.json()).object.sha
      if (res.status === 404 || res.status === 409) {
        // 区分「仓库不存在/无权限」和「仓库为空、分支不存在」
        await json('GET', '')
        return null
      }
      if (res.status === 401) throw new GhError('Token 无效或已过期，请重新生成。', 401)
      throw new GhError(`GitHub 返回 ${res.status}`, res.status)
    },

    /** 读分支上的一个文本文件，不存在返回 null */
    async read(path: string): Promise<string | null> {
      const res = await call('GET', `/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`, undefined, 'application/vnd.github.raw+json')
      if (res.ok) return res.text()
      if (res.status === 404) return null
      if (res.status === 401) throw new GhError('Token 无效或已过期，请重新生成。', 401)
      throw new GhError(`读取 ${path} 失败：${res.status}`, res.status)
    },

    /** 让分支存在：空仓库写一个初始文件；仓库非空但没有这个分支时从默认分支建 */
    async ensureBranch(): Promise<string> {
      const info = await json('GET', '')
      const def = await call('GET', `/git/ref/heads/${encodeURIComponent(info.default_branch)}`)
      if (def.ok && info.default_branch !== branch) {
        const sha = (await def.json()).object.sha
        await json('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha })
        return sha
      }
      const r = await json('PUT', '/contents/README.md', { message: '初始化迭代策略数据仓库', content: b64('# 迭代策略\n'), branch })
      return r.commit.sha
    },

    /** 在 parent 之上提交：写入 files，删除 remove 里存在的路径；分支被别人推进时抛 GhConflict */
    async commit(parent: string, files: Record<string, string>, remove: string[], message: string) {
      const pc = await json('GET', `/git/commits/${parent}`)
      const tree: unknown[] = Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content }))
      if (remove.length) {
        const existing = await json('GET', `/git/trees/${pc.tree.sha}?recursive=1`)
        const have = new Set<string>((existing.tree as { path: string; type: string }[]).filter((e) => e.type === 'blob').map((e) => e.path))
        for (const p of remove) if (have.has(p) && !(p in files)) tree.push({ path: p, mode: '100644', type: 'blob', sha: null })
      }
      const t = await json('POST', '/git/trees', { base_tree: pc.tree.sha, tree })
      const c = await json('POST', '/git/commits', { message, tree: t.sha, parents: [parent] })
      await json('PATCH', `/git/refs/heads/${encodeURIComponent(branch)}`, { sha: c.sha, force: false })
      return c.sha as string
    },
  }
}
