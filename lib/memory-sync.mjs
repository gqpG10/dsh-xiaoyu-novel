/**
 * memory-sync.mjs —— 3.45.0 记忆自动同步（批量回填 + 健康度 + 卷压缩）。
 *
 * 为什么要有：memory/<章>.yml 是「前情提要」的来源，写手靠它记住三章前发生了什么。
 * 手动一章一章点太慢，长篇连载（100+ 章）根本补不全，于是前面的章节就被忘了——
 * 这正是「越写越吃设定」的直接原因。
 *
 * 三个能力：
 *   1) syncMemories —— 扫全书，把缺记忆的章节补上（纯本地摘要，不调模型）
 *   2) memoryHealth —— 统计覆盖率与缺章清单
 *   3) compressRange —— 把连续 N 章压成一条「段记忆」，塞进 memory/segments/
 */

import path from 'node:path'
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { summarizeChapter } from './living-bible.mjs'

/** 列出章节文件（排序后）。 */
export function listChapters(novelDir) {
  const dir = path.join(path.resolve(novelDir), 'chapters')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => /\.md$/i.test(f) && !/\.(tmp|bak|pre-)/.test(f)).sort()
}

/** 去掉 frontmatter，只留正文。 */
function bodyOf(raw) {
  const s = String(raw || '')
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(s)
  return m ? s.slice(m[0].length) : s
}

/**
 * 批量回填缺失的记忆。
 * @param {string} novelDir
 * @param {object} opts { limit=0 只处理前 N 章, force=false 连已有的也重写 }
 */
export function syncMemories(novelDir, opts = {}) {
  const dir = path.resolve(novelDir)
  const memDir = path.join(dir, 'memory')
  try { mkdirSync(memDir, { recursive: true }) } catch { /* 已存在 */ }
  const files = listChapters(dir)
  const limit = Number(opts.limit) > 0 ? Number(opts.limit) : files.length
  const force = opts.force === true

  const written = []
  const skipped = []
  const failed = []
  for (const f of files.slice(0, limit)) {
    const stem = f.replace(/\.md$/i, '')
    const memPath = path.join(memDir, stem + '.yml')
    if (!force && existsSync(memPath)) { skipped.push(stem); continue }
    let raw = ''
    try { raw = readFileSync(path.join(dir, 'chapters', f), 'utf8') } catch (e) {
      failed.push({ file: f, error: String(e && e.message ? e.message : e) })
      continue
    }
    const body = bodyOf(raw)
    const s = summarizeChapter(body)
    if (!s.ok) { failed.push({ file: f, error: s.error || '空章' }); continue }
    try {
      writeFileSync(memPath, s.summary, 'utf8')
      written.push(stem)
    } catch (e) {
      failed.push({ file: f, error: String(e && e.message ? e.message : e) })
    }
  }
  return {
    ok: true,
    total: files.length,
    written: written.length,
    skipped: skipped.length,
    failed: failed.length,
    writtenList: written.slice(0, 20),
    failedList: failed.slice(0, 10),
    summary: '共 ' + files.length + ' 章：新写 ' + written.length + '，已有跳过 ' + skipped.length + '，失败 ' + failed.length,
  }
}

/** 记忆健康度：覆盖率与缺章清单。 */
export function memoryHealth(novelDir) {
  const dir = path.resolve(novelDir)
  const memDir = path.join(dir, 'memory')
  const files = listChapters(dir)
  const missing = []
  let have = 0
  for (const f of files) {
    const stem = f.replace(/\.md$/i, '')
    if (existsSync(path.join(memDir, stem + '.yml'))) have += 1
    else missing.push(stem)
  }
  const ratio = files.length ? +(have / files.length).toFixed(3) : 0
  return {
    ok: true,
    total: files.length,
    withMemory: have,
    missing: missing.length,
    missingList: missing.slice(0, 30),
    ratio,
    ratioPct: +(ratio * 100).toFixed(1),
    summary: files.length
      ? '记忆覆盖 ' + (ratio * 100).toFixed(1) + '%（' + have + '/' + files.length + ' 章）' + (missing.length ? '，缺 ' + missing.length + ' 章' : '')
      : '没有章节',
  }
}

/**
 * 把一段连续的章节压成一条段记忆。
 * @param {string} novelDir
 * @param {object} opts { from='v01-c001', to='v01-c005', name? }
 */
export function compressRange(novelDir, opts = {}) {
  const dir = path.resolve(novelDir)
  const files = listChapters(dir)
  const from = String(opts.from || '').replace(/\.md$/i, '')
  const to = String(opts.to || '').replace(/\.md$/i, '')
  const stems = files.map((f) => f.replace(/\.md$/i, ''))
  const i0 = stems.indexOf(from)
  const i1 = stems.indexOf(to)
  if (i0 < 0 || i1 < 0 || i1 < i0) return { ok: false, error: '区间无效：' + from + ' → ' + to }
  const picked = files.slice(i0, i1 + 1)
  if (picked.length < 2) return { ok: false, error: '区间至少要有 2 章' }

  const rows = []
  for (const f of picked) {
    const stem = f.replace(/\.md$/i, '')
    let raw = ''
    try { raw = readFileSync(path.join(dir, 'chapters', f), 'utf8') } catch { continue }
    const s = summarizeChapter(bodyOf(raw))
    if (s.ok) rows.push({ stem, summary: s.summary, chars: s.chars })
  }
  if (!rows.length) return { ok: false, error: '区间内没有可读章节' }

  const segDir = path.join(dir, 'memory', 'segments')
  try { mkdirSync(segDir, { recursive: true }) } catch { /* 已存在 */ }
  const name = String(opts.name || (from + '_' + to)).replace(/[^\w\-]/g, '_')
  const text = [
    '# 段记忆 ' + from + ' → ' + to + '（' + rows.length + ' 章）',
    '',
    ...rows.map((r) => '## ' + r.stem + '（' + r.chars + ' 字）\n' + r.summary),
    '',
  ].join('\n')
  const p = path.join(segDir, name + '.yml')
  try { writeFileSync(p, text, 'utf8') } catch (e) {
    return { ok: false, error: '写入失败：' + (e && e.message ? e.message : String(e)) }
  }
  return { ok: true, path: p, rel: 'memory/segments/' + name + '.yml', chapters: rows.length, chars: text.length, summary: '已压缩 ' + rows.length + ' 章为一条段记忆' }
}

export function summarizeMemory(r) {
  if (!r || r.ok === false) return r && r.error ? r.error : '未同步'
  return r.summary
}
