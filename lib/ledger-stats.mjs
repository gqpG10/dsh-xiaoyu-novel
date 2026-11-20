/**
 * 账本体检与「本章记账了没」（0.15.0）。
 *
 * 为什么单独一个模块：checkProject 只出 warn 文案（给 CLI 看），面板要的是
 * 结构化数字——每本账多大、几条超长、最长的几条长什么样，以及章节保存后
 * 「本章在账本里有没有对应条目」。这些数据都不改文件，纯读。
 *
 * 口径与 lib/novel-parse.mjs 的账本膨胀检查一致：单条描述（description /
 * notes / content / summary 任一）≥300 字算超长，账本 ≥200KB 算偏胖。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { parseFlatYamlArray } from './novel-parse.mjs'

/** 面板展示的账本清单（顺序即展示顺序，与你每章要读的顺序一致）。 */
export const LEDGER_FILES = ['memories.yml', 'timeline.yml', 'clue-board.yml', 'relations.yml', 'foreshadows.yml']
/** 与 checkProject 同阈值（改这里等于改 CLI 口径，两边必须一起改）。 */
export const LEDGER_WARN_BYTES = 200 * 1024
export const LONG_ENTRY_CHARS = 300
const TEXT_KEYS = ['description', 'notes', 'content', 'summary']
const TOP_N = 3

function readOrNull(abs) {
  try {
    return readFileSync(abs, 'utf8')
  } catch {
    return null
  }
}

/**
 * 解析结果缓存：账本动辄 100-250KB，每次自动保存都重解析三本账是白烧 CPU。
 * 键 = 绝对路径，值 = { sig, entries }；sig 取 mtime+size，文件没动就复用。
 * 只留最近 12 条（六本账 × 两个工作区），内存可忽略。
 */
const ENTRY_CACHE = new Map()
const ENTRY_CACHE_MAX = 12

/** 读并解析成条目数组；解析失败返回 null（调用方按「没读出来」处理）。 */
function entriesOf(abs) {
  let sig = null
  try {
    const st = statSync(abs)
    sig = String(st.mtimeMs) + ':' + String(st.size)
  } catch {
    sig = null
  }
  const hit = ENTRY_CACHE.get(abs)
  if (hit !== undefined && sig !== null && hit.sig === sig) return hit.entries
  const raw = readOrNull(abs)
  const parsed = raw === null ? null : parseFlatYamlArray(raw)
  const entries = Array.isArray(parsed) ? parsed : null
  if (sig !== null) {
    ENTRY_CACHE.set(abs, { sig, entries })
    if (ENTRY_CACHE.size > ENTRY_CACHE_MAX) {
      const oldest = ENTRY_CACHE.keys().next().value
      if (oldest !== undefined) ENTRY_CACHE.delete(oldest)
    }
  }
  return entries
}

/** 单条的超长字段：取最长的那一个（一条只算一次，与 check 口径一致）。 */
function longFieldOf(entry) {
  if (entry === null || typeof entry !== 'object') return null
  let best = null
  for (const key of TEXT_KEYS) {
    const value = typeof entry[key] === 'string' ? entry[key] : ''
    if (best === null || value.length > best.value.length) best = { key, value }
  }
  if (best === null || best.value.length < LONG_ENTRY_CHARS) return null
  return best
}

function entryRef(entry) {
  if (entry === null || typeof entry !== 'object') return ''
  // 章号字段因账而异：memories 用 source_chapter、timeline 用 chapter、
  // clue-board 用 related_chapter（早版本还有 chapters 复数写法）。
  const raw = entry.source_chapter ?? entry.chapter ?? entry.related_chapter ?? entry.chapters ?? ''
  if (Array.isArray(raw)) return raw.map((x) => String(x)).join(',')
  return String(raw ?? '')
}

/**
 * 账本统计：每本账的字节数、条目数、超长条数与最长的几条预览。
 * 文件缺失/解析失败都按空账处理（不抛错——体检不该把面板拖垮）。
 */
export function ledgerStats(novelDir) {
  const dir = path.resolve(novelDir)
  const items = []
  let totalBytes = 0
  for (const file of LEDGER_FILES) {
    const abs = path.join(dir, file)
    if (!existsSync(abs)) continue
    let bytes = 0
    try {
      bytes = statSync(abs).size
    } catch {
      continue
    }
    totalBytes += bytes
    const list = entriesOf(abs) ?? []
    const top = []
    let longEntries = 0
    for (const entry of list) {
      const hit = longFieldOf(entry)
      if (hit === null) continue
      longEntries += 1
      top.push({
        ref: entryRef(entry),
        len: hit.value.length,
        preview: hit.value.slice(0, 48).replace(/\s+/g, ' '),
      })
    }
    top.sort((a, b) => b.len - a.len)
    items.push({
      file,
      bytes,
      entries: list.length,
      longEntries,
      heavy: bytes >= LEDGER_WARN_BYTES,
      top: top.slice(0, TOP_N),
    })
  }
  return {
    ok: true,
    totalBytes,
    items,
    warnBytes: LEDGER_WARN_BYTES,
    longChars: LONG_ENTRY_CHARS,
    heavyAny: items.some((it) => it.heavy),
    longAny: items.some((it) => it.longEntries > 0),
  }
}

/** 章节 stem（vXX-cXXX）与全局章号（frontmatter num 优先，缺省只认 stem）。 */
function chapterKeys(file, num) {
  const stem = String(file ?? '').replace(/\.md$/i, '')
  const keys = new Set([stem])
  const n = Number.isInteger(num) ? num : null
  if (n !== null) keys.add('第' + n + '章')
  return { stem, num: n, keys }
}

function mentions(entry, keys) {
  const ref = entryRef(entry)
  if (ref !== '') {
    for (const key of keys) if (ref.includes(key)) return true
  }
  for (const k of TEXT_KEYS) {
    const value = typeof entry[k] === 'string' ? entry[k] : ''
    if (value === '') continue
    for (const key of keys) if (value.includes(key)) return true
  }
  return false
}

/**
 * 本章记账了没：memories / timeline / clue-board 三本账里有没有指向本章的条目。
 * 只报「没找到」不报错——账本可能用别的写法（作者自定义字段），面板提示是
 * 提醒不是判罪，措辞按「没发现」出口。
 *
 * @param {string} novelDir
 * @param {string} file 章节文件名（vXX-cXXX.md）
 * @param {number|null} num 章号（快照 chapters[].num；缺省不查「第N章」）
 */
export function chapterLedgerHint(novelDir, file, num = null) {
  const dir = path.resolve(novelDir)
  const { stem, num: n, keys } = chapterKeys(file, num)
  const watchdog = ['memories.yml', 'timeline.yml', 'clue-board.yml']
  const missing = []
  const found = {}
  for (const watch of watchdog) {
    const entries = entriesOf(path.join(dir, watch))
    found[watch] = false
    if (entries === null || entries.length === 0) {
      missing.push(watch)
      continue
    }
    const hit = entries.some((entry) => mentions(entry, keys))
    found[watch] = hit
    if (!hit) missing.push(watch)
  }
  return { ok: true, file: stem, num: n, missing, found }
}
