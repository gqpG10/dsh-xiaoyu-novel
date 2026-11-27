/**
 * four-lines-gen.mjs —— 3.44.0 自动生成 four_lines.yml 模板。
 *
 * 思路：四线判定靠信号词，但主人不知道要塞什么词。这里从正文里**自动挖**：
 *   1) 取最高频的「名词性短语」——反复出现的东西往往就是主线道具（第一格/那一格/来处）
 *   2) 取感情线高频人名/动作词
 *   3) 取伏笔高频标记（【】里的、省略号结尾的短句）
 * 挖出来的词只是**候选**，主人看一眼删几行就能用。
 */

import path from 'node:path'
import { writeFileSync, existsSync, readFileSync } from 'node:fs'


/** 中文停用词（高频但不代表任何线）。 */
const STOP = new Set([
  '什么', '一个', '这个', '那个', '已经', '还是', '就是', '不是', '没有', '自己',
  '他们', '我们', '你们', '这里', '那里', '现在', '时候', '东西', '事情', '这样',
  '那样', '因为', '所以', '但是', '然后', '可是', '如果', '虽然', '不过', '于是',
  '一样', '一点', '一下', '一边', '出来', '起来', '过来', '回去', '知道', '看见',
  '觉得', '应该', '可以', '能够', '需要', '开始', '继续', '还是', '起来',
])

/** 从文本里抽 2~5 字的中文片段并统计频次。 */
function countPhrases(text, minLen = 2, maxLen = 5) {
  const clean = String(text || '').replace(/[\r\n]/g, '').replace(/[^\u4e00-\u9fa5【】]/g, ' ')
  const segs = clean.split(/\s+/).filter(Boolean)
  const freq = new Map()
  for (const seg of segs) {
    if (seg.length < minLen) continue
    for (let len = minLen; len <= maxLen; len++) {
      for (let i = 0; i + len <= seg.length; i++) {
        const w = seg.slice(i, i + len)
        if (STOP.has(w)) continue
        freq.set(w, (freq.get(w) || 0) + 1)
      }
    }
  }
  return freq
}

/** 关键标记：【】里的内容（这本书的强伏笔写法）。 */
function bracketMarkers(texts) {
  const freq = new Map()
  for (const t of texts) {
    for (const m of String(t).matchAll(/【([^】]{1,12})】/g)) {
      const w = m[1].trim()
      if (w) freq.set(w, (freq.get(w) || 0) + 1)
    }
  }
  return freq
}

/**
 * 从章节正文自动挖四线信号词候选。
 * @param {Array<{file:string,text:string}>} chapters
 * @param {object} opts { topMain=8, topSub=6, topRomance=6, topForeshadow=10 }
 */
export function suggestFourLines(chapters, opts = {}) {
  const topMain = Number(opts.topMain) || 8
  const topSub = Number(opts.topSub) || 6
  const topRomance = Number(opts.topRomance) || 6
  const topForeshadow = Number(opts.topForeshadow) || 10
  const texts = (chapters || []).map((c) => c.text || '')
  const joined = texts.join('\n')

  // ① 实词过滤：中文虚字（的/了/把/着/是/在/和/与/就/都/也/还/又/被/给/让/从/向/对/为/以）
  //    出现在词中间或末尾 → 基本是语法碎片，直接扔掉。
  //    「那一格」「第一格」「来处」这类开头虚字是合法的，所以只查**位置≥1**。
  const FUNCTION_CHARS = /[的了把着是在和与就都也还又被给让从向对为以过吗呢吧啊呀么之其而且但所以]/;
  // 结构标记词（"单元" 这种来自 〔单元：单元1〕 的括注，不是剧情词）
  const MARKER_WORDS = new Set(['单元', '本卷', '汇总', '说明', '备注', '小结', '章节'])
  const looksLikeWord = (w) => {
    if (STOP.has(w) || MARKER_WORDS.has(w)) return false
    // 开头若虚字，要求后面紧跟实词且长度≥3（"那一格" 合法，"这一" 不合法）
    if (FUNCTION_CHARS.test(w[0]) && w.length < 3) return false
    for (let i = 1; i < w.length; i++) if (FUNCTION_CHARS.test(w[i])) return false
    return true
  }

  // ② 分卷统计：跨卷都出现的词贯穿性更强
  const perVolume = new Map()
  for (const t of texts) {
    const volMatch = /v(\d+)/i.exec(t.slice(0, 40))
    const vol = volMatch ? Number(volMatch[1]) : 0
    const f = countPhrases(t, 2, 4)
    for (const [w] of f) {
      if (!perVolume.has(w)) perVolume.set(w, new Set())
      perVolume.get(w).add(vol)
    }
  }

  // ③ 方括号里的短语：这本书最强的伏笔/道具标记（【无】【第一格】）
  const bracketPhrase = new Map()
  for (const t of texts) {
    for (const m of String(t).matchAll(/【([^】]{1,10})】/g)) {
      const w = m[1].trim()
      if (w && looksLikeWord(w) && w.length >= 2) bracketPhrase.set(w, (bracketPhrase.get(w) || 0) + 1)
    }
  }

  const chapterHits = new Map()
  for (const t of texts) {
    const f = countPhrases(t, 2, 4)
    for (const [w] of f) chapterHits.set(w, (chapterHits.get(w) || 0) + 1)
  }
  const chapterCount = Math.max(1, texts.length)

  // 主候选打分：方括号出现过（+50） + 跨卷数×20 + 覆盖率×60 + 频次少量加分
  const scored = Array.from(countPhrases(joined, 2, 4).entries())
    .filter(([w, n]) => n >= 6 && looksLikeWord(w) && w.length >= 2)
    .map(([w, n]) => {
      const volCount = (perVolume.get(w) || new Set()).size
      const cover = (chapterHits.get(w) || 0) / chapterCount
      const inBracket = bracketPhrase.has(w) ? 50 : 0
      return { w, n, cover, volCount, score: inBracket + volCount * 20 + cover * 60 + Math.min(n, 60) / 6 }
    })
    .sort((a, b) => b.score - a.score)

  // ④ 卷纲提词：volumes.yml 的 title + summary 是作者亲笔写的剧情提纲，
  //    从里面提 2~4 字实词远比扫正文滑窗准（滑窗会把「的」「了」切出语法碎片）。
  let outlineWords = []
  try {
    const vp = path.join(path.resolve(opts.novelDir || ''), 'volumes.yml')
    if (opts.novelDir && existsSync(vp)) {
      const raw = readFileSync(vp, 'utf8')
      const texts2 = []
      for (const line of raw.split(/\r?\n/)) {
        const m = /^\s*(title|summary)\s*:\s*(.+)$/.exec(line)
        if (m) texts2.push(m[2])
      }
      const f = countPhrases(texts2.join(' '), 2, 4)
      outlineWords = Array.from(f.entries())
        .filter(([w, n]) => n >= 2 && looksLikeWord(w) && w.length >= 2)
        .map(([w, n]) => ({ w, n, volCount: 2, cover: 1, score: 999 + n }))
        .sort((a, b) => b.n - a.n)
        .map((x) => x.w)
        .slice(0, topMain * 2)
    }
  } catch { /* 无卷纲 */ }

  // 主候选：卷纲词优先，不够再用正文打分结果补
  const mainSeed = outlineWords.length ? outlineWords : scored.map((x) => x.w)
  const main = mainSeed.slice(0, topMain)
  const usedMain = new Set(main)
  const used = new Set(usedMain)
  // 支线：从「〔单元：单元1、单元2〕」这类标记 + 正文里卷内高频、跨卷覆盖低的词
  // 支线：优先「卷内高频但别卷少」的实词；不足时用卷纲里剩下的实词补
  const subPool = scored
    .filter((x) => !used.has(x.w) && looksLikeWord(x.w) && x.volCount <= Math.max(1, Math.floor(perVolume.size / 2)))
    .map((x) => x.w)
  // 支线词不从正文硬挖：中文没有分词器，滑窗切出来的全是「了一下」「上那」这类
  // 语法碎片，塞进 signals 反而让四线判定失真。这里留空，由主人在 four_lines.yml
  // 里手填（只有作者知道哪几条支线是真的）。若卷纲里明确写了「支线」段落，才从那取。
  const subFill = outlineWords.filter((w) => !used.has(w) && looksLikeWord(w))
  const sub = subFill.slice(0, Math.min(2, topSub))
  for (const w of sub) used.add(w)
  for (const w of sub) used.add(w)

  // 感情线：人名（characters 目录名）+ 高频感受词
  const romancePool = ['喜欢', '心动', '脸红', '并肩', '牵手', '看着他', '看着她', '沉默', '笑']
  const romance = romancePool.filter((w) => joined.includes(w)).slice(0, topRomance)

  // 伏笔线：方括号标记优先，其次省略号结尾的短句
  const bracket = bracketMarkers(texts)
  const foreshadow = Array.from(bracket.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topForeshadow)
    .map(([w]) => '【' + w + '】')

  return {
    ok: true,
    main,
    sub,
    romance,
    foreshadow,
    chapterCount,
    note: '候选词由正文自动挖出，建议手动删掉不像的、补上你在意的。',
  }
}

/** 生成 four_lines.yml 文本。 */
export function buildFourLinesYaml(suggestion) {
  const line = (key, arr) => key + ': [' + (arr || []).join(', ') + ']'
  return [
    '# 四线信号词（3.44.0 自动生成，可自由增删）',
    '# 命中任一词即认为该线在本章有推进',
    line('main', suggestion.main),
    '# 支线信号词留空：请在下面方括号里手填你认可的支线关键词（如：隔壁, 另一头, 长桌）',
    line('sub', suggestion.sub),
    line('romance', suggestion.romance),
    line('foreshadow', suggestion.foreshadow),
    '',
  ].join('\n')
}

/** 写盘（不覆盖已有文件，除非 force）。 */
export function writeFourLines(novelDir, suggestion, opts = {}) {
  const p = path.join(path.resolve(novelDir), 'four_lines.yml')
  if (existsSync(p) && !opts.force) {
    return { ok: false, exists: true, path: p, message: 'four_lines.yml 已存在，未覆盖（force=true 可强制重写）' }
  }
  const text = buildFourLinesYaml(suggestion)
  writeFileSync(p, text, 'utf8')
  return { ok: true, path: p, text }
}

/** 读回现存的 four_lines.yml 原文（面板展示用）。 */
export function readFourLinesRaw(novelDir) {
  const p = path.join(path.resolve(novelDir), 'four_lines.yml')
  if (!existsSync(p)) return null
  try { return readFileSync(p, 'utf8') } catch { return null }
}
