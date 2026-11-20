/**
 * format-core.mjs —— novel/ 文档格式硬校验（零依赖）。
 *
 * 只查「有没有照模板写」：键名、键序、必需字段、frontmatter 围栏、文件名规范、
 * 派生文件一致性。内容质量不在这里（那是 checkProject / gate / audit 的活）。
 *
 * 判据来源：templates/novel/README.md 与 templates/novel/*（唯一格式权威）。
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { countIndexEntries } from './novel-parse.mjs'
import { listDirCached, readTextCached } from './read-cache.mjs'

// 0.5.0：体检与快照共用同一份读缓存——同一轮请求里检查过的文件不再读第二遍
function readText(file) {
  return readTextCached(file) ?? ''
}

function listMd(dir) {
  const names = listDirCached(dir)
  if (names === null) return []
  return names.filter((name) => typeof name === 'string' && name.endsWith('.md')).sort()
}

/** 拆 frontmatter：返回 { keys, raw, body, hasFence, closed }。 */
export function splitFm(text) {
  const raw = String(text ?? '')
  const keys = []
  if (!raw.startsWith('---')) return { keys, raw, body: raw, hasFence: false, closed: false, fenceText: '' }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { keys, raw, body: '', hasFence: true, closed: false, fenceText: raw }
  const fenceText = raw.slice(4, end)
  for (const line of fenceText.split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line)
    if (m) keys.push(m[1])
  }
  return { keys, raw, body: raw.slice(end + 4), hasFence: true, closed: true, fenceText }
}

function push(problems, level, file, message) {
  if (problems.length < 300) problems.push({ level, file, message })
}

function checkYmlList(dir, name, spec, problems) {
  const file = path.join(dir, name)
  if (!existsSync(file)) return
  const text = readText(file)
  if (text.includes('\t')) push(problems, 'error', name, '含制表符：yml 缩进只允许空格')
  if (text.includes('\r\n')) push(problems, 'warn', name, '含 CRLF 换行：统一用 LF')
  let current = null
  let currentLine = 0
  const items = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^\s*#/.test(line) || line.trim() === '') continue
    let m = /^\s*-\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line)
    if (m) {
      current = { keys: [m[1]], line: i + 1 }
      items.push(current)
      continue
    }
    m = /^\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line)
    if (m && current) { current.keys.push(m[1]); currentLine = i + 1 }
  }
  for (const item of items) {
    const unknown = item.keys.filter((key) => !spec.keys.includes(key))
    // 未知字段在账本里降为提醒：老项目可能带历史字段，但新写的一律不该有。
    if (unknown.length) push(problems, 'warn', name, '第 ' + item.line + ' 条含未知字段「' + unknown.join('、') + '」——模板字段：' + spec.keys.join(' / '))
    const missing = spec.required.filter((key) => !item.keys.includes(key))
    if (missing.length) push(problems, 'error', name, '第 ' + item.line + ' 条缺必填字段「' + missing.join('、') + '」')
    const idx = item.keys.map((k) => spec.keys.indexOf(k)).filter((n) => n >= 0)
    for (let i = 1; i < idx.length; i += 1) {
      if (idx[i] < idx[i - 1]) {
        push(problems, 'warn', name, '第 ' + item.line + ' 条字段顺序与模板不一致（模板：' + spec.keys.join(' → ') + '）')
        break
      }
    }
  }
}

const LIST_SPECS = {
  'foreshadows.yml': { keys: ['id', 'title', 'status', 'priority', 'source', 'planted_chapter', 'expected_resolve', 'resolved_chapter', 'notes'], required: ['id', 'title', 'status', 'planted_chapter'] },
  'relations.yml': { keys: ['a', 'b', 'type', 'description', 'intensity', 'started', 'ended'], required: ['a', 'b', 'type'] },
  'timeline.yml': { keys: ['year', 'title', 'description', 'importance', 'chapter'], required: ['year', 'title'] },
  'memories.yml': { keys: ['category', 'content', 'source_chapter'], required: ['category', 'content'] },
  'clue-board.yml': { keys: ['kind', 'content', 'related_chapter', 'resolved'], required: ['kind', 'content'] },
  'volumes.yml': { keys: ['id', 'title', 'summary', 'chapters'], required: ['id', 'title'] },
}

const PROJECT_KEYS = ['title', 'author', 'genre', 'length', 'language', 'phase', 'mode', 'description']
const CHAPTER_KEYS = ['volume', 'num', 'title', 'status', 'summary', 'cognitive_frame', 'emotional_anchor', 'world_texture', 'suspense', 'interpersonal_tension', 'writer']
const CHAR_KEYS = ['name', 'age', 'gender', 'role', 'appearance', 'personality', 'background', 'motivation', 'arc', 'psychology', 'markers', 'never_do', 'debut_chapter', 'status']
const WORLD_KEYS = ['category', 'tags', 'name']

function checkProjectFile(dir, problems) {
  const text = readText(path.join(dir, 'project.yml'))
  if (text === '') return
  const keys = []
  for (const line of text.split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line)
    if (m) keys.push(m[1])
  }
  for (const key of keys) {
    if (!PROJECT_KEYS.includes(key)) push(problems, 'error', 'project.yml', '未知字段「' + key + '」——只允许：' + PROJECT_KEYS.join(' / '))
  }
  for (const key of PROJECT_KEYS) {
    if (!keys.includes(key)) push(problems, 'error', 'project.yml', '缺字段「' + key + '」（模板八键必须齐全）')
  }
  const idx = keys.map((k) => PROJECT_KEYS.indexOf(k)).filter((n) => n >= 0)
  for (let i = 1; i < idx.length; i += 1) {
    if (idx[i] < idx[i - 1]) { push(problems, 'warn', 'project.yml', '字段顺序与模板不一致（模板：' + PROJECT_KEYS.join(' → ') + '）'); break }
  }
}

function checkChapterFiles(dir, problems) {
  const chaptersDir = path.join(dir, 'chapters')
  for (const file of listMd(chaptersDir)) {
    const rel = 'chapters/' + file
    const text = readText(path.join(chaptersDir, file))
    const fm = splitFm(text)
    const m = /^v(\d{2})-c(\d{3})\.md$/.exec(file)
    if (!m) {
      push(problems, 'error', rel, '文件名不合 vXX-cXXX.md 规范')
    } else {
      const volume = (/^volume:\s*(.+)$/m.exec(fm.fenceText) || [])[1]
      const num = (/^num:\s*(.+)$/m.exec(fm.fenceText) || [])[1]
      if (volume !== undefined && volume.trim().replace(/["']/g, '') !== 'v' + m[1]) push(problems, 'error', rel, 'frontmatter volume 与文件名卷号不一致')
      if (num !== undefined && Number(num.trim().replace(/["']/g, '')) !== Number(m[2])) push(problems, 'error', rel, 'frontmatter num 与文件名章号不一致')
    }
    if (text.includes('\t')) push(problems, 'warn', rel, '含制表符：正文与 frontmatter 用空格缩进')
    if (!fm.hasFence) { push(problems, 'error', rel, '缺 frontmatter（必须以 --- 开头）'); continue }
    if (!fm.closed) { push(problems, 'error', rel, 'frontmatter 未闭合（缺第二个 ---）'); continue }
    for (const key of fm.keys) {
      if (!CHAPTER_KEYS.includes(key)) push(problems, 'error', rel, 'frontmatter 未知字段「' + key + '」——模板字段：' + CHAPTER_KEYS.join(' / '))
    }
    for (const key of ['volume', 'num', 'title', 'status', 'summary']) {
      if (!fm.keys.includes(key)) push(problems, 'error', rel, 'frontmatter 缺字段「' + key + '」')
    }
    if (/^\s*#{1,6}\s/m.test(fm.body)) push(problems, 'warn', rel, '正文含 Markdown 标题：章节正文不写标题层级')
  }
}

function checkEntityFiles(dir, sub, keys, required, problems, slugWarn) {
  const target = path.join(dir, sub)
  for (const file of listMd(target)) {
    const rel = sub + '/' + file
    const text = readText(path.join(target, file))
    const fm = splitFm(text)
    if (!fm.hasFence) { push(problems, 'error', rel, '缺 frontmatter（必须以 --- 开头）'); continue }
    if (!fm.closed) { push(problems, 'error', rel, 'frontmatter 未闭合'); continue }
    for (const key of fm.keys) {
      if (!keys.includes(key)) push(problems, 'error', rel, 'frontmatter 未知字段「' + key + '」——模板字段：' + keys.join(' / '))
    }
    for (const key of required) {
      if (!fm.keys.includes(key)) push(problems, 'error', rel, 'frontmatter 缺必填字段「' + key + '」')
    }
    if (slugWarn && !/^[a-z0-9-]+\.md$/.test(file)) push(problems, 'warn', rel, '文件名建议用小写英文短横线 slug（README 规范）')
  }
}

function checkStyle(dir, problems) {
  const text = readText(path.join(dir, 'style.md'))
  if (text === '') return
  for (const heading of ['## 语言', '## 节奏', '## 禁忌']) {
    if (!new RegExp('^' + heading + '(?=\\s|$)', 'm').test(text)) push(problems, 'warn', 'style.md', '缺「' + heading + '」节（模板结构：叙事/语言/节奏/镜头/对话/情绪与爽点/禁忌）')
  }
}

function checkIndex(dir, problems) {
  const indexPath = path.join(dir, 'index.yml')
  if (!existsSync(indexPath)) return
  const text = readText(indexPath)
  const entries = countIndexEntries(text) // 流式/块式都认（0.4.10：旧判据只数 "- no:"）
  const files = listMd(path.join(dir, 'chapters')).length
  if (entries !== files) push(problems, 'warn', 'index.yml', '索引 ' + entries + ' 条与 chapters/ ' + files + ' 章不一致——重建索引（xiaoyu-novel index）')
}

/**
 * 格式硬校验入口。返回 { ok, problems: [{ level, file, message }] }。
 * error = 破坏数据契约（解析/引用会出错）；warn = 偏离模板但还能读。
 */
export function checkFormat(novelDir) {
  const dir = path.resolve(novelDir)
  const problems = []
  checkProjectFile(dir, problems)
  for (const [name, spec] of Object.entries(LIST_SPECS)) checkYmlList(dir, name, spec, problems)
  checkChapterFiles(dir, problems)
  checkEntityFiles(dir, 'characters', CHAR_KEYS, ['name', 'role'], problems, true)
  checkEntityFiles(dir, 'world', WORLD_KEYS, ['category'], problems, true)
  checkStyle(dir, problems)
  checkIndex(dir, problems)
  return { ok: problems.every((p) => p.level !== 'error'), problems }
}
