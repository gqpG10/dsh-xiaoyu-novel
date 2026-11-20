/**
 * 本章出场名单（0.15.3）：关系图按「当前章节」过滤节点用。
 *
 * 为什么需要单独的模块：关系图的数据源是 relations.yml（关系是长期事实），
 * 不知道谁在这一章露过面；而「这一章谁出场」只能从正文里找。判定口径与
 * lib/audit-core.mjs 的「角色 0 出场」一致：正文里出现角色卡 name 即算出场
 * （全书统计同一把尺子，不另立规矩）。
 *
 * 缓存：按「章节文件 mtime+size」+「角色卡名单指纹」做键——切章节时同一份
 * 正文只扫一次；改了角色卡（增删人物/改名）名单指纹变，缓存自然失效。
 */
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { parseStateSnapshot } from './panel-core.mjs'

const CACHE = new Map()
const CACHE_MAX = 16

function fingerprint(novelDir, file) {
  let sig = ''
  try {
    const st = statSync(path.join(path.resolve(novelDir), 'chapters', file))
    sig = String(st.mtimeMs) + ':' + String(st.size)
  } catch {
    return null
  }
  let chars = ''
  try {
    const snap = parseStateSnapshot(novelDir, { lite: true })
    chars = (snap.characters || []).map((c) => String(c.name ?? '')).join('|')
  } catch {
    chars = ''
  }
  return sig + '#' + chars
}

/**
 * 本章出场角色名（去重、保持角色卡顺序）。
 * 章节目录/文件不存在时返回空名单（调用方按「不过滤」处理，图不该因为读失败变空）。
 */
export function chapterCast(novelDir, file) {
  const safe = path.basename(String(file ?? ''))
  if (safe === '' || safe !== String(file ?? '')) {
    const err = new Error('章节文件名不合法')
    err.status = 400
    throw err
  }
  const dir = path.resolve(novelDir)
  const key = dir + '|' + safe
  const fp = fingerprint(dir, safe)
  if (fp === null) {
    const err = new Error('章节不存在：' + safe)
    err.status = 404
    throw err
  }
  const hit = CACHE.get(key)
  if (hit !== undefined && hit.fp === fp) return hit.value
  let snap
  try {
    snap = parseStateSnapshot(dir, { lite: true })
  } catch {
    snap = null
  }
  const cards = snap && Array.isArray(snap.characters) ? snap.characters : []
  let body = ''
  try {
    const raw = readFileSync(path.join(dir, 'chapters', safe), 'utf8')
    // 去掉 frontmatter：标题/梗概里出现人名不算出场，只认正文。
    const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(raw)
    body = m ? raw.slice(m[0].length) : raw
  } catch {
    body = ''
  }
  const names = []
  const seen = Object.create(null)
  for (const card of cards) {
    const name = String(card && card.name ? card.name : '').trim()
    if (name === '' || seen[name]) continue
    seen[name] = true
    if (body.indexOf(name) !== -1) names.push(name)
  }
  const value = { ok: true, file: safe, names, total: cards.length }
  CACHE.set(key, { fp, value })
  if (CACHE.size > CACHE_MAX) {
    const oldest = CACHE.keys().next().value
    if (oldest !== undefined) CACHE.delete(oldest)
  }
  return value
}
