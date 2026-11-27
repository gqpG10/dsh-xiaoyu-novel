import test from 'node:test'
import assert from 'node:assert/strict'
import { findChrome, parsePastedCookie, pickPort, readLoginSession, WRITER_URL, DEBUG_FILE } from '../lib/fanqie-login.mjs'

// ── 3.38.0 番茄一键登录 ─────────────────────────────────────────

test('能探测到本机浏览器（找不到也只返回 null，不抛异常）', () => {
  const c = findChrome()
  assert.ok(c === null || typeof c === 'string', '必须是路径或 null')
  if (c) assert.match(c, /chrome|edge|chromium/i)
})

test('粘贴的 Cookie 能抽出 csrf_session_id', () => {
  const r = parsePastedCookie('gfkadpd=2503; csrf_session_id=abc123; sessionid=xyz; sid_guard=q')
  assert.equal(r.ok, true)
  assert.equal(r.csrf, 'abc123')
  assert.match(r.cookie, /sessionid=xyz/)
})

test('带 Cookie: 前缀也认', () => {
  const r = parsePastedCookie('Cookie: sessionid=AAA; csrf_session_id=BBB')
  assert.equal(r.ok, true)
  assert.equal(r.csrf, 'BBB')
  assert.ok(!r.cookie.startsWith('Cookie:'))
})

test('没有登录态字段要拒绝并说明', () => {
  const r = parsePastedCookie('gfkadpd=1; foo=bar')
  assert.equal(r.ok, false)
  assert.match(r.error, /sessionid/)
  assert.equal(parsePastedCookie('').ok, false)
})

test('端口选择：返回可用端口或 null，不抛异常', async () => {
  const p = await pickPort(9222, 3)
  assert.ok(p === null || (p >= 9222 && p <= 9224))
})

test('没有登录会话时读出来是 null', () => {
  const s = readLoginSession('C:/__no_such_dsh_home_xyz__')
  assert.equal(s, null)
  assert.equal(typeof DEBUG_FILE, 'string')
  assert.match(WRITER_URL, /^https:\/\//)
})
