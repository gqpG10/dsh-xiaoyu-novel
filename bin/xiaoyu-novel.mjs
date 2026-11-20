#!/usr/bin/env node
/**
 * xiaoyu — 小鱼网文创作项目 CLI（init / stats / index / export / brief / check）
 *
 * 零依赖：只用 node:fs / node:path / node:url / node:crypto，模板目录经
 * import.meta.url 定位，任意 cwd 可用。novel/ 目录的数据规范见
 * templates/novel/README.md（或已初始化项目里的 novel/README.md）。
 *
 *   xiaoyu-novel init [dir]    生成 novel/ 脚手架（默认 ./novel；已存在文件跳过，绝不覆盖）
 *   xiaoyu-novel stats [dir]   逐章字数（CJK 计数）、状态分布、当前 phase
 *   xiaoyu-novel index [dir]   从 volumes.yml + chapters/ 重建 index.yml（派生文件）
 *   xiaoyu-novel export [dir]  导出全书：--format md|txt|epub（默认 md）、--out <目录>
 *   xiaoyu-novel brief [dir] <chapter> [--out <文件>]
 *                         组装某章写作卡（章纲+前章结尾+出场角色卡+活跃伏笔）
 *   xiaoyu-novel ledger [dir] [--chapter N] [--json]  五本账对账单：本章应落盘 + 全局缺口
 *   xiaoyu-novel check [dir]   静态体检（不调模型）：frontmatter/枚举/章号/伏笔引用/伏笔超期/章纲钩子/AI 味统计/阶段就绪判据等
 *   xiaoyu-novel gate [dir]    门禁分：逐章人味指数 / 人写度，按低分排序（与面板同一引擎）
 *
 * 子命令出错 exit 1，中文报错。
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildEpub } from '../lib/epub.mjs'
import { buildSelectionExport } from '../lib/novel-export.mjs'
import { buildHandoff, renderHandoff } from '../lib/handoff-core.mjs'
import { archiveApply, archivePlan } from '../lib/slim-core.mjs'
import { applyLedgerClean, describePlan, planLedgerClean, undoLedgerClean } from '../lib/ledger-clean.mjs'
import { applyGithubUpdate, fetchLatestGithubVersion, resolveGithubRepo } from '../lib/github-update.mjs'
import { resolveGithubToken } from '../lib/github-token.mjs'
import { describeInspection, inspectToken, writeEmbeddedToken } from '../lib/token-tools.mjs'
import { compareVersions, currentVersion } from '../lib/version.mjs'
import { exportPortable, importPortable, readPortable, restoreHint } from '../lib/portable.mjs'
import { diagnose, renderDiagnosis } from '../lib/doctor.mjs'
import { analyzeChapter } from '../lib/gate-core.mjs'
import { auditMarkdown, auditProject, stripFrontmatter } from '../lib/audit-core.mjs'
import { checkFormat } from '../lib/format-core.mjs'
import { checkSetup, setupText } from '../lib/setup-core.mjs'
// 解析层与面板共用（lib/novel-parse.mjs）；parseFlatYamlArray 沿用旧名
// parseSimpleYaml，保持本文件其余代码原样不动。STATUSES / splitParagraphs
// 也改从 lib 取——状态机与分段逻辑只留 lib 一份，bin 不再各养一副拷贝。
import {
  buildBrief,
  buildIndexYaml,
  CHAPTER_STATUSES as STATUSES, // 章节状态机（原 bin 本地 STATUSES，展示用中文标签随 lib 走）
  checkProject,
  chapterSortKey,
  collectChapters,
  countCjk,
  parseChapterFile,
  parseFlatYamlArray as parseSimpleYaml,
  readTextOrNull, // 读文本文件读不到返回 null（原 bin 本地拷贝，lib 导出后改 import）
  splitFrontmatter,
  splitParagraphs, // 正文分段（原 bin 本地 bodyParagraphs 的同款实现）
} from '../lib/novel-parse.mjs'

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATE_DIR = path.join(PLUGIN_ROOT, 'templates', 'novel')

/** 七阶段工作流（与 project.yml 的 phase 枚举一致）。 */
const PHASES = {
  idea: '选题',
  setting: '设定',
  outline: '大纲',
  writing: '写作',
  review: '审阅',
  consistency: '一致性',
  export: '导出',
}

// ── 基础工具 ────────────────────────────────────────────────────────────────

/** 中文报错 + exit 1。 */
function fail(message) {
  console.error(`xiaoyu: ${message}`)
  process.exit(1)
}

/**
 * 同名输出不静默覆盖：目标文件已存在时在扩展名前加序号 -2、-3……直到找到
 * 未占用的名字。返回 { path, renamed }；renamed 为 true 时调用方向 stderr
 * 提示一句改写去向——绝不覆盖用户已有文件。
 */
function dedupeWritePath(target) {
  if (!existsSync(target)) return { path: target, renamed: false }
  const dir = path.dirname(target)
  const ext = path.extname(target)
  const stem = path.basename(target, ext)
  for (let n = 2; ; n++) {
    const candidate = path.join(dir, `${stem}-${n}${ext}`)
    if (!existsSync(candidate)) return { path: candidate, renamed: true }
  }
}

// ── init ────────────────────────────────────────────────────────────────────

/** 递归复制模板树；已存在文件跳过（绝不覆盖），返回 {created, skipped} 相对路径清单。 */
function copyTemplateTree(srcDir, destDir, relBase = '') {
  const created = []
  const skipped = []
  mkdirSync(destDir, { recursive: true })
  for (const entry of readdirSync(srcDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = relBase === '' ? entry.name : `${relBase}/${entry.name}`
    const src = path.join(srcDir, entry.name)
    const dst = path.join(destDir, entry.name)
    if (entry.isDirectory()) {
      const sub = copyTemplateTree(src, dst, rel)
      created.push(...sub.created)
      skipped.push(...sub.skipped)
    } else if (existsSync(dst)) {
      skipped.push(rel)
    } else {
      copyFileSync(src, dst)
      created.push(rel)
    }
  }
  return { created, skipped }
}

function cmdInit(targetArg) {
  if (!existsSync(TEMPLATE_DIR)) fail(`模板目录缺失：${TEMPLATE_DIR}（插件包不完整？）`)
  const dest = path.resolve(targetArg ?? 'novel')
  // 落盘点兜底：目录建不出来 / 模板拷不动（权限、只读盘等）报中文错，不甩英文栈
  let counts
  try {
    counts = copyTemplateTree(TEMPLATE_DIR, dest)
  } catch (error) {
    fail(`写入失败：${dest}（${error.message}）`)
  }
  const { created, skipped } = counts
  console.log(`小鱼脚手架 → ${dest}`)
  for (const rel of created) console.log(`  创建 ${rel}`)
  for (const rel of skipped) console.log(`  跳过 ${rel}（已存在，未覆盖）`)
  console.log(`完成：新建 ${created.length} 个文件，跳过 ${skipped.length} 个。`)
  console.log('数据规范见 novel/README.md；动手前先填 novel/project.yml。')
}

// ── stats ───────────────────────────────────────────────────────────────────

function cmdStats(targetArg) {
  const root = path.resolve(targetArg ?? 'novel')
  const chapters = collectChapters(root)
  if (chapters === null) fail(`找不到 ${path.join(root, 'chapters')}——先跑 xiaoyu-novel init ${root}`)

  const project = parseSimpleYaml(readTextOrNull(path.join(root, 'project.yml')))
  const phase = project !== null && typeof project.phase === 'string' && project.phase !== '' ? project.phase : null
  const phaseText = phase === null ? '未设置（缺 project.yml 或 phase 键）' : `${phase}（${PHASES[phase] ?? '未知阶段'}）`

  console.log(`小说统计：${root}`)
  console.log(`阶段：${phaseText}`)
  console.log('')

  if (chapters.length === 0) {
    console.log('章节（0）：chapters/ 下还没有章节文件')
  } else {
    console.log(`章节（${chapters.length}）：`)
    for (const ch of chapters) {
      const statusLabel = STATUSES.find(([s]) => s === ch.status)?.[1] ?? ch.status
      // 文件名合规范时 stem（v01-c001）即唯一标识；不合规范再补 meta 卷号/章号
      const id = ch.sortKey !== null ? ch.stem : `${ch.volume || 'v??'} c${String(ch.num ?? 0).padStart(3, '0')}`
      console.log(`  ${ch.stem.padEnd(10)} ${id !== ch.stem ? `(${id}) ` : ''}${ch.title}  [${statusLabel}]  ${ch.words} 字`)
    }
  }

  const counts = Object.fromEntries(STATUSES.map(([s]) => [s, 0]))
  let total = 0
  for (const ch of chapters) {
    counts[ch.status] += 1
    total += ch.words
  }
  console.log('')
  console.log(`状态分布：${STATUSES.map(([s, label]) => `${s}（${label}）${counts[s]}`).join(' · ')}`)
  console.log(`总字数：${total}（CJK 计数）`)
}

// ── index ───────────────────────────────────────────────────────────────────

// index.yml 的拼装逻辑在 lib/novel-parse.mjs 的 buildIndexYaml（与创作台
// rebuild-index 路由共用），这里只负责读卷表、落盘与汇报。

function cmdIndex(targetArg) {
  const root = path.resolve(targetArg ?? 'novel')
  const chapters = collectChapters(root)
  if (chapters === null) fail(`找不到 ${path.join(root, 'chapters')}——先跑 xiaoyu-novel init ${root}`)
  const volumesRaw = parseSimpleYaml(readTextOrNull(path.join(root, 'volumes.yml')))
  const { text, volumesCount, chaptersCount, orphansCount, totalWords } = buildIndexYaml(chapters, volumesRaw)
  const indexPath = path.join(root, 'index.yml')
  // 落盘点兜底：写不进（权限/只读盘等）报中文错，不甩英文栈
  try {
    writeFileSync(indexPath, text, 'utf8')
  } catch (error) {
    fail(`写入失败：${indexPath}（${error.message}）`)
  }
  console.log(`已重建 ${indexPath}：${volumesCount} 卷、${chaptersCount} 章（总字数 ${totalWords}）、未归卷 ${orphansCount} 章。`)
}

// ── export ──────────────────────────────────────────────────────────────────

/** 支持的导出格式（--format 取值）。 */
const EXPORT_FORMATS = ['md', 'txt', 'epub', 'docx']

/**
 * 导出文件名里的书名清洗：路径非法字符 /\\:*?"<>| 一律替换掉，再去首尾
 * 空白与点（Windows 上尾点会吞扩展名）。清完为空兜回「未命名书稿」。
 */
function sanitizeTitleForFile(title) {
  const cleaned = String(title ?? '')
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/^[.\s]+|[.\s]+$/g, '')
  return cleaned !== '' ? cleaned : '未命名书稿'
}

/** 卷标题映射：volumes.yml 的 id → title；文件缺失/不合规返回空映射。 */
function volumeTitleMap(root) {
  const raw = parseSimpleYaml(readTextOrNull(path.join(root, 'volumes.yml')))
  const list = Array.isArray(raw) ? raw.filter((v) => v !== null && typeof v === 'object' && !Array.isArray(v)) : []
  const map = new Map()
  for (const v of list) {
    const id = String(v.id ?? '')
    if (id !== '' && typeof v.title === 'string' && v.title !== '') map.set(id, v.title)
  }
  return map
}

/** 卷号还原：'v01' → 1；不合规范的卷 id 返回 null（该卷跳过卷层）。 */
function volumeNumber(volume) {
  const m = /^v(\d+)$/.exec(String(volume ?? ''))
  return m === null ? null : Number(m[1])
}

/**
 * 章节展示信息（md/txt/epub 三格式共用）：卷层、章标题、分段正文。
 * 章标题形如「卷X-章Y 章节标题」；卷 id 不合规范或章节无卷信息时退为
 * 「章Y 章节标题」，卷层记 null（导出时跳过卷层）。章号缺省用全书序号。
 */
function chapterDisplay(ch, ordinal, volTitles) {
  const volNum = volumeNumber(ch.volume)
  const chNum = Number.isInteger(ch.num) ? ch.num : ordinal
  const volPart = volNum !== null ? `卷${volNum}-章${chNum}` : `章${chNum}`
  return {
    volume: volNum !== null ? { num: volNum, title: volTitles.get(ch.volume) ?? '' } : null,
    heading: `${volPart} ${ch.title}`.trim(),
    body: ch.body,
    paragraphs: splitParagraphs(ch.body),
  }
}

/** 按相邻同卷分组（保持章序）：[{ volume, chapters: [display] }]，无卷组 volume 为 null。 */
function groupByVolume(chapters, volTitles) {
  const groups = []
  let current = null
  chapters.forEach((ch, i) => {
    const display = chapterDisplay(ch, i + 1, volTitles)
    const rawVolume = ch.volume ?? ''
    if (current === null || current.rawVolume !== rawVolume) {
      current = { rawVolume, volume: display.volume, chapters: [] }
      groups.push(current)
    }
    current.chapters.push(display)
  })
  return groups
}

/** 卷层标题：`卷1 卷名`；无卷名只留 `卷1`。 */
function volumeHeading(volume) {
  return volume.title !== '' ? `卷${volume.num} ${volume.title}` : `卷${volume.num}`
}

/** md：`# 书名` + 卷层 `## 卷N 卷名` + 每章 `### 卷X-章Y 标题` + 正文原文。 */
function renderMarkdown(title, groups) {
  const lines = [`# ${title}`, '']
  for (const group of groups) {
    if (group.volume !== null) lines.push(`## ${volumeHeading(group.volume)}`, '')
    for (const display of group.chapters) {
      lines.push(`### ${display.heading}`, '', display.body.trim(), '')
    }
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}

/** txt：纯文本；书名/卷名/章标题独立成行（章标题前空一行），段间空行。 */
function renderText(title, groups) {
  const lines = [title]
  for (const group of groups) {
    if (group.volume !== null) lines.push('', volumeHeading(group.volume))
    for (const display of group.chapters) {
      lines.push('', display.heading, '', display.paragraphs.join('\n\n'))
    }
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}

function cmdExport(args) {
  let dirArg = null
  let format = 'md'
  let outArg = null
  let chaptersArg = null
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--format' || arg === '--out' || arg === '--chapters') {
      const value = args[++i]
      if (value === undefined) fail(`选项 ${arg} 缺参数——--format 取 ${EXPORT_FORMATS.join('|')}、--out 取输出目录、--chapters 取 1,2,5-7 或 v01-c003`)
      if (arg === '--format') format = value
      else if (arg === '--out') outArg = value
      else chaptersArg = value
    } else if (arg.startsWith('--format=')) {
      format = arg.slice('--format='.length)
    } else if (arg.startsWith('--out=')) {
      outArg = arg.slice('--out='.length)
    } else if (arg.startsWith('--chapters=')) {
      chaptersArg = arg.slice('--chapters='.length)
    } else if (arg.startsWith('-')) {
      fail(`未知选项「${arg}」——export 只认 --format / --out / --chapters`)
    } else if (dirArg === null) {
      dirArg = arg
    } else {
      fail(`多余的位置参数「${arg}」——export 只接受一个项目目录`)
    }
  }
  if (!EXPORT_FORMATS.includes(format)) fail(`未知导出格式「${format}」——支持 ${EXPORT_FORMATS.join(' / ')}`)
  if (outArg !== null && outArg.trim() === '') fail('选项 --out 不能是空串——--out 取导出目录路径')
  if (chaptersArg !== null && chaptersArg.trim() === '') fail('选项 --chapters 不能是空串——写成 1,2,5-7 或 v01-c003')
  // 勾选导出只做逐章正文搬运，md 全书排版与 epub 打包不适用
  if (chaptersArg !== null && (format === 'md' || format === 'epub')) {
    fail('--chapters 只支持 --format txt|docx——md/epub 是整本排版产物')
  }

  const root = path.resolve(dirArg ?? 'novel')
  const chapters = collectChapters(root)
  if (chapters === null) fail(`找不到 ${path.join(root, 'chapters')}——先跑 xiaoyu-novel init ${root}`)
  if (chapters.length === 0) fail('没有可导出的章节')

  const project = parseSimpleYaml(readTextOrNull(path.join(root, 'project.yml')))
  const rawTitle =
    project !== null && typeof project.title === 'string' && project.title.trim() !== '' ? project.title.trim() : ''
  const title = rawTitle !== '' ? rawTitle : '未命名书稿'
  const author =
    project !== null && typeof project.author === 'string' && project.author.trim() !== ''
      ? project.author.trim()
      : '佚名'

  const now = new Date()
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const outDir = path.resolve(outArg ?? path.join(root, 'exports'))
  const suffix = chaptersArg !== null ? `-选中${(chaptersArg.match(/,/g) || []).length + 1}章` : ''
  const outPath = path.join(outDir, `${sanitizeTitleForFile(rawTitle)}${suffix}-${stamp}.${format}`)

  // 勾选导出（--chapters）与 docx：走共享选择器，只搬正文，不做整本排版
  if (chaptersArg !== null || format === 'docx') {
    const files = chaptersArg !== null ? chaptersArg : chapters.map((ch) => ch.stem).join(',')
    let built
    try {
      built = buildSelectionExport({ novelDir: root, files, format, title })
    } catch (error) {
      fail(error.message)
    }
    const target = dedupeWritePath(outPath)
    if (target.renamed) console.error(`提示：${outPath} 已存在，本次导出改写到 ${target.path}`)
    try {
      mkdirSync(outDir, { recursive: true })
      writeFileSync(target.path, built.buffer)
    } catch (error) {
      fail(`写入失败：${target.path}（${error.message}）`)
    }
    const totalWords = built.chapters.reduce((sum, ch) => sum + ch.words, 0)
    console.log(`导出完成：${path.resolve(target.path)}`)
    console.log(`格式 ${format}；${built.chapters.length} 章，总字数 ${totalWords}（CJK 计数）。`)
    return
  }

  const groups = groupByVolume(chapters, volumeTitleMap(root))
  const outPathFull = path.join(outDir, `${sanitizeTitleForFile(rawTitle)}-${stamp}.${format}`)
  const target = dedupeWritePath(outPathFull)
  if (target.renamed) console.error(`提示：${outPathFull} 已存在，本次导出改写到 ${target.path}`)

  let content
  if (format === 'md') {
    content = renderMarkdown(title, groups)
  } else if (format === 'txt') {
    content = renderText(title, groups)
  } else {
    content = buildEpub({
      title,
      author,
      uuid: randomUUID(),
      chapters: groups.flatMap((group) => group.chapters),
    })
  }

  try {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(target.path, content)
  } catch (error) {
    fail(`写入失败：${target.path}（${error.message}）`)
  }
  const totalWords = chapters.reduce((sum, ch) => sum + ch.words, 0)
  console.log(`导出完成：${path.resolve(target.path)}`)
  console.log(`格式 ${format}；${chapters.length} 章，总字数 ${totalWords}（CJK 计数）。`)
}

// ── ledger ──────────────────────────────────────────────────────────────────

/**
 * xiaoyu-novel ledger [dir] [--chapter <n|vXX-cXXX>] [--json]
 *
 * 五本账对账单：一次算出「这一章该落什么账」，设定管理员照着填即可，不必把
 * foreshadows / timeline / relations / memories / clue-board 逐份读一遍。
 * 只做机械可判定的事实，不做文学判断。
 */
function cmdLedger(args) {
  let dirArg = null
  let chapterRef = null
  let asJson = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--chapter') {
      const value = args[++i]
      if (value === undefined) fail('选项 --chapter 缺参数——写章号 21 或 v01-c021')
      chapterRef = value
    } else if (arg.startsWith('--chapter=')) {
      chapterRef = arg.slice('--chapter='.length)
    } else if (arg === '--json') {
      asJson = true
    } else if (arg.startsWith('-')) {
      fail('未知选项「' + arg + '」——ledger 只认 --chapter 与 --json')
    } else if (dirArg === null) {
      dirArg = arg
    } else {
      fail('多余的位置参数「' + arg + '」——ledger 只接受一个项目目录')
    }
  }
  const root = path.resolve(dirArg ?? 'novel')
  const chapters = collectChapters(root)
  if (chapters === null) fail('找不到 ' + path.join(root, 'chapters') + '——先跑 xiaoyu-novel init ' + root)
  if (chapters.length === 0) fail('还没有章节，账目对账单需要至少一章正文')

  const foreshadows = parseSimpleYaml(readTextOrNull(path.join(root, 'foreshadows.yml'))) ?? []
  const timeline = parseSimpleYaml(readTextOrNull(path.join(root, 'timeline.yml'))) ?? []
  const memories = parseSimpleYaml(readTextOrNull(path.join(root, 'memories.yml'))) ?? []
  const relations = parseSimpleYaml(readTextOrNull(path.join(root, 'relations.yml'))) ?? []

  const charactersDir = path.join(root, 'characters')
  const characters = []
  if (existsSync(charactersDir)) {
    for (const file of readdirSync(charactersDir).filter((f) => f.endsWith('.md'))) {
      const text = readTextOrNull(path.join(charactersDir, file)) ?? ''
      const { meta } = parseChapterFile(text)
      const name = typeof meta.name === 'string' && meta.name.trim() !== '' ? meta.name.trim() : file.replace(/\.md$/i, '')
      characters.push({ slug: file.replace(/\.md$/i, ''), name, file })
    }
  }

  const keyOf = (stem) => chapterSortKey(stem)
  let target = null
  if (chapterRef !== null) {
    const ref = chapterRef.trim()
    target =
      chapters.find((ch) => ch.stem === ref) ??
      chapters.find((ch) => Number.isInteger(ch.num) && String(ch.num) === ref) ??
      null
    if (target === null) fail('找不到章节「' + ref + '」——写章号 21 或 v01-c021')
  } else {
    const pending = chapters.filter((ch) => ch.status !== 'accepted')
    target = pending.length > 0 ? pending[pending.length - 1] : chapters[chapters.length - 1]
  }

  const targetKey = keyOf(target.stem)
  const cmp = (a, b) => (a.vol !== b.vol ? a.vol - b.vol : a.num - b.num)
  const activeForeshadows = foreshadows.filter((fs) => fs.status === 'planted' || fs.status === 'progressing')
  const relatedForeshadows = foreshadows.filter(
    (fs) =>
      fs.planted_chapter === target.stem ||
      fs.expected_resolve === target.stem ||
      fs.resolved_chapter === target.stem,
  )
  const overdue = activeForeshadows.filter((fs) => {
    const key = typeof fs.expected_resolve === 'string' ? keyOf(fs.expected_resolve) : null
    return key !== null && targetKey !== null && cmp(key, targetKey) < 0
  })
  const soon = activeForeshadows.filter((fs) => {
    const key = typeof fs.expected_resolve === 'string' ? keyOf(fs.expected_resolve) : null
    if (key === null || targetKey === null) return false
    return key.vol === targetKey.vol && key.num > targetKey.num && key.num <= targetKey.num + 3
  })
  const body = String(target.body ?? '')
  const speakerCharacters = characters.filter((c) => (c.name !== '' && body.includes(c.name)) || (c.slug !== '' && body.includes(c.slug)))
  const chapterTimeline = timeline.filter((row) => row.chapter === target.stem)
  const chapterMemories = memories.filter((row) => row.source_chapter === target.stem)
  const neverSeen = characters.filter((c) => !chapters.some((ch) => String(ch.body ?? '').includes(c.name)))

  const payload = {
    ok: true,
    dir: root,
    chapter: { stem: target.stem, num: target.num, title: target.title, status: target.status, words: target.words },
    characters: speakerCharacters.map((c) => c.name),
    foreshadows: relatedForeshadows.map((fs) => ({ id: fs.id, title: fs.title, status: fs.status, planned: fs.expected_resolve })),
    overdue: overdue.map((fs) => ({ id: fs.id, title: fs.title, status: fs.status, planned: fs.expected_resolve })),
    soon: soon.map((fs) => ({ id: fs.id, title: fs.title, status: fs.status, planned: fs.expected_resolve })),
    timeline: chapterTimeline,
    memories: chapterMemories,
    gaps: {
      neverSeen: neverSeen.map((c) => c.name),
      activeForeshadows: activeForeshadows.length,
      relations: relations.length,
      timeline: timeline.length,
      memories: memories.length,
      chapters: chapters.length,
    },
  }
  if (asJson) {
    console.log(JSON.stringify(payload, null, 2))
    return
  }

  const lines = []
  lines.push('# 账目对账单 · ' + target.stem)
  lines.push('')
  lines.push('本章：第 ' + (target.num ?? '?') + ' 章《' + target.title + '》· 状态 ' + target.status + ' · ' + target.words + ' 字')
  lines.push('')
  lines.push('## 本章应落盘')
  lines.push('- 出场记录：' + (speakerCharacters.length > 0 ? speakerCharacters.map((c) => c.name).join('、') : '（未匹配到角色卡，请人工确认）'))
  if (relatedForeshadows.length > 0) {
    for (const fs of relatedForeshadows) {
      lines.push('- 伏笔 ' + fs.id + '《' + fs.title + '》：状态 ' + fs.status + '，计划回收 ' + (fs.expected_resolve || '未定') + '——按正文实际推进改状态并补 resolved_chapter')
    }
  } else {
    lines.push('- 伏笔：本章无登记条目（正文若埋了新的，补一条 planted）')
  }
  lines.push('- 未来 3 章到期：' + (soon.length === 0 ? '无' : soon.map((fs) => fs.id + '（计划 ' + fs.expected_resolve + '）').join('；')))
  lines.push('- 时间线：本章事件 ' + chapterTimeline.length + ' 条已登记' + (chapterTimeline.length === 0 ? '，需新增' : ''))
  lines.push('- 记忆：本章 source_chapter 条目 ' + chapterMemories.length + ' 条' + (chapterMemories.length === 0 ? '，需补 appearance / promise / event' : ''))
  lines.push('')
  lines.push('## 全局缺口')
  lines.push('- 超期伏笔：' + (overdue.length === 0 ? '无' : overdue.map((fs) => fs.id + '（计划 ' + fs.expected_resolve + '，仍 ' + fs.status + '）').join('；')))
  lines.push('- 从未出场角色卡：' + (neverSeen.length === 0 ? '无' : neverSeen.map((c) => c.name).join('、')))
  lines.push('- 活跃伏笔 ' + activeForeshadows.length + ' 条 / 时间线 ' + timeline.length + ' 条 / 记忆 ' + memories.length + ' 条 / 关系 ' + relations.length + ' 条 / 章节 ' + chapters.length + ' 章')
  console.log(lines.join(String.fromCharCode(10)))
}

// ── brief ───────────────────────────────────────────────────────────────────

/**
 * xiaoyu-novel brief [dir] <chapter> [--out <文件>]
 *
 * 组装某章写作卡（章纲 + 前章结尾 + 出场角色卡 + 活跃伏笔 + 本章状态），
 * 给作者带去任意编辑器/其他 AI。不带 --out 时写卡打到 stdout，提示与提醒
 * 走 stderr，重定向出去的就是干净的卡；带 --out 落盘。组装逻辑在
 * lib/novel-parse.mjs 的 buildBrief（与面板共用解析层）。
 */
function cmdBrief(args) {
  let dirArg = null
  let chapterArg = null
  let outArg = null
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--out') {
      const value = args[++i]
      if (value === undefined) fail('选项 --out 缺参数——--out 取输出文件路径')
      outArg = value
    } else if (arg.startsWith('--out=')) {
      outArg = arg.slice('--out='.length)
    } else if (arg.startsWith('-')) {
      fail(`未知选项「${arg}」——brief 只认 --out <文件>`)
    } else if (chapterArg !== null) {
      fail(`多余的位置参数「${arg}」——brief 只接受 [dir] <chapter> 两个位置参数`)
    } else if (dirArg === null) {
      dirArg = arg
    } else {
      chapterArg = arg
    }
  }
  if (dirArg === null && chapterArg === null) {
    fail('用法：xiaoyu-novel brief [dir] <chapter> [--out <文件>]——chapter 可写文件名（v01-c002.md）、stem（v01-c002）、「卷-章」（1-2）或裸章号（2）')
  }
  // 显式拒绝空串：`--out=` 经 path.resolve 会静默落成 cwd，属意外行为
  if (outArg !== null && outArg.trim() === '') fail('选项 --out 不能是空串——--out 取输出文件路径')
  // 只给一个位置参数时把它当章号用（dir 走默认 ./novel），这是常用路径
  const root = path.resolve(chapterArg === null ? 'novel' : dirArg)
  const brief = buildBrief(root, chapterArg ?? dirArg)
  if (!brief.ok) fail(brief.reason)
  for (const warning of brief.warnings) console.error(`提醒：${warning}`)
  if (outArg !== null) {
    const outPath = path.resolve(outArg)
    // 同名输出不静默覆盖：目标已存在时自动加序号 -2、-3……改写到新路径
    const target = dedupeWritePath(outPath)
    if (target.renamed) console.error(`提示：${outPath} 已存在，本次写作卡改写到 ${target.path}`)
    // 落盘点兜底：目录建不出 / 文件写不进（权限、只读盘等）报中文错，不甩英文栈
    try {
      mkdirSync(path.dirname(target.path), { recursive: true })
      writeFileSync(target.path, brief.text, 'utf8')
    } catch (error) {
      fail(`写入失败：${target.path}（${error.message}）`)
    }
    console.log(`写作卡已写入：${target.path}`)
    console.log('拿去写，写完丢回给主编收稿。')
  } else {
    process.stdout.write(brief.text)
    console.error('—— 写作卡到这儿为止。拿去写，写完丢回给主编收稿。')
  }
}


// ── wc ─────────────────────────────────────────────────────────────────────

/**
 * xiaoyu-novel wc [dir] <chapter> [--json]
 *
 * 一章的轻量自检（写手交稿前用，替代临时写 python 脚本）：去空白字数、
 * CJK 字数、感叹号（总/对话内/叙述）、引号配对、禁项（直角引号/方头括号）、
 * 长句（>45 字）、人味指数与硬伤维度。只读，不改任何文件。
 *
 * 设计动机（0.5.0）：上一轮写手在 17 分钟里对同一章发了 25 次临时 python
 * 扫描脚本。把口径收进 CLI 一份，agent 只调一条命令、只看结果。
 */
function cmdWc(args) {
  let dirArg = null
  let chapterArg = null
  let json = false
  for (const arg of args) {
    if (arg === '--json') json = true
    else if (arg.startsWith('-')) fail(`未知选项「${arg}」——wc 只认 --json`)
    else if (dirArg === null) dirArg = arg
    else if (chapterArg === null) chapterArg = arg
    else fail(`多余的位置参数「${arg}」——wc 只接受 [dir] <chapter>`)
  }
  if (dirArg === null) {
    fail('用法：xiaoyu-novel wc [dir] <chapter> [--json]——chapter 可写文件名（v01-c020.md）、stem（v01-c020）、「卷-章」（1-20）或裸章号（20）')
  }
  // 只给一个位置参数时当章号，dir 走默认 ./novel（与 brief 同款常用路径）
  const root = path.resolve(chapterArg === null ? 'novel' : dirArg)
  const ref = chapterArg ?? dirArg
  const chapters = collectChapters(root)
  if (chapters === null) fail(`找不到 ${path.join(root, 'chapters')}——先跑 xiaoyu-novel init`)
  const hit = chapters.find((c) => c.file === ref || c.stem === ref) ||
    (/^\d+$/.test(ref) ? chapters.find((c) => c.num === Number(ref)) : null) ||
    (/^\d+-\d+$/.test(ref) ? chapters.find((c) => {
      const m = /^(\d+)-(\d+)$/.exec(ref)
      return c.sortKey !== null && c.sortKey.vol === Number(m[1]) && c.sortKey.num === Number(m[2])
    }) : null)
  if (!hit) fail(`找不到章节「${ref}」——可写文件名、stem、「卷-章」或裸章号`)
  const text = readTextOrNull(path.join(root, 'chapters', hit.file)) ?? ''
  const { body } = splitFrontmatter(text)
  const chars = body.replace(/\s/g, '').length
  const cjk = countCjk(body)
  const exclaim = (body.match(/！/g) || []).length
  let dialogExclaim = 0
  for (const m of body.matchAll(/“[^”]*”|「[^」]*」/g)) dialogExclaim += (m[0].match(/！/g) || []).length
  const quoteOpen = (body.match(/“/g) || []).length
  const quoteClose = (body.match(/”/g) || []).length
  const cornerQuotes = (body.match(/[「」]/g) || []).length
  const squareBrackets = (body.match(/[【】]/g) || []).length
  const longSentences = body.split(/[。！？\n]/).filter((s) => s.trim().replace(/\s/g, '').length >= 45).length
  const analysis = analyzeChapter(text)
  const result = {
    file: hit.file,
    title: hit.title,
    num: hit.num,
    words: chars,
    cjk,
    exclamations: { total: exclaim, dialog: dialogExclaim, narrative: exclaim - dialogExclaim },
    quotes: { open: quoteOpen, close: quoteClose, paired: quoteOpen === quoteClose },
    banned: { cornerQuotes, squareBrackets },
    longSentences,
    human: analysis.score,
    hard: analysis.hard,
    status: hit.status,
  }
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return
  }
  const hardText = result.hard.length ? result.hard.join('、') : '无'
  console.log(`第${result.num ?? '?'}章《${result.title}》 ${result.file}（status: ${result.status}）`)
  console.log(`去空白字数 ${result.words}（CJK ${result.cjk}）`)
  console.log(`感叹号 ${result.exclamations.total}（对话 ${result.exclamations.dialog} / 叙述 ${result.exclamations.narrative}）`)
  console.log(`引号 ${result.quotes.open}/${result.quotes.close}${result.quotes.paired ? ' 配对' : ' 不配对！'}；直角引号 ${result.banned.cornerQuotes}，方头括号 ${result.banned.squareBrackets}`)
  console.log(`长句(>45字) ${result.longSentences} 处`)
  console.log(`人味指数 ${result.human}；硬伤维度：${hardText}`)
}

// ── check ───────────────────────────────────────────────────────────────────

/**
 * xiaoyu-novel check [dir]
 *
 * 静态体检：只查文件规范，不调模型（LLM 审校走主编）。检查逻辑在
 * lib/novel-parse.mjs 的 checkProject。有 error 退出码 1，只有 warn 退出码 0。
 */
function chapterBody(text) {
  if (!text.startsWith('---')) return text
  const end = text.indexOf('\n---', 3)
  return end === -1 ? text : text.slice(end + 4)
}

function cmdGate(rest) {
  let targetArg = null
  let failUnder = null
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]
    const m = /^--fail-under(?:=(.+))?$/.exec(arg)
    if (m) {
      const raw = m[1] !== undefined ? m[1] : rest[++i]
      const n = Number(raw)
      if (!Number.isFinite(n) || n <= 0 || n > 100) fail('--fail-under 需要一个 0-100 的数字')
      failUnder = n
      continue
    }
    if (arg.startsWith('-')) fail('未知选项「' + arg + '」——gate 只接受一个目录参数和 --fail-under')
    if (targetArg !== null) fail('多余的位置参数「' + arg + '」——gate 只接受一个目录参数')
    targetArg = arg
  }
  const dir = path.resolve(targetArg ?? 'novel')
  const chaptersDir = path.join(dir, 'chapters')
  if (!existsSync(chaptersDir)) fail('找不到 ' + path.join(dir, 'chapters') + '——请确认给的是 novel/ 目录')
  const files = readdirSync(chaptersDir).filter((name) => name.endsWith('.md')).sort()
  if (files.length === 0) { console.log('chapters/ 下没有章节。'); return }
  const rows = files.map((file) => {
    const text = readTextOrNull(path.join(chaptersDir, file)) ?? ''
    const result = analyzeChapter(chapterBody(text))
    return {
      file,
      words: result.meta?.chars ?? 0,
      human: result.score,
      detector: result.detector.score,
      hard: result.hard,
      hook: result.hook ?? null,
    }
  })
  rows.sort((a, b) => a.human - b.human)
  console.log('门禁：' + dir + '（人味指数 / 人写度，按分数升序）')
  for (const row of rows) {
    const hard = row.hard.length ? '\t硬伤: ' + row.hard.join(' / ') : ''
    const hook = row.hook && row.hook.ok === false ? '\t章末平收' : ''
    console.log(row.file + '\t' + row.human + '\t' + row.detector + hard + hook)
  }
  const passMark = readProjectPassMark(dir)
  const avg = rows.reduce((sum, row) => sum + row.human, 0) / rows.length
  const low = rows.filter((row) => row.human < passMark).length
  recordProgress(dir, rows.reduce((sum, row) => sum + row.words, 0))
  console.log('平均人味指数 ' + avg.toFixed(1) + '；低于 ' + passMark + ' 的章节 ' + low + ' 章。')
  console.log('门禁线：' + passMark + (failUnder !== null ? '（本次 --fail-under ' + failUnder + '）' : '（可在 novel/xiaoyu.json 配 gate.passMark）'))
  if (failUnder !== null) {
    const bad = rows.filter((row) => row.human < failUnder)
    if (bad.length > 0) {
      console.error('门禁未过：' + bad.length + ' 章低于 ' + failUnder + '（' + bad.map((row) => row.file).join('、') + '）')
      process.exit(1)
    }
    console.log('门禁通过：全部章节人味指数 ≥ ' + failUnder + '。')
  }
}

// ── report ──────────────────────────────────────────────────────────────────

/** 病灶计数：按命中词汇总，返回 [hit, count] 降序（报告「高频病灶」节用）。 */
function tallyFlags(rows) {
  const map = new Map()
  for (const row of rows) {
    for (const f of row.flags || []) {
      const key = String(f.hit || '').replace(/\s+/g, ' ')
      if (key === '') continue
      map.set(key, (map.get(key) || 0) + 1)
    }
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
}

/**
 * xiaoyu-novel report [dir] [--out <文件>]
 *
 * 全书质检报告（markdown）：逐章人味/人写/章末钩子/硬伤 + 高频病灶 +
 * 优先返修清单。只读不写盘（给 --out 才落文件），人工返修与给模型下指令
 * 都用得上。
 */
function cmdReport(rest) {
  let targetArg = null
  let outArg = null
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]
    if (arg === '--out') { outArg = rest[++i] ?? ''; continue }
    if (arg.startsWith('--out=')) { outArg = arg.slice(6); continue }
    if (arg.startsWith('-')) fail('未知选项「' + arg + '」——report 只接受一个目录参数和 --out')
    if (targetArg !== null) fail('多余的位置参数「' + arg + '」——report 只接受一个目录参数')
    targetArg = arg
  }
  if (outArg !== null && outArg.trim() === '') fail('--out 不能是空串')
  const root = path.resolve(targetArg ?? 'novel')
  const chaptersDir = path.join(root, 'chapters')
  if (!existsSync(chaptersDir)) fail('找不到 ' + chaptersDir + '——请确认给的是 novel/ 目录')
  const files = readdirSync(chaptersDir).filter((name) => name.endsWith('.md')).sort()
  if (files.length === 0) fail('chapters/ 下没有章节，没有可报告的')
  const project = parseSimpleYaml(readTextOrNull(path.join(root, 'project.yml')))
  const title = project && typeof project.title === 'string' && project.title !== '' ? project.title : path.basename(root)
  const rows = files.map((file) => {
    const body = chapterBody(readTextOrNull(path.join(chaptersDir, file)) ?? '')
    const result = analyzeChapter(body)
    return {
      file,
      words: (body.match(/[\u4e00-\u9fa5]/g) || []).length,
      human: result.score,
      detector: result.detector.score,
      hard: result.hard,
      flags: result.flags,
      hook: result.hook ?? null,
    }
  })
  const totalWords = rows.reduce((sum, row) => sum + row.words, 0)
  const avg = rows.reduce((sum, row) => sum + row.human, 0) / rows.length
  const avgDet = rows.reduce((sum, row) => sum + row.detector, 0) / rows.length
  const low = rows.filter((row) => row.human < 78)
  const plainEnd = rows.filter((row) => row.hook && row.hook.ok === false)
  const lines = []
  lines.push('# ' + title + ' · 质检报告')
  lines.push('')
  lines.push('- 生成时间：' + new Date().toISOString().slice(0, 19).replace('T', ' '))
  lines.push('- 章节：' + rows.length + ' 章 / ' + totalWords + ' 字')
  lines.push('- 平均人味指数：' + avg.toFixed(1) + '（线 78）')
  lines.push('- 平均人写度：' + avgDet.toFixed(1))
  lines.push('- 未过线：' + low.length + ' 章；章末平收：' + plainEnd.length + ' 章')
  lines.push('')
  lines.push('## 逐章')
  lines.push('')
  lines.push('| 章节 | 字数 | 人味 | 人写 | 章末 | 主要硬伤 |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const row of rows) {
    const hook = row.hook ? (row.hook.ok ? row.hook.kind : '平收') : '—'
    lines.push('| ' + row.file + ' | ' + row.words + ' | ' + row.human + ' | ' + row.detector + ' | ' + hook + ' | ' + (row.hard.join(' / ') || '—') + ' |')
  }
  lines.push('')
  const tally = tallyFlags(rows)
  if (tally.length) {
    lines.push('## 高频病灶')
    lines.push('')
    for (const [hit, n] of tally) lines.push('- 「' + hit + '」 × ' + n)
    lines.push('')
  }
  const worst = rows.slice().sort((a, b) => a.human - b.human).slice(0, 8)
  lines.push('## 优先返修')
  lines.push('')
  for (let i = 0; i < worst.length; i += 1) {
    const row = worst[i]
    const why = row.hard.length ? '硬伤：' + row.hard.join(' / ') : '病灶集中，建议整章过一遍'
    lines.push((i + 1) + '. ' + row.file + '（人味 ' + row.human + '）—— ' + why)
  }
  lines.push('')
  const text = lines.join('\n')
  if (outArg === null) { process.stdout.write(text); return }
  const out = path.resolve(outArg)
  try {
    mkdirSync(path.dirname(out), { recursive: true })
    writeFileSync(out, text, 'utf8')
  } catch (error) {
    fail('写入失败：' + out + '（' + error.message + '）')
  }
  console.log('质检报告已写入：' + out)
}

function cmdCheck(targetArg) {
  const root = path.resolve(targetArg ?? 'novel')
  const result = checkProject(root)
  // 格式硬校验并进同一份问题清单（键名/键序/围栏/文件名/索引一致性）。
  const format = checkFormat(root)
  const seen = new Set(result.problems.map((p) => p.level + '|' + p.file + '|' + p.message))
  for (const p of format.problems) {
    const key = p.level + '|' + p.file + '|' + p.message
    if (seen.has(key)) continue
    seen.add(key)
    result.problems.push(p)
  }
  result.summary.problems = result.problems.reduce((acc, p) => { acc[p.level] = (acc[p.level] || 0) + 1; return acc }, { error: 0, warn: 0 })
  result.ok = result.problems.every((p) => p.level !== 'error')
  console.log(`静态体检：${root}（只查文件规范，不调模型）`)
  if (result.problems.length === 0) {
    console.log('未发现问题。')
  } else {
    for (const p of result.problems) {
      console.log(`${p.level === 'error' ? '[错误]' : '[提醒]'} ${p.file}：${p.message}`)
    }
  }
  const { chapters, outlines, foreshadows, problems } = result.summary
  console.log(`汇总：${chapters} 章、${outlines} 章纲、${foreshadows} 条伏笔；错误 ${problems.error} 个，提醒 ${problems.warn} 个。`)
  if (!result.ok) process.exit(1)
}

// ── audit / undo / progress（0.4.0）────────────────────────────────────────

function readProjectPassMark(root) {
  try {
    const raw = JSON.parse(readFileSync(path.join(root, 'xiaoyu.json'), 'utf8'))
    const n = Number(raw?.gate?.passMark)
    if (Number.isInteger(n) && n >= 50 && n <= 100) return n
  } catch { /* 无配置：默认线 */ }
  return 78
}

function progressFile() {
  const home = process.env.DSH_HOME || path.join(process.env.HOME || '.', '.dsh')
  return path.join(home, 'xiaoyu-progress.json')
}

function recordProgress(root, words) {
  const n = Number(words)
  if (!Number.isFinite(n) || n <= 0) return
  try {
    let all = {}
    try { all = JSON.parse(readFileSync(progressFile(), 'utf8')) || {} } catch { all = {} }
    const d = new Date()
    const pad = (x) => String(x).padStart(2, '0')
    const day = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    const book = all[root] || (all[bookKey(root)] = {})
    book[day] = Math.max(Number(book[day]) || 0, Math.round(n))
    mkdirSync(path.dirname(progressFile()), { recursive: true })
    writeFileSync(progressFile(), JSON.stringify(all), 'utf8')
  } catch { /* 记账失败不影响命令 */ }
}

function bookKey(root) { return root }

/** xiaoyu-novel audit [dir] [--json] [--out <文件>]：全书体检。 */
function cmdAudit(rest) {
  let targetArg = null
  let outArg = null
  let jsonMode = false
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]
    if (arg === '--json') { jsonMode = true; continue }
    if (arg === '--out') { outArg = rest[++i] ?? ''; continue }
    if (arg.startsWith('--out=')) { outArg = arg.slice(6); continue }
    if (arg.startsWith('-')) fail('未知选项「' + arg + '」——audit 只接受一个目录参数、--json、--out')
    if (targetArg !== null) fail('多余的位置参数「' + arg + '」——audit 只接受一个目录参数')
    targetArg = arg
  }
  if (outArg !== null && outArg.trim() === '') fail('--out 不能是空串')
  const root = path.resolve(targetArg ?? 'novel')
  if (!existsSync(path.join(root, 'chapters'))) fail('找不到 ' + path.join(root, 'chapters') + '——请确认给的是 novel/ 目录')
  const audit = auditProject(root)
  recordProgress(root, audit.totals.words)
  const project = parseSimpleYaml(readTextOrNull(path.join(root, 'project.yml')))
  const title = project && typeof project.title === 'string' && project.title !== '' ? project.title : path.basename(root)
  const text = jsonMode ? JSON.stringify(audit, null, 2) : auditMarkdown(audit, title)
  if (outArg === null) { process.stdout.write(text + (jsonMode ? '\n' : '')); return }
  const out = path.resolve(outArg)
  try {
    mkdirSync(path.dirname(out), { recursive: true })
    writeFileSync(out, text, 'utf8')
  } catch (error) {
    fail('写入失败：' + out + '（' + error.message + '）')
  }
  console.log('体检报告已写入：' + out)
}

/** xiaoyu-novel undo [dir] [chapter]：撤销最近一次自动修（面板/CLI 的整章修、逐句改）。 */
function cmdUndo(rest) {
  let targetArg = null
  let chapterArg = null
  for (const arg of rest) {
    if (arg.startsWith('-')) fail('未知选项「' + arg + '」——undo 只接受一个目录参数和一个章节名')
    if (targetArg === null) targetArg = arg
    else if (chapterArg === null) chapterArg = arg
    else fail('多余的位置参数「' + arg + '」')
  }
  const root = path.resolve(targetArg ?? 'novel')
  const undoDir = path.join(root, '.xiaoyu', 'undo')
  if (!existsSync(undoDir)) fail('没有历史自动修记录（' + undoDir + ' 不存在）')
  const all = readdirSync(undoDir)
  let picks = []
  if (chapterArg !== null) {
    const safe = path.basename(chapterArg).replace(/\.md$/i, '') + '.md'
    picks = all.filter((name) => name.startsWith(safe + '.') && name.endsWith('.bak')).sort()
  } else {
    picks = all.filter((name) => name.endsWith('.bak')).sort()
  }
  if (picks.length === 0) fail('没有可撤销的记录')
  const name = picks[picks.length - 1]
  const file = name.slice(0, name.indexOf('.md.') + 3)
  const backup = readFileSync(path.join(undoDir, name), 'utf8')
  const target = path.join(root, 'chapters', file)
  if (!existsSync(target)) fail('章节不存在：' + target)
  const before = analyzeChapter(stripFrontmatter(readFileSync(target, 'utf8')))
  const after = analyzeChapter(stripFrontmatter(backup))
  writeFileSync(target, backup, 'utf8')
  unlinkSync(path.join(undoDir, name))
  console.log('已撤销：' + file + '（快照 ' + name + '）')
  console.log('人味 ' + before.score + ' → ' + after.score + '；人写 ' + before.detector.score + ' → ' + after.detector.score)
}

/** xiaoyu-novel progress [dir]：最近 30 天写作进度。 */
function cmdProgress(rest) {
  let targetArg = null
  for (const arg of rest) {
    if (arg.startsWith('-')) fail('未知选项「' + arg + '」——progress 只接受一个目录参数')
    if (targetArg !== null) fail('多余的位置参数「' + arg + '」')
    targetArg = arg
  }
  const root = path.resolve(targetArg ?? 'novel')
  let all = {}
  try { all = JSON.parse(readFileSync(progressFile(), 'utf8')) || {} } catch { all = {} }
  const book = all[root] || {}
  const days = Object.keys(book).sort().slice(-30)
  if (days.length === 0) {
    console.log('还没有进度记录：打开一次创作台（面板/门禁/体检命令）就会开始按天记账。')
    return
  }
  console.log('写作进度：' + root)
  for (const day of days) console.log('  ' + day + '  ' + book[day] + ' 字')
  const d = new Date()
  const pad = (x) => String(x).padStart(2, '0')
  const today = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  const t = book[today]
  const prev = days.filter((x) => x !== today).pop()
  if (typeof t === 'number' && typeof prev === 'string') {
    console.log('今日 ' + t + ' 字；较 ' + prev + ' 新增 ' + (t - book[prev]) + ' 字。')
  }
}

// ── setup ──────────────────────────────────────────────────────────────────

/** xiaoyu-novel setup [dir]：开书九件套检查（缺项退出码 1）。 */
function cmdSetup(rest) {
  let targetArg = null
  for (const arg of rest) {
    if (arg.startsWith('-')) fail('未知选项「' + arg + '」——setup 只接受一个目录参数')
    if (targetArg !== null) fail('多余的位置参数「' + arg + '」')
    targetArg = arg
  }
  const root = path.resolve(targetArg ?? 'novel')
  if (!existsSync(path.join(root, 'chapters'))) fail('找不到 ' + path.join(root, 'chapters') + '——请确认给的是 novel/ 目录')
  const result = checkSetup(root)
  console.log('开书九件套：' + root)
  console.log(setupText(result))
  if (!result.complete) process.exit(1)
}

// ── 入口 ────────────────────────────────────────────────────────────────────

const HELP_TEXT = `小鱼（xiaoyu）—— 网文创作项目 CLI

用法：
  xiaoyu-novel init [dir]     生成 novel/ 脚手架（默认 ./novel；已存在的文件一律跳过，绝不覆盖）
  xiaoyu-novel stats [dir]    逐章字数（CJK 计数）、状态分布、当前阶段
  xiaoyu-novel index [dir]    从 volumes.yml + chapters/ 重建 index.yml（派生文件）
  xiaoyu-novel export [dir]   导出：--format md|txt|epub|docx（默认 md），--out <目录> 改输出位置
  xiaoyu-novel export --chapters 1,3,5-7 --format docx   只导出勾选的章节（TXT / Word）
  xiaoyu-novel brief [dir] <chapter>
                         组装某章写作卡（章纲+前章结尾+出场角色卡+活跃伏笔）；--out <文件> 落盘，缺省打到 stdout
  xiaoyu-novel wc [dir] <chapter> [--json]
                         一章轻量自检：去空白字数/CJK/感叹号/引号配对/禁项/长句/人味指数与硬伤（写手交稿前用，只读）
  xiaoyu-novel ledger [dir]  五本账对账单：本章应落盘（出场/伏笔/时间线/记忆）+ 全局缺口
  xiaoyu-novel check [dir]    静态体检（不调模型）：frontmatter 完整性、枚举值、章号卷号一致、伏笔章号引用、伏笔超期、章纲钩子、时间线年份、关系卡引用、AI 味统计、phase 阶段就绪判据
  xiaoyu-novel gate [dir] [--fail-under N]
                         门禁分：逐章人味指数 / 人写度/ 章末钩子，按低分排序；给 --fail-under 时有未过线章节退出码 1（可接 pre-commit）
  xiaoyu-novel report [dir] [--out <文件>]
                         全书质检报告（markdown）：逐章分数、章末钩子、高频病灶、优先返修清单
  xiaoyu-novel audit [dir] [--json] [--out <文件>]
                         全书体检：跨章重复片段、角色出场/最近出场、章纲点名未落地、字数离群、连续平收
  xiaoyu-novel undo [dir] [章节]
                         撤销最近一次自动修（逐句改/整章改都会先留快照，每章保留 10 份）
  xiaoyu-novel progress [dir]  最近 30 天写作进度（每日总字数；今日新增对比上一记录日）
  xiaoyu-novel setup [dir]     开书九件套检查：概览/章节/角色/伏笔/关系/时间线/设定/风格/索引逐项 ✓/缺（缺项退出码 1）
  xiaoyu-novel token [check]                   体检内嵌凭据：能读什么、能不能写
  xiaoyu-novel token set <PAT> [--force]       更换内嵌凭据（先体检，最小权限才推荐）
  xiaoyu-novel update [--check] [--apply] [--json]
                         从作者 GitHub 私有库查最新版本；--apply 下载该 tag 源码包、
                         校验包名与版本、整目录备份后覆盖插件目录（装完重启 DSH）
  xiaoyu-novel portable export <包路径> [--home <DSH_HOME>] [--profile web] [--no-secrets]
                         把整台机器的 DSH 个性打成一个文件（patch/预设/技能/工作区/渠道 key）：
                         换手机、换电脑时解开就是这台机器，助手名字和面板不会再变
  xiaoyu-novel portable import <包路径> [--home <DSH_HOME>] [--dry-run]
                         还原搬迁包（目标已存在的文件先备份成 .bak-portable-<时间戳>）
  xiaoyu-novel portable show <包路径>
                         只看包里有什么、来自哪台机器、该怎么还原（不写盘）
  xiaoyu-novel doctor [--home <DSH_HOME>] [--profile web] [--json] [--fix]
                         换设备后「助手名字变了/面板打不开/新建对话不是小鱼」逐条查：
                         预设源文件、两层 patch 托管块、默认预设被谁抢、预设切换器是否被藏、
                         方法论技能、工作区列表；--fix 就地改回（改前备份）
  xiaoyu-novel clean [dir] [--apply] [--undo] [--json]
                         清账本：超长条目压成结论（明细移到 archive/ledger-details/）、
                         大账本按章归档到 archive/、已写【推进章】的超期伏笔升 progressing、
                         index.yml 条数不一致自动重建；默认 dry-run，写前备份，可撤销

说明：
  novel/ 目录的数据规范见 templates/novel/README.md（或项目内 novel/README.md）。
  export 输出目录默认 <dir>/exports/，文件名 <书名>-<YYYYMMDD>.<扩展名>。
  brief / wc 的 chapter 可写文件名（v01-c002.md）、stem（v01-c002）、「卷-章」（1-2）或裸章号（2）。
  check 有 error 退出码 1，只有 warn 退出码 0。
  所有命令零依赖，任意 cwd 可用；出错时退出码 1。`

/** 只接受一个可选目录参数的子命令（目录参数不以 `-` 开头；--help/-h 由 main 先拦）。 */
const SINGLE_DIR_COMMANDS = ['init', 'stats', 'index', 'check', 'gate', 'report', 'audit', 'undo', 'progress', 'setup', 'ledger']

/**
 * 单参命令的目录参数防线：至多一个位置参数，且不以 `-` 开头——以前
 * `xiaoyu-novel init --help` 把 --help 当目录名，静默建出 ./--help/。--help/-h 由
 * main 在派发前拦截显示帮助；其余 `-` 开头参数报未知选项，多余位置参数报错
 * （对照 export 的同款防线）。
 */
function singleDirTarget(command, rest) {
  let target = null
  for (const arg of rest) {
    if (arg.startsWith('-')) fail(`未知选项「${arg}」——${command} 只接受一个可选目录参数`)
    if (target !== null) fail(`多余的位置参数「${arg}」——${command} 只接受一个目录参数`)
    target = arg
  }
  return target
}

/** 交接卡（0.10.0）：写手开新章前拿一张卡就够，不必通读五本账。只读。 */
function cmdHandoff(rest) {
  let dirArg = null
  let chapterRef = null
  let out = null
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === "--out") { out = rest[++i]; if (out === undefined) fail("--out 缺文件名") ; continue }
    if (arg.startsWith("-")) fail("未知选项「" + arg + "」——handoff 只认 --out 与两个位置参数")
    if (chapterRef === null && (/^\d+$/.test(arg) || /^v\d+-c\d+/i.test(arg) || /\.md$/i.test(arg))) { chapterRef = arg; continue }
    if (dirArg === null) { dirArg = arg; continue }
    fail("多余的位置参数「" + arg + "」——用法：xiaoyu-novel handoff [dir] <chapter>")
  }
  if (chapterRef === null) fail("用法：xiaoyu-novel handoff [dir] <chapter>——章号或文件名，如 23 / v01-c023")
  const root = path.resolve(dirArg ?? "novel")
  const chapters = collectChapters(root)
  if (chapters === null) fail("找不到 " + path.join(root, "chapters") + "——先跑 xiaoyu-novel init " + root)
  const ref = chapterRef.replace(/\.md$/i, "")
  const picked = chapters.find((c) => c.stem === ref || c.file === chapterRef || String(c.num) === ref)
  if (!picked) fail("找不到章节「" + chapterRef + "」——章号或 vXX-cXXX 都行")
  const model = buildHandoff(root, picked.file)
  const text = renderHandoff(model)
  if (out) {
    writeFileSync(out, text, "utf8")
    console.log("已写入 " + out + "（" + text.length + " 字符）")
    return
  }
  console.log(text)
}

/**
 * 清账本（0.16.0）：把超长账本条目压成结论（明细外置到
 * archive/ledger-details/），并把已写【推进章】的超期伏笔升为 progressing——
 * 就是面板「静态体检」黄条上那个「清账本」按钮的 CLI 版。默认 dry-run。
 */
export function formatCleanPlan(plan) {
  const lines = []
  for (const item of plan.files) {
    const parts = []
    if (item.trimmed.length > 0) parts.push(item.trimmed.length + ' 条超长')
    if (item.archive) parts.push(item.archive.moved + ' 条归档 → ' + item.archive.archiveFile)
    if (item.archiveBlocked) parts.push('整本会搬空，跳过归档')
    if (item.advanced.length > 0) parts.push(item.advanced.length + ' 条伏笔升推进')
    if (item.skipped.length > 0) parts.push(item.skipped.length + ' 条留人工')
    // sane 只在计划里有；apply 回传的「已写」条目天然是校验过的（sane !== false 即过）
    if (parts.length > 0) lines.push('  ' + item.file + '  ' + parts.join(' · ') + (item.sane === false ? '  ← 校验不过，跳过' : ''))
  }
  if (plan.indexStale === true) lines.push('  index.yml  与 chapters/ 条数不一致 → 重建索引')
  if (plan.indexRebuilt === true) lines.push('  index.yml  已按 chapters/ 重建')
  return lines.join('\n')
}

/**
 * 更新自己（0.18.0）：走作者自己的 GitHub 私有库。默认只查（--check 同义），
 * --apply 才真装。装完要重启 DSH——运行中的进程仍是旧代码。
 */
async function cmdUpdate(rest) {
  let apply = false
  let asJson = false
  for (const arg of rest) {
    if (arg === '--apply' || arg === '-y') { apply = true; continue }
    if (arg === '--check' || arg === '--dry-run') { apply = false; continue }
    if (arg === '--json') { asJson = true; continue }
    if (arg.startsWith('-')) fail('未知选项「' + arg + '」——update 只认 --check / --apply / --json')
    fail('多余的位置参数「' + arg + '」——update 不接受目录参数')
  }
  const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const pkg = JSON.parse(readFileSync(path.join(pluginRoot, 'package.json'), 'utf8'))
  const repo = resolveGithubRepo(pkg, process.env)
  if (repo === '') fail('没配 GitHub 仓库：在 package.json 的 dsh.githubRepo 或 repository.url 写 owner/repo（或设 XIAOYU_GITHUB_REPO）')
  const { version: current } = await currentVersion()
  const hit = await fetchLatestGithubVersion({ repo, token: resolveGithubToken(process.env).token, pinnedRepo: repo })
  if (!hit.ok) fail(String(hit.error || '查不到最新版本'))
  const behind = compareVersions(current, hit.tag) < 0
  if (asJson) {
    console.log(JSON.stringify({ current, latest: hit.tag, repo, updateAvailable: behind, source: hit.source }, null, 2))
    if (!apply) return
  } else {
    console.log('仓库：' + repo + '（版本源 ' + hit.source + '）')
    console.log('本地：' + current + '　线上：' + hit.tag)
    if (!behind) { console.log('已是最新。'); return }
  }
  if (!apply) {
    console.log('')
    console.log('有新版可装：xiaoyu-novel update --apply（装完重启 DSH 生效）')
    return
  }
  const out = await applyGithubUpdate({
    repo,
    tag: hit.tag,
    pluginRoot,
    backupRoot: path.join(path.dirname(pluginRoot), '.backup'),
    token: resolveGithubToken(process.env).token,
    pinnedRepo: repo,
  })
  if (!out.ok) fail('更新失败（' + out.kind + '）：' + String(out.error || '未知错误'))
  console.log('已更新 ' + out.from + ' → ' + out.to + '（' + out.tag + '）')
  console.log('备份：' + out.backupDir)
  console.log('重启 DeepSeek Harness 后生效。')
}

/**
 * 内嵌凭据的体检与更换（0.20.0）。
 *   xiaoyu-novel token check                     体检当前凭据（能读什么/能写什么）
 *   xiaoyu-novel token set <PAT>                 换成新凭据（先体检后写入）
 *   xiaoyu-novel token set <PAT> --force         跳过体检（离线/网络不通时）
 */
async function cmdToken(rest) {
  const sub = rest[0]
  const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const pkg = JSON.parse(readFileSync(path.join(pluginRoot, 'package.json'), 'utf8'))
  const repo = resolveGithubRepo(pkg, process.env)
  if (repo === '') fail('没配 GitHub 仓库（package.json 的 dsh.githubRepo）')
  const modulePath = path.join(pluginRoot, 'lib', 'github-token.mjs')
  if (sub === 'check' || sub === undefined) {
    const { token, source } = resolveGithubToken(process.env)
    if (token === '') fail('当前没有任何可用凭据：设 GITHUB_TOKEN，或先 token set <PAT>')
    console.log('凭据来源：' + source + '（' + (source === 'env' ? '环境变量' : '内嵌 lib/github-token.mjs') + '）')
    console.log('目标仓库：' + repo)
    console.log('')
    const result = await inspectToken({ token, repo })
    console.log(describeInspection(result))
    return
  }
  if (sub === 'set') {
    const token = String(rest[1] || '').trim()
    const force = rest.indexOf('--force') !== -1
    if (token === '') fail('用法：xiaoyu-novel token set <PAT>（在 GitHub → Settings → Developer settings → Fine-grained tokens 生成）')
    if (!force) {
      console.log('先体检这个新凭据……')
      const result = await inspectToken({ token, repo })
      console.log(describeInspection(result))
      if (!result.ok) fail('体检没通过，没写入。（确认网络后可加 --force 跳过体检）')
      if (result.canWriteTarget || result.canReadOther) {
        console.log('')
        console.log('注意：这个凭据权限比目标大（可写或能读别的库），仍按最小权限设计建议换一个。')
        console.log('继续写入……（Ctrl+C 可在 5 秒内取消）')
        await new Promise((resolve) => setTimeout(resolve, 5000))
      }
    }
    const written = await writeEmbeddedToken(modulePath, token)
    if (!written.ok) fail('写入失败：' + written.error)
    console.log('已写入 ' + written.path + '（' + written.parts + ' 块，原文件存为 ' + written.backup + '）')
    console.log('重启 DSH 后生效。')
    return
  }
  fail('未知子命令「' + sub + '」——token 只认 check / set <PAT> [--force]')
}

function cmdClean(rest) {
  let dirArg = null
  let apply = false
  let undo = false
  let asJson = false
  for (const arg of rest) {
    if (arg === '--apply') { apply = true; continue }
    if (arg === '--undo') { undo = true; continue }
    if (arg === '--json') { asJson = true; continue }
    if (arg.startsWith('-')) fail('未知选项「' + arg + '」——clean 只认 --apply / --undo / --json')
    if (dirArg === null) { dirArg = arg; continue }
    fail('多余的位置参数「' + arg + '」——clean 只接受一个项目目录')
  }
  const root = path.resolve(dirArg ?? 'novel')
  if (undo) {
    const out = undoLedgerClean(root)
    console.log('已撤销 ' + out.at + ' 的清账：还原 ' + out.restored.join('、') + '；删除明细 ' + out.removedDetails.length + ' 个')
    return
  }
  if (apply) {
    const out = applyLedgerClean(root)
    if (!out.changed) { console.log('账本没有需要清理的条目（超长 0 / 超期 0）'); return }
    console.log('已清账本：' + root)
    console.log(formatCleanPlan({ files: out.files, indexRebuilt: out.indexRebuilt }))
    // 以实际写入的条目数为准（计划里 sane=false 的账本整本没动）
    const trimmed = out.files.reduce((n, item) => n + item.trimmed.length, 0)
    const advanced = out.files.reduce((n, item) => n + item.advanced.length, 0)
    const archived = out.files.reduce((n, item) => n + (item.archive === null || item.archive === undefined ? 0 : item.archive.moved), 0)
    console.log('压缩 ' + trimmed + ' 条（省 ' + out.charsRemoved + ' 字）· 归档 ' + archived + ' 条 · 升级伏笔 ' + advanced + ' 条' + (out.indexRebuilt ? ' · 重建索引' : ''))
    console.log('明细：' + path.join(out.detailDir, '...') + '；备份：' + out.backupDir + '（撤销：xiaoyu-novel clean --undo）')
    return
  }
  const plan = planLedgerClean(root)
  if (asJson) { console.log(JSON.stringify(describePlan(plan), null, 2)); return }
  if (plan.trimmedTotal === 0 && plan.advancedTotal === 0) { console.log('账本没有需要清理的条目（超长 0 / 超期 0）'); return }
  console.log('清账本（dry-run，加 --apply 才写）：' + root)
  console.log(formatCleanPlan(plan))
  console.log('将压缩 ' + plan.trimmedTotal + ' 条（省 ' + plan.charsRemoved + ' 字）· 归档 ' + plan.archivedTotal + ' 条 · 升级伏笔 ' + plan.advancedTotal + ' 条' + (plan.indexStale ? ' · 重建索引' : ''))
}
/**
 * 账本瘦身体检 + 按卷归档（0.10.0 / 0.11.0）。
 * 默认只读报告；--archive --before vXX 出归档计划（dry-run），加 --apply 才写。
 */
function cmdSlim(rest) {
  let dirArg = null
  let asJson = false
  let top = 10
  let archive = false
  let before = null
  let apply = false
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === "--json") { asJson = true; continue }
    if (arg === "--archive") { archive = true; continue }
    if (arg === "--apply") { apply = true; continue }
    if (arg === "--before") { before = rest[++i]; if (before === undefined) fail("--before 缺卷号，如 v02") ; continue }
    if (arg === "--top") { top = Math.max(1, Number(rest[++i]) || 10); continue }
    if (arg.startsWith("-")) fail("未知选项「" + arg + "」——slim 只认 --json / --top N / --archive / --before / --apply")
    if (dirArg === null) { dirArg = arg; continue }
    fail("多余的位置参数「" + arg + "」——slim 只接受一个项目目录")
  }
  const root = path.resolve(dirArg ?? "novel")
  if (archive) {
    if (before === null) fail("--archive 需要 --before <卷>，如 --before v02（把该卷之前的条目搬进 archive/）")
    const plan = archivePlan(root, before)
    const rows = plan.plan.filter(function (x) { return x.move > 0 })
    const blocked = plan.plan.filter(function (x) { return x.move > 0 && x.blocked })
    if (rows.length === 0) { console.log("没有可归档的条目：" + plan.before + " 之前没有带章号的条目") ; return }
    console.log((apply ? "归档" : "将归档（dry-run，加 --apply 才写）：") + plan.before + " 之前")
    for (const row of rows) {
      console.log("  " + row.file + " → " + row.archiveFile + "  " + row.move + " 条（主账保留 " + row.keep + " 条）" + (row.blocked ? "  ← 会搬空主账，已跳过" : ""))
    }
    if (blocked.length === rows.length) { console.log(""); console.log("这些账本全被搬走会让主账变空——当前还在这一卷，先别归档。") ; return }
    if (!apply) { console.log(""); console.log("确认无误后加 --apply 执行；主账会先留 .bak。") ; return }
    const done = archiveApply(root, before)
    console.log("")
    console.log("已归档 " + done.moved + " 条：")
    for (const w of done.written) {
      console.log("  " + w.file + " → " + w.archiveFile)
    }
    return
  }
  const report = slimReport(root, top)
  if (asJson) { console.log(JSON.stringify(report, null, 2)); return }
  console.log("账本体检：" + root)
  for (const f of report.files) {
    const kb = Math.round(f.bytes / 1024)
    console.log("  " + f.file + "  " + kb + "KB" + (kb >= 200 ? "  ← 偏大，考虑按卷归档（--archive --before vXX）" : ""))
  }
  console.log("")
  console.log("最长条目（前 " + top + "）：")
  if (report.longest.length === 0) console.log("  （没有超过 300 字的条目）")
  for (const row of report.longest) console.log("  " + row.file + " #" + (row.index + 1) + "  " + row.chars + " 字  " + row.head)
  console.log("")
  console.log("合计 " + report.totalKB + "KB；超长条目 " + report.overCount + " 条。本命令只读，不写任何文件。")
}

/** slim 的实现：文件体积 + 每条最长字段（description/notes/content）的字数。 */
function slimReport(root, top) {
  const files = []
  const longest = []
  const targets = ["memories.yml", "timeline.yml", "clue-board.yml", "relations.yml", "foreshadows.yml", "volumes.yml", "decisions.yml"]
  let total = 0
  let overCount = 0
  for (const name of targets) {
    const text = readTextOrNull(path.join(root, name))
    if (text === null) continue
    const bytes = Buffer.byteLength(text, "utf8")
    total += bytes
    files.push({ file: name, bytes })
    const entries = parseSimpleYaml(text) ?? []
    if (!Array.isArray(entries)) continue
    entries.forEach((entry, index) => {
      if (entry === null || typeof entry !== "object") return
      let best = 0
      let field = ""
      for (const key of ["description", "notes", "content", "summary", "title"]) {
        const value = typeof entry[key] === "string" ? entry[key] : ""
        if (value.length > best) { best = value.length; field = key }
      }
      if (best >= 300) {
        overCount += 1
        longest.push({ file: name, index, chars: best, field, head: String(entry[field] ?? "").slice(0, 40).replace(/\s+/g, " ") })
      }
    })
  }
  longest.sort((a, b) => b.chars - a.chars)
  files.sort((a, b) => b.bytes - a.bytes)
  return { ok: true, root, files, longest: longest.slice(0, top), overCount, totalKB: Math.round(total / 1024) }
}
/**
 * 全书一次性检索（0.13.0）：一条命令给全命中与总数，替掉「多次 grep」这个
 * 绕圈来源。只读，不写任何文件。
 * 用法：xiaoyu-novel find <关键词> [dir] [--limit N] [--json] [--in chapters|outlines|ledgers|all]
 */
function cmdFind(rest) {
  let dirArg = null
  let needle = null
  let limit = 200
  let asJson = false
  let scope = "all"
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === "--json") { asJson = true; continue }
    if (arg === "--limit") { limit = Math.max(1, Number(rest[++i]) || 200); continue }
    if (arg === "--in") { scope = String(rest[++i] || "all"); continue }
    if (arg.startsWith("-")) fail("未知选项「" + arg + "」——find 只认 --limit / --json / --in")
    if (needle === null) { needle = arg; continue }
    if (dirArg === null) { dirArg = arg; continue }
    fail("多余的位置参数「" + arg + "」——用法：xiaoyu-novel find <关键词> [dir]")
  }
  if (needle === null || needle === "") fail("用法：xiaoyu-novel find <关键词> [dir] [--limit N] [--json] [--in chapters|outlines|ledgers|all]")
  const root = path.resolve(dirArg ?? "novel")
  const result = findInNovel(root, needle, { limit, scope })
  if (asJson) { console.log(JSON.stringify(result, null, 2)); return }
  console.log("检索「" + needle + "」：命中 " + result.total + " 处 / " + result.files + " 个文件" + (result.truncated ? "（已截断，用 --limit 放大）" : "（已含全部命中）"))
  let lastFile = null
  for (const hit of result.hits) {
    if (hit.file !== lastFile) { console.log(""); console.log("  " + hit.file); lastFile = hit.file }
    console.log("    " + hit.line + ": " + hit.text)
  }
  if (result.total === 0) console.log("  （没有命中——换关键词，或确认路径）")
}

/** find 的实现：按范围扫 md/yml，返回总数与逐行命中（上下文 1 行内截断）。 */
function findInNovel(root, needle, options) {
  const limit = Math.max(1, Number(options && options.limit) || 200)
  const scope = String((options && options.scope) || "all")
  const targets = []
  const pushDir = (rel) => {
    const dir = path.join(root, rel)
    let names = []
    try { names = readdirSync(dir) } catch { return }
    for (const name of names) {
      if (!/\.(md|yml)$/i.test(name)) continue
      targets.push(path.join(rel, name))
    }
  }
  const pushFile = (name) => {
    if (existsSync(path.join(root, name))) targets.push(name)
  }
  if (scope === "chapters" || scope === "all") pushDir("chapters")
  if (scope === "outlines" || scope === "all") pushDir("outlines")
  if (scope === "ledgers" || scope === "all") {
    for (const name of ["memories.yml", "timeline.yml", "relations.yml", "foreshadows.yml", "clue-board.yml", "volumes.yml", "decisions.yml", "index.yml"]) pushFile(name)
    pushDir("characters")
    pushDir("world")
  }
  const hits = []
  let total = 0
  let files = 0
  const lower = needle.toLowerCase()
  for (const rel of targets.sort()) {
    const text = readTextOrNull(path.join(root, rel))
    if (text === null) continue
    let counted = false
    text.split(/\r?\n/).forEach((line, i) => {
      if (!line.toLowerCase().includes(lower)) return
      total += 1
      if (!counted) { files += 1; counted = true }
      if (hits.length < limit) hits.push({ file: rel.split(path.sep).join("/"), line: i + 1, text: line.trim().slice(0, 120) })
    })
  }
  return { ok: true, root, needle, total, files, truncated: total > hits.length, hits }
}

/**
 * portable：跨设备搬迁（export / import / show）。
 *
 * 一次搬家要把 patch 两层、预设源文件、技能包、工作区清单、渠道 key 一起带走——
 * 少一样，用户看到的就是「助手名字变了」「面板打不开」「技能没了」。所以固定成
 * 一个包、一条命令，不靠记忆列文件。
 */
function cmdPortable(rest) {
  const action = rest[0]
  if (action === undefined || action === '--help' || action === '-h') {
    fail('用法：xiaoyu-novel portable export <包路径> [--home <DSH_HOME>] [--profile web] [--no-secrets]\n' +
      '      xiaoyu-novel portable import <包路径> [--home <DSH_HOME>] [--dry-run]\n' +
      '      xiaoyu-novel portable show <包路径>')
  }
  let file = null
  let home = null
  let profile = 'web'
  let secrets = true
  let dryRun = false
  for (let i = 1; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '--home') { home = rest[++i]; continue }
    if (arg.startsWith('--home=')) { home = arg.slice('--home='.length); continue }
    if (arg === '--profile') { profile = rest[++i]; continue }
    if (arg.startsWith('--profile=')) { profile = arg.slice('--profile='.length); continue }
    if (arg === '--no-secrets') { secrets = false; continue }
    if (arg === '--dry-run') { dryRun = true; continue }
    if (arg.startsWith('-')) fail('未知选项「' + arg + '」——portable 只认 --home / --profile / --no-secrets / --dry-run')
    if (file === null) { file = arg; continue }
    fail('多余的位置参数「' + arg + '」')
  }
  if (file === null || file === '') fail('缺少搬迁包路径（例：xiaoyu-novel portable export ~/dsh-portable.tar.gz）')
  const targetHome = path.resolve(home ?? process.env.DSH_HOME ?? path.join(homedir(), '.dsh'))

  if (action === 'export') {
    const result = exportPortable({ home: targetHome, profile, secrets, out: file })
    console.log('搬迁包已生成：' + result.out)
    console.log('  文件 ' + result.files + ' 个 / ' + (result.bytes / 1024).toFixed(1) + ' KB' +
      (secrets ? '（含渠道 key）' : '（不含渠道 key，换机后要重填）'))
    console.log('  来源 DSH home：' + targetHome + '（profile ' + profile + '，DSH ' + (result.manifest.sourceVersion ?? '版本未知') + '）')
    console.log('')
    console.log(restoreHint(result.manifest))
    return
  }

  if (action === 'show') {
    const { manifest, entries } = readPortable(file)
    console.log('搬迁包：' + path.resolve(file))
    console.log('  来自：' + manifest.dshHome + '（profile ' + manifest.profile + '，DSH ' + (manifest.sourceVersion ?? '版本未知') + '）')
    console.log('  打包时间：' + manifest.createdAt)
    console.log('  文件 ' + entries.length + ' 个，' + (secrets ? '含渠道 key' : '不含渠道 key'))
    const dirs = {}
    for (const entry of entries) {
      const top = entry.name.split('/').slice(0, 3).join('/')
      dirs[top] = (dirs[top] ?? 0) + 1
    }
    for (const [dir, count] of Object.entries(dirs).sort()) console.log('    ' + dir + '  ×' + count)
    console.log('')
    console.log(restoreHint(manifest))
    return
  }

  if (action === 'import') {
    const result = importPortable({ file, home: targetHome, dryRun })
    if (dryRun) {
      console.log('（试运行，未写盘）会写 ' + result.written.length + ' 个文件到 ' + targetHome + '：')
      for (const row of result.written.slice(0, 40)) console.log('  ' + row.file)
      if (result.written.length > 40) console.log('  …… 还有 ' + (result.written.length - 40) + ' 个')
      return
    }
    let backups = 0
    for (const row of result.written) if (row.backup !== null) backups += 1
    console.log('已还原 ' + result.written.length + ' 个文件到 ' + targetHome + '（其中 ' + backups + ' 个原有文件已备份为 *.bak-portable-*）')
    console.log('')
    console.log('下一步：重启 DSH，打开「设置 → Agent 预设」确认「小鱼创作 (Xiaoyu)」在列。')
    console.log('  不在列＝插件没装齐，按下面的清单装：')
    console.log('')
    console.log(restoreHint(result.manifest))
    return
  }

  fail('未知动作「' + action + '」——portable 可用：export / import / show')
}


/**
 * doctor：换设备后「助手名字变了 / 面板打不开 / 新建对话不是小鱼」逐条查。
 *
 * 这三类症状的共同点：插件装好了、配置也在，只是**值被别人改过**——默认预设被
 * dsh-ops 抢走、预设切换器被 ui-settings 藏起来、预设源文件没落地。日志里没有
 * 任何报错，只能靠配置事实判定，所以做成一条命令。
 */
function cmdDoctor(rest) {
  let home = null
  let profile = 'web'
  let asJson = false
  let fix = false
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '--home') { home = rest[++i]; continue }
    if (arg.startsWith('--home=')) { home = arg.slice('--home='.length); continue }
    if (arg === '--profile') { profile = rest[++i]; continue }
    if (arg.startsWith('--profile=')) { profile = arg.slice('--profile='.length); continue }
    if (arg === '--json') { asJson = true; continue }
    if (arg === '--fix') { fix = true; continue }
    fail('未知选项「' + arg + '」——doctor 只认 --home / --profile / --json / --fix')
  }
  const targetHome = path.resolve(home ?? process.env.DSH_HOME ?? path.join(homedir(), '.dsh'))
  const result = diagnose({ home: targetHome, profile })
  const fixes = fix ? applyDoctorFixes(targetHome, profile, result) : []
  if (asJson) {
    console.log(JSON.stringify({ ...result, home: targetHome, profile, fixes }, null, 2))
    if (!result.ok) process.exitCode = 1
    return
  }
  console.log('DSH home：' + targetHome + '（profile ' + profile + '）')
  console.log('')
  console.log(renderDiagnosis(result))
  if (fixes.length > 0) {
    console.log('')
    console.log('已改：')
    for (const line of fixes) console.log('  ' + line)
    console.log('')
    console.log('重启 DSH 生效。')
  } else if (!result.ok || result.warns > 0) {
    console.log('')
    console.log('加 --fix 就地改回（改前会备份）。')
  }
  if (!result.ok) process.exitCode = 1
}

/**
 * --fix 的写面：只改 doctor 报出来的那几处，改前备份，改完回读校验。
 * 不动用户其它内容（patch 里块外的东西一字节不碰）。
 */
function applyDoctorFixes(home, profile, result) {
  const changed = []
  const needs = new Set(result.checks.filter((row) => row.level !== 'ok').map((row) => row.id))
  const file = path.join(home, 'profiles', profile, 'cordis.patch.yml')
  if (!existsSync(file)) return changed
  let text = readFileSync(file, 'utf8')
  const original = text

  if (needs.has('default-preset')) {
    const next = text.replace(/(\n\s*selectedDefault:\s*)\S+/, '$1xiaoyu-novel')
    if (next !== text) { text = next; changed.push('默认预设 → xiaoyu-novel') }
  }
  if (needs.has('ui-settings')) {
    const entry = patchEntryTextOf(text, 'ui-settings')
    if (entry !== null && entry.includes('enabled: false')) {
      text = text.replace(entry, entry.replace('enabled: false', 'enabled: true'))
      changed.push('预设切换器 → 显示（ui-settings.enabled: true）')
    }
  }
  if (needs.has('ops-force')) {
    const entry = patchEntryTextOf(text, 'dsh-ops')
    if (entry !== null) {
      text = text.replace(entry, entry.replace(/forceDefaultOpsPtc:\s*(true|false)/, 'forceDefaultOpsPtc: false'))
      changed.push('dsh-ops 不再抢默认预设（forceDefaultOpsPtc: false）')
    } else {
      // 没有 dsh-ops 覆盖行：追加一条只关开关的覆盖
      text = text.trimEnd() + '\n\n- id: dsh-ops\n  name: "dsh-ops"\n  config:\n    global:\n      forceDefaultOpsPtc: false\n'
      changed.push('新增 dsh-ops 覆盖行（forceDefaultOpsPtc: false）')
    }
  }
  if (text === original) return changed
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  writeFileSync(file + '.bak-doctor-' + stamp, original)
  writeFileSync(file, text)
  return changed
}

/** 从 patch 文本里截某条 `- id: <id>` 的文本块（doctor 命令行侧的小工具）。 */
function patchEntryTextOf(text, id) {
  const lines = String(text).split('\n')
  const start = lines.findIndex((line) => line.trimEnd() === '- id: ' + id)
  if (start === -1) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('- ')) { end = i; break }
  }
  return lines.slice(start, end).join('\n')
}

function main(argv) {
  const [command, ...rest] = argv
  if (command === '--help' || command === '-h' || command === 'help') {
    console.log(HELP_TEXT)
    return
  }
  // 单参子命令自身也认 --help/-h（防 init --help 被当目录名），显示帮助即止
  if (SINGLE_DIR_COMMANDS.includes(command) && rest.some((a) => a === '--help' || a === '-h')) {
    console.log(HELP_TEXT)
    return
  }
  if (command === 'init') return cmdInit(singleDirTarget('init', rest))
  if (command === 'stats') return cmdStats(singleDirTarget('stats', rest))
  if (command === 'index') return cmdIndex(singleDirTarget('index', rest))
  if (command === 'export') return cmdExport(rest)
  if (command === 'ledger') return cmdLedger(rest)
  if (command === 'brief') return cmdBrief(rest)
  if (command === 'wc') return cmdWc(rest)
  if (command === 'check') return cmdCheck(singleDirTarget('check', rest))
  if (command === 'gate') return cmdGate(rest)
  if (command === 'report') return cmdReport(rest)
  if (command === 'audit') return cmdAudit(rest)
  if (command === 'undo') return cmdUndo(rest)
  if (command === 'progress') return cmdProgress(rest)
  if (command === 'setup') return cmdSetup(rest)
  if (command === 'handoff') return cmdHandoff(rest)
  if (command === 'find') return cmdFind(rest)
  if (command === 'slim') return cmdSlim(rest)
  if (command === 'clean' || command === 'ledger-clean') return cmdClean(rest)
  if (command === 'update' || command === 'upgrade') return cmdUpdate(rest)
  if (command === 'token') return cmdToken(rest)
  if (command === 'portable') return cmdPortable(rest)
  if (command === 'doctor') return cmdDoctor(rest)
  if (command === undefined) {
    console.error('xiaoyu: 缺少子命令（init / stats / index / export / brief / wc / check / gate / report，--help 看用法）')
    process.exit(1)
  }
  fail(`未知子命令「${command}」——可用：init / stats / index / export / brief / wc / ledger / check / gate / report / audit / undo / progress / setup（--help 看用法）`)
}

main(process.argv.slice(2))