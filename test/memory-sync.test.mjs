import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { memoryHealth, syncMemories, compressRange, listChapters } from '../lib/memory-sync.mjs'

// ── 3.45.0 记忆自动同步 ───────────────────────────────────

function makeBook(chapters = 3) {
  const root = mkdtempSync(path.join(tmpdir(), 'xiaoyu-mem-'))
  const novel = path.join(root, 'novel')
  mkdirSync(path.join(novel, 'chapters'), { recursive: true })
  for (let i = 1; i <= chapters; i++) {
    writeFileSync(path.join(novel, 'chapters', 'v01-c' + String(i).padStart(3, '0') + '.md'),
      '---\nnum: ' + i + '\n---\n第一段开头内容。\n\n“他说了什么吗？”\n\n最后一段收在悬念里？\n', 'utf8')
  }
  return novel
}

test('listChapters 排序并排除备份文件', () => {
  const novel = makeBook(3)
  writeFileSync(path.join(novel, 'chapters', 'v01-c002.md.pre-fix'), 'x', 'utf8')
  const list = listChapters(novel)
  assert.equal(list.length, 3)
  assert.equal(list[0], 'v01-c001.md')
})

test('健康度：没有记忆时报 0%', () => {
  const novel = makeBook(3)
  const h = memoryHealth(novel)
  assert.equal(h.total, 3)
  assert.equal(h.withMemory, 0)
  assert.equal(h.ratioPct, 0)
  assert.equal(h.missing, 3)
})

test('批量回填：全部写完，且摘要含开章/收章', () => {
  const novel = makeBook(3)
  const r = syncMemories(novel)
  assert.equal(r.ok, true)
  assert.equal(r.written, 3)
  assert.equal(r.skipped, 0)
  assert.ok(existsSync(path.join(novel, 'memory', 'v01-c001.yml')))
  const txt = readFileSync(path.join(novel, 'memory', 'v01-c001.yml'), 'utf8')
  assert.match(txt, /开章/)
  assert.match(txt, /收章/)
  const h = memoryHealth(novel)
  assert.equal(h.ratioPct, 100)
})

test('二次回填不覆盖已有（force 才重写）', () => {
  const novel = makeBook(2)
  syncMemories(novel)
  const r2 = syncMemories(novel)
  assert.equal(r2.written, 0)
  assert.equal(r2.skipped, 2)
  const r3 = syncMemories(novel, { force: true })
  assert.equal(r3.written, 2)
})

test('limit 只处理前 N 章', () => {
  const novel = makeBook(5)
  const r = syncMemories(novel, { limit: 2 })
  assert.equal(r.written, 2)
  assert.equal(memoryHealth(novel).withMemory, 2)
})

test('段压缩：连续区间生成 segments/*.yml', () => {
  const novel = makeBook(5)
  const r = compressRange(novel, { from: 'v01-c001', to: 'v01-c003' })
  assert.equal(r.ok, true)
  assert.equal(r.chapters, 3)
  assert.ok(existsSync(path.join(novel, 'memory', 'segments', 'v01-c001_v01-c003.yml')))
  assert.match(readFileSync(path.join(novel, 'memory', 'segments', 'v01-c001_v01-c003.yml'), 'utf8'), /段记忆/)
})

test('段压缩：区间无效或不足 2 章要拒绝', () => {
  const novel = makeBook(3)
  assert.equal(compressRange(novel, { from: 'v01-c001', to: 'v01-c001' }).ok, false)
  assert.equal(compressRange(novel, { from: 'v01-c003', to: 'v01-c001' }).ok, false)
  assert.equal(compressRange(novel, { from: '不存在', to: 'v01-c002' }).ok, false)
})
