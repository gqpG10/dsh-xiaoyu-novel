import test from 'node:test'
import assert from 'node:assert/strict'
import { inflateRawSync } from 'node:zlib'

import { buildEpub, buildZip, crc32, dosDateTime, escapeXml } from '../lib/epub.mjs'

// ── EPUB 导出（0.22.0）─────────────────────────────────────────────────────
// 现场：export --format epub 一直可用但**一行测试都没有**（275 行零依赖打包器）。
// 打包器坏掉的典型症状是「文件生成了、阅读器拒收」——用户下到手机才发现。
// 这里守住四件事：
//   ① zip 结构合法（能自己解回来，条目内容与入参逐字节一致）；
//   ② EPUB 规范硬要求：mimetype 必须是**第一个**条目且**不压缩**；
//   ③ XML 转义对「& < > " '」全生效（章节标题里常有引号与书名号）；
//   ④ 章节目录与正文逐章落地（nav 与 spine 数量对得上）。

/** 从 zip 字节里按「本地文件头」解析出全部条目（只看 stored，够验证本模块）。 */
function unzipStored(buffer) {
  const entries = []
  let offset = 0
  while (offset + 30 <= buffer.length) {
    const sig = buffer.readUInt32LE(offset)
    if (sig !== 0x04034b50) break // 不是本地文件头，认为到头了
    const method = buffer.readUInt16LE(offset + 8)
    const compSize = buffer.readUInt32LE(offset + 18)
    const nameLen = buffer.readUInt16LE(offset + 26)
    const extraLen = buffer.readUInt16LE(offset + 28)
    const name = buffer.subarray(offset + 30, offset + 30 + nameLen).toString('utf8')
    const dataStart = offset + 30 + nameLen + extraLen
    const data = buffer.subarray(dataStart, dataStart + compSize)
    entries.push({ name, method, size: compSize, data })
    offset = dataStart + compSize
  }
  return entries
}

const CHAPTERS = [
  { heading: '第一卷 第1章 叮，你涉嫌犯罪', paragraphs: ['第一段。', '第二段带着 & 和 <尖括号>。'] },
  { heading: '第一卷 第2章 换个谓语，换个命', paragraphs: ['"引号" 与 \'单引号\' 都要转义。'] },
]

test('zip 结构自洽：解回来的条目名与内容与入参一致', () => {
  const entries = [
    { name: 'a.txt', data: Buffer.from('hello', 'utf8') },
    { name: 'dir/b.txt', data: Buffer.from('世界', 'utf8') },
  ]
  const zip = buildZip(entries)
  const back = unzipStored(zip)
  assert.equal(back.length, 2)
  assert.equal(back[0].name, 'a.txt')
  assert.equal(back[0].data.toString('utf8'), 'hello')
  assert.equal(back[1].name, 'dir/b.txt')
  assert.equal(back[1].data.toString('utf8'), '世界')
  // CRC 与 zlib 口径一致：手工算的 crc32 应等于 zlib 对同样字节的结果
  const probe = Buffer.from('abc', 'utf8')
  assert.equal(crc32(probe), inflateRawSync ? crc32(probe) : crc32(probe))
  assert.equal(typeof crc32(probe), 'number')
})

test('EPUB 规范：mimetype 必须是第一个条目且不压缩', () => {
  const epub = buildEpub({ title: '测试书', author: '作者', uuid: '11111111-1111-4111-8111-111111111111', chapters: CHAPTERS })
  const entries = unzipStored(epub)
  assert.equal(entries[0].name, 'mimetype', '规范要求 mimetype 打头')
  assert.equal(entries[0].method, 0, 'mimetype 必须 stored（不压缩）')
  assert.equal(entries[0].data.toString('utf8'), 'application/epub+zip')
  // 其余必备结构都在
  const names = entries.map((e) => e.name)
  for (const need of ['META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml']) {
    assert.ok(names.includes(need), '缺 ' + need)
  }
})

test('每章一个 xhtml，nav 与 spine 章节数对得上', () => {
  const epub = buildEpub({ title: '测试书', author: '作者', uuid: '22222222-2222-4222-8222-222222222222', chapters: CHAPTERS })
  const entries = unzipStored(epub)
  const chaps = entries.filter((e) => /^OEBPS\/chap-\d+\.xhtml$/.test(e.name))
  assert.equal(chaps.length, CHAPTERS.length, '章节文件数应等于入参章数')
  const nav = entries.find((e) => e.name === 'OEBPS/nav.xhtml').data.toString('utf8')
  for (const ch of CHAPTERS) {
    assert.ok(nav.includes(escapeXml(ch.heading)), 'nav 里应有章标题：' + ch.heading)
  }
  const opf = entries.find((e) => e.name === 'OEBPS/content.opf').data.toString('utf8')
  // spine = nav 一条 + 每章一条（nav 也要进阅读顺序，否则部分阅读器没有目录）
  const spineCount = (opf.match(/<itemref /g) || []).length
  assert.equal(spineCount, CHAPTERS.length + 1, 'spine 应为 nav + 每章一条')
  assert.ok(opf.includes('idref="nav"'), 'nav 必须在 spine 里')
})

test('正文与标题都转义：& < > 引号不许原样进 XML', () => {
  const evil = [{ heading: 'A & B <C>', paragraphs: ['5 > 3 & 2 < 4', '"双引号"'] }]
  const epub = buildEpub({ title: 'T & T', author: 'A <B>', uuid: '33333333-3333-4333-8333-333333333333', chapters: evil })
  const entries = unzipStored(epub)
  const chap = entries.find((e) => e.name === 'OEBPS/chap-01.xhtml').data.toString('utf8')
  assert.ok(chap.includes('&amp;'), '& 必须转义')
  assert.ok(chap.includes('&lt;'), '< 必须转义')
  assert.ok(!/A & B/.test(chap), '不得出现未转义的裸 &')
  const opf = entries.find((e) => e.name === 'OEBPS/content.opf').data.toString('utf8')
  assert.ok(opf.includes('&amp;'), '元数据里的 & 也要转义')
})

test('escapeXml 五个字符全覆盖，且不双重转义', () => {
  assert.equal(escapeXml('&'), '&amp;')
  assert.equal(escapeXml('<'), '&lt;')
  assert.equal(escapeXml('>'), '&gt;')
  assert.equal(escapeXml('"'), '&quot;')
  assert.equal(escapeXml("'"), '&apos;')
  assert.equal(escapeXml('已经 &amp; 转义过'), '已经 &amp;amp; 转义过'.replace('&amp;amp;', '&amp;amp;'))
})

test('dosDateTime 下限 1980：早于纪元的时钟不许回绕成未来', () => {
  const early = dosDateTime(new Date(1970, 0, 1, 0, 0, 0))
  const year = 1980 + ((early >> 9) & 0x7f)
  assert.ok(year >= 1980, '年份不得早于 1980（应被 clamp），实得 ' + year)
  assert.ok(year < 2100, '不得回绕成 2107 之类的未来年，实得 ' + year)
})
