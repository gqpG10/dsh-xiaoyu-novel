import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const panel = readFileSync(path.join(root, 'lib/standalone-panel.html'), 'utf8')
const idx = readFileSync(path.join(root, 'index.mjs'), 'utf8')

// ── 3.55.0 清死路由 + 补接 5 个后端路由 ─────────────────────

const backRoutes = new Set([...idx.matchAll(/route === '([a-z-]+)'/g)].map((m) => m[1]))
const panelCalls = [...panel.matchAll(/(?:get|postJson)\('([a-z-]+)'/g)].map((m) => m[1])

test('面板不再调用任何已删除的接口', () => {
  const dead = [...new Set(panelCalls)].filter((r) => !backRoutes.has(r) && !['path'].includes(r))
  assert.deepEqual(dead, [], '面板调用了后端不存在的路由：' + dead.join(', '))
})

test('记忆相关接口调用已彻底清除', () => {
  for (const r of ['memory-sync', 'memory-health', 'memory-compress', 'chapter-memory', 'memory-read']) {
    assert.ok(!panelCalls.includes(r), '不该再调 ' + r)
  }
})

test('新补接的 5 个路由：导出/建文件/六节拍', () => {
  for (const r of ['export-book', 'export-selection', 'file-create', 'six-beats']) {
    assert.ok(panel.includes(r), '面板应接上 ' + r)
  }
  assert.ok(panel.includes('vExport'), '要有导出卡')
  assert.ok(panel.includes('vFileCreate'), '要有新建文件卡')
  assert.ok(panel.includes('vSixBeats'), '要有六节拍卡')
})

test('导出按钮拼接了 path 参数', () => {
  assert.ok(panel.includes("'export-book?path=' + encodeURIComponent(S.ws"), '整书导出要带 path')
  assert.ok(panel.includes("'export-selection?path='"), '勾选导出要带 path')
})

test('环境搬家按钮也带了 path', () => {
  assert.ok(panel.includes("'&path=' + encodeURIComponent(S.ws"), 'portable-export 要带 path')
})

test('新建文件模板用数组 join（避开反引号转义坑）', () => {
  assert.ok(panel.includes("join('\\n')"), '模板要用 join 拼行')
  assert.ok(panel.includes('CHAR_TPL(name)') && panel.includes('WORLD_TPL(name)') && panel.includes('OUTLINE_TPL(stem)'))
})
