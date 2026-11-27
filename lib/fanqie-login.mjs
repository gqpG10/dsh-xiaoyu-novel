/**
 * fanqie-login.mjs —— 3.38.0 番茄一键登录（唤起浏览器 → 用户登录 → 自动读回登录态）。
 *
 * 原理：浏览器同源策略不允许 Web 页面读别的 Cookie，所以走 Chrome DevTools 协议：
 *   1) 用**独立 user-data-dir** 起 Chrome（必须有它，否则已有实例会吞掉调试端口）
 *   2) 等 /json/version 起来 → 开番茄作家后台
 *   3) 用户在窗口里登录
 *   4) 我们通过 CDP 的 Network.getAllCookies 读 fanqie/bytedance 域的 Cookie
 *   5) 交给 checkLogin 验证，通过就落盘 ~/.dsh/xiaoyu-fanqie.json
 *
 * 全程零依赖：只 use node:child_process + WebSocket（Node 22+ 内置）。
 */

import path from 'node:path'
import os from 'node:os'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

export const DEBUG_FILE = 'xiaoyu-fanqie-login.json'
export const WRITER_URL = 'https://fanqienovel.com/main/writer/'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36'

/** 常见 Chrome 安装路径（Windows / macOS / Linux）。 */
export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean)
  for (const c of candidates) {
    try { if (existsSync(c)) return c } catch { /* 忽略 */ }
  }
  return null
}

/** 探测可用调试端口：从 base 开始顺延，找到没人监听的那个。 */
export async function pickPort(base = 9222, tries = 12) {
  for (let i = 0; i < tries; i++) {
    const port = base + i
    const busy = await isPortBusy(port)
    if (!busy) return port
  }
  return null
}

async function isPortBusy(port) {
  try {
    const r = await fetch('http://127.0.0.1:' + port + '/json/version', { signal: AbortSignal.timeout(600) })
    // 有响应：端口已被某个调试服务占用
    if (r.ok) return true
  } catch { /* 无响应 = 空闲 */ }
  return false
}

/** 等调试端口就绪（最多 timeoutMs）。 */
export async function waitForDevtools(port, timeoutMs = 20000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/json/version', { signal: AbortSignal.timeout(1200) })
      if (r.ok) return await r.json()
    } catch { /* 还没起 */ }
    await new Promise((r2) => setTimeout(r2, 400))
  }
  return null
}

/** 调试端口所在的数据目录（我们自己起的那个）。 */
function debugHome(dshHome) {
  return path.join(dshHome || path.join(os.homedir(), '.dsh'), 'chrome-fanqie')
}

/**
 * 启动带调试端口的浏览器并打开番茄作家后台。
 * @returns {{ok:boolean, port?:number, pid?:number, chrome?:string, error?:string}}
 */
export async function beginLogin(dshHome) {
  const chrome = findChrome()
  if (!chrome) return { ok: false, error: '没找到 Chrome/Edge，请手动填 CHROME_PATH 环境变量，或用「手动粘贴 Cookie」' }
  const port = await pickPort(9222)
  if (!port) return { ok: false, error: '9222~9233 全被占用，先用「手动粘贴 Cookie」' }
  const userDataDir = debugHome(dshHome)
  try { mkdirSync(userDataDir, { recursive: true }) } catch { /* 已存在 */ }

  const args = [
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + userDataDir,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    WRITER_URL,
  ]
  let child
  try {
    child = spawn(chrome, args, { detached: true, stdio: 'ignore' })
    child.unref()
  } catch (e) {
    return { ok: false, error: '启动浏览器失败：' + (e && e.message ? e.message : String(e)) }
  }

  const info = await waitForDevtools(port, 20000)
  if (!info) return { ok: false, port, error: '浏览器已启动但调试端口没响应（可能被杀软拦了），改用「手动粘贴 Cookie」' }

  // 把这次会话记下来，后续 finishLogin 用
  try {
    writeFileSync(path.join(dshHome || path.join(os.homedir(), '.dsh'), DEBUG_FILE),
      JSON.stringify({ port, chrome, userDataDir, at: new Date().toISOString() }, null, 2), 'utf8')
  } catch { /* 写不了也不影响 */ }

  return { ok: true, port, pid: child.pid, chrome: String(info.Browser || ''), userDataDir, url: WRITER_URL }
}

/** 读上次 beginLogin 记下的调试端口。 */
export function readLoginSession(dshHome) {
  try {
    const home = dshHome || path.join(os.homedir(), '.dsh')
    const raw = readFileSync(path.join(home, DEBUG_FILE), 'utf8')
    return JSON.parse(raw)
  } catch { return null }
}

/** 通过 CDP 从调试浏览器里读番茄 Cookie（返回 cookie 串 + csrf）。 */
export async function readCookiesViaCdp(port) {
  const list = await (await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(5000) })).json()
  const page = (list || []).find((t) => t.type === 'page' && /fanqie/i.test(String(t.url || ''))) || (list || []).find((t) => t.type === 'page')
  if (!page || !page.webSocketDebuggerUrl) throw new Error('调试浏览器里没有可用的页面，请确认番茄页面已打开')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id
    pending.set(i, { resolve, reject })
    ws.send(JSON.stringify({ id: i, method, params }))
  })
  ws.onmessage = (ev) => {
    let m
    try { m = JSON.parse(ev.data) } catch { return }
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id)
      pending.delete(m.id)
      if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result)
    }
  }
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('连不上调试浏览器 WebSocket'))
  })
  try {
    const { cookies } = await send('Network.getAllCookies')
    const fj = (cookies || []).filter((c) => /fanqie|bytedance|bytednsdoc/i.test(String(c.domain || '')))
    if (fj.length === 0) throw new Error('浏览器里没有番茄 Cookie，可能还没登录成功')
    const cookie = fj.map((c) => c.name + '=' + c.value).join('; ')
    const csrfCookie = fj.find((c) => c.name === 'csrf_session_id')
    const hasSession = fj.some((c) => c.name === 'sessionid' || c.name === 'sessionid_ss')
    if (!hasSession) throw new Error('还没检测到番茄登录态（sessionid 缺失），请确认已在窗口里完成登录')
    return { cookie, csrf: csrfCookie ? csrfCookie.value : '', count: fj.length }
  } finally {
    try { ws.close() } catch { /* 忽略 */ }
  }
}

/** 完成登录：读 Cookie → 验证 → 落盘。 */
export async function finishLogin(dshHome, checkLoginFn, saveAuthFn) {
  const sess = readLoginSession(dshHome)
  if (!sess || !sess.port) return { ok: false, error: '没有进行中的登录会话，请先点「一键登录」' }
  let got
  try { got = await readCookiesViaCdp(sess.port) } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
  const auth = { cookie: got.cookie, csrf: got.csrf, savedAt: new Date().toISOString() }
  let books
  try { books = await checkLoginFn(auth) } catch (e) {
    return { ok: false, error: 'Cookie 拿到了但验证失败：' + String((e && e.message) || e), cookieCount: got.count }
  }
  try { saveAuthFn(auth) } catch (e) {
    return { ok: false, error: '登录成功但写令牌文件失败：' + String((e && e.message) || e) }
  }
  return { ok: true, cookieCount: got.count, books: (books && books.books) || [], port: sess.port }
}

/** 手动粘贴后台：解析用户粘的一整行 Cookie（自动抽 csrf_session_id）。 */
export function parsePastedCookie(text) {
  const raw = String(text || '').trim()
  if (!raw) return { ok: false, error: 'Cookie 是空的' }
  // 允许带 "Cookie: " 前缀
  const cookie = raw.replace(/^cookie\s*:\s*/i, '').replace(/\s+/g, ' ').trim()
  if (!/sessionid=/.test(cookie) && !/sid_guard=/.test(cookie)) return { ok: false, error: '里面没有 sessionid / sid_guard，可能复制错了区域' }
  const m = /(?:^|;\s*)csrf_session_id=([^;]+)/.exec(cookie)
  return { ok: true, cookie, csrf: m ? m[1] : '' }
}

export { UA }
