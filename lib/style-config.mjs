/**
 * style-config.mjs —— 3.42.0 文风结构化。
 *
 * 项目里 style.md 是自由文本，模型能读、检测器读不了。这里把其中「可量化」的
 * 规矩抽成 style_config.json，让 ai-taste / style-check 有统一基准。
 *
 * 提取策略：先看 style.md 里显式写的 json 片段（```json … ```），有就用；
 * 没有就按正则从中文规矩里抓数字（「每 3 章」「15%~45%」…）；再不行用默认值。
 */

import path from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/** 缺省基准（贴合网文爆款 + 项目现有 style.md 口径）。 */
export const DEFAULT_STYLE_CONFIG = {
  version: 1,
  dialogue_ratio: [0.15, 0.45],
  named_character_every_n_chapters: 3,
  verbal_fight_every_n_chapters: 3,
  protagonist_action_per_chapter: true,
  ai_taste_min: 70,
  banned: [],
  source: 'default',
}

/** 从 markdown 里抽 ```json 代码块。 */
function extractJsonBlock(md) {
  const m = /```json\s*([\s\S]*?)```/.exec(String(md || ''))
  if (!m) return null
  try { return JSON.parse(m[1]) } catch { return null }
}

/** 从中文规矩里抓「每 N 章」这类数字。 */
function grabEveryN(md, keywords) {
  for (const kw of keywords) {
    const re = new RegExp('每\\s*(\\d+)\\s*章[^。\\n]{0,20}' + kw, 'm')
    const m = re.exec(md)
    if (m) return Number(m[1])
  }
  // 反向：关键词在前，数字在后
  for (const kw of keywords) {
    const re = new RegExp(kw + '[^。\\n]{0,20}每\\s*(\\d+)\\s*章', 'm')
    const m = re.exec(md)
    if (m) return Number(m[1])
  }
  return null
}

/** 抓对话占比区间（允许 15%~45% / 15-45%）。 */
function grabDialogueRatio(md) {
  const m = /(\\d{1,2})\\s*%\\s*[~\-至到]\\s*(\\d{1,2})\\s*%/.exec(String(md || ''))
  if (m) {
    const lo = Number(m[1]) / 100
    const hi = Number(m[2]) / 100
    if (lo > 0 && hi > lo && hi <= 1) return [lo, hi]
  }
  return null
}

/**
 * 读 style.md → 生成结构化配置（不落盘）。
 * @param {string} novelDir
 */
export function loadStyleConfig(novelDir) {
  const dir = path.resolve(novelDir)
  const jsonPath = path.join(dir, 'style_config.json')
  const mdPath = path.join(dir, 'style.md')

  // ① 优先读已生成的 style_config.json
  if (existsSync(jsonPath)) {
    try {
      const j = JSON.parse(readFileSync(jsonPath, 'utf8'))
      return { ...DEFAULT_STYLE_CONFIG, ...j, source: 'style_config.json' }
    } catch { /* 坏了就往下走 */ }
  }

  // ② 从 style.md 里抽
  let md = ''
  try { md = readFileSync(mdPath, 'utf8') } catch { md = '' }
  if (!md) return { ...DEFAULT_STYLE_CONFIG }

  const explicit = extractJsonBlock(md)
  if (explicit) return { ...DEFAULT_STYLE_CONFIG, ...explicit, source: 'style.md(embedded json)' }

  const namedEvery = grabEveryN(md, ['具名', '活人', '有名', '角色'])
  const fightEvery = grabEveryN(md, ['嘴仗', '对白', '顶一句', '争吵'])
  const ratio = grabDialogueRatio(md)
  const actionRequired = /每章[^。\n]{0,12}(出手|情绪|怼|算账|自嘲)/.test(md)
  const banned = []
  if (/不许整章只有/.test(md)) banned.push('整章只有「他」和无名柜台')
  if (/照章念|照章说话/.test(md)) banned.push('照章念台词')
  if (/冷调/.test(md) && /废弃/.test(md)) banned.push('冷调叙述')

  return {
    ...DEFAULT_STYLE_CONFIG,
    dialogue_ratio: ratio || DEFAULT_STYLE_CONFIG.dialogue_ratio,
    named_character_every_n_chapters: namedEvery || DEFAULT_STYLE_CONFIG.named_character_every_n_chapters,
    verbal_fight_every_n_chapters: fightEvery || DEFAULT_STYLE_CONFIG.verbal_fight_every_n_chapters,
    protagonist_action_per_chapter: actionRequired,
    banned,
    source: 'style.md(parsed)',
  }
}

/** 把配置落盘成 style_config.json（面板按钮用）。 */
export function writeStyleConfig(novelDir, config) {
  const dir = path.resolve(novelDir)
  const out = { ...DEFAULT_STYLE_CONFIG, ...config, version: 1 }
  writeFileSync(path.join(dir, 'style_config.json'), JSON.stringify(out, null, 2), 'utf8')
  return out
}

/**
 * 按配置检查一章正文。
 * @param {string} text 正文
 * @param {object} config style_config
 * @param {object} ctx  { characterNames: string[] }
 */
export function checkChapterStyle(text, config, ctx = {}) {
  const cfg = { ...DEFAULT_STYLE_CONFIG, ...(config || {}) }
  const raw = String(text || '')
  const total = raw.replace(/\s/g, '').length
  const issues = []

  // ① 对话占比
  let dlg = 0
  for (const m of raw.matchAll(/[\u201c\u201d"]([\s\S]*?)[\u201c\u201d"]/g)) dlg += m[1].length
  const ratio = total ? dlg / total : 0
  const [lo, hi] = Array.isArray(cfg.dialogue_ratio) && cfg.dialogue_ratio.length === 2
    ? cfg.dialogue_ratio : DEFAULT_STYLE_CONFIG.dialogue_ratio
  if (ratio < lo) issues.push({ key: 'dialogue_low', message: '对话占比 ' + (ratio * 100).toFixed(1) + '% 低于下限 ' + (lo * 100) + '%：通篇叙述，读起来像简介' })
  if (ratio > hi) issues.push({ key: 'dialogue_high', message: '对话占比 ' + (ratio * 100).toFixed(1) + '% 高过上限 ' + (hi * 100) + '%：场景与描写被挤没了' })

  // ② 具名角色出场
  const names = Array.isArray(ctx.characterNames) ? ctx.characterNames.filter(Boolean) : []
  if (names.length) {
    const hit = names.filter((n) => raw.includes(n))
    if (!hit.length) issues.push({ key: 'no_named_character', message: '本章没有任何具名角色出场（书里有 ' + names.length + ' 个角色名可对上）' })
  }

  // ③ 嘴仗：连续 ≥3 段以引号开头/结尾的对白
  const paras = raw.split(/\r?\n/).map((p) => p.trim()).filter(Boolean)
  let streak = 0
  let maxStreak = 0
  for (const p of paras) {
    const isDlg = /[\u201c"「]/.test(p) && p.replace(/[^\u201c\u201d"]/g, '').length >= 2
    streak = isDlg ? streak + 1 : 0
    if (streak > maxStreak) maxStreak = streak
  }
  if (maxStreak < 2) issues.push({ key: 'no_verbal_fight', message: '本章没有成组的对白交锋（最长连续对白段仅 ' + maxStreak + ' 段）' })

  // ④ 主角有情绪出手：粗判——祈使/反问/感叹/怼人句式
  if (cfg.protagonist_action_per_chapter) {
    const actionSigns = /[？！]|你[^。\n]{0,15}(懂|敢|配|算)/
    if (!actionSigns.test(raw)) issues.push({ key: 'no_protagonist_action', message: '本章没有「有情绪的出手」（没有反问/质问/感叹/怼人的句子）' })
  }

  return {
    ok: issues.length === 0,
    dialogueRatio: +(ratio * 100).toFixed(1),
    maxDialogueStreak: maxStreak,
    namedHit: names.filter((n) => raw.includes(n)).length,
    issues,
    summary: issues.length ? '本章有 ' + issues.length + ' 项文风偏规' : '本章符合文风基准',
  }
}

export function summarizeStyleCheck(r) {
  if (!r) return '未检查'
  return r.summary
}
