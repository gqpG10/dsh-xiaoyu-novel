import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(path.join(root, p), 'utf8')

// ── 3.52.0 全量体检后的清理 ──────────────────────────────────

test('重名函数有警告注释（防将来同时 import 静默覆盖）', () => {
  const np = read('lib/novel-parse.mjs')
  assert.ok(np.includes('重名警告'), 'novel-parse 的 splitParagraphs/checkChapterStyle 必须带重名警告')
  assert.ok(np.includes('style-config.mjs 也有 checkChapterStyle'), '要写明另一个同名函数在哪')
})

test('内部专用常量不再 export（避免外部误用）', () => {
  const cb = read('lib/chapter-blueprint.mjs')
  const pc = read('lib/pacing-core.mjs')
  const vl = read('lib/volume-lines.mjs')
  assert.ok(!/^export const SIX_BEAT_LABELS/m.test(cb), 'SIX_BEAT_LABELS 不该 export')
  assert.ok(!/^export const PAYOFF_SIGNALS/m.test(pc), 'PAYOFF_SIGNALS 不该 export')
  assert.ok(!/^export const VOLUME_LINE_FIELDS/m.test(vl), 'VOLUME_LINE_FIELDS 不该 export')
  // 但变量本体必须还在（内部在用）
  assert.ok(cb.includes('const SIX_BEAT_LABELS ='))
  assert.ok(pc.includes('const PAYOFF_SIGNALS ='))
  assert.ok(vl.includes('const VOLUME_LINE_FIELDS ='))
})

test('withNovelDir 标了 deprecated（保留但提示）', () => {
  const pc = read('lib/panel-core.mjs')
  assert.ok(pc.includes('@deprecated 3.52.0'), '未使用的 withNovelDir 要标 deprecated')
})

test('DSH 环境搬家：后端路由 + 面板入口齐备', () => {
  const idx = read('index.mjs')
  assert.ok(idx.includes("route === 'portable-export'"), '后端要有 portable-export 路由')
  assert.ok(idx.includes('exportPortable'), '要调用 portable.exportPortable')
  const panel = read('lib/standalone-panel.html')
  assert.ok(panel.includes('vPortable()'), '面板要有环境搬家卡')
  assert.ok(panel.includes("API + 'portable-export?secrets='"), '按钮要能触发下载')
  assert.ok(panel.includes('含渠道 key'), '要提示含 key 的风险')
})

test('番茄登录状态：面板调用了 fanqie-login-status', () => {
  const panel = read('lib/standalone-panel.html')
  assert.ok(panel.includes("get('fanqie-login-status'"), '面板要查登录会话状态')
  assert.ok(panel.includes('S.fqSess'), '要有状态字段')
})

test('注释里不再有具体用户路径', () => {
  const bs = read('lib/book-scan.mjs')
  assert.ok(!bs.includes('E:/小说创作'), '注释不该写死用户路径')
  assert.ok(bs.includes('<workspace>'), '要用通用占位写法')
})
