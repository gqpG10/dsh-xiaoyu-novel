import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ── xiaoyu-novel wc 契约（0.5.0）─────────────────────────────────────────────────
// 写手交稿前自检只调这一条命令：去空白字数、感叹号拆分、引号配对、禁项、
// 长句、人味指数与硬伤。替代上一轮 25 次临时 python 脚本。
// 守住：数字口径（去空白字数与 CJK 分开）、JSON 可机读、只读不写。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bin = path.join(root, 'bin/xiaoyu-novel.mjs')
const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-wc-'))
const novel = path.join(dir, 'novel')

mkdirSync(path.join(novel, 'chapters'), { recursive: true })
writeFileSync(path.join(novel, 'project.yml'), 'title: 自检测试\nphase: writing\nmode: ai-draft\n', 'utf8')
const BODY = '门是被踹开的。\n\n“醒了！”\n\n林尘没答。他撑着床沿坐起来，掌心压在木板上，硌得慌。\n'
const CHAPTER = path.join(novel, 'chapters', 'v01-c001.md')
writeFileSync(CHAPTER, '---\nnum: 1\ntitle: 开篇\nvolume: v01\nstatus: writing\nsummary: 一句话\n---\n\n' + BODY, 'utf8')

test.after(() => rmSync(dir, { recursive: true, force: true }))

test('wc：JSON 输出口径齐全，只读不写', () => {
  const run = spawnSync(process.execPath, [bin, 'wc', novel, '1', '--json'], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  const out = JSON.parse(run.stdout)
  assert.equal(out.file, 'v01-c001.md')
  assert.equal(out.num, 1)
  assert.ok(out.words > 0, '去空白字数为 0')
  assert.ok(out.cjk > 0, 'CJK 字数为 0')
  assert.equal(out.quotes.paired, true, '引号配对判据失效')
  assert.equal(out.exclamations.total, 1, '感叹号计数不对')
  assert.equal(out.exclamations.dialog, 1, '对话内感叹号没拆出来')
  assert.equal(out.exclamations.narrative, 0, '叙述感叹号应为 0')
  assert.equal(out.banned.cornerQuotes, 0)
  assert.equal(out.banned.squareBrackets, 0)
  assert.ok(typeof out.human === 'number', '人味指数缺失')
  assert.ok(Array.isArray(out.hard), '硬伤维度缺失')
  assert.ok(readFileSync(CHAPTER, 'utf8').includes('门是被踹开的。'), 'wc 改动了章节文件')
})

test('wc：找不到章节时中文报错退出码 1', () => {
  const run = spawnSync(process.execPath, [bin, 'wc', novel, '99'], { encoding: 'utf8' })
  assert.equal(run.status, 1)
  assert.match(run.stderr, /找不到章节/)
})
