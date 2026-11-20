import test from 'node:test'
import assert from 'node:assert/strict'

import { checkChapterStyle } from '../lib/novel-parse.mjs'

// 句式重复判定（0.17.0）：按空行分段统计，剥掉句首收引号。那条「连续 6 句以
// 成对引号开头」的假警就是这么来的——对话段收在收引号、下一段起于起引号，
// 切句后两段前缀拼成一对引号。这里锁住三件事。

function repeatMessages(body) {
  return checkChapterStyle(body).filter((m) => m.includes('句式重复'))
}

test('段内连续同前缀 3 句仍然报（真句式重复不许漏）', () => {
  const body = '他推开门。他推椅子。他推窗子。'
  const msgs = repeatMessages(body)
  assert.equal(msgs.length, 1)
  assert.match(msgs[0], /连续 3 句以「他推」/)
})

test('跨段落对话不再拼成引号前缀（原来的假警）', () => {
  const body = [
    '“这数不对。”',
    '',
    '“月薪九千。”',
    '',
    '“一万。”',
    '',
    '“词库都没换。”',
    '',
    '“你编的。”',
  ].join(String.fromCharCode(10))
  assert.deepEqual(repeatMessages(body), [])
})

test('同样的开头分散在三段里不算重复（段界不累计）', () => {
  const body = ['价格涨了。', '', '价格跌了。', '', '价格没动。'].join(String.fromCharCode(10))
  assert.deepEqual(repeatMessages(body), [])
})

test('同一段里三次「价格」开头要报', () => {
  const msgs = repeatMessages('价格涨了。价格跌了。价格没动。')
  assert.equal(msgs.length, 1, '同段内连续同前缀仍要报')
  assert.match(msgs[0], /「价格」/)
})

test('句首收引号剥掉后，正常对话+提示语不算同式', () => {
  const body = '“先吃药。”他说。“别熬。”她说。“按时吃。”他说。'
  assert.deepEqual(repeatMessages(body), [], '”他说/”她说 剥引号后前缀不同，不该报')
})
