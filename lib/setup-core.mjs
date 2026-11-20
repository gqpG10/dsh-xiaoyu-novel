/**
 * setup-core.mjs —— 开书九件套体检（零依赖）。
 *
 * 与「全书体检」（跨章质量）互补：这里只查**结构是否齐全、内容是否填空**。
 * 面板概览的「开书清单」与 CLI setup 共用同一套判据，避免两处口径漂移。
 *
 * 九件套：概览 / 章节 / 角色 / 伏笔 / 关系 / 时间线 / 设定 / 写作风格 / 章节索引。
 * （第九章「章节索引」= index.yml；面板的「索引板」tab 是 clues/memories 另一本账，
 *   0.4.10 起条目名改成「章节索引」以免看串。）
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { countIndexEntries } from './novel-parse.mjs'
import { readTextCached } from './read-cache.mjs'

// 0.5.0：开书清单与快照共用同一份读缓存
function readText(file) {
  return readTextCached(file) ?? ''
}

function listMd(dir) {
  try {
    return readdirSync(dir).filter((name) => typeof name === 'string' && name.endsWith('.md')).sort()
  } catch {
    return []
  }
}

function stripFrontmatter(text) {
  const raw = String(text ?? '')
  if (!raw.startsWith('---')) return raw
  const end = raw.indexOf('\n---', 3)
  return end === -1 ? raw : raw.slice(end + 4)
}

function cjkLen(text) {
  return (String(text).match(/[\u4e00-\u9fa5]/g) || []).length
}

/** frontmatter 的平键值（够用即止，不引 yaml）。 */
function flatValue(text, key) {
  const m = new RegExp('^' + key + ':\\s*(.+)$', 'm').exec(String(text ?? ''))
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
}

/** yml 数组条目计数（`- id:` / `- a:` / `- year:`）。 */
function countEntries(text, key) {
  const re = new RegExp('^\\s*-\\s+' + key + '\\s*:', 'gm')
  return (String(text ?? '').match(re) || []).length
}

/** index.yml 里有没有章节条目（口径见 novel-parse 的 countIndexEntries）。 */
function hasIndexChapters(text) {
  return countIndexEntries(text) > 0
}

/**
 * 九件套检查。返回：
 *   { ok, complete, done, total, items: [{ key, label, tab, done, detail, hint }] }
 */
export function checkSetup(novelDir) {
  const dir = path.resolve(novelDir)
  const items = []
  const add = (key, label, tab, done, detail, hint) => items.push({ key, label, tab, done, detail, hint })

  // ① 概览
  const project = readText(path.join(dir, 'project.yml'))
  const title = flatValue(project, 'title')
  const genre = flatValue(project, 'genre')
  const phase = flatValue(project, 'phase')
  const overviewDone = title !== '' && genre !== '' && phase !== ''
  add('overview', '概览', 'overview', overviewDone,
    overviewDone ? [title, genre, phase].join(' · ') : '缺书名/类型/阶段',
    'project.yml 的 title、genre、phase 必填')

  // ② 章节
  const chaptersDir = path.join(dir, 'chapters')
  const chapterFiles = listMd(chaptersDir)
  let firstWords = 0
  for (const file of chapterFiles) {
    const words = cjkLen(stripFrontmatter(readText(path.join(chaptersDir, file))))
    if (words > firstWords) firstWords = words
  }
  const chaptersDone = chapterFiles.length >= 3 && firstWords >= 300
  add('chapters', '章节', 'chapters', chaptersDone,
    chapterFiles.length + ' 章 · 最长正文 ' + firstWords + ' 字',
    '至少 3 章，且首章正文 ≥300 字')

  // ③ 角色
  const charDir = path.join(dir, 'characters')
  const charFiles = listMd(charDir)
  let richCards = 0
  for (const file of charFiles) {
    const text = readText(path.join(charDir, file))
    if (flatValue(text, 'name') && flatValue(text, 'role') && flatValue(text, 'motivation')) richCards += 1
  }
  const charsDone = charFiles.length >= 3 && richCards >= 3
  add('characters', '角色', 'characters', charsDone,
    charFiles.length + ' 张卡 · ' + richCards + ' 张要素齐全',
    '至少 3 张卡，name/role/motivation 必填')

  // ④ 伏笔
  const foreshadowText = readText(path.join(dir, 'foreshadows.yml'))
  const foreshadowCount = countEntries(foreshadowText, 'id')
  const foreshadowDone = foreshadowCount >= 3
  add('foreshadows', '伏笔', 'foreshadows', foreshadowDone,
    foreshadowCount + ' 条', '至少 3 条，含 planted_chapter 与 expected_resolve')

  // ⑤ 关系
  const relationCount = countEntries(readText(path.join(dir, 'relations.yml')), 'a')
  add('relations', '关系', 'relations', relationCount >= 2,
    relationCount + ' 条', '至少 2 条，a/b 用角色卡 slug')

  // ⑥ 时间线
  const timelineCount = countEntries(readText(path.join(dir, 'timeline.yml')), 'year')
  add('timeline', '时间线', 'timeline', timelineCount >= 2,
    timelineCount + ' 条', '至少 2 条开篇前史')

  // ⑦ 设定
  const worldDir = path.join(dir, 'world')
  const worldFiles = listMd(worldDir)
  let richWorld = 0
  for (const file of worldFiles) {
    if (cjkLen(stripFrontmatter(readText(path.join(worldDir, file)))) >= 80) richWorld += 1
  }
  const worldDone = richWorld >= 2
  add('world', '设定', 'world', worldDone,
    worldFiles.length + ' 条 · ' + richWorld + ' 条有正文',
    '至少 2 条（金手指、对抗格局），每条正文 ≥80 字')

  // ⑧ 写作风格
  const stylePath = path.join(dir, 'style.md')
  const styleText = readText(stylePath)
  const styleDone = styleText.trim() !== '' && cjkLen(styleText) >= 200
  add('style', '写作风格', 'style', styleDone,
    styleDone ? cjkLen(styleText) + ' 字' : (existsSync(stylePath) ? '内容过短' : '文件缺失'),
    'style.md 正文 ≥200 字，含语言档位与禁忌')

  // ⑨ 章节索引（index.yml；面板 tab 叫「索引板」，但那是 clues/memories 另一本账，
  //    标签写「章节索引」免得看串——0.4.10）
  const indexPath = path.join(dir, 'index.yml')
  let indexDone = false
  let indexDetail = '文件缺失'
  if (existsSync(indexPath)) {
    const text = readText(indexPath)
    indexDone = hasIndexChapters(text)
    indexDetail = indexDone ? '已建' : '内容为空'
  }
  add('index', '章节索引', 'index', indexDone, indexDetail, '建章后重建（xiaoyu-novel index / 面板重建索引）')

  const done = items.filter((item) => item.done).length
  return { ok: true, complete: done === items.length, done, total: items.length, items }
}

/** 命令行输出（CLI setup 用，保持与面板同一判据）。 */
export function setupText(result) {
  const lines = ['开书九件套：' + result.done + '/' + result.total + (result.complete ? '（齐全）' : '（未齐）')]
  for (const item of result.items) {
    lines.push('  ' + (item.done ? '✓' : '✗') + ' ' + item.label + '  ' + item.detail + (item.done ? '' : '  —— ' + item.hint))
  }
  if (!result.complete) lines.push('缺项补齐后再开写：xiaoyu-novel setup 复核。')
  return lines.join('\n')
}
