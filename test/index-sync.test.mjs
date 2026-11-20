import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createChapterFromOutline } from '../lib/panel-core.mjs'

// ── 建章顺手重建索引（0.9.3）───────────────────────────────────────────────
// 现场提醒：「索引 22 条与 chapters/ 23 章不一致——重建索引（xiaoyu-novel index）」。
// 根因是新建章节后派生文件 index.yml 没跟上。从章纲建章是面板自己的一条路，
// 这里守住它建完就把索引对齐：书稿不再一边写一边挂着黄条，主编读概览也不会
// 漏掉新章。索引重建失败只能影响索引，不许把建章结果否掉。

const PROJECT = 'title: 测试书\nphase: writing\n'

function makeBook({ withIndex }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-idx-'))
  const novel = path.join(dir, 'novel')
  mkdirSync(path.join(novel, 'chapters'), { recursive: true })
  mkdirSync(path.join(novel, 'outlines'), { recursive: true })
  writeFileSync(path.join(novel, 'project.yml'), PROJECT, 'utf8')
  writeFileSync(path.join(novel, 'chapters', 'v01-c001.md'), '---\nvolume: v01\nnum: 1\ntitle: 第一章\nstatus: writing\n---\n\n正文。\n', 'utf8')
  writeFileSync(path.join(novel, 'outlines', 'v01-c002.md'), '# 第二章 章纲\n\n- 本章目标：出事\n', 'utf8')
  if (withIndex) {
    // 落后一版的索引：只有第 1 章
    writeFileSync(path.join(novel, 'index.yml'), 'volumes:\n  - id: v01\n    title: 第一卷\n    chapters:\n        - {num: 1, title: 第一章, status: writing, words: 4, summary: ""}\n', 'utf8')
  }
  return { dir, novel }
}

test('从章纲建章：建完索引立刻对齐，体检不再报不一致', () => {
  const { dir, novel } = makeBook({ withIndex: true })
  try {
    const res = createChapterFromOutline(novel, 'v01-c002.md')
    assert.equal(res.ok, true)
    assert.equal(res.file, 'v01-c002.md')
    assert.equal(res.index_rebuilt, true, '建章后应重建索引')
    const index = readFileSync(path.join(novel, 'index.yml'), 'utf8')
    assert.ok(index.includes('第二章'), '重建后的索引没收录新章：' + index.slice(0, 200))
    assert.ok(index.includes('num: 1'), '重建把老章丢了')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('从章纲建章：原本没有 index.yml 也会生成', () => {
  const { dir, novel } = makeBook({ withIndex: false })
  try {
    const res = createChapterFromOutline(novel, 'v01-c002.md')
    assert.equal(res.ok, true)
    assert.equal(res.index_rebuilt, true)
    assert.ok(existsSync(path.join(novel, 'index.yml')), '没有 index.yml 时建章应顺手生成')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
