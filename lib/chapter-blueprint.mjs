/**
 * chapter-blueprint.mjs —— 3.22.0 章节蓝图（参考 Pagekin 章节蓝图范式）。
 *
 * 为什么：写手直接开写容易跑偏——本章小目标没想清、冲突没有转折、
 * 章尾钩子忘了留。蓝图是动笔前的强制三填：goal（本章小目标）/
 * conflict（冲突与转折）/ hook（章尾钩子），外加本章出场的核心人物。
 *
 * 存储：novelDir/blueprints/<stem>.yml（一章一文件，纯文本可手改可回滚）。
 * 与章纲（outline.md 长文）互补：章纲管全书节奏，蓝图管单章内部结构。
 *
 * 纯函数；写盘由路由层做（本模块提供序列化/校验）。
 */

import path from 'node:path'
import { readTextCached, listDirCached } from './read-cache.mjs'

const FIELDS = ['goal', 'conflict', 'hook', 'cast']

/** 读一章蓝图；不存在返回 null（未起笔状态）。 */
export function readBlueprint(novelDir, stem) {
  const raw = readTextCached(path.join(path.resolve(novelDir), 'blueprints', String(stem ?? '').replace(/\.md$/i, '') + '.yml'))
  if (raw === null) return null
  const out = { chapter: String(stem).replace(/\.md$/i, '') }
  for (const line of String(raw).split(/\r?\n/)) {
    const m = /^\s*(goal|conflict|hook|cast)\s*:\s*(.*)$/.exec(line)
    if (m === null) continue
    let v = m[2].trim()
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1)
    if (m[1] === 'cast') {
      v = v.replace(/^\[|\]$/g, '')
      out.cast = v.split(/[,，、]/).map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean)
    } else out[m[1]] = v
  }
  return out
}

/** 列全书蓝图（按章序）。 */
export function listBlueprints(novelDir) {
  const dir = path.join(path.resolve(novelDir), 'blueprints')
  const files = (listDirCached(dir) || []).filter((f) => /\.ya?ml$/.test(f)).sort()
  return files.map((f) => readBlueprint(novelDir, f.replace(/\.ya?ml$/i, ''))).filter(Boolean)
}

/** 校验并序列化一份蓝图（写盘前的闸）。三填齐才放行。 */
export function serializeBlueprint(stem, data) {
  const chapter = String(stem ?? '').replace(/\.md$/i, '')
  if (!/^[A-Za-z0-9_-]+$/.test(chapter)) return { ok: false, error: '章名只许字母数字连字符下划线' }
  const goal = String(data?.goal ?? '').trim()
  const conflict = String(data?.conflict ?? '').trim()
  const hook = String(data?.hook ?? '').trim()
  if (!goal) return { ok: false, error: 'goal（本章小目标）必填' }
  if (!conflict) return { ok: false, error: 'conflict（冲突与转折）必填' }
  if (!hook) return { ok: false, error: 'hook（章尾钩子）必填' }
  if (goal.length > 300 || conflict.length > 300 || hook.length > 300) return { ok: false, error: '单字段不超 300 字' }
  const cast = Array.isArray(data?.cast) ? data.cast.map((c) => String(c).trim()).filter(Boolean).slice(0, 12) : []
  const esc = (s) => s.replace(/"/g, '\\"')
  return {
    ok: true,
    chapter,
    text: [
      '# 蓝图：' + chapter,
      'goal: "' + esc(goal) + '"',
      'conflict: "' + esc(conflict) + '"',
      'hook: "' + esc(hook) + '"',
      cast.length ? 'cast: [' + cast.join(', ') + ']' : 'cast: []',
    ].join('\n') + '\n',
  }
}

/** 蓝图完成度统计（面板概览用）。 */
export function blueprintStats(novelDir, chapterFiles) {
  const bps = listBlueprints(novelDir)
  const done = new Set(bps.map((b) => b.chapter))
  const missing = (chapterFiles || []).map((f) => String(f).replace(/\.md$/i, '')).filter((s) => !done.has(s))
  return { total: (chapterFiles || []).length, withBlueprint: bps.length, missing: missing.slice(-5) }
}
