/**
 * living-bible.mjs —— 3.25.0 活设定集 + 章后记忆（novel-bible / 墨屿范式）。
 *
 * 活设定集：设定条目（world/*.md、science/*.md、research/*.md）记录 last_used。
 * 智能上下文/面板打开某条设定时调 touchBible()，条目从「静态文件」变「写作时
 * 被引用的活文档」——设定页按「最近使用」排序，从不引用的自动沉底。
 * 标记写在文件头 frontmatter 的 last_used 字段（没有 frontmatter 就造一个），
 * 不动正文，Markdown 仍可手改。
 *
 * 章后记忆：每章一个 memory/<stem>.yml（开章/收章/对话/字数的纯函数摘要）。
 */

import path from 'node:path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { readTextCached, listDirCached } from './read-cache.mjs'

/** 设定实体目录（与 panel-core 的 collectMdEntities 一致）。 */
const BIBLE_DIRS = ['world', 'science', 'research']

function listBibleFiles(novelDir) {
  const root = path.resolve(novelDir)
  const out = []
  for (const d of BIBLE_DIRS) {
    const dir = path.join(root, d)
    for (const f of (listDirCached(dir) || [])) {
      if (/\.md$/i.test(f)) out.push({ dir: d, file: f, rel: d + '/' + f })
    }
  }
  return out
}

/** 读 frontmatter 字段（只读头部，坏格式返回空对象）。 */
function readFrontmatter(raw) {
  const text = String(raw ?? '')
  if (!text.startsWith('---')) return {}
  const end = text.indexOf('\n---', 3)
  if (end === -1) return {}
  const out = {}
  for (const line of text.slice(3, end).split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

/** 活设定集状态：全部设定条目按最近使用排序（没用过的沉底、按名字）。 */
export function bibleUsage(novelDir) {
  const out = []
  for (const f of listBibleFiles(novelDir)) {
    const raw = readTextCached(path.join(path.resolve(novelDir), f.rel))
    if (raw === null) continue
    const fm = readFrontmatter(raw)
    out.push({
      rel: f.rel,
      name: fm.name || f.file.replace(/\.md$/i, ''),
      category: fm.category || f.dir,
      lastUsed: fm.last_used || null,
    })
  }
  out.sort((a, b) => {
    if (a.lastUsed && b.lastUsed) return b.lastUsed.localeCompare(a.lastUsed)
    if (a.lastUsed) return -1
    if (b.lastUsed) return 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })
  return out
}

/** 给一条设定盖 last_used（幂等：当天已盖不重写；只动 frontmatter）。 */
export function touchBible(novelDir, rel) {
  const root = path.resolve(novelDir)
  const clean = String(rel ?? '').replace(/^\.\//, '')
  const seg = clean.split('/')
  if (seg.length !== 2 || !BIBLE_DIRS.includes(seg[0]) || /[\\]/.test(clean) || !/\.md$/i.test(seg[1])) {
    return { ok: false, error: '非法设定路径（需 world|science|research/<名>.md）' }
  }
  const target = path.join(root, clean)
  if (!existsSync(target)) return { ok: false, error: '设定文件不存在' }
  let raw = ''
  try { raw = readFileSync(target, 'utf8') } catch { return { ok: false, error: '读取失败' } }
  const today = new Date().toISOString().slice(0, 10)
  const fm = readFrontmatter(raw)
  if (fm.last_used && String(fm.last_used).slice(0, 10) === today) {
    return { ok: true, touched: false, rel: clean }
  }
  let next
  if (raw.startsWith('---')) {
    const end = raw.indexOf('\n---', 3)
    if (end === -1) return { ok: false, error: 'frontmatter 未闭合' }
    const head = raw.slice(0, end)
    const body = raw.slice(end)
    next = /^\s*last_used\s*:/m.test(head)
      ? head.replace(/^\s*last_used\s*:.*$/m, 'last_used: ' + today) + body
      : head + '\nlast_used: ' + today + body
  } else {
    next = '---\nlast_used: ' + today + '\n---\n' + raw
  }
  try { writeFileSync(target, next, 'utf8') } catch (e) { return { ok: false, error: '写入失败：' + e.message } }
  return { ok: true, touched: true, rel: clean }
}

/** 纯函数章摘要（不调模型）：首段定调 + 对话轮数 + 末段钩子 + 字数。 */
export function summarizeChapter(text) {
  const body = String(text ?? '')
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  if (paras.length === 0) return { ok: false, error: '空章' }
  const head = paras[0].slice(0, 80)
  const lastPara = paras[paras.length - 1]
  const tail = lastPara.slice(0, 80)
  const dialogLines = (body.match(/[“"]([^”"]{2,40})[”"]/g) || []).length
  const chars = body.replace(/\s/g, '').length
  const qTail = /[？?…—]/.test(lastPara.slice(-30))
  const summary = [
    '开章：' + head,
    '收章：' + tail,
    '对话 ' + dialogLines + ' 轮 · ' + chars + ' 字' + (qTail ? ' · 章尾留问' : ' · 章尾平收'),
  ].join('\n')
  return { ok: true, summary, chars, dialogLines, tailHook: qTail }
}

/** 读最近一条章记忆（智能上下文自动携带前情）。 */
export function readPrevMemory(novelDir, stems) {
  const dir = path.join(path.resolve(novelDir), 'memory')
  const sorted = (stems || []).slice().sort()
  for (let i = sorted.length - 1; i >= 0; i--) {
    const raw = readTextCached(path.join(dir, sorted[i] + '.yml'))
    if (raw !== null) return { chapter: sorted[i], text: String(raw) }
  }
  return null
}
