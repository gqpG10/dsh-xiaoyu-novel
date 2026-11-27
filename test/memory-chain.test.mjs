import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { summarizeRich, hookType, makeSummarizer } from '../lib/memory-summary.mjs'
import { buildChain, prevStems, afterChapterDone } from '../lib/memory-chain.mjs'
import { syncMemories, memoryHealth } from '../lib/memory-sync.mjs'

// ── 3.51.0 加强摘要 + 前情提要链 + 自动触发 ───────────────────

function makeBook(n = 3, names = ['陈砚', '苏晚']) {
  const root = mkdtempSync(path.join(tmpdir(), 'xiaoyu-31-'))
  const novel = path.join(root, 'novel')
  mkdirSync(path.join(novel, 'chapters'), { recursive: true })
  mkdirSync(path.join(novel, 'characters'), { recursive: true })
  for (const nm of names) writeFileSync(path.join(novel, 'characters', nm + '.md'), '---\nname: ' + nm + '\n---\n', 'utf8')
  for (let i = 1; i <= n; i++) {
    writeFileSync(path.join(novel, 'chapters', 'v01-c' + String(i).padStart(3, '0') + '.md'),
      '---\nnum: ' + i + '\n---\n陈砚走进办公室，把那份合同按在桌上。\n\n' +
      '“你签了没有？”苏晚问。\n\n他摇头。苏晚翻了两页，眼睛就亮了。\n\n' +
      '“你咋想的？”\n\n陈砚没答，手指在桌沿上敲了三下。这事没完？\n', 'utf8')
  }
  return novel
}

test('加强摘要：七项都出（开章/事件/人物/场景/台词/收章/强度）', () => {
  const novel = makeBook()
  const r = makeSummarizer(novel)('陈砚走进办公室，把那份合同按在桌上。\n\n“你签了没有？”苏晚问。\n\n苏晚翻了两页，眼睛就亮了。\n\n他摇头，转身走了。')
  assert.equal(r.ok, true)
  assert.match(r.summary, /^开章：/)
  assert.match(r.summary, /人物：/)
  assert.match(r.summary, /场景：/)
  assert.match(r.summary, /关键台词：「/)
  assert.match(r.summary, /收章：/)
  assert.match(r.summary, /强度：\d+\/100 · 钩子：/)
})

test('事件只从叙述句抓：对话里的动作词不算', () => {
  const novel = makeBook()
  const r = makeSummarizer(novel)('“你签了没有？签了我就认。”苏晚说。\n\n“认了又怎样？”陈砚反问。')
  // 两句都在引号里 → 没有叙述句 → 不应抓出事件
  const evLine = r.summary.split('\n').find((l) => l.startsWith('事件：'))
  assert.equal(evLine, undefined, '不该从纯台词里抓事件')
})

test('残句过滤：以冒号结尾的句子不当事件', () => {
  const novel = makeBook()
  const r = makeSummarizer(novel)('陈砚把他叫到门口，压低声音说：\n\n“你听我说。”')
  const evLine = r.summary.split('\n').find((l) => l.startsWith('事件：'))
  assert.ok(!evLine || !evLine.includes('压低声音说：'), '冒号结尾的残句必须滤掉')
})

test('hookType 四种判定（只看尾部，所以转折词要在结尾）', () => {
  assert.equal(hookType('这事到底怎么办？'), '问句')
  assert.equal(hookType('他话没说完……'), '未竟')
  assert.equal(hookType('门后还有人，可是'), '转折')
  assert.equal(hookType('他走了。'), '平收')
})

test('prevStems 取目标章前的 N 章', () => {
  const all = ['a', 'b', 'c', 'd', 'e']
  assert.deepEqual(prevStems(all, 'd', 2), ['b', 'c'])
  assert.deepEqual(prevStems(all, 'a', 3), [])
})

test('buildChain 生成三层结构并落盘', () => {
  const novel = makeBook(5)
  syncMemories(novel, { force: true })
  const r = buildChain(novel, 'v01-c005', { nearCount: 3, midCount: 10 })
  assert.equal(r.ok, true)
  assert.ok(existsSync(path.join(novel, r.rel)))
  const txt = readFileSync(path.join(novel, r.rel), 'utf8')
  assert.match(txt, /# 前情提要 · 写 v01-c005 之前必读/)
  assert.match(txt, /## 最近 3 章/)
  assert.match(txt, /### v01-c002/)
})

test('afterChapterDone：补记忆 + 建下一章链', () => {
  const novel = makeBook(4)
  const r = afterChapterDone(novel, 'v01-c002')
  assert.equal(r.ok, true)
  assert.ok(r.memory.ok)
  assert.ok(existsSync(path.join(novel, 'memory', 'v01-c002.yml')), '该章记忆要生成')
  assert.ok(existsSync(path.join(novel, 'memory', 'chain-v01-c003.yml')), '下一章前情链要生成')
  // 已有记忆时 created=false（不覆盖人工修正）
  const r2 = afterChapterDone(novel, 'v01-c002')
  assert.equal(r2.memory.created, false)
})

test('memory-sync 用加强摘要（含人物行）', () => {
  const novel = makeBook(2)
  syncMemories(novel, { force: true })
  const txt = readFileSync(path.join(novel, 'memory', 'v01-c001.yml'), 'utf8')
  // 两个人次数相同时排序可能互换，只验「都抓到」
  const castLine = txt.split('\n').find((l) => l.startsWith('人物：')) || ''
  assert.ok(castLine.includes('陈砚'), '要抓到陈砚，实际：' + castLine)
  assert.ok(castLine.includes('苏晚'), '要抓到苏晚，实际：' + castLine)
  assert.equal(memoryHealth(novel).ratioPct, 100)
})
