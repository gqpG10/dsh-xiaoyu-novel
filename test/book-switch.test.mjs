import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const panel = readFileSync(path.join(root, 'lib/standalone-panel.html'), 'utf8')

// ── 3.58.1 选书是最高规则：切书 → 全部功能跟着换 ─────────

test('切书清空全部业务数据（不只是 state）', () => {
  const mustClear = ['S.preflight', 'S.cross', 'S.cast', 'S.pacing', 'S.bl', 'S.fs',
    'S.vol', 'S.fl', 'S.style', 'S.audit', 'S.gates', 'S.matrix',
    'S.relations', 'S.timeline', 'S.world', 'S.foreshadows', 'S.index', 'S.bibleUsage']
  for (const f of mustClear) {
    assert.ok(panel.includes(f + ' = null'), f + ' 切书时必须清空')
  }
})

test('切书重置 ctxAsked（否则本章上下文不重拉）', () => {
  assert.ok(panel.includes('S.ctxAsked = {}'), '要重置 ctxAsked')
  assert.ok(panel.includes('S.ctxChain = null'), '要清前情链')
})

test('切书清所有 localStorage 缓存（不只 state）', () => {
  assert.ok(panel.includes("k.indexOf('xiaoyu.cache.') === 0"), '要清 xiaoyu.cache.*')
  assert.ok(panel.includes("k.indexOf('cache.') === 0"), '要清 cache.*')
})

test('页面加载时从 localStorage 恢复当前书', () => {
  assert.ok(panel.includes('restoreNovelDir'), '要有恢复函数')
  assert.ok(panel.includes("localStorage.getItem('xiaoyu.novelDir')"), '要读回上次选的书')
})

test('直拼 URL（下载/导出/打包/环境搬家）都带 novel', () => {
  const q = (panel.match(/novelQ\(\)/g) || []).length
  assert.ok(q >= 8, 'novelQ 至少要被调用 8 处，实际 ' + q)
  assert.ok(panel.includes('&novel='), 'novelQ 要拼出 &novel=')
})
