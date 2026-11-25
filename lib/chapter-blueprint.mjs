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

/**
 * 蓝图质量校验（3.27.0，参考 oh-story-dsh 的「细纲门禁」）。
 * 三填齐全只算及格；这里查的是「填得能不能用」——不阻断保存，只出警告：
 *   ① 小目标缺动作：全是状态描述（"他很生气"）没有可执行/可观察的动词 → 写手只能架空抒情
 *   ② 冲突单向：只有一方施压，没有「谁 vs 谁」的对抗结构 → 没有转折空间
 *   ③ 钩子无悬念：没有疑问/意外/反差/未竟信号 → 读者不会想翻下一章
 * @returns {{level: 'ok'|'warn', issues: {field:string, message:string}[]}}
 */
export function qualityOfBlueprint(data) {
  const goal = String(data?.goal ?? '')
  const conflict = String(data?.conflict ?? '')
  const hook = String(data?.hook ?? '')
  const issues = []
  // ① 动作词表：目标里至少要有一个「可观察的行为」
  const ACTIONS = ['拿', '夺', '抢', '杀', '救', '逃', '追', '骗', '揭', '藏', '找', '找上', '见', '问', '谈', '换', '偷', '破', '闯', '赌', '试', '逼', '拖', '送', '带', '交', '查', '认', '拒', '答应', '闯进', '潜', '埋伏']
  if (goal && !ACTIONS.some((a) => goal.includes(a))) {
    issues.push({ field: 'goal', message: '小目标里没有可观察的动作（拿/夺/救/追/骗/揭…）：只写了状态，写手会写成空转抒情' })
  }
  // ② 冲突双向：要有「vs / 对 / 但 / 却 / 反而」或两个人名并列的对抗结构
  const DUAL = [' vs ', '对', '但', '却', '反而', '却被', '冲突', '僵持', '抗衡']
  if (conflict && !DUAL.some((d) => conflict.includes(d))) {
    issues.push({ field: 'conflict', message: '冲突只写了一方施压：补上「谁 vs 谁」和转折点（"但…"），否则本章没有张力变化' })
  }
  // ③ 钩子悬念：疑问、未竟、反差、提示语
  const HOOK_SIGNS = ['？', '?', '…', '——', '却', '竟', '原来', '突然', '没想到', '不该', '不该出现', '谁', '什么', '为什么', '怎么']
  if (hook && !HOOK_SIGNS.some((s) => hook.includes(s))) {
    issues.push({ field: 'hook', message: '章尾钩子缺悬念信号（疑问/未竟/反差/意外）：写成了一句平铺的总结，读者不会想翻下一章' })
  }
  return { level: issues.length === 0 ? 'ok' : 'warn', issues }
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
