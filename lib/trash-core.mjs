/**
 * 回收站（0.15.0）：受管文件删除不再直删，先移进 novel/.trash/<id>/。
 *
 * 目录形制（固定三层，好扫好清）：
 *   .trash/<id>/meta.json   { rel, at, bytes, kind }
 *   .trash/<id>/file        被删文件的原始字节（保持原扩展名信息不丢在 meta 里）
 * id = <YYYYMMDD>-<HHmmss>-<6 位十六进制>，字典序即时间序，列表不必再排序。
 *
 * 为什么不用「同目录 .bak」：.bak 会被章节目录遍历、账本 glob、agent 的
 * 「读全部 yml」顺手带上，等于没删干净还污染数据面；.trash 在 novel 根、
 * 只被本模块读，其它扫描器一律看不见（chapters/ 与 else 都按白名单列目录）。
 *
 * 边界：
 *   - 本模块只管搬运，不管白名单——rel 合法性由调用方（panel-core 的
 *     managedTargetOf）先行校验，这里再 resolve 一次防穿越。
 *   - 恢复不覆盖：目标已存在一律 409，宁可让用户先看一眼再决定。
 *   - 超量自动清最旧：上限 200 条，删除时顺手 prune，防回收站自己长成巨石。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const TRASH_DIR = '.trash'
const MAX_ITEMS = 200
const ID_RE = /^\d{8}-\d{6}-[0-9a-f]{6}$/

/** 生成 id：字典序即时间序；同秒内靠随机尾码去重。 */
function newId() {
  const d = new Date()
  const p = (n, w = 2) => String(n).padStart(w, '0')
  const stamp = String(d.getFullYear()) + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
  let tail = ''
  for (let i = 0; i < 6; i += 1) tail += Math.floor(Math.random() * 16).toString(16)
  return stamp + '-' + tail
}

function trashRoot(novelDir) {
  return path.join(path.resolve(novelDir), TRASH_DIR)
}

/** id 形状校验：不认就 400，绝不拿它拼路径。 */
function checkId(id) {
  const s = String(id ?? '')
  if (!ID_RE.test(s)) {
    const err = new Error('回收站条目 id 不合法：' + s)
    err.status = 400
    throw err
  }
  return s
}

function itemDir(novelDir, id) {
  const root = trashRoot(novelDir)
  const dir = path.join(root, checkId(id))
  const rel = path.relative(root, dir)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    const err = new Error('回收站路径越界')
    err.status = 403
    throw err
  }
  return dir
}

function readMeta(dir) {
  try {
    const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'))
    if (!meta || typeof meta !== 'object') return null
    if (typeof meta.rel !== 'string' || meta.rel === '') return null
    return {
      rel: meta.rel,
      at: typeof meta.at === 'string' ? meta.at : '',
      bytes: Number.isFinite(meta.bytes) ? meta.bytes : 0,
    }
  } catch {
    return null
  }
}

/**
 * 把 rel 对应的文件移进回收站。target 由调用方 resolve 过，这里再验一次落点
 * 与 novel 根的关系。成功返回 { ok, id, rel }；源不存在时抛 404 形状错误。
 */
export function moveToTrash(novelDir, rel, target) {
  const root = path.resolve(novelDir)
  const abs = path.resolve(target)
  const within = path.relative(root, abs)
  if (within === '' || within.startsWith('..') || path.isAbsolute(within)) {
    const err = new Error('回收站落点越界：' + rel)
    err.status = 403
    throw err
  }
  let size = 0
  try {
    const st = statSync(abs)
    if (!st.isFile()) {
      const err = new Error('只能回收普通文件：' + rel)
      err.status = 422
      throw err
    }
    size = st.size
  } catch (error) {
    if (error && error.status) throw error
    const err = new Error('源文件不存在：' + rel)
    err.status = 404
    throw err
  }
  const id = newId()
  const tRoot = trashRoot(novelDir)
  mkdirSync(path.join(tRoot, id), { recursive: true })
  // 回收站自己在 .gitignore 里声明忽略：书稿建过 git 的话，被删文件不该被
  // 「git add -A」再捞回去，也不该让 .trash 长进版本历史。老仓库没这条也能靠
  // 这个嵌套 .gitignore 生效（git 读子目录 .gitignore，无需改仓库根文件）。
  const selfIgnore = path.join(tRoot, '.gitignore')
  if (!existsSync(selfIgnore)) {
    try { writeFileSync(selfIgnore, '*\n', 'utf8') } catch { /* 写不进就靠仓库根 ignore */ }
  }
  const dir = path.join(tRoot, id)
  const meta = { rel: String(rel), at: new Date().toISOString(), bytes: size }
  // 先写 meta 再搬文件：中途崩了最多留个空条目（列表侧读不到 file 会跳过），
  // 不会出现「文件进了回收站但没人知道它原来叫什么」的死数据。
  writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8')
  renameSync(abs, path.join(dir, 'file'))
  pruneTrash(novelDir)
  return { ok: true, id, rel: meta.rel }
}

/**
 * 列表（新→旧）：读不到的条目跳过不报错——回收站坏了不该拖垮面板。
 */
export function listTrash(novelDir) {
  const root = trashRoot(novelDir)
  let names = []
  try {
    names = readdirSync(root)
  } catch {
    return { ok: true, items: [], total: 0, dir: TRASH_DIR }
  }
  const items = []
  for (const name of names.sort().reverse()) {
    if (!ID_RE.test(name)) continue
    const dir = path.join(root, name)
    const meta = readMeta(dir)
    if (!meta) continue
    if (!existsSync(path.join(dir, 'file'))) continue
    items.push({ id: name, rel: meta.rel, at: meta.at, bytes: meta.bytes })
    if (items.length >= MAX_ITEMS) break
  }
  return { ok: true, items, total: items.length, dir: TRASH_DIR }
}

/**
 * 恢复到原路径：目标已存在 409（不覆盖），父目录缺失先建（归档目录被手动删过
 * 也能放回去）。恢复成功即条目消失（文件搬走，meta 一并清掉）。
 */
export function restoreTrash(novelDir, id) {
  const root = path.resolve(novelDir)
  const dir = itemDir(novelDir, id)
  const meta = readMeta(dir)
  if (!meta) {
    const err = new Error('回收站条目已损坏或不存在')
    err.status = 404
    throw err
  }
  const from = path.join(dir, 'file')
  if (!existsSync(from)) {
    const err = new Error('回收站条目缺少文件本体')
    err.status = 404
    throw err
  }
  const dest = path.resolve(root, meta.rel)
  const within = path.relative(root, dest)
  if (within === '' || within.startsWith('..') || path.isAbsolute(within)) {
    const err = new Error('恢复目标越界：' + meta.rel)
    err.status = 403
    throw err
  }
  if (existsSync(dest)) {
    const err = new Error('目标位置已有同名文件，未恢复：' + meta.rel)
    err.status = 409
    throw err
  }
  mkdirSync(path.dirname(dest), { recursive: true })
  renameSync(from, dest)
  rmSync(dir, { recursive: true, force: true })
  return { ok: true, rel: meta.rel }
}

/** 彻底删除一条（二次确认在 UI）：不存在按成功处理——重复点不报错。 */
export function purgeTrash(novelDir, id) {
  const dir = itemDir(novelDir, id)
  rmSync(dir, { recursive: true, force: true })
  return { ok: true, id: checkId(id) }
}

/** 超过上限时清最旧（id 字典序即时间序）。返回清掉的条数。 */
export function pruneTrash(novelDir, keep = MAX_ITEMS) {
  const root = trashRoot(novelDir)
  let names = []
  try {
    names = readdirSync(root).filter((n) => ID_RE.test(n)).sort()
  } catch {
    return 0
  }
  const excess = names.length - Math.max(1, keep)
  if (excess <= 0) return 0
  let removed = 0
  for (const name of names.slice(0, excess)) {
    try {
      rmSync(path.join(root, name), { recursive: true, force: true })
      removed += 1
    } catch {
      /* 清单个失败不该阻断删除主流程 */
    }
  }
  return removed
}
