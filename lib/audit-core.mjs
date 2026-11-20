/**
 * audit-core.mjs —— 全书体检（跨章维度，零依赖）。
 *
 * 单章门禁管「这一章像不像人写的」，本模块管「整本像不像流水线」：
 *   1) 跨章重复片段——同一 8 字片段在多章反复出现，是自我复制/套路推进；
 *   2) 人物出场分布——建了角色卡却 0 出场、或中途消失；
 *   3) 章纲兑现——章纲点名的人物，正文里根本没落地；
 *   4) 节奏——字数离群章、章末平收、连续平收；
 *   5) 逐章门禁分序列（面板画趋势线用）。
 *
 * 纯函数 + 只读文件，不写盘；报告落盘由路由/CLI 层做。
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { listDirCached, readTextCached } from './read-cache.mjs'

import { analyzeChapter } from './gate-core.mjs'

const GRAM = 8

/** 去 frontmatter（围栏内逐字节保留，只取正文）。 */
export function stripFrontmatter(text) {
  const raw = String(text ?? '')
  if (!raw.startsWith('---')) return raw
  const end = raw.indexOf('\n---', 3)
  return end === -1 ? raw : raw.slice(end + 4)
}

// 0.5.0：审计与快照共用同一份读缓存
function readText(file) {
  return readTextCached(file)
}

function listMd(dir) {
  const names = listDirCached(dir)
  if (names === null) return []
  return names.filter((name) => typeof name === 'string' && name.endsWith('.md')).sort()
}

/** 角色卡名字（frontmatter name，缺失回落文件名）。 */
function characterNames(novelDir) {
  const dir = path.join(novelDir, 'characters')
  const out = []
  for (const file of listMd(dir)) {
    const text = readText(path.join(dir, file)) ?? ''
    const head = text.startsWith('---') ? text : ''
    const m = /^name:\s*(.+)$/m.exec(head)
    const name = m ? m[1].trim().replace(/^["']|["']$/g, '') : file.replace(/\.md$/i, '')
    const dst = /^status:\s*(.+)$/m.exec(head)
    const dbt = /^debut_chapter:\s*(.+)$/m.exec(head)
    const status = dst ? dst[1].trim().replace(/^["']|["']$/g, '') : ''
    const debut = dbt ? dbt[1].trim().replace(/^["']|["']$/g, '') : ''
    if (name !== '') out.push({ file, name, status, debut })
  }
  return out
}

/** 章纲 stem → 正文。 */
function outlineTexts(novelDir) {
  const dir = path.join(novelDir, 'outlines')
  const map = new Map()
  for (const file of listMd(dir)) {
    map.set(file.replace(/\.md$/i, ''), readText(path.join(dir, file)) ?? '')
  }
  return map
}

function cjkWords(text) {
  return (String(text).match(/[\u4e00-\u9fa5]/g) || []).length
}

/**
 * 全书体检。只读；返回结构与面板/CLI 共用：
 *   { ok, generatedAt, chapters, repeats, characters, outlines, rhythm, hooks, totals }
 */
export function auditProject(novelDir) {
  const dir = path.resolve(novelDir)
  const chaptersDir = path.join(dir, 'chapters')
  const files = listMd(chaptersDir)
  const chapters = []
  const gramOwners = new Map() // gram -> { files:Set, count }
  const endings = []

  for (const file of files) {
    const raw = readText(path.join(chaptersDir, file)) ?? ''
    const body = stripFrontmatter(raw)
    if (body.trim().length < 20) {
      chapters.push({ file, words: cjkWords(body), human: null, detector: null, hook: null, empty: true })
      continue
    }
    const analyzed = analyzeChapter(body)
    const words = cjkWords(body)
    chapters.push({
      file,
      words,
      human: analyzed.score,
      detector: analyzed.detector?.score ?? null,
      hook: analyzed.hook ?? null,
      empty: false,
    })
    if (analyzed.hook && analyzed.hook.ok === false) endings.push(file)
    const norm = body.replace(/[^\u4e00-\u9fa5]/g, '')
    for (let i = 0; i + GRAM <= norm.length; i += 1) {
      const g = norm.slice(i, i + GRAM)
      let entry = gramOwners.get(g)
      if (!entry) { entry = { files: new Set(), count: 0 }; gramOwners.set(g, entry) }
      entry.files.add(file)
      entry.count += 1
    }
  }

  // 跨章重复：至少出现在 2 章，且总次数 ≥3；按「章数 × 次数」排序取前 20。
  const repeats = []
  for (const [gram, entry] of gramOwners) {
    if (entry.files.size < 2 || entry.count < 3) continue
    repeats.push({ text: gram, chapters: [...entry.files], count: entry.count })
  }
  repeats.sort((a, b) => b.chapters.length - a.chapters.length || b.count - a.count)
  // 滑动窗口会把同一句拆成一串互相重叠的 8-gram（「检测到新谣言陈磊」与
  // 「测到新谣言陈磊是」）。只要两条共享任意 6 字连续片段，就算同一条重复，
  // 保留先出现的（章数/次数更高）。
  const grams6 = (s) => {
    const set = new Set()
    for (let i = 0; i + 6 <= s.length; i += 1) set.add(s.slice(i, i + 6))
    return set
  }
  const picked = []
  for (const item of repeats) {
    const mine = grams6(item.text)
    const dup = picked.some((kept) => {
      for (const g of grams6(kept.text)) if (mine.has(g)) return true
      return false
    })
    if (!dup) picked.push(item)
    if (picked.length >= 15) break
  }
  const topRepeats = picked

  // 人物出场：全文命中次数 + 最近出场章（按章节顺序）。
  const bodies = new Map()
  for (const file of files) bodies.set(file, stripFrontmatter(readText(path.join(chaptersDir, file)) ?? ''))
  const characters = characterNames(dir).map(({ file, name, status, debut }) => {
    let total = 0
    let last = null
    for (const ch of files) {
      const body = bodies.get(ch) ?? ''
      let n = 0
      let at = body.indexOf(name)
      while (at !== -1) { n += 1; at = body.indexOf(name, at + name.length) }
      if (n > 0) { total += n; last = ch }
    }
    // 退场卡（status: retired）不算「0 出场」；有计划登场章（debut_chapter）的只标计划未到。
    const retired = status === 'retired'
    return { file, name, mentions: total, lastChapter: last, status: status || null, debut: debut || null, missing: total === 0 && !retired, planned: total === 0 && debut !== '' }
  })

  // 章纲兑现（启发式）：章纲里点名的角色，正文一句没提。
  const outlineMap = outlineTexts(dir)
  const outlines = []
  for (const ch of files) {
    const stem = ch.replace(/\.md$/i, '')
    const outline = outlineMap.get(stem)
    if (typeof outline !== 'string' || outline.trim() === '') continue
    const body = bodies.get(ch) ?? ''
    const promised = characters.filter((c) => outline.includes(c.name) && !body.includes(c.name)).map((c) => c.name)
    outlines.push({ file: ch, promised })
  }

  // 节奏：字数统计 + 离群（均值 ±1.5σ）。
  const nonEmpty = chapters.filter((c) => !c.empty)
  const wordList = nonEmpty.map((c) => c.words)
  const avgWords = wordList.length ? wordList.reduce((a, b) => a + b, 0) / wordList.length : 0
  const variance = wordList.length
    ? wordList.reduce((a, b) => a + (b - avgWords) * (b - avgWords), 0) / wordList.length
    : 0
  const sd = Math.sqrt(variance)
  const outliers = sd > 0
    ? nonEmpty.filter((c) => Math.abs(c.words - avgWords) > sd * 1.5).map((c) => ({ file: c.file, words: c.words }))
    : []

  // 连续平收：最长一段连续章末平收。
  let streak = 0
  let maxStreak = 0
  for (const ch of nonEmpty) {
    if (ch.hook && ch.hook.ok === false) { streak += 1; maxStreak = Math.max(maxStreak, streak) } else streak = 0
  }

  const hooks = { plain: endings, maxStreak, total: nonEmpty.length }
  const scores = nonEmpty.filter((c) => typeof c.human === 'number').map((c) => c.human)
  const avgHuman = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    chapters,
    repeats: topRepeats,
    characters,
    outlines: outlines.filter((o) => o.promised.length > 0),
    rhythm: {
      chapters: nonEmpty.length,
      avgWords: Math.round(avgWords),
      minWords: wordList.length ? Math.min(...wordList) : 0,
      maxWords: wordList.length ? Math.max(...wordList) : 0,
      outliers,
    },
    hooks,
    totals: {
      chapters: files.length,
      words: wordList.reduce((a, b) => a + b, 0),
      avgHuman: avgHuman === null ? null : Math.round(avgHuman * 10) / 10,
    },
  }
}

/** 体检报告 markdown（routes / CLI 落盘与 stdout 共用）。 */
export function auditMarkdown(audit, title) {
  const lines = []
  lines.push('# ' + (title || '全书') + ' · 全书体检')
  lines.push('')
  lines.push('- 生成时间：' + new Date().toISOString().slice(0, 19).replace('T', ' '))
  lines.push('- 章节：' + audit.totals.chapters + ' 章 / ' + audit.totals.words + ' 字')
  lines.push('- 平均人味：' + (audit.totals.avgHuman === null ? '—' : audit.totals.avgHuman))
  lines.push('- 章末平收：' + audit.hooks.plain.length + ' 章（最长连续 ' + audit.hooks.maxStreak + ' 章）')
  lines.push('')
  const issues = []
  for (const r of audit.repeats.slice(0, 5)) {
    issues.push('跨章重复「' + r.text + '」出现在 ' + r.chapters.length + ' 章（' + r.chapters.slice(0, 4).join('、') + '）')
  }
  for (const c of audit.characters.filter((x) => x.missing)) {
    issues.push(c.planned ? '角色「' + c.name + '」计划 ' + c.debut + ' 登场，还没出场' : '角色「' + c.name + '」建了卡但全书 0 出场')
  }
  for (const o of audit.outlines.slice(0, 8)) {
    issues.push('章纲点名但正文未落地：' + o.file + ' → ' + o.promised.join('、'))
  }
  for (const o of audit.rhythm.outliers) {
    issues.push('字数离群：' + o.file + '（' + o.words + ' 字，均 ' + audit.rhythm.avgWords + '）')
  }
  if (audit.hooks.maxStreak >= 3) issues.push('连续 ' + audit.hooks.maxStreak + ' 章平收，读者会断档')
  lines.push('## 优先处理')
  lines.push('')
  if (issues.length === 0) lines.push('没有跨章级问题。')
  else issues.forEach((text, i) => lines.push((i + 1) + '. ' + text))
  lines.push('')
  lines.push('## 跨章重复片段')
  lines.push('')
  if (audit.repeats.length === 0) lines.push('没有跨章重复片段。')
  else {
    lines.push('| 片段 | 出现章数 | 次数 |')
    lines.push('| --- | --- | --- |')
    for (const r of audit.repeats) lines.push('| ' + r.text + ' | ' + r.chapters.length + ' | ' + r.count + ' |')
  }
  lines.push('')
  lines.push('## 角色出场')
  lines.push('')
  lines.push('| 角色 | 提及 | 最近出场 | 状态 |')
  lines.push('| --- | --- | --- | --- |')
  for (const c of audit.characters) {
    const state = c.status === 'retired' ? '已退场' : (c.planned ? '计划 ' + c.debut : (c.missing ? '未出场' : '正常'))
    lines.push('| ' + c.name + ' | ' + c.mentions + ' | ' + (c.lastChapter || '—') + ' | ' + state + ' |')
  }
  lines.push('')
  lines.push('## 章末钩子')
  lines.push('')
  for (const ch of audit.chapters) {
    if (ch.empty) continue
    const kind = ch.hook ? (ch.hook.ok ? ch.hook.kind : '平收') : '—'
    lines.push('- ' + ch.file + '：' + kind)
  }
  lines.push('')
  return lines.join('\n')
}
