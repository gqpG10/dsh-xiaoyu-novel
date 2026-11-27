/**
 * memory-chain.mjs —— 3.51.0 前情提要链。
 *
 * 单章记忆（memory/<章>.yml）解决「这一章写了什么」；
 * 前情提要链解决「写下一章时该知道前面发生了什么」。
 *
 * 三层：
 *   L1 最近 3 章逐章摘要（写下一章的直接上下文）
 *   L2 最近 10 章滚动摘要（中程记忆，防止「三章前刚说过」被忘）
 *   L3 已压缩段记忆（memory/segments/*.yml，长程回溯）
 *
 * 每次「章节完成」后自动重建 chain-<目标章>.yml，写手读这一个文件就够。
 */

import path from 'node:path'
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { makeSummarizer } from './memory-summary.mjs'

/** 读单章记忆原文（没有返回 null）。 */
export function readChapterMemory(novelDir, stem) {
  const p = path.join(path.resolve(novelDir), 'memory', stem + '.yml')
  if (!existsSync(p)) return null
  try { return readFileSync(p, 'utf8').trim() } catch { return null }
}

/** 列出已压缩的段记忆（文件名里带区间）。 */
export function listSegments(novelDir) {
  const dir = path.join(path.resolve(novelDir), 'memory', 'segments')
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir).filter((f) => /\.yml$/i.test(f)).sort().map((f) => ({
      file: f,
      text: readFileSync(path.join(dir, f), 'utf8'),
    }))
  } catch { return [] }
}

/**
 * 从章节序列里取「目标章之前」的最近 N 章。
 * @param {string[]} allStems 已排序的全部章名
 * @param {string} targetStem 目标章
 * @param {number} n 取几章
 */
export function prevStems(allStems, targetStem, n) {
  const i = allStems.indexOf(targetStem)
  if (i < 0) return []
  const from = Math.max(0, i - n)
  return allStems.slice(from, i)
}

/** 把若干章摘要拼成一段。 */
function joinMemories(stems, novelDir) {
  const rows = []
  for (const s of stems) {
    const m = readChapterMemory(novelDir, s)
    if (m) rows.push('### ' + s + '\n' + m)
  }
  return rows
}

/**
 * 构建某一章的前情提要链。
 * @param {string} novelDir
 * @param {string} targetStem 要写的那一章（不含 .md）
 * @param {object} opts { nearCount=3, midCount=10, segments=2 }
 * @returns {{ok:boolean, rel?:string, text?:string, chapters?:object, error?:string}}
 */
export function buildChain(novelDir, targetStem, opts = {}) {
  const dir = path.resolve(novelDir)
  const nearCount = Number(opts.nearCount) > 0 ? Number(opts.nearCount) : 3
  const midCount = Number(opts.midCount) > 0 ? Number(opts.midCount) : 10
  const segCount = Number(opts.segments) >= 0 ? Number(opts.segments) : 2

  const chDir = path.join(dir, 'chapters')
  if (!existsSync(chDir)) return { ok: false, error: '没有 chapters 目录' }
  const allStems = readdirSync(chDir)
    .filter((f) => /\.md$/i.test(f) && !/\.(bak|pre-)/.test(f))
    .sort()
    .map((f) => f.replace(/\.md$/i, ''))

  const near = prevStems(allStems, targetStem, nearCount)
  const mid = prevStems(allStems, targetStem, midCount)
  const nearRows = joinMemories(near, dir)
  const midRows = joinMemories(mid, dir)
  // 中程里去掉已包含在近程里的那些
  const nearSet = new Set(near)
  const midOnly = midRows.filter((r) => { const s = r.slice(4).split('\n')[0]; return !nearSet.has(s) })

  const segs = segCount > 0 ? listSegments(dir).slice(-segCount) : []

  const parts = []
  parts.push('# 前情提要 · 写 ' + targetStem + ' 之前必读')
  parts.push('')
  parts.push('> 自动生成，章节完成后更新。近 3 章细读、10 章看脉络、段记忆回溯更早。')
  parts.push('')
  if (nearRows.length) {
    parts.push('## 最近 ' + nearRows.length + ' 章（逐章摘要）')
    parts.push('')
    parts.push(...nearRows.join('\n\n').split('\n'))
    parts.push('')
  } else {
    parts.push('## 最近 3 章')
    parts.push('')
    parts.push('（还没有前情记忆——先跑一次「批量回填缺失记忆」）')
    parts.push('')
  }
  if (midOnly.length) {
    parts.push('## 近 ' + midCount + ' 章脉络（较早部分）')
    parts.push('')
    parts.push(...midOnly.join('\n\n').split('\n'))
    parts.push('')
  }
  if (segs.length) {
    parts.push('## 长程段记忆（已压缩）')
    parts.push('')
    for (const s of segs) {
      parts.push('### ' + s.file.replace(/\.yml$/i, ''))
      // 段记忆本身是多章拼接，去掉它的一级标题避免层级混乱
      parts.push(s.text.split(/\r?\n/).filter((l) => !/^# /.test(l)).join('\n').trim())
      parts.push('')
    }
  }

  const text = parts.join('\n')
  const memDir = path.join(dir, 'memory')
  try { mkdirSync(memDir, { recursive: true }) } catch { /* 已存在 */ }
  const rel = 'memory/chain-' + targetStem + '.yml'
  try {
    writeFileSync(path.join(dir, rel), text, 'utf8')
  } catch (e) {
    return { ok: false, error: '写链失败：' + (e && e.message ? e.message : String(e)) }
  }
  return {
    ok: true,
    rel,
    text,
    chapters: { near: near.length, mid: mid.length, segments: segs.length },
    summary: '前情链已更新：近 ' + near.length + ' 章 + 脉 ' + midOnly.length + ' 段 + 段记忆 ' + segs.length + ' 条',
  }
}

/**
 * 章节完成后的一体化动作：补该章记忆 + 重建下一章的前情链。
 * @param {string} novelDir
 * @param {string} stem 刚完成的章
 * @param {object} deps { summarizeChapter } 传入 living-bible 的纯函数摘要器
 */
export function afterChapterDone(novelDir, stem, deps = {}) {
  const dir = path.resolve(novelDir)
  const out = { ok: true, memory: null, chain: null, error: null }
  // ① 补该章记忆（缺就写）
  const memPath = path.join(dir, 'memory', stem + '.yml')
  if (!existsSync(memPath)) {
    try {
      const raw = readFileSync(path.join(dir, 'chapters', stem + '.md'), 'utf8')
      const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
      // 3.51.0 默认用加强摘要（人物/场景/事件/台词/强度/钩子）；
      // 外部传 summarizeChapter 时优先用传入的（测试/回退场景）。
      const fn = deps.summarizeChapter || makeSummarizer(dir)
      if (typeof fn === 'function') {
        const s = fn(body)
        if (s && s.ok) {
          mkdirSync(path.join(dir, 'memory'), { recursive: true })
          writeFileSync(memPath, s.summary, 'utf8')
          out.memory = { ok: true, created: true }
        } else out.memory = { ok: false, error: (s && s.error) || '摘要失败' }
      } else out.memory = { ok: false, error: '没有摘要器' }
    } catch (e) {
      out.memory = { ok: false, error: String((e && e.message) || e) }
    }
  } else out.memory = { ok: true, created: false }

  // ② 重建「下一章」的前情链
  try {
    const chDir = path.join(dir, 'chapters')
    const all = readdirSync(chDir).filter((f) => /\.md$/i.test(f) && !/\.(bak|pre-)/.test(f)).sort().map((f) => f.replace(/\.md$/i, ''))
    const i = all.indexOf(stem)
    const next = i >= 0 && i + 1 < all.length ? all[i + 1] : stem
    const chain = buildChain(dir, next)
    out.chain = chain.ok ? { ok: true, rel: chain.rel, summary: chain.summary } : { ok: false, error: chain.error }
  } catch (e) {
    out.chain = { ok: false, error: String((e && e.message) || e) }
  }

  out.summary = '记忆 ' + (out.memory && out.memory.ok ? (out.memory.created ? '已生成' : '已存在') : '失败') +
    ' · 前情链 ' + (out.chain && out.chain.ok ? '已更新' : '失败')
  return out
}
