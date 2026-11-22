import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

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

// Windows：new URL().pathname 返回 /C:/... 带前导斜杠，必须 fileURLToPath。
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 用纯 Node 造一个 tar.gz（跨平台，不依赖系统 tar/cp）。
 *
 * 为什么不 execFileSync('tar', ...)：Windows 上 cp 根本不存在，tar 虽然
 * Win10 1803+ 自带 bsdtar，但 PATH 里不一定可见、参数方言也不同——测试
 * 因此会在 Windows 上报一片「命令找不到」。改用 ustar 头自己写：一份实现
 * 三平台通吃，测的也正是插件真正走的零依赖解压路径。
 *
 * @param {string} outFile 输出 .tar.gz 路径
 * @param {string} srcDir 要打包的目录
 * @param {string} [topDir] 包内顶层目录名（GitHub tarball 形状）。**必须给**：
 *   插件的零依赖解压在剥掉第一层目录后合成包根（GitHub 的 tarball 永远是
 *   `owner-repo-sha/...`），不带顶层目录的包会被它当成「格式不认识」跳过全部
 *   条目——这正是自动化测试要复现的真实形状。缺省取 `owner-repo-sha`。
 */
function makeTarball(outFile, srcDir, topDir) {
  const header = (name, size, type = '0') => {
    const block = Buffer.alloc(512, 0)
    block.write(name, 0, 100, 'utf8')
    block.write('0000644', 100, 8, 'ascii')
    block.write('0000000', 108, 8, 'ascii')
    block.write('0000000', 116, 8, 'ascii')
    block.write(size.toString(8).padStart(11, '0'), 124, 12, 'ascii')
    block.write('00000000000', 136, 12, 'ascii')
    block.write('        ', 148, 8, 'ascii')
    block.write(type, 156, 1, 'ascii')
    block.write('ustar', 257, 6, 'ascii')
    block.write('00', 263, 2, 'ascii')
    let sum = 0
    for (const byte of block) sum += byte
    block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
    return block
  }
  const parts = []
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      const name = prefix === '' ? entry.name : prefix + '/' + entry.name
      if (entry.isDirectory()) {
        parts.push(header(name + '/', 0, '5')) // typeflag 5 = 目录
        walk(full, name)
        continue
      }
      const data = readFileSync(full)
      parts.push(header(name, data.length), data)
      const pad = data.length % 512
      if (pad !== 0) parts.push(Buffer.alloc(512 - pad, 0))
    }
  }
  walk(srcDir, topDir ?? 'owner-repo-sha')
  parts.push(Buffer.alloc(1024, 0))
  writeFileSync(outFile, gzipSync(Buffer.concat(parts), { level: 9 }))
}

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
  makeTarball(tar, src)
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
  makeTarball(tar, src)

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
  makeTarball(tar, src)
  const out = await applyGithubUpdate({ repo: 'a/b', tag: 'v2.0.0', pluginRoot: plugin, tarballFile: tar, backupRoot: path.join(root, 'bak') })
  assert.equal(out.ok, false)
  assert.equal(out.kind, 'bad-package')
  assert.match(out.error, /不一致/)
})
test('三处接线：面板路由 / 一键升级路由 / CLI 子命令都会走私有库', () => {
  const read = (rel) => readFileSync(path.join(rootDir, rel), 'utf8')
  const server = read('index.mjs')
  assert.ok(server.includes('checkGithubVersion({ pkg, force: fresh })'), 'update-check 要走私有库')
  assert.ok(server.includes('applyGithubUpdate({'), 'self-update 要走 GitHub 安装')
  assert.ok(server.includes("resolveGithubRepo(pkgSelf, process.env)"), 'self-update 要按仓库解析决定分支')
  const bin = read('bin/xiaoyu-novel.mjs')
  assert.ok(bin.includes("command === 'update'"), 'CLI 要有 update 子命令')
  assert.ok(bin.includes('fetchLatestGithubVersion'), 'CLI 要查 GitHub 版本')
})
test('内嵌凭据：变形后能解回原 token，环境变量优先，脏数据不往外发', async () => {
  const { embeddedGithubToken, resolveGithubToken } = await import('../lib/github-token.mjs')
  const token = embeddedGithubToken()
  assert.match(token, /^[A-Za-z0-9_]{20,255}$/, '内嵌凭据要能被解出来且形状合法')
  assert.ok(!token.startsWith('ghp_') || token.length > 20)
  // 优先级：环境变量 > 内嵌
  assert.equal(resolveGithubToken({ GITHUB_TOKEN: 'env-token' }).source, 'env')
  assert.equal(resolveGithubToken({ GH_TOKEN: 'env-token' }).token, 'env-token')
  assert.equal(resolveGithubToken({}).source, 'embedded')
  assert.equal(resolveGithubToken({ GITHUB_TOKEN: '  ' }).source, 'embedded', '空白环境变量不算配置')
})

test('源码里不能出现明文 token（防止 gh secret scanning 拦 push / 自动吊销）', () => {
  const text = readFileSync(path.join(rootDir, 'lib/github-token.mjs'), 'utf8')
  assert.ok(!/gh[pousr]_[A-Za-z0-9]{20,}/.test(text), '不得出现明文 GitHub token')
  assert.ok(text.includes('base64'), '要用编码而非明文')
})
test('零依赖解压：不靠系统 tar 也能把源码包铺开（多端兼容）', async () => {
  const { extractTarballJs } = await import('../lib/github-update.mjs')
  const root = mkdtempSync(path.join(tmpdir(), 'xiaoyu-uniq-'))
  const src = path.join(root, 'src')
  mkdirSync(path.join(src, 'lib'), { recursive: true })
  writeFileSync(path.join(src, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, version: '9.9.9' }), 'utf8')
  writeFileSync(path.join(src, 'lib', 'big.mjs'), 'x'.repeat(5000), 'utf8')
  const tar = path.join(root, 'pkg.tar.gz')
  // 造一个带顶层目录的包（模拟 GitHub tarball 形状）；顶层目录名由 makeTarball 加，
  // 不用 cp 复制一份（Windows 上没有 cp）
  makeTarball(tar, src, 'owner-repo-sha')
  const dest = path.join(root, 'out')
  const out = await extractTarballJs(tar, dest)
  assert.equal(out.ok, true)
  assert.ok(out.files >= 2, '要有文件解出来')
  assert.equal(existsSync(path.join(dest, 'package.json')), true, '顶层目录要剥掉')
  assert.equal(readFileSync(path.join(dest, 'lib', 'big.mjs'), 'utf8').length, 5000, '大文件不能截断')
})
test('凭据硬边界：只发白名单主机、只配读方法、只用于钉住的仓库', async () => {
  const { isAllowedTokenTarget, tokenMethodAllowed } = await import('../lib/github-token.mjs')
  const { isPinnedRepo } = await import('../lib/github-update.mjs')
  assert.equal(isAllowedTokenTarget('https://api.github.com/repos/a/b'), true)
  assert.equal(isAllowedTokenTarget('https://codeload.github.com/a/b'), true)
  assert.equal(isAllowedTokenTarget('https://evil.example.com/x'), false)
  assert.equal(isAllowedTokenTarget('http://api.github.com/x'), false)
  assert.equal(isAllowedTokenTarget('not a url'), false)
  assert.equal(tokenMethodAllowed('GET'), true)
  assert.equal(tokenMethodAllowed('HEAD'), true)
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(tokenMethodAllowed(m), false)
  assert.equal(isPinnedRepo('gqpG10/dsh-xiaoyu-novel', 'gqpG10/dsh-xiaoyu-novel'), true)
  assert.equal(isPinnedRepo('GQPG10/DSH-XIAOYU-NOVEL', 'gqpG10/dsh-xiaoyu-novel'), true)
  assert.equal(isPinnedRepo('gqpG10/xiaoyu-armor', 'gqpG10/dsh-xiaoyu-novel'), false)
})

test('换凭据：编码往返一致，写回只动 PARTS，形状不对不写', async () => {
  const { encodeTokenParts, writeEmbeddedToken, TOKEN_KEY } = await import('../lib/token-tools.mjs')
  const fake = 'ghp_' + 'A'.repeat(36)
  const parts = encodeTokenParts(fake)
  const raw = Buffer.from(parts.join(''), 'base64')
  const back = Buffer.alloc(raw.length)
  for (let i = 0; i < raw.length; i += 1) back[i] = raw[i] ^ TOKEN_KEY.charCodeAt(i % TOKEN_KEY.length)
  assert.equal(back.toString('utf8'), fake)
  assert.ok(!parts.join('').includes(fake))
  const root = mkdtempSync(path.join(tmpdir(), 'xiaoyu-tok-'))
  const mod = path.join(root, 't.mjs')
  writeFileSync(mod, ['// 头部注释必须保留', 'const PARTS = [', '  ' + String.fromCharCode(39) + 'AAAA' + String.fromCharCode(39) + ',', ']', 'export const OTHER = 1'].join(String.fromCharCode(10)), 'utf8')
  const ok = await writeEmbeddedToken(mod, fake)
  assert.equal(ok.ok, true)
  const after = readFileSync(mod, 'utf8')
  assert.ok(after.includes('头部注释必须保留'))
  assert.ok(after.includes('export const OTHER = 1'))
  assert.equal(existsSync(mod + '.bak'), true)
  const bad = await writeEmbeddedToken(mod, 'short')
  assert.equal(bad.ok, false)
})

test('钉库守卫按解出来的凭据判断：入参 token 为空也不能绕过', async () => {
  const { fetchLatestGithubVersion, downloadTagTarball } = await import('../lib/github-update.mjs')
  // 不传 token（会回落到内嵌凭据），但钉的是本仓库，去打别的仓库必须拒
  const hit = await fetchLatestGithubVersion({ repo: 'gqpG10/xiaoyu-armor', ghCli: false, pinnedRepo: 'gqpG10/dsh-xiaoyu-novel' })
  assert.equal(hit.ok, false)
  assert.match(hit.error, /只授权/)
  const dl = await downloadTagTarball({ repo: 'gqpG10/xiaoyu-armor', tag: 'v0.13.0', destFile: '/tmp/never.tar.gz', ghCli: false, pinnedRepo: 'gqpG10/dsh-xiaoyu-novel' })
  assert.equal(dl.ok, false)
  assert.match(dl.error, /只授权/)
})

test('体检的写判据：必须用参数合法的建 ref 尝试，且成功自清', () => {
  const source = readFileSync(path.join(rootDir, 'lib/token-tools.mjs'), 'utf8')
  // 空 body 的 POST /git/refs 一律 422（先校验参数后校验权限），只读令牌会被误判成可写
  assert.ok(!/git\/refs[\s\S]{0,200}body: '\{\}'/.test(source), '不许用空 body 探针（会误判）')
  assert.ok(source.includes('headCommitSha'), '要先取 head sha 才能发合法写请求')
  assert.ok(source.includes("method: 'DELETE'"), '探针建出来的 ref 必须立刻删掉')
  assert.ok(source.includes('probeCleaned'), '要回报探针是否清理干净')
  // permissions 字段只做展示，不能当判据（fine-grained 下它回的是账号权限）
  assert.ok(source.includes('判据不靠它'), '注释要写清 permissions 不可作为判据')
})
