import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseStateSnapshot } from '../lib/panel-core.mjs'
import { chapterLedgerHint, ledgerStats, LEDGER_WARN_BYTES } from '../lib/ledger-stats.mjs'

// ── 0.15.0：账本体检 / 记账提示 / 首屏精简体 / 面板工具入口 ────────────────
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

function makeBook() {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-015-'))
  const novel = path.join(dir, 'novel')
  mkdirSync(path.join(novel, 'chapters'), { recursive: true })
  mkdirSync(path.join(novel, 'characters'), { recursive: true })
  writeFileSync(path.join(novel, 'project.yml'), 'title: 测试书\nphase: writing\n', 'utf8')
  writeFileSync(path.join(novel, 'chapters', 'v01-c001.md'),
    '---\nvolume: v01\nnum: 1\ntitle: 第一章\nstatus: accepted\nsummary: 开局\n---\n\n第一章正文。\n', 'utf8')
  writeFileSync(path.join(novel, 'chapters', 'v01-c002.md'),
    '---\nvolume: v01\nnum: 2\ntitle: 第二章\nstatus: writing\nsummary: 承接\n---\n\n第二章正文。\n', 'utf8')
  writeFileSync(path.join(novel, 'characters', 'chen-lei.md'), '---\nname: 陈磊\nrole: protagonist\n---\n\n备注。\n', 'utf8')
  const long = '长'.repeat(320)
  writeFileSync(path.join(novel, 'memories.yml'), [
    '- category: event',
    '  content: 第一章的事',
    '  source_chapter: v01-c001',
    '- category: event',
    '  content: ' + long,
    '  source_chapter: v01-c002',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(novel, 'timeline.yml'), [
    '- year: 2026',
    '  title: 第二天',
    '  description: 第2章发生的事',
    '  importance: 3',
    '  chapter: v01-c002',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(novel, 'clue-board.yml'), [
    '- kind: clue',
    '  content: 一张纸',
    '  related_chapter: v01-c001',
    '  resolved: false',
    '',
  ].join('\n'), 'utf8')
  return novel
}

test('账本体检：字节/条数/超长条目与最长预览', () => {
  const novel = makeBook()
  const stats = ledgerStats(novel)
  assert.equal(stats.ok, true)
  const memories = stats.items.find((it) => it.file === 'memories.yml')
  assert.equal(memories.entries, 2)
  assert.equal(memories.longEntries, 1, '320 字那条应算超长（阈值 300）')
  assert.equal(memories.top[0].len, 320)
  assert.equal(memories.top[0].ref, 'v01-c002')
  assert.equal(memories.heavy, false, '小账本不该判胖')
  assert.equal(LEDGER_WARN_BYTES, 200 * 1024)
  assert.ok(stats.totalBytes > 0)
  rmSync(path.dirname(novel), { recursive: true, force: true })
})

test('记账提示：source_chapter / chapter / 第N章 三种写法都能认出', () => {
  const novel = makeBook()
  const c1 = chapterLedgerHint(novel, 'v01-c001.md', 1)
  assert.deepEqual(c1.found, { 'memories.yml': true, 'timeline.yml': false, 'clue-board.yml': true })
  assert.deepEqual(c1.missing, ['timeline.yml'])
  const c2 = chapterLedgerHint(novel, 'v01-c002.md', 2)
  // timeline 里写的是 v01-c002 + 「第2章」，两种证据都命中；线索板只挂了第 1 章，
  // 所以本章仍缺线索板——这正是提示该说的话（不是「全缺」也不是「全有」）。
  assert.deepEqual(c2.missing, ['clue-board.yml'])
  rmSync(path.dirname(novel), { recursive: true, force: true })
})

test('记账提示：一章都没记时三本账全报缺', () => {
  const novel = makeBook()
  const c3 = chapterLedgerHint(novel, 'v01-c003.md', 99)
  assert.deepEqual(c3.missing, ['memories.yml', 'timeline.yml', 'clue-board.yml'])
  rmSync(path.dirname(novel), { recursive: true, force: true })
})

test('首屏精简体：账本/世界/章纲留空并标 partial，章节与角色照常', () => {
  const novel = makeBook()
  const lite = parseStateSnapshot(novel, { lite: true })
  assert.equal(lite.ok, true)
  assert.equal(lite.chapters.length, 2, '章节骨架必须在')
  assert.equal(lite.characters.length, 1, '角色卡必须在')
  assert.deepEqual(lite.memories, [])
  assert.deepEqual(lite.timeline, [])
  assert.ok(Array.isArray(lite.partial) && lite.partial.length === 7, 'partial 应列出 7 个缺块')
  assert.ok(lite.partial.includes('memories'))
  const full = parseStateSnapshot(novel)
  assert.equal(full.memories.length, 2, '全量必须带账本正文')
  assert.deepEqual(full.partial, [])
  rmSync(path.dirname(novel), { recursive: true, force: true })
})

test('客户端接线：工具弹层三页签 / 两段式快照 / 键盘变量 / 主线开关', () => {
  const client = read('lib/client.js')
  for (const needle of [
    'function ToolsModal(',
    'function TrashPane(',
    'function ExportPane(',
    'function SlimPane(',
    'apiGet("trash"',
    'apiPost("trash-restore"',
    'apiPost("trash-purge"',
    'export-book?path=',
    'apiGet("slim-plan"',
    'apiPost("slim-apply"',
    'apiGet("ledger-stats"',
    'scope: "lite"',
    'reader.ledgerMissing',
    '--myt-vv-inset',
    'strongOnly',
  ]) {
    assert.ok(client.includes(needle), '缺接线：' + needle)
  }
})

test('i18n：0.15.0 新键中英双全', () => {
  const client = read('lib/client.js')
  for (const key of ['tools.title', 'tools.tabTrash', 'tools.tabExport', 'tools.tabSlim', 'tools.trashEmpty', 'tools.slimApply', 'overview.ledgers', 'reader.ledgerMissing', 'relations.strongOnly']) {
    const hits = client.split('"' + key + '":').length - 1
    assert.ok(hits >= 2, key + ' 中英未双全（命中 ' + hits + '）')
  }
})

test('路由与模块接线：回收站/导出/瘦身/体检都在入口挂上', () => {
  const index = read('index.mjs')
  for (const needle of [
    "route === 'trash'",
    "route === 'trash-restore'",
    "route === 'trash-purge'",
    "route === 'export-book'",
    "route === 'slim-plan'",
    "route === 'slim-apply'",
    "route === 'ledger-stats'",
    'chapterLedgerHint',
  ]) {
    assert.ok(index.includes(needle), '缺路由/接线：' + needle)
  }
})
