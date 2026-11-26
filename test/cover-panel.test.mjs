import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const panel = readFileSync(path.join(root, 'lib/standalone-panel.html'), 'utf8')

// ── 3.30.0 封面提示词：面板内直接展示 + 复制 ─────────────────────────

test('封面卡：两套提示词直接铺在面板里（不再只给一个落盘提示）', () => {
  assert.match(panel, /S\.coverRes/)
  assert.match(panel, /style="white-space:pre-wrap;word-break:break-word/, '提示词要以可读 pre 块展示')
  assert.match(panel, /风格 A · 商业主图风/, 'A 套标题必须现于面板')
  assert.match(panel, /风格 B · 概念艺术风/, 'B 套标题必须现于面板')
})

test('封面卡：每套一个复制按钮 + 全部复制', () => {
  assert.match(panel, /class="sm coverCopy" data-style="/, '每套独立复制按钮')
  assert.match(panel, /id="coverCopyAll"/, '全部复制按钮')
  assert.match(panel, /querySelectorAll\('\.coverCopy'\)/)
  assert.match(panel, /copy\(text\)\.then/, '必须走面板既有 copy 辅助（含 fallback）')
})
