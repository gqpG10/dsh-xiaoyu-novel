/**
 * git-core.mjs —— 书稿版本安全网（0.10.0）
 *
 * 为什么需要：agent 用 write/edit 直接改 novel/ 下文件，面板的章节历史只覆盖
 * 「面板自己保存」与「门禁自动修」两条路——agent 的改动一条都不进历史。而
 * README 一直写着「后悔靠 git 回滚」，书目录里却常常连 .git 都没有：一次误
 * 覆盖就是不可逆。这一层把「一键初始化 + 每次定稿提交 + 单章回滚」做进面板。
 *
 * 设计口径：
 *   - 只用 git 的本地能力，绝不联网、不配远端、不改用户全局配置；
 *   - 所有命令 execFile 直调（无 shell），cwd 固定为 novel 目录，参数逐个传;
 *   - 每次写操作前自检 .git 存在，避免在非仓库目录里跑 git 污染上层仓库;
 *   - 提交信息由调用方给，缺省带时间戳便于人工翻。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

function gitDir(novelDir) {
  return path.join(path.resolve(novelDir), '.git')
}

export function hasRepo(novelDir) {
  return existsSync(gitDir(novelDir))
}

export function runGit(novelDir, args, options = {}) {
  const cwd = path.resolve(novelDir)
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: options.timeout ?? 20000,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
        GIT_AUTHOR_NAME: options.author ?? 'xiaoyu',
        GIT_AUTHOR_EMAIL: 'xiaoyu@localhost',
        GIT_COMMITTER_NAME: options.author ?? 'xiaoyu',
        GIT_COMMITTER_EMAIL: 'xiaoyu@localhost',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, stdout: String(stdout ?? ''), stderr: '' }
  } catch (error) {
    return {
      ok: false,
      stdout: String(error?.stdout ?? ''),
      stderr: String(error?.stderr ?? '') || String(error?.message ?? error),
    }
  }
}

export function gitAvailable() {
  const probe = runGit(process.cwd(), ['--version'])
  return probe.ok && /git version/i.test(probe.stdout)
}

export function initRepo(novelDir, options = {}) {
  const dir = path.resolve(novelDir)
  if (hasRepo(dir)) return { ok: true, created: false }
  const init = runGit(dir, ['init', '-q'])
  if (!init.ok) return { ok: false, error: 'git init 失败：' + init.stderr.trim() }
  const ignorePath = path.join(dir, '.gitignore')
  if (!existsSync(ignorePath)) {
    const ignore = [
      '# 小鱼创作台：临时产物不入库，正文与账本必须入库',
      'exports/',
      'reports/',
      '.xiaoyu/',
      '.trash/',
      '*.tmp',
    ].join('\n') + '\n'
    writeFileSync(ignorePath, ignore, 'utf8')
  }
  const added = runGit(dir, ['add', '-A'])
  if (!added.ok) return { ok: false, error: 'git add 失败：' + added.stderr.trim() }
  const committed = runGit(dir, ['commit', '-q', '-m', options.message ?? '书稿初始快照（小鱼创作台）'])
  if (!committed.ok) {
    const status = runGit(dir, ['status', '--porcelain'])
    if (status.ok && status.stdout.trim() === '') return { ok: true, created: true, commit: null }
    return { ok: false, error: '首次提交失败：' + committed.stderr.trim() }
  }
  const head = runGit(dir, ['rev-parse', '--short', 'HEAD'])
  return { ok: true, created: true, commit: head.ok ? head.stdout.trim() : null }
}

export function repoStatus(novelDir) {
  const dir = path.resolve(novelDir)
  if (!hasRepo(dir)) return { ok: true, repo: false, changed: 0, files: [] }
  const status = runGit(dir, ['status', '--porcelain'])
  if (!status.ok) return { ok: false, repo: true, error: status.stderr.trim() }
  const files = status.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => line.slice(3).trim())
  return { ok: true, repo: true, changed: files.length, files }
}

export function commitAll(novelDir, message) {
  const dir = path.resolve(novelDir)
  if (!hasRepo(dir)) return { ok: false, error: '还没有初始化书稿仓库（先点「初始化版本库」）' }
  const status = repoStatus(dir)
  if (!status.ok) return { ok: false, error: status.error }
  if (status.changed === 0) return { ok: true, commit: null, changed: 0 }
  const added = runGit(dir, ['add', '-A'])
  if (!added.ok) return { ok: false, error: 'git add 失败：' + added.stderr.trim() }
  const text = String(message ?? '').trim() || '书稿自动快照 ' + new Date().toISOString().slice(0, 16).replace('T', ' ')
  const committed = runGit(dir, ['commit', '-q', '-m', text])
  if (!committed.ok) return { ok: false, error: '提交失败：' + committed.stderr.trim() }
  const head = runGit(dir, ['rev-parse', '--short', 'HEAD'])
  return { ok: true, commit: head.ok ? head.stdout.trim() : null, changed: status.changed, message: text }
}

export function listCommits(novelDir, limit = 20) {
  const dir = path.resolve(novelDir)
  if (!hasRepo(dir)) return { ok: true, repo: false, commits: [] }
  const n = Math.min(100, Math.max(1, Number(limit) || 20))
  const out = runGit(dir, ['log', '-' + n, '--pretty=format:%h%x1f%ad%x1f%s', '--date=short', '--name-only'])
  if (!out.ok) return { ok: false, error: out.stderr.trim() }
  const commits = []
  let current = null
  for (const raw of out.stdout.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line.includes('\x1f')) {
      const parts = line.split('\x1f')
      const hash = parts[0]
      const date = parts[1]
      const subject = parts.slice(2).join(" ")
      current = { hash: hash, date: date, subject: subject, files: [] }
      commits.push(current)
    } else if (current !== null && line.trim() !== '') {
      current.files.push(line.trim())
    }
  }
  return { ok: true, repo: true, commits: commits }
}

export function showAtRev(novelDir, rel, rev) {
  const dir = path.resolve(novelDir)
  if (!hasRepo(dir)) return { ok: false, error: '还没有初始化书稿仓库' }
  const safe = safeRel(dir, rel)
  if (safe === null) return { ok: false, error: '路径不在书稿目录内' }
  const target = String(rev ?? 'HEAD').trim()
  if (!/^[0-9a-fA-F]{4,40}$|^HEAD(~\d+)?$/.test(target)) return { ok: false, error: '提交号不合法' }
  const out = runGit(dir, ['show', target + ':' + safe])
  if (!out.ok) return { ok: false, error: '该提交里没有这个文件：' + out.stderr.trim() }
  return { ok: true, rev: target, rel: safe, text: out.stdout }
}

export function restoreFile(novelDir, rel, rev, options = {}) {
  const dir = path.resolve(novelDir)
  const shown = showAtRev(dir, rel, rev)
  if (!shown.ok) return shown
  const abs = path.join(dir, shown.rel)
  let previous = null
  try { previous = readFileSync(abs, "utf8") } catch { previous = null }
  if (typeof options.snapshot === "function" && previous !== null) {
    try { options.snapshot(shown.rel, previous) } catch { /* 备份失败不阻断回滚 */ }
  }
  writeFileSync(abs, shown.text, "utf8")
  return {
    ok: true,
    rel: shown.rel,
    rev: shown.rev,
    bytes: Buffer.byteLength(shown.text, "utf8"),
    had_previous: previous !== null,
  }
}

export function safeRel(rootDir, rel) {
  const root = path.resolve(rootDir)
  const target = path.resolve(root, String(rel ?? ''))
  if (target === root) return null
  const prefix = root.endsWith(path.sep) ? root : root + path.sep
  if (!target.startsWith(prefix)) return null
  return path.relative(root, target).split(path.sep).join('/')
}

