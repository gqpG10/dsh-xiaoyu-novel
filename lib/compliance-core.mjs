/**
 * compliance-core.mjs —— 3.24.0 合规体检（sumeru 三级敏感词范式，纯本地零依赖）。
 *
 * 三级词库（词库文件可放 novelDir/compliance.yml 自定义，缺省用内置最小集）：
 *   拒绝级 reject  ：平台硬禁词，命中即建议删改（发布必拦）
 *   风险级 risk    ：擦边词，需人工确认（发布前过目）
 *   提示级 notice  ：可能限流降权的常见雷词（提示即可）
 *
 * 逐章扫描：命中词 + 上下文（前后 12 字）+ 等级；报告 = problems[] 同构
 * audit.problems，门禁/体检页合流展示。内置词库刻意从最小集开始
 * （真实大词库体积大且需维护，先跑通管线，用户可用自定义文件扩充）。
 */

import path from 'node:path'
import { readTextCached, listDirCached } from './read-cache.mjs'

const BUILTIN = {
  reject: ['习近平', '毛泽东', '六四', '天安门事件', '法轮功', '藏独', '疆独'],
  risk: ['自杀', '自残', '毒品', '海洛因', '赌博', '赌场', '色情', '性行为', '强暴', '枪支', '手雷', '恐怖袭击', '爆炸物'],
  notice: ['鲜血淋漓', '脑浆', '开膛', '分尸', '内脏横飞', '捅死', '割喉', '虐杀'],
}

const LEVELS = { reject: 'error', risk: 'warn', notice: 'info' }

/** 读自定义词库（yml 简易解析：reject:/risk:/notice: 三段列表），与内置合并。 */
function loadLexicon(novelDir) {
  const raw = readTextCached(path.join(path.resolve(novelDir), 'compliance.yml'))
  const custom = { reject: [], risk: [], notice: [] }
  if (raw === null) return { ...BUILTIN, custom: false }
  let cur = null
  for (const line of String(raw).split(/\r?\n/)) {
    const sec = /^\s*(reject|risk|notice)\s*:\s*$/.exec(line)
    if (sec !== null) { cur = sec[1]; continue }
    const item = /^\s+-\s*(.+)$/.exec(line)
    if (item !== null && cur !== null) custom[cur].push(item[1].trim().replace(/^["']|["']$/g, ''))
  }
  return {
    reject: Array.from(new Set(BUILTIN.reject.concat(custom.reject))),
    risk: Array.from(new Set(BUILTIN.risk.concat(custom.risk))),
    notice: Array.from(new Set(BUILTIN.notice.concat(custom.notice))),
    custom: custom.reject.length + custom.risk.length + custom.notice.length > 0,
  }
}

/** 扫一章：返回命中列表（词/等级/上下文）。 */
export function scanChapterText(text, lexicon) {
  const hits = []
  const body = String(text ?? '')
  for (const level of ['reject', 'risk', 'notice']) {
    for (const word of lexicon[level] || []) {
      if (!word) continue
      let from = 0
      for (let guard = 0; guard < 20; guard++) {
        const at = body.indexOf(word, from)
        if (at === -1) break
        hits.push({
          level: LEVELS[level],
          word,
          context: body.slice(Math.max(0, at - 12), Math.min(body.length, at + word.length + 12)),
        })
        from = at + word.length
        if (hits.length > 200) break
      }
    }
  }
  return hits
}

/** 全书合规体检。 */
export function complianceScan(novelDir) {
  const lexicon = loadLexicon(novelDir)
  const dir = path.join(path.resolve(novelDir), 'chapters')
  const files = (listDirCached(dir) || []).filter((f) => /\.md$/.test(f)).sort()
  const chapters = []
  let total = 0
  for (const f of files) {
    const raw = readTextCached(path.join(dir, f))
    if (raw === null) continue
    const hits = scanChapterText(raw, lexicon)
    if (hits.length) {
      total += hits.length
      chapters.push({ file: f, hits: hits.slice(0, 20), hitCount: hits.length })
    }
  }
  return {
    ok: true,
    lexicon: { custom: lexicon.custom, reject: lexicon.reject.length, risk: lexicon.risk.length, notice: lexicon.notice.length },
    totals: { chapters: files.length, flagged: chapters.length, hits: total },
    chapters,
  }
}
