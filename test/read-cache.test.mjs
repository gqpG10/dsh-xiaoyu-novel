import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// ── 读缓存契约（0.5.0）─────────────────────────────────────────────────────
// 小说越写越长，快照/体检/审计每轮都要重读整本书。读缓存按 mtime+size 校验，
// 没改过的文件不再读盘；写入/删除必须显式失效，否则同进程会读到旧内容。
// 这里守住四件事：命中、改动可见、失效生效、目录项跟着变。

const { readTextCached, listDirCached, invalidate, invalidateDir, clearCache, cacheStats } = await import('../lib/read-cache.mjs')
const { parseStateSnapshot, invalidateSnapshotCache } = await import('../lib/panel-core.mjs')

const tmp = () => mkdtempSync(path.join(tmpdir(), 'xiaoyu-cache-'))

test('读缓存：命中不重读，改动能被发现', () => {
  const dir = tmp()
  try {
    const file = path.join(dir, 'a.md')
    writeFileSync(file, '第一版内容', 'utf8')
    clearCache()
    assert.equal(readTextCached(file), '第一版内容')
    const afterFirst = cacheStats().hits
    assert.equal(readTextCached(file), '第一版内容')
    assert.ok(cacheStats().hits > afterFirst, '第二次读没有命中缓存')

    // 改动：内容与大小都变，mtime 随之变 → 必须读到新内容
    writeFileSync(file, '第二版内容更长一些', 'utf8')
    assert.equal(readTextCached(file), '第二版内容更长一些', '改动后仍返回旧内容')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('读缓存：invalidate 后强制重读', () => {
  const dir = tmp()
  try {
    const file = path.join(dir, 'b.md')
    writeFileSync(file, '旧', 'utf8')
    clearCache()
    assert.equal(readTextCached(file), '旧')
    // 绕过写路径直接改盘（模拟外部 agent 写文件），再显式失效
    writeFileSync(file, '新', 'utf8')
    invalidate(file)
    assert.equal(readTextCached(file), '新')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('读缓存：目录项缓存能看到新增文件，缺失路径返回 null', () => {
  const dir = tmp()
  try {
    clearCache()
    writeFileSync(path.join(dir, 'v01-c001.md'), 'x', 'utf8')
    assert.deepEqual(listDirCached(dir), ['v01-c001.md'])
    writeFileSync(path.join(dir, 'v01-c002.md'), 'y', 'utf8')
    // 新建文件会改目录 mtime；若文件系统 mtime 精度不足，显式失效兜底
    invalidateDir(dir)
    assert.deepEqual(listDirCached(dir).sort(), ['v01-c001.md', 'v01-c002.md'])
    assert.equal(readTextCached(path.join(dir, 'nope.md')), null)
    assert.equal(listDirCached(path.join(dir, 'no-dir')), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('快照缓存：同一项目连读两次，第二次直接复用（不再读盘）', () => {
  const root = tmp()
  try {
    const novel = path.join(root, 'novel')
    mkdirSync(path.join(novel, 'chapters'), { recursive: true })
    writeFileSync(
      path.join(novel, 'project.yml'),
      'title: 缓存测试\nauthor: 小鱼\nphase: writing\nmode: ai-draft\n',
      'utf8'
    )
    writeFileSync(
      path.join(novel, 'chapters', 'v01-c001.md'),
      '---\nnum: 1\ntitle: 开篇\nvolume: v01\nstatus: writing\nsummary: 一句话\n---\n\n正文正文正文\n',
      'utf8'
    )
    clearCache()
    const first = parseStateSnapshot(novel, { yamlLib: null })
    assert.equal(first.found, true)
    // TTL 内第二次直接复用同一份装配结果：generatedAt 相同即证明没重建
    const second = parseStateSnapshot(novel, { yamlLib: null })
    assert.equal(second.chapters.length, first.chapters.length)
    assert.equal(second.totals.words, first.totals.words)
    assert.equal(second.generatedAt, first.generatedAt, '第二次快照被重建了（应命中快照缓存）')

    // 改文件后必须看到新内容：写盘会清空快照缓存
    writeFileSync(
      path.join(novel, 'chapters', 'v01-c002.md'),
      '---\nnum: 2\ntitle: 第二章\nvolume: v01\nstatus: pending\nsummary: 又一句\n---\n\n更多正文\n',
      'utf8'
    )
    // 外部直写（非插件写路径）靠 TTL/签名兜底；要「立刻」重读就显式失效
    invalidateSnapshotCache()
    const third = parseStateSnapshot(novel, { yamlLib: null })
    assert.equal(third.chapters.length, 2, '新增章节没被看到——快照缓存没有因写盘失效')
    assert.notEqual(third.generatedAt, first.generatedAt, '新增文件后快照仍是旧的那份')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
