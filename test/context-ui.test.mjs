import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ── 3.21.0 「本章」面板 UI：路由 + 视图 + 绑定三件套契约 ────────────────────
// 后端 chapter-context 路由有了，面板必须有入口：TABS 加 context 项、视图分派表
// 注册 vContext、render 后 bindContext 并触发 ensureCtxPack。漏任何一件 = 功能
// 上线了但用户看不到。

test('面板「本章」tab：TABS 注册 + 视图分派 + 绑定三件套', () => {
  const src = readFileSync(path.join(root, 'lib/standalone-panel.html'), 'utf8')
  assert.ok(src.includes("['context','本章']"), 'TABS 必须含 context 项（用户可见入口）')
  assert.match(src, /context: vContext,/, '视图分派表必须注册 vContext')
  assert.match(src, /function vContext\(\)/, 'vContext 视图函数必须在')
  assert.match(src, /function bindContext\(\)/, 'bindContext 绑定函数必须在')
  assert.match(src, /S\.tab === 'context'/, 'render 后必须触发 context 绑定')
  assert.match(src, /ensureCtxPack\(/, '数据拉取函数 ensureCtxPack 必须在')
  assert.match(src, /get\('chapter-context'/, '必须调 /api/xiaoyu-novel/chapter-context')
  // 章选择器：写手要能切章
  assert.match(src, /id="ctxFile"/, '章选择器 ctxFile 必须在')
})

test('后端路由：chapter-context 挂载 + 30s TTL 缓存', () => {
  const src = readFileSync(path.join(root, 'index.mjs'), 'utf8')
  assert.match(src, /route === 'chapter-context'/, '路由必须注册')
  assert.match(src, /chapterContext\(novelDir, stem, rows\)/, '必须调用 chapterContext')
  assert.match(src, /cachedResult\('chapter-context'/, '必须 30s TTL 缓存（cast-matrix 同款）')
})
