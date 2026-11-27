import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chapterOrder, parseForeshadows, auditForeshadows, gateForeshadow } from '../lib/foreshadow-audit.mjs'
import { loadStyleConfig, checkChapterStyle, writeStyleConfig, DEFAULT_STYLE_CONFIG } from '../lib/style-config.mjs'

// ── 3.42.0 P1：伏笔生命周期 + 文风结构化 ───────────────────────

function makeBook(chapters = ['v01-c001', 'v01-c002', 'v01-c003'], foreshadows = '') {
  const root = mkdtempSync(path.join(tmpdir(), 'xiaoyu-p1-'))
  const novel = path.join(root, 'novel')
  mkdirSync(path.join(novel, 'chapters'), { recursive: true })
  for (const c of chapters) writeFileSync(path.join(novel, 'chapters', c + '.md'), '---\nnum: 1\n---\n正文。\n', 'utf8')
  if (foreshadows) writeFileSync(path.join(novel, 'foreshadows.yml'), foreshadows, 'utf8')
  return { root, novel }
}

test('chapterOrder 解析 v01-c006 与真实文件名', () => {
  assert.equal(chapterOrder('v01-c006.md'), 10006)
  assert.equal(chapterOrder('v04-c118'), 40118)
  assert.equal(chapterOrder('无格式'), null)
})

test('parseForeshadows 读出台账字段', () => {
  const items = parseForeshadows('- id: fs-001\n  title: 甲\n  status: planted\n  expected_resolve: v01-c002\n')
  assert.equal(items.length, 1)
  assert.equal(items[0].id, 'fs-001')
  assert.equal(items[0].status, 'planted')
})

test('逾期未回收判高危（计划章已写完）', () => {
  const { novel } = makeBook()
  writeFileSync(path.join(novel, 'foreshadows.yml'),
    '- id: fs-001\n  title: 甲\n  status: progressing\n  planted_chapter: v01-c001\n  expected_resolve: v01-c002\n', 'utf8')
  const r = auditForeshadows(novel)
  assert.equal(r.ok, true)
  assert.ok(r.high >= 1)
  assert.ok(r.issues.some((x) => x.kind === 'overdue'))
})

test('已回收的不算逾期；目标章真实存在时不报 missing', () => {
  const { novel } = makeBook()
  writeFileSync(path.join(novel, 'foreshadows.yml'),
    '- id: fs-001\n  title: 甲\n  status: resolved\n  planted_chapter: v01-c001\n  expected_resolve: v01-c002\n  resolved_chapter: v01-c002\n', 'utf8')
  const r = auditForeshadows(novel)
  assert.equal(r.high, 0)
  assert.equal(r.issues.filter((x) => x.kind === 'missing').length, 0, 'v01-c002.md 存在，不能误报 missing')
  assert.equal(r.issues.filter((x) => x.kind === 'overdue').length, 0)
})

test('resolved 却无 resolved_chapter 判矛盾', () => {
  const { novel } = makeBook()
  writeFileSync(path.join(novel, 'foreshadows.yml'),
    '- id: fs-001\n  title: 甲\n  status: resolved\n  planted_chapter: v01-c001\n', 'utf8')
  const r = auditForeshadows(novel)
  assert.ok(r.issues.some((x) => x.kind === 'mismatch'))
})

test('长期挂起用真实位置差（不是卷号加权）', () => {
  const many = Array.from({ length: 25 }, (_, i) => 'v01-c' + String(i + 1).padStart(3, '0'))
  const { novel } = makeBook(many)
  writeFileSync(path.join(novel, 'foreshadows.yml'),
    '- id: fs-001\n  title: 甲\n  status: planted\n  planted_chapter: v01-c001\n  expected_resolve: v01-c099\n', 'utf8')
  const r = auditForeshadows(novel, { staleAfter: 20 })
  const stale = r.issues.find((x) => x.kind === 'stale')
  assert.ok(stale, '应报 stale')
  assert.equal(stale.gap, 24, '25 章里从第 1 章到第 25 章 = 24 章之后')
})

test('没有 foreshadows.yml 时优雅跳过', () => {
  const { novel } = makeBook()
  const r = auditForeshadows(novel)
  assert.equal(r.ok, true)
  assert.equal(r.total, 0)
  assert.match(r.summary, /跳过/)
})

test('gateForeshadow：block 拦高危、warn 放行', () => {
  const audit = { ok: true, issues: [{ kind: 'overdue', severity: 'high', id: 'fs-1', message: '逾期' }] }
  assert.equal(gateForeshadow(audit, 'block').pass, false)
  assert.equal(gateForeshadow(audit, 'warn').pass, true)
  assert.equal(gateForeshadow({ ok: true, issues: [] }, 'block').pass, true)
})

test('文风：从 style.md 抽对话占比与每 N 章', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'xiaoyu-style-'))
  writeFileSync(path.join(root, 'style.md'), '对话占比 15%~45%。每 3 章至少一次嘴仗。每 3 章至少一个具名活人出场。', 'utf8')
  const cfg = loadStyleConfig(root)
  assert.deepEqual(cfg.dialogue_ratio, [0.15, 0.45])
  assert.equal(cfg.verbal_fight_every_n_chapters, 3)
  assert.equal(cfg.source, 'style.md(parsed)')
})

test('文风：已有 style_config.json 优先', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'xiaoyu-style2-'))
  writeFileSync(path.join(root, 'style_config.json'), JSON.stringify({ dialogue_ratio: [0.2, 0.5] }), 'utf8')
  const cfg = loadStyleConfig(root)
  assert.deepEqual(cfg.dialogue_ratio, [0.2, 0.5])
  assert.equal(cfg.source, 'style_config.json')
})

test('writeStyleConfig 落盘可回读', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'xiaoyu-style3-'))
  writeStyleConfig(root, { ai_taste_min: 80 })
  const back = loadStyleConfig(root)
  assert.equal(back.ai_taste_min, 80)
  assert.equal(back.source, 'style_config.json')
})

test('文风校验：对话过少/无对白交锋都报', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'xiaoyu-style4-'))
  const cfg = { ...DEFAULT_STYLE_CONFIG, dialogue_ratio: [0.15, 0.45] }
  const r = checkChapterStyle('他走进屋子。屋里没人。桌上有一杯水。\n然后他出来了。', cfg, { characterNames: ['林辰'] })
  assert.equal(r.ok, false)
  assert.ok(r.issues.some((i) => i.key === 'dialogue_low'))
  assert.ok(r.issues.some((i) => i.key === 'no_verbal_fight'))
})

test('文风校验：对白密集且具名则通过', () => {
  const cfg = { ...DEFAULT_STYLE_CONFIG }
  const text = '林辰说：“你干嘛？”\n张超回：“我乐意。”\n林辰：“你配吗！”\n张超：“试试？”\n' +
    '林辰把杯子放下，冷笑了一声。“那你来。”\n张超盯着他，没说话。'
  const r = checkChapterStyle(text, cfg, { characterNames: ['林辰', '张超'] })
  assert.ok(r.dialogueRatio > 15, '对话占比应超过 15%，实际 ' + r.dialogueRatio)
  assert.equal(r.issues.some((i) => i.key === 'no_named_character'), false)
})
