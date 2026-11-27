import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const index = readFileSync(path.join(root, 'index.mjs'), 'utf8')

// ── 3.32.0 番茄发布：正文取 readChapter / 章号拼接 / 章序排序 / 发前自检 ──

test('发布取正文：复用 readChapter（和阅读页同一解析器）', () => {
  assert.ok(index.includes('readChapter(novelDir, fileName)') || index.includes('ch = readChapter(novelDir, stem)'), '必须用 readChapter')
  assert.ok(index.includes('const fm = ch.frontmatter || {}'))
  assert.ok(index.includes("String(ch.body || '').trim()"))
})

test('章号拼接：标题带「第N章」，num 缺失从文件名解析', () => {
  assert.ok(index.includes('let no = Number(fm.num)'))
  assert.ok(index.includes("-c(\\d+)$"))
  assert.ok(index.includes("'第' + no + '章 ' + pureTitle"))
})

test('章序排序：勾选顺序不影响发布顺序', () => {
  assert.ok(index.includes('const sorted = list.slice().sort('))
  assert.ok(index.includes('for (const item of sorted)'))
})

test('发前自检：正文首行是 frontmatter 字段则拒发', () => {
  assert.ok(index.includes('正文头部未剥离'))
  assert.ok(index.includes('cognitive_frame'))
})
