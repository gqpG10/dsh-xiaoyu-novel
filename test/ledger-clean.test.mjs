import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { parseFlatYamlArray, checkProject } from '../lib/novel-parse.mjs'
import {
  KEEP_MAX,
  applyLedgerClean,
  cutText,
  parseRef,
  planLedgerClean,
  undoLedgerClean,
} from '../lib/ledger-clean.mjs'

// ── 清账本（0.16.0）────────────────────────────────────────────────────────
// 现场：check 每次全量重扫，账本条目只增不减，面板体检黄条永远挂着同一批
// warn（4 条超长 + 1 条伏笔超期）。这里守三件事：
//   ① 点一下就真的清掉警告，且 check 复查不再报；
//   ② 信息不丢——原文整段进 archive/ledger-details/，条目里留指路；
//   ③ 能撤销——账本字节级还原、明细文件一并删掉。
// 另外守两条纪律：不新增字段（format-core 键白名单是死的）、不猜（没有
// 【推进章】标记的超期伏笔留人工）。

const LONG_SENTENCE = '女主线（盟友+暧昧双线）——她是最难骗的人：递刀的内线、谣言质检员、唯一能戳穿他底细的人；假戏真做是微擦边调味主出口，尺度按 style.md 红线。'
const LONG_TAIL = '情感线克制升温：ch17胃药便签→ch26债权人小本子→ch27隔空记账→ch28回归当日现结落地→ch30情人谣不澄清不承认→ch31分工合拢功劳互推→ch32共谋升级她红笔亲手改三处措辞并主动递手机交底。逐章细节见角色卡。'
// 阈值是 >=300，且 cutText 最多保留 160 字——这里刻意造 414 字（远超阈值，
// 保证「压完 <300」是被压缩的，不是本来就短）。
const LONG_DESC = LONG_SENTENCE + LONG_TAIL.repeat(3)

function frontmatter(num) {
  return ['---', 'title: 第' + num + '章', 'volume: v01', 'num: ' + num, 'status: accepted', '---', '', '正文。'].join('\n') + '\n'
}

function makeBook() {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-clean-'))
  mkdirSync(path.join(dir, 'chapters'), { recursive: true })
  for (let i = 1; i <= 33; i += 1) writeFileSync(path.join(dir, 'chapters', 'v01-c' + String(i).padStart(3, '0') + '.md'), frontmatter(i), 'utf8')
  writeFileSync(
    path.join(dir, 'relations.yml'),
    [
      '- a: chen-lei',
      '  b: song-jiajia',
      '  type: 暧昧',
      '  description: ' + LONG_DESC,
      '  intensity: 5',
      '  started: v01-c001',
      '  ended: ""',
      '- a: chen-lei',
      '  b: hu-yiming',
      '  type: 同盟',
      '  description: 发小，执行与气氛组。',
      '  intensity: 3',
      '  started: v01-c001',
      '  ended: ""',
      '',
    ].join('\n'),
    'utf8',
  )
  writeFileSync(
    path.join(dir, 'foreshadows.yml'),
    [
      '- id: fs-004',
      '  title: 造信组织痕迹',
      '  status: planted',
      '  priority: high',
      '  source: backfill',
      '  planted_chapter: v01-c001',
      '  expected_resolve: v01-c048',
      '  resolved_chapter: ""',
      '  notes: ' + '埋设点位：①面板乱码提示；②第二卷末被老主顾保释接走；③第五卷档案库手稿。'.repeat(8) + '【推进章】v01-c008。',
      '- id: fs-009',
      '  title: 忘了推进的伏笔',
      '  status: planted',
      '  priority: normal',
      '  source: plan',
      '  planted_chapter: v01-c001',
      '  expected_resolve: v01-c050',
      '  resolved_chapter: ""',
      '  notes: 点位未登记，应留人工确认。',
      '',
    ].join('\n'),
    'utf8',
  )
  return dir
}

const readFile = (dir, name) => readFileSync(path.join(dir, name), 'utf8')

test('cutText：切在真句末、不超过上限、不改写', () => {
  const cut = cutText(LONG_DESC)
  assert.ok(cut.length <= KEEP_MAX, '结论句不能超过 ' + KEEP_MAX + ' 字，实得 ' + cut.length)
  assert.ok(LONG_DESC.startsWith(cut), '结论句必须是原文前缀（不改写）')
  assert.match(cut, /[。！？…]$/, '结论句应切在真句末')
  // 分号是枚举分隔，不是句末：有句号时要切句号，不能切在「；」上留半句
  const enumeration = '她先扛下第一刀；再扛第二刀；第三刀留到最后。' + '补充'.repeat(200)
  const picked = cutText(enumeration)
  assert.match(picked, /。$/, '有句号时必须切句号')
  // 整段没有句号：硬切 + 省略号，明确标示被截
  const runon = '一'.repeat(400)
  assert.match(cutText(runon), /……$/, '没有句末标点时应硬切并加省略号')
})

test('parseRef：v01-c003 / c3 / 3 都能认，杂串返回 null', () => {
  assert.deepEqual(parseRef('v01-c003'), { vol: 1, num: 3 })
  assert.deepEqual(parseRef('c3'), { vol: 0, num: 3 })
  assert.deepEqual(parseRef('3'), { vol: 0, num: 3 })
  assert.equal(parseRef('第三卷末'), null)
  assert.equal(parseRef(''), null)
})

test('dry-run 不写盘：文件字节不变', () => {
  const dir = makeBook()
  const before = readFile(dir, 'relations.yml')
  const plan = planLedgerClean(dir)
  assert.equal(plan.trimmedTotal, 2, 'relations 1 条 + foreshadows 1 条超长')
  assert.equal(plan.advancedTotal, 1, '只有带【推进章】的 fs-004 升级')
  assert.equal(readFile(dir, 'relations.yml'), before, 'dry-run 不得改文件')
  assert.equal(existsSync(path.join(dir, 'archive')), false, 'dry-run 不得建 archive')
})

test('apply：超长条目压成结论、明细外置、原文不丢、不改字段集合', () => {
  const dir = makeBook()
  const beforeRelations = parseFlatYamlArray(readFile(dir, 'relations.yml'))
  const out = applyLedgerClean(dir)
  assert.equal(out.changed, true)
  assert.equal(out.trimmedTotal, 2)
  assert.equal(out.advancedTotal, 1)
  assert.ok(out.charsRemoved > 0)

  const afterRelations = parseFlatYamlArray(readFile(dir, 'relations.yml'))
  assert.equal(afterRelations.length, beforeRelations.length, '条目数不变')
  assert.deepEqual(Object.keys(afterRelations[0]), Object.keys(beforeRelations[0]), '不得新增/删除字段（键白名单）')
  const desc = afterRelations[0].description
  assert.ok(desc.length < 300, '压完必须低于 300 字，实得 ' + desc.length)
  assert.match(desc, /明细见 archive\/ledger-details\/relations\//, '条目里要留明细指路')
  assert.equal(afterRelations[1].description, '发小，执行与气氛组。', '短条目不碰')

  // 明细文件：原文整段一字不改
  const detailRel = String(desc).match(/明细见 ([^）]+)/)[1]
  const detailAbs = path.join(dir, detailRel)
  assert.ok(existsSync(detailAbs), '明细文件应存在：' + detailRel)
  const detailText = readFileSync(detailAbs, 'utf8')
  assert.ok(detailText.includes(LONG_DESC), '明细里要有全文')
  assert.ok(detailText.includes('原文一字未改'))

  // 伏笔：带【推进章】的升级，没标记的留人工
  const fs = parseFlatYamlArray(readFile(dir, 'foreshadows.yml'))
  assert.equal(fs[0].status, 'progressing')
  assert.ok(fs[0].notes.length < 300)
  assert.equal(fs[1].status, 'planted', '无【推进章】标记的超期伏笔不得自动升级')
  // 反例：叙述里出现「推进章」三个字不算标记（曾把 fs-009 误判成已推进）
  const misleading = makeBook()
  writeFileSync(path.join(misleading, 'foreshadows.yml'), readFile(misleading, 'foreshadows.yml').replace('点位未登记，应留人工确认。', '点位还没写推进章，待定。'), 'utf8')
  assert.equal(planLedgerClean(misleading).advancedTotal, 1, '「还没写推进章」不得被当成推进证据')
  assert.equal(fs[1].notes, '点位未登记，应留人工确认。', '留人工的条目不碰')
})

test('清完之后 check 不再报「超过 300 字」，带标记的超期伏笔也不再报', () => {
  const dir = makeBook()
  applyLedgerClean(dir)
  const messages = checkProject(dir).problems.map((p) => p.message).join('\n')
  assert.ok(!messages.includes('超过 300 字'), '超长警告应消失：\n' + messages)
  assert.ok(!messages.includes('伏笔 fs-004 埋设于'), 'fs-004 已升推进，不该再报超期：\n' + messages)
  // fs-009 没有【推进章】标记 → 故意留人工，警告该留着（宁留警不静默掩盖）
  assert.ok(messages.includes('伏笔 fs-009 埋设于'), '没标记的超期伏笔必须继续报')
})

test('幂等：第二次 apply 不动文件', () => {
  const dir = makeBook()
  applyLedgerClean(dir)
  const snapshot = ['relations.yml', 'foreshadows.yml'].map((name) => readFile(dir, name))
  const again = applyLedgerClean(dir)
  assert.equal(again.changed, false)
  assert.equal(again.trimmedTotal, 0)
  assert.equal(again.advancedTotal, 0)
  assert.deepEqual(['relations.yml', 'foreshadows.yml'].map((name) => readFile(dir, name)), snapshot)
})

test('undo：字节级还原账本、删掉明细、备份目录清理', () => {
  const dir = makeBook()
  const before = { r: readFile(dir, 'relations.yml'), f: readFile(dir, 'foreshadows.yml') }
  const applied = applyLedgerClean(dir)
  const detailRel = String(parseFlatYamlArray(readFile(dir, 'relations.yml'))[0].description).match(/明细见 ([^）]+)/)[1]
  assert.ok(existsSync(path.join(dir, detailRel)))

  const undone = undoLedgerClean(dir)
  assert.deepEqual(undone.restored.sort(), ['foreshadows.yml', 'relations.yml'])
  assert.equal(readFile(dir, 'relations.yml'), before.r, '账本应字节级还原')
  assert.equal(readFile(dir, 'foreshadows.yml'), before.f)
  assert.equal(existsSync(path.join(dir, detailRel)), false, '明细文件应删除')
  assert.equal(existsSync(path.join(dir, applied.backupDir)), false, '备份目录应清理')
})

function makeBigBook() {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-clean-big-'))
  mkdirSync(path.join(dir, 'chapters'), { recursive: true })
  for (let i = 1; i <= 30; i += 1) writeFileSync(path.join(dir, 'chapters', 'v01-c' + String(i).padStart(3, '0') + '.md'), frontmatter(i), 'utf8')
  const entries = []
  for (let i = 1; i <= 30; i += 1) {
    const ch = 'v01-c' + String(i).padStart(3, '0')
    entries.push('- kind: 剧情' + String.fromCharCode(10) + '  source_chapter: ' + ch + String.fromCharCode(10) + '  content: 第' + i + '章剧情记忆：读者知道这条谣的来源与代价，系统只结算不解释。')
  }
  writeFileSync(path.join(dir, 'memories.yml'), entries.join(String.fromCharCode(10)) + String.fromCharCode(10), 'utf8')
  return dir
}

test('大账本按章归档：旧章进 archive/，主账只留最近 keep 章，归档文件可回读', () => {
  const dir = makeBigBook()
  const plan = planLedgerClean(dir, { minBytes: 300, keepChapters: 5 })
  assert.equal(plan.archivedTotal, 25, '1..25 章应归档')
  assert.equal(plan.dryRun, true)
  const out = applyLedgerClean(dir, { minBytes: 300, keepChapters: 5 })
  assert.equal(out.changed, true)
  assert.equal(out.archivedTotal, 25)
  const main = parseFlatYamlArray(readFile(dir, 'memories.yml'))
  assert.equal(main.length, 5, '主账只留最近 5 章')
  assert.ok(main.every((entry) => Number(String(entry.source_chapter).slice(-3)) >= 26), '留下的必须是最新 5 章')
  const archived = parseFlatYamlArray(readFile(dir, 'archive/memories-before-v01-c025.yml'))
  assert.equal(archived.length, 25, '归档文件要能整本解析回来')
})

test('账本会搬空时宁可不归档（安全阀）', () => {
  const dir = makeBigBook()
  const out = applyLedgerClean(dir, { minBytes: 300, keepChapters: 0 })
  assert.equal(out.archivedTotal, 0, 'keep=0 会搬空主账，必须放弃')
  assert.equal(parseFlatYamlArray(readFile(dir, 'memories.yml')).length, 30, '主账原样保留')
})

test('索引条数不一致：清账本重建 index.yml，撤销能还原', () => {
  const dir = makeBigBook()
  writeFileSync(path.join(dir, 'index.yml'), 'volumes:' + String.fromCharCode(10) + '  - id: v01' + String.fromCharCode(10) + '    chapters: []' + String.fromCharCode(10), 'utf8')
  const plan = planLedgerClean(dir)
  assert.equal(plan.indexStale, true)
  const out = applyLedgerClean(dir)
  assert.equal(out.indexRebuilt, true)
  const text = readFileSync(path.join(dir, 'index.yml'), 'utf8')
  assert.ok(text.includes('num: 1'), '重建后应列出章节')
  const undone = undoLedgerClean(dir)
  assert.ok(undone.restored.includes('index.yml'), '撤销要还原 index.yml')
  assert.equal(readFileSync(path.join(dir, 'index.yml'), 'utf8').includes('chapters: []'), true)
})
test('三处接线都在：面板按钮 / 服务端路由 / CLI 子命令', () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
  const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
  const client = read('lib/client.js')
  assert.ok(client.includes('apiPost("ledger-clean"'), '面板要调 ledger-clean')
  assert.ok(client.includes('h(CheckStrip, { problems: checkProblems'), '体检黄条要以组件渲染（才有 busy 状态）')
  for (const key of ['check.clean', 'check.cleaning', 'check.cleanTip', 'toast.ledgerCleaned']) {
    // 只数字典定义（"key":），tt("key") 的调用点不算
    assert.equal(client.split('"' + key + '":').length - 1, 2, key + ' 中英两份字典都要有')
  }
  const server = read('index.mjs')
  assert.ok(server.includes("route === 'ledger-clean'"), '服务端要有 ledger-clean 路由')
  assert.ok(server.includes('applyLedgerClean(novelDir)'), '路由要调 applyLedgerClean')
  const bin = read('bin/xiaoyu-novel.mjs')
  assert.ok(bin.includes("command === 'clean'"), 'CLI 要有 clean 子命令')
  assert.ok(bin.includes('--undo'), 'CLI 要支持撤销')
})

test('没有备份时 undo 报错而不是静默成功', () => {
  const dir = makeBook()
  assert.throws(() => undoLedgerClean(dir), /没有可撤销/)
})
