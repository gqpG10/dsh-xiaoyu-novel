import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// ── xiaoyu-novel find：一条命令替代多轮 grep（0.13.0）────────────────────────────
// 绕圈的第一大来源是「不确定搜完没有」。这条命令一次给全命中与总数，并在
// 标题里明说「已含全部命中 / 已截断」——模型看到「已含全部命中」就该收手。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cli = path.join(root, 'bin', 'xiaoyu-novel.mjs')

function makeBook() {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-find-'))
  const novel = path.join(dir, 'novel')
  mkdirSync(path.join(novel, 'chapters'), { recursive: true })
  mkdirSync(path.join(novel, 'characters'), { recursive: true })
  writeFileSync(path.join(novel, 'chapters', 'v01-c001.md'), '---\nnum: 1\n---\n\n陈磊拿起了胃药。\n', 'utf8')
  writeFileSync(path.join(novel, 'chapters', 'v01-c002.md'), '---\nnum: 2\n---\n\n她把胃药放在桌上。\n', 'utf8')
  writeFileSync(path.join(novel, 'characters', 'song.md'), '---\nname: 宋佳佳\n---\n\n常备胃药。\n', 'utf8')
  return { dir, novel }
}

function run(args) {
  return execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
}

test('find：跨章节与角色卡一次给全命中，并标「已含全部命中」', () => {
  const { dir, novel } = makeBook()
  try {
    const out = run(['find', '胃药', novel])
    assert.match(out, /命中 3 处 \/ 3 个文件/)
    assert.match(out, /已含全部命中/)
    assert.match(out, /chapters\/v01-c001\.md/)
    assert.match(out, /characters\/song\.md/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('find：--limit 截断时明确说「已截断」，不让模型以为搜完了', () => {
  const { dir, novel } = makeBook()
  try {
    const out = run(['find', '胃药', novel, '--limit', '1'])
    assert.match(out, /已截断/)
    assert.match(out, /命中 3 处/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('find：--in chapters 只扫正文，--json 给结构化结果', () => {
  const { dir, novel } = makeBook()
  try {
    const chaptersOnly = run(['find', '胃药', novel, '--in', 'chapters'])
    assert.ok(!chaptersOnly.includes('characters/song.md'), '--in chapters 不该扫角色卡')
    const json = JSON.parse(run(['find', '胃药', novel, '--json']))
    assert.equal(json.total, 3)
    assert.equal(json.files, 3)
    assert.equal(json.truncated, false)
    assert.equal(json.hits.length, 3)
    assert.ok(json.hits.every((h) => typeof h.line === 'number' && typeof h.text === 'string'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('find：没有命中时给明确提示，不静默', () => {
  const { dir, novel } = makeBook()
  try {
    const out = run(['find', '不存在的词', novel])
    assert.match(out, /命中 0 处/)
    assert.match(out, /没有命中/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
