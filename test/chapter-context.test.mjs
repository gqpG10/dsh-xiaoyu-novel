import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import { chapterContext } from '../lib/chapter-context.mjs'

function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'xiaoyu-ctx-'))
  mkdirSync(path.join(dir, 'chapters'), { recursive: true })
  mkdirSync(path.join(dir, 'characters'), { recursive: true })
  writeFileSync(path.join(dir, 'chapters', 'v01-c001.md'), '陈默推开门，苏晚站在雨里。', 'utf8')
  writeFileSync(path.join(dir, 'chapters', 'v01-c002.md'), '陈默握紧了刀。', 'utf8')
  writeFileSync(path.join(dir, 'characters', 'chen-mo.yml'), 'name: 陈默\nsecret: 军方身份\n', 'utf8')
  writeFileSync(path.join(dir, 'characters', 'su-wan.yml'), 'name: 苏晚\n', 'utf8')
  writeFileSync(path.join(dir, 'foreshadows.yml'), [
    '- id: F01',
    '  title: 断刀',
    '  status: progressing',
    '  planted_chapter: v01-c001',
    '  expected_resolve: v01-c002',
    '- id: F02',
    '  title: 军方安排',
    '  status: progressing',
    '  planted_chapter: v01-c001',
    '  reader_known: v01-c009',
  ].join('\n'), 'utf8')
  return dir
}

test('每章智能上下文：命中角色（正文包含名字兜底）', () => {
  const dir = fixture()
  try {
    const ctx = chapterContext(dir, 'v01-c001')
    assert.ok(ctx.cast.includes('陈默'), '第一章命中陈默，实际: ' + JSON.stringify(ctx.cast))
    assert.ok(ctx.cast.includes('苏晚'), '第一章命中苏晚')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('到期伏笔：expected_resolve 落在本章的进 due', () => {
  const dir = fixture()
  try {
    const c2 = chapterContext(dir, 'v01-c002')
    assert.equal(c2.foreshadows.due.length, 1)
    assert.equal(c2.foreshadows.due[0].id, 'F01')
    const c1 = chapterContext(dir, 'v01-c001')
    assert.equal(c1.foreshadows.due.length, 0)
    assert.ok(c1.foreshadows.warm.some((f) => f.id === 'F01'), '刚埋的伏笔进 warm')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('信息差警戒：reader_known 晚于本章 → secrets + 禁提提示', () => {
  const dir = fixture()
  try {
    const c1 = chapterContext(dir, 'v01-c001')
    const f02 = c1.secrets.find((s) => s.id === 'F02')
    assert.ok(f02, 'F02 读者第九章才知道，第一章必须进 secrets')
    assert.match(f02.hint, /不得提及|未知/)
    assert.ok(c1.secrets.some((s) => s.id === 'F01'), '未分家的 F01 按「读者未知」保守处理')
    assert.equal(c1.stats.secretN, 2)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('resolved 伏笔不进任何窗口', () => {
  const dir = fixture()
  try {
    const fsPath = path.join(dir, 'foreshadows.yml')
    const raw = readFileSync(fsPath, 'utf8')
    writeFileSync(fsPath, raw + '\n- id: F03\n  title: 旧刀\n  status: resolved\n  planted_chapter: v01-c001\n  expected_resolve: v01-c002\n', 'utf8')
    const c2 = chapterContext(dir, 'v01-c002')
    assert.ok(!c2.foreshadows.due.some((f) => f.id === 'F03'), '已回收不进 due')
    assert.ok(!c2.secrets.some((s) => s.id === 'F03'), '已回收不进 secrets')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('castRows 优先：给矩阵数据时不再自扫正文', () => {
  const dir = fixture()
  try {
    const ctx = chapterContext(dir, 'v01-c001', [{ stem: 'v01-c001', name: '陈默' }])
    assert.deepEqual(ctx.cast, ['陈默'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
