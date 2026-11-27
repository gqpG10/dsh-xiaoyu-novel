/**
 * project-pack.mjs —— 3.37.0 项目打包迁移（书稿搬家）。
 *
 * 与 portable.mjs 的区别：portable 搬的是「DSH 环境」（配置/预设/技能/渠道 key），
 * 本模块搬的是「书稿本身」——novel/ 目录，以及可选的写作配置（番茄令牌/进度/发布记录）。
 *
 * 两种作用域：
 *   project —— 单个项目：manifest.json + novel/…
 *   all     —— 全部数据：manifest.json + projects/<书名>/novel/… + config/…
 *
 * 打包格式：tar.gz（复用 portable.mjs 的零依赖 buildTar/parseTar）。
 * 解包策略（用户选定 B）：永不覆盖，一律解到 novel-import-<时间戳>/，由用户自行接入。
 */

import path from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { gzipSync, gunzipSync } from 'node:zlib'
import { buildTar, parseTar } from './portable.mjs'

export const PACK_FORMAT = 1
export const PACK_MANIFEST = 'xiaoyu-pack.json'

/** 递归收集目录下所有文件（相对路径 → 绝对路径）。 */
function walkTree(absDir, relBase, out) {
  if (!existsSync(absDir)) return
  for (const name of readdirSync(absDir)) {
    // 跳过临时/备份文件
    if (/^\..*\.(tmp|bak)/.test(name) || name.endsWith('.tmp')) continue
    const abs = path.join(absDir, name)
    let st
    try { st = statSync(abs) } catch { continue }
    if (st.isDirectory()) walkTree(abs, relBase + '/' + name, out)
    else if (st.isFile()) out.push({ name: relBase + '/' + name, abs })
  }
}

/** 统计书稿规模（章节数 / 总字数）。 */
function bookStats(novelDir) {
  const chDir = path.join(novelDir, 'chapters')
  let chapters = 0
  let words = 0
  if (existsSync(chDir)) {
    for (const f of readdirSync(chDir)) {
      if (!/\.md$/i.test(f)) continue
      chapters += 1
      try {
        const t = readFileSync(path.join(chDir, f), 'utf8')
        words += (t.replace(/^---[\s\S]*?\n---\n/, '').match(/[\u4e00-\u9fa5]/g) || []).length
      } catch { /* 读不动就跳过 */ }
    }
  }
  return { chapters, words }
}

/** 读 project.yml 的书名（读不到就用目录名）。 */
function bookTitle(novelDir) {
  try {
    const raw = readFileSync(path.join(novelDir, 'project.yml'), 'utf8')
    const m = /^\s*title\s*:\s*(.+)$/m.exec(raw)
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  } catch { /* 无 project.yml */ }
  return path.basename(path.dirname(novelDir)) || '未命名'
}

/**
 * 打包。
 * @param {object} opts
 * @param {string} opts.novelDir 书目录（含 novel/ 的那一级，或直接 novel 目录）
 * @param {'project'|'all'} opts.scope
 * @param {string} [opts.dshHome] 全部数据时用于取配置
 * @param {boolean} [opts.includeSecrets=false] 是否打包番茄令牌
 * @returns {{ok:boolean, buffer?:Buffer, filename?:string, manifest?:object, error?:string}}
 */
export function packProject(opts) {
  const scope = opts.scope === 'all' ? 'all' : 'project'
  // 允许传「书根目录」或「novel 目录本身」
  let novelDir = path.resolve(opts.novelDir)
  if (path.basename(novelDir) !== 'novel' && existsSync(path.join(novelDir, 'novel'))) {
    novelDir = path.join(novelDir, 'novel')
  }
  if (!existsSync(novelDir)) return { ok: false, error: '书目录不存在：' + novelDir }

  const title = bookTitle(novelDir)
  const stats = bookStats(novelDir)
  const entries = []

  if (scope === 'project') {
    walkTree(novelDir, 'novel', entries)
  } else {
    // 全部数据：projects/<书名>/novel/…
    walkTree(novelDir, 'projects/' + title + '/novel', entries)
    // 配置：番茄令牌（可选）、进度记录
    const home = opts.dshHome
    if (home) {
      if (opts.includeSecrets) {
        const fq = path.join(home, 'xiaoyu-fanqie.json')
        if (existsSync(fq)) entries.push({ name: 'config/xiaoyu-fanqie.json', abs: fq })
      }
      const pg = path.join(home, 'xiaoyu-progress.json')
      if (existsSync(pg)) entries.push({ name: 'config/xiaoyu-progress.json', abs: pg })
    }
  }

  const manifest = {
    format: PACK_FORMAT,
    kind: 'xiaoyu-novel-pack',
    scope,
    title,
    chapters: stats.chapters,
    words: stats.words,
    createdAt: new Date().toISOString(),
    includeSecrets: !!opts.includeSecrets,
    fileCount: entries.length,
  }
  entries.push({ name: PACK_MANIFEST, abs: null, content: JSON.stringify(manifest, null, 2) })

  const tarEntries = entries.map((e) => ({
    name: e.name,
    data: e.content !== undefined ? Buffer.from(e.content, 'utf8') : readFileSync(e.abs),
    mtime: Math.floor(Date.now() / 1000),
  }))
  const gz = gzipSync(buildTar(tarEntries), { level: 9 })
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)
  const filename = (scope === 'all' ? 'xiaoyu-all-' : safeTitle + '-') + stamp + '.tar.gz'
  return { ok: true, buffer: gz, filename, manifest }
}

/**
 * 解包到目标目录（永不覆盖：目标已存在则自动加时间戳后缀）。
 * @param {Buffer} buffer tar.gz
 * @param {string} targetRoot 解包根目录（通常是工作区根）
 * @returns {{ok:boolean, dir?:string, manifest?:object, files?:number, error?:string}}
 */
export function unpackProject(buffer, targetRoot) {
  let files
  try {
    files = parseTar(gunzipSync(buffer))
  } catch (e) {
    return { ok: false, error: '不是有效的 tar.gz：' + (e && e.message ? e.message : String(e)) }
  }
  if (!files || files.length === 0) return { ok: false, error: '包是空的' }

  let manifest = null
  const mf = files.find((f) => f.name === PACK_MANIFEST)
  if (mf) { try { manifest = JSON.parse(Buffer.from(mf.data).toString('utf8')) } catch { /* 忽略 */ } }

  // 目标目录：novel-import-<时间戳>，已存在则再补序号
  const root = path.resolve(targetRoot)
  mkdirSync(root, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  let dir = path.join(root, 'novel-import-' + stamp)
  let n = 2
  while (existsSync(dir)) { dir = path.join(root, 'novel-import-' + stamp + '-' + n); n += 1 }
  mkdirSync(dir, { recursive: true })

  let written = 0
  for (const f of files) {
    if (f.name === PACK_MANIFEST) continue
    const rel = String(f.name).replace(/^\.?\//, '')
    if (rel.includes('..')) continue // 防路径穿越
    const abs = path.join(dir, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, Buffer.from(f.data))
    written += 1
  }
  // 清单也留一份在解包目录，便于用户核对来源
  if (manifest) writeFileSync(path.join(dir, PACK_MANIFEST), JSON.stringify(manifest, null, 2), 'utf8')
  return { ok: true, dir, manifest, files: written }
}
