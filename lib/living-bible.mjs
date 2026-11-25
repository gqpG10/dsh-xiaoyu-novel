/**
 * living-bible.mjs —— 3.23.0 活设定集 + 章后记忆（novel-bible / 墨屿范式）。
 *
 * 活设定集：设定条目加 last_used 时间戳。智能上下文加载某条设定时调
 * touchBible()，条目从「静态文件」变「写作时被引用的活文档」——面板设定页
 * 按「最近使用」排序，写手从不引用的设定自动沉底（失焦可视化）。
 *
 * 章后记忆：每章一个 memory/<stem>.md（约 150 字摘要 + 关键事件 + 章尾状态）。
 * 下一章的智能上下文自动携带上一章记忆——长篇连载 AI 最容易断的「前情」线。
 * 摘要由纯函数生成（首尾段 + 对话行 + 伏笔命中，零依赖不调模型），路由存。
 *
 * 存储约定：bible/<name>.yml 追加 last_used: <ISO>；memory/<stem>.yml 一章一文件。
 */

import path from 'node:path'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { readTextCached, listDirCached } from './read-cache.mjs'

const ISO_DAY = () => new Date().toISOString().slice(0, 19)

/** 读活设定集状态：全部设定条目的 last_used 映射。 */
export function bibleUsage(novelDir) {
  const dir = path.join(path.resolve(novelDir), 'bible')
  const files = (listDirCached(dir) || []).filter((f) => /\.ya?ml$/i.test(f))
  const out = []
  for (const f of files) {
    const raw = readTextCached(path.join(dir, f))
    if (raw === null) continue
    const m = /^\s*last_used\s*:\s*([^\s]+)\s*$/m.exec(String(raw))
    const nm = /^\s*(?:name|title|id)\s*:\s*(.+)$/m.exec(String(raw))
    out.push({ file: f, name: nm ? nm[1].trim() : f, lastUsed: m ? m[1] : null })
  }
  out.sort((a, b) => (b.lastUsed || '').localeCompare(a.lastUsed || ''))
  return out
}

/** 给一个设定文件盖 last_used 时间戳（幂等：当天已盖不重写；真写盘）。 */
export function touchBible(novelDir, file) {
  const dir = path.join(path.resolve(novelDir), 'bible')
  const name = String(file ?? '').replace(/\.ya?ml$/i, '')
  if (!/^[\w\u4e00-\u9fa5-]+$/.test(name)) return { ok: false, error: '非法设定名' }
  const target = path.join(dir, name + '.yml')
  if (!existsSync(target)) return { ok: true, touched: false, file: 'bible/' + name + '.yml', missing: true }
  let raw = ''
  try { raw = readFileSync(target, 'utf8') } catch { return { ok: false, error: '读取失败' } }
  const today = ISO_DAY().slice(0, 10)
  const stamped = /^\s*last_used\s*:\s*(\S+)\s*$/m.exec(raw)
  if (stamped && stamped[1].slice(0, 10) === today) {
    return { ok: true, touched: false, file: 'bible/' + name + '.yml' }
  }
  const next = stamped
    ? raw.replace(/^\s*last_used\s*:\s*\S+\s*$/m, 'last_used: ' + ISO_DAY())
    : raw.replace(/\s*$/, '') + '\nlast_used: ' + ISO_DAY() + '\n'
  try { writeFileSync(target, next, 'utf8') } catch (e) { return { ok: false, error: '写入失败：' + e.message } }
  return { ok: true, touched: true, file: 'bible/' + name + '.yml', name }
}

/** 纯函数章摘要（不调模型）：首段定调 + 对话密度 + 末段钩子 + 关键统计。 */
export function summarizeChapter(text) {
  const body = String(text ?? '')
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  if (paras.length === 0) return { ok: false, error: '空章' }
  const head = paras[0].slice(0, 80)
  const tail = paras[paras.length - 1].slice(0, 80)
  const dialogLines = (body.match(/[“"]([^”"]{2,40})[”"]/g) || []).length
  const chars = body.replace(/\s/g, '').length
  const lastPara = paras[paras.length - 1]
  const qTail = /[？?…—]/.test(lastPara.slice(-30))
  const summary = [
    '开章：' + head,
    '收章：' + tail,
    '对话 ' + dialogLines + ' 轮 · ' + chars + ' 字' + (qTail ? ' · 章尾留问' : ' · 章尾平收'),
  ].join('\n')
  return { ok: true, summary, chars, dialogLines, tailHook: qTail }
}

/** 读上一章记忆（智能上下文自动携带）。 */
export function readPrevMemory(novelDir, stems) {
  const dir = path.join(path.resolve(novelDir), 'memory')
  const sorted = (stems || []).slice().sort()
  for (let i = sorted.length - 1; i >= 0; i--) {
    const raw = readTextCached(path.join(dir, sorted[i] + '.yml'))
    if (raw !== null) return { chapter: sorted[i], text: String(raw) }
  }
  return null
}
