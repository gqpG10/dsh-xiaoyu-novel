import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { checkFormat } from '../lib/format-core.mjs'
import { parseFlatYamlArray } from '../lib/novel-parse.mjs'
import {
  applyRelationDedupe,
  chapterHintOf,
  chapterKey,
  compareChapter,
  normalizePhase,
  planRelationDedupe,
  relationKey,
  renderRelationsFile,
} from '../lib/relations-dedupe.mjs'

const entry = (over) => ({ a: 'chen-lei', b: 'lao-zhou', type: '同盟', description: '', intensity: 3, started: '', ended: '', ...over })

test('chapterKey / compareChapter：章号排序', () => {
  assert.deepEqual(chapterKey('v02-c056'), [2, 56])
  assert.deepEqual(chapterKey(''), [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER])
  assert.ok(compareChapter('v01-c010', 'v02-c001') < 0)
  assert.ok(compareChapter('v02-c056', 'v02-c055') > 0)
  assert.equal(compareChapter('v02-c056', 'v02-c056'), 0)
})

test('chapterHintOf：从描述取 ch 号', () => {
  assert.equal(chapterHintOf('ch61 追记：翻手比指印方向'), 61)
  assert.equal(chapterHintOf('第 63 章：他从队尾走来'), 63)
  assert.equal(chapterHintOf('没有章号的普通描述'), null)
})

test('normalizePhase：中文别名归一', () => {
  assert.equal(normalizePhase('现在'), 'now')
  assert.equal(normalizePhase('过去'), 'past')
  assert.equal(normalizePhase('潜在'), 'potential')
  assert.equal(normalizePhase(''), '')
})

test('relationKey：a/b 无序，type 参与', () => {
  assert.equal(relationKey({ a: 'x', b: 'y', type: '同盟' }), relationKey({ a: 'y', b: 'x', type: '同盟' }))
  assert.notEqual(relationKey({ a: 'x', b: 'y', type: '同盟' }), relationKey({ a: 'x', b: 'y', type: '对立' }))
})

test('planRelationDedupe：合并组数、intensity 取最大、started 最早、ended 最晚', () => {
  const relations = [
    entry({ description: '第一章的事', intensity: 2, started: 'v01-c010' }),
    entry({ description: '第二章的事', intensity: 5, started: 'v01-c002', ended: 'v02-c010' }),
    entry({ description: '第三章的事', intensity: 3, started: 'v01-c030', ended: 'v03-c001' }),
    entry({ a: 'chen-lei', b: 'hu-yiming', type: '亲友', description: '单条', intensity: 4, started: 'v01-c001' }),
  ]
  const plan = planRelationDedupe({ relations })
  assert.equal(plan.before, 4)
  assert.equal(plan.kept, 2)
  const merged = plan.groups.find((g) => g.count === 3)
  assert.ok(merged !== undefined)
  assert.equal(merged.entry.intensity, 5)
  assert.equal(merged.entry.started, 'v01-c002')
  assert.equal(merged.entry.ended, 'v03-c001')
  // 描述一条不丢
  assert.ok(merged.entry.description.includes('第一章的事'))
  assert.ok(merged.entry.description.includes('第二章的事'))
  assert.ok(merged.entry.description.includes('第三章的事'))
})

test('planRelationDedupe：不同类型不合并（雇佣与对立是两条真关系）', () => {
  const relations = [
    entry({ type: '同盟' }),
    entry({ type: '对立' }),
  ]
  const plan = planRelationDedupe({ relations })
  assert.equal(plan.kept, 2)
  assert.equal(plan.merged, 0)
})

test('planRelationDedupe：无重复时零改动', () => {
  const relations = [entry({}), entry({ a: 'x', b: 'y' })]
  const plan = planRelationDedupe({ relations })
  assert.equal(plan.kept, 2)
  assert.equal(plan.groups.filter((g) => g.changed).length, 0)
})

test('render + parse 往返：多行描述、冒号、引号都不丢', () => {
  const tricky = '第一段：有冒号\n第二段带"引号"和#井号\n第三段'
  const relations = [entry({ description: tricky, intensity: 5, started: 'v01-c001' })]
  const plan = planRelationDedupe({ relations })
  const rendered = renderRelationsFile(plan.groups.map((g) => g.entry))
  const back = parseFlatYamlArray(rendered)
  assert.equal(back.length, 1)
  assert.equal(back[0].description, tricky, '多行描述必须原样往返')
})

test('novel-parse 支持块标量（|-）——去重写回的前提', () => {
  const yml = [
    '- a: x',
    '  b: y',
    '  type: z',
    '  description: |-',
    '    第一行',
    '    中间有: 冒号',
    '    第三行',
    '  intensity: 4',
  ].join('\n')
  const parsed = parseFlatYamlArray(yml)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].description, '第一行\n中间有: 冒号\n第三行')
  assert.equal(parsed[0].intensity, 4)
})

test('applyRelationDedupe：写前备份、写后条目变少且可解析', () => {
  const dir = path.join(tmpdir(), 'xiaoyu-dedupe-' + Date.now().toString(36))
  mkdirSync(dir, { recursive: true })
  const original = [
    '- a: chen-lei',
    '  b: lao-zhou',
    '  type: 同盟',
    '  description: 第一章追记',
    '  intensity: 3',
    '  started: v01-c010',
    '  ended: ""',
    '- a: chen-lei',
    '  b: lao-zhou',
    '  type: 同盟',
    '  description: 第二章追记',
    '  intensity: 5',
    '  started: v01-c002',
    '  ended: ""',
  ].join('\n')
  writeFileSync(path.join(dir, 'relations.yml'), original)
  const relations = parseFlatYamlArray(original)
  const result = applyRelationDedupe(dir, relations)
  assert.equal(result.changed, true)
  assert.equal(result.before, 2)
  assert.equal(result.after, 1)
  assert.ok(readFileSync(result.backup, 'utf8').includes('第二章追记'), '备份必须是原文')
  const after = parseFlatYamlArray(readFileSync(path.join(dir, 'relations.yml'), 'utf8'))
  assert.equal(after.length, 1)
  assert.ok(after[0].description.includes('第一章追记'))
  assert.ok(after[0].description.includes('第二章追记'))
  assert.equal(after[0].intensity, 5)
  assert.equal(after[0].started, 'v01-c002')
  rmSync(dir, { recursive: true, force: true })
})

test('applyRelationDedupe：没有重复时不写盘', () => {
  const dir = path.join(tmpdir(), 'xiaoyu-dedupe2-' + Date.now().toString(36))
  mkdirSync(dir, { recursive: true })
  const original = '- a: x\n  b: y\n  type: z\n  description: 只有一条\n  intensity: 2\n  started: ""\n  ended: ""\n'
  writeFileSync(path.join(dir, 'relations.yml'), original)
  const result = applyRelationDedupe(dir, parseFlatYamlArray(original))
  assert.equal(result.changed, false)
  assert.equal(readFileSync(path.join(dir, 'relations.yml'), 'utf8'), original)
  rmSync(dir, { recursive: true, force: true })
})

test('checkFormat：报出关系重复配对（图上一对多边）', () => {
  const dir = path.join(tmpdir(), 'xiaoyu-dupcheck-' + Date.now().toString(36))
  mkdirSync(path.join(dir, 'chapters'), { recursive: true })
  writeFileSync(
    path.join(dir, 'relations.yml'),
    [
      '- a: chen-lei',
      '  b: lao-zhou',
      '  type: 同盟',
      '  description: 一',
      '  intensity: 3',
      '- a: chen-lei',
      '  b: lao-zhou',
      '  type: 同盟',
      '  description: 二',
      '  intensity: 4',
    ].join('\n') + '\n',
  )
  const result = checkFormat(dir)
  const dup = result.problems.filter((p) => p.message.includes('重复'))
  assert.equal(dup.length, 1, '同一对同一类型只报一次')
  assert.match(dup[0].message, /chen-lei/)
  assert.match(dup[0].message, /lao-zhou/)
  assert.match(dup[0].message, /2 条重复/)
  rmSync(dir, { recursive: true, force: true })
})

test('checkFormat：不同类型不算重复', () => {
  const dir = path.join(tmpdir(), 'xiaoyu-dupok-' + Date.now().toString(36))
  mkdirSync(path.join(dir, 'chapters'), { recursive: true })
  writeFileSync(
    path.join(dir, 'relations.yml'),
    [
      '- a: chen-lei',
      '  b: lao-zhou',
      '  type: 同盟',
      '  description: 一',
      '- a: chen-lei',
      '  b: lao-zhou',
      '  type: 对立',
      '  description: 二',
    ].join('\n') + '\n',
  )
  const result = checkFormat(dir)
  assert.equal(result.problems.filter((p) => p.message.includes('重复')).length, 0)
  rmSync(dir, { recursive: true, force: true })
})
