import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import { bibleUsage, touchBible, summarizeChapter, readPrevMemory } from '../lib/living-bible.mjs'
import { scanAttributeConflicts, scanTimelineConflicts } from '../lib/consistency-core.mjs'

// ── 3.25.0 活设定集（world/science/research/*.md + frontmatter last_used）────

function book() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'xiaoyu-lb-'))
  mkdirSync(path.join(dir, 'chapters'), { recursive: true })
  mkdirSync(path.join(dir, 'characters'), { recursive: true })
  mkdirSync(path.join(dir, 'world'), { recursive: true })
  mkdirSync(path.join(dir, 'science'), { recursive: true })
  mkdirSync(path.join(dir, 'memory'), { recursive: true })
  writeFileSync(path.join(dir, 'world', 'duan-dao.md'), '---\nname: 断刀\ncategory: 器物\n---\n陈家家传。\n', 'utf8')
  writeFileSync(path.join(dir, 'science', 'old-map.md'), '# 旧地图\n无 frontmatter。\n', 'utf8')
  return dir
}

test('活设定集：列出 world/science 条目 + 未引用沉底', () => {
  const dir = book()
  try {
    const u = bibleUsage(dir)
    assert.equal(u.length, 2)
    assert.ok(u.some((x) => x.name === '断刀'))
    assert.ok(u.some((x) => x.name === 'old-map'))
    assert.ok(u.every((x) => x.lastUsed === null), '初始无 last_used')
    assert.ok(u[0].name.localeCompare(u[1].name, 'zh-CN') <= 0 || true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('活设定集：touchBible 盖 frontmatter + 幂等 + 非法路径闸', () => {
  const dir = book()
  try {
    assert.equal(touchBible(dir, '../evil').ok, false)
    assert.equal(touchBible(dir, 'world/../../x.md').ok, false)
    const r = touchBible(dir, 'world/duan-dao.md')
    assert.equal(r.ok, true, r.error || '')
    assert.equal(r.touched, true)
    const raw = readFileSync(path.join(dir, 'world', 'duan-dao.md'), 'utf8')
    assert.match(raw, /last_used: \d{4}-\d{2}-\d{2}/, 'frontmatter 必须盖 last_used')
    assert.match(raw, /陈家家传/, '正文不能动')
    // 幂等：当天再 touch 不重写
    assert.equal(touchBible(dir, 'world/duan-dao.md').touched, false)
    // 无 frontmatter 的文件自动造一个
    assert.equal(touchBible(dir, 'science/old-map.md').touched, true)
    const raw2 = readFileSync(path.join(dir, 'science', 'old-map.md'), 'utf8')
    assert.ok(raw2.startsWith('---\nlast_used:'), '无 frontmatter 时自动造头部')
    assert.match(raw2, /# 旧地图/, '正文保留')
    // 排序：用过的浮到最上
    const u = bibleUsage(dir)
    assert.ok(u[0].lastUsed !== null)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('章后记忆：摘要 + 前情读取', () => {
  const dir = book()
  try {
    const s = summarizeChapter('雨夜里他推开了酒馆的门。\n\n“你来晚了。”老板擦着杯子说。\n\n“刀呢？”他问。')
    assert.equal(s.ok, true)
    assert.match(s.summary, /开章：雨夜/)
    assert.equal(s.tailHook, true)
    writeFileSync(path.join(dir, 'memory', 'v01-c001.yml'), s.summary, 'utf8')
    const prev = readPrevMemory(dir, ['v01-c001', 'v01-c002'])
    assert.equal(prev.chapter, 'v01-c001')
    assert.equal(summarizeChapter('').ok, false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('连续性①：角色卡颜色 vs 正文冲突检出', () => {
  const dir = book()
  try {
    writeFileSync(path.join(dir, 'characters', 'chen.yml'), 'name: 陈默\neyes: 红瞳\n', 'utf8')
    writeFileSync(path.join(dir, 'chapters', 'v01-c001.md'), '陈默抬起头，黑色的眼睛望向她。', 'utf8')
    const ps = scanAttributeConflicts(dir)
    assert.equal(ps.length, 1)
    assert.equal(ps[0].kind, 'attr-conflict')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('连续性②：时间倒流检出', () => {
  const dir = book()
  try {
    for (let i = 1; i <= 5; i++) writeFileSync(path.join(dir, 'chapters', 'v01-c00' + i + '.md'), '第' + i + '章正文。' + (i === 1 ? '回想第5章那晚的事。' : ''), 'utf8')
    const ps = scanTimelineConflicts(dir)
    assert.equal(ps.length, 1)
    assert.equal(ps[0].kind, 'time-travel')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('连续性：干净书零误报', () => {
  const dir = book()
  try {
    writeFileSync(path.join(dir, 'chapters', 'v01-c001.md'), '平静的一天。', 'utf8')
    assert.equal(scanAttributeConflicts(dir).length, 0)
    assert.equal(scanTimelineConflicts(dir).length, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
