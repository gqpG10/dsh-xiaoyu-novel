/**
 * blacklist.mjs —— 3.43.0 禁忌剧情黑名单。
 *
 * 项目在 novel/blacklist.yml 里写绝对禁止的桥段/词句（一行一条或 - 列表）。
 * 发布前扫描，命中即按 blacklist_mode 处理（默认 block，因为「禁忌」本身就是硬红线）。
 *
 * 与 compliance-core 的分工：compliance 管平台合规词（涉政涉黄等通用库），
 * 这里管「这本书自己定的禁忌」——人物 OOC 桥段、已废弃的设定、作者承诺不写的套路。
 */

import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

/** 读出黑名单条目（支持 - 列表 与 一行一条 两种写法）。 */
export function loadBlacklist(novelDir) {
  const p = path.join(path.resolve(novelDir), 'blacklist.yml')
  if (!existsSync(p)) return []
  try {
    const raw = readFileSync(p, 'utf8')
    const out = []
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const item = /^-\s+(.+)$/.exec(t)
      if (item) { out.push(item[1].replace(/^["']|["']$/g, '').trim()); continue }
      // 排除「key: value」形式的配置行
      if (/^[\w-]+\s*:/.test(t)) continue
      out.push(t)
    }
    return out.filter((s) => s && s.length >= 2)
  } catch { return [] }
}

/**
 * 扫描一章是否踩到黑名单。
 * @returns {{ok:boolean, hits:Array<{word:string, count:number}>, summary:string}}
 */
export function scanBlacklist(text, list) {
  const items = Array.isArray(list) ? list : []
  if (!items.length) return { ok: true, hits: [], summary: '未配置黑名单' }
  const raw = String(text || '')
  const hits = []
  for (const w of items) {
    const n = raw.split(w).length - 1
    if (n > 0) hits.push({ word: w, count: n })
  }
  hits.sort((a, b) => b.count - a.count)
  return {
    ok: hits.length === 0,
    hits,
    summary: hits.length
      ? '命中禁忌 ' + hits.length + ' 项：' + hits.slice(0, 3).map((x) => x.word + '×' + x.count).join('、')
      : '未命中禁忌',
  }
}

export function gateBlacklist(result, mode) {
  if (!result || result.ok) return { pass: true }
  if (mode === 'warn') return { pass: true, warning: result.summary }
  return { pass: false, reason: '禁忌剧情黑名单命中：' + result.summary }
}
