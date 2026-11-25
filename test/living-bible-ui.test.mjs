import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const panel = readFileSync(path.join(root, 'lib/standalone-panel.html'), 'utf8')
const index = readFileSync(path.join(root, 'index.mjs'), 'utf8')

// ── 3.23.0 活设定集 / 章后记忆 / 连续性体检 UI 与路由契约 ───────────────

test('活设定集路由：bible-usage GET + bible-touch POST', () => {
  assert.match(index, /route === 'bible-usage' && req\.method === 'GET'/)
  assert.match(index, /route === 'bible-touch' && req\.method === 'POST'/)
  assert.match(index, /touchBible\(novelDir, body\.file\)/)
})

test('章后记忆路由：chapter-memory POST + 前情自动携带', () => {
  assert.match(index, /route === 'chapter-memory' && req\.method === 'POST'/)
  assert.match(index, /summarizeChapter\(raw\)/)
  assert.match(index, /memory/, '落盘 memory/ 目录')
})

test('连续性路由：consistency GET + 两扫描合流', () => {
  assert.match(index, /route === 'consistency' && req\.method === 'GET'/)
  assert.match(index, /scanAttributeConflicts\(novelDir\)\.concat\(scanTimelineConflicts\(novelDir\)\)/)
})

test('面板 UI：前情卡片 + 定稿记忆按钮 + 连续性体检卡', () => {
  assert.match(panel, /d\.prevMemory/, 'vContext 必须渲染前情卡')
  assert.match(panel, /id="bpMemo"/, '定稿记忆按钮必须在')
  assert.match(panel, /postJson\('chapter-memory'/)
  assert.match(panel, /function vConsistency\(\)/)
  assert.match(panel, /ensureConsistency\(\);/, '体检页必须加载连续性')
})

test('chapter-context 模块：prevMemory 字段注入', () => {
  const ctx = readFileSync(path.join(root, 'lib/chapter-context.mjs'), 'utf8')
  assert.match(ctx, /prevMemory/)
  assert.match(ctx, /memory/, '读 memory/ 目录')
})
