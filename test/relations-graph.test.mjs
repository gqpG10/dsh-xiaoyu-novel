import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseStateSnapshot, invalidateSnapshotCache } from '../lib/panel-core.mjs'
import { parseFlatYamlArray } from '../lib/novel-parse.mjs'

// ── 关系图 0.9.0：扩展字段归一 + 关系清单数据面 ─────────────────────────────
// 守住四条：
//   ① 旧 relations.yml 一条不改：direction=both / phase=now / tags=[] / stages=[]
//      （画布行为与 0.8.x 完全一致）；
//   ② 新字段的中英别名都认，认不出的取值静默落缺省，不炸快照；
//   ③ stages 按章号升序、缺章号的阶段被丢弃、章节端点仍归一到角色 name；
//   ④ 零依赖回退解析器读得出一层嵌套块序列（stages），不再散成幽灵条目。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const clientSource = readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
const cssSource = readFileSync(path.join(root, 'lib', 'base.css'), 'utf8')

function makeNovel(relationsYml) {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-rel-'))
  const novel = path.join(dir, 'novel')
  mkdirSync(path.join(novel, 'chapters'), { recursive: true })
  mkdirSync(path.join(novel, 'characters'), { recursive: true })
  writeFileSync(path.join(novel, 'project.yml'), 'title: 测试书\nphase: writing\n', 'utf8')
  writeFileSync(path.join(novel, 'chapters', 'v01-c001.md'), '---\nvolume: v01\nnum: 1\ntitle: 第一章\nstatus: writing\n---\n\n正文。\n', 'utf8')
  writeFileSync(path.join(novel, 'chapters', 'v01-c002.md'), '---\nvolume: v01\nnum: 2\ntitle: 第二章\nstatus: writing\n---\n\n正文。\n', 'utf8')
  writeFileSync(path.join(novel, 'characters', 'chen-lei.md'), '---\nname: 陈磊\nrole: protagonist\n---\n\n备注。\n', 'utf8')
  writeFileSync(path.join(novel, 'characters', 'song-jiajia.md'), '---\nname: 宋佳佳\nrole: supporting\n---\n\n备注。\n', 'utf8')
  writeFileSync(path.join(novel, 'relations.yml'), relationsYml, 'utf8')
  return { dir, novel }
}

const OLD = `- a: chen-lei
  b: song-jiajia
  type: 同盟
  description: 里应外合
  intensity: 4
  started: v01-c001
  ended: ""
`

test('旧格式关系：扩展字段全部走缺省，端点归一到角色 name', () => {
  const { dir, novel } = makeNovel(OLD)
  try {
    const snap = parseStateSnapshot(novel, { yamlLib: null })
    const r = snap.relations[0]
    assert.equal(r.a, '陈磊')
    assert.equal(r.b, '宋佳佳')
    assert.equal(r.type, '同盟')
    assert.equal(r.direction, 'both')
    assert.equal(r.phase, 'now')
    assert.deepEqual(r.tags, [])
    assert.deepEqual(r.stages, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('新字段：中英别名都认，越枚举落缺省', () => {
  const { dir, novel } = makeNovel(`- a: chen-lei
  b: song-jiajia
  type: 雇佣
  intensity: 2
  started: v01-c001
  ended: ""
  direction: a→b
  phase: 潜在
  tags: [内线, 递刀]
- a: song-jiajia
  b: chen-lei
  type: 对立
  intensity: 3
  direction: 反向
  phase: 过去
  tags: 单条, 逗号分
- a: chen-lei
  b: song-jiajia
  type: 同盟
  intensity: 5
  direction: 斜着来
  phase: 明天
`)
  try {
    const snap = parseStateSnapshot(novel, { yamlLib: null })
    const [r1, r2, r3] = snap.relations
    assert.equal(r1.direction, 'a-to-b')
    assert.equal(r1.phase, 'potential')
    assert.deepEqual(r1.tags, ['内线', '递刀'])
    assert.equal(r2.direction, 'b-to-a')
    assert.equal(r2.phase, 'past')
    assert.deepEqual(r2.tags, ['单条', '逗号分'])
    // 认不出的方向/阶段静默落缺省，不炸快照、不改旧行为
    assert.equal(r3.direction, 'both')
    assert.equal(r3.phase, 'now')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stages：按章号升序、缺章号的阶段丢弃、字段回落基字段', () => {
  const { dir, novel } = makeNovel(`- a: chen-lei
  b: song-jiajia
  type: 雇佣
  description: 基字段描述
  intensity: 2
  started: v01-c001
  ended: ""
  stages:
    - chapter: v01-c020
      type: 同盟
      intensity: 5
      description: 后来的事
      phase: 潜在
    - chapter: v01-c005
      type: 雇佣
      intensity: 3
    - type: 缺章号
      intensity: 1
    - chapter: 手写章号
      description: 认不出章号也留着
`)
  try {
    const snap = parseStateSnapshot(novel, { yamlLib: null })
    const stages = snap.relations[0].stages
    assert.equal(stages.length, 3, '缺 chapter 的阶段必须丢弃')
    assert.equal(stages[0].chapter, 'v01-c005')
    assert.equal(stages[0].intensity, 3)
    assert.equal(stages[0].type, '雇佣')
    assert.equal(stages[1].chapter, 'v01-c020')
    assert.equal(stages[1].type, '同盟')
    assert.equal(stages[1].phase, 'potential')
    // 章号认不出的阶段沉底但仍保留（宁可多留，不可静默丢时间线）
    assert.equal(stages[2].chapter, '手写章号')
    // 阶段里没写的字段为 null，客户端回落基字段——这里守住 null 而不是空串
    assert.equal(stages[0].description, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('回退解析器：一层嵌套块序列读成数组，父条目的后续键不串位', () => {
  const parsed = parseFlatYamlArray(`- a: x
  b: y
  stages:
    - chapter: v01-c001
      type: 雇佣
      intensity: 2
    - chapter: v01-c003
      intensity: 5
  ended: ""
  tags: [内线, 递刀]
- a: p
  b: q
`)
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].stages.length, 2)
  assert.equal(parsed[0].stages[1].intensity, 5)
  // ended 必须留在顶层条目上，不能被并进最后一个 stage
  assert.equal(parsed[0].ended, '')
  assert.equal(parsed[0].stages[1].ended, undefined)
  assert.equal(parsed[1].a, 'p')
})

test('客户端接线：关系图新能力都在（聚焦/筛选/按章/导出/清单/触摸）', () => {
  for (const needle of [
    'function relActiveAt(',
    'function relAt(',
    'function relTypeStyle(',
    'function chapOrdinal(',
    'replace(/\\.md$/i, "")', // 章节号比较必须先去 .md 后缀（快照 file 带、relations 不带）
    'function splitLabel(',
    'function sortRelRows(',
    'function exportPng(',
    'function copyList(',
    'function listText(',
    'addEventListener("touchstart"',
    'addEventListener("touchmove"',
    'zoomApiRef.current.reset',
    'onOpenChar: openCharCard',
  ]) {
    assert.ok(clientSource.includes(needle), '缺少实现：' + needle)
  }
})

test('i18n：关系图新键中英双全', () => {
  const keys = [
    'relations.filterChapter', 'relations.allChapters', 'relations.searchPh', 'relations.chipClear',
    'relations.listTitle', 'relations.listCount', 'relations.listEmpty', 'relations.sortBy',
    'relations.sortIntensity', 'relations.sortChapter', 'relations.sortType',
    'relations.exportPng', 'relations.exportPngTip', 'relations.copyList', 'relations.copyListTip',
    'relations.copied', 'relations.pngSaved', 'relations.pngFail', 'relations.copyTitle',
    'relations.copyHint', 'relations.copySelect', 'relations.copyManual', 'relations.close',
    'relations.startedMissing', 'relations.startedMissingOne', 'relations.endedTag', 'relations.stages',
    'relations.focusOn', 'relations.focusClear', 'relations.openChar', 'relations.reset', 'relations.noType',
  ]
  for (const key of keys) {
    const hits = clientSource.split('"' + key + '":').length - 1
    // 中英两份词典各一条；只写中文会静默回落中文，英文界面就露馅
    assert.equal(hits, 2, key + ' 应中英各一条，实得 ' + hits)
  }
})

test('样式：关系清单/筛选/图例都有规则，画布禁掉浏览器手势', () => {
  for (const needle of [
    '.myt-relFilters {',
    '.myt-relRow {',
    '.myt-relDesc {',
    '.myt-chip[data-on="1"]',
    '.myt-legendLine {',
    '.myt-copyBox {',
    'touch-action: none',
  ]) {
    assert.ok(cssSource.includes(needle), '缺少样式：' + needle)
  }
  // 手机档：搜索/章节/排序各占整行（内层横滚在手机上最易卡死）
  const phone = cssSource.slice(cssSource.indexOf('@container (max-width: 640px)'))
  assert.ok(phone.includes('.myt-relSearch { flex-basis: 100%; }'), '手机档搜索框没占整行')
  assert.ok(phone.includes('.myt-relChapSel, .myt-relSort { max-width: none; flex: 1 1 100%; }'), '手机档章节/排序没占整行')
})
