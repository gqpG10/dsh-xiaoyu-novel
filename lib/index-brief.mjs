/**
 * index-brief.mjs —— 3.54.0 索引简报（记忆体系的替代品）。
 *
 * 主人结论：记忆和索引是同一个功能（让写手知道前面有啥剧情），索引章概要质量更高。
 * 所以记忆整套删掉，前情一律读索引。本模块把 index.yml 转成「按章分块」的阅读形态。
 */

import path from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/** 从一行 `- {num: 1, title: x, summary: ...}` 里切出字段。 */
function fieldsOf(text) {
  const out = {}
  const src = String(text || '')
  let i = 0
  let key = null
  let buf = ''
  let quote = ''
  const push = () => {
    if (key !== null) out[key] = buf.trim()
    key = null
    buf = ''
  }
  while (i < src.length) {
    const ch = src[i]
    if (quote) {
      if (ch === '\\' && i + 1 < src.length) { buf += src[i + 1]; i += 2; continue }
      if (ch === quote) { quote = ''; i++; continue }
      buf += ch; i++; continue
    }
    if (ch === '"' || ch === "'") { quote = ch; i++; continue }
    if (ch === ':') { key = buf.trim(); buf = ''; i++; continue }
    if (ch === ',') { push(); i++; continue }
    buf += ch; i++
  }
  push()
  return out
}

/** 读 index.yml，返回按章号排序的章概要。 */
export function parseIndexChapters(novelDir) {
  const p = path.join(path.resolve(novelDir), 'index.yml')
  if (!existsSync(p)) return { ok: false, error: '没有 index.yml（可能是空书）' }
  const raw = readFileSync(p, 'utf8')
  const out = []
  let vol = null
  for (const line of raw.split(/\r?\n/)) {
    const v1 = /^-\s*id:\s*(\S+)/.exec(line)
    if (v1) { vol = v1[1]; continue }
    const v2 = /^\s*-\s*id:\s*(\S+)/.exec(line)
    if (v2) { vol = v2[1]; continue }
    const m = /^\s*-\s*\{(.*)\}\s*$/.exec(line)
    if (!m) continue
    const f = fieldsOf(m[1])
    if (f.num === undefined || !/^\d+$/.test(String(f.num).trim())) continue
    out.push({
      vol,
      num: Number(f.num),
      title: String(f.title || '').replace(/\s+/g, ' '),
      status: String(f.status || ''),
      words: Number(f.words) || 0,
      summary: String(f.summary || '').replace(/\s+/g, ' ').trim(),
    })
  }
  out.sort((a, b) => a.num - b.num)
  return { ok: true, chapters: out, total: out.length }
}

/**
 * 生成「写第 N 章之前该读的简报」。
 * @param {string} novelDir
 * @param {string} chapterStem 目标章（v01-c012 或 .md）
 * @param {number} before 往前看几章（默认 3）
 */
export function indexBrief(novelDir, chapterStem, before = 3) {
  const parsed = parseIndexChapters(novelDir)
  if (!parsed.ok) return parsed
  const stem = String(chapterStem || '').replace(/\.md$/i, '')
  const cm = /c(\d+)$/.exec(stem)
  const targetNum = cm ? Number(cm[1]) : null
  const n = Number(before) > 0 ? Number(before) : 3
  const picked = targetNum === null
    ? parsed.chapters.slice(-n)
    : parsed.chapters.filter((c) => c.num < targetNum).slice(-n)

  const lines = []
  lines.push('# 前情提要 · 写 ' + (stem || '下一章') + ' 之前必读')
  lines.push('')
  lines.push('> 读自 index.yml（章概要），全书 ' + parsed.total + ' 章，这里列前 ' + picked.length + ' 章。分章成块，按块读。')
  lines.push('')
  if (!picked.length) lines.push('（之前还没有带概要的章 —— 先建索引）')
  for (const c of picked) {
    lines.push('## 第 ' + c.num + ' 章 ' + (c.title || '（无题）'))
    lines.push('')
    lines.push(c.summary || '（本章索引里没有概要）')
    lines.push('')
    lines.push('〔' + (c.status || '未知') + ' · ' + (c.words || '?') + ' 字' + (c.vol ? ' · ' + c.vol : '') + '〕')
    lines.push('')
  }
  return { ok: true, chapter: stem, count: picked.length, text: lines.join('\n'), items: picked }
}

/** 生成整本书的阅读版索引（分章块），落到 index-brief.md。 */
export function writeFullBrief(novelDir) {
  const parsed = parseIndexChapters(novelDir)
  if (!parsed.ok) return parsed
  const lines = ['# 全书章概要（阅读版）', '', '> 自动从 index.yml 生成。每章一块，供人或 AI 通读。', '']
  let curVol = null
  for (const c of parsed.chapters) {
    if (c.vol && c.vol !== curVol) { curVol = c.vol; lines.push(''); lines.push('# 卷 ' + c.vol); lines.push('') }
    lines.push('## 第 ' + c.num + ' 章 ' + (c.title || '（无题）'))
    lines.push('')
    lines.push(c.summary || '（没有概要）')
    lines.push('')
    lines.push('〔' + (c.status || '?') + ' · ' + (c.words || '?') + ' 字〕')
    lines.push('')
  }
  const out = path.join(path.resolve(novelDir), 'index-brief.md')
  writeFileSync(out, lines.join('\n'), 'utf8')
  return { ok: true, rel: 'index-brief.md', chapters: parsed.total }
}
