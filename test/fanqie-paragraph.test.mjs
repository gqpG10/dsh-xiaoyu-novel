import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const index = readFileSync(path.join(root, 'index.mjs'), 'utf8')

// ── 3.36.0 段落：番茄必须收 HTML <p>（实测 A单换行/B双换行 都黏成一段，C 才分段）──

test('每段包 <p> 标签', () => {
  assert.ok(index.includes("'<p>' + escHtml(p) + '</p>'"), '每段必须包 p')
  assert.ok(index.includes('paras.map((p) => '), '按段 map')
})

test('HTML 转义 & < >', () => {
  assert.ok(index.includes("'&amp;'") && index.includes("'&lt;'") && index.includes("'&gt;'"))
})

test('按空行切段 + CRLF 归一', () => {
  assert.ok(index.includes("replace(/\\r\\n/g, '\\n')"), 'CRLF 归一')
  assert.ok(index.includes('split(/\\n\\s*\\n/)'), '空行切段')
})

test('发布传的是 contentHtml', () => {
  assert.ok(index.includes('content: contentHtml'))
})

test('不许再退化成纯文本 join（那是 3.35 的错误方案）', () => {
  assert.ok(!index.includes("paras.join('\\n')"), '纯文本 join 会让番茄黏成一段')
})
