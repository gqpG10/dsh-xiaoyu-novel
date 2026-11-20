/**
 * relations-tools.mjs —— 关系起始章补全（0.10.0）
 *
 * 现场痛点：25 条关系里 13 条没写 started，按章过滤时它们永远在场（宁可多画
 * 不可错藏），关系图因此看不出「这段关系是第几章开始的」。人工补 13 条又烦。
 *
 * 做法：以正文为唯一证据——两端角色名第一次同时出现在同一章，就是这段关系
 * 最早的可见起点。只提议，不直接改；写回时逐行手术（保留注释与字段顺序），
 * 写前备份、写后校验仍是合法顶层数组。
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { collectChapters, splitFrontmatter, parseFlatYamlArray } from './novel-parse.mjs'

const stemOf = (file) => String(file ?? '').replace(/\.md$/i, '')

/** 读 relations.yml 原始条目（保留文件文本，供逐行手术）。 */
function readRaw(novelDir) {
  const file = path.join(novelDir, 'relations.yml')
  const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const entries = []
  const lines = text.split(/\r?\n/)
  let current = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^-\s+/.test(line)) {
      current = { start: i, end: lines.length - 1, a: null, b: null, started: null, startedLine: null }
      entries.push(current)
      // 条目首行自带一个键（- a: slug）：去掉「- 」再按普通键值解析一次，
      // 否则 a 永远是 null、整份提议直接空转（0.10.0 现场踩到）。
      const head = /^-\s+([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
      if (head !== null) {
        const hk = head[1]
        const hv = head[2].trim().replace(/^['"]|['"]$/g, '')
        if (hk === 'a') current.a = hv
        else if (hk === 'b') current.b = hv
        else if (hk === 'started') { current.started = hv; current.startedLine = i }
      }
    }
    if (current === null) continue
    const m = /^\s*([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (m === null) continue
    const key = m[1]
    const value = m[2].trim().replace(/^['\"]|['\"]$/g, '')
    if (key === 'a') current.a = value
    else if (key === 'b') current.b = value
    else if (key === 'started') { current.started = value; current.startedLine = i }
  }
  for (let k = 0; k < entries.length - 1; k++) entries[k].end = entries[k + 1].start - 1
  return { file, text, lines, entries }
}

/**
 * 提议补全：返回 [{index, a, b, type, chapter, evidence}]。
 * 两端名字在正文里同章出现即算起点；找不到的给 chapter:null 与原因，不猜。
 */

/** 读 characters/ 下每张卡的 slug 与 name（frontmatter 的 name，缺省回落 slug）。 */
function readCharacters(novelDir) {
  const dir = path.join(novelDir, 'characters')
  let files = []
  try { files = readdirSync(dir).filter((f) => /\.md$/i.test(f)) } catch { files = [] }
  return files.map((file) => {
    let name = stemOf(file)
    try {
      const front = splitFrontmatter(readFileSync(path.join(dir, file), 'utf8')).raw ?? ''
      const m = /^name:\s*(.+)$/m.exec(front)
      if (m !== null) name = m[1].trim().replace(/^['"]|['"]$/g, '')
    } catch { /* 读不动就用 slug */ }
    return { file, name }
  })
}

export function proposeRelationStarts(novelDir, options = {}) {
  const raw = readRaw(novelDir)
  const chapters = collectChapters(novelDir) ?? []
  const chars = options.characters ?? readCharacters(novelDir)
  const nameBySlug = Object.create(null)
  for (const c of chars) {
    const slug = stemOf(c.file)
    nameBySlug[slug] = String(c.name ?? slug)
  }
  const display = (ref) => nameBySlug[ref] || ref
  const proposals = []
  raw.entries.forEach((entry, index) => {
    if (entry.a === null || entry.b === null) return
    if (entry.started !== null && entry.started !== '') return
    const aName = display(entry.a)
    const bName = display(entry.b)
    let found = null
    let evidence = 'co-appear'
    for (const ch of chapters) {
      const body = String(ch.body ?? '')
      if (body.includes(aName) && body.includes(bName)) { found = ch; break }
    }
    // 两人从未同章：退一步用「后出现那一方首次登场」的章——关系从这一刻
    // 起才可能被读者看见。这条是推断，标注出来由作者决定收不收。
    if (found === null) {
      const firstOf = (name) => {
        for (const ch of chapters) if (String(ch.body ?? '').includes(name)) return ch
        return null
      }
      const fa = firstOf(aName)
      const fb = firstOf(bName)
      if (fa !== null && fb !== null) {
        found = fa.index >= fb.index ? fa : fb
        evidence = 'second-first-appear'
      }
    }
    proposals.push({
      index,
      a: entry.a,
      b: entry.b,
      aName,
      bName,
      chapter: found === null ? null : found.file.replace(/\.md$/i, ''),
      evidence: found === null ? null : evidence,
      reason: found === null ? '两人在本章之前都还没出场（关系或许尚未开始）' : (evidence === 'co-appear' ? null : '两人尚未同章，按后出场者首次登场推断'),
    })
  })
  return { ok: true, proposals, missing: proposals.filter((p) => p.chapter === null).length }
}

/**
 * 写回：只改 started 为空的条目，逐行替换 started 的值（保留注释/顺序/缩进）。
 * 写前备份 relations.yml.bak，写后重新解析校验形状。
 */
export function applyRelationStarts(novelDir, patches) {
  const list = Array.isArray(patches) ? patches : []
  if (list.length === 0) return { ok: true, applied: 0, skipped: 0 }
  const raw = readRaw(novelDir)
  const byIndex = new Map()
  for (const p of list) {
    const i = Number(p.index)
    const chapter = String(p.chapter ?? '').trim()
    if (!Number.isInteger(i) || !/^v\d+-c\d+$/.test(chapter)) continue
    byIndex.set(i, chapter)
  }
  let applied = 0
  let skipped = 0
  const lines = raw.lines.slice()
  raw.entries.forEach((entry, index) => {
    const chapter = byIndex.get(index)
    if (chapter === undefined) return
    if (entry.started !== null && entry.started !== '') { skipped += 1; return }
    if (entry.startedLine !== null) {
      const original = lines[entry.startedLine]
      const indent = /^\s*/.exec(original)[0]
      lines[entry.startedLine] = indent + 'started: ' + chapter
      applied += 1
      return
    }
    // 条目里压根没有 started 行：插在 b 行之后（找不到就在条目末尾）
    const insertAt = entry.end + 1
    lines.splice(insertAt, 0, '  started: ' + chapter)
    applied += 1
  })
  if (applied === 0) return { ok: true, applied: 0, skipped }
  const text = lines.join('\n')
  const parsed = parseFlatYamlArray(text)
  if (!Array.isArray(parsed)) return { ok: false, error: '补全后不像合法条目数组，已放弃写入' }
  const backup = raw.file + '.bak'
  try { copyFileSync(raw.file, backup) } catch { /* 备份失败仍继续：git 是第二道网 */ }
  writeFileSync(raw.file, text.endsWith('\n') ? text : text + '\n', 'utf8')
  return { ok: true, applied, skipped, backup: path.basename(backup) }
}
