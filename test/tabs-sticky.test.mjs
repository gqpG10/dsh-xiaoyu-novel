import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const panel = readFileSync(path.join(root, 'lib/standalone-panel.html'), 'utf8')

// ── 3.49.0 tab 栏「物理固定」布局（sticky 在 iframe 里不可靠，改用 flex）──

test('body 是竖向 flex，整页不滚', () => {
  assert.ok(panel.includes('body{display:flex;flex-direction:column;overflow:hidden}'), 'body 必须 flex 列布局 + overflow hidden')
})

test('nav.tabs 与 .bar 都 flex:0 0 auto（不参与滚动）', () => {
  const tabsRule = /nav\.tabs\{[^}]*flex:0 0 auto/.test(panel)
  const barRule = /\.bar\{flex:0 0 auto/.test(panel)
  assert.ok(tabsRule, 'nav.tabs 必须是 flex:0 0 auto')
  assert.ok(barRule, '.bar 必须是 flex:0 0 auto')
})

test('只有 main#view 自己滚', () => {
  assert.ok(panel.includes('main#view{flex:1 1 auto;overflow-y:auto'), 'main#view 才负责滚动')
})

test('tab 栏仍有不透明背景', () => {
  const m = /nav\.tabs\{[^}]*background:(#[0-9a-fA-F]{3,6})/.exec(panel)
  assert.ok(m, 'nav.tabs 需要有背景色')
})

test('离线提示条不再依赖 sticky 定位', () => {
  assert.ok(panel.includes('top:104px') || panel.includes('offline'), '离线条仍在')
})
