import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { archivePlan, archiveApply, splitEntries, volumeOf } from '../lib/slim-core.mjs'
import { checkProject } from '../lib/novel-parse.mjs'
import { auditProject } from '../lib/audit-core.mjs'
import { appendOutlineNote } from '../lib/panel-core.mjs'

// ── 0.11.0 流程与账本 ──────────────────────────────────────────────────────
// ① 连载模式：phase=export 且未标 serial 要提醒；
// ② 按卷归档：默认 dry-run、整块搬运、写前 .bak、主账仍可解析；
// ③ 死卡：retired 不算 0 出场，有计划登场的单独说明；
// ④ 章纲待补：一键把「点名未落地」记进章纲 ## 待补。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const CHAPTER = (n, status = 'accepted') => '---\nvolume: v01\nnum: ' + n + '\ntitle: 第' + n + '章\nstatus: ' + status + '\nsummary: 梗概' + n + '\n---\n\n陈磊站着。门开了。\n'

function makeBook(projectExtra = '') {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-011-'))
  const novel = path.join(dir, 'novel')
  for (const sub of ['chapters', 'characters', 'outlines']) mkdirSync(path.join(novel, sub), { recursive: true })
  writeFileSync(path.join(novel, 'project.yml'), 'title: 测试书\nphase: export\n' + projectExtra, 'utf8')
  writeFileSync(path.join(novel, 'chapters', 'v01-c001.md'), CHAPTER(1), 'utf8')
  writeFileSync(path.join(novel, 'chapters', 'v01-c002.md'), CHAPTER(2), 'utf8')
  writeFileSync(path.join(novel, 'characters', 'chen-lei.md'), '---\nname: 陈磊\nrole: protagonist\n---\n\n备注。\n', 'utf8')
  writeFileSync(path.join(novel, 'characters', 'old-man.md'), '---\nname: 老陈\nrole: minor\nstatus: retired\n---\n\n备注。\n', 'utf8')
  writeFileSync(path.join(novel, 'characters', 'future.md'), '---\nname: 未来人\nrole: supporting\ndebut_chapter: v01-c030\n---\n\n备注。\n', 'utf8')
  writeFileSync(path.join(novel, 'outlines', 'v01-c001.md'), '# 第一章 章纲\n\n- 本章目标：出事\n\n## 钩子\n- 反转\n', 'utf8')
  writeFileSync(path.join(novel, 'memories.yml'), [
    '# 记忆账本',
    '- content: 卷一的事',
    '  category: appearance',
    '  source_chapter: v01-c001',
    '- content: 卷二的事',
    '  category: appearance',
    '  source_chapter: v02-c001',
  ].join('\n') + '\n', 'utf8')
  return { dir, novel }
}

test('连载提醒：phase=export 且未标 serial 时 check 提醒', () => {
  const { dir, novel } = makeBook()
  try {
    const problems = checkProject(novel).problems
    assert.ok(problems.some((p) => p.file === 'project.yml' && /serial/.test(p.message)), '缺连载提醒')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('连载提醒：标了 serial: true 就不再提醒', () => {
  const { dir, novel } = makeBook('serial: true\n')
  try {
    const problems = checkProject(novel).problems
    assert.ok(!problems.some((p) => /serial/.test(p.message)), '标了 serial 还提醒')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('归档：整块按卷搬运，主账留注释头与后卷条目，写前 .bak', () => {
  const { dir, novel } = makeBook()
  try {
    assert.equal(volumeOf('v02'), 2)
    assert.equal(volumeOf('2'), 2)
    assert.equal(volumeOf('乱写'), null)
    const { header, blocks } = splitEntries(readFileSync(path.join(novel, 'memories.yml'), 'utf8'))
    assert.ok(header.some((l) => l.includes('记忆账本')))
    assert.equal(blocks.length, 2)
    const plan = archivePlan(novel, 'v02')
    const mem = plan.plan.find((p) => p.file === 'memories.yml')
    assert.equal(mem.move, 1)
    assert.equal(mem.keep, 1)
    assert.equal(readFileSync(path.join(novel, 'memories.yml'), 'utf8').includes('v02-c001'), true, 'dry-run 不得改文件')
    const done = archiveApply(novel, 'v02')
    assert.equal(done.moved, 1)
    const main = readFileSync(path.join(novel, 'memories.yml'), 'utf8')
    assert.ok(main.includes('v02-c001'), '后卷条目必须留在主账')
    assert.ok(!main.includes('v01-c001'), '旧卷条目应已搬走')
    assert.ok(main.includes('记忆账本'), '注释头要保留')
    assert.ok(existsSync(path.join(novel, 'memories.yml.bak')), '缺 .bak 备份')
    assert.ok(existsSync(path.join(novel, 'archive', 'memories-before-v02.yml')), '缺归档文件')
    assert.ok(readFileSync(path.join(novel, 'archive', 'memories-before-v02.yml'), 'utf8').includes('v01-c001'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('归档安全阀：会把主账搬空时标记 blocked，apply 不动文件', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-blk-'))
  const novel = path.join(dir, 'novel')
  mkdirSync(novel, { recursive: true })
  writeFileSync(path.join(novel, 'memories.yml'), '- content: 只有卷一\n  source_chapter: v01-c001\n', 'utf8')
  try {
    const plan = archivePlan(novel, 'v02')
    assert.equal(plan.plan[0].blocked, true)
    const finished = archiveApply(novel, 'v02')
    assert.equal(finished.moved, 0)
    assert.ok(readFileSync(path.join(novel, 'memories.yml'), 'utf8').includes('v01-c001'), 'blocked 时不得搬走')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
test('死卡：retired 不算 0 出场，有计划登场的单独说明', () => {
  const { dir, novel } = makeBook()
  try {
    const audit = auditProject(novel)
    const byName = Object.fromEntries(audit.characters.map((c) => [c.name, c]))
    assert.equal(byName['陈磊'].missing, false)
    assert.equal(byName['老陈'].missing, false, 'retired 不该算 0 出场')
    assert.equal(byName['老陈'].status, 'retired')
    assert.equal(byName['未来人'].missing, true)
    assert.equal(byName['未来人'].planned, true)
    assert.equal(byName['未来人'].debut, 'v01-c030')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('章纲待补：追加 ## 待补 小节，原有节拍与钩子不动', () => {
  const { dir, novel } = makeBook()
  try {
    const res = appendOutlineNote(novel, 'v01-c001', '章纲点名 老陈，本章正文未落地')
    assert.equal(res.ok, true)
    const text = readFileSync(path.join(novel, 'outlines', 'v01-c001.md'), 'utf8')
    assert.match(text, /## 待补/)
    assert.match(text, /- \[待补\] 章纲点名 老陈/)
    assert.match(text, /本章目标：出事/)
    assert.match(text, /## 钩子/)
    // 再记一条：追加在同一小节里，不新建第二个 ## 待补
    appendOutlineNote(novel, 'v01-c001', '第二条')
    const again = readFileSync(path.join(novel, 'outlines', 'v01-c001.md'), 'utf8')
    assert.equal(again.split('## 待补').length - 1, 1)
    assert.match(again, /- \[待补\] 第二条/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('模板与前端：serial/播报变体/登场计划/返修队列都接上了', () => {
  const project = read('templates/novel/project.yml')
  assert.match(project, /serial:/)
  const style = read('templates/novel/style.md')
  assert.match(style, /## 播报变体/)
  const js = read('lib/client.js')
  for (const needle of ['hookQueue.title', 'audit.fixOutline', 'audit.noteOutline', 'outline-note', 'char.field.debut']) {
    assert.ok(js.includes(needle), '缺接线：' + needle)
  }
  const chars = read('lib/format-core.mjs')
  assert.match(chars, /debut_chapter/)
  assert.match(chars, /'status'/)
})
