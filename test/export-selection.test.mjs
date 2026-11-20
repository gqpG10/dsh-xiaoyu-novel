import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDocx } from '../lib/docx.mjs'
import { buildSelectionExport, chapterHeading, selectChapters } from '../lib/novel-export.mjs'

// ── 勾选导出 + 账目对账单（0.7.0）─────────────────────────────────────────
// ① docx：最小合法 zip 三件套，正文转义；
// ② 选择器：章号 / 区间 / 文件名三种写法，缺项与区间反写要报错；
// ③ 导出：TXT 只搬选中章、docx 章数与选择一致；
// ④ 接线：服务端路由与客户端按钮都在。

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const indexSrc = readFileSync(path.join(rootDir, 'index.mjs'), 'utf8')
const clientSrc = readFileSync(path.join(rootDir, 'lib/client.js'), 'utf8')

function makeNovel() {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-export-'))
  mkdirSync(path.join(dir, 'chapters'), { recursive: true })
  writeFileSync(path.join(dir, 'project.yml'), 'title: 测试书\nauthor: 小鱼\n', 'utf8')
  const chapter = (file, title, body) =>
    writeFileSync(path.join(dir, 'chapters', file), `---\ntitle: ${title}\nstatus: accepted\n---\n\n${body}\n`, 'utf8')
  chapter('v01-c001.md', '出事', '第一段。\n\n第二段。')
  chapter('v01-c002.md', '收网', '第二章正文。')
  chapter('v01-c003.md', '余波', '第三章正文。')
  return dir
}

test('docx：三个必需部件 + 正文转义', () => {
  const buf = buildDocx({
    title: '测试书',
    chapters: [{ heading: '第1章 出事', paragraphs: ['<尖> & "引"', '第二段。'] }],
  })
  assert.equal(buf.subarray(0, 4).toString('hex'), '504b0304', '不是 zip 头')
  const text = buf.toString('utf8')
  assert.ok(text.includes('[Content_Types].xml'))
  assert.ok(text.includes('_rels/.rels'))
  assert.ok(text.includes('word/document.xml'))
  assert.ok(text.includes('&lt;尖&gt; &amp; &quot;引&quot;'), '正文未按 XML 转义')
})

test('选择器：章号 / 区间 / 文件名三种写法都认，缺项报错', () => {
  const dir = makeNovel()
  try {
    const all = buildSelectionExport({ novelDir: dir, files: '1,3', format: 'txt', title: '测试书' })
    assert.deepEqual(all.chapters.map((c) => c.stem), ['v01-c001', 'v01-c003'])
    assert.ok(all.buffer.toString('utf8').includes('第1章 出事'))
    assert.ok(!all.buffer.toString('utf8').includes('第二章正文。'), '未选中的章被带出去了')

    const range = buildSelectionExport({ novelDir: dir, files: '2-3', format: 'txt' })
    assert.deepEqual(range.chapters.map((c) => c.stem), ['v01-c002', 'v01-c003'])

    const byFile = buildSelectionExport({ novelDir: dir, files: ['v01-c002.md'], format: 'txt' })
    assert.deepEqual(byFile.chapters.map((c) => c.stem), ['v01-c002'])

    const docx = buildSelectionExport({ novelDir: dir, files: '1,2', format: 'docx', title: '测试书' })
    assert.equal(docx.chapters.length, 2)
    assert.equal(docx.buffer.subarray(0, 4).toString('hex'), '504b0304')

    assert.throws(() => buildSelectionExport({ novelDir: dir, files: '9', format: 'txt' }), /不存在的章节/)
    assert.throws(() => buildSelectionExport({ novelDir: dir, files: '3-1', format: 'txt' }), /区间写法反了/)
    assert.throws(() => buildSelectionExport({ novelDir: dir, files: '1', format: 'pdf' }), /不支持的导出格式/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('章节标题：有章号用「第N章 标题」，无章号退文件名', () => {
  assert.equal(chapterHeading({ num: 3, title: '余波', stem: 'v01-c003' }), '第3章 余波')
  assert.equal(chapterHeading({ num: 3, title: '（无标题）', stem: 'v01-c003' }), '第3章')
  assert.equal(chapterHeading({ num: null, title: '', stem: 'v01-c003' }), 'v01-c003')
})

test('接线：服务端路由 + 客户端导出按钮都在', () => {
  assert.ok(indexSrc.includes("route === 'export-selection'"), '缺 export-selection 路由')
  assert.ok(indexSrc.includes('buildSelectionExport'), '路由未接导出模块')
  assert.ok(clientSrc.includes('function exportSel('), '缺客户端导出函数')
  assert.ok(clientSrc.includes('chapters.exportDocx'), '缺 Word 按钮文案')
  assert.ok(clientSrc.includes('export-selection?path='), '客户端未请求导出路由')
})
test('ledger：一条命令出「应落盘 + 缺口」清单', async () => {
  const { execFileSync } = await import('node:child_process')
  const dir = makeNovel()
  try {
    writeFileSync(
      path.join(dir, 'foreshadows.yml'),
      '- id: fs-001\n  title: 半块玉佩\n  status: planted\n  priority: high\n  planted_chapter: v01-c001\n  expected_resolve: v01-c002\n',
      'utf8',
    )
    const bin = path.join(rootDir, 'bin/xiaoyu-novel.mjs')
    const out = execFileSync(process.execPath, [bin, 'ledger', dir, '--chapter', '3'], { encoding: 'utf8' })
    assert.ok(out.includes('账目对账单'), '缺标题')
    assert.ok(out.includes('## 本章应落盘'), '缺应落盘段')
    assert.ok(out.includes('## 全局缺口'), '缺缺口段')
    assert.ok(out.includes('fs-001'), '超期伏笔没被点出来')
    const json = execFileSync(process.execPath, [bin, 'ledger', dir, '--chapter', '3', '--json'], { encoding: 'utf8' })
    const payload = JSON.parse(json)
    assert.equal(payload.ok, true)
    assert.equal(payload.chapter.stem, 'v01-c003')
    assert.ok(payload.overdue.some((fs) => fs.id === 'fs-001'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
test('0.7.1 性能契约：state gzip / 门禁分片 / 建账前瞻', () => {
  assert.ok(indexSrc.includes("'content-encoding': 'gzip'"), 'state 没走 gzip')
  assert.ok(indexSrc.includes("url.searchParams.get('files')"), '/gate 不认 files 分片')
  assert.ok(clientSrc.includes('var rest = all.slice(6)'), '客户端没做门禁分片')
  assert.ok(clientSrc.includes('pull(head, true)'), '客户端没走首屏分片拉取')
  assert.ok(indexSrc.includes('export-selection'), '导出路由丢失')
});
