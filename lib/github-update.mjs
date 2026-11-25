/**
 * github-update.mjs —— 从作者自己的 GitHub 库检查并安装新版本（0.18.0）
 *
 * 为什么不用 npm：本插件是私有发行（package.json 的 dsh.privateRelease），
 * 没上 npm，lib/version.mjs 那套 registry/mirror 双源注定查不到东西——原来的
 * update-check 只能回一句「请从 GitHub Release 手动更新」。这里补上真正的
 * 私有库通路：版本源 = 仓库的 releases/latest（其次 tags），安装 = 下载该 tag
 * 的源码包解压覆盖插件目录。全程零 npm 依赖，只借系统 tar 与（可选）gh CLI。
 *
 * 五条通路，按顺序尝试，谁先拿到有效 tag 用谁：
 *   1) 环境变量 GITHUB_TOKEN / GH_TOKEN 存在 → 直接打 REST API（私有库也认）；
 *   2) 本机有已登录的 gh CLI → gh api（Android/桌面都常见，免配置 token）；
 *   3) 匿名 REST → 库公开后可用；
 *   4) raw 直读 main 分支 package.json（0.24.0 库转公开；api 被墙时 raw 往往可达）；
 *   5) 公共镜像链套 raw（XIAOYU_GH_MIRRORS 可覆盖，兜底中的兜底）。
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
import { fileURLToPath } from 'node:url'

import { isAllowedTokenTarget, resolveGithubToken, tokenMethodAllowed } from './github-token.mjs'
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

/**
 * 内嵌凭据只允许用于「钉住的」这一个仓库：拿它去打别的 slug 直接拒绝。
 * 钉住的仓库 = package.json 的 dsh.githubRepo / 环境变量 XIAOYU_GITHUB_REPO。
 * env 里 pin 为空（没配私有库）时不做限制——那种情况本来也拿不到内嵌凭据。
 */
export function isPinnedRepo(slug, pinned) {
  const target = String(slug ?? '').trim().toLowerCase()
  const pin = String(pinned ?? '').trim().toLowerCase()
  if (target === '') return false
  if (pin === '') return true
  return target === pin
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

async function restJson(url, { token = '', fetchImpl, timeoutMs = 8000, method = 'GET' } = {}) {
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch
  if (typeof doFetch !== 'function') return { ok: false, error: 'fetch 不可用' }
  // 0.24.0 修：token 缺省必须是 ''——以前缺省 undefined，`undefined !== ''`
  // 恒真，没传 token 的匿名请求（public/raw/镜像）也被当带凭据处理：要么被
  // 白名单拦死，要么发出 'Bearer undefined' 的垃圾头，匿名通路从来没通过。
  const tok = String(token ?? '').trim()
  try {
    const headers = { accept: 'application/vnd.github+json', 'user-agent': PACKAGE_NAME }
    // 凭据只发白名单主机、且只配读方法——这两道在发请求前拦，不靠调用方自觉。
    if (tok !== '') {
      if (!isAllowedTokenTarget(url)) return { ok: false, error: '凭据不许发往该地址: ' + String(url) }
      if (!tokenMethodAllowed(method)) return { ok: false, error: '凭据只用于读取，收到 ' + String(method) }
      headers.authorization = 'Bearer ' + tok
    }
    const res = await doFetch(url, { headers, method, signal: AbortSignal.timeout(timeoutMs) })
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
export async function fetchLatestGithubVersion({ repo, token = '', ghCli = true, fetchImpl, timeoutMs = 8000, pinnedRepo = '' } = {}) {
  const slug = parseRepoSlug(repo)
  // 内嵌凭据只服务钉住的那个仓库。注意必须按「解出来的实际凭据」判断，
  // 不能只看入参 token —— 入参为空时下面会用内嵌凭据，漏这条就等于没拦。
  const pinnedToken = authToken(token)
  // slug 为空时先让它落到下面的「未配置仓库」错误，别抢话
  if (slug !== '' && pinnedToken !== '' && !isPinnedRepo(slug, pinnedRepo)) return { ok: false, error: '内嵌凭据只授权 ' + String(pinnedRepo) + '，拒绝用于 ' + slug }
  if (slug === '') return { ok: false, error: '未配置 GitHub 仓库（package.json 的 repository.url 或环境变量 XIAOYU_GITHUB_REPO）' }
  // 1-5) HTTP 源并行竞速（3.19.0）：原来是串行回退——api.github.com 被墙时
  //  token/gh/public/raw 各挂满超时（4×8s+），路由层 12s 硬闸在轮到镜像前就
  //  判死「检测超时」，唯一还活着的镜像永远轮不到。改成全部同时开跑：谁先
  //  拿到有效版本谁赢；全死也在一个超时内收敛，不会卡住路由闸门。
  const useToken = pinnedToken
  const failures = []
  const settle = (tag, source, url) => {
    const version = tagToVersion(tag)
    if (version === '') return null
    return {
      ok: true,
      tag: 'v' + version,
      version,
      releaseUrl: url || 'https://github.com/' + slug + '/releases/latest',
      repo: slug,
      source,
    }
  }
  const attempts = []
  const wrap = (label, p) => p.then(
    (hit) => { if (hit === null) throw new TypeError(label + ': tag 形状非法'); return hit },
    (err) => {
      const msg = String(err?.message ?? err)
      failures.push(label + ': ' + msg)
      throw new Error(label + ': ' + msg)
    }
  )
  if (useToken !== '') {
    attempts.push(wrap('token',
      restJson('https://api.github.com/repos/' + slug + '/releases/latest', { token: useToken, fetchImpl, timeoutMs })
        .then((rel) => rel.ok ? settle(rel.data?.tag_name, 'token', rel.data?.html_url) : Promise.reject(rel.error))))
  }
  attempts.push(wrap('public',
    restJson('https://api.github.com/repos/' + slug + '/releases/latest', { fetchImpl, timeoutMs })
      .then((pub) => pub.ok ? settle(pub.data?.tag_name, 'public', pub.data?.html_url) : Promise.reject(pub.error))))
  // 4) raw 直读 main 分支的 package.json（0.24.0 库公开）：api 被墙/DNS 污染的
  //    网络里 raw 往往仍可达；main 版本号随发版同步维护，当版本源足够可信。
  attempts.push(wrap('raw-main',
    restJson('https://raw.githubusercontent.com/' + slug + '/main/package.json', { fetchImpl, timeoutMs })
      .then((rawMain) => (rawMain.ok && rawMain.data && typeof rawMain.data.version === 'string')
        ? settle('v' + rawMain.data.version, 'raw-main', 'https://github.com/' + slug + '/releases/latest')
        : Promise.reject(rawMain.error || '无 version 字段'))))
  // 5) 镜像链：raw 也被污染时的兜底。XIAOYU_GH_MIRRORS 可覆盖默认链。
  for (const mirror of resolveGhMirrors()) {
    const mUrl = mirror.replace(/\/+$/, '') + '/https://raw.githubusercontent.com/' + slug + '/main/package.json'
    attempts.push(wrap('mirror:' + mirrorHost(mirror),
      restJson(mUrl, { fetchImpl, timeoutMs: Math.min(timeoutMs, 8000) })
        .then((mres) => (mres.ok && mres.data && typeof mres.data.version === 'string')
          ? settle('v' + mres.data.version, 'mirror:' + mirrorHost(mirror), 'https://github.com/' + slug + '/releases/latest')
          : Promise.reject(mres.error || '失败'))))
  }
  // 6) Gitee 兜底（3.21.0）：GitHub 全线被墙时，国内 gitee.com 通常仍可达。
  //    仓库 = 同名镜像（gqpG10/dsh-xiaoyu-novel）；public 仓库 tags API 免凭据。
  //    XIAOYU_GITEE_REPO 可覆盖（off = 禁用）。
  const giteeRepo = resolveGiteeRepo(slug, process.env)
  if (giteeRepo !== '') {
    attempts.push(wrap('gitee-tags',
      restJson('https://gitee.com/api/v5/repos/' + giteeRepo + '/tags', { fetchImpl, timeoutMs })
        .then((gt) => {
          if (!gt.ok || !Array.isArray(gt.data)) throw new Error(gt.error || '无 tags')
          const best = pickHighestTag(gt.data.map((item) => item && item.name))
          if (best === '') throw new Error('无合法 tag')
          return settle(best, 'gitee-tags', 'https://gitee.com/' + giteeRepo + '/releases')
        })))
  }
  // 2) gh CLI 也并进竞速池；ghReady 检查放在 IIFE 里——不能在 attempts 创建与
  //  Promise.any 订阅之间留 await 空窗，否则先拒绝的源会触发 unhandledRejection
  //  杀死进程（3.19.0 实测踩坑）。
  attempts.push(wrap('gh', (async () => {
    if (!(await ghReady({ ghCli }))) return Promise.reject('gh: 未登录或不可用')
    {
      const rel = await ghApiJson('repos/' + slug + '/releases/latest', { timeoutMs })
      if (rel.ok && rel.data && typeof rel.data.tag_name === 'string') {
        const hit = settle(rel.data.tag_name, 'gh', rel.data.html_url)
        if (hit !== null) return hit
      }
      const tags = await ghApiJson('repos/' + slug + '/tags?per_page=30', { timeoutMs })
      if (tags.ok && Array.isArray(tags.data)) {
        const best = pickHighestTag(tags.data.map((item) => item && item.name))
        const hit = best === '' ? null : settle(best, 'gh-tags', 'https://github.com/' + slug + '/tags')
        if (hit !== null) return hit
      }
      return Promise.reject(rel.error || '无 release')
    }
  })()))
  try {
    return await Promise.any(attempts)
  } catch (aggregate) {
    const list = Array.isArray(aggregate?.errors) && aggregate.errors.length
      ? aggregate.errors.map((e) => String(e?.message ?? e))
      : failures
    return { ok: false, error: '私有库版本源不可达（' + list.join('；') + '）', repo: slug }
  }
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
export async function downloadTagTarball({ repo, tag, destFile, token = '', ghCli = true, fetchImpl, timeoutMs = 60000, pinnedRepo = '' } = {}) {
  const slug = parseRepoSlug(repo)
  // 与版本检测同口径：按「解出来的实际凭据」判断钉库，空入参不能绕过。
  const pinnedTokenDl = authToken(token)
  if (pinnedTokenDl !== '' && !isPinnedRepo(slug, pinnedRepo)) return { ok: false, error: '内嵌凭据只授权 ' + String(pinnedRepo) + '，拒绝用于 ' + slug }
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
  // 2-4) 并行竞速下载（3.19.0）：原来是串行——api 被墙时 REST 挂满 timeoutMs
  //  （默认 60s）才轮到 codeload/镜像，进度条卡死。改成 REST（带/不带凭据）、
  //  codeload 直连、镜像链全部同时开跑，各自下到独立临时文件，第一个校验
  //  通过的落盘胜出，其余中止并清理。
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch
  if (typeof doFetch !== 'function') return { ok: false, error: 'fetch 不可用' }
  const errors = []
  const attempts = []
  let won = false
  const destDir = path.dirname(destFile)
  const destBase = path.basename(destFile)
  let seq = 0
  const attempt = (label, url, headers = {}) => {
    const ac = new AbortController()
    const part = path.join(destDir, '.' + destBase + '.part' + (++seq))
    return (async () => {
      const res = await doFetch(url, {
        headers: { 'user-agent': PACKAGE_NAME, ...headers },
        redirect: 'follow',
        signal: ac.signal,
      })
      if (!res.ok || !res.body) throw new Error(label + ': HTTP ' + res.status)
      await pipeline(res.body, createWriteStream(part))
      const size = await fileSize(part)
      if (size <= 1024) throw new Error(label + ': 下载内容过小（' + size + ' 字节）')
      if (won) throw new Error(label + ': 其他通路已先完成')
      won = true
      await rename(part, destFile)
      return { ok: true, bytes: size, via: label }
    })().catch((err) => {
      const msg = String(err?.message ?? err)
      if (!won) errors.push(label + ': ' + msg)
      throw err
    }).finally(async () => {
      if (!won) await rm(part, { force: true }).catch(() => {})
      else ac.abort() // 胜出后掐断还在跑的通路——注意 finally 在 ac.abort 之后注册的分支
    })
  }
  // REST tarball：私有库唯一通路；公开库也常用（302 到 codeload）。
  const useToken = pinnedTokenDl
  const restHeaders = {}
  const apiUrl = 'https://api.github.com/repos/' + slug + '/tarball/' + fullTag
  if (useToken !== '') {
    if (!isAllowedTokenTarget(apiUrl)) return { ok: false, error: '凭据不许发往该地址' }
    restHeaders.authorization = 'Bearer ' + useToken
  }
  attempts.push(attempt('rest' + (useToken !== '' ? '-token' : ''), apiUrl, restHeaders))
  // codeload 直连（0.24.0 库公开后可用）：api 被墙的网络里 codeload 往往仍可达。
  attempts.push(attempt('codeload-direct', 'https://codeload.github.com/' + slug + '/tar.gz/refs/tags/' + fullTag))
  // 镜像链：把 archive 地址套一层公共镜像。XIAOYU_GH_MIRRORS 可覆盖。
  for (const mirror of resolveGhMirrors()) {
    const mUrl = mirror.replace(/\/+$/, '') + '/https://github.com/' + slug + '/archive/refs/tags/' + fullTag + '.tar.gz'
    attempts.push(attempt('mirror:' + mirrorHost(mirror), mUrl))
  }
  // Gitee 兜底下载（3.21.0）：国内直连 gitee.com 通常可达。
  const giteeSlug = resolveGiteeRepo(slug, process.env)
  if (giteeSlug !== '') {
    attempts.push(attempt('gitee', 'https://gitee.com/' + giteeSlug + '/repository/archive/' + fullTag + '.tar.gz'))
  }
  try {
    return await Promise.any(attempts)
  } catch (aggregate) {
    return { ok: false, error: 'tarball 全通路失败（' + errors.join('；') + '）' }
  }
}

/** 镜像域名（source 标签与排障信息用）；解析失败就原样返回。 */
function mirrorHost(mirror) {
  try { return new URL(mirror).host } catch { return String(mirror) }
}

/**
 * 公共镜像链（0.24.0）：raw 直读不通时的兜底。公共镜像漂得快，死一条只是跳
 * 过；XIAOYU_GH_MIRRORS（逗号分隔）可整链覆盖。
 */
export const DEFAULT_GH_MIRRORS = ['https://gh-proxy.com/', 'https://ghfast.top/', 'https://ghproxy.net/', 'https://github.moeyy.xyz/']

/**
 * Gitee 镜像仓库（3.21.0）：GitHub 全被墙时的国内兜底源。默认与 GitHub 仓库
 * 同名（owner/repo 原样搬），XIAOYU_GITEE_REPO 可覆盖；'off' 显式禁用。
 * 返回 'owner/repo' 形状，空串 = 未启用。
 */
export function resolveGiteeRepo(githubSlug, env = process.env) {
  const raw = String(env?.XIAOYU_GITEE_REPO ?? '').trim()
  if (raw.toLowerCase() === 'off') return ''
  if (raw !== '') {
    const slug = parseRepoSlug(raw)
    return slug !== '' ? slug : ''
  }
  // 官方镜像位置（作者维护）：Gitee 账号与 GitHub 不同名，写死兜底路径。
  // GitHub 仓库不可达时按这个名字找镜像；镜像缺失时该源静默失败不碍事。
  return 'gqp20031110/dsh-xiaoyu-novel'
}

export function resolveGhMirrors(env = process.env) {
  const raw = String(env?.XIAOYU_GH_MIRRORS ?? '').trim()
  if (raw === '') return DEFAULT_GH_MIRRORS.slice()
  const list = raw.split(',').map((item) => item.trim().replace(/\/+$/, '')).filter((item) => item !== '')
  return list.length > 0 ? list : DEFAULT_GH_MIRRORS.slice()
}

/** GET 一个 URL 把响应体落到 destFile，成功返回 { ok, bytes, status }。 */
async function fetchToFile(url, destFile, { fetchImpl, headers = {}, timeoutMs = 60000 } = {}) {
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch
  if (typeof doFetch !== 'function') return { ok: false, error: 'fetch 不可用', status: 0 }
  try {
    const res = await doFetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok || !res.body) return { ok: false, error: 'HTTP ' + res.status, status: res.status }
    await pipeline(res.body, createWriteStream(destFile))
    const size = await fileSize(destFile)
    if (size <= 1024) return { ok: false, error: '下载内容过小（' + size + ' 字节）', status: res.status }
    return { ok: true, bytes: size, status: res.status }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err), status: 0 }
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

/**
 * 插件根目录（本文件在 lib/ 下）。
 *
 * 必须用 fileURLToPath，不能用 new URL(url).pathname——后者在 Windows 上返回
 * `/C:/Users/...`（**带前导斜杠且百分号未解码**），再喂给 path.resolve 就变成
 * `C:\C:\Users\...` 这种不存在的路径。包根读不到 → package.json 读不到 →
 * 「当前版本」恒为 fallback → updateAvailable 恒 false → 面板上就是「检测更新
 * 没反应」。Linux/macOS 上两种写法等价，所以这个 bug 只在 Windows 暴露。
 */
export function pluginRootOf(moduleUrl) {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), '..')
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
