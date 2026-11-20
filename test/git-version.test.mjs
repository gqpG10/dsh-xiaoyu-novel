import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { hasRepo, initRepo, repoStatus, commitAll, listCommits, showAtRev, restoreFile, safeRel, gitAvailable } from '../lib/git-core.mjs'

// ── 书稿版本安全网（0.10.0）─────────────────────────────────────────────────
// 面板的章节历史只覆盖「面板保存」与「门禁自动修」，agent 直接 write/edit 的
// 改动一条都不进历史——而 README 一直写着「后悔靠 git 回滚」，书目录里却常常
// 连 .git 都没有。这层守住：一键建仓、提交、单文件回滚、越界拒写。
// 用真 git 跑（宿主自带 2.43），临时目录，不碰用户仓库。

function makeBook() {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-git-'))
  const novel = path.join(dir, 'novel')
  mkdirSync(path.join(novel, 'chapters'), { recursive: true })
  writeFileSync(path.join(novel, 'project.yml'), 'title: 测试书\n', 'utf8')
  writeFileSync(path.join(novel, 'chapters', 'v01-c001.md'), '第一版正文\n', 'utf8')
  return { dir, novel }
}

test('未初始化时状态是 repo:false，提交给出中文指引', () => {
  const { dir, novel } = makeBook()
  try {
    assert.equal(hasRepo(novel), false)
    const status = repoStatus(novel)
    assert.equal(status.ok, true)
    assert.equal(status.repo, false)
    const commit = commitAll(novel, 'x')
    assert.equal(commit.ok, false)
    assert.match(commit.error, /初始化/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('一键建仓：提交初始快照，忽略临时产物', () => {
  const { dir, novel } = makeBook()
  try {
    const init = initRepo(novel)
    assert.equal(init.ok, true)
    assert.equal(init.created, true)
    assert.equal(hasRepo(novel), true)
    const ignore = readFileSync(path.join(novel, '.gitignore'), 'utf8')
    assert.match(ignore, /exports\//)
    assert.match(ignore, /\.xiaoyu\//)
    // 幂等：再调一次不报错、不重复建
    assert.deepEqual(initRepo(novel), { ok: true, created: false })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('提交与回滚：改坏能恢复到上一版，且回滚前会先备份', () => {
  const { dir, novel } = makeBook()
  try {
    initRepo(novel)
    writeFileSync(path.join(novel, 'chapters', 'v01-c001.md'), '第二版正文（改坏了）\n', 'utf8')
    const status = repoStatus(novel)
    assert.equal(status.changed, 1)
    const commit = commitAll(novel, '第1章 定稿')
    assert.equal(commit.ok, true)
    assert.ok(commit.commit)
    const log = listCommits(novel)
    assert.equal(log.repo, true)
    assert.ok(log.commits.length >= 2)
    const first = log.commits[log.commits.length - 1].hash
    const shown = showAtRev(novel, 'chapters/v01-c001.md', first)
    assert.equal(shown.ok, true)
    assert.match(shown.text, /第一版正文/)
    let backed = null
    const restored = restoreFile(novel, 'chapters/v01-c001.md', first, {
      snapshot: (rel, text) => { backed = { rel, text } },
    })
    assert.equal(restored.ok, true)
    assert.equal(backed.rel, 'chapters/v01-c001.md')
    assert.match(backed.text, /改坏了/)
    assert.match(readFileSync(path.join(novel, 'chapters', 'v01-c001.md'), 'utf8'), /第一版正文/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('越界与非法提交号一律拒（防把别人仓库的文件读出来）', () => {
  const { dir, novel } = makeBook()
  try {
    initRepo(novel)
    assert.equal(safeRel(novel, '../../etc/passwd'), null)
    assert.equal(safeRel(novel, 'chapters/../chapters/v01-c001.md'), 'chapters/v01-c001.md')
    const escape = showAtRev(novel, '../../etc/passwd', 'HEAD')
    assert.equal(escape.ok, false)
    const badRev = showAtRev(novel, 'chapters/v01-c001.md', 'HEAD; rm -rf /')
    assert.equal(badRev.ok, false)
    assert.match(badRev.error, /不合法/)
    const missing = showAtRev(novel, 'chapters/nope.md', 'HEAD')
    assert.equal(missing.ok, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('git 可用性探测（缺 git 时面板整块隐藏）', () => {
  assert.equal(gitAvailable(), true)
})
