/**
 * ai-taste.mjs —— 3.41.0 AI 味量化检测器。
 *
 * 为什么要有它：去 AI 味一直是「方法论」，模型自评估不算分。这里把它拆成
 * 六个能计算的指标，输出 0-100 分与问题清单，面板直接显示，发布前可拦。
 *
 * 六个指标（都有健康区间，超出即扣分）：
 *   1) 句长标准差   —— AI 爱写长度均匀的句子；真人长短错落。健康 ≥ 8
 *   2) 句长极差     —— 最长句 - 最短句。健康 ≥ 25
 *   3) AI 套话密度  —— "仿佛/不禁/与此同时/值得一提的是…" 每千字次数。健康 ≤ 3
 *   4) 段落均匀度   —— 段落字数的变异系数。健康 ≥ 0.35（太齐=机器排版）
 *   5) 对话占比     —— 引号内字数 / 总字数。健康 15%~45%
 *   6) 重复片段率   —— 滑窗 8 字的重复占比。健康 ≤ 2%
 *
 * 零依赖，纯规则。不修改文本，只测量。
 */

/** AI 高频套话（出现即减分，可在项目里扩展）。 */
export const AI_CLICHES = [
  '仿佛', '不禁', '与此同时', '值得一提的是', '不由得', '深吸一口气',
  '嘴角扬起', '眼中闪过一丝', '心中暗道', '五味杂陈', '如同', '宛如',
  '似乎', '缓缓', '微微', '若有所思', '如释重负', '下意识',
  '空气仿佛凝固', '时间仿佛静止', '久久不能平静', '浮现在眼前',
  '在这个瞬间', '不得不说', '总之', '综上所述', '显然', '众所周知',
]

/** 句末标点（切句用）。 */
const SENT_END = /[。！？…!?]+/

/** 把正文切成句子（去空、去纯标点）。 */
export function splitSentences(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split(SENT_END)
    .map((s) => s.trim())
    .filter((s) => s.replace(/[\s\u3000]/g, '').length > 0)
}

/** 把正文切成段落（空行或连续换行分隔）。 */
export function splitParagraphs(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
}

/** 引号内文字总量（中英文双引号都算对话）。 */
export function dialogueChars(text) {
  const s = String(text || '')
  let total = 0
  for (const m of s.matchAll(/[\u201c\u201d"]([\s\S]*?)[\u201c\u201d"]/g)) total += m[1].length
  return total
}

/** 标准差。 */
function stddev(nums) {
  if (nums.length <= 1) return 0
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length
  const v = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length
  return Math.sqrt(v)
}

/** 可见字数（去掉空白、标点）。 */
function visibleLength(s) {
  return String(s || '').replace(/[\s\u3000，。！？、；：""''「」《》…—\-.,!?;:'"()（）]/g, '').length
}

/**
 * 重复片段率：滑窗 8 字统计，出现 2 次以上的窗口字数占总字数比例。
 */
export function repeatRatio(text) {
  const s = String(text || '').replace(/[\s\u3000]/g, '')
  const N = 8
  if (s.length < N * 3) return 0
  const seen = new Map()
  for (let i = 0; i + N <= s.length; i++) {
    const w = s.slice(i, i + N)
    seen.set(w, (seen.get(w) || 0) + 1)
  }
  let repeated = 0
  for (const [, c] of seen) if (c > 1) repeated += (c - 1) * N
  return repeated / s.length
}

/**
 * 主检测入口。
 * @param {string} text 章节正文（不含 frontmatter）
 * @param {object} [opts]
 * @param {string[]} [opts.extraCliches] 项目自定义套话
 * @returns {object} 指标 + 分数 + 问题清单
 */
export function analyzeAiTaste(text, opts = {}) {
  const raw = String(text || '')
  const totalChars = visibleLength(raw)
  const sentences = splitSentences(raw)
  const paragraphs = splitParagraphs(raw)
  const sentLens = sentences.map(visibleLength).filter((n) => n > 0)
  const paraLens = paragraphs.map(visibleLength).filter((n) => n > 0)

  const sentStd = stddev(sentLens)
  const sentRange = sentLens.length ? Math.max(...sentLens) - Math.min(...sentLens) : 0
  const sentAvg = sentLens.length ? sentLens.reduce((a, b) => a + b, 0) / sentLens.length : 0

  const cliches = AI_CLICHES.concat(Array.isArray(opts.extraCliches) ? opts.extraCliches : [])
  const clicheHits = []
  for (const w of cliches) {
    const n = raw.split(w).length - 1
    if (n > 0) clicheHits.push({ word: w, count: n })
  }
  const clicheTotal = clicheHits.reduce((s, x) => s + x.count, 0)
  const clichePer1k = totalChars ? (clicheTotal / totalChars) * 1000 : 0

  const paraAvg = paraLens.length ? paraLens.reduce((a, b) => a + b, 0) / paraLens.length : 0
  const paraCv = paraAvg > 0 ? stddev(paraLens) / paraAvg : 0

  const dChars = dialogueChars(raw)
  const dialogueRatio = totalChars ? dChars / totalChars : 0

  const repeat = repeatRatio(raw)

  // ── 打分：每个指标 6~20 分，总分 100 ────────────────────────
  const metrics = [
    {
      key: 'sentence_std', label: '句长标准差', value: +sentStd.toFixed(2), target: '≥ 8', weight: 20,
      ok: sentStd >= 8,
      tip: sentStd < 5 ? '句子长度太均匀——每句都差不多长，是典型的机器节奏。把长句拆短、短句拉长，制造错落。' :
           '句子偏均匀，再打散几处。',
    },
    {
      key: 'sentence_range', label: '句长极差', value: +sentRange.toFixed(0), target: '≥ 25', weight: 15,
      ok: sentRange >= 25,
      tip: '最长句与最短句差得太小。插一两句极短句（「他没说话。」）和一句长句，节奏就有起伏。',
    },
    {
      key: 'cliche_per_1k', label: 'AI 套话密度', value: +clichePer1k.toFixed(2), target: '≤ 3', weight: 20,
      ok: clichePer1k <= 3,
      tip: '套话太多：' + clicheHits.slice(0, 6).map((x) => x.word + '×' + x.count).join('、'),
    },
    {
      key: 'paragraph_cv', label: '段落长度均匀度', value: +paraCv.toFixed(2), target: '≥ 0.35', weight: 15,
      ok: paraCv >= 0.35,
      tip: '段落长度太整齐，像机器排版。让某一段只有一句话，另一段写满。',
    },
    {
      key: 'dialogue_ratio', label: '对话占比', value: +(dialogueRatio * 100).toFixed(1), target: '15%~45%', weight: 15,
      ok: dialogueRatio >= 0.15 && dialogueRatio <= 0.45,
      tip: dialogueRatio < 0.15 ? '对话太少，通篇是叙述，读起来像简介。多让角色开口。' :
           '对话过多，叙述与场景描写被挤没了。',
    },
    {
      key: 'repeat_ratio', label: '重复片段率', value: +(repeat * 100).toFixed(2), target: '≤ 2%', weight: 15,
      ok: repeat <= 0.02,
      tip: '大段小段重复出现（常见于改写时复制粘贴）。清掉重复表达。',
    },
  ]

  let score = 0
  for (const m of metrics) if (m.ok) score += m.weight
  // 部分达标的给一半分，避免一刀切
  const issues = metrics.filter((m) => !m.ok)
  for (const m of issues) {
    const v = m.value
    // 接近目标给部分分
    let partial = 0
    if (m.key === 'sentence_std') partial = v >= 6 ? 0.6 : v >= 4 ? 0.3 : 0
    else if (m.key === 'sentence_range') partial = v >= 15 ? 0.6 : v >= 8 ? 0.3 : 0
    else if (m.key === 'cliche_per_1k') partial = v <= 6 ? 0.5 : v <= 10 ? 0.25 : 0
    else if (m.key === 'paragraph_cv') partial = v >= 0.25 ? 0.6 : v >= 0.15 ? 0.3 : 0
    else if (m.key === 'dialogue_ratio') partial = (dialogueRatio >= 0.08 && dialogueRatio <= 0.55) ? 0.5 : 0
    else if (m.key === 'repeat_ratio') partial = v <= 0.04 ? 0.6 : v <= 0.08 ? 0.3 : 0
    score += Math.round(m.weight * partial)
  }
  score = Math.max(0, Math.min(100, score))

  return {
    ok: true,
    score,
    grade: score >= 85 ? 'A（几乎无 AI 味）' : score >= 70 ? 'B（合格，可再打磨）' : score >= 50 ? 'C（AI 味明显）' : 'D（机器味重）',
    stats: {
      chars: totalChars,
      sentences: sentences.length,
      paragraphs: paragraphs.length,
      sentAvg: +sentAvg.toFixed(1),
      paraAvg: +paraAvg.toFixed(1),
    },
    metrics,
    cliches: clicheHits.sort((a, b) => b.count - a.count).slice(0, 12),
    issues,
    summary: issues.length
      ? '得分 ' + score + ' · 需打磨：' + issues.map((m) => m.label).join('、')
      : '得分 ' + score + ' · 六项指标全部达标',
  }
}

/** 发布前门禁：项目设置 ai_taste_min（默认 55）以下时是否拦。 */
export function gateAiTaste(result, mode, minScore = 55) {
  if (!result || result.ok === false) return { pass: true }
  const low = result.score < minScore
  if (!low) return { pass: true }
  const why = 'AI 味评分 ' + result.score + ' 低于 ' + minScore + '：' + result.issues.map((m) => m.label).join('、')
  if (mode === 'block') return { pass: false, reason: why }
  return { pass: true, warning: why }
}

export function summarizeAiTaste(result) {
  if (!result || result.ok === false) return '未检测'
  return result.summary + '（' + result.grade + '）'
}
