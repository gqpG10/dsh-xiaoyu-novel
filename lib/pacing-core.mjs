/**
 * pacing-core.mjs —— 3.43.0 节奏可视化（四线并行 × 爽点密度）。
 *
 * 两个模块：
 *   A) checkFourLines —— 对每个单元（章）统计四条线的推进：
 *        main（主线）/ sub（支线）/ romance（感情线）/ foreshadow（伏笔线）
 *        四条线靠「关键词命中」粗判：项目在项目目录放 four_lines.yml 定义每线的信号词，
 *        没有就用内置默认词表。哪条线连续 N 章无推进就报警——这就是「后期崩剧情」的早期信号。
 *   B) payoffDensity —— 爽点密度：统计章纲 payoff（或正文）里的爽点标记，
 *        给出每卷/全书的密度与「连续 N 章无爽点」的空窗。
 *
 * 零依赖：纯读 + 算。
 */

import path from 'node:path'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

/** 评测用的内置默认信号词（项目可用 four_lines.yml 覆盖）。 */
export const DEFAULT_FOUR_LINES = {
  main: ['主线', '目标', '追查', '拿到', '拿下', '揭穿', '翻盘', '大高潮'],
  sub: ['支线', '顺手', '顺带', '另一头', '隔壁', '旁支'],
  romance: ['感情', '喜欢', '心动', '脸红', '牵手', '并肩', '她看', '他看'],
  foreshadow: ['伏笔', '埋下', '暗示', '线索', '那个', '还记着', '没说完', '以后'],
}

/** 爽点词（章纲 payoff 或正文里命中即算一次爽点）。 */
const PAYOFF_SIGNALS = [
  '打脸', '反转', '升级', '逆袭', '碾压', '翻盘', '揭穿', '认账', '当场',
  '赢', '爽', '爆', '夺回', '夺走', '拿下', '收回', '报了', '赢了', '赚了',
]

/** 极简 YAML：读 four_lines.yml（line: [词, 词] 或 line: 词）。 */
export function loadFourLines(novelDir) {
  const p = path.join(path.resolve(novelDir), 'four_lines.yml')
  if (!existsSync(p)) return { ...DEFAULT_FOUR_LINES }
  try {
    const raw = readFileSync(p, 'utf8')
    const out = {}
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*(\w+)\s*:\s*(.+)$/.exec(line)
      if (!m) continue
      const v = m[2].trim()
      out[m[1]] = /^\[.*\]$/.test(v)
        ? v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
        : v.split(/[，,、\s]+/).filter(Boolean)
    }
    return Object.keys(out).length ? { ...DEFAULT_FOUR_LINES, ...out } : { ...DEFAULT_FOUR_LINES }
  } catch { return { ...DEFAULT_FOUR_LINES } }
}

/** 一章文本命中哪几条线。 */
export function detectLines(text, fourLines) {
  const cfg = fourLines || DEFAULT_FOUR_LINES
  const hit = {}
  for (const key of Object.keys(cfg)) {
    const words = Array.isArray(cfg[key]) ? cfg[key] : []
    hit[key] = words.filter((w) => w && String(text).includes(w)).length
  }
  return hit
}

/**
 * 四线并行校验：找出「连续 N 章无推进」的线。
 * @param {Array<{file:string, text:string}>} chapters 按章序排好
 * @param {object} fourLines
 * @param {object} opts { gap = 5 }
 */
export function checkFourLines(chapters, fourLines, opts = {}) {
  const gap = Number(opts.gap) > 0 ? Number(opts.gap) : 5
  const cfg = fourLines || DEFAULT_FOUR_LINES
  const keys = Object.keys(cfg)
  const rows = []
  let cursorRow = {}
  for (const k of keys) cursorRow[k] = { since: null, length: 0 }
  const gaps = []

  for (let i = 0; i < (chapters || []).length; i++) {
    const c = chapters[i]
    const hit = detectLines(c.text || '', cfg)
    rows.push({ file: c.file, hit })
    for (const k of keys) {
      if (hit[k] > 0) { cursorRow[k] = { since: null, length: 0 } }
      else {
        if (!cursorRow[k].since) cursorRow[k].since = c.file
        cursorRow[k].length += 1
        if (cursorRow[k].length === gap) {
          gaps.push({
            line: k,
            from: cursorRow[k].since,
            to: c.file,
            length: gap,
            message: '「' + k + '」线连续 ' + gap + ' 章没有推进（' + cursorRow[k].since + ' → ' + c.file + '）',
          })
        }
      }
    }
  }
  const lineStats = keys.map((k) => {
    const hit = rows.filter((r) => r.hit[k] > 0).length
    return { line: k, chaptersWithSignal: hit, ratio: rows.length ? +(hit / rows.length).toFixed(2) : 0 }
  })
  return { ok: gaps.length === 0, chapters: rows.length, lineStats, gaps, summary: gaps.length ? gaps.length + ' 段四线断流' : '四线推进正常' }
}

/** 爽点密度：逐章判有无爽点，算全卷密度与最大空窗。 */
export function payoffDensity(entries, opts = {}) {
  const maxGapWarn = Number(opts.maxGap) > 0 ? Number(opts.maxGap) : 4
  const rows = (entries || []).map((e) => {
    const text = String(e.text || '')
    const hits = PAYOFF_SIGNALS.filter((w) => text.includes(w))
    return { file: e.file, hit: hits.length, words: hits.slice(0, 4) }
  })
  const total = rows.length
  const withPayoff = rows.filter((r) => r.hit > 0).length
  const density = total ? +(withPayoff / total).toFixed(2) : 0

  // 最大空窗
  let gap = 0
  let maxGap = 0
  let gapEnd = null
  let maxGapEnd = null
  for (const r of rows) {
    if (r.hit > 0) { gap = 0; gapEnd = null }
    else { gap += 1; gapEnd = r.file; if (gap > maxGap) { maxGap = gap; maxGapEnd = gapEnd } }
  }
  return {
    ok: maxGap <= maxGapWarn,
    total,
    withPayoff,
    density,
    densityPct: +(density * 100).toFixed(1),
    maxGap,
    maxGapEnd,
    rows,
    summary: total
      ? '爽点密度 ' + (density * 100).toFixed(1) + '%（' + withPayoff + '/' + total + ' 章），最长空窗 ' + maxGap + ' 章' + (maxGapEnd ? '（到 ' + maxGapEnd + '）' : '')
      : '没有章节可统计',
  }
}

export function summarizePacing(four, payoff) {
  const parts = []
  if (four) parts.push(four.summary)
  if (payoff) parts.push(payoff.summary)
  return parts.join(' · ') || '未统计'
}
