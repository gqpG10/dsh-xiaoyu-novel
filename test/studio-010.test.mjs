import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildHandoff, renderHandoff } from '../lib/handoff-core.mjs'
import { paragraphHeat } from '../lib/gate-core.mjs'
import { proposeRelationStarts, applyRelationStarts } from '../lib/relations-tools.mjs'
import { buildSelectionExport } from '../lib/novel-export.mjs'

// ── 0.10.0 六件新能力 ──────────────────────────────────────────────────────
// ① 交接卡：写手开新章拿一张卡就够，不再通读五本账；
// ② 段落热度：门禁只给整章一个分，这条告诉作者先改哪几段；
// ③ 关系起始章补全：以正文为唯一证据，只提议、写前备份、只填空值；
// ④ 勾选导出 EPUB：手机/阅读器直接看；
// ⑤ 前端接线：版本卡/交接卡/热度/派单菜单/双栏/补全入口都在；
// ⑥ i18n：新键中英双全。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

function makeBook() {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-010-'))
  const novel = path.join(dir, 'novel')
  mkdirSync(path.join(novel, 'chapters'), { recursive: true })
  mkdirSync(path.join(novel, 'characters'), { recursive: true })
  mkdirSync(path.join(novel, 'outlines'), { recursive: true })
  writeFileSync(path.join(novel, 'project.yml'), 'title: 测试书\nphase: writing\n', 'utf8')
  writeFileSync(path.join(novel, 'chapters', 'v01-c001.md'),
    '---\nvolume: v01\nnum: 1\ntitle: 第一章\nstatus: accepted\nsummary: 开局\n---\n\n陈磊在门口站着。宋佳佳递来一张纸。\n\n光打在玻璃上，他把纸折好。\n', 'utf8')
  writeFileSync(path.join(novel, 'chapters', 'v01-c002.md'),
    '---\nvolume: v01\nnum: 2\ntitle: 第二章\nstatus: writing\nsummary: 第二章梗概\n---\n\n陈磊回头看了一眼。\n', 'utf8')
  writeFileSync(path.join(novel, 'characters', 'chen-lei.md'), '---\nname: 陈磊\nrole: protagonist\n---\n\n备注。\n', 'utf8')
  writeFileSync(path.join(novel, 'characters', 'song-jiajia.md'), '---\nname: 宋佳佳\nrole: supporting\n---\n\n备注。\n', 'utf8')
  writeFileSync(path.join(novel, 'characters', 'shen-wanxiang.md'), '---\nname: 沈万象\nrole: antagonist\n---\n\n备注。\n', 'utf8')
  writeFileSync(path.join(novel, 'outlines', 'v01-c001.md'), '# 第一章 章纲\n\n- 本章目标：出事\n- 节拍：开场\n\n## 钩子\n- 反转\n', 'utf8')
  writeFileSync(path.join(novel, 'relations.yml'), [
    '- a: chen-lei',
    '  b: song-jiajia',
    '  type: 同盟',
    '  description: 递刀',
    '  intensity: 4',
    '  started: v01-c001',
    '  ended: ""',
    '- a: chen-lei',
    '  b: shen-wanxiang',
    '  type: 对立',
    '  description: 终极对抗',
    '  intensity: 5',
    '  started: ""',
    '  ended: ""',
  ].join('\n') + '\n', 'utf8')
  writeFileSync(path.join(novel, 'foreshadows.yml'), '- id: fs-001\n  title: 玉佩\n  status: planted\n  priority: high\n  planted_chapter: v01-c001\n  expected_resolve: v01-c020\n  resolved_chapter: ""\n  notes: 备注\n', 'utf8')
  return { dir, novel }
}

test('交接卡：出场角色/伏笔/钩子/下一章都能从账本自动汇总', () => {
  const { dir, novel } = makeBook()
  try {
    const model = buildHandoff(novel, 'v01-c001.md')
    assert.equal(model.heading, '第1章 第一章')
    assert.deepEqual(model.cast.map((c) => c.name).sort(), ['宋佳佳', '陈磊'].sort())
    assert.equal(model.beats.length, 2)
    assert.deepEqual(model.hooks, ['反转'])
    assert.equal(model.foreshadows.planted.length, 1)
    assert.equal(model.foreshadows.active.length, 1)
    assert.equal(model.relations.started.length, 1)
    assert.equal(model.next.file, 'v01-c002.md')
    const md = renderHandoff(model)
    assert.match(md, /^# 章节交接卡 · 第1章 第一章/)
    assert.match(md, /## 出场角色/)
    assert.match(md, /## 伏笔/)
    assert.match(md, /## 章尾钩子/)
    assert.ok(!/\n{3,}/.test(md), '交接卡里不应出现连续空行')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('交接卡：文件名不合法与不存在都拒（不读库外文件）', () => {
  const { dir, novel } = makeBook()
  try {
    assert.throws(() => buildHandoff(novel, '../project.yml'), /不合法/)
    assert.throws(() => buildHandoff(novel, 'v01-c999.md'), /不存在/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('段落热度：逐段 0-100，长句/套话段落更热，空段不产生条目', () => {
  const hot = '他缓缓地站起身，微微地笑了笑，仿佛一切都已注定，一种难以言喻的压迫感缓缓地压在众人身上，所有人都知道这意味着什么。'
  const cool = '门开了。'
  const heat = paragraphHeat(hot + '\n\n' + cool + '\n\n   \n\n' + hot)
  assert.equal(heat.length, 3, '空段不该产生热度条目')
  for (const row of heat) {
    assert.ok(row.heat >= 0 && row.heat <= 100, '热度越界：' + row.heat)
    assert.ok(Array.isArray(row.hits))
  }
  assert.ok(heat[0].heat > heat[1].heat, '病灶段应比干净段热')
  assert.ok(heat[0].hits.length > 0)
})

test('关系起始章：只提议不写盘；写回只填空值、逐行改、留备份', () => {
  const { dir, novel } = makeBook()
  try {
    const before = readFileSync(path.join(novel, 'relations.yml'), 'utf8')
    const proposal = proposeRelationStarts(novel)
    assert.equal(proposal.ok, true)
    assert.equal(proposal.proposals.length, 1, '只有一条缺 started')
    // 沈万象没在正文出现过：不猜，标 null 并给原因
    assert.equal(proposal.proposals[0].chapter, null)
    assert.match(proposal.proposals[0].reason, /尚未|人工|出场/)
    assert.equal(readFileSync(path.join(novel, 'relations.yml'), 'utf8'), before, '提议阶段不得改文件')
    // 手动指定一条可写的：写回后 started 补上，其他字段与注释原样
    const applied = applyRelationStarts(novel, [{ index: 1, chapter: 'v01-c002' }])
    assert.equal(applied.ok, true)
    assert.equal(applied.applied, 1)
    const after = readFileSync(path.join(novel, 'relations.yml'), 'utf8')
    assert.match(after, /started: v01-c002/)
    assert.match(after, /type: 对立/)
    assert.equal(readFileSync(path.join(novel, 'relations.yml.bak'), 'utf8'), before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('关系起始章：已有 started 的条目不会被覆盖', () => {
  const { dir, novel } = makeBook()
  try {
    const applied = applyRelationStarts(novel, [{ index: 0, chapter: 'v01-c009' }])
    assert.equal(applied.applied, 0)
    assert.equal(applied.skipped, 1)
    assert.match(readFileSync(path.join(novel, 'relations.yml'), 'utf8'), /started: v01-c001/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('勾选导出 EPUB：生成合法 zip（mimetype 在首位）且含章节标题', () => {
  const { dir, novel } = makeBook()
  try {
    const built = buildSelectionExport({ novelDir: novel, files: '1,2', format: 'epub', title: '测试书' })
    assert.equal(built.chapters.length, 2)
    const buf = built.buffer
    assert.equal(buf.subarray(0, 2).toString(), 'PK')
    assert.ok(buf.includes(Buffer.from('application/epub+zip')), '缺 mimetype')
    assert.ok(buf.includes(Buffer.from('第1章 第一章')), '章节标题没进书')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('前端接线：版本卡/交接卡/热度/派单菜单/双栏/补全入口都在', () => {
  const js = read('lib/client.js')
  for (const needle of [
    'function VersionCard(',
    'function HandoffModal(',
    'function HeatStrip(',
    'function BriefMenu(',
    'function RelationAutofill(',
    'git-status', 'git-init', 'git-commit', 'git-restore',
    'relations-autofill',
    'exportSel("epub")',
    'data-split',
  ]) assert.ok(js.includes(needle), '缺接线：' + needle)
})

test('i18n：0.10.0 新键中英双全', () => {
  const js = read('lib/client.js')
  const keys = [
    'version.title', 'version.init', 'version.commit', 'version.changed', 'version.hint', 'version.restoreConfirm',
    'handoff.open', 'handoff.title', 'handoff.copy', 'handoff.hint',
    'heat.title', 'heat.top', 'heat.cellTip',
    'brief.open', 'brief.write', 'brief.polish', 'brief.review', 'brief.body.write', 'brief.body.polish', 'brief.body.review',
    'split.on', 'split.off',
    'rel.autofillBtn', 'rel.autofillTitle', 'rel.autofillApply', 'rel.autofillDone',
    'chapters.exportEpub',
  ]
  for (const key of keys) {
    const hits = js.split('"' + key + '":').length - 1
    assert.equal(hits, 2, key + ' 应中英各一条，实得 ' + hits)
  }
})

test('样式：版本卡/交接卡/热度条/派单菜单/双栏都有规则', () => {
  const css = read('lib/base.css')
  for (const needle of ['.myt-verList', '.myt-handoffText', '.myt-heatBar', '.myt-briefPop', '.myt-readerBody[data-split="true"]']) {
    assert.ok(css.includes(needle), '缺样式：' + needle)
  }
})
