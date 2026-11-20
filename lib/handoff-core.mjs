/**
 * handoff-core.mjs —— 章节交接卡（0.10.0）
 *
 * 问题：写手开新章要读前章结尾、章纲、出场角色卡、活跃伏笔、时间线……为了
 * 「不漏账」把五本账全塞进上下文，贵且慢。真正需要的其实是一张「本章前提」，
 * 一百来行。这张卡由面板/CLI 从现成数据生成，写手拿一张就能开写。
 *
 * 数据来源全部是既有账本（不新增文件）：
 *   chapters/    本章标题、字数、状态、摘要、五维
 *   outlines/    章纲里的节拍与钩子（有就带上）
 *   characters/  正文提到谁（按角色卡 name 命中正文，命中即出场）
 *   foreshadows  本章埋的 / 收的 / 仍然活跃的
 *   relations    本章开始 / 结束的关系
 *   timeline     本章记的世界事件
 *   clue-board   本章出现的线索
 *   memories     本章的出场记录与承诺
 * 只读，不写任何文件。
 */

import { collectChapters, splitParagraphs, countCjk, chapterSortKey, readOutline } from './novel-parse.mjs'
import { parseStateSnapshot } from './panel-core.mjs'

const stemOf = (file) => String(file ?? '').replace(/\.md$/i, '')
const ordOf = (stem) => {
  const key = chapterSortKey(stemOf(stem))
  return key === null ? null : key.vol * 1e6 + key.num
}

/** 正文里出现过的角色（长名优先，避免「陈磊」命中「陈磊的」这类误判）。 */
function castInBody(body, characters) {
  const text = String(body ?? '')
  const hits = []
  for (const c of characters) {
    const name = String(c.name ?? '').trim()
    if (name === '') continue
    if (text.includes(name)) hits.push({ name, role: c.role, file: c.file })
  }
  return hits.sort((a, b) => b.name.length - a.name.length)
}

/** 章纲节拍 / 钩子：章纲是纯 markdown，按「- 」列表行取，标题行单独认。 */
function outlineBits(outline) {
  if (outline === null || typeof outline !== 'object') return { beats: [], hooks: [] }
  const body = String(outline.body ?? '')
  const lines = body.split(/\r?\n/)
  const beats = []
  const hooks = []
  let inHook = false
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('## ')) { inHook = /钩子/.test(line); continue }
    if (line === '') continue
    if (inHook) { if (!line.startsWith('#')) hooks.push(line.replace(/^[-*]\s*/, '')) ; continue }
    if (/^[-*]\s+/.test(line)) beats.push(line.replace(/^[-*]\s*/, ''))
  }
  return { beats, hooks }
}

/**
 * 组装交接卡数据（只读）。任何一段取不到都退化为空数组，绝不因缺账失败。
 */
export function buildHandoff(novelDir, file) {
  const safe = String(file ?? '').trim()
  if (safe === '' || safe.includes('/') || safe.includes('\\') || safe.includes('..')) {
    throw Object.assign(new Error('文件名不合法'), { statusCode: 400 })
  }
  const all = collectChapters(novelDir)
  if (all === null) throw Object.assign(new Error('找不到 chapters/ 目录'), { statusCode: 404 })
  const chapter = all.find((c) => c.file === safe)
  if (!chapter) throw Object.assign(new Error('章节不存在：' + safe), { statusCode: 404 })
  const snap = parseStateSnapshot(novelDir)
  const stem = stemOf(safe)
  const ord = ordOf(stem)
  const body = String(chapter.body ?? '')
  // 快照里的 outline 只有摘要（excerpt），节拍/钩子要读章纲原文——读不到就按无章纲处理。
  const outline = readOutline(novelDir, stem)
  const bits = outlineBits(outline)
  const characters = snap.characters || []
  const cast = castInBody(body, characters)
  const sameChapter = (ref) => stemOf(ref) === stem
  const forePlant = (snap.foreshadows || []).filter((f) => sameChapter(f.planted_chapter))
  const foreResolve = (snap.foreshadows || []).filter((f) => sameChapter(f.resolved_chapter))
  const relStart = (snap.relations || []).filter((r) => sameChapter(r.started))
  const relEnd = (snap.relations || []).filter((r) => sameChapter(r.ended))
  const events = (snap.timeline || []).filter((t) => sameChapter(t.chapter))
  const clues = (snap.clues || []).filter((c) => sameChapter(c.related_chapter))
  const memories = (snap.memories || []).filter((m) => sameChapter(m.source_chapter))
  // 活跃伏笔：本章还没收的（ord 之前埋下、之后才收或未收）
  const activeFore = (snap.foreshadows || []).filter((f) => {
    if (f.status === 'resolved' || f.status === 'abandoned') return false
    const planted = ordOf(f.planted_chapter)
    if (planted !== null && ord !== null && planted > ord) return false
    return true
  })
  const index = all.findIndex((c) => c.file === safe)
  const next = index >= 0 && index + 1 < all.length ? all[index + 1] : null
  return {
    ok: true,
    file: safe,
    stem,
    heading: chapterHeadingOf(chapter),
    title: chapter.title ?? '',
    status: chapter.status ?? '',
    words: countCjk(body),
    summary: chapter.summary ?? '',
    five: {
      cognitive_frame: chapter.cognitive_frame ?? '',
      emotional_anchor: chapter.emotional_anchor ?? '',
      world_texture: chapter.world_texture ?? '',
      suspense: chapter.suspense ?? '',
      interpersonal_tension: chapter.interpersonal_tension ?? '',
    },
    beats: bits.beats,
    hooks: bits.hooks,
    cast,
    foreshadows: { planted: forePlant, resolved: foreResolve, active: activeFore },
    relations: { started: relStart, ended: relEnd },
    events,
    clues,
    memories,
    next: next === null ? null : { file: next.file, heading: chapterHeadingOf(next) },
    tail: splitParagraphs(body).slice(-2).join('\n\n'),
  }
}

function chapterHeadingOf(chapter) {
  const num = Number.isInteger(chapter?.num) ? chapter.num : null
  const title = String(chapter?.title ?? '').trim()
  if (num !== null && title !== '') return '第' + num + '章 ' + title
  if (num !== null) return '第' + num + '章'
  return String(chapter?.stem ?? chapter?.file ?? '')
}

/** 渲染成 markdown（写手直接贴进上下文用）。 */
export function renderHandoff(model) {
  const out = []
  out.push('# 章节交接卡 · ' + model.heading)
  out.push('')
  out.push('- 文件：chapters/' + model.file)
  out.push('- 状态：' + (model.status || '—') + ' · 字数：' + model.words)
  if (model.summary) out.push('- 本章梗概：' + model.summary)
  out.push('')
  const five = model.five
  const fiveRows = [
    ['认知框架', five.cognitive_frame],
    ['情感锚点', five.emotional_anchor],
    ['世界质感', five.world_texture],
    ['悬念', five.suspense],
    ['人际张力', five.interpersonal_tension],
  ].filter((row) => String(row[1] ?? '').trim() !== '')
  if (fiveRows.length) {
    out.push('## 五维')
    for (const row of fiveRows) out.push('- ' + row[0] + '：' + row[1])
    out.push('')
  }
  if (model.beats.length) {
    out.push('## 节拍')
    for (const beat of model.beats) out.push('- ' + beat)
    out.push('')
  }
  if (model.hooks.length) {
    out.push('## 章尾钩子')
    for (const hook of model.hooks) out.push('- ' + hook)
    out.push('')
  }
  out.push('## 出场角色')
  if (model.cast.length === 0) out.push('- （正文未点名任何角色卡上的角色）')
  for (const c of model.cast) out.push('- ' + c.name + (c.role ? '（' + c.role + '）' : '') + ' · characters/' + c.file)
  out.push('')
  out.push('## 伏笔')
  if (model.foreshadows.planted.length) out.push('- 本章埋：' + model.foreshadows.planted.map((f) => f.id + ' ' + f.title).join('；'))
  if (model.foreshadows.resolved.length) out.push('- 本章收：' + model.foreshadows.resolved.map((f) => f.id + ' ' + f.title).join('；'))
  const active = model.foreshadows.active.slice(0, 12)
  if (active.length) out.push('- 仍活跃：' + active.map((f) => f.id + '（' + (f.status || '?') + '）').join('、'))
  out.push('')
  if (model.relations.started.length || model.relations.ended.length) {
    out.push('## 关系变化')
    for (const r of model.relations.started) out.push('- 起：' + r.a + ' ↔ ' + r.b + '（' + (r.type || '—') + '）')
    for (const r of model.relations.ended) out.push('- 止：' + r.a + ' ↔ ' + r.b + '（' + (r.type || '—') + '）')
    out.push('')
  }
  if (model.events.length || model.clues.length) {
    out.push('## 事件与线索')
    for (const e of model.events) out.push('- 时间线：' + (e.year || '—') + ' ' + (e.title || ''))
    for (const c of model.clues) out.push('- 线索：' + (c.content || '') + (c.kind ? '（' + c.kind + '）' : ''))
    out.push('')
  }
  if (model.memories.length) {
    out.push('## 叙事记忆')
    for (const m of model.memories.slice(0, 8)) out.push('- ' + (m.category || '') + '：' + (m.content || ''))
    out.push('')
  }
  if (model.next) {
    out.push('## 下一章')
    out.push('- ' + model.next.heading + ' · chapters/' + model.next.file)
    out.push('')
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}
