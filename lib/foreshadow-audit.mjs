/**
 * foreshadow-audit.mjs —— 3.42.0 伏笔生命周期审查。
 *
 * 台账格式（沿用项目现有 foreshadows.yml）：
 *   - id, title, status(resolved|abandoned|planted|pending…), priority,
 *     planted_chapter, expected_resolve, resolved_chapter, notes
 *
 * 四类问题：
 *   ① overdue    —— expected_resolve 那一章已经写完，status 还不在终态 → 烂尾风险
 *   ② mismatch   —— status=resolved 却没有 resolved_chapter（或反之）
 *   ③ missing    —— expected_resolve 指向的章节文件不存在（笔误/删章）
 *   ④ stale      —— 仍是 planted，且埋设章距最新章节超过 staleAfter 章
 *
 * 零依赖：只用盘点 + 比较，不写文件。
 */

import path from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

/** 视为「已了结」的状态。 */
export const CLOSED_STATUS = ['resolved', 'closed', 'abandoned', 'dropped']

/**
 * 从文件名 v01-c006 抽出可比较的序号（卷*10000 + 章）。
 * 不符合格式返回 null。
 */
export function chapterOrder(name) {
  if (!name) return null
  const s = String(name).replace(/\.md$/i, '')
  const m = /v(\d+)[-_]?c(\d+)/i.exec(s)
  if (m) return Number(m[1]) * 10000 + Number(m[2])
  const m2 = /c(\d+)/i.exec(s)
  if (m2) return 100000 + Number(m2[1])
  return null
}

/** 极简 YAML 解析：只抽顶层列表项与二级平键（够用且不引三方库）。 */
export function parseForeshadows(raw) {
  const items = []
  let cur = null
  for (const line of String(raw || '').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const mItem = /^\s*-\s+(\w+)\s*:\s*(.*)$/.exec(line)
    if (mItem) {
      if (cur) items.push(cur)
      cur = { [mItem[1]]: mItem[2].trim() }
      continue
    }
    const mKey = /^\s+(\w+)\s*:\s*(.*)$/.exec(line)
    if (mKey && cur) cur[mKey[1]] = mKey[2].trim()
  }
  if (cur) items.push(cur)
  return items
}

/**
 * 主入口。
 * @param {string} novelDir
 * @param {object} [opts] { staleAfter = 20 }
 */
export function auditForeshadows(novelDir, opts = {}) {
  const staleAfter = Number(opts.staleAfter) > 0 ? Number(opts.staleAfter) : 20
  const dir = path.resolve(novelDir)
  const ledgerPath = path.join(dir, 'foreshadows.yml')
  if (!existsSync(ledgerPath)) {
    return { ok: true, total: 0, nextChapter: null, issues: [], summary: '没有 foreshadows.yml，跳过伏笔审查' }
  }
  let raw = ''
  try { raw = readFileSync(ledgerPath, 'utf8') } catch (e) {
    return { ok: false, error: '读不了 foreshadows.yml：' + (e && e.message ? e.message : String(e)) }
  }
  const items = parseForeshadows(raw)

  // 章节序列：排序后的文件名列表，用于「第几章之后」的**真实位置差**
  // （chapterOrder 把卷号×10000 当权重，两章直接相减会得到荒谬的 20080，
  //  所以「过了多少章」一律用这份列表的索引差来算。）
  const chDir = path.join(dir, 'chapters')
  const orderedFiles = []
  try {
    for (const f of readdirSync(chDir)) {
      if (!/\.md$/i.test(f)) continue
      const o = chapterOrder(f)
      if (o != null) orderedFiles.push({ file: f, order: o })
    }
  } catch { /* 无 chapters */ }
  orderedFiles.sort((a, b) => a.order - b.order)
  const posOf = new Map(orderedFiles.map((x, i) => [x.file.replace(/\.md$/i, ''), i]))
  const lastIndex = orderedFiles.length - 1
  let maxOrder = 0
  let newest = null
  if (orderedFiles.length) {
    newest = orderedFiles[lastIndex].file
    maxOrder = orderedFiles[lastIndex].order
  }

  /** 某章之后过了几章（按列表位置差）。找不到就返回 null。 */
  const chaptersAfter = (chapterName) => {
    if (!chapterName) return null
    const key = String(chapterName).replace(/\.md$/i, '')
    const i = posOf.get(key)
    if (i == null) return null
    return lastIndex - i
  }

  const issues = []
  for (const it of items) {
    const id = it.id || '(无 id)'
    const title = it.title || ''
    const status = String(it.status || '').toLowerCase()
    const closed = CLOSED_STATUS.includes(status)
    const planted = chapterOrder(it.planted_chapter)
    const expected = chapterOrder(it.expected_resolve)
    const resolved = chapterOrder(it.resolved_chapter)

    // ① 逾期未回收
    if (!closed && expected != null && maxOrder >= expected) {
      issues.push({
        kind: 'overdue',
        severity: 'high',
        id, title,
        message: '计划在 ' + it.expected_resolve + ' 回收，但该章已写完（当前最新 ' + newest + '），状态仍是 ' + (it.status || '空'),
        expected: it.expected_resolve,
        latest: newest,
      })
    }

    // ② 状态自相矛盾
    if (status === 'resolved' && !String(it.resolved_chapter || '').trim()) {
      issues.push({ kind: 'mismatch', severity: 'high', id, title, message: '状态标 resolved 但没写 resolved_chapter，回收章不明' })
    }
    if (closed && status !== 'abandoned' && installedCheck(it)) {
      // resolved 了但埋设章都没写，说明这条台账本身残缺
      issues.push({ kind: 'mismatch', severity: 'normal', id, title, message: '已了结但没有 planted_chapter，无法回溯埋设位置' })
    }

    // ③ 计划章不存在（只有当它早于最新章节时才确定是笔误）
    if (expected != null && maxOrder > expected) {
      // 3.42.0 修：项目命名是 v01-c006.md（卷补 2 位、章补 3 位），
      // 之前只把章补位、卷没补，导致全部误报「章节不存在」。
      const vol = Math.floor(expected / 10000)
      const num = expected % 10000
      const pad2 = (n) => String(n).padStart(2, '0')
      const pad3 = (n) => String(n).padStart(3, '0')
      const candidates = [
        'v' + pad2(vol) + '-c' + pad3(num) + '.md',
        'v' + vol + '-c' + pad3(num) + '.md',
        'v' + pad2(vol) + '-c' + num + '.md',
        'v' + vol + '-c' + num + '.md',
      ]
      const exists = candidates.some((f) => existsSync(path.join(chDir, f)))
      if (!exists) {
        issues.push({
          kind: 'missing', severity: 'normal', id, title,
          message: 'expected_resolve 指向 ' + it.expected_resolve + '，但目录里找不到这个章节文件（笔误或已删章？）',
          expected: it.expected_resolve,
        })
      }
    }

    // ④ 长期挂起（用真实位置差，不用卷号加权相减）
    if (!closed) {
      const gapAfterPlant = chaptersAfter(it.planted_chapter)
      if (gapAfterPlant != null && gapAfterPlant > staleAfter) {
        issues.push({
          kind: 'stale', severity: 'normal', id, title,
          message: '自 ' + it.planted_chapter + ' 埋设后已过 ' + gapAfterPlant + ' 章仍未回收（阈值 ' + staleAfter + '）',
          planted: it.planted_chapter, latest: newest, gap: gapAfterPlant,
        })
      }
    }
  }

  const high = issues.filter((x) => x.severity === 'high').length
  return {
    ok: true,
    total: items.length,
    latestChapter: newest,
    issues,
    high,
    summary: issues.length
      ? '共 ' + items.length + ' 条伏笔，' + issues.length + ' 项问题（其中 ' + high + ' 项高危）'
      : '共 ' + items.length + ' 条伏笔，全部合规',
  }
}

function installedCheck(it) {
  return !String(it.planted_chapter || '').trim()
}

/**
 * 发布门禁：逾期伏笔是否拦截。
 * 默认 warn；项目设 foreshadow_mode: block 时，高危逾期直接拒发。
 */
export function gateForeshadow(audit, mode) {
  if (!audit || audit.ok === false) return { pass: true }
  const high = (audit.issues || []).filter((x) => x.severity === 'high')
  if (!high.length) return { pass: true }
  const why = high.slice(0, 3).map((x) => x.id + ' ' + x.message).join('；')
  if (mode === 'block') return { pass: false, reason: '伏笔高危问题：' + why }
  return { pass: true, warning: '伏笔高危问题 ' + high.length + ' 项：' + why }
}

export function summarizeForeshadow(audit) {
  if (!audit || audit.ok === false) return audit && audit.error ? audit.error : '未审查'
  return audit.summary
}
