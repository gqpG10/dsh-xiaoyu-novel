import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { scanBooks, markRegistered } from '../lib/book-scan.mjs'

// ── 3.48.0 书库扫描（新书选不出来的根因修复） ───────────────

function makeBookWithChapters(root, name, n = 2) {
  const dir = path.join(root, name)
  mkdirSync(path.join(dir, 'chapters'), { recursive: true })
  writeFileSync(path.join(dir, 'project.yml'), 'title: ' + name + ' 之书\n', 'utf8')
  for (let i = 1; i <= n; i++) {
    writeFileSync(path.join(dir, 'chapters', 'v01-c' + String(i).padStart(3, '0') + '.md'), '---\n---\n正文\n', 'utf8')
  }
  return dir
}

test('扫描能找到 novel 与 novel2 两本书', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'xiaoyu-shelf-'))
  makeBookWithChapters(root, 'novel', 3)
  makeBookWithChapters(root, 'novel2', 1)
  const r = scanBooks(root, { depth: 1 })
  assert.equal(r.ok, true)
  assert.equal(r.total, 2, '两本书都要扫到：' + JSON.stringify(r.books.map((b) => b.novelDir)))
  const names = r.books.map((b) => b.title.replace(' 之书', '')).sort()
  assert.deepEqual(names, ['novel', 'novel2'])
})

test('扫描能识别「工作区根自己就是书」', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'xiaoyu-shelf2-'))
  mkdirSync(path.join(root, 'chapters'), { recursive: true })
  writeFileSync(path.join(root, 'chapters', 'v01-c001.md'), '---\n---\n正文\n', 'utf8')
  const r = scanBooks(root, { depth: 0 })
  assert.equal(r.total, 1)
})

test('扫描跳过 .bak / pre- 备份，不计入章节数', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'xiaoyu-shelf3-'))
  const novel = makeBookWithChapters(root, 'novel', 2)
  writeFileSync(path.join(novel, 'chapters', 'v01-c001.md.bak-c063'), 'x', 'utf8')
  writeFileSync(path.join(novel, 'chapters', 'v01-c002.md.pre-c047.bak'), 'x', 'utf8')
  const r = scanBooks(root, { depth: 1 })
  assert.equal(r.books[0].chapters, 2, '备份文件不能算章节')
})

test('扫描跳 node_modules / templates 等目录', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'xiaoyu-shelf4-'))
  makeBookWithChapters(root, 'node_modules', 1)
  makeBookWithChapters(root, 'novel', 2)
  const r = scanBooks(root, { depth: 2 })
  assert.equal(r.total, 1, 'node_modules 下的不算')
})

test('markRegistered 标注已注册状态', () => {
  const books = [{ root: 'E:/a', novelDir: 'E:/a/novel' }, { root: 'E:/b', novelDir: 'E:/b/novel' }]
  const out = markRegistered(books, ['E:/a'])
  assert.equal(out[0].registered, true)
  assert.equal(out[1].registered, false)
  assert.equal(out[0].suggestPath, 'E:/a')
})

test('扫描不存在的目录给明确错误', () => {
  const r = scanBooks(path.join(tmpdir(), '__no_such_dir_xyz__'))
  assert.equal(r.ok, false)
  assert.match(r.error, /不存在/)
})
