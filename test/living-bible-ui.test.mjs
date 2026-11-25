import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const panel = readFileSync(path.join(root, 'lib/standalone-panel.html'), 'utf8')
const index = readFileSync(path.join(root, 'index.mjs'), 'utf8')

// ── 3.25.0 活设定集 UI 与路由契约（设定真正可看、可标、可排序）────────────

test('活设定集路由：bible-usage GET + bible-touch POST（rel 参数）', () => {
  assert.match(index, /route === 'bible-usage' && req\.method === 'GET'/)
  assert.match(index, /route === 'bible-touch' && req\.method === 'POST'/)
  assert.match(index, /touchBible\(novelDir, body\.rel \|\| body\.file\)/)
})

test('活设定集 UI：设定页有活设定卡 + 标记按钮 + 已引用/未引用分区', () => {
  assert.match(panel, /function vBibleCard\(\)/)
  assert.match(panel, /ensureBibleUsage\(\)/)
  assert.match(panel, /class="sm bibleTouch"/, '标记已用按钮')
  assert.match(panel, /postJson\('bible-touch'/)
  assert.match(panel, /vBibleCard\(\) \+ vWorldExtra\(\)/, '设定页必须先出活设定卡')
  assert.match(panel, /S\.tab === 'world'\).* bindBibleTouch/, 'world tab 渲染后必须绑按钮')
})

test('章后记忆：chapter-memory 路由 + 前情字段', () => {
  assert.match(index, /route === 'chapter-memory' && req\.method === 'POST'/)
  const ctx = readFileSync(path.join(root, 'lib/chapter-context.mjs'), 'utf8')
  assert.match(ctx, /prevMemory/)
})

test('连续性路由：consistency GET 合流两扫描', () => {
  assert.match(index, /route === 'consistency' && req\.method === 'GET'/)
  assert.match(index, /scanAttributeConflicts\(novelDir\)\.concat\(scanTimelineConflicts\(novelDir\)\)/)
})
