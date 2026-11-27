/**
 * volume-lines.mjs —— 3.44.0 卷纲四线字段校验 + 按卷爽点密度。
 *
 * 方案要求「全书总纲四条线并行规划：主线+副线+感情线+伏笔回收线」。
 * 现有 volumes.yml 只有 title/summary/chapters，没有结构化四线字段，
 * 于是「这一卷哪条线该推进」无法被校验——后期崩剧情多半从这里开始。
 *
 * 本模块：
 *   1) 校验每卷是否填了四条线的规划（可选开启，缺了报 missing）
 *   2) 按卷区间统计爽点密度（结合 pacing-core 的 payoffDensity）
 */

import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { payoffDensity } from './pacing-core.mjs'

/** 卷纲要求的四线字段。 */
export const VOLUME_LINE_FIELDS = ['main_line', 'sub_line', 'romance_line', 'foreshadow_line']

/** 卷纲字段中文名。 */
export const VOLUME_LINE_LABELS = {
  main_line: '主线',
  sub_line: '副线',
  romance_line: '感情线',
  foreshadow_line: '伏笔回收线',
}

/**
 * 解析 volumes.yml（支持 - id / title / summary / chapters / 四线字段）。
 * chapters 支持 "001-025" 或 "v01-c001-v01-c025"。
 */
export function parseVolumes(raw) {
  const out = []
  let cur = null
  for (const line of String(raw || '').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const mItem = /^\s*-\s+(\w+)\s*:\s*(.*)$/.exec(line)
    if (mItem) {
      if (cur) out.push(cur)
      cur = { [mItem[1]]: mItem[2].trim() }
      continue
    }
    const mKey = /^\s+(\w+)\s*:\s*(.*)$/.exec(line)
    if (mKey && cur) cur[mKey[1]] = mKey[2].trim()
  }
  if (cur) out.push(cur)
  return out
}

/** 把 "001-025" 或 "v01-c026-v01-c052" 解析成 [起始, 结束] 的章号。 */
export function parseChapterRange(spec, volumeId) {
  const s = String(spec || '').trim()
  if (!s) return null
  let m = /^(\d{1,4})\s*[-~]\s*(\d{1,4})$/.exec(s)
  if (m) return [Number(m[1]), Number(m[2])]
  m = /v?(\d+)[-_]?c(\d+)\s*[-~]\s*v?(\d+)[-_]?c(\d+)/i.exec(s)
  if (m) return [Number(m[2]), Number(m[4])]
  const single = /^(\d{1,4})$/.exec(s)
  if (single) return [Number(single[1]), Number(single[1])]
  // 退而求其次：从卷号推
  const vid = Number(String(volumeId || '').replace(/\D/g, ''))
  if (vid > 0) return null
  return null
}

/** 从章节文件名抽 (卷号, 章号)。 */
export function parseChapterName(file) {
  const m = /v(\d+)[-_]?c(\d+)/i.exec(String(file || ''))
  if (m) return { vol: Number(m[1]), num: Number(m[2]) }
  const m2 = /c(\d+)/i.exec(String(file || ''))
  if (m2) return { vol: null, num: Number(m2[1]) }
  return null
}

/**
 * 主入口：卷纲四线校验 + 每卷爽点密度。
 * @param {string} novelDir
 * @param {Array<{file:string,text:string}>} chapters 已按序排好
 * @param {object} opts { requireLines = false }
 */
export function auditVolumes(novelDir, chapters, opts = {}) {
  const requireLines = !!opts.requireLines
  const dir = path.resolve(novelDir)
  const p = path.join(dir, 'volumes.yml')
  if (!existsSync(p)) return { ok: true, volumes: [], issues: [], summary: '没有 volumes.yml，跳过卷纲审查' }
  let raw = ''
  try { raw = readFileSync(p, 'utf8') } catch (e) {
    return { ok: false, error: '读不了 volumes.yml：' + (e && e.message ? e.message : String(e)) }
  }
  const vols = parseVolumes(raw)
  const issues = []
  const out = []

  for (const v of vols) {
    const id = v.id || '(无 id)'
    const missingLines = VOLUME_LINE_FIELDS.filter((f) => !String(v[f] || '').trim())
    if (requireLines && missingLines.length) {
      issues.push({
        kind: 'lines_missing',
        severity: 'normal',
        volume: id,
        message: '卷 ' + id + ' 缺 ' + missingLines.length + ' 条线规划：' + missingLines.map((f) => VOLUME_LINE_LABELS[f] || f).join('、'),
        missing: missingLines,
      })
    }

    // 本卷章节区间
    const range = parseChapterRange(v.chapters, id)
    let picked = []
    if (range) {
      picked = (chapters || []).filter((c) => {
        const n = parseChapterName(c.file)
        if (!n) return false
        // 优先按章号比较（同卷内），跨卷时用 卷*10000+章
        const order = n.vol != null ? n.vol * 10000 + n.num : n.num
        const lo = range[0] < 10000 ? range[0] : range[0]
        const hi = range[1] < 10000 ? range[1] : range[1]
        const ordLo = range[0] < 10000 ? lo : lo
        return order >= (n.vol != null ? n.vol * 10000 + lo : lo) && order <= (n.vol != null ? n.vol * 10000 + hi : hi)
      })
    }
    // 区间解析失败时退回按卷号匹配
    if (!picked.length) {
      const vid = Number(String(id).replace(/\D/g, ''))
      if (vid > 0) picked = (chapters || []).filter((c) => { const n = parseChapterName(c.file); return n && n.vol === vid })
    }

    const pay = picked.length ? payoffDensity(picked, { maxGap: 4 }) : null
    if (pay && pay.maxGap > 4) {
      issues.push({
        kind: 'payoff_gap', severity: 'normal', volume: id,
        message: '卷 ' + id + ' 有 ' + pay.maxGap + ' 章连续没有爽点（到 ' + pay.maxGapEnd + '）',
        maxGap: pay.maxGap, maxGapEnd: pay.maxGapEnd,
      })
    }
    out.push({
      id,
      title: v.title || '',
      chapters: v.chapters || '',
      chapterCount: picked.length,
      lines: VOLUME_LINE_FIELDS.reduce((acc, f) => { acc[f] = String(v[f] || '').trim(); return acc }, {}),
      missingLines,
      payoff: pay ? { densityPct: pay.densityPct, withPayoff: pay.withPayoff, total: pay.total, maxGap: pay.maxGap, maxGapEnd: pay.maxGapEnd } : null,
    })
  }

  return {
    ok: issues.length === 0,
    volumes: out,
    issues,
    summary: issues.length
      ? out.length + ' 卷，' + issues.length + ' 项问题（' + (requireLines ? '含四线缺项' : '不含四线缺项') + '）'
      : out.length + ' 卷，全部合规',
  }
}

export function summarizeVolumes(r) {
  if (!r || r.ok === false) return r && r.error ? r.error : '未审查'
  return r.summary
}
