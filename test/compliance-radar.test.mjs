import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import { complianceScan, scanChapterText } from '../lib/compliance-core.mjs'
import { aggregateCategories, parseRankHtmlForTest } from '../lib/trend-radar.mjs'

// ── 3.24.0 合规体检 + 题材雷达 ──────────────────────────────────────

function book() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'xiaoyu-comp-'))
  mkdirSync(path.join(dir, 'chapters'), { recursive: true })
  return dir
}

test('合规：三级命中 + 上下文 + 计数', () => {
  const dir = book()
  try {
    writeFileSync(path.join(dir, 'chapters', 'v01-c001.md'), '他掏出枪支对准门口，场面一度血腥，鲜血淋漓。', 'utf8')
    writeFileSync(path.join(dir, 'chapters', 'v01-c002.md'), '平静的一天。', 'utf8')
    const r = complianceScan(dir)
    assert.equal(r.ok, true)
    assert.equal(r.totals.chapters, 2)
    assert.equal(r.totals.flagged, 1)
    const c1 = r.chapters.find((c) => c.file === 'v01-c001.md')
    const words = c1.hits.map((h) => h.word)
    assert.ok(words.includes('枪支'), '风险级命中')
    assert.ok(words.includes('鲜血淋漓'), '提示级命中')
    const g = c1.hits.find((h) => h.word === '枪支')
    assert.match(g.context, /掏出/)
    // 干净章不进 flagged
    assert.ok(!r.chapters.some((c) => c.file === 'v01-c002.md'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('合规：自定义词库 compliance.yml 合并扩充', () => {
  const dir = book()
  try {
    writeFileSync(path.join(dir, 'compliance.yml'), 'reject:\n  - 我的私有禁词\n', 'utf8')
    writeFileSync(path.join(dir, 'chapters', 'v01-c001.md'), '正文提到我的私有禁词一次。', 'utf8')
    const r = complianceScan(dir)
    assert.ok(r.lexicon.custom === true)
    const hits = r.chapters[0].hits
    assert.equal(hits[0].level, 'error')
    assert.equal(hits[0].word, '我的私有禁词')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('雷达：parseRankHtml 提取 + 题材聚合排序', () => {
  const html = '<script>window.__INITIAL_STATE__ = {"bookList":[{"bookName":"书甲","category":"都市","heat":900},{"bookName":"书乙","category":"玄幻","heat":300},{"bookName":"书丙","category":"都市","heat":500}]};</script>'
  const items = parseRankHtmlForTest(html)
  assert.equal(items.length, 3)
  assert.equal(items[0].title, '书甲')
  const cats = aggregateCategories(items)
  assert.equal(cats[0].category, '都市')
  assert.equal(cats[0].count, 2)
  assert.equal(cats[1].count, 1)
})

test('雷达：空 HTML 不炸', () => {
  assert.equal(parseRankHtmlForTest('<html></html>').length, 0)
  assert.equal(aggregateCategories([]).length, 0)
})
