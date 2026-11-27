import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const index = readFileSync(path.join(root, 'index.mjs'), 'utf8')

// ── 3.33.0 发布读正文：readChapter 带 .md；标题幂等；错误不吞 ─────────

test('readChapter 传带 .md 的完整文件名', () => {
  assert.ok(index.includes('const fileName ='), '要构造 fileName')
  assert.ok(index.includes("nameOnly + '.md'"), '缺后缀要补 .md')
  assert.ok(index.includes('ch = readChapter(novelDir, fileName)'), '必须传 fileName')
})

test('读取失败带真实原因', () => {
  assert.ok(index.includes("let readErr = ''"), '要留错误原因')
  assert.ok(index.includes('正文读取失败'), '保留中文提示')
  assert.ok(index.includes("readErr ? '：' + readErr : ''"), '失败原因要拼进去')
})

test('标题幂等：已有「第N章」不重复拼', () => {
  assert.ok(index.includes('const hasNo ='), '要有 hasNo 判重')
  assert.ok(index.includes('const title = hasNo ? pureTitle'), '命中就不拼')
})

test('章号自动拼接仍在', () => {
  assert.ok(index.includes("'章 ' + pureTitle"), '仍要拼「第N章」')
})
