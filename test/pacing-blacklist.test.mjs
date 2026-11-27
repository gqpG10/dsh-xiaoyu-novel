import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkFourLines, payoffDensity, detectLines, loadFourLines, DEFAULT_FOUR_LINES } from '../lib/pacing-core.mjs'
import { loadBlacklist, scanBlacklist, gateBlacklist } from '../lib/blacklist.mjs'

// ── 3.43.0 P2/P3：四线并行 + 爽点密度 + 禁忌黑名单 ────────────

test('四线断流：连续 5 章无主线信号要报', () => {
  const chapters = [
    { file: 'a1', text: '他定下目标，追查线索' },
    { file: 'a2', text: '他喝水' }, { file: 'a3', text: '他睡觉' },
    { file: 'a4', text: '他发呆' }, { file: 'a5', text: '他散步' }, { file: 'a6', text: '他吃饭' },
  ]
  const r = checkFourLines(chapters, DEFAULT_FOUR_LINES, { gap: 5 })
  assert.ok(r.gaps.some((g) => g.line === 'main'), '主线应断流')
  assert.equal(r.ok, false)
})

test('四线断流：每章都有信号则不断流', () => {
  const chapters = Array.from({ length: 8 }, (_, i) => ({ file: 'c' + i, text: '目标追查主线拿下' }))
  const r = checkFourLines(chapters, DEFAULT_FOUR_LINES, { gap: 5 })
  assert.equal(r.gaps.filter((g) => g.line === 'main').length, 0)
})

test('detectLines 命中计数正确', () => {
  const h = detectLines('他追查目标，顺便隔壁', DEFAULT_FOUR_LINES)
  assert.ok(h.main >= 2)
  assert.ok(h.sub >= 1)
})

test('loadFourLines：无文件用默认、有文件覆盖', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'xiaoyu-fl-'))
  assert.deepEqual(Object.keys(loadFourLines(root)), Object.keys(DEFAULT_FOUR_LINES))
  writeFileSync(path.join(root, 'four_lines.yml'), 'main: [第一格, 那一格]\n', 'utf8')
  const cfg = loadFourLines(root)
  assert.deepEqual(cfg.main, ['第一格', '那一格'])
})

test('爽点密度：算对密度与最长空窗', () => {
  const entries = [
    { file: 'a', text: '他当场打脸' }, { file: 'b', text: '反转了' },
    { file: 'c', text: '喝水' }, { file: 'd', text: '睡觉' },
    { file: 'e', text: '赢了' },
  ]
  const r = payoffDensity(entries, { maxGap: 4 })
  assert.equal(r.total, 5)
  assert.equal(r.withPayoff, 3)
  assert.equal(r.densityPct, 60)
  assert.equal(r.maxGap, 2)
  assert.equal(r.maxGapEnd, 'd')
})

test('爽点：空窗超阈值判不 ok', () => {
  const entries = [{ file: 'a', text: '赢' }, { file: 'b', text: '喝水' }, { file: 'c', text: '睡觉' },
    { file: 'd', text: '发呆' }, { file: 'e', text: '散步' }]
  assert.equal(payoffDensity(entries, { maxGap: 3 }).ok, false)
})

test('黑名单：加载与命中', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'xiaoyu-bl-'))
  assert.deepEqual(loadBlacklist(root), [])
  writeFileSync(path.join(root, 'blacklist.yml'), '# 注释\n- 照章念台词\n下跪求饶\n', 'utf8')
  const list = loadBlacklist(root)
  assert.equal(list.length, 2)
  assert.ok(list.includes('照章念台词'))
  const r = scanBlacklist('他下跪求饶了，还在照章念台词。', list)
  assert.equal(r.ok, false)
  assert.equal(r.hits.length, 2)
  assert.ok(r.summary.includes('命中'))
})

test('黑名单门禁：默认 block、warn 放行', () => {
  const bad = { ok: false, hits: [{ word: '下跪求饶', count: 1 }], summary: '命中禁忌 1 项' }
  assert.equal(gateBlacklist(bad, 'block').pass, false)
  assert.equal(gateBlacklist(bad, 'warn').pass, true)
  assert.equal(gateBlacklist({ ok: true, hits: [], summary: '' }, 'block').pass, true)
})
