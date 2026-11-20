import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { deleteManagedFile, listTrashItems, restoreTrashItem, purgeTrashItem } from '../lib/panel-core.mjs'
import { listTrash } from '../lib/trash-core.mjs'

// ── 0.15.0 回收站：删不再直删 ──────────────────────────────────────────────
// 「删了就没了」在 79k 字的书上是最不可接受的一种失败；这里锁死四条：
// ① 删除进 .trash 且原位置消失；② 能恢复且内容逐字节一致；
// ③ 目标已存在时不覆盖（409）；④ 彻底删除后真的不留。

function makeNovel() {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-trash-'))
  const novel = path.join(dir, 'novel')
  mkdirSync(path.join(novel, 'characters'), { recursive: true })
  mkdirSync(path.join(novel, 'chapters'), { recursive: true })
  writeFileSync(path.join(novel, 'project.yml'), 'title: 测试书\nphase: writing\n', 'utf8')
  writeFileSync(path.join(novel, 'characters', 'a-lei.md'), '---\nname: 阿雷\nrole: protagonist\n---\n\n备注。\n', 'utf8')
  writeFileSync(path.join(novel, 'chapters', 'v01-c001.md'), '---\nnum: 1\ntitle: 第一章\nstatus: accepted\n---\n\n正文一。\n', 'utf8')
  return novel
}

test('删除受管文件：进回收站，原位置消失，元数据带原 rel', () => {
  const novel = makeNovel()
  const deleted = deleteManagedFile(novel, 'characters/a-lei.md')
  assert.equal(deleted.ok, true)
  assert.ok(deleted.trashId, '应返回回收站 id')
  assert.equal(existsSync(path.join(novel, 'characters', 'a-lei.md')), false, '原文件必须消失')
  const listed = listTrashItems(novel)
  assert.equal(listed.items.length, 1)
  assert.equal(listed.items[0].rel, 'characters/a-lei.md')
  assert.ok(listed.items[0].bytes > 0)
  rmSync(path.dirname(novel), { recursive: true, force: true })
})

test('恢复：内容逐字节回来，回收站条目清空', () => {
  const novel = makeNovel()
  const before = readFileSync(path.join(novel, 'characters', 'a-lei.md'), 'utf8')
  const { trashId } = deleteManagedFile(novel, 'characters/a-lei.md')
  const out = restoreTrashItem(novel, trashId)
  assert.equal(out.ok, true)
  assert.equal(out.rel, 'characters/a-lei.md')
  assert.equal(readFileSync(path.join(novel, 'characters', 'a-lei.md'), 'utf8'), before)
  assert.equal(listTrash(novel).items.length, 0, '恢复后条目应消失')
  rmSync(path.dirname(novel), { recursive: true, force: true })
})

test('恢复：目标已存在时 409，不覆盖现行文件', () => {
  const novel = makeNovel()
  const { trashId } = deleteManagedFile(novel, 'characters/a-lei.md')
  writeFileSync(path.join(novel, 'characters', 'a-lei.md'), '现行版本\n', 'utf8')
  assert.throws(() => restoreTrashItem(novel, trashId), (err) => err.statusCode === 409)
  assert.equal(readFileSync(path.join(novel, 'characters', 'a-lei.md'), 'utf8'), '现行版本\n', '现行文件不得被覆盖')
  rmSync(path.dirname(novel), { recursive: true, force: true })
})

test('章节删除同样进回收站并可恢复', () => {
  const novel = makeNovel()
  deleteManagedFile(novel, 'chapters/v01-c001.md')
  assert.equal(existsSync(path.join(novel, 'chapters', 'v01-c001.md')), false)
  const items = listTrashItems(novel).items
  assert.equal(items.length, 1)
  assert.equal(items[0].rel, 'chapters/v01-c001.md')
  restoreTrashItem(novel, items[0].id)
  assert.equal(existsSync(path.join(novel, 'chapters', 'v01-c001.md')), true)
  rmSync(path.dirname(novel), { recursive: true, force: true })
})

test('彻底删除：条目与文件都不留', () => {
  const novel = makeNovel()
  const { trashId } = deleteManagedFile(novel, 'characters/a-lei.md')
  purgeTrashItem(novel, trashId)
  assert.equal(listTrashItems(novel).items.length, 0)
  const trashDir = path.join(novel, '.trash')
  // .trash/ 下常驻一份 .gitignore（让回收站内容永不进版本历史），只数条目目录
  const left = existsSync(trashDir) ? readdirSync(trashDir).filter((n) => n !== '.gitignore') : []
  assert.equal(left.length, 0)
  rmSync(path.dirname(novel), { recursive: true, force: true })
})

test('白名单外的 rel 不进回收站（删除 403 且文件还在）', () => {
  const novel = makeNovel()
  writeFileSync(path.join(novel, 'secret.md'), '不应被删\n', 'utf8')
  assert.throws(() => deleteManagedFile(novel, 'secret.md'), (err) => err.statusCode === 403)
  assert.equal(existsSync(path.join(novel, 'secret.md')), true)
  rmSync(path.dirname(novel), { recursive: true, force: true })
})
