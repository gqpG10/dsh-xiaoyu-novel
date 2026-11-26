import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import { saveAuth, loadAuth, readLedger, markPublished, authPath } from '../lib/fanqie-publish.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const index = readFileSync(path.join(root, 'index.mjs'), 'utf8')
const panel = readFileSync(path.join(root, 'lib/standalone-panel.html'), 'utf8')

// ── 3.29.0 番茄发布：令牌存取 / 发布记账 / 路由 / UI 契约 ─────────────

test('令牌存取：save → load 往返，未配置返回 null', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'xiaoyu-fq-'))
  try {
    assert.equal(loadAuth(home), null)
    saveAuth(home, { cookie: 'a=b; c=d', csrf: 'tok123' })
    const a = loadAuth(home)
    assert.equal(a.cookie, 'a=b; c=d')
    assert.equal(a.csrf, 'tok123')
    assert.ok(a.savedAt, '要记保存时间')
    assert.ok(authPath(home).includes('xiaoyu-fanqie.json'))
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('发布记账：markPublished 落盘 + readLedger 读回', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'xiaoyu-fql-'))
  try {
    assert.deepEqual(readLedger(dir), {})
    markPublished(dir, 'v01-c001', { title: '第1章', bookId: 'b1', itemId: 'i1' })
    const l = readLedger(dir)
    assert.equal(l['v01-c001'].title, '第1章')
    assert.equal(l['v01-c001'].itemId, 'i1')
    assert.ok(l['v01-c001'].at)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('路由：auth/check/publish/published 四条齐', () => {
  assert.match(index, /route === 'fanqie-auth' && req\.method === 'GET'/)
  assert.match(index, /route === 'fanqie-auth' && req\.method === 'POST'/)
  assert.match(index, /route === 'fanqie-check' && req\.method === 'GET'/)
  assert.match(index, /route === 'fanqie-publish' && req\.method === 'POST'/)
  assert.match(index, /route === 'fanqie-published' && req\.method === 'GET'/)
  assert.match(index, /markPublished\(novelDir, stem/)
})

test('协议要点：form-urlencoded + aid=2503 + 草稿转提交两步', () => {
  const mod = readFileSync(path.join(root, 'lib/fanqie-publish.mjs'), 'utf8')
  assert.match(mod, /application\/x-www-form-urlencoded/)
  assert.match(mod, /aid: '2503'/)
  assert.match(mod, /new_article\/v0\//)
  assert.match(mod, /publish_article\/v0\//)
  assert.match(mod, /X-Secsdk-Csrf-Token/)
})

test('UI：发布卡 + 令牌输入 + 探活 + 勾选发布 + 已发布徽标', () => {
  assert.match(panel, /function vFanqie\(\)/)
  assert.match(panel, /id="fqCookie"/)
  assert.match(panel, /id="fqCsrf"/)
  assert.match(panel, /id="fqCheck"/)
  assert.match(panel, /id="fqPublish"/)
  assert.match(panel, /已发布/)
  assert.match(panel, /postJson\('fanqie-publish'/)
})
