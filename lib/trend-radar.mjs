/**
 * trend-radar.mjs —— 3.31.0 题材雷达（按番茄真实榜单结构解析）。
 *
 * 番茄榜单页 /rank 的 window.__INITIAL_STATE__.rank 里：
 *   book_list[]           每本：bookName / author / wordNumber / readCount /
 *                         curent_category_id（题材是 ID，category 字段是空串）
 *   rankCategoryTypeList  { male:[{id,name}], female:[{id,name}] } 题材 ID→名
 *
 * 所以流程是：抓页 → 解 JSON → 用映射表把 category_id 翻成题材名 → 聚合排行。
 * 全零依赖纯 Node fetch；快照落 novelDir/reports/radar-latest.json，断网回落。
 */

import path from 'node:path'
import { readTextCached } from './read-cache.mjs'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36'
const TIMEOUT_MS = 15000
// 男女双榜：同题材在不同榜热度不同，合并后样本更全（番茄单榜只列 10 本）
const RANK_URLS = [
  'https://fanqienovel.com/rank?type=male',
  'https://fanqienovel.com/rank?type=female',
  'https://fanqienovel.com/rank',
]

/** 合并多个榜单的书单（去重 by bookId/书名，保留首次出现的题材）。 */
export function mergeBookLists(lists) {
  const seen = new Set()
  const out = []
  for (const list of lists || []) {
    for (const b of list || []) {
      const key = (b.bookId || b.title || '') + '|' + (b.title || '')
      if (seen.has(key)) continue
      seen.add(key)
      out.push(b)
    }
  }
  return out
}

async function fetchText(url) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: ctrl.signal })
    if (!r.ok) return null
    return await r.text()
  } catch { return null } finally { clearTimeout(timer) }
}

/** 从 HTML 里把 window.__INITIAL_STATE__ 的 JSON 完整取出来（括号配对，字符串感知）。 */
export function extractInitialState(html) {
  const src = String(html || '')
  const marker = 'window.__INITIAL_STATE__'
  const at = src.indexOf(marker)
  if (at < 0) return null
  let i = src.indexOf('=', at + marker.length)
  if (i < 0) return null
  i += 1
  while (i < src.length && /\s/.test(src[i])) i += 1
  if (src[i] !== '{') return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let k = i; k < src.length; k++) {
    const c = src[k]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') { inStr = true; continue }
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) {
        try { return JSON.parse(src.slice(i, k + 1)) } catch { return null }
      }
    }
  }
  return null
}

/** 从 state.rank 里抽取书单 + 题材映射，返回标准化条目。 */
export function parseRankState(state) {
  const rank = state && state.rank
  if (!rank) return { books: [], catNames: {} }
  const catNames = {}
  const lists = rank.rankCategoryTypeList || {}
  for (const key of Object.keys(lists)) {
    for (const c of lists[key] || []) {
      if (c && c.id != null && c.name) catNames[String(c.id)] = c.name
    }
  }
  const raw = Array.isArray(rank.book_list) ? rank.book_list : []
  const books = raw.map((b) => {
    const cid = b.curent_category_id ?? b.pos_category_id ?? ''
    return {
      bookId: String(b.bookId || ''),
      title: String(b.bookName || '').trim(),
      author: String(b.author || '').trim(),
      category: catNames[String(cid)] || (b.categoryV2 || b.category || '') || '未分类',
      categoryId: String(cid || ''),
      words: Number(b.wordNumber) || 0,
      reads: Number(b.readCount ?? b.read_count) || 0,
    }
  }).filter((b) => b.title)
  return { books, catNames }
}

/** 按题材聚合：本数、总字数、总阅读、样本书名。 */
export function aggregateCategories(books) {
  const byCat = new Map()
  for (const b of books || []) {
    const cat = b.category || '未分类'
    const cur = byCat.get(cat) || { category: cat, count: 0, words: 0, reads: 0, sample: [] }
    cur.count += 1
    cur.words += b.words || 0
    cur.reads += b.reads || 0
    if (cur.sample.length < 3 && b.title) cur.sample.push(b.title)
    byCat.set(cat, cur)
  }
  return Array.from(byCat.values()).sort((a, b) => b.count - a.count || b.reads - a.reads)
}

/** 扫榜：拉页面 → 解 JSON → 聚合 → 存快照；失败读最近快照。 */
export async function scanRadar(novelDir) {
  const dir = path.resolve(novelDir)
  const fetched = []
  const sources = []
  for (const u of RANK_URLS) {
    const html = await fetchText(u)
    if (!html) continue
    const state = extractInitialState(html)
    const parsed = parseRankState(state)
    if (parsed.books.length >= 1) { fetched.push(parsed.books); sources.push(u) }
  }
  const books = mergeBookLists(fetched)
  const source = sources.join(' + ') || null
  if (books.length > 0) {
    const categories = aggregateCategories(books)
    const snapshot = { at: new Date().toISOString(), source, books, categories }
    try {
      const { writeFileSync, mkdirSync } = await import('node:fs')
      const rdir = path.join(dir, 'reports')
      mkdirSync(rdir, { recursive: true })
      writeFileSync(path.join(rdir, 'radar-latest.json'), JSON.stringify(snapshot, null, 2), 'utf8')
    } catch { /* 快照写失败不影响返回 */ }
    return { ok: true, at: snapshot.at, source, categories, books, live: true }
  }
  try {
    const raw = readTextCached(path.join(dir, 'reports', 'radar-latest.json'))
    if (raw !== null) {
      const snap = JSON.parse(String(raw))
      return { ok: true, at: snap.at, source: snap.source, categories: snap.categories || [], books: snap.books || [], live: false }
    }
  } catch { /* 无快照 */ }
  return { ok: false, error: '榜单不可达且无本地快照（番茄被墙或页面结构变化时正常，稍后重试）' }
}
