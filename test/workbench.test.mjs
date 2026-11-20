import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listVersions, readVersion, snapshotChapter } from '../lib/history-core.mjs'
import { replaceInNovel, searchNovel } from '../lib/search-core.mjs'

// ── 写作台 2.0 契约（0.6.0）───────────────────────────────────────────────
// ① 章纲解析 / 节拍核对 / 重复词 / 上一章：纯函数直测；
// ② 版本历史：快照去重、列表倒序、按 id 读回；
// ③ 全书搜索 / 替换：命中行号、只改正文、frontmatter 不动；
// ④ 客户端接线：作战板 / 专注 / 底部条 / 搜索 / 命令面板 / 批量都在。

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const js = readFileSync(path.join(rootDir, 'lib/client.js'), 'utf8')

function sliceFunction(name) {
  const start = js.indexOf('function ' + name + '(')
  assert.ok(start >= 0, '找不到函数 ' + name)
  let depth = 0
  for (let i = js.indexOf('{', start); i < js.length; i++) {
    if (js[i] === '{') depth++
    else if (js[i] === '}') {
      depth--
      if (depth === 0) return js.slice(start, i + 1)
    }
  }
  throw new Error('函数未闭合：' + name)
}

const stopStart = js.indexOf('var BEAT_STOP')
const stopSrc = stopStart >= 0 ? js.slice(stopStart, js.indexOf('};', stopStart) + 2) : ''
const outlinePrefix = sliceFunction('outlineSections') + sliceFunction('outlineSection')
const fn = (name) => new Function(stopSrc + outlinePrefix + '\nreturn ' + sliceFunction(name))()
const outlineBeats = fn('outlineBeats')
const outlineCharacters = fn('outlineCharacters')
const beatCoverage = fn('beatCoverage')
const topRepeatedWords = fn('topRepeatedWords')
const prevChapterOf = fn('prevChapterOf')

const OUTLINE = `# 第 21 章 营业执照 章纲

- 本章目标：让采购流程接受手印确认书

## 节拍

- 水果店大姐毁约
- 采购要资质证书
- 三十七个手印装订成确认书

## 出场角色

陈磊、宋佳佳、胡一鸣

## 需埋/需收伏笔

- 行业合规观察的注册主体
`

test('章纲解析：节拍 / 出场角色各归各位', () => {
  const beats = outlineBeats(OUTLINE)
  assert.equal(beats.length, 3)
  assert.match(beats[0], /水果店大姐/)
  assert.deepEqual(outlineCharacters(OUTLINE), ['陈磊', '宋佳佳', '胡一鸣'])
  assert.deepEqual(outlineBeats('无章纲'), [])
})

test('节拍核对：正文覆盖的节拍命中率高', () => {
  const body = '水果店大姐说下季度先缓一缓。采购张口就要资质证书。最后三十七个手印装订成一摞确认书。'
  assert.ok(beatCoverage('水果店大姐毁约', body) > 0.3)
  assert.equal(beatCoverage('完全不相干的节拍', body), 0)
})

test('重复词：高频两字词能抓到', () => {
  const text = '陈磊笑了。陈磊又笑了。陈磊没笑。'.repeat(2)
  const rows = topRepeatedWords(text, 10)
  assert.ok(rows.some((r) => r[0] === '陈磊' && r[1] >= 3))
})

test('上一章：按章号升序取前一条，首章为 null', () => {
  const chapters = [{ file: 'c2.md', num: 2 }, { file: 'c1.md', num: 1 }, { file: 'c3.md', num: 3 }]
  assert.equal(prevChapterOf(chapters, 'c2.md').file, 'c1.md')
  assert.equal(prevChapterOf(chapters, 'c1.md'), null)
  assert.equal(prevChapterOf(chapters, 'nope.md'), null)
})

test('版本历史：快照去重 / 列表倒序 / 按 id 读回', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xy-ver-'))
  try {
    mkdirSync(path.join(dir, 'chapters'))
    const fm = '---\nvolume: 1\nnum: 1\ntitle: t\nstatus: writing\n---\n'
    const file = path.join(dir, 'chapters', 'v01-c001.md')
    writeFileSync(file, fm + '第一版正文。\n', 'utf8')
    const raw = readFileSync(file, 'utf8')
    assert.equal(snapshotChapter(dir, 'v01-c001.md', raw, { minIntervalMs: 0 }).saved, true)
    assert.equal(snapshotChapter(dir, 'v01-c001.md', raw, { minIntervalMs: 0 }).saved, false)
    const list = listVersions(dir, 'v01-c001.md')
    assert.equal(list.length, 1)
    assert.ok(list[0].words >= 5)
    const one = readVersion(dir, 'v01-c001.md', list[0].id)
    assert.equal(one.text, '第一版正文。\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('搜索 / 替换：命中行号，只换正文，frontmatter 原样', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xy-search-'))
  try {
    mkdirSync(path.join(dir, 'chapters'))
    mkdirSync(path.join(dir, 'outlines'))
    const fm = '---\nvolume: 1\nnum: 1\ntitle: 测试章\nstatus: writing\n---\n'
    writeFileSync(path.join(dir, 'chapters', 'v01-c001.md'), fm + '陈磊说，证书没有。\n他又说，证书真没有。\n', 'utf8')
    const hit = searchNovel(dir, '证书', {})
    assert.equal(hit.matches.length, 2)
    assert.equal(hit.matches[0].line, 7)
    const rep = replaceInNovel(dir, '证书', '执照', {})
    assert.equal(rep.total, 2)
    const after = readFileSync(path.join(dir, 'chapters', 'v01-c001.md'), 'utf8')
    assert.ok(after.includes('title: 测试章'), 'frontmatter 被改动了')
    assert.ok(after.includes('执照没有'))
    assert.ok(!after.includes('证书'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('客户端接线：作战板 / 专注 / 底部条 / 搜索 / 命令面板 / 批量', () => {
  for (const anchor of [
    'myt-boardChips', 'boardContent', 'myt-writeBar', 'myt-reader" + (focusOn',
    'searchOpen', 'paletteOpen', 'paletteActions', 'runReplace',
    'myt-batchBar', 'batchSet', 'openVersions', 'restoreVersion', 'restoreRecovery',
    'prevChapterOf',
  ]) {
    assert.ok(js.includes(anchor), '缺少接线：' + anchor)
  }
})

test('i18n：写作台新键中英双全', () => {
  for (const key of ['board.title', 'board.beats', 'reader.historyTitle', 'search.title', 'palette.open', 'chapters.batchSet', 'overview.writeStats']) {
    const zh = new RegExp('"' + key.replace(/\./g, '\\.') + '":')
    assert.ok(zh.test(js), '缺中文键 ' + key)
  }
  assert.ok(js.includes('"search.title": "Search the book"'))
  assert.ok(js.includes('"reader.historyTitle": "Chapter text history"'))
})
test('阅读页首帧防空：detail 为 null 时不读取 .data', () => {
  const src = readFileSync(path.join(rootDir, 'lib/client.js'), 'utf8')
  assert.ok(src.includes('detail && detail.data && detail.data.outline'), '正文渲染缺 detail 空值保护')
  assert.ok(src.includes('detail && detail.data && typeof detail.data.body'), '编辑态正文缺空值保护')
})
