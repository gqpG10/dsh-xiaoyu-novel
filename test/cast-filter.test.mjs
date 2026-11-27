import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { classifyName, isBackupFile, classifyCharacters, filterForGraph, countAppearances } from '../lib/cast-filter.mjs'

// ── 3.47.0 角色分级（关系图过滤） ─────────────────────────

test('名字形态：描述式/机构/位置短语判路人', () => {
  assert.equal(classifyName('窗后那个人'), 'extra')
  assert.equal(classifyName('门房那位'), 'extra')
  assert.equal(classifyName('登记处'), 'extra')
  assert.equal(classifyName('行政管理机构'), 'extra')
  assert.equal(classifyName('门缝里'), 'extra', '位置短语必须判路人')
  assert.equal(classifyName('桌子下'), 'extra')
  assert.equal(classifyName('掏片时四块'), 'extra')
  assert.equal(classifyName('星途传媒'), 'faction', '带组织后缀判势力')
  assert.equal(classifyName('林辰'), 'main')
  assert.equal(classifyName('王经理'), 'main')
})

test('备份文件识别', () => {
  assert.equal(isBackupFile('linchen.md.bak-c063'), true)
  assert.equal(isBackupFile('chen-mo.md.pre-c064.bak'), true)
  assert.equal(isBackupFile('linchen.md'), false)
})

test('出场统计按章计数', () => {
  const chapters = [
    { file: 'c1', text: '林辰来了。张涛也在。' },
    { file: 'c2', text: '林辰走了。' },
    { file: 'c3', text: '谁都没来。' },
  ]
  const m = countAppearances(chapters, ['林辰', '张涛'])
  assert.equal(m.get('林辰'), 2)
  assert.equal(m.get('张涛'), 1)
})

test('分级：≥10 章主要、3~9 次要、≤2 路人', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'xiaoyu-cast-'))
  const novel = path.join(root, 'novel')
  mkdirSync(path.join(novel, 'characters'), { recursive: true })
  writeFileSync(path.join(novel, 'characters', 'a.md'), '---\nname: 林辰\n---\n', 'utf8')
  writeFileSync(path.join(novel, 'characters', 'b.md'), '---\nname: 小角色\n---\n', 'utf8')
  writeFileSync(path.join(novel, 'characters', 'c.md'), '---\nname: 路人甲\n---\n', 'utf8')
  writeFileSync(path.join(novel, 'characters', 'x.md.bak-c001'), '---\nname: 备份\n---\n', 'utf8')
  writeFileSync(path.join(novel, 'characters', 'd.md'), '---\nname: 窗后那个人\n---\n', 'utf8')

  const chapters = []
  for (let i = 0; i < 12; i++) chapters.push({ file: 'c' + i, text: '林辰出现。' + (i < 4 ? '小角色也在。' : '') + (i === 0 ? '路人甲。' : '') })
  const r = classifyCharacters(novel, chapters, { mainMin: 10, minorMin: 3 })
  assert.equal(r.ok, true)
  assert.ok(r.main.some((x) => x.name === '林辰'))
  assert.ok(r.minor.some((x) => x.name === '小角色'))
  assert.ok(r.extra.some((x) => x.name === '路人甲'))
  assert.ok(r.extra.some((x) => x.name === '窗后那个人'), '描述式名字必须在路人里')
  assert.ok(![...r.main, ...r.minor].some((x) => x.name === '备份'), '备份文件不能算角色')
})

test('tier 手动标注最优先', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'xiaoyu-cast2-'))
  const novel = path.join(root, 'novel')
  mkdirSync(path.join(novel, 'characters'), { recursive: true })
  writeFileSync(path.join(novel, 'characters', 'a.md'), '---\nname: 星途\ntier: faction\n---\n', 'utf8')
  writeFileSync(path.join(novel, 'characters', 'b.md'), '---\nname: 白露\ntier: main\n---\n', 'utf8')
  const chapters = Array.from({ length: 5 }, (_, i) => ({ file: 'c' + i, text: '白露出现。星途出现。' }))
  const r = classifyCharacters(novel, chapters, { mainMin: 10, minorMin: 3 })
  assert.ok(r.faction.some((x) => x.name === '星途'), '手动 faction 生效')
  assert.ok(r.main.some((x) => x.name === '白露'), '手动 main 生效（无视 5 章门槛）')
})

test('关系图过滤：默认只留主要+势力，次要可选', () => {
  const rows = [
    { name: 'A', tier: 'main' }, { name: 'B', tier: 'faction' },
    { name: 'C', tier: 'minor' }, { name: 'D', tier: 'extra' },
  ]
  assert.deepEqual(filterForGraph(rows).map((r) => r.name), ['A', 'B'])
  assert.deepEqual(filterForGraph(rows, { showMinor: true }).map((r) => r.name), ['A', 'B', 'C'])
})
