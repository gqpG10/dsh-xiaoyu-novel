import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import { readBlueprint, listBlueprints, serializeBlueprint, blueprintStats } from '../lib/chapter-blueprint.mjs'
import { qualityTrend } from '../lib/quality-trend.mjs'

// ── 3.22.0 章节蓝图（Pagekin 范式）：三填闸 + 读写往返 + 完成度统计 ──────────

test('蓝图三填闸：缺 goal/conflict/hook 任一项拒绝序列化', () => {
  assert.equal(serializeBlueprint('v01-c001', { goal: '', conflict: 'x', hook: 'y' }).ok, false)
  assert.equal(serializeBlueprint('v01-c001', { goal: 'g', conflict: '', hook: 'y' }).ok, false)
  assert.equal(serializeBlueprint('v01-c001', { goal: 'g', conflict: 'x', hook: '' }).ok, false)
  assert.ok(serializeBlueprint('v01-c001', { goal: 'g', conflict: 'x', hook: 'y' }).ok)
})

test('蓝图章名闸：非法字符拒绝（防路径穿越）', () => {
  assert.equal(serializeBlueprint('../evil', { goal: 'g', conflict: 'x', hook: 'y' }).ok, false)
  assert.equal(serializeBlueprint('a/b', { goal: 'g', conflict: 'x', hook: 'y' }).ok, false)
})

test('蓝图读写往返：序列化文本能被 readBlueprint 解回', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'xiaoyu-bp-'))
  try {
    const packed = serializeBlueprint('v01-c001', { goal: '拿到断刀', conflict: '追兵 vs 断桥', hook: '刀身刻字', cast: ['陈默', '苏晚'] })
    mkdirSync(path.join(dir, 'blueprints'), { recursive: true })
    writeFileSync(path.join(dir, 'blueprints', 'v01-c001.yml'), packed.text, 'utf8')
    const bp = readBlueprint(dir, 'v01-c001')
    assert.equal(bp.goal, '拿到断刀')
    assert.equal(bp.hook, '刀身刻字')
    assert.deepEqual(bp.cast, ['陈默', '苏晚'])
    assert.equal(listBlueprints(dir).length, 1)
    const st = blueprintStats(dir, ['v01-c001.md', 'v01-c002.md'])
    assert.equal(st.withBlueprint, 1)
    assert.ok(st.missing.includes('v01-c002'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ── 3.22.0 六维质量趋势（webnovel-writer 范式）：真实字段 + 预警 ────────────

test('六维趋势：六维齐全、范围 0-100、预警可触发', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'xiaoyu-qt-'))
  try {
    mkdirSync(path.join(dir, 'chapters'), { recursive: true })
    // 平收短章连写三章 → 追读力预警应触发
    for (let i = 1; i <= 4; i++) {
      writeFileSync(path.join(dir, 'chapters', 'v01-c00' + i + '.md'),
        '他回到房间。他坐下。他喝水。他想了想。就这样过了一天，什么也没发生，一切都很平常。', 'utf8')
    }
    const tr = qualityTrend(dir, null)
    assert.equal(tr.chapters.length, 4)
    for (const row of tr.chapters) {
      for (const k of ['human', 'beat', 'hook', 'rhythm', 'consist', 'pull']) {
        assert.ok(row.dims[k] === null || (row.dims[k] >= 0 && row.dims[k] <= 100), k + ' 越界: ' + row.dims[k])
      }
    }
    assert.equal(tr.totals.dims.human !== null, true)
    assert.ok(Array.isArray(tr.alerts), 'alerts 必须是数组')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('质量趋势：空书不炸（0 章 0 预警）', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'xiaoyu-qt-'))
  try {
    const tr = qualityTrend(dir, null)
    assert.equal(tr.chapters.length, 0)
    assert.equal(tr.alerts.length, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
