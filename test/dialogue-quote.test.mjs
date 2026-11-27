import test from 'node:test'
import assert from 'node:assert/strict'
import { scanDialogueQuotes, looksLikeDialogue, gateDialogueQuotes, summarizeDialogueQuotes } from '../lib/dialogue-quote.mjs'

// ── 3.40.0 强制规则：人物对话只能用双引号 ───────────────────────

test('直角引号包住的台词判违规', () => {
  const r = scanDialogueQuotes('他说：「我明天就走，你别拦我。」')
  assert.equal(r.ok, false)
  assert.equal(r.count, 1)
  assert.equal(r.violations[0].kind, 'corner')
  assert.match(r.violations[0].inner, /明天/)
})

test('中文弯双引号与英文直双引号合法', () => {
  assert.equal(scanDialogueQuotes('他说：“我明天就走。”').count, 0)
  assert.equal(scanDialogueQuotes('他说："我明天就走。"').count, 0)
})

test('术语、书名不误判', () => {
  assert.equal(scanDialogueQuotes('这个叫「量子纠缠」的概念，出自《时间简史》。').count, 0)
  assert.equal(scanDialogueQuotes('书名是《三体》。').count, 0)
})

test('英文撇号不误判（don\'t / \'90s）', () => {
  assert.equal(scanDialogueQuotes("don't worry, '90s 那年的事。").count, 0)
})

test('多行多处违规都要抓，且带行号', () => {
  const text = '第一行没事。\n他喊：「快跑，着火了！」\n第二句：“这是合法的。”\n她又说：「等等我。」'
  const r = scanDialogueQuotes(text)
  assert.equal(r.count, 2)
  assert.equal(r.violations[0].line, 2)
  assert.equal(r.violations[1].line, 4)
})

test('looksLikeDialogue：短术语不算、成句算', () => {
  assert.equal(looksLikeDialogue('量子', ''), false)
  assert.equal(looksLikeDialogue('我明天就走，你别拦我', ''), true)
})

test('gateDialogueQuotes：block 拒发、warn 放行带警告', () => {
  const bad = scanDialogueQuotes('他说：「走。」')
  assert.equal(gateDialogueQuotes(bad, 'block').pass, false)
  assert.ok(gateDialogueQuotes(bad, 'block').reason.includes('双引号'))
  const w = gateDialogueQuotes(bad, 'warn')
  assert.equal(w.pass, true)
  assert.ok(w.warning)
  assert.equal(gateDialogueQuotes(scanDialogueQuotes('他说：“走。”'), 'block').pass, true)
})

test('摘要文案可读', () => {
  assert.match(summarizeDialogueQuotes(scanDialogueQuotes('没事')), /合规/)
  assert.match(summarizeDialogueQuotes(scanDialogueQuotes('他说：「走，快点！」')), /1 处/)
})
