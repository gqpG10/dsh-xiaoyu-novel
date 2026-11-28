import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const panel = readFileSync(path.join(root, 'lib/standalone-panel.html'), 'utf8')

// ── 3.54.1 修「划不动、一直跳」────────────────────────────

test('内层滚动容器位置要保存并还原（pre / .cbody / overflow div）', () => {
  assert.ok(panel.includes('keepInner'), '要记录内层滚动')
  assert.ok(panel.includes('querySelectorAll(' + String.fromCharCode(39) + 'pre, .cbody, div[style*=' + '"overflow"' + ']' + String.fromCharCode(39) + ')'), '要覆盖 pre/内层 div')
  assert.ok(panel.includes('again[it.ord].scrollTop = it.top'), '要按序还原 scrollTop')
})

test('索引简报请求有防重复锁（不再每次 render 重发）', () => {
  assert.ok(panel.includes('S.ctxBriefAsked'), '要有已请求集合')
  assert.ok(panel.includes('if (S.ctxBriefAsked[stem]'), '同章不能再请求')
})

test('索引简报失败也记状态（不会无限重试）', () => {
  assert.ok(panel.includes("err: (bd && bd.error) || ''"), '失败要落状态而不是 null')
  assert.ok(panel.includes("err: '读取失败'"), 'catch 也要落状态')
})
