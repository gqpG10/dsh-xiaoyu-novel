import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chapterCast } from '../lib/cast-core.mjs'

// ── 0.15.3：本章出场名单（关系图按章过滤）────────────────────────────────
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

function makeBook() {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-cast-'))
  const novel = path.join(dir, 'novel')
  mkdirSync(path.join(novel, 'chapters'), { recursive: true })
  mkdirSync(path.join(novel, 'characters'), { recursive: true })
  writeFileSync(path.join(novel, 'project.yml'), 'title: 测试书\nphase: writing\n', 'utf8')
  writeFileSync(path.join(novel, 'characters', 'chen-lei.md'), '---\nname: 陈磊\nrole: protagonist\n---\n\n备注。\n', 'utf8')
  writeFileSync(path.join(novel, 'characters', 'song-jiajia.md'), '---\nname: 宋佳佳\nrole: supporting\n---\n\n备注。\n', 'utf8')
  writeFileSync(path.join(novel, 'characters', 'shen-wanxiang.md'), '---\nname: 沈万象\nrole: antagonist\n---\n\n备注。\n', 'utf8')
  // 沈万象只出现在 summary（frontmatter）里，正文没露面——不该算本章出场
  writeFileSync(path.join(novel, 'chapters', 'v01-c001.md'),
    '---\nvolume: v01\nnum: 1\ntitle: 第一章\nstatus: accepted\nsummary: 沈万象在暗处盯着\n---\n\n陈磊进店，宋佳佳递来一张纸。\n', 'utf8')
  return novel
}

test('本章出场：只认正文命中，frontmatter 里的名字不算', () => {
  const novel = makeBook()
  const cast = chapterCast(novel, 'v01-c001.md')
  assert.equal(cast.ok, true)
  assert.deepEqual(cast.names.sort(), ['宋佳佳', '陈磊'].sort())
  assert.equal(cast.total, 3, 'total 是角色卡总数，供面板说明过滤范围')
  rmSync(path.dirname(novel), { recursive: true, force: true })
})

test('本章出场：同一章二次调用走缓存（不重读正文）', () => {
  const novel = makeBook()
  chapterCast(novel, 'v01-c001.md')
  const file = path.join(novel, 'chapters', 'v01-c001.md')
  writeFileSync(file, readFileSync(file, 'utf8').replace('宋佳佳递来一张纸', '宋佳佳递来一张纸，沈万象站在门口'), 'utf8')
  // mtime 变了 → 缓存失效，新出场的人要能被认出来
  const cast = chapterCast(novel, 'v01-c001.md')
  assert.deepEqual(cast.names.sort(), ['宋佳佳', '陈磊', '沈万象'].sort())
  rmSync(path.dirname(novel), { recursive: true, force: true })
})

test('本章出场：章节不存在 404，文件名带路径 400', () => {
  const novel = makeBook()
  assert.throws(() => chapterCast(novel, 'v01-c999.md'), (err) => err.status === 404)
  assert.throws(() => chapterCast(novel, '../secret.md'), (err) => err.status === 400)
  rmSync(path.dirname(novel), { recursive: true, force: true })
})

test('关系图接线：选中章节拉 chapter-cast 并过滤节点，拉不到退化为全量', () => {
  const client = read('lib/client.js')
  assert.ok(client.includes('apiGet("chapter-cast"'), '前端没拉出场名单')
  assert.ok(/setCast\(d && d\.ok && Array\.isArray\(d\.names\) && d\.names\.length \? d\.names : null\)/.test(client), '名单为空时没有退化为不过滤')
  assert.ok(/\(cast \|\| \[\]\)|\.filter\(function \(n\) \{ return keep\[n\]; \}\)/.test(client), '图节点没按名单过滤')
  assert.ok(/cast\.length\) \{[\s\S]{0,120}names = names\.filter/.test(client), '过滤没作用在 names 上')
  assert.ok(client.includes('relations.castOn'), '缺「本章出场 N 人」提示')
})

test('路由与模块接线：chapter-cast 挂在入口', () => {
  const index = read('index.mjs')
  assert.ok(index.includes("route === 'chapter-cast'"), '缺 chapter-cast 路由')
  assert.ok(index.includes("from './lib/cast-core.mjs'"), '没引入 cast-core')
})
