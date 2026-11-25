/**
 * trend-radar.mjs —— 3.24.0 题材雷达（fanqie-radar 范式，零依赖纯 Node fetch）。
 *
 * 拉番茄小说公开榜单页 → 提取书名/题材/热度 → 本地 JSON 快照 → 面板「项目」页
 * 题材雷达卡。无浏览器、无签名逆向、无第三方依赖；快照存 novelDir/reports/
 * radar-<date>.json，失败的旧快照兜底显示（离线也能看上次扫的）。
 *
 * 合规说明：只读公开网页数据，遵守 robots 精神，快照仅供个人选题参考。
 */

import path from 'node:path'
import { readTextCached, listDirCached } from './read-cache.mjs'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const TIMEOUT_MS = 12000

/** 拉一个 URL 的 HTML（带超时，失败返回 null）。 */
async function fetchText(url) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: ctrl.signal })
    if (!r.ok) return null
    return await r.text()
  } catch { return null } finally { clearTimeout(timer) }
}

/** 从榜单 HTML 提取条目：书名/分类/热度（正则启发式，站点改版需跟）。 */
export function parseRankHtmlForTest(html) { return parseRankHtml(html) }
function parseRankHtml(html) {
  const out = []
  // 番茄页面内嵌 JSON（window.__INITIAL_STATE__）优先
  const m = /window\.__INITIAL_STATE__\s*=\s*([\s\S]+?);\s*<\/script>/.exec(String(html))
  if (m !== null) {
    try {
      const walk = (node) => {
        if (node === null || typeof node !== 'object' || out.length > 60) return
        if (Array.isArray(node)) { for (const x of node) walk(x); return }
        const title = typeof node.bookName === 'string' ? node.bookName : (typeof node.book_name === 'string' ? node.book_name : null)
        if (title) {
          out.push({
            title,
            category: String(node.category ?? node.categoryName ?? node.category_name ?? '').slice(0, 24) || null,
            heat: Number(node.heat ?? node.popularity ?? node.readCount ?? node.read_count ?? 0) || 0,
          })
        }
        for (const v of Object.values(node)) walk(v)
      }
      walk(JSON.parse(m[1]))
    } catch { /* JSON 解析失败走正则 */ }
  }
  if (out.length === 0) {
    // 兜底正则：常见字段模式
    const re = /"bookName"\s*:\s*"([^"]{1,30})"[\s\S]{0,180}?"category(?:Name)?"\s*:\s*"([^"]{0,24})"/g
    let mm = null
    while ((mm = re.exec(String(html))) !== null && out.length < 60) {
      out.push({ title: mm[1], category: mm[2] || null, heat: 0 })
    }
  }
  return out
}

/** 题材聚合：按分类计数 + 热度排序。 */
export function aggregateCategories(items) {
  const byCat = new Map()
  for (const it of items || []) {
    const cat = it.category || '未分类'
    const cur = byCat.get(cat) || { category: cat, count: 0, heat: 0, sample: [] }
    cur.count += 1
    cur.heat += it.heat || 0
    if (cur.sample.length < 3 && it.title) cur.sample.push(it.title)
    byCat.set(cat, cur)
  }
  return Array.from(byCat.values()).sort((a, b) => b.count - a.count || b.heat - a.heat)
}

/**
 * 扫榜：拉榜单 → 解析 → 存快照 → 返回聚合。全失败时读最近快照兜底。
 * @param {string} novelDir
 * @returns {Promise<{ok, at, source, categories, books}>}
 */
export async function scanRadar(novelDir) {
  const dir = path.resolve(novelDir)
  const urls = [
    'https://fanqienovel.com/rank',
    'https://fanqienovel.com/library',
  ]
  let items = []
  let source = null
  for (const u of urls) {
    const html = await fetchText(u)
    if (html === null) continue
    const parsed = parseRankHtml(html)
    if (parsed.length >= 5) { items = parsed; source = u; break }
  }
  if (items.length > 0) {
    const snapshot = { at: new Date().toISOString(), source, books: items.slice(0, 60), categories: aggregateCategories(items.slice(0, 60)) }
    try {
      const { writeFileSync, mkdirSync } = await import('node:fs')
      const rdir = path.join(dir, 'reports')
      mkdirSync(rdir, { recursive: true })
      writeFileSync(path.join(rdir, 'radar-latest.json'), JSON.stringify(snapshot, null, 2), 'utf8')
    } catch { /* 快照写失败不影响返回 */ }
    return { ok: true, at: snapshot.at, source: snapshot.source, categories: snapshot.categories, books: snapshot.books, live: true }
  }
  // 兜底：读最近快照
  try {
    const raw = readTextCached(path.join(dir, 'reports', 'radar-latest.json'))
    if (raw !== null) {
      const snap = JSON.parse(String(raw))
      return { ok: true, at: snap.at, source: snap.source, categories: snap.categories || [], books: snap.books || [], live: false }
    }
  } catch { /* 无快照 */ }
  return { ok: false, error: '榜单不可达且无本地快照（番茄被墙/改版时正常，稍后重试）' }
}
