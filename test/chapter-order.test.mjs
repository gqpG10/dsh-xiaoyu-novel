import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const panel = readFileSync(path.join(root, 'lib/standalone-panel.html'), 'utf8')

// ── 3.28.0 章节列表正序/倒序 ────────────────────────────────────────

test('章节排序：切换按钮 + 状态持久化 + 排序实现三件套', () => {
  assert.match(panel, /id="chapOrder"/, '切换按钮必须在')
  assert.match(panel, /chapDesc/, '排序状态必须在')
  assert.match(panel, /localStorage\.setItem\('xiaoyu\.chapDesc'/, '选择要持久化')
  assert.match(panel, /localStorage\.getItem\('xiaoyu\.chapDesc'\)/, '重开面板要读回')
  assert.match(panel, /正序 ↑/, '正序态文案')
  assert.match(panel, /倒序 ↓/, '倒序态文案')
})

test('章节排序：按文件名字典序（卷章号天然可比）', () => {
  // v01-c002 < v02-c001 的字典序成立，倒序取反
  const a = 'v01-c002.md', b = 'v02-c001.md'
  assert.ok(a < b)
  assert.ok(!(b < a))
  assert.match(panel, /desc \? \(fa < fb \? 1 : fa > fb \? -1 : 0\) : \(fa < fb \? -1 : fa > fb \? 1 : 0\)/)
})
