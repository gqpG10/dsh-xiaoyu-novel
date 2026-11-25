import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import { bibleUsage, touchBible, summarizeChapter, readPrevMemory } from '../lib/living-bible.mjs'
import { scanAttributeConflicts, scanTimelineConflicts } from '../lib/consistency-core.mjs'

// ── 3.23.0 活设定集 + 章后记忆 + 连续性体检 ─────────────────────────────

function book() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'xiaoyu-lb-'))
  mkdirSync(path.join(dir, 'chapters'), { recursive: true })
  mkdirSync(path.join(dir, 'characters'), { recursive: true })
  mkdirSync(path.join(dir, 'bible'), { recursive: true })
  mkdirSync(path.join(dir, 'memory'), { recursive: true })
  writeFileSync(path.join(dir, 'bible', '断刀.yml'), 'name: 断刀\n内容: 陈家家传\n', 'utf8')
  writeFileSync(path.join(dir, 'bible', 'old-map.yml'), 'name: 旧地图\n', 'utf8')
  return dir
}

test('活设定集：touchBible 合法章名闸 + 使用排序', () => {
  const dir = book()
  try {
    assert.equal(touchBible(dir, '../evil').ok, false)
    const r = touchBible(dir, '断刀')
    assert.equal(r.ok, true)
    assert.equal(r.touched, true)
    // 幂等：同一天再 touch 不重复标记
    assert.equal(touchBible(dir, '断刀').touched, false)
    const usage = bibleUsage(dir)
    assert.equal(usage.length, 2)
    assert.equal(usage[0].name, '断刀', '用过的排前面')
    assert.equal(usage[1].lastUsed, null, '没用过的沉底')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('章后记忆：summarizeChapter 首尾段 + 钩子识别；readPrevMemory 取最近', () => {
  const dir = book()
  try {
    const s = summarizeChapter('雨夜里他推开了酒馆的门。\n\n“你来晚了。”老板擦着杯子说。\n\n“刀呢？”他问。')
    assert.equal(s.ok, true)
    assert.match(s.summary, /开章：雨夜/)
    assert.match(s.summary, /收章/)
    assert.equal(s.tailHook, true, '章尾问号留问')
    assert.ok(s.dialogLines >= 1)
    writeFileSync(path.join(dir, 'memory', 'v01-c001.yml'), s.summary, 'utf8')
    const prev = readPrevMemory(dir, ['v01-c001', 'v01-c002'])
    assert.equal(prev.chapter, 'v01-c001')
    assert.match(prev.text, /开章/)
    // 空章拒绝
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
    assert.match(ps[0].message, /红瞳/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('连续性②：时间倒流检出（第1章引用第5章）', () => {
  const dir = book()
  try {
    for (let i = 1; i <= 5; i++) writeFileSync(path.join(dir, 'chapters', 'v01-c00' + i + '.md'), '第' + i + '章正文。' + (i === 1 ? '回想第5章那晚的事。' : ''), 'utf8')
    const ps = scanTimelineConflicts(dir)
    assert.equal(ps.length, 1)
    assert.equal(ps[0].kind, 'time-travel')
    assert.match(ps[0].message, /时间倒流/)
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
