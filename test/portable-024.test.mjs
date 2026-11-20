import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { gzipSync } from 'node:zlib'

import { buildTar, collectPortable, exportPortable, importPortable, parseTar, readPortable, resolveTarget } from '../lib/portable.mjs'

function makeHome(root) {
  mkdirSync(path.join(root, 'profiles', 'web'), { recursive: true })
  mkdirSync(path.join(root, '.agent-presets', 'xiaoyu-novel'), { recursive: true })
  mkdirSync(path.join(root, 'skills', 'xiaoyu-qu-ai-wei'), { recursive: true })
  mkdirSync(path.join(root, 'storages'), { recursive: true })
  writeFileSync(path.join(root, 'cordis.patch.yml'), '- insert: []\n')
  writeFileSync(path.join(root, 'profiles', 'web', 'cordis.patch.yml'), '- id: ui-settings\n')
  writeFileSync(path.join(root, 'profiles', 'web', 'package.json'), JSON.stringify({
    dependencies: { 'dsh-ops': '0.5.4', 'local-pkg': 'link:/root/local-pkg' },
    dsh: { profile: { bundles: ['dsh-ops'] } },
  }))
  writeFileSync(path.join(root, '.agent-presets', 'xiaoyu-novel', 'preset.yml'), 'name: 小鱼创作\n')
  writeFileSync(path.join(root, 'skills', 'xiaoyu-qu-ai-wei', 'SKILL.md'), '# skill\n')
  writeFileSync(path.join(root, 'storages', 'workspace.json'), '{"tables":{}}')
  writeFileSync(path.join(root, '.credentials.yaml'), 'version: 1\n')
  // 不该被打包的东西：node_modules / sessions
  mkdirSync(path.join(root, 'profiles', 'web', 'node_modules', 'big'), { recursive: true })
  writeFileSync(path.join(root, 'profiles', 'web', 'node_modules', 'big', 'x.js'), 'no')
  mkdirSync(path.join(root, 'sessions', 's1'), { recursive: true })
  writeFileSync(path.join(root, 'sessions', 's1', 'log.zstd'), 'no')
}

function tempDir(tag) {
  const dir = path.join(tmpdir(), 'xiaoyu-portable-' + tag + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6))
  mkdirSync(dir, { recursive: true })
  return dir
}

test('ustar 打包再解析：内容与路径一字不差', () => {
  const entries = [
    { name: 'home/cordis.patch.yml', data: Buffer.from('- insert: []\n'), mtime: 1700000000000 },
    { name: 'home/a/b/c.md', data: Buffer.from('正文'), mtime: 1700000000000 },
  ]
  const tar = buildTar(entries)
  const parsed = parseTar(tar)
  assert.equal(parsed.length, 2)
  assert.deepEqual(parsed.map((row) => row.name).sort(), ['home/a/b/c.md', 'home/cordis.patch.yml'])
  const texts = Object.fromEntries(parsed.map((row) => [row.name, row.data.toString('utf8')]))
  assert.equal(texts['home/cordis.patch.yml'], '- insert: []\n')
  assert.equal(texts['home/a/b/c.md'], '正文')
})

test('超长路径拆 prefix 后仍能还原（ustar 155+100 边界）', () => {
  const longName = 'home/' + 'd'.repeat(60) + '/' + 'e'.repeat(60) + '/' + 'f'.repeat(40)
  const tar = buildTar([{ name: longName, data: Buffer.from('x'), mtime: Date.now() }])
  const parsed = parseTar(tar)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].name, longName)
})

test('collectPortable：清单齐全，且不打包 node_modules / sessions', () => {
  const home = tempDir('collect')
  makeHome(home)
  const { items, manifest } = collectPortable({ home, profile: 'web' })
  const rels = items.map((item) => item.rel)
  assert.ok(rels.includes('home/cordis.patch.yml'))
  assert.ok(rels.includes('home/profiles/web/cordis.patch.yml'))
  assert.ok(rels.includes('home/.agent-presets/xiaoyu-novel/preset.yml'))
  assert.ok(rels.includes('home/skills/xiaoyu-qu-ai-wei/SKILL.md'))
  assert.ok(rels.includes('home/storages/workspace.json'))
  assert.ok(rels.includes('home/.credentials.yaml'))
  assert.equal(rels.some((rel) => rel.includes('node_modules')), false, 'node_modules 不能进包')
  assert.equal(rels.some((rel) => rel.startsWith('home/sessions/')), false, '会话日志不能进包')
  assert.equal(manifest.kind, 'xiaoyu-dsh-portable')
  assert.equal(manifest.dependencies['dsh-ops'].spec, '0.5.4')
  assert.equal(manifest.dependencies['local-pkg'].link, true)
  assert.deepEqual(manifest.bundles, ['dsh-ops'])
  assert.ok(manifest.restoreSteps.length >= 3)
  rmSync(home, { recursive: true, force: true })
})

test('--no-secrets：渠道 key 不进包', () => {
  const home = tempDir('nosecrets')
  makeHome(home)
  const { items } = collectPortable({ home, profile: 'web', secrets: false })
  assert.equal(items.some((item) => item.rel === 'home/.credentials.yaml'), false)
  rmSync(home, { recursive: true, force: true })
})

test('export → read：往返一致，清单能读回', () => {
  const home = tempDir('export')
  makeHome(home)
  const out = path.join(tempDir('out'), 'pkg.tar.gz')
  const result = exportPortable({ home, profile: 'web', out })
  assert.ok(existsSync(result.out))
  assert.ok(result.bytes > 0)
  const { manifest, entries } = readPortable(result.out)
  assert.equal(manifest.profile, 'web')
  const names = entries.map((row) => row.name)
  assert.ok(names.includes('home/cordis.patch.yml'))
  rmSync(home, { recursive: true, force: true })
  rmSync(path.dirname(result.out), { recursive: true, force: true })
})

test('import 到空目录：文件全部落地且内容一致', () => {
  const home = tempDir('src')
  makeHome(home)
  const out = path.join(tempDir('pkg'), 'p.tar.gz')
  exportPortable({ home, profile: 'web', out })

  const target = tempDir('dst')
  const result = importPortable({ file: out, home: target })
  assert.ok(result.written.length > 0)
  assert.equal(readFileSync(path.join(target, 'cordis.patch.yml'), 'utf8'), '- insert: []\n')
  assert.equal(readFileSync(path.join(target, '.agent-presets', 'xiaoyu-novel', 'preset.yml'), 'utf8'), 'name: 小鱼创作\n')
  assert.equal(readFileSync(path.join(target, 'skills', 'xiaoyu-qu-ai-wei', 'SKILL.md'), 'utf8'), '# skill\n')
  assert.equal(result.written.every((row) => row.backup === null), true)
  rmSync(home, { recursive: true, force: true })
  rmSync(target, { recursive: true, force: true })
  rmSync(path.dirname(out), { recursive: true, force: true })
})

test('重复 import：原有文件先备份，不静默覆盖', () => {
  const home = tempDir('src2')
  makeHome(home)
  const out = path.join(tempDir('pkg2'), 'p.tar.gz')
  exportPortable({ home, profile: 'web', out })

  const target = tempDir('dst2')
  importPortable({ file: out, home: target })
  const second = importPortable({ file: out, home: target })
  assert.ok(second.written.length > 0)
  assert.ok(second.written.every((row) => typeof row.backup === 'string' && existsSync(row.backup)))
  rmSync(home, { recursive: true, force: true })
  rmSync(target, { recursive: true, force: true })
  rmSync(path.dirname(out), { recursive: true, force: true })
})

test('dry-run：只报会写哪些文件，一个字节都不落盘', () => {
  const home = tempDir('src3')
  makeHome(home)
  const out = path.join(tempDir('pkg3'), 'p.tar.gz')
  exportPortable({ home, profile: 'web', out })

  const target = tempDir('dst3')
  const result = importPortable({ file: out, home: target, dryRun: true })
  assert.ok(result.written.length > 0)
  assert.equal(existsSync(path.join(target, 'cordis.patch.yml')), false)
  rmSync(home, { recursive: true, force: true })
  rmSync(target, { recursive: true, force: true })
  rmSync(path.dirname(out), { recursive: true, force: true })
})

test('目录穿越被拒：.. 与未知根目录都报中文错', () => {
  assert.throws(() => resolveTarget('/tmp/x', 'home/../../etc/passwd'), /目录穿越/)
  assert.throws(() => resolveTarget('/tmp/x', 'other/file.yml'), /未知根目录/)
  assert.equal(resolveTarget('/tmp/x', 'home/skills/a/SKILL.md'), path.join('/tmp/x', 'skills', 'a', 'SKILL.md'))
})

test('坏包报可读错误：不存在 / 不是 gzip / 缺清单', () => {
  const dir = tempDir('bad')
  const missing = path.join(dir, 'nope.tar.gz')
  assert.throws(() => readPortable(missing), /找不到搬迁包/)

  const notGzip = path.join(dir, 'junk.tar.gz')
  writeFileSync(notGzip, 'not a gzip at all')
  assert.throws(() => readPortable(notGzip), /解压失败/)

  const noManifest = path.join(dir, 'nomanifest.tar.gz')
  const tar = buildTar([{ name: 'home/cordis.patch.yml', data: Buffer.from('x'), mtime: Date.now() }])
  writeFileSync(noManifest, gzipSync(tar))
  assert.throws(() => readPortable(noManifest), /缺少清单/)
  rmSync(dir, { recursive: true, force: true })
})
