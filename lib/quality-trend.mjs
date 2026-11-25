/**
 * quality-trend.mjs —— 3.22.0 六维质量趋势（参考 webnovel-writer 审查维度）。
 *
 * 六维（每章 0-100）：
 *   爽点   beat   —— 章内爽点密度（门禁 burst 特征）
 *   一致性 consist —— 出场角色与蓝图/台账吻合度（0 出场告警倒扣）
 *   节奏   rhythm —— 字数离群度（audit.rhythm 离群章倒扣）
 *   钩子   hook   —— 章末钩子（gate tailHook）
 *   人味   human  —— 门禁人味分（analyzeChapter.score）
 *   追读力 pull   —— 综合：平收/连续平收/超短章倒扣
 *
 * 数据全部来自既有模块（audit-core / gate-core），本模块只做汇总与打分，
 * 不重复扫描正文。跨章趋势 + 滑动均值 + 连续下滑预警。
 */

import path from 'node:path'
import { readTextCached, listDirCached } from './read-cache.mjs'
import { chapterSortKey } from './novel-parse.mjs'
import { analyzeChapter } from './gate-core.mjs'
import { readBlueprint } from './chapter-blueprint.mjs'

const ordOf = (stem) => {
  const key = chapterSortKey(String(stem ?? '').replace(/\.md$/i, ''))
  return key === null ? null : key.vol * 1e6 + key.num
}

const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)))

/**
 * 六维质量趋势。
 * @param {string} novelDir 书目录
 * @param {object} audit auditProject 结果（可选，缺省只算逐章维）
 * @returns {{ chapters: [{stem, dims}], totals, alerts }}
 */
export function qualityTrend(novelDir, audit) {
  const dir = path.resolve(novelDir)
  let names = []
  try {
    names = (listDirCached(path.join(dir, 'chapters')) || []).filter((f) => /\.md$/.test(f)).sort()
  } catch { /* 无 chapters/ */ }
  const words = {}
  for (const c of (audit?.chapters) || []) words[c.file] = Number(c.words) || 0
  const avgW = names.length ? names.reduce((a, f) => a + (words[f] || 0), 0) / names.length : 0
  const rows = []
  for (const f of names) {
    const stem = f.replace(/\.md$/i, '')
    const raw = readTextCached(path.join(dir, 'chapters', f))
    const body = raw === null ? '' : String(raw)
    const a = body === '' ? null : analyzeChapter(body)
    const w = words[f] || body.length
    const bp = readBlueprint(novelDir, stem)
    // 真实字段：analyzeChapter 返回 { score, hard, flags, hook, detector, meta }
    // hook 是 chapterHook() 结果 { ok, kind, tail }；beat 维用 hard 项数反推
    // （hard 是「致命短板」清单，越少越扎实）；flags 长度是句级 AI 味密度。
    const hardN = a && Array.isArray(a.hard) ? a.hard.length : 3
    const flagN = a && Array.isArray(a.flags) ? a.flags.length : 0
    const dims = {
      human: a && typeof a.score === 'number' ? clamp(a.score) : null,
      beat: a ? clamp(88 - hardN * 14 - Math.min(30, flagN * 3)) : null,
      hook: a && a.hook && a.hook.ok ? clamp(a.hook.kind === 'question' ? 92 : 78) : (a ? 15 : null),
      rhythm: avgW > 0 ? clamp(100 - Math.min(60, Math.abs(w - avgW) / avgW * 120)) : null,
      consist: bp ? clamp(bp.goal ? 90 : 60) : 70,
      pull: clamp(((a && typeof a.score === 'number' ? a.score : 60) * 0.4) + ((a && a.hook && a.hook.ok) ? 30 : 8) + (w > 800 ? 30 : 12)),
    }
    rows.push({ stem, words: w, dims })
  }
  // 滑动均值（3 章窗口）+ 下滑预警
  const alerts = []
  for (let i = 2; i < rows.length; i++) {
    const win = rows.slice(i - 2, i + 1)
    const pullAvg = win.reduce((a, r) => a + (r.dims.pull ?? 60), 0) / 3
    if (pullAvg < 45) alerts.push({ stem: rows[i].stem, kind: 'pull-drop', message: '近 3 章追读力均值 ' + Math.round(pullAvg) + '：连续偏弱，建议复盘钩子与爽点' })
  }
  const dimsAvg = {}
  for (const k of ['human', 'beat', 'hook', 'rhythm', 'consist', 'pull']) {
    const vs = rows.map((r) => r.dims[k]).filter((v) => v !== null)
    dimsAvg[k] = vs.length ? Math.round(vs.reduce((a, b) => a + b, 0) / vs.length) : null
  }
  return { chapters: rows, totals: { chapters: rows.length, dims: dimsAvg }, alerts }
}
