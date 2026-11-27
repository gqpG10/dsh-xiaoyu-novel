import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { packProject, unpackProject, PACK_MANIFEST } from '../lib/project-pack.mjs'

function makeBook() {
  const root = mkdtempSync(path.join(tmpdir(), 'xiaoyu-pack-'))
  const novel = path.join(root, 'novel')
  mkdirSync(path.join(novel, 'chapters'), { recursive: true })
  mkdirSync(path.join(novel, 'characters'), { recursive: true })
  writeFileSync(path.join(novel, 'project.yml'), 'title: 测试之书\n', 'utf8')
  writeFileSync(path.join(novel, 'chapters', 'v01-c001.md'), '---\nnum: 1\ntitle: 第一章\n---\n正文内容在这里。\n', 'utf8')
  writeFileSync(path.join(novel, 'chapters', 'v01-c002.md'), '---\nnum: 2\ntitle: 第二章\n---\n第二章正文。\n', 'utf8')
  writeFileSync(path.join(novel, 'characters', 'hero.md'), '---\nname: 主角\n---\n# 主角\n', 'utf8')
  return { root, novel }
}

test('打包本项目：产出 tar.gz + 清单含书名与章节数', () => {
  const { root, novel } = makeBook()
  const p = packProject({ novelDir: root, scope: 'project' })
  assert.ok(p.ok, p.error)
  assert.ok(Buffer.isBuffer(p.buffer) && p.buffer.length > 0, '应该是非空 Buffer')
  assert.match(p.filename, /\.tar\.gz$/)
  assert.equal(p.manifest.scope, 'project')
  assert.equal(p.manifest.kind, 'xiaoyu-novel-pack')
  assert.equal(p.manifest.chapters, 2, '章数要统计出来')
  assert.match(p.manifest.title, /测试之书/, '书名取自 project.yml')
})

test('解包还原：文件内容一致 + 目录不覆盖已有内容', () => {
  const { root } = makeBook()
  const p = packProject({ novelDir: root, scope: 'project' })
  const target = mkdtempSync(path.join(tmpdir(), 'xiaoyu-target-'))
  const out1 = unpackProject(p.buffer, target)
  assert.ok(out1.ok, out1.error)
  assert.ok(existsSync(path.join(out1.dir, 'novel', 'chapters', 'v01-c001.md')), '章节要还原')
  assert.ok(existsSync(path.join(out1.dir, PACK_MANIFEST)), '清单也要留一份')
  const body = readFileSync(path.join(out1.dir, 'novel', 'chapters', 'v01-c001.md'), 'utf8')
  assert.match(body, /正文内容在这里/, '内容必须一字节不差')

  // 第二次解到同一目录：必须新建目录，不覆盖上一个
  const out2 = unpackProject(p.buffer, target)
  assert.ok(out2.ok)
  assert.notEqual(out2.dir, out1.dir, '同秒内也不许覆盖（必须换目录）')
  assert.ok(existsSync(path.join(out1.dir, 'novel', 'chapters', 'v01-c001.md')), '旧目录内容还在')
})

test('全部数据 scope：projects/<书名>/novel 结构', () => {
  const { root } = makeBook()
  const p = packProject({ novelDir: root, scope: 'all' })
  assert.ok(p.ok, p.error)
  assert.equal(p.manifest.scope, 'all')
  const target = mkdtempSync(path.join(tmpdir(), 'xiaoyu-all-'))
  const out = unpackProject(p.buffer, target)
  assert.ok(out.ok, out.error)
  const dirs = readFileSync(path.join(out.dir, PACK_MANIFEST), 'utf8')
  assert.match(dirs, /"scope": "all"/)
  assert.ok(existsSync(path.join(out.dir, 'projects', '测试之书', 'novel', 'chapters', 'v01-c001.md')), '全部数据按 projects/<书名>/ 摆放')
})

test('坏包不炸：随机字节返回错误而不是抛异常', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'xiaoyu-bad-'))
  const out = unpackProject(Buffer.from('not a real package at all'), target)
  assert.equal(out.ok, false)
  assert.ok(out.error)
})

test('书目录不存在时给出明确错误', () => {
  const p = packProject({ novelDir: path.join(tmpdir(), 'no-such-book-xyz'), scope: 'project' })
  assert.equal(p.ok, false)
  assert.match(p.error, /不存在/)
})
