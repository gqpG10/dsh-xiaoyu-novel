// ── 全书搜索 / 替换（0.6.0）──────────────────────────────────────────
// 只读搜索走同步读盘（章节目录一般 < 300 个文件，配合宿主读缓存足够快）；
// 替换逐章走 mutateChapterBody（frontmatter 保字节 + baseHash 冲突检测），
// 任何一章失败不影响其他章，结果逐文件回报。
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { readChapter, mutateChapterBody } from './panel-core.mjs'

const MAX_LIMIT = 300
const MAX_QUERY = 80

function scanDir(dir, kind) {
  let names = []
  try { names = readdirSync(dir) } catch { return [] }
  return names
    .filter((n) => /\.md$/i.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((n) => ({ file: n, kind, full: path.join(dir, n) }))
}

function termsOf(query) {
  return String(query || '').trim().split(/\s+/).filter(Boolean).slice(0, 4)
}

export function searchNovel(novelDir, query, options = {}) {
  const q = String(query || '').trim().slice(0, MAX_QUERY)
  const terms = termsOf(q)
  if (terms.length === 0) return { ok: true, query: q, matches: [], truncated: false, files: 0 }
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(options.limit) || 200))
  const roots = [{ dir: path.join(novelDir, 'chapters'), kind: 'chapter' }]
  if (options.all !== false) roots.push({ dir: path.join(novelDir, 'outlines'), kind: 'outline' })
  const lower = terms.map((t) => t.toLowerCase())
  const matches = []
  let files = 0
  let truncated = false
  for (const root of roots) {
    for (const entry of scanDir(root.dir, root.kind)) {
      files++
      let text = ''
      try { text = readFileSync(entry.full, 'utf8') } catch { continue }
      const lines = text.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const hay = line.toLowerCase()
        let hit = true
        for (const t of lower) { if (hay.indexOf(t) === -1) { hit = false; break } }
        if (!hit) continue
        if (matches.length >= limit) { truncated = true; break }
        matches.push({
          file: entry.file, kind: entry.kind, line: i + 1,
          text: line.trim().slice(0, 180),
        })
      }
      if (truncated) break
    }
    if (truncated) break
  }
  return { ok: true, query: q, matches, truncated, files }
}

export function replaceInNovel(novelDir, query, replacement, options = {}) {
  const find = String(query || '')
  const to = String(replacement == null ? '' : replacement)
  if (find === '') {
    const err = new Error('查找内容不能为空')
    err.statusCode = 422
    throw err
  }
  if (find.length > MAX_QUERY) {
    const err = new Error('查找内容过长')
    err.statusCode = 422
    throw err
  }
  const only = options.file ? String(options.file) : ''
  const files = []
  if (only) files.push(only)
  else {
    for (const entry of scanDir(path.join(novelDir, 'chapters'), 'chapter')) files.push(entry.file)
  }
  const results = []
  let total = 0
  for (const file of files) {
    try {
      const current = readChapter(novelDir, file)
      if (current.body.indexOf(find) === -1) { results.push({ file, count: 0 }); continue }
      const count = current.body.split(find).length - 1
      const next = current.body.split(find).join(to)
      mutateChapterBody(novelDir, file, next, { baseHash: current.hash })
      total += count
      results.push({ file, count, ok: true })
    } catch (err) {
      results.push({ file, count: 0, ok: false, error: String(err?.message ?? err) })
    }
  }
  return { ok: true, total, files: results }
}
