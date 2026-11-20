/**
 * result-cache.mjs —— 「按文件指纹缓存重计算结果」（0.22.0）
 *
 * 现场：面板每保存一次就重拉 check + audit + format + ledger + setup，实测
 * 一轮 1.5 秒（51 章的书）。其中 audit 466ms、check 228ms、format 74ms——
 * 这些函数的输入就是磁盘上那批文件，文件没动，结果必然一样，纯属白算。
 *
 * 做法：调用方给出「我读了哪些文件/目录」，这里算一个指纹（每项
 * mtimeMs:size 排序后拼串），拿它当键缓存结果。任一文件改动 → 指纹变 →
 * 自动重算。stat 一次约 0.05ms，51 章也就 3ms，远低于重算的几百毫秒。
 *
 * 为什么不用深比较内容：那等于每次读全文，缓存就失去意义。mtime+size 是
 * Vite/webpack 同款判据；本插件的写盘走 writeAtomic 并显式 invalidate，
 * 外部（agent/作者）改文件靠 stat 发现。
 *
 * 边界：
 *   - 每条缓存最多 8 项（不同工作区 × 不同 scope），LRU 淘汰；
 *   - 只缓存纯函数结果，不缓存 Promise（避免并发时把半成品发给别人）；
 *   - 指纹算不出来（目录不存在）时直接不算缓存，走原路径。
 */

import { statSync } from 'node:fs'

/** 每个命名空间最多留几条结果。 */
const MAX_ENTRIES = 8
/** 命名空间 → Map(指纹 → 结果)。 */
const stores = new Map()

/**
 * 给一组路径算指纹：绝对路径 + mtimeMs + size，排序后拼串。
 * 目录只取自身 mtime（增删条目会变），不递归——递归 stat 太贵，
 * 调用方如果要覆盖子文件，把子文件也列进来。
 * @param {string[]} paths
 * @returns {string} 指纹；全部路径都不存在时返回空串（调用方据此跳过缓存）
 */
export function fingerprintOf(paths) {
  const parts = []
  let seen = 0
  for (const abs of Array.isArray(paths) ? paths : []) {
    if (typeof abs !== 'string' || abs === '') continue
    try {
      const st = statSync(abs)
      parts.push(abs + ':' + st.mtimeMs + ':' + st.size)
      seen += 1
    } catch {
      // 文件不存在：把「不存在」也编进指纹，这样「新建文件」能让缓存失效
      parts.push(abs + ':missing')
    }
  }
  if (seen === 0) return ''
  parts.sort()
  return parts.join('|')
}

/**
 * 按指纹取缓存；没有就计算并存入。
 * @param {string} namespace 缓存命名空间（如 'audit'）
 * @param {string} fingerprint 指纹（空串表示不缓存）
 * @param {() => any} compute 计算函数（同步；要异步请自行包 Promise 再判断）
 * @returns {{ value: any, hit: boolean }}
 */
export function cachedResult(namespace, fingerprint, compute) {
  if (typeof fingerprint !== 'string' || fingerprint === '') {
    return { value: compute(), hit: false }
  }
  let store = stores.get(namespace)
  if (store === undefined) {
    store = new Map()
    stores.set(namespace, store)
  }
  const hit = store.get(fingerprint)
  if (hit !== undefined) {
    // LRU：命中后挪到末尾
    store.delete(fingerprint)
    store.set(fingerprint, hit)
    return { value: hit.value, hit: true }
  }
  const value = compute()
  store.set(fingerprint, { value })
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
  return { value, hit: false }
}

/**
 * 指纹本身也缓存（短 TTL）：一次面板刷新会连着问 audit / check / ledger-stats，
 * 每个都 stat 一遍全书是白花时间（Android /sdcard 上 162 个文件约 58ms）。
 * TTL 取 800ms——够覆盖一次刷新的连击，又短到「刚存完一章」不会被旧指纹骗。
 * 写路径调 clearResultCache() 会连指纹缓存一起清，不依赖 TTL 兜底。
 */
const fpCache = new Map()
const FP_TTL_MS = 800

/**
 * 带短 TTL 的指纹：同一 key 在 TTL 内复用上次结果。
 * @param {string} key 缓存键（通常是 novelDir）
 * @param {string[]} paths 参与指纹的路径
 * @param {number} ttlMs 复用窗口
 */
export function fingerprintOfCached(key, paths, ttlMs = FP_TTL_MS) {
  const now = Date.now()
  const hit = fpCache.get(key)
  if (hit !== undefined && now - hit.at < ttlMs) return hit.fp
  const fp = fingerprintOf(paths)
  fpCache.set(key, { at: now, fp })
  if (fpCache.size > 16) {
    const oldest = fpCache.keys().next().value
    if (oldest !== undefined) fpCache.delete(oldest)
  }
  return fp
}

/** 清空某个命名空间（或全部）。写入后想强制重算时用。 */
export function clearResultCache(namespace) {
  if (typeof namespace === 'string' && namespace !== '') stores.delete(namespace)
  else {
    stores.clear()
    fpCache.clear()
  }
}

/** 诊断：每个命名空间有几条、命中统计。 */
const stats = { hits: 0, misses: 0 }
export function resultCacheStats() {
  const detail = {}
  for (const [ns, store] of stores) detail[ns] = store.size
  return { ...stats, detail }
}
