/**
 * read-cache —— 小说项目文件读取缓存（0.5.0）
 *
 * 问题：面板每次刷新快照（parseStateSnapshot）都会重读 chapters/*.md、
 * outlines/*.md、characters/world/science/research/*.md 与全部账本 yml。
 * 19 章时无感，一百章后每开一次面板就是上百次整文件读盘；写手/审校会话里
 * 反复 read/wc 也在同一批文件上打转。文件越多越慢，越往后越明显。
 *
 * 做法：进程内按绝对路径缓存文本 + 目录项，命中前用 stat 的
 * (mtimeMs, size) 校验——文件没动就直接返回缓存，动过才重读。校验成本是
 * 一次 stat，远低于 read+parse。插件自己的写盘走 writeAtomic/删除走
 * invalidate()，所以同进程内的写入立即可见；外部（agent/作者）改文件靠
 * stat 校验发现。
 *
 * 边界：
 *   - 单文件超过 512KB 不缓存（正文极少这么大，缓存它只会白占内存）；
 *   - 总缓存默认上限 64MB，按 LRU 淘汰；
 *   - 缓存不跨进程（每次 CLI 调用是独立进程，天然从磁盘读）。
 *
 * 为什么不用文件内容哈希校验：那等于每次都读全文，缓存就失去意义。
 * mtime+size 是 Vite/webpack 同款判据，配合写入侧显式失效足够稳。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'

/** 单文件缓存上限：超过即不缓存（避免大文件挤爆内存）。 */
const MAX_ENTRY_BYTES = 512 * 1024
/** 总缓存上限：超了按 LRU 淘汰。 */
const MAX_TOTAL_BYTES = 64 * 1024 * 1024
/** 目录项缓存条数上限（每个目录一条，正常项目远达不到）。 */
const MAX_DIR_ENTRIES = 512

/** 文件缓存：绝对路径 -> { mtimeMs, size, text }（Map 迭代序即 LRU 序）。 */
const fileCache = new Map()
/** 目录缓存：绝对路径 -> { mtimeMs, names }。 */
const dirCache = new Map()

let cachedBytes = 0
let hits = 0
let misses = 0

/** 把一条文件缓存移到 LRU 末尾（最近使用）。 */
function touch(key, entry) {
  fileCache.delete(key)
  fileCache.set(key, entry)
}

/** 淘汰到总字节数回到上限以内。 */
function evictIfNeeded() {
  while (cachedBytes > MAX_TOTAL_BYTES && fileCache.size > 0) {
    const oldestKey = fileCache.keys().next().value
    const oldest = fileCache.get(oldestKey)
    cachedBytes -= oldest.text.length * 2 // UTF-16 粗估
    fileCache.delete(oldestKey)
  }
}

/**
 * 读文本 + 版本令牌（带缓存）。令牌 = mtimeMs:size，与文本同一次 stat 取出，
 * 调用方拿它做「解析结果缓存」的键：文件没动就不必重新解析。
 * 文件不存在/不是普通文件返回 null，绝不抛。
 * @param {string} absPath 绝对路径
 * @returns {{ text: string, token: string } | null}
 */
export function readEntry(absPath) {
  let st
  try {
    st = statSync(absPath)
  } catch {
    fileCache.delete(absPath)
    return null
  }
  if (!st.isFile()) return null

  const token = st.mtimeMs + ':' + st.size
  const hit = fileCache.get(absPath)
  if (hit !== undefined && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
    hits += 1
    touch(absPath, hit)
    return { text: hit.text, token }
  }

  // 超大文件不进缓存：读一次给调用方，避免白占内存
  if (st.size > MAX_ENTRY_BYTES) {
    fileCache.delete(absPath)
    try {
      return { text: readFileSync(absPath, 'utf8'), token }
    } catch {
      return null
    }
  }

  let text
  try {
    text = readFileSync(absPath, 'utf8')
  } catch {
    fileCache.delete(absPath)
    return null
  }
  misses += 1
  if (hit !== undefined) cachedBytes -= hit.text.length * 2
  const entry = { mtimeMs: st.mtimeMs, size: st.size, text }
  fileCache.set(absPath, entry)
  cachedBytes += text.length * 2
  evictIfNeeded()
  return { text, token }
}

/**
 * 读文本（带缓存）。文件不存在/不是普通文件返回 null，绝不抛。
 * @param {string} absPath 绝对路径
 * @returns {string | null}
 */
export function readTextCached(absPath) {
  const entry = readEntry(absPath)
  return entry === null ? null : entry.text
}

/**
 * 列目录（带缓存）。目录不存在返回 null，绝不抛。
 * 目录 mtime 在增删条目时会变，所以新增/删除文件能被发现。
 * @param {string} absDir 绝对路径
 * @returns {string[] | null}
 */
export function listDirCached(absDir) {
  let st
  try {
    st = statSync(absDir)
  } catch {
    dirCache.delete(absDir)
    return null
  }
  if (!st.isDirectory()) return null
  const hit = dirCache.get(absDir)
  if (hit !== undefined && hit.mtimeMs === st.mtimeMs) return hit.names
  let names
  try {
    names = readdirSync(absDir)
  } catch {
    dirCache.delete(absDir)
    return null
  }
  dirCache.delete(absDir)
  dirCache.set(absDir, { mtimeMs: st.mtimeMs, names })
  if (dirCache.size > MAX_DIR_ENTRIES) {
    const oldestKey = dirCache.keys().next().value
    dirCache.delete(oldestKey)
  }
  return names
}

/**
 * 失效单条路径（文件或目录）：写入/删除后调用，保证同进程内立即读到新内容。
 * @param {string} target 绝对路径
 */
export function invalidate(target) {
  const entry = fileCache.get(target)
  if (entry !== undefined) {
    cachedBytes -= entry.text.length * 2
    fileCache.delete(target)
  }
  dirCache.delete(target)
}

/** 失效某目录下的全部缓存（文件名列表变了 / 批量写入后）。 */
export function invalidateDir(absDir) {
  const prefix = absDir.endsWith('/') ? absDir : absDir + '/'
  for (const key of Array.from(fileCache.keys())) {
    if (key.startsWith(prefix)) {
      const entry = fileCache.get(key)
      cachedBytes -= entry.text.length * 2
      fileCache.delete(key)
    }
  }
  dirCache.delete(absDir)
}

/** 清空全部缓存（测试与「强制重读」路径用）。 */
export function clearCache() {
  fileCache.clear()
  dirCache.clear()
  cachedBytes = 0
  hits = 0
  misses = 0
}

/** 缓存诊断（测试/排查用）：命中次数、条数、占用字节。 */
export function cacheStats() {
  return { hits, misses, files: fileCache.size, dirs: dirCache.size, bytes: cachedBytes }
}
