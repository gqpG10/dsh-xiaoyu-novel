import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { buildTarGz, buildZip, collectFiles } from '../scripts/pack.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('collectFiles：发行必需项一个不漏', () => {
  const files = collectFiles()
  const must = [
    'package.json',
    'index.mjs',
    'cordis.patch.yml',
    'icon.svg',
    'LICENSE',
    'README.md',
    'README.en.md',
    'INSTALL.md',
    'bin/xiaoyu-novel.mjs',
    'lib/client.js',
    'lib/base.css',
    'lib/panel-core.mjs',
    'lib/portable.mjs',
    'lib/doctor.mjs',
    'presets/xiaoyu-novel/preset.yml',
    'presets/xiaoyu-novel/agent.cordis.yml',
    'presets/xiaoyu-novel/agent.cordis.v2.yml',
    'presets/xiaoyu-novel/restrict.mjs',
    'presets/xiaoyu-novel/guard.mjs',
    'presets/xiaoyu-novel/delegation-labels.mjs',
    'templates/novel/project.yml',
    'templates/novel/style.md',
    'templates/novel/style-presets/plain.md',
    'skills/xiaoyu-qu-ai-wei/SKILL.md',
    'skills/xiaoyu-qu-ai-wei/scripts/aiwei_scan.py',
    'docs/spec.md',
    'scripts/pack.mjs',
    '.github/workflows/ci.yml',
  ]
  for (const file of must) assert.ok(files.includes(file), '发行包缺少 ' + file)
})

test('collectFiles：八个方法论技能全在', () => {
  const files = collectFiles()
  for (const name of ['golden-opening', 'beat-pacing', 'review-checklist', 'foreshadow-discipline', 'suspense-craft', 'volume-craft', 'qu-ai-wei', 'book-setup']) {
    assert.ok(files.includes('skills/xiaoyu-' + name + '/SKILL.md'), '缺技能 ' + name)
  }
})

test('collectFiles：不进包的垃圾一律排除', () => {
  const files = collectFiles()
  assert.equal(files.some((file) => file.includes('node_modules')), false)
  assert.equal(files.some((file) => file.includes('.git/')), false)
  assert.equal(files.some((file) => file.endsWith('.bak')), false, '.bak 是本机残留')
  assert.equal(files.some((file) => file.includes('__pycache__')), false)
  assert.equal(files.some((file) => file.startsWith('dist/')), false)
})

test('发行包不含任何作者书稿数据', () => {
  // 关键词由码点拼出来，免得本测试文件自己就成了「泄漏样本」
  const 词1 = [36896, 35875, 25105].map((code) => String.fromCharCode(code)).join('')
  const 词2 = [29575, 32654, 22909].map((code) => String.fromCharCode(code)).join('')
  const 本机路径 = ['/root', 'plugins', 'dsh-xiaoyu-novel'].join('/')
  const files = collectFiles()
  for (const file of files) {
    if (!/\.(mjs|js|yml|json|md|css)$/.test(file)) continue
    // README / docs / test 里的示例名与关键词是刻意保留的说明与断言数据
    if (file.startsWith('README') || file.startsWith('docs/') || file.startsWith('test/')) continue
    const text = readFileSync(path.join(ROOT, file), 'utf8')
    assert.equal(text.includes(词1), false, file + ' 混进了作者书稿痕迹')
    assert.equal(text.includes(词2), false, file + ' 混进了作者书稿痕迹')
    assert.equal(text.includes(本机路径), false, file + ' 硬编码了作者本机路径')
  }
})

test('buildZip：结构与 CRC 自洽（python zipfile 可解）', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const entries = [{ name: pkg.name + '/a.txt', data: Buffer.from('hello') }]
  const zip = buildZip(entries)
  assert.equal(zip.readUInt32LE(0), 0x04034b50, '本地文件头签名')
  assert.ok(zip.includes(Buffer.from('PK\u0001\u0002', 'binary')), '中央目录签名')
  assert.ok(zip.subarray(zip.length - 22).readUInt32LE(0) === 0x06054b50, 'EOCD 签名在尾部')
  assert.ok(statSync(path.join(ROOT, 'package.json')).size > 0)
})

test('buildTarGz：gzip 魔数正确，可解', () => {
  const tar = buildTarGz([{ name: 'x/y.txt', data: Buffer.from('hi'), mtime: Date.now() }])
  assert.equal(tar[0], 0x1f)
  assert.equal(tar[1], 0x8b)
})

test('dist 里的包如果存在，大小应与非空', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const zipPath = path.join(ROOT, 'dist', pkg.name + '-' + pkg.version + '.zip')
  if (!existsSync(zipPath)) return
  assert.ok(statSync(zipPath).size > 100000, '发行包不该这么小')
})
