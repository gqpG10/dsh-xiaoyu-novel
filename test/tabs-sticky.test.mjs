import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const panel = readFileSync(path.join(root, 'lib/standalone-panel.html'), 'utf8')

// ── 3.39.0 17 个功能 tab 吸顶 ──────────────────────────────

test('nav.tabs 是 sticky 并贴在顶栏下方', () => {
  assert.ok(panel.includes('position:sticky;top:52px;z-index:25'), 'nav.tabs 必须 sticky 到 top:52px')
  assert.ok(panel.includes('nav.tabs{'), 'nav.tabs 规则存在')
})

test('tab 栏有不透明背景（否则内容会透出来）', () => {
  const m = /nav\.tabs\{[^}]*background:(#[0-9a-fA-F]{3,6})/.exec(panel)
  assert.ok(m, 'nav.tabs 必须有具体 background 颜色')
  assert.ok(!/transparent|rgba\([^)]*0\.0/.test(m[1]), '背景不能是透明')
})

test('z-index 低于顶栏(.bar=30)、高于内容', () => {
  assert.ok(panel.includes('z-index:30') || panel.includes('.bar{position:sticky;top:0;z-index:30'), '顶栏 30 仍在')
  assert.ok(panel.includes('z-index:25'), 'tab 栏 25')
})

test('离线提示条让位，不与 tab 栏重叠', () => {
  assert.ok(panel.includes('top:104px'), '离线条要挪到 tab 栏下方')
})
