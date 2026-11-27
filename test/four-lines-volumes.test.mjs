import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { suggestFourLines, buildFourLinesYaml, writeFourLines } from '../lib/four-lines-gen.mjs'
import { parseVolumes, parseChapterRange, parseChapterName, auditVolumes } from '../lib/volume-lines.mjs'

// ── 3.44.0 四线词自动挖 + 卷纲四线校验 ──────────────────────

function makeNovel(volumes) {
  const root = mkdtempSync(path.join(tmpdir(), 'xiaoyu-44-'))
  const novel = path.join(root, 'novel')
  mkdirSync(path.join(novel, 'chapters'), { recursive: true })
  if (volumes) writeFileSync(path.join(novel, 'volumes.yml'), volumes, 'utf8')
  for (let i = 1; i <= 6; i++) {
    writeFileSync(path.join(novel, 'chapters', 'v01-c' + String(i).padStart(3, '0') + '.md'),
      '---\n---\n他翻回第一格，看清【无】不是没人替它添。四家各自认下。打脸反转赢了。\n', 'utf8')
  }
  return novel
}

test('四线词：主线从卷纲挖、伏笔从【】挖、支线留空', () => {
  const volumes = '- id: v01\n  title: 第一卷 破圈\n  summary: 他翻回第一格，看清【无】不是没人替它添；底下那一格四家各自认下。\n'
  const novel = makeNovel(volumes)
  const chapters = [{ file: 'v01-c001.md', text: '他翻回第一格，看清【无】。四家各自认下，底下那一格。' }]
  const s = suggestFourLines(chapters, { novelDir: novel })
  assert.ok(s.main.length > 0, '主线应有候选')
  assert.ok(s.main.includes('一格') || s.main.includes('第一') || s.main.includes('四家'), '主线应含卷纲实词')
  assert.ok(s.foreshadow.some((w) => w.includes('无')), '伏笔线应含【无】')
  assert.ok(s.sub.length <= 2, '支线最多 2 个（多数情况应为空，让用户手填）')
  assert.ok(!s.main.includes('单元'), '「单元」这种标记词必须剔除')
})

test('four_lines.yml 文本含注释与四行', () => {
  const y = buildFourLinesYaml({ main: ['一格'], sub: [], romance: ['喜欢'], foreshadow: ['【无】'] })
  assert.match(y, /^# /)
  assert.match(y, /main: \[一格\]/)
  assert.match(y, /foreshadow: \[【无】\]/)
})

test('writeFourLines 不覆盖已有文件，force 才写', () => {
  const novel = makeNovel(null)
  const sug = { main: ['a'], sub: [], romance: [], foreshadow: [] }
  const r1 = writeFourLines(novel, sug)
  assert.equal(r1.ok, true)
  const r2 = writeFourLines(novel, { ...sug, main: ['b'] })
  assert.equal(r2.ok, false)
  assert.equal(r2.exists, true)
  const r3 = writeFourLines(novel, { ...sug, main: ['c'] }, { force: true })
  assert.equal(r3.ok, true)
  assert.match(readFileSync(path.join(novel, 'four_lines.yml'), 'utf8'), /main: \[c\]/)
})

test('parseVolumes / parseChapterRange / parseChapterName', () => {
  const vols = parseVolumes('- id: v01\n  title: 第一卷\n  chapters: 001-025\n- id: v02\n  title: 第二卷\n  chapters: 026-052\n')
  assert.equal(vols.length, 2)
  assert.equal(vols[0].id, 'v01')
  assert.deepEqual(parseChapterRange('001-025'), [1, 25])
  assert.deepEqual(parseChapterName('v04-c118.md'), { vol: 4, num: 118 })
})

test('auditVolumes：算每卷章数与爽点，requireLines 时报缺四线', () => {
  const volumes = '- id: v01\n  title: 第一卷\n  chapters: 001-006\n'
  const novel = makeNovel(volumes)
  const chapters = []
  for (let i = 1; i <= 6; i++) chapters.push({ file: 'v01-c' + String(i).padStart(3, '0') + '.md', text: '打脸反转赢了。' })
  const r = auditVolumes(novel, chapters, { requireLines: true })
  assert.equal(r.volumes.length, 1)
  assert.equal(r.volumes[0].chapterCount, 6)
  assert.equal(r.volumes[0].payoff.densityPct, 100)
  assert.ok(r.issues.some((x) => x.kind === 'lines_missing'), '应报缺四线')
  assert.equal(auditVolumes(novel, chapters, { requireLines: false }).issues.filter((x) => x.kind === 'lines_missing').length, 0)
})

test('auditVolumes：无 volumes.yml 优雅跳过', () => {
  const novel = makeNovel(null)
  const r = auditVolumes(novel, [])
  assert.equal(r.ok, true)
  assert.equal(r.volumes.length, 0)
  assert.match(r.summary, /跳过/)
})
