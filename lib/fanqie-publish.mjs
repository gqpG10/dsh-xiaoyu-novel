/**
 * fanqie-publish.mjs —— 3.29.0 番茄作家后台直发（协议参考 itsyhx/tomato-writer-mcp）。
 *
 * 鉴权 = Cookie + X-Secsrf-Csrf-Token（会话级固定）。实测作家接口不强制风控签名
 * （a_bogus / msToken 是前端 SDK 注入的，服务端对带 cookie+csrf 的 /api/author/** 不校验）。
 * POST 必须 application/x-www-form-urlencoded（JSON body 会得到空响应）。
 * 公共参数 aid=2503&app_name=muye_novel；响应 {code,message,data}，code===0 成功。
 *
 * 存储：令牌存 ~/.dsh/xiaoyu-fanqie.json（不进书目录、不进 git）。
 * 发布记录存 novelDir/.fanqie-published.json（章名 → {time,itemId}），用于显示「已发布」。
 *
 * 发布 = 建空草稿（/api/author/article/new_article/v0/）→ 提交（/api/author/publish_article/v0/）。
 */

import path from 'node:path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

const BASE = 'https://fanqienovel.com'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
const COMMON = { aid: '2503', app_name: 'muye_novel' }
const TIMEOUT_MS = 20000

export class FanqieError extends Error {
  constructor(code, message, path) { super(message); this.name = 'FanqieError'; this.code = code; this.path = path }
}

const qs = (params) => new URLSearchParams({ ...COMMON, ...params }).toString()

/** 统一请求。 */
async function call(auth, method, path, params, timeoutMs = TIMEOUT_MS) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const headers = {
    Cookie: auth.cookie,
    'User-Agent': UA,
    Accept: 'application/json, text/plain, */*',
    Origin: BASE,
    Referer: BASE + '/main/writer/',
    'X-Secsdk-Csrf-Token': auth.csrf || '',
  }
  try {
    let res
    if (method === 'GET') {
      res = await fetch(BASE + path + '?' + qs(params), { headers, signal: ctrl.signal })
    } else {
      res = await fetch(BASE + path, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: qs(params),
        signal: ctrl.signal,
      })
      }
    const text = await res.text()
    let j = null
    try { j = JSON.parse(text) } catch {
      throw new FanqieError(res.status, '返回非 JSON（HTTP ' + res.status + '）：' + text.slice(0, 120), path)
    }
    if (j.code !== 0) {
      const msg = j.message || j.msg || '未知错误'
      const hint = j.code === -2 ? '（参数有误）' : /登录|登陆|csrf|权限|未授权|token/i.test(msg) ? '（鉴权失效，请重新填 Cookie 与 csrf）' : ''
      throw new FanqieError(j.code, msg + hint, path)
    }
    return j.data
  } catch (e) {
    if (e && e.name === 'AbortError') throw new FanqieError(-1, '请求超时（' + timeoutMs + 'ms）', path)
    if (e instanceof FanqieError) throw e
    throw new FanqieError(-1, '网络错误：' + (e && e.message ? e.message : String(e)), path)
  } finally { clearTimeout(timer) }
}

/** 登录态探活 + 书单。 */
export async function checkLogin(auth) {
  const books = await call(auth, 'GET', '/api/author/book/book_list/v0', { page_index: 0, page_count: 50 })
  const list = Array.isArray(books) ? books : (books?.book_list || books?.list || [])
  return { ok: true, books: list.map((b) => ({ bookId: String(b.book_id ?? ''), name: b.book_name || b.bookName || '', words: b.word_count ?? null })) }
}

/** 分卷列表。 */
export async function listVolumes(auth, bookId) {
  return call(auth, 'GET', '/api/author/volume/volume_list/v1', { book_id: bookId })
}

/** 建空草稿，返回 itemId 与默认分卷。 */
export async function newDraft(auth, bookId) {
  const data = await call(auth, 'POST', '/api/author/article/new_article/v0/', { book_id: bookId, need_reuse: 0 })
  const volumeId = String(data?.volume_id ?? '')
  let volumeName = '正文'
  try {
    let vd = data?.volume_data
    if (typeof vd === 'string') vd = JSON.parse(vd)
    if (Array.isArray(vd)) {
      const hit = vd.find((v) => String(v.volume_id) === volumeId) || vd[0]
      if (hit?.volume_name) volumeName = hit.volume_name
    }
  } catch { /* 用默认卷名 */ }
  return { itemId: String(data?.item_id ?? ''), volumeId, volumeName }
}

/** 发布一章（title + 正文纯文本）。 */
export async function publishChapter(auth, { bookId, title, content, volumeId, volumeName }) {
  const draft = await newDraft(auth, bookId)
  const data = await call(auth, 'POST', '/api/author/publish_article/v0/', {
    item_id: draft.itemId,
    book_id: bookId,
    content,
    title,
    volume_id: volumeId || draft.volumeId,
    volume_name: volumeName || draft.volumeName,
    timer_status: 0,
    timer_time: 0,
    publish_status: 1,
    need_pay: 0,
    use_ai: 2,
    device_platform: 'pc',
    speak_type: 0,
    speak_text: '',
    timer_chapter_preview: '[]',
    has_chapter_ad: 'false',
    chapter_ad_types: '',
  })
  return { itemId: draft.itemId, data }
}

/** 令牌存储路径（DSH home 下，不进仓库）。 */
export function authPath(dshHome) {
  return path.join(dshHome, 'xiaoyu-fanqie.json')
}

export function loadAuth(dshHome) {
  try {
    const raw = readFileSync(authPath(dshHome), 'utf8')
    const j = JSON.parse(raw)
    if (j && typeof j.cookie === 'string' && j.cookie) return j
  } catch { /* 未配置 */ }
  return null
}

export function saveAuth(dshHome, { cookie, csrf }) {
  const dir = path.dirname(authPath(dshHome))
  mkdirSync(dir, { recursive: true })
  writeFileSync(authPath(dshHome), JSON.stringify({ cookie: String(cookie || ''), csrf: String(csrf || ''), savedAt: new Date().toISOString() }, null, 2), 'utf8')
  return { ok: true }
}

/** 发布记录（书目录下，显示已发布状态用）。 */
function ledgerPath(novelDir) { return path.join(path.resolve(novelDir), '.fanqie-published.json') }

export function readLedger(novelDir) {
  try {
    const raw = readFileSync(ledgerPath(novelDir), 'utf8')
    const j = JSON.parse(raw)
    return j && typeof j === 'object' ? j : {}
  } catch { return {} }
}

export function markPublished(novelDir, file, info) {
  const all = readLedger(novelDir)
  all[file] = { at: new Date().toISOString(), ...info }
  try {
    mkdirSync(path.dirname(ledgerPath(novelDir)), { recursive: true })
    writeFileSync(ledgerPath(novelDir), JSON.stringify(all, null, 2), 'utf8')
  } catch { /* 记账失败不影响发布本身 */ }
  return all
}
