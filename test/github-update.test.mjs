import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  PACKAGE_NAME,
  applyGithubUpdate,
  fetchLatestGithubVersion,
  parseRepoSlug,
  pickHighestTag,
  resolveGithubRepo,
  tagToVersion,
} from '../lib/github-update.mjs'

// ── 私有库更新通路（0.18.0）────────────────────────────────────────────────
// 现场：本插件是私有发行（dsh.privateRelease），从没上 npm，所以 lib/version.mjs
// 那套 registry + npmmirror 双源注定查不到东西，面板只会回一句「请手动更新」。
// 这里守三件事：
//   ① 仓库地址解析——package.json 的 git+/https/git@ 三种写法都要认（只认
//      其中一种就会出现「改了 repository 字段反而查不到」这种玄学）；
//   ② 版本源——release 优先、没发 release 退 tags 取最高，脏 tag 一律不采信；
//   ③ 安装——下载 → 校验 → 备份 → 覆盖，包名/版本对不上就绝不动现网目录。

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

test('仓库地址：git+https / https / git@ / ssh / 裸 slug 全认', () => {
  const want = 'gqpG10/dsh-xiaoyu-novel'
  for (const raw of [
    'git+https://github.com/' + want + '.git',
    'https://github.com/' + want,
    'git@github.com:' + want + '.git',
    'ssh://git@github.com/' + want + '.git',
    want,
  ]) {
    assert.equal(parseRepoSlug(raw), want, raw)
  }
  assert.equal(parseRepoSlug('not a repo'), '')
  assert.equal(parseRepoSlug(''), '')
})

test('仓库来源优先级：dsh.githubRepo → repository.url → 环境变量', () => {
  assert.equal(resolveGithubRepo({ dsh: { githubRepo: 'a/b' }, repository: { url: 'https://github.com/c/d' } }), 'a/b')
  assert.equal(resolveGithubRepo({ repository: { url: 'git+https://github.com/c/d.git' } }), 'c/d')
  assert.equal(resolveGithubRepo({}, { XIAOYU_GITHUB_REPO: 'e/f' }), 'e/f')
  assert.equal(resolveGithubRepo({}, {}), '')
  // 逃生开关：off 时连 package.json 里的仓库也不认
  assert.equal(resolveGithubRepo({ dsh: { githubRepo: 'a/b' } }, { XIAOYU_GITHUB_REPO: 'off' }), '')
})

test('本包 package.json 确实指向本仓库（否则正式包查不到更新）', () => {
  const pkg = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
  assert.equal(pkg.name, PACKAGE_NAME)
  assert.equal(resolveGithubRepo(pkg, {}), 'gqpG10/dsh-xiaoyu-novel')
})

test('tag 过滤：只认 semver，v 前缀统一，脏串不采信', () => {
  assert.equal(tagToVersion('v2.3.0'), '2.3.0')
  assert.equal(tagToVersion('2.3.0'), '2.3.0')
  assert.equal(tagToVersion('v2.3.0-rc.1'), '2.3.0-rc.1')
  assert.equal(tagToVersion('release-2024'), '')
  assert.equal(tagToVersion('v2.3.0; rm -rf /'), '')
  assert.equal(tagToVersion(''), '')
  // 数字比较不是字典序：2.10.0 必须压过 2.9.3
  assert.equal(pickHighestTag(['v2.2.0', 'v2.9.3', 'v2.10.0', 'junk']), 'v2.10.0')
  assert.equal(pickHighestTag([]), '')
})

test('版本源：拿不到仓库直接报错，不抛异常', async () => {
  const hit = await fetchLatestGithubVersion({ repo: '' })
  assert.equal(hit.ok, false)
  assert.match(hit.error, /未配置 GitHub 仓库/)
})

test('安装：包名或版本对不上就绝不动现网目录', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'xiaoyu-gh-bad-'))
  const plugin = path.join(root, 'plugin')
  mkdirSync(plugin, { recursive: true })
  writeFileSync(path.join(plugin, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, version: '1.0.0' }), 'utf8')
  writeFileSync(path.join(plugin, 'keep.txt'), 'original', 'utf8')
  // 造一个「不是本包」的源码包
  const src = path.join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(path.join(src, 'package.json'), JSON.stringify({ name: 'someone-else', version: '2.0.0' }), 'utf8')
  const tar = path.join(root, 'bad.tar.gz')
  execFileSync('tar', ['-czf', tar, '-C', src, '.'])
  const out = await applyGithubUpdate({ repo: 'a/b', tag: 'v2.0.0', pluginRoot: plugin, tarballFile: tar, backupRoot: path.join(root, 'bak') })
  assert.equal(out.ok, false)
  assert.equal(out.kind, 'bad-package')
  assert.equal(readFileSync(path.join(plugin, 'keep.txt'), 'utf8'), 'original', '现网目录不得被动过')
  assert.equal(JSON.parse(readFileSync(path.join(plugin, 'package.json'), 'utf8')).version, '1.0.0')
})

test('安装：成功路径把新树换进去、清掉旧版遗留文件、留备份', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'xiaoyu-gh-ok-'))
  const plugin = path.join(root, 'plugin')
  mkdirSync(path.join(plugin, 'lib'), { recursive: true })
  writeFileSync(path.join(plugin, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, version: '1.0.0' }), 'utf8')
  writeFileSync(path.join(plugin, 'lib', 'obsolete.mjs'), '// 旧版遗留\n', 'utf8')
  writeFileSync(path.join(plugin, 'keep-me-in-git.txt'), 'git 里才有的文件', 'utf8')
  // 新树：lib/new.mjs 存在、obsolete 不存在
  const src = path.join(root, 'src')
  mkdirSync(path.join(src, 'lib'), { recursive: true })
  writeFileSync(path.join(src, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, version: '2.0.0' }), 'utf8')
  writeFileSync(path.join(src, 'lib', 'new.mjs'), '// 新版\n', 'utf8')
  writeFileSync(path.join(src, 'README.md'), '# 新版说明\n', 'utf8')
  const tar = path.join(root, 'good.tar.gz')
  execFileSync('tar', ['-czf', tar, '-C', src, '.'])

  const out = await applyGithubUpdate({
    repo: 'a/b', tag: 'v2.0.0', pluginRoot: plugin, tarballFile: tar, backupRoot: path.join(root, 'bak'),
  })
  assert.equal(out.ok, true)
  assert.equal(out.kind, 'installed')
  assert.equal(out.from, '1.0.0')
  assert.equal(out.to, '2.0.0')
  assert.equal(out.restartRequired, true)
  assert.equal(existsSync(path.join(plugin, 'lib', 'new.mjs')), true, '新文件要进来')
  assert.equal(existsSync(path.join(plugin, 'lib', 'obsolete.mjs')), false, '旧版遗留文件要清掉')
  assert.equal(existsSync(path.join(plugin, 'README.md')), true)
  // 备份里要有旧版文件（回滚用）
  assert.equal(existsSync(path.join(out.backupDir, 'lib', 'obsolete.mjs')), true, '备份要留旧文件')
  assert.equal(JSON.parse(readFileSync(path.join(out.backupDir, 'package.json'), 'utf8')).version, '1.0.0')
})

test('安装：版本号与 tag 不符也不装（防包与你以为的版本不是一回事）', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'xiaoyu-gh-ver-'))
  const plugin = path.join(root, 'plugin')
  mkdirSync(plugin, { recursive: true })
  writeFileSync(path.join(plugin, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, version: '1.0.0' }), 'utf8')
  const src = path.join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(path.join(src, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, version: '2.0.1' }), 'utf8')
  const tar = path.join(root, 'x.tar.gz')
  execFileSync('tar', ['-czf', tar, '-C', src, '.'])
  const out = await applyGithubUpdate({ repo: 'a/b', tag: 'v2.0.0', pluginRoot: plugin, tarballFile: tar, backupRoot: path.join(root, 'bak') })
  assert.equal(out.ok, false)
  assert.equal(out.kind, 'bad-package')
  assert.match(out.error, /不一致/)
})
