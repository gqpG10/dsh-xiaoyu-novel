/**
 * novel-export.mjs — 按「选中章节」导出 TXT / Word（CLI 与面板共用）
 *
 * 口径与整本导出一致：章节按 vXX-cXXX 排序取正文（frontmatter 已剥离），
 * 段落切分复用 novel-parse 的 splitParagraphs，CJK 计数同源。
 * 选中器支持三种写法（面板传文件名、CLI 传章号，两种都认）：
 *   "1,2,5-7"                  章号（卷内 numbers，按 num 匹配）
 *   "v01-c003,v01-c004"        文件名 stem
 *   "v01-c003.md"              带后缀的文件名
 * 解析不到的条目直接抛错（中文），不静默少章——导出少一章比报错更坑。
 */

import { randomUUID } from 'node:crypto'
import { collectChapters, splitParagraphs } from './novel-parse.mjs'
import { buildDocx } from './docx.mjs'
import { buildEpub } from './epub.mjs'

export const SELECTION_FORMATS = ['txt', 'docx', 'epub']

/** 章节显示标题：优先「第N章 标题」，缺章号退文件名。 */
export function chapterHeading(chapter) {
  if (chapter === null || typeof chapter !== 'object') return '（无标题）'
  const num = Number.isInteger(chapter.num) ? chapter.num : null
  const title = typeof chapter.title === 'string' ? chapter.title.trim() : ''
  if (num !== null && title !== '' && title !== '（无标题）') return `第${num}章 ${title}`
  if (num !== null) return `第${num}章`
  return typeof chapter.stem === 'string' && chapter.stem !== '' ? chapter.stem : chapter.file
}

/**
 * 把选中器解析成章节数组（保持全书顺序）。
 *
 * @param {string|string[]} spec 选中器（逗号分隔字符串或数组）
 * @param {Array<object>} chapters collectChapters 产物
 * @returns {Array<object>}
 */
export function selectChapters(spec, chapters) {
  const tokens = (Array.isArray(spec) ? spec : String(spec ?? '').split(','))
    .map((token) => String(token).trim())
    .filter((token) => token !== '')
  if (tokens.length === 0) throw new Error('没有选中任何章节')
  const order = new Map(chapters.map((ch, i) => [ch.file, i]))
  const picked = new Map()
  const missing = []
  for (const token of tokens) {
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(token)
    let matched = []
    if (range !== null) {
      const from = Number(range[1])
      const to = Number(range[2])
      if (from > to) throw new Error('章号区间写法反了：' + token)
      matched = chapters.filter((ch) => Number.isInteger(ch.num) && ch.num >= from && ch.num <= to)
    } else if (/^\d+$/.test(token)) {
      const num = Number(token)
      matched = chapters.filter((ch) => Number.isInteger(ch.num) && ch.num === num)
    } else {
      const stem = token.replace(/\.md$/i, '')
      matched = chapters.filter((ch) => ch.stem === stem)
    }
    if (matched.length === 0) missing.push(token)
    for (const ch of matched) if (!picked.has(ch.file)) picked.set(ch.file, ch)
  }
  if (missing.length > 0) throw new Error('选中项里有不存在的章节：' + missing.join('、'))
  if (picked.size === 0) throw new Error('没有匹配到任何章节')
  return [...picked.values()].sort((a, b) => (order.get(a.file) ?? 0) - (order.get(b.file) ?? 0))
}

/** TXT 全文（标题 + 章节小标题 + 正文段落）。 */
export function renderSelectionTxt({ title, chapters }) {
  const lines = []
  if (typeof title === 'string' && title.trim() !== '') {
    lines.push(title.trim(), '')
  }
  for (const chapter of chapters) {
    lines.push(chapterHeading(chapter), '')
    for (const text of splitParagraphs(chapter.body ?? '')) {
      if (text.trim() !== '') lines.push(text.trim())
    }
    lines.push('')
  }
  return Buffer.from(lines.join('\n'), 'utf8')
}

/**
 * 组装导出字节流。
 *
 * @param {object} input
 * @param {string} input.novelDir novel 根目录
 * @param {string|string[]} input.files 选中器（文件名或章号）
 * @param {'txt'|'docx'} input.format
 * @param {string} [input.title] 书名
 * @returns {{ buffer: Buffer, chapters: Array<object> }}
 */
export function buildSelectionExport({ novelDir, files, format, title, author }) {
  const kind = String(format ?? 'txt').toLowerCase()
  if (!SELECTION_FORMATS.includes(kind)) {
    throw new Error(`不支持的导出格式「${format}」——只认 ${SELECTION_FORMATS.join(' / ')}`)
  }
  const all = collectChapters(novelDir)
  if (all === null || all.length === 0) throw new Error('novel/chapters 里没有可导出的章节')
  const picked = selectChapters(files, all)
  const bookTitle = typeof title === 'string' && title.trim() !== '' ? title.trim() : '未命名书稿'
  if (kind === 'txt') {
    return { buffer: renderSelectionTxt({ title: bookTitle, chapters: picked }), chapters: picked }
  }
  const shaped = picked.map((chapter) => ({
    heading: chapterHeading(chapter),
    paragraphs: splitParagraphs(chapter.body ?? ''),
  }))
  if (kind === 'epub') {
    // EPUB 3（手机/阅读器直接看）：uuid 走 crypto，author 用 project.yml 的
    // author（缺省佚名）——与整本导出同口径。
    const buffer = buildEpub({
      title: bookTitle,
      author: typeof author === 'string' && author.trim() !== '' ? author.trim() : '佚名',
      uuid: randomUUID(),
      chapters: shaped,
    })
    return { buffer, chapters: picked }
  }
  const buffer = buildDocx({ title: bookTitle, chapters: shaped })
  return { buffer, chapters: picked }
}