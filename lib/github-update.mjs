/**
 * github-update.mjs —— 从作者自己的 GitHub 库检查并安装新版本（0.18.0）
 *
 * 为什么不用 npm：本插件是私有发行（package.json 的 dsh.privateRelease），
 * 没上 npm，lib/version.mjs 那套 registry/mirror 双源注定查不到东西——原来的
 * update-check 只能回一句「请从 GitHub Release 手动更新」。这里补上真正的
 * 私有库通路：版本源 = 仓库的 releases/latest（其次 tags），安装 = 下载该 tag
 * 的源码包解压覆盖插件目录。全程零 npm 依赖，只借系统 tar 与（可选）gh CLI。
 *
 * 三条通路，按顺序尝试，谁先拿到有效 tag 用谁：
 *   1) 环境变量 GITHUB_TOKEN / GH_TOKEN 存在 → 直接打 REST API（私有库也认）；
 *   2) 本机有已登录的 gh CLI → gh api（Android/桌面都常见，免配置 token）；
 *   3) 匿名 REST → 只对公开库有效（私有库会 404，按失败走下一级）。
 *
 * 安装安全口径（缺一不可）：
 *   - 只认 semver 形状的 tag（复用 version.mjs 的 isValidVersion），脏串不进
 *     路径、不进参数；
 *   - 解压后先校验 package.json 的 name 与 version，对不上就不动现网目录；
 *   - 覆盖前把整份插件目录复制到 <backupRoot>/<包名>-<旧版本>-<时间戳>/；
 *   - 覆盖只删「包里有的顶层条目之外」的旧文件，保留 .git（开发副本别把历史
 *     抹了）与 node_modules；
 *   - 解压用系统 tar 的 execFile（无 shell），不拼命令行。
 */
import { execFile } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import { resolveGithubToken } from './github-token.mjs'
import { isValidVersion } from './version.mjs'

/** 包名（与 package.json 一致，用于解压后校验与备份目录命名）。 */
export const PACKAGE_NAME = 'dsh-xiaoyu-novel'
/** 覆盖时永远保留的顶层条目（开发副本的 git 历史、依赖目录）。 */
export const KEEP_ENTRIES = ['.git', 'node_modules', '.DS_Store']

/**
 * 从 package.json 的 repository.url / dsh.githubRepo / 环境变量解析 "owner/repo"。
 * 认 https、git+https、git@github.com: 三种写法与裸 slug；认不出返回空串。
 */
export function parseRepoSlug(value) {
  const raw = String(value ?? '').trim().replace(/^git\+/, '')
  if (raw === '') return ''
  const ssh = /^git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/.exec(raw)
  if (ssh !== null) return ssh[1] + '/' + ssh[2].replace(/\.git$/, '')
  const url = /^(?:https?:\/\/|ssh:\/\/)[^/]+\/([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(raw)
  if (url !== null) return url[1] + '/' + url[2].replace(/\.git$/, '')
  const slug = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(raw)
  if (slug !== null) return slug[1] + '/' + slug[2]
  return ''
}

/**
 * 仓库解析优先级：显式 pkg.dsh.githubRepo → repository.url → 环境变量 →
 * 空串（空串＝没配私有库，调用方回落到 npm 那套老逻辑）。
 */
export function resolveGithubRepo(pkg, env = {}) {
  // 逃生开关：XIAOYU_GITHUB_REPO=off 强制关掉私有库通路（离线环境 / 想回退到
  // npm 那套老逻辑时用）。否则这一步会一路走到外网请求。
  if (String(env.XIAOYU_GITHUB_REPO || '').trim().toLowerCase() === 'off') return ''
  const fromPkg = parseRepoSlug(pkg?.dsh?.githubRepo) || parseRepoSlug(pkg?.repository?.url) || parseRepoSlug(pkg?.repository)
  if (fromPkg !== '') return fromPkg
  return parseRepoSlug(env.XIAOYU_GITHUB_REPO) || ''
}

/** tag → 纯版本号（剥 v/V 前缀）；形状不合法返回空串。 */
export function tagToVersion(tag) {
  const clean = String(tag ?? '').trim().replace(/^[vV]/, '')
  return isValidVersion(clean) ? clean : ''
}

function run(command, args, { timeoutMs = 20000, cwd } = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, cwd, maxBuffer: 8 * 1024 * 1024, env: process.env }, (error, stdout, stderr) => {
      if (error) {
        const code = error.code === 'ENOENT' ? 'ENOENT' : String(error.code ?? error.signal ?? 'ERR')
        resolve({ ok: false, code, error: String(stderr || error.message || '').trim() })
        return
      }
      resolve({ ok: true, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

/** gh CLI 是否可用且已登录（一次探测，失败即当没有）。 */
async function ghReady(opts = {}) {
  if (opts.ghCli === false) return false
  const res = await run(opts.ghCommand || 'gh', ['auth', 'status'], { timeoutMs: 8000 })
  return res.ok
}

async function ghApiJson(apiPath, opts = {}) {
  const res = await run(opts.ghCommand || 'gh', ['api', apiPath], { timeoutMs: opts.timeoutMs ?? 10000 })
  if (!res.ok) return { ok: false, error: 'gh api 失败: ' + res.error }
  try {
    return { ok: true, data: JSON.parse(res.stdout) }
  } catch (err) {
    return { ok: false, error: 'gh api 响应解析失败: ' + String(err?.message ?? err) }
  }
}

/**
 * 取凭据：显式传入 > 环境变量 > 内嵌凭据（lib/github-token.mjs）。
 * 内嵌那条是多端使用的地基——每台设备不必再 yy 一遍 gh login。
 */
function authToken(explicit = '', env = process.env) {
  const given = String(explicit || '').trim()
  if (given !== '') return given
  return resolveGithubToken(env).token
}

async function restJson(url, { token, fetchImpl, timeoutMs = 8000 } = {}) {
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch
  if (typeof doFetch !== 'function') return { ok: false, error: 'fetch 不可用' }
  try {
    const headers = { accept: 'application/vnd.github+json', 'user-agent': PACKAGE_NAME }
    if (token !== '') headers.authorization = 'Bearer ' + token
    const res = await doFetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return { ok: false, error: 'GitHub HTTP ' + res.status }
    return { ok: true, data: await res.json() }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}

/**
 * 查最新版本 tag。返回 { ok, tag, version, releaseUrl, source } 或 { ok:false, error }。
 * source 记录命中通路（token / gh / public），排障时一眼看得出是没登录还是没发布。
 */
export async function fetchLatestGithubVersion({ repo, token = '', ghCli = true, fetchImpl, timeoutMs = 8000 } = {}) {
  const slug = parseRepoSlug(repo)
  if (slug === '') return { ok: false, error: '未配置 GitHub 仓库（package.json 的 repository.url 或环境变量 XIAOYU_GITHUB_REPO）' }
  const failures = []
  const settle = (tag, source, url) => {
    const version = tagToVersion(tag)
    if (version === '') {
      failures.push(source + ': tag 形状非法「' + String(tag) + '」')
      return null
    }
    return {
      ok: true,
      tag: 'v' + version,
      version,
      releaseUrl: url || 'https://github.com/' + slug + '/releases/latest',
      repo: slug,
      source,
    }
  }
  // 1) 有 token 直接走 REST（私有库唯一稳的匿名进不去的路）
  const useToken = authToken(token)
  if (useToken !== '') {
    const rel = await restJson('https://api.github.com/repos/' + slug + '/releases/latest', { token: useToken, fetchImpl, timeoutMs })
    if (rel.ok) {
      const hit = settle(rel.data?.tag_name, 'token', rel.data?.html_url)
      if (hit !== null) return hit
    } else {
      failures.push('token release: ' + rel.error)
    }
  }
  // 2) 已登录的 gh CLI（Android 与桌面常用，免配 token）
  if (await ghReady({ ghCli })) {
    const rel = await ghApiJson('repos/' + slug + '/releases/latest', { timeoutMs })
    if (rel.ok && rel.data && typeof rel.data.tag_name === 'string') {
      const hit = settle(rel.data.tag_name, 'gh', rel.data.html_url)
      if (hit !== null) return hit
    } else {
      // 没发 Release 也要能用：退回 tags 列表取最高版本
      const tags = await ghApiJson('repos/' + slug + '/tags?per_page=30', { timeoutMs })
      if (tags.ok && Array.isArray(tags.data)) {
        const best = pickHighestTag(tags.data.map((item) => item && item.name))
        const hit = best === '' ? null : settle(best, 'gh-tags', 'https://github.com/' + slug + '/tags')
        if (hit !== null) return hit
      }
      failures.push('gh: ' + (rel.error || '无 release'))
    }
  } else {
    failures.push('gh: 未登录或不可用')
  }
  // 3) 匿名 REST：只有公开库能过
  const pub = await restJson('https://api.github.com/repos/' + slug + '/releases/latest', { fetchImpl, timeoutMs })
  if (pub.ok) {
    const hit = settle(pub.data?.tag_name, 'public', pub.data?.html_url)
    if (hit !== null) return hit
  } else {
    failures.push('public: ' + pub.error)
  }
  return { ok: false, error: '私有库版本源不可达（' + failures.join('；') + '）', repo: slug }
}

/** 从一堆 tag 里挑最高的合法版本（没有合法的返回空串）。 */
export function pickHighestTag(tags) {
  let best = ''
  let bestParts = null
  for (const tag of Array.isArray(tags) ? tags : []) {
    const version = tagToVersion(tag)
    if (version === '') continue
    const parts = version.split('-')[0].split('.').map((n) => Number(n))
    if (bestParts === null || cmpParts(parts, bestParts) > 0) {
      best = 'v' + version
      bestParts = parts
    }
  }
  return best
}

function cmpParts(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0)
  }
  return 0
}

/**
 * 下载某个 tag 的源码包到 destFile。私有库走 gh api（认证转发），公开库回落到
 * codeload 直连。返回 { ok } 或 { ok:false, error }。
 */
export async function downloadTagTarball({ repo, tag, destFile, token = '', ghCli = true, fetchImpl, timeoutMs = 60000 } = {}) {
  const slug = parseRepoSlug(repo)
  const version = tagToVersion(tag)
  if (slug === '' || version === '') return { ok: false, error: '仓库或 tag 不合法' }
  const fullTag = 'v' + version
  await mkdir(path.dirname(destFile), { recursive: true })
  // 1) gh api 直落文件（认证 + 跟随重定向都由 gh 处理；私有库唯一通路）
  if (await ghReady({ ghCli })) {
    // 走 buffer 模式收全量再落盘：实测把 gh 的 stdout 直接 pipe 到文件时，本机
    // 的 gh 包装会走完全不同的慢路径（60s 超时被 SIGTERM，拿到的也不是同一份
    // 字节）；buffer 模式秒回且字节数与 `gh api ... > f.tar.gz` 完全一致。
    const res = await new Promise((resolve) => {
      execFile(process.env.XIAOYU_GH_BIN || 'gh', ['api', 'repos/' + slug + '/tarball/' + fullTag], { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' }, (error, stdout, stderr) => {
        if (error) {
          resolve({ ok: false, error: String(stderr || error.message || '').trim() || String(error.message) })
          return
        }
        resolve({ ok: true, buffer: stdout })
      })
    })
    if (res.ok && res.buffer && res.buffer.length > 1024) {
      await writeFile(destFile, res.buffer)
      return { ok: true, bytes: res.buffer.length, via: 'gh' }
    }
  }
  // 2) 走 REST 拿 tarball 的 302 再跟随（私有库 codeload 直连会 404，
  //    但 api.github.com 带 token 的 tarball 端点会给出带签名的跳转地址）
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch
  if (typeof doFetch !== 'function') return { ok: false, error: 'fetch 不可用' }
  try {
    const headers = { 'user-agent': PACKAGE_NAME }
    const useToken = authToken(token)
    if (useToken !== '') headers.authorization = 'Bearer ' + useToken
    const apiUrl = 'https://api.github.com/repos/' + slug + '/tarball/' + fullTag
    const res = await doFetch(apiUrl, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok || !res.body) return { ok: false, error: 'GitHub tarball HTTP ' + res.status }
    await pipeline(res.body, createWriteStream(destFile))
    const size = await fileSize(destFile)
    if (size <= 1024) return { ok: false, error: '下载内容过小（' + size + ' 字节）' }
    return { ok: true, bytes: size, via: 'codeload' }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}

async function fileSize(abs) {
  try {
    const st = await stat(abs)
    return st.size
  } catch {
    return 0
  }
}

/**
 * 纯 JS 解 tar.gz 到 destDir，并剥掉压缩包顶层目录（GitHub 的 tarball 固定
 * 是 `<owner>-<repo>-<sha>/...`）。
 *
 * 为什么不调系统 tar：多端使用时不保证每台都有 tar（精简容器 / 某些安卓
 * 发行版），而 node 自带的 zlib 就够了。只处理 GitHub tarball 会出现的
 * 情况：ustar 头 + 普通文件 + 目录 + 符号链接 + GNU 长文件名（L/K）。
 */
export async function extractTarballJs(file, destDir) {
  const { gunzipSync } = await import('node:zlib')
  const { readFile: readF, writeFile: writeF, mkdir: mkdirF, symlink } = await import('node:fs/promises')
  const raw = gunzipSync(await readF(file))
  await mkdirF(destDir, { recursive: true })
  let offset = 0
  let longName = null
  let longLink = null
  let files = 0
  while (offset + 512 <= raw.length) {
    const header = raw.subarray(offset, offset + 512)
    // 全零块＝归档结束（之后可能还有补齐块，直接停）
    if (header.every((byte) => byte === 0)) break
    const field = (start, len) => header.subarray(start, start + len).toString('utf8').replace(/\0.*$/s, '')
    const name = field(0, 100)
    const sizeText = field(124, 12).trim()
    const size = sizeText === '' ? 0 : parseInt(sizeText, 8)
    const type = header.subarray(156, 157).toString('utf8') || '0'
    const prefix = field(345, 155)
    const linkName = field(157, 100)
    const dataStart = offset + 512
    const dataEnd = dataStart + (Number.isFinite(size) ? size : 0)
    offset = dataEnd + ((512 - (dataEnd % 512)) % 512)
    if (type === 'L') { longName = raw.subarray(dataStart, dataEnd).toString('utf8').replace(/\0+$/, ''); continue }
    if (type === 'K') { longLink = raw.subarray(dataStart, dataEnd).toString('utf8').replace(/\0+$/, ''); continue }
    const fullName = longName !== null ? longName : (prefix !== '' ? prefix + '/' + name : name)
    longName = null
    if (fullName === '') continue
    const parts = fullName.split('/')
    if (parts.length < 2) continue // 顶层目录条目本身，剥掉
    const rel = parts.slice(1).join('/')
    if (rel === '') continue
    const target = path.join(destDir, rel)
    // 目录穿越防护：解出来的路径必须还在 destDir 里
    if (!target.startsWith(path.resolve(destDir) + path.sep)) continue
    if (type === '5') { await mkdirF(target, { recursive: true }); continue }
    if (type === '2') {
      await mkdirF(path.dirname(target), { recursive: true })
      await symlink(longLink !== null ? longLink : linkName, target).catch(() => {})
      longLink = null
      continue
    }
    if (type !== '0' && type !== '\0' && type !== '7') continue
    await mkdirF(path.dirname(target), { recursive: true })
    await writeF(target, raw.subarray(dataStart, dataEnd))
    files += 1
  }
  if (files === 0) return { ok: false, error: '压缩包里没有文件（格式不认识？）' }
  return { ok: true, files }
}

/**
 * 解压 tarball 到 destDir：优先纯 JS（零外部依赖），万一遇到怪格式再退到
 * 系统 tar。两路都失败才算失败。
 */
async function extractTarball(file, destDir) {
  try {
    const viaJs = await extractTarballJs(file, destDir)
    if (viaJs.ok) return viaJs
  } catch (err) {
    // 落到系统 tar 再试一次（例如压缩方法不是 gzip 的怪包）
  }
  const res = await run('tar', ['-xzf', file, '-C', destDir, '--strip-components=1'], { timeoutMs: 120000 })
  if (!res.ok) return { ok: false, error: '解压失败: ' + res.error }
  return { ok: true, files: -1 }
}

function stamp(now) {
  const d = now instanceof Date ? now : new Date()
  const p = (n) => String(n).padStart(2, '0')
  return String(d.getFullYear()) + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
}

/**
 * 安装指定 tag：下载 → 解压 → 校验 → 备份 → 覆盖。返回结构化结果，绝不抛错
 * （调用方是面板路由，失败要能原样回给用户）。
 */
export async function applyGithubUpdate(options = {}) {
  const {
    repo,
    tag,
    pluginRoot,
    backupRoot,
    token = '',
    ghCli = true,
    fetchImpl,
    timeoutMs = 60000,
    now,
    keepEntries = KEEP_ENTRIES,
    // 已下好的源码包（测试与离线安装用）：给了就跳过下载，其余步骤一模一样。
    tarballFile = '',
  } = options
  const slug = parseRepoSlug(repo)
  const version = tagToVersion(tag)
  if (slug === '' || version === '') return { ok: false, kind: 'bad-target', error: '仓库或目标版本不合法' }
  if (typeof pluginRoot !== 'string' || pluginRoot === '') return { ok: false, kind: 'unsupported-layout', error: '拿不到插件目录' }
  const root = path.resolve(pluginRoot)
  if (!existsSync(path.join(root, 'package.json'))) {
    return { ok: false, kind: 'unsupported-layout', error: '插件目录里没有 package.json：' + root }
  }
  const from = await readVersion(root)
  const work = await mkdtemp(path.join(os.tmpdir(), 'xiaoyu-gh-'))
  const tarball = path.join(work, 'src.tar.gz')
  const unpacked = path.join(work, 'pkg')
  try {
    if (tarballFile !== '') {
      await cp(tarballFile, tarball)
    } else {
      const downloaded = await downloadTagTarball({ repo: slug, tag: version, destFile: tarball, token, ghCli, fetchImpl, timeoutMs })
      if (!downloaded.ok) return { ok: false, kind: 'download-failed', error: downloaded.error, repo: slug, tag: 'v' + version }
    }
    const extracted = await extractTarball(tarball, unpacked)
    if (!extracted.ok) return { ok: false, kind: 'extract-failed', error: extracted.error }
    const pkgFile = path.join(unpacked, 'package.json')
    if (!existsSync(pkgFile)) return { ok: false, kind: 'bad-package', error: '源码包里没有 package.json' }
    let pkg = null
    try {
      pkg = JSON.parse(await readFile(pkgFile, 'utf8'))
    } catch (err) {
      return { ok: false, kind: 'bad-package', error: '源码包 package.json 解析失败: ' + String(err?.message ?? err) }
    }
    if (pkg?.name !== PACKAGE_NAME) return { ok: false, kind: 'bad-package', error: '源码包不是 ' + PACKAGE_NAME + '（' + String(pkg?.name) + '）' }
    if (tagToVersion(pkg?.version) !== version) {
      return { ok: false, kind: 'bad-package', error: '源码包版本 ' + String(pkg?.version) + ' 与 tag v' + version + ' 不一致' }
    }
    // 备份：整份复制（排除 node_modules 与 .git，省时间；这两样本来也不覆盖）
    const backupDir = path.join(backupRoot || path.join(path.dirname(root), '.backup'), PACKAGE_NAME + '-' + (from || 'unknown') + '-' + stamp(now))
    await mkdir(backupDir, { recursive: true })
    await cp(root, backupDir, {
      recursive: true,
      force: true,
      filter: (src) => {
        const rel = path.relative(root, src)
        if (rel === '') return true
        const top = rel.split(path.sep)[0]
        return keepEntries.indexOf(top) === -1
      },
    })
    // 覆盖：先删旧顶层条目（保留 keepEntries），再把新树逐条搬进去
    const incoming = await readdir(unpacked)
    for (const name of await readdir(root)) {
      if (keepEntries.indexOf(name) !== -1) continue
      if (incoming.indexOf(name) !== -1) continue
      await rm(path.join(root, name), { recursive: true, force: true })
    }
    for (const name of incoming) {
      const src = path.join(unpacked, name)
      const dest = path.join(root, name)
      await rm(dest, { recursive: true, force: true })
      try {
        await rename(src, dest)
      } catch (err) {
        // 临时目录与插件目录常在不同挂载点（/tmp 与 /root），rename 会 EXDEV；
        // 这时退回复制再删，语义相同只是慢一点。
        if (err && (err.code === 'EXDEV' || err.code === 'EPERM')) {
          await cp(src, dest, { recursive: true, force: true })
          await rm(src, { recursive: true, force: true })
        } else {
          throw err
        }
      }
    }
    const to = await readVersion(root)
    return {
      ok: true,
      kind: 'installed',
      repo: slug,
      tag: 'v' + version,
      from: from || '?',
      to: to || version,
      backupDir,
      restartRequired: true,
    }
  } catch (err) {
    return { ok: false, kind: 'failed', error: String(err?.message ?? err) }
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}

async function readVersion(root) {
  try {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
    return typeof pkg?.version === 'string' ? pkg.version : ''
  } catch {
    return ''
  }
}

/** 插件根目录（本文件在 lib/ 下）。 */
export function pluginRootOf(moduleUrl) {
  return path.resolve(path.dirname(new URL(moduleUrl).pathname), '..')
}

/** 读 package.json（路由用；失败返回 null）。 */
export async function readPluginPackage(moduleUrl) {
  try {
    return JSON.parse(await readFile(path.join(pluginRootOf(moduleUrl), 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

/** 写一个标记文件，方便用户/支持排查「上次更新到哪」。从不抛错。 */
export async function recordUpdate(dir, payload) {
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'last-update.json'), JSON.stringify(payload, null, 2), 'utf8')
  } catch {
    /* 记录失败不影响更新结果 */
  }
}
