/**
 * cast-filter.mjs —— 3.47.0 角色分级（主要 / 次要 / 路人）。
 *
 * 问题：characters/ 里塞了「窗后那个人」「登记处」「行政管理机构」「掏片时四块」
 * 这类不是人的东西，关系图画出来一片乱。但这个信息不能删——写作时还要查。
 *
 * 三层判定：
 *   ① 名字形态：描述式（那个人/那位/某个）、机构地点（处/局/机构）、非专名（含数字/赤裸动词）→ 路人
 *   ② 出场章数：统计正文里提到这个名字的章数 → ≥10 主要，3~9 次要，≤2 路人
 *   ③ 备份文件：.bak / .pre-* 一律排除（并单独列出）
 *
 * 注意：① 是硬否决（机构永远不是主要人物），② 只在 ① 通过时起作用。
 */

import path from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

/** 描述式：不是专名，只是「某个人/某一位」。 */
export const DESCRIPTIVE = /那个人|那个人|那位|那家|某个|有人|谁|其[一中]|旁人|众人|几个|这一个|哪一个|哪位/

/** 机构 / 地点：不是人。 */
export const ENTITY = /机构|部门|中心|公司|处$|局$|所$|店$|摊$|门$|堂$|馆$|街$|村$|镇$|区$|县$/

/** 非专名：含数字、或以赤裸动词/量词结尾。 */
const NOT_PROPER = /[0-9０-９]|时$|块$|^的|^打了|^掏出/

/** 位置短语：门缝里/桌子下/街口上 —— 是人所在的地方，不是人。 */
const POSITION = /[里上中下外前后旁]$/

/** 势力名：公司/集团/传媒这类组织（进关系图，但标为 faction 不是人物）。 */
export const FACTION_HINT = /公司$|集团$|传媒$|资本$|协会$|联盟$|委员会$|组织$|门$|堂$|帮$|会$/

/** 是否备份文件。 */
export function isBackupFile(name) {
  return /\.(bak|orig|old|pre-.*|pre_.*)/i.test(name) || /\.pre-/.test(name) || /\.bak/.test(name)
}

/**
 * 判定单个名字的形态分。
 * @returns {'main'|'minor'|'extra'|'backup'} 形态层面的归属（不含出场频次）
 */
export function classifyName(name) {
  const n = String(name || '').trim()
  if (!n) return 'extra'
  if (DESCRIPTIVE.test(n)) return 'extra'
  // 势力优先于地点判定：星途这种公司级别的势力要能进图
  if (FACTION_HINT.test(n) && !DESCRIPTIVE.test(n)) return 'faction'
  if (ENTITY.test(n)) return 'extra'
  if (POSITION.test(n)) return 'extra'
  if (NOT_PROPER.test(n)) return 'extra'
  // 名字要 2~5 个中文字，才像专名
  const cn = n.replace(/[^\u4e00-\u9fa5]/g, '')
  if (cn.length < 2 || cn.length > 5) return 'extra'
  return 'main'
}

/** 读 characters/ 下所有角色卡（跳过备份）。 */
export function scanCharacters(novelDir) {
  const dir = path.join(path.resolve(novelDir), 'characters')
  if (!existsSync(dir)) return { ok: true, cards: [], backups: [], total: 0 }
  const cards = []
  const backups = []
  for (const f of readdirSync(dir)) {
    if (!/\.md$/i.test(f)) continue
    if (isBackupFile(f)) { backups.push(f); continue }
    let raw = ''
    try { raw = readFileSync(path.join(dir, f), 'utf8') } catch { continue }
    const m = /^\s*name\s*:\s*(.+)$/m.exec(raw) || /^\s*title\s*:\s*(.+)$/m.exec(raw)
    const name = m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
    // 3.47.0 手动覆盖：角色卡 frontmatter 里写 tier: main/minor/extra/faction 就按它算
    const tm = /^\s*tier\s*:\s*(\w+)/m.exec(raw)
    const forcedTier = tm && /^(main|minor|extra|faction)$/i.test(tm[1]) ? tm[1].toLowerCase() : null
    // 3.47.0 定稿：不再看卡片正文提没提到公司——「张涛受雇于星途资本」这种会把
    // 人误判成势力。势力只认两种：名字带组织后缀，或角色卡上手动写 tier: faction。
    cards.push({ file: f, name: name || '(无名)', slug: f.replace(/\.md$/i, ''), forcedTier })
  }
  return { ok: true, cards, backups, total: cards.length }
}

/**
 * 统计每个名字在多少章正文里出现过。
 * @param {Array<{file:string,text:string}>} chapters
 * @param {string[]} names
 */
export function countAppearances(chapters, names) {
  const out = new Map()
  for (const n of names || []) out.set(n, 0)
  for (const c of chapters || []) {
    const text = String(c.text || '')
    for (const n of names || []) {
      if (n && n !== '(无名)' && text.includes(n)) out.set(n, (out.get(n) || 0) + 1)
    }
  }
  return out
}

/**
 * 主入口：给每个角色卡分级。
 * @param {string} novelDir
 * @param {Array<{file:string,text:string}>} chapters
 * @param {object} opts { mainMin=10, minorMin=3 }
 */
export function classifyCharacters(novelDir, chapters, opts = {}) {
  const mainMin = Number(opts.mainMin) > 0 ? Number(opts.mainMin) : 10
  const minorMin = Number(opts.minorMin) > 0 ? Number(opts.minorMin) : 3
  const scan = scanCharacters(novelDir)
  if (!scan.ok) return scan
  const names = scan.cards.map((c) => c.name)
  const appear = countAppearances(chapters, names)

  const rows = scan.cards.map((c) => {
    const shape = classifyName(c.name)
    const chaptersHit = appear.get(c.name) || 0
    let tier
    let reason
    // ① 手动覆盖最优先
    if (c.forcedTier) {
      return { ...c, tier: c.forcedTier, chaptersHit, reason: '手动标为 ' + c.forcedTier }
    }
    // ② 势力名：只认名字带组织后缀（公司/集团/传媒/资本/协会/联盟）；
    //    「星途」这种不带后缀的，请在角色卡上写 tier: faction 手动标注。
    if (shape === 'faction') {
      const t = chaptersHit >= minorMin ? 'faction' : 'extra'
      return {
        ...c, tier: t, chaptersHit,
        reason: t === 'faction' ? '势力（名字带组织后缀），出场 ' + chaptersHit + ' 章' : '势力但只出场 ' + chaptersHit + ' 章',
      }
    }
    if (shape === 'extra') {
      tier = 'extra'
      reason = DESCRIPTIVE.test(c.name) ? '描述式名字（那个人/某位），不是专名'
        : ENTITY.test(c.name) ? '机构或地点，不是人'
        : POSITION.test(c.name) ? '位置短语（门缝里/桌子下），不是人名'
        : NOT_PROPER.test(c.name) ? '不像专名（含数字/赤裸动词）'
        : '名字不像 2~5 字中文专名'
    } else if (chaptersHit >= mainMin) {
      tier = 'main'
      reason = '出场 ' + chaptersHit + ' 章'
    } else if (chaptersHit >= minorMin) {
      tier = 'minor'
      reason = '出场 ' + chaptersHit + ' 章（次要）'
    } else {
      tier = 'extra'
      reason = '只出场 ' + chaptersHit + ' 章'
    }
    return { ...c, tier, chaptersHit, reason }
  })

  const by = (t) => rows.filter((r) => r.tier === t)
  return {
    ok: true,
    total: rows.length,
    main: by('main'),
    minor: by('minor'),
    faction: by('faction'),
    extra: by('extra'),
    backups: scan.backups,
    summary: '共 ' + rows.length + ' 张角色卡：主要 ' + by('main').length + ' · 势力 ' + by('faction').length +
      ' · 次要 ' + by('minor').length + ' · 路人 ' + by('extra').length +
      (scan.backups.length ? ' · 备份 ' + scan.backups.length + ' 个' : ''),
  }
}

/**
 * 关系图过滤：只留指定层级。
 * @param {Array<{tier:string}>} rows
 * @param {object} opts { showMinor=false }
 */
export function filterForGraph(rows, opts = {}) {
  const showMinor = opts.showMinor === true
  return (rows || []).filter((r) =>
    r.tier === 'main' || r.tier === 'faction' || (showMinor && r.tier === 'minor')
  )
}

export function summarizeCast(r) {
  if (!r || r.ok === false) return r && r.error ? r.error : '未分级'
  return r.summary
}
