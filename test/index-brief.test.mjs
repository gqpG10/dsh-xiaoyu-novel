import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseIndexChapters, indexBrief, writeFullBrief } from '../lib/index-brief.mjs'

// ── 3.54.0 记忆体系移除，前情改读索引 ────────────────────────

function book(n) {
  const root = mkdtempSync(path.join(tmpdir(), 'xiaoyu-idx-'))
  mkdirSync(path.join(root, 'chapters'), { recursive: true })
  const lines = ['volumes:', '  - id: v01', '    title: 第一卷', '    chapters:']
  for (let i = 1; i <= n; i++) {
    lines.push('        - {num: ' + i + ', title: 第' + i + '章, status: accepted, words: ' + (2000 + i) + ', summary: 第' + i + '章的剧情概要。他又往前走了一步。}')
  }
  writeFileSync(path.join(root, 'index.yml'), lines.join('\n'), 'utf8')
  return root
}

test('记忆模块已全部删除（不再有 memory-chain/summary/sync）', () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
  for (const f of ['lib/memory-chain.mjs', 'lib/memory-summary.mjs', 'lib/memory-sync.mjs']) {
    assert.equal(existsSync(path.join(root, f)), false, f + ' 应该已删除')
  }
})

test('parseIndexChapters 解析章概要', () => {
  const dir = book(3)
  const p = parseIndexChapters(dir)
  assert.equal(p.ok, true)
  assert.equal(p.total, 3)
  assert.equal(p.chapters[0].num, 1)
  assert.equal(p.chapters[0].title, '第1章')
  assert.match(p.chapters[0].summary, /第1章的剧情概要/)
  assert.equal(p.chapters[0].status, 'accepted')
})

test('indexBrief 按章分块，只取目标章之前', () => {
  const dir = book(6)
  const b = indexBrief(dir, 'v01-c005', 3)
  assert.equal(b.ok, true)
  assert.equal(b.count, 3)
  // 应是 2/3/4 章（c005 之前 3 章）
  assert.deepEqual(b.items.map((x) => x.num), [2, 3, 4])
  assert.match(b.text, /## 第 2 章/)
  assert.match(b.text, /## 第 4 章/)
  assert.ok(!b.text.includes('## 第 5 章'), '不能把目标章自己列进去')
})

test('indexBrief 每块都带状态与字数', () => {
  const dir = book(3)
  const b = indexBrief(dir, 'v01-c003', 2)
  assert.match(b.text, /〔accepted · 2001 字 · v01〕/)
})

test('writeFullBrief 生成 index-brief.md', () => {
  const dir = book(4)
  const w = writeFullBrief(dir)
  assert.equal(w.ok, true)
  assert.equal(w.rel, 'index-brief.md')
  const txt = readFileSync(path.join(dir, 'index-brief.md'), 'utf8')
  assert.match(txt, /全书章概要（阅读版）/)
  assert.match(txt, /## 第 1 章/)
  assert.match(txt, /## 第 4 章/)
})

test('没有 index.yml 时给中文错误', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'xiaoyu-empty-'))
  const p = parseIndexChapters(root)
  assert.equal(p.ok, false)
  assert.match(p.error, /index\.yml/)
})

test('后端与面板都接了索引简报', () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
  const idx = readFileSync(path.join(root, 'index.mjs'), 'utf8')
  assert.ok(idx.includes("route === 'index-brief'"), '要有 index-brief 路由')
  assert.ok(idx.includes("route === 'index-brief-write'"), '要有生成阅读版的路由')
  const panel = readFileSync(path.join(root, 'lib/standalone-panel.html'), 'utf8')
  assert.ok(panel.includes("get('index-brief'"), '本章 tab 要读索引简报')
  assert.ok(panel.includes('idxBriefWrite'), '索引 tab 要能生成阅读版')
  assert.ok(!panel.includes('vMemorySync'), '记忆同步卡应已移除')
})
