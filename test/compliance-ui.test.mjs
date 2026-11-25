import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const panel = readFileSync(path.join(root, 'lib/standalone-panel.html'), 'utf8')
const index = readFileSync(path.join(root, 'index.mjs'), 'utf8')

// ── 3.24.0 合规体检 / 题材雷达 / 写作热力 UI 与路由契约 ─────────────────

test('合规路由 + 门禁页合规卡', () => {
  assert.match(index, /route === 'compliance' && req\.method === 'GET'/)
  assert.match(panel, /function vCompliance\(\)/)
  assert.match(panel, /ensureCompliance\(\);/)
  assert.match(panel, /complianceCard \+ qcHtml/, 'vGate 必须拼进合规卡')
})

test('雷达路由 + 项目页雷达卡 + 刷新按钮', () => {
  assert.match(index, /route === 'radar' && req\.method === 'GET'/)
  assert.match(panel, /function vRadar\(\)/)
  assert.match(panel, /vRadar\(\) \+ vBeats\(\)/)
  assert.match(panel, /id="radarRefresh"/)
})

test('写作热力格：概览页 120 天格子 + 连更', () => {
  assert.match(panel, /function heatGrid\(\)/)
  assert.match(panel, /\+ weekBars\(\) \+ '<\/div>' \+ heatGrid\(\)/)
  assert.match(index, /keys\.slice\(-120\)/, 'progress 路由必须回 120 天')
})
