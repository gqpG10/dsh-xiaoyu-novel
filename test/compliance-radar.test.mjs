import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import { complianceScan, scanChapterText } from '../lib/compliance-core.mjs'
import { aggregateCategories, extractInitialState, parseRankState, mergeBookLists } from '../lib/trend-radar.mjs'

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

test('雷达：INITIAL_STATE 提取 + category_id 翻名 + 聚合排序', () => {
  const state = {
    rank: {
      book_list: [
        { bookId: '1', bookName: '书甲', curent_category_id: 261, wordNumber: '100000', readCount: '900' },
        { bookId: '2', bookName: '书乙', curent_category_id: 1141, wordNumber: '200000', readCount: '300' },
        { bookId: '3', bookName: '书丙', curent_category_id: 261, wordNumber: '300000', readCount: '500' },
      ],
      rankCategoryTypeList: { male: [{ id: '261', name: '都市日常' }, { id: '1141', name: '西方奇幻' }] },
    },
  }
  const html = '<script>window.__INITIAL_STATE__=' + JSON.stringify(state) + ';</script>'
  const st = extractInitialState(html)
  assert.ok(st, '必须能从无空格等号后解析 JSON')
  const { books } = parseRankState(st)
  assert.equal(books.length, 3)
  assert.equal(books[0].category, '都市日常', 'ID 要翻成题材名')
  assert.equal(books[1].category, '西方奇幻')
  const cats = aggregateCategories(books)
  assert.equal(cats[0].category, '都市日常')
  assert.equal(cats[0].count, 2)
})

test('雷达：空 HTML 不炸 + 双榜去重', () => {
  assert.equal(extractInitialState('<html></html>'), null)
  assert.equal(aggregateCategories([]).length, 0)
  const merged = mergeBookLists([[{ bookId: '1', title: '甲' }], [{ bookId: '1', title: '甲' }, { bookId: '2', title: '乙' }]])
  assert.equal(merged.length, 2, '同 bookId 只留一本')
})
