/**
 * book-scan.mjs —— 3.48.0 新书扫描。
 *
 * 主人的痛点：开了一本新书（novel2），面板里选不出来。
 * 两个原因：① 插件死认 <root>/novel ② 那个路径可能没在 DSH 工作区列表里注册。
 *
 * 本模块绕过这两道门：直接扫盘找出「所有带 chapters/ 的目录」，
 * 标出哪些已注册、哪些没注册，让主人一眼看到，然后一键接入。
 */

import path from 'node:path'
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs'

/** 目录名黑名单（不往下扫）。 */
const SKIP = /^(node_modules|\.git|\.dsh|dist|templates|__pycache__|backups?)$/i

/** 判断一个目录是不是「书目录」（含 chapters/ 且里面至少一个 .md）。 */
function isBookDir(p) {
  try {
    const ch = path.join(p, 'chapters')
    if (!existsSync(ch)) return false
    const files = readdirSync(ch).filter((f) => /\.md$/i.test(f) && !/\.(bak|pre-)/.test(f))
    return files.length > 0
  } catch { return false }
}

/** 粗略统计书的信息（书名、章节数、末次修改）。 */
function bookInfo(p) {
  let title = path.basename(p)
  let chapters = 0
  let mtime = 0
  try {
    const proj = path.join(p, 'project.yml')
    if (existsSync(proj)) {
      const raw = readFileSync(proj, 'utf8')
      const m = /^\s*title\s*:\s*(.+)$/m.exec(raw)
      if (m) title = m[1].trim().replace(/^["']|["']$/g, '')
    }
    const chDir = path.join(p, 'chapters')
    const files = readdirSync(chDir).filter((f) => /\.md$/i.test(f) && !/\.(bak|pre-)/.test(f))
    chapters = files.length
    // 末次修改：取最新的一章
    for (const f of files) {
      try {
        const t = statSync(path.join(chDir, f)).mtimeMs
        if (t > mtime) mtime = t
      } catch { /* 忽略 */ }
    }
  } catch { /* 忽略 */ }
  // 书的「根」应该是 chapters 的父目录
  return { title, chapters, mtime, novelDir: p, root: path.dirname(p) }
}

/**
 * 扫描一本书的根目录以下 N 层，找出所有书目录。
 * @param {string} scanRoot 起点（工作区根目录，如 <workspace> 或其上一级）
 * @param {object} opts { depth=2, limit=40 }
 */
export function scanBooks(scanRoot, opts = {}) {
  const depth = Number(opts.depth) >= 0 ? Number(opts.depth) : 2
  const limit = Number(opts.limit) > 0 ? Number(opts.limit) : 40
  const start = path.resolve(scanRoot)
  if (!existsSync(start)) return { ok: false, error: '扫描起点不存在：' + start }
  const found = []
  const seen = new Set()

  const walk = (dir, level) => {
    if (found.length >= limit || level > depth) return
    let kids = []
    try { kids = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const k of kids) {
      if (found.length >= limit) return
      if (!k.isDirectory() || SKIP.test(k.name)) continue
      const p = path.join(dir, k.name)
      if (isBookDir(p)) {
        if (seen.has(p)) continue
        seen.add(p)
        found.push(bookInfo(p))
      } else {
        walk(p, level + 1)
      }
    }
  }

  // 起点自己也是书？先查它
  if (isBookDir(start)) found.push(bookInfo(start))
  walk(start, 0)

  found.sort((a, b) => b.mtime - a.mtime)
  return {
    ok: true,
    scanRoot: start,
    depth,
    total: found.length,
    books: found,
    summary: found.length ? '扫到 ' + found.length + ' 本' : '没扫到书（试着把扫描深度调到 3）',
  }
}

/**
 * 给扫描结果标注「是否已注册工作区」。
 * @param {Array} books scanBooks 的 books
 * @param {string[]} registeredPaths 已注册工作区路径列表
 */
export function markRegistered(books, registeredPaths) {
  const set = new Set((registeredPaths || []).map((p) => path.resolve(p).toLowerCase()))
  return (books || []).map((b) => ({
    ...b,
    registered: set.has(path.resolve(b.root).toLowerCase()),
    // 建议接入的路径：书的根（chapters 的父目录的父目录即 <root>/novel 的 <root>）
    suggestPath: path.dirname(b.novelDir),
  }))
}

export function summarizeScan(r) {
  if (!r || r.ok === false) return r && r.error ? r.error : '未扫描'
  return r.summary
}
