import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(path.join(root, p), 'utf8')

// ── 3.53.0 记忆可读（原来是"只生成、看不到、也不读"）──────────

test('后端有 memory-read 路由，支持 chapter / chain / segments', () => {
  const idx = read('index.mjs')
  assert.ok(idx.includes("route === 'memory-read'"), '要有 memory-read 路由')
  assert.ok(idx.includes("kind === 'chain'"), '要支持读前情链')
  assert.ok(idx.includes("kind === 'segments'"), '要支持读段记忆')
  assert.ok(idx.includes('readChapterMemory'), '要复用 memory-chain 的读取函数')
})

test('面板能看记忆：当前章记忆 / 前情链两个按钮', () => {
  const panel = read('lib/standalone-panel.html')
  assert.ok(panel.includes("id=\"memViewCur\""), '要有「看当前章记忆」按钮')
  assert.ok(panel.includes("id=\"memViewChain\""), '要有「看当前章前情链」按钮')
  assert.ok(panel.includes("get('memory-read'"), '要调 memory-read')
  assert.ok(panel.includes('S.memView'), '要有记忆展示状态')
})

test('本章 tab 自动读取前情提要（进页面即加载，不用手点）', () => {
  const panel = read('lib/standalone-panel.html')
  assert.ok(panel.includes('3.53.0 自动读取前情链'), '本章 tab 要自动拉链')
  assert.ok(panel.includes('S.ctxChain'), '要有自动读取的链缓存')
  assert.ok(panel.includes('前情提要 <span class="badge">自动读取'), '要把链渲染成卡片')
})

test('自动读取要防重复请求（同章不重复拉）', () => {
  const panel = read('lib/standalone-panel.html')
  assert.ok(panel.includes("S.ctxChain && S.ctxChain.chapter === stem"), '同章已加载要跳过')
})
