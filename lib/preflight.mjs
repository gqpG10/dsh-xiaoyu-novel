/**
 * preflight.mjs —— 3.46.0 发布预检。
 *
 * 问题：现在发布时才逐章检查，违规一章就失败，主人得自己翻哪章哪里错。
 * 预检把全部检查**提前**跑一遍，出一张表：
 *   第1章 ✅ 可发
 *   第2章 ⚠️ 对话占比 8%（低于 15%）
 *   第3章 ❌ 伏笔 fs-063 逾期
 *   第4章 ✅ 可发
 * 主人看清了再决定发哪几章。
 *
 * 聚合的检查（与发布拦截完全同源，避免两套逻辑打架）：
 *   黑名单 / 伏笔（全书级，命中一次全章标记）/ 文风 / AI 味 / 对话引号
 */

import path from 'node:path'
import { readdirSync } from 'node:fs'
import { scanDialogueQuotes } from './dialogue-quote.mjs'
import { analyzeAiTaste } from './ai-taste.mjs'
import { checkChapterStyle } from './style-config.mjs'
import { scanBlacklist } from './blacklist.mjs'
import { auditForeshadows } from './foreshadow-audit.mjs'

/** 状态优先级：block > warn > ok */
const RANK = { ok: 0, warn: 1, block: 2 }

function worst(list) {
  let w = 'ok'
  for (const x of list) if (RANK[x.level] > RANK[w]) w = x.level
  return w
}

/**
 * 单章预检。
 * @param {object} ctx { text, style, styleNames, blacklist, foreshadowHigh }
 */
export function checkOneChapter(ctx) {
  const issues = []
  const text = String(ctx.text || '')

  // ① 黑名单（硬红线）
  if (ctx.blacklist && ctx.blacklist.length) {
    const bl = scanBlacklist(text, ctx.blacklist)
    if (!bl.ok) issues.push({ level: 'block', kind: 'blacklist', message: bl.summary })
  }

  // ② 对话引号
  const dq = scanDialogueQuotes(text)
  if (!dq.ok) issues.push({ level: 'block', kind: 'quote', message: '非双引号对话 ' + dq.count + ' 处（第 ' + (dq.violations[0] ? dq.violations[0].line : '?') + ' 行起）' })

  // ③ 文风
  const sc = checkChapterStyle(text, ctx.style, { characterNames: ctx.styleNames })
  if (!sc.ok) issues.push({ level: 'warn', kind: 'style', message: sc.issues.map((i) => i.message).join('；') })

  // ④ AI 味
  const taste = analyzeAiTaste(text)
  if (taste.score < 55) issues.push({ level: 'warn', kind: 'ai_taste', message: 'AI 味评分 ' + taste.score + '（' + taste.grade + '）' })

  // ⑤ 伏笔：全书级指标，命中则在每章提示（只提示一次，不重复占版面）
  if (ctx.foreshadowHigh > 0) {
    issues.push({ level: 'warn', kind: 'foreshadow', message: '全书有 ' + ctx.foreshadowHigh + ' 项高危伏笔逾期（发布前建议处理）' })
  }

  return {
    level: worst(issues),
    issues,
    aiScore: taste.score,
    dialoguePct: sc.dialogueRatio,
    chars: text.replace(/\s/g, '').length,
  }
}

/**
 * 批量预检，产出报告。
 * @param {string} novelDir
 * @param {Array<string>} files 要预检的文件名（可只查勾选的）
 * @param {object} deps { readChapter, style, styleNames, blacklist }
 */
export function preflightChapters(novelDir, files, deps) {
  const dir = path.resolve(novelDir)
  const fh = auditForeshadows(dir, { staleAfter: 20 })
  const foreshadowHigh = (fh.issues || []).filter((x) => x.severity === 'high').length

  const rows = []
  for (const file of files || []) {
    const stem = String(file).replace(/\.md$/i, '')
    let ch = null
    try { ch = deps.readChapter(dir, stem + '.md') } catch { ch = null }
    if (!ch || ch.ok === false) {
      rows.push({ file: stem, level: 'block', issues: [{ level: 'block', kind: 'read', message: '正文读取失败' }], aiScore: null, chars: 0 })
      continue
    }
    const body = String(ch.body || '').trim()
    const r = checkOneChapter({ text: body, style: deps.style, styleNames: deps.styleNames, blacklist: deps.blacklist, foreshadowHigh })
    rows.push({ file: stem, ...r })
  }

  const pass = rows.filter((r) => r.level === 'ok').length
  const warn = rows.filter((r) => r.level === 'warn').length
  const block = rows.filter((r) => r.level === 'block').length
  return {
    ok: true,
    total: rows.length,
    pass, warn, block,
    rows,
    foreshadowHigh,
    summary: rows.length
      ? '预检 ' + rows.length + ' 章：可发 ' + pass + '，警告 ' + warn + '，阻断 ' + block
      : '没有要预检的章节',
  }
}

export function summarizePreflight(r) {
  if (!r) return '未预检'
  return r.summary
}
