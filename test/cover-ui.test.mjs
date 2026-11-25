import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const panel = readFileSync(path.join(root, 'lib/standalone-panel.html'), 'utf8')
const index = readFileSync(path.join(root, 'index.mjs'), 'utf8')

// ── 3.27.0 细纲门禁 / 上下文卡 / 封面提示词 UI 契约 ──────────────────

test('细纲门禁：POST 返回 quality 字段 + 面板渲染警告', () => {
  assert.match(index, /qualityOfBlueprint\(body\)/)
  assert.match(panel, /S\.bpQuality/)
  assert.match(panel, /pill mid/)
})

test('上下文卡：本章 tab 顶部单页摘要', () => {
  assert.match(panel, /上下文卡/)
  assert.match(panel, /写这一章只看这张/)
})

test('封面提示词：路由 + 面板按钮 + 落盘 exports/', () => {
  assert.match(index, /route === 'cover-prompt' && req\.method === 'POST'/)
  assert.match(index, /buildCoverPrompt\(/)
  assert.match(panel, /id="coverBtn"/)
  assert.match(panel, /postJson\('cover-prompt'/)
  assert.match(index, /exports\/cover-prompt\.md/)
})
