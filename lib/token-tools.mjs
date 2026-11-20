/**
 * token-tools.mjs —— 内嵌凭据的写入与体检（0.20.0）
 *
 * 为什么要这两个函数：内嵌凭据是写在源码里的，手动改就要人肉做 XOR + base64 +
 * 分块，容易改错还容易把明文留在编辑器里。这里给两条 CLI 用：
 *   - writeEmbeddedToken：把任意 PAT 重新编码写回 lib/github-token.mjs
 *     （保留文件头注释与其余导出，只替换 PARTS 数组）；
 *   - inspectToken：拿这份凭据实际打一次 GitHub，读出它到底能干什么
 *     （/repos/<slug> 是否可读、/repos/<slug> 是否可写、别的库能不能读），
 *     用来验证「是不是真的只授了这一个仓库的 Contents: Read」。
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** 与 lib/github-token.mjs 里的 KEY 必须一致（改一处必须改两处，测试会拦）。 */
export const TOKEN_KEY = 'xiaoyu-novel-2026-embedded'

/** 把 token 编成分块 base64 字面量（与模块里的 PARTS 同格式）。 */
export function encodeTokenParts(token, key = TOKEN_KEY, chunkSize = 12) {
  const buf = Buffer.from(String(token), 'utf8')
  const out = Buffer.alloc(buf.length)
  for (let i = 0; i < buf.length; i += 1) out[i] = buf[i] ^ key.charCodeAt(i % key.length)
  const b64 = out.toString('base64')
  const parts = []
  for (let i = 0; i < b64.length; i += chunkSize) parts.push(b64.slice(i, i + chunkSize))
  return parts
}

/**
 * 把 token 写回 lib/github-token.mjs：只替换 PARTS 数组，其余一字不动。
 * 写前把原文件 .bak 一份；写后立刻用同一份密钥解回来对账，对不上就不写。
 */
export async function writeEmbeddedToken(modulePath, token, key = TOKEN_KEY) {
  const text = String(token ?? '').trim()
  if (!/^[A-Za-z0-9_]{20,255}$/.test(text)) return { ok: false, error: '令牌形状不合法（要么复制少了，要么不是 GitHub 令牌）' }
  const parts = encodeTokenParts(text, key)
  let source = ''
  try {
    source = await readFile(modulePath, 'utf8')
  } catch (err) {
    return { ok: false, error: '读不到 ' + modulePath + ': ' + String(err?.message ?? err) }
  }
  const block = 'const PARTS = [' + String.fromCharCode(10) + parts.map((part) => "  '" + part + "',").join(String.fromCharCode(10)) + String.fromCharCode(10) + ']'
  const pattern = /const PARTS = \[[\s\S]*?\]/
  if (!pattern.test(source)) return { ok: false, error: '模块里找不到 PARTS 数组，不敢盲改' }
  const next = source.replace(pattern, block)
  // 对账：用同一份代码解回来必须等于原串
  const back = Buffer.from(parts.join(''), 'base64')
  const plain = Buffer.alloc(back.length)
  for (let i = 0; i < back.length; i += 1) plain[i] = back[i] ^ key.charCodeAt(i % key.length)
  if (plain.toString('utf8') !== text) return { ok: false, error: '编码往返不一致，放弃写入' }
  await writeFile(modulePath + '.bak', source, 'utf8')
  await writeFile(modulePath, next, 'utf8')
  return { ok: true, path: modulePath, bytes: next.length, parts: parts.length, backup: path.basename(modulePath) + '.bak' }
}

/**
 * 体检：这份凭据实际能读/能写什么。
 * 三个探针（全是只读请求，除了那个明确的写探针——写探针失败才是我们要的结果）：
 *   1) 目标库可读？   GET /repos/<slug>
 *   2) 目标库可写？   （用 PUT /repos/<slug>/contents/ 空 body：没有 Contents:Write
 *      会 403/404；有 Write 会 400/422 —— 只要不是 403/404 就说明有写权限）
 *   3) 别的库可读？   GET /repos/<other>
 */
export async function inspectToken({ token, repo, otherRepo = 'gqpG10/xiaoyu-armor', fetchImpl, timeoutMs = 8000 } = {}) {
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch
  if (typeof doFetch !== 'function') return { ok: false, error: 'fetch 不可用' }
  const slug = String(repo ?? '').trim()
  if (slug === '') return { ok: false, error: '缺少 repo' }
  const headers = { accept: 'application/vnd.github+json', authorization: 'Bearer ' + String(token ?? '') }
  let lastScopes = ''
  const probe = async (url, init = {}) => {
    try {
      const res = await doFetch(url, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) })
      const scopeHeader = res.headers && typeof res.headers.get === 'function' ? res.headers.get('x-oauth-scopes') : ''
      if (scopeHeader) lastScopes = scopeHeader
      return { status: res.status, ok: res.ok }
    } catch (err) {
      return { status: 0, ok: false, error: String(err?.message ?? err) }
    }
  }
  const readTarget = await probe('https://api.github.com/repos/' + slug)
  const readOther = await probe('https://api.github.com/repos/' + otherRepo)
  // 写权限用「零副作用」的判据读：GET /repos/<slug> 的 permissions 字段，
  // 以及响应头 x-oauth-scopes。绝不用 PUT/POST 探针——凭据是只读设计的，
  // 体检本身就不该有写副作用（早先版本用 PUT 探针，属于设计错误）。
  let permissions = null
  try {
    const res = await doFetch('https://api.github.com/repos/' + slug, { headers, signal: AbortSignal.timeout(timeoutMs) })
    if (res.ok) {
      const body = await res.json()
      if (body && typeof body.permissions === 'object' && body.permissions !== null) permissions = body.permissions
    }
  } catch { /* permissions 拿不到就按「不知道」处理 */ }
  const scopesHeader = String(lastScopes || '')
  const canWrite = permissions === null
    ? /(^|,\s*)(repo|write:)/.test(scopesHeader)
    : permissions.push === true || permissions.admin === true || permissions.maintain === true
  return {
    ok: true,
    repo: slug,
    canReadTarget: readTarget.ok,
    canReadOther: readOther.ok,
    canWriteTarget: canWrite,
    permissions,
    scopes: scopesHeader,
    statuses: { target: readTarget.status, other: readOther.status },
    minimal: readTarget.ok && !canWrite && !readOther.ok,
  }
}

/** 体检结果的结论行（CLI 直接打）。 */
export function describeInspection(result) {
  if (!result || result.ok !== true) return '体检失败：' + String(result && result.error)
  const lines = []
  lines.push('  ' + result.repo + ' 可读：' + (result.canReadTarget ? '是' : '否'))
  lines.push('  ' + result.repo + ' 可写：' + (result.canWriteTarget ? '是（不理想）' : '否（正是要的）'))
  lines.push('  其他仓库可读：' + (result.canReadOther ? '是（权限过大）' : '否（已隔离）'))
  lines.push('')
  lines.push(result.minimal ? '结论：已是最小权限（只读这一个仓库）。' : '结论：权限仍然偏大，建议换成 fine-grained PAT（Contents: Read 单库）。')
  return lines.join(String.fromCharCode(10))
}