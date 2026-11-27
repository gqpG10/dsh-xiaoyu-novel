/**
 * cross-chapter.mjs —— 3.46.0 跨章检测（单章检测抓不到的那类问题）。
 *
 * 为什么必须有它：现有所有检测器只看一章。但「百万字越写越像」的毛病只在章与章
 * 之间才看得见：
 *   ① 同一个比喻/意象在 30 章里用了 7 次（「他抹了一把」「指节敲桌子」）
 *   ② 节奏曲线长期平直（每章都是开头叙述-中段推进-结尾留悬念）
 *   ③ 某个角色 40 章没露面
 *
 * 三个检测都是纯统计，不调模型。
 */

import path from 'node:path'

/** 中文虚字（判断片段像不像实词短语用）。 */
const FUNCTION_CHARS = /[的了把着是在和与就都也还又被给让从向对为以过吗呢吧啊呀么之其而且但所以]/
const looksLikePhrase = (w) => {
  if (!w || w.length < 4 || w.length > 8) return false
  for (let i = 1; i < w.length; i++) if (FUNCTION_CHARS.test(w[i])) return false
  return true
}

/**
 * ① 跨章重复意象：4~8 字片段在**不同章节**里重复出现。
 * @param {Array<{file:string,text:string}>} chapters
 * @param {object} opts { minChapters=4, maxItems=20 }
 */
export function detectRepeatedImagery(chapters, opts = {}) {
  const minChapters = Number(opts.minChapters) > 0 ? Number(opts.minChapters) : 4
  const maxItems = Number(opts.maxItems) > 0 ? Number(opts.maxItems) : 20
  /** 片段 → 出现过的章节集合 */
  const seen = new Map()
  // 剥 frontmatter：否则「---」分隔符会混进短语，切出「---回周家坝」这种脏结果
  const stripFm = (s) => String(s || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
  for (const c of chapters || []) {
    const text = stripFm(c.text).replace(/\s/g, '')
    const local = new Set()
    for (let len = 4; len <= 8; len++) {
      for (let i = 0; i + len <= text.length; i++) {
        const w = text.slice(i, i + len)
        if (!looksLikePhrase(w)) continue
        if (local.has(w)) continue
        local.add(w)
        if (!seen.has(w)) seen.set(w, new Set())
        seen.get(w).add(c.file)
      }
    }
  }
  // 实词密度打分（3.46.0 修正）：
  // 虚词（了/的/着/是/一/个/时/候）天然覆盖章数最高，按覆盖数排序会被它们全占坑。
  // 真正有价值的意象是「实词多、又够长」——用这个当权重，覆盖章数只作参考。
  const FUNC = /[的了把着是在和与就都也还又被给让从向对为以过吗呢吧啊呀么之其而且但所以一个时侯候儿些些]/
  const START_FUNC = /^[的了把着是在和与就都也还又被给让从向对为以过吗呢吧啊呀么之其而且但所]/
  const hits = []
  for (const [w, files] of seen) {
    if (files.size < minChapters) continue
    if (START_FUNC.test(w)) continue            // 虚字开头：语法碎片
    let solid = 0
    for (const ch of w) if (!FUNC.test(ch)) solid += 1
    if (solid / w.length < 0.6) continue        // 实词占比太低：口水片段
    hits.push({
      phrase: w,
      chapters: files.size,
      sample: Array.from(files).slice(0, 5),
      score: +(solid * 1.5 + (solid / w.length) * 8 + Math.min(files.size, 20) * 0.15).toFixed(2),
    })
  }
  hits.sort((a, b) => b.score - a.score)
  // 去重叠（3.46.0 修正）：同一句话会切出多个滑窗（「光落回肩上，缩成」「落回肩上，缩成一」
  // 「回肩上，缩成一点」是同一个句子的三段）。做法：按章数降序，若候选是已保留条目的
  // 子串或超串、且章数相差不超过 2，视为同一条，丢掉。
  const kept = []
  const sorted = hits.slice().sort((a, b) => b.score - a.score)
  // 同句滑窗归一化：a 与 b 若互为子串、或有 4 字以上重叠且长度相近，
  // 视为同一个句子的两个切片 —— 只保留覆盖更广、文本更长的那个。
  const overlapLen = (a, b) => {
    const max = Math.min(a.length, b.length)
    for (let k = max; k >= 4; k--) {
      for (let i = 0; i + k <= a.length; i++) {
        const seg = a.slice(i, i + k)
        if (b.includes(seg)) return k
      }
    }
    return 0
  }
  const sameSlice = (a, b) =>
    a.phrase === b.phrase ||
    a.phrase.includes(b.phrase) || b.phrase.includes(a.phrase) ||
    overlapLen(a.phrase, b.phrase) >= 4
  for (const h of sorted) {
    const hit = kept.find((k) => sameSlice(k, h))
    if (hit) {
      // 合并：保留更长的文本、更大的覆盖章数
      if (h.phrase.length > hit.phrase.length) hit.phrase = h.phrase
      if (h.chapters > hit.chapters) hit.chapters = h.chapters
      continue
    }
    kept.push({ ...h })
    if (kept.length >= maxItems) break
  }
  kept.sort((a, b) => b.score - a.score)
  return {
    ok: kept.length === 0,
    total: kept.length,
    items: kept,
    summary: kept.length ? '发现 ' + kept.length + ' 个跨章重复意象' : '没有明显的跨章重复意象',
  }
}

/**
 * ② 节奏曲线：每章的句长标准差与对话占比，找长期平直的段。
 */
export function rhythmCurve(chapters, opts = {}) {
  const flatWindow = Number(opts.flatWindow) > 0 ? Number(opts.flatWindow) : 8
  const rows = (chapters || []).map((c) => {
    const text = String(c.text || '')
    const sents = text.split(/[。！？…]+/).map((s) => s.trim()).filter((s) => s.length > 0)
    const lens = sents.map((s) => s.replace(/\s/g, '').length)
    const mean = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0
    const sd = lens.length > 1 ? Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length) : 0
    let dlg = 0
    for (const m of text.matchAll(/[\u201c\u201d"]([\s\S]*?)[\u201c\u201d"]/g)) dlg += m[1].length
    const total = text.replace(/\s/g, '').length
    return { file: c.file, sd: +sd.toFixed(2), dialoguePct: total ? +((dlg / total) * 100).toFixed(1) : 0 }
  })
  // 找「连续 flatWindow 章里句长标准差都落在很窄的区间」的段
  // 窗口按 flatWindow 步进（不逐个滑动），避免 c017-c024 与 c018-c025 这种重复报
  const flats = []
  for (let i = 0; i + flatWindow <= rows.length; i += flatWindow) {
    const win = rows.slice(i, i + flatWindow)
    const sds = win.map((r) => r.sd)
    const lo = Math.min(...sds)
    const hi = Math.max(...sds)
    if (hi - lo < 2.5) {
      flats.push({
        from: win[0].file,
        to: win[win.length - 1].file,
        length: flatWindow,
        sdRange: [lo, hi],
        message: '从 ' + win[0].file + ' 到 ' + win[win.length - 1].file + ' 连续 ' + flatWindow + ' 章句长结构几乎一致（标准差 ' + lo + '~' + hi + '），节奏偏平',
      })
    }
  }
  return {
    ok: flats.length === 0,
    rows,
    flats,
    summary: flats.length ? '有 ' + flats.length + ' 段节奏偏平（每段连续 ' + flatWindow + ' 章）' : '节奏曲线起伏正常',
  }
}

/**
 * ③ 角色缺席：某具名角色连续 N 章没出现。
 * @param {Array<{file,text}>} chapters
 * @param {string[]} names 角色名清单
 */
export function detectCharacterAbsence(chapters, names, opts = {}) {
  const gapWarn = Number(opts.gapWarn) > 0 ? Number(opts.gapWarn) : 30
  // 3.46.0 修正：characters/*.md 里常有「台阶底下那个人」这种描述式名字（不是真角色），
  // 它们当作角色统计会误报「66 章没露面」。含这些词的跳过。
  const DESCRIPTIVE = /那个人|某个|有人|谁|其一|另一个|对面|其中之一|旁人|众人/
  const list = (names || []).filter((n) => n && !DESCRIPTIVE.test(n))
  if (!list.length) return { ok: true, items: [], summary: '没有角色名清单' }
  const track = new Map(list.map((n) => [n, { lastAt: -1, lastFile: null, maxGap: 0, gapEnd: null }]))
  ;(chapters || []).forEach((c, i) => {
    const text = String(c.text || '')
    for (const n of list) {
      const t = track.get(n)
      if (text.includes(n)) {
        if (t.lastAt >= 0) {
          const gap = i - t.lastAt - 1
          if (gap > t.maxGap) { t.maxGap = gap; t.gapEnd = c.file }
        }
        t.lastAt = i
        t.lastFile = c.file
      }
    }
  })
  const items = []
  for (const [n, t] of track) {
    if (t.maxGap >= gapWarn) items.push({ name: n, maxGap: t.maxGap, gapEnd: t.gapEnd, message: '角色「' + n + '」最长 ' + t.maxGap + ' 章没露面（到 ' + t.gapEnd + '）' })
  }
  items.sort((a, b) => b.maxGap - a.maxGap)
  return {
    ok: items.length === 0,
    items,
    summary: items.length ? items.length + ' 个角色长期缺席' : '角色出场间隔正常',
  }
}

export function summarizeCross(r) {
  if (!r) return '未检测'
  return [r.imagery && r.imagery.summary, r.rhythm && r.rhythm.summary, r.absence && r.absence.summary].filter(Boolean).join(' · ')
}
