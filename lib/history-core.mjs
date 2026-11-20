// ── 正文版本历史（0.6.0）──────────────────────────────────────────────
// 每次 chapter-save 落盘前，把「旧正文」快照进 novel/.xiaoyu/versions/<stem>/。
// 只存正文（frontmatter 不存：恢复时正文放回编辑器，frontmatter 永远取磁盘
// 当前值，避免把旧状态/旧标题写回去）。快照有 120s 最小间隔 + 内容去重，
// 自动保存不会把目录刷爆；每章保留最近 30 份。
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { countCjk, splitFrontmatter } from './novel-parse.mjs'

const KEEP = 30
const MIN_INTERVAL_MS = 120 * 1000

export function chapterStem(file) {
  const name = String(file || '')
  if (!/^[^/\\]+\.md$/i.test(name) || name === '.' || name === '..') {
    const err = new Error('章节文件名不合规')
    err.statusCode = 422
    throw err
  }
  return name.replace(/\.md$/i, '')
}

function versionsDir(novelDir, file) {
  return path.join(novelDir, '.xiaoyu', 'versions', chapterStem(file))
}

function bodyOf(text) {
  try {
    const parts = splitFrontmatter(String(text || ''))
    return typeof parts?.body === 'string' ? parts.body : String(text || '')
  } catch {
    return String(text || '')
  }
}

/**
 * 落盘前快照旧正文。返回 { saved, id }。任何失败只返回 saved:false，不抛——
 * 版本历史是保险，绝不能拦住正文保存主流程。
 */
export function snapshotChapter(novelDir, file, rawText, options = {}) {
  try {
    const keep = Number.isInteger(options.keep) ? options.keep : KEEP
    const minInterval = Number.isInteger(options.minIntervalMs) ? options.minIntervalMs : MIN_INTERVAL_MS
    const body = bodyOf(rawText)
    if (body.trim() === '') return { saved: false }
    const dir = versionsDir(novelDir, file)
    mkdirSync(dir, { recursive: true })
    const entries = listRaw(dir)
    if (entries.length > 0) {
      const latest = entries[0]
      const latestText = readFileSync(path.join(dir, latest.id + '.md'), 'utf8')
      if (latestText === body) return { saved: false } // 内容没变，不重复存
      if (Date.now() - latest.at < minInterval) return { saved: false } // 自动保存节流
    }
    const id = String(Date.now())
    writeFileSync(path.join(dir, id + '.md'), body, 'utf8')
    for (const extra of entries.slice(keep - 1)) {
      try { rmSync(path.join(dir, extra.id + '.md'), { force: true }) } catch { /* 清理尽力而为 */ }
    }
    return { saved: true, id }
  } catch {
    return { saved: false }
  }
}

function listRaw(dir) {
  let names = []
  try { names = readdirSync(dir) } catch { return [] }
  const out = []
  for (const name of names) {
    if (!/^\d{10,16}\.md$/.test(name)) continue
    const id = name.slice(0, -3)
    try {
      const st = statSync(path.join(dir, name))
      out.push({ id, at: Number(id), size: st.size })
    } catch { /* 跳过坏项 */ }
  }
  out.sort((a, b) => b.at - a.at)
  return out
}

export function listVersions(novelDir, file) {
  chapterStem(file) // 校验
  const dir = versionsDir(novelDir, file)
  const rows = listRaw(dir).slice(0, KEEP)
  return rows.map((row) => {
    let text = ''
    try { text = readFileSync(path.join(dir, row.id + '.md'), 'utf8') } catch { /* 读不到就空 */ }
    return { id: row.id, at: new Date(row.at).toISOString(), words: countCjk(text), size: row.size }
  })
}

export function readVersion(novelDir, file, id) {
  chapterStem(file)
  const safe = String(id || '')
  if (!/^\d{10,16}$/.test(safe)) {
    const err = new Error('版本号不合规')
    err.statusCode = 422
    throw err
  }
  const full = path.join(versionsDir(novelDir, file), safe + '.md')
  if (!existsSync(full)) {
    const err = new Error('版本不存在')
    err.statusCode = 404
    throw err
  }
  const text = readFileSync(full, 'utf8')
  return { ok: true, id: safe, text, words: countCjk(text) }
}
