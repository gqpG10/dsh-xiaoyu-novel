/**
 * relations-dedupe.mjs —— 关系账本去重（3.1.0）
 *
 * 现场症状：关系图上一对角色之间挂着五六条并行的边，颜色粗细还不一样。
 * 根因不是绘图 bug，是**账本里真的重复**：定稿维护（lore）每章一次追记，
 * 都把该章「这两人的关系」当新条目 append 一条——60 条关系里只有 35 对唯一
 * 配对，(陈磊,老周) 挂了 6 条、(陈磊,宋佳佳) 挂了 6 条，每条各带一章的叙述。
 *
 * 设计取舍：**合并，不删除**。同 (a,b,type) 的条目描述是逐章累积的事实，
 * 丢掉任何一条都等于丢剧情。所以把描述按章号排序拼成一段（带换行分隔），
 * intensity 取最大、started 取最早、ended 取最晚、phase 取最"实"的，
 * 只保留一条边——图上一对关系一根线，清单里一段完整史。
 *
 * 纯函数：plan 只读不写，apply 写前备份。
 */

import { readFileSync, writeFileSync } from 'node:fs'

/**
 * 章节号排序键：v02-c056 → [2, 56]；空/非法排最后。
 * @param {string} value
 * @returns {number[]}
 */
export function chapterKey(value) {
  const match = /^v(\d+)-c(\d+)$/.exec(String(value ?? '').trim())
  return match === null ? [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER] : [Number(match[1]), Number(match[2])]
}

/** 比较两个章节号（升序）。 */
export function compareChapter(left, right) {
  const a = chapterKey(left)
  const b = chapterKey(right)
  return a[0] - b[0] || a[1] - b[1]
}

/** phase 的「实」程度：now 最实，past 次之，potential 最虚；空值按 now 算（旧条目默认）。 */
const PHASE_RANK = { now: 3, past: 2, potential: 1 }
const PHASE_ALIAS = { 现在: 'now', 过去: 'past', 潜在: 'potential' }

/** 归一 phase（含中文别名），空值返回 ''。 */
export function normalizePhase(value) {
  const text = String(value ?? '').trim()
  if (text === '') return ''
  return PHASE_ALIAS[text] ?? text
}

/** 合并组的键：a/b 无序 + type（同两人不同的关系类型是两条真关系，不能并）。 */
export function relationKey(entry) {
  const a = String(entry?.a ?? '').trim()
  const b = String(entry?.b ?? '').trim()
  const type = String(entry?.type ?? '').trim()
  return [a, b].sort().join('|') + '|' + type
}

/** 描述里「第 N 章」这类前缀，用来给没有 started 的条目猜排序位置。 */
const CHAPTER_HINT = /(?:ch|第)\s*(\d{1,4})\s*章?/i

/** 从描述开头取章号线索（ch61 / 第61章），取不到返回 null。 */
export function chapterHintOf(description) {
  const match = CHAPTER_HINT.exec(String(description ?? '').slice(0, 40))
  return match === null ? null : Number(match[1])
}

/**
 * 规划去重（纯读，不写盘）。
 *
 * @param {object} input
 * @param {Array<object>} input.relations relations.yml 解析后的条目数组
 * @param {boolean} [input.mergeAcrossType=false] 是否连不同类型也并（默认不并）
 * @returns {{groups:Array, merged:number, kept:number, dropped:Array}}
 */
export function planRelationDedupe(input) {
  const relations = Array.isArray(input?.relations) ? input.relations : []
  const groups = new Map()
  for (const entry of relations) {
    if (entry === null || typeof entry !== 'object') continue
    const key = relationKey(entry)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(entry)
  }

  const plans = []
  let merged = 0
  const dropped = []
  for (const [key, list] of groups) {
    if (list.length === 1) {
      plans.push({ key, count: 1, entry: list[0], changed: false })
      continue
    }
    // 排序：按 started 升序，空 started 的用描述里的章号线索，仍取不到的排最后
    const decorated = list.map((entry, index) => {
      const started = String(entry.started ?? '').trim()
      const hint = started === '' ? chapterHintOf(entry.description) : null
      return {
        entry,
        index,
        sortKey: started !== '' ? chapterKey(started) : (hint === null ? [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER] : [Number.MAX_SAFE_INTEGER - 1, hint]),
        sortText: started !== '' ? started : (hint === null ? '' : 'ch' + hint),
      }
    })
    decorated.sort((a, b) => a.sortKey[0] - b.sortKey[0] || a.sortKey[1] - b.sortKey[1] || a.index - b.index)

    const head = decorated[0].entry
    const descriptions = []
    let intensity = 0
    let started = ''
    let ended = ''
    let phase = ''
    let tags = []
    let direction = ''
    let stages = []
    for (const row of decorated) {
      const entry = row.entry
      const text = String(entry.description ?? '').trim()
      if (text !== '' && !descriptions.includes(text)) descriptions.push(text)
      const value = Number(entry.intensity)
      if (Number.isFinite(value)) intensity = Math.max(intensity, value)
      const startedText = String(entry.started ?? '').trim()
      if (startedText !== '' && (started === '' || compareChapter(startedText, started) < 0)) started = startedText
      const endedText = String(entry.ended ?? '').trim()
      if (endedText !== '' && (ended === '' || compareChapter(endedText, ended) > 0)) ended = endedText
      const entryPhase = normalizePhase(entry.phase)
      if (entryPhase !== '' && (PHASE_RANK[entryPhase] ?? 0) > (PHASE_RANK[phase] ?? 0)) phase = entryPhase
      if (Array.isArray(entry.tags)) for (const tag of entry.tags) if (!tags.includes(tag)) tags.push(tag)
      const entryDirection = String(entry.direction ?? '').trim()
      if (entryDirection !== '' && direction === '') direction = entryDirection
      if (Array.isArray(entry.stages)) stages = stages.concat(entry.stages)
    }

    const mergedEntry = { ...head }
    if (descriptions.length > 0) mergedEntry.description = descriptions.join('\n')
    if (intensity > 0) mergedEntry.intensity = intensity
    mergedEntry.started = started
    mergedEntry.ended = ended
    if (phase !== '') mergedEntry.phase = phase
    else delete mergedEntry.phase
    if (tags.length > 0) mergedEntry.tags = tags
    if (direction !== '') mergedEntry.direction = direction
    else delete mergedEntry.direction
    if (stages.length > 0) mergedEntry.stages = stages
    else delete mergedEntry.stages

    plans.push({ key, count: list.length, entry: mergedEntry, changed: true, sources: list.slice() })
    merged += 1
    for (const row of decorated.slice(1)) {
      dropped.push({ a: row.entry.a, b: row.entry.b, type: row.entry.type, description: String(row.entry.description ?? '').slice(0, 60) })
    }
  }
  const kept = plans.length
  return { groups: plans, merged, kept, dropped, before: relations.length }
}

/**
 * 把条目渲染成 yml 文本块（字段顺序照模板：a/b/type/description/intensity/started/ended/phase）。
 *
 * 字符串一律走 **YAML literal block**（`|-`）而不是普通标量——描述里有冒号、
 * 引号、井号、换行，普通标量写出来大概率解析错；literal block 原样保留。
 * @param {object} entry
 * @returns {string}
 */
export function renderRelationEntry(entry) {
  const lines = []
  lines.push('- a: ' + String(entry.a ?? '').trim())
  lines.push('  b: ' + String(entry.b ?? '').trim())
  lines.push('  type: ' + String(entry.type ?? '').trim())
  const description = String(entry.description ?? '')
  if (description.trim() !== '') {
    // literal block：多行或含特殊字符时最稳
    if (description.includes('\n') || /[:#'"\[\]{}&*!|>%@`]/.test(description)) {
      lines.push('  description: |-')
      for (const line of description.split('\n')) lines.push('    ' + line)
    } else {
      lines.push('  description: ' + description)
    }
  }
  if (entry.intensity !== undefined && entry.intensity !== null && String(entry.intensity).trim() !== '') lines.push('  intensity: ' + entry.intensity)
  lines.push('  started: ' + JSON.stringify(String(entry.started ?? '')))
  lines.push('  ended: ' + JSON.stringify(String(entry.ended ?? '')))
  if (entry.phase !== undefined && String(entry.phase).trim() !== '') lines.push('  phase: ' + String(entry.phase).trim())
  if (Array.isArray(entry.tags) && entry.tags.length > 0) lines.push('  tags: [' + entry.tags.join(', ') + ']')
  if (entry.direction !== undefined && String(entry.direction).trim() !== '') lines.push('  direction: ' + String(entry.direction).trim())
  return lines.join('\n')
}

/** 把整份关系数组渲染成文件文本（带文件头注释）。 */
export function renderRelationsFile(entries) {
  const body = entries.map(renderRelationEntry).join('\n')
  return '# relations.yml —— 人物关系（顶层数组，a/b 用角色卡 slug）。\n' + body + '\n'
}

/** 备份并写回（写前 copy 到 relations.yml.bak-<时间戳>，写后可 --undo 还原）。 */
export function applyRelationDedupe(novelDir, relations) {
  const file = novelDir + '/relations.yml'
  const text = readFileSync(file, 'utf8')
  const plan = planRelationDedupe({ relations })
  if (plan.before === plan.kept) return { ok: true, changed: false, before: plan.before, after: plan.kept, backup: null }
  const rendered = renderRelationsFile(plan.groups.map((group) => group.entry))
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const backup = file + '.bak-dedupe-' + stamp
  writeFileSync(backup, text)
  writeFileSync(file, rendered)
  return { ok: true, changed: true, before: plan.before, after: plan.kept, backup, merged: plan.merged, dropped: plan.dropped }
}

