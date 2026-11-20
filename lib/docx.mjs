/**
 * docx.mjs — 最小合法 Word 文档生成（零依赖，复用 epub.mjs 的 zip writer）
 *
 * 为什么自己拼：插件不许带 npm 依赖，docx 本质是 zip + 三个 XML 部件，
 * 只用 stored（method 0）zip 就够——文件大一点，但零依赖、无压缩库、
 * 生成逻辑可测。Word / WPS / LibreOffice 都认这个最小结构。
 *
 * 结构：
 *   [Content_Types].xml         → 声明 rels/xml 默认类型 + document.xml 覆盖
 *   _rels/.rels                 → 指向 word/document.xml 的 officeDocument 关系
 *   word/document.xml           → 正文（标题段 + 章节标题段 + 段落）
 *
 * 段落转义严格按 XML：& < > " ' 全转义，防止正文里的尖括号把文档写坏。
 */

import { buildZip } from './epub.mjs'

/** XML 文本转义：五个字符全转，顺序不能乱（& 先转）。 */
function escXml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/** 单个段落；bold/size 用于标题（字号单位半磅，32 = 16pt）。 */
function para(text, { bold = false, size = 0, align = 'both' } = {}) {
  const props = []
  if (align !== 'both') props.push(`<w:jc w:val="${align}"/>`)
  const rPr = []
  if (bold) rPr.push('<w:b/>')
  if (size > 0) rPr.push(`<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`)
  const runProps = rPr.length > 0 ? `<w:rPr>${rPr.join('')}</w:rPr>` : ''
  const paraProps = props.length > 0 ? `<w:pPr>${props.join('')}</w:pPr>` : ''
  return `<w:p>${paraProps}<w:r>${runProps}<w:t xml:space="preserve">${escXml(text)}</w:t></w:r></w:p>`
}

/** 空段落（章节之间的呼吸位）。 */
function blank() {
  return '<w:p/>'
}

/**
 * 生成 .docx。
 *
 * @param {object} input
 * @param {string} input.title 书名（首段居中加粗）
 * @param {Array<{heading: string, paragraphs: string[]}>} input.chapters
 * @returns {Buffer} zip 字节流，可直接 writeFileSync / res.end
 */
export function buildDocx({ title, chapters }) {
  if (typeof title !== 'string') throw new TypeError('buildDocx: title 必须是字符串')
  if (!Array.isArray(chapters)) throw new TypeError('buildDocx: chapters 必须是数组')
  const body = []
  if (title.trim() !== '') {
    body.push(para(title.trim(), { bold: true, size: 36, align: 'center' }))
    body.push(blank())
  }
  for (const chapter of chapters) {
    const heading = typeof chapter?.heading === 'string' && chapter.heading.trim() !== '' ? chapter.heading.trim() : '（无标题）'
    body.push(para(heading, { bold: true, size: 28, align: 'left' }))
    const paragraphs = Array.isArray(chapter?.paragraphs) ? chapter.paragraphs : []
    for (const text of paragraphs) {
      if (typeof text !== 'string' || text.trim() === '') continue
      body.push(para(text.trim()))
    }
    body.push(blank())
  }
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:body>' + body.join('') + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
    '</w:body></w:document>'
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>'
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>'
  return buildZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'word/document.xml', data: documentXml },
  ])
}
