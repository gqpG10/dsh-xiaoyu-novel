import test from 'node:test'
import assert from 'node:assert/strict'

import { compareVersions, getVersionInfo, invalidateVersionCache, isValidVersion } from '../lib/version.mjs'

// ── 版本检测（0.15.0 补测）────────────────────────────────────────────────
// 这块之前只有 CLI/面板在真实网络下跑，回归全靠手测。这里用注入的 fetchImpl
// 覆盖三条关键行为：形状闸（防注入）、版本比较、缓存/降级语义。

test('isValidVersion：只认 X.Y.Z[-预发布]，注入形状一律拒绝', () => {
  for (const ok of ['0.15.0', '1.0.0-rc.1', '10.2.30']) assert.equal(isValidVersion(ok), true, ok)
  for (const bad of ['', 'v1.2.3', '1.2', '1.2.3; rm -rf /', '1.2.3 && echo', '1.2.3\n4.5.6', 'abc', '1.2.3.4']) {
    assert.equal(isValidVersion(bad), false, bad)
  }
})

test('compareVersions：逐段数值比较 / 缺段补 0 / 预发布低于正式版', () => {
  assert.equal(compareVersions('0.14.0', '0.15.0'), -1)
  assert.equal(compareVersions('0.15.0', '0.14.9'), 1)
  assert.equal(compareVersions('1.0', '1.0.0'), 0)
  assert.equal(compareVersions('v0.15.0', '0.15.0'), 0)
  assert.equal(compareVersions('0.15.0-rc.1', '0.15.0'), -1)
  assert.equal(compareVersions('0.15.0', '0.15.0-rc.1'), 1)
})

test('getVersionInfo：mock 源命中即判有新版，并记下来源', async () => {
  invalidateVersionCache()
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(String(url))
    return { ok: true, status: 200, json: async () => ({ version: '9.9.9' }) }
  }
  const info = await getVersionInfo({ fetchImpl, timeoutMs: 500, now: 1000 })
  assert.equal(info.latest, 'v9.9.9')
  assert.equal(info.updateAvailable, true)
  assert.ok(['npm', 'mirror'].includes(info.source), 'source 应为 npm/mirror，实际 ' + info.source)
  assert.equal(info.error, null)
  assert.ok(calls.length >= 1)
  invalidateVersionCache()
})

test('getVersionInfo：TTL 内命中缓存不再发请求', async () => {
  invalidateVersionCache()
  let n = 0
  const fetchImpl = async () => { n += 1; return { ok: true, status: 200, json: async () => ({ version: '9.9.9' }) } }
  await getVersionInfo({ fetchImpl, timeoutMs: 500, now: 1000 })
  const first = n
  await getVersionInfo({ fetchImpl, timeoutMs: 500, now: 2000 })
  assert.equal(n, first, 'TTL 内不应再请求')
  await getVersionInfo({ fetchImpl, timeoutMs: 500, now: 2000, force: true })
  assert.ok(n > first, 'force 必须绕过缓存')
  invalidateVersionCache()
})

test('getVersionInfo：三路全失败时降级——latest 为 null、不谎报有新版', async () => {
  invalidateVersionCache()
  const fetchImpl = async () => { throw new Error('network down') }
  const info = await getVersionInfo({ fetchImpl, timeoutMs: 300, now: 5000 })
  assert.equal(info.latest, null)
  assert.equal(info.updateAvailable, false)
  assert.ok(typeof info.error === 'string' && info.error.length > 0, '应带错误说明')
  invalidateVersionCache()
})
