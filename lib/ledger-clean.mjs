/**
 * ledger-clean.mjs —— 清账本（0.16.0 / 0.17.0）
 *
 * 现场：check 每次全量重扫，账本只增不减，面板「静态体检」黄条永远挂着同一批
 * warn——超长条目、超期伏笔、账本超过 200KB、index.yml 与章节数不一致。
 * 作者要的不是解释，是一个开关：点一下，警告消失，信息不丢，还能撤销。
 *
 * 四件事（都在一次点击里）：
 *   1) 超长字段（description/notes/content/summary ≥300 字）→ 结论句 + 明细指路，
 *      全文一字不改搬进 archive/ledger-details/；
 *   2) 账本 ≥200KB → 把「最近 N 章之前」的条目整块搬进
 *      archive/<账本>-before-<卷-章>.yml，主账只留最近 N 章 + 认不出章号的常驻条目；
 *   3) 超期伏笔（planted 且间隔 >30 章）→ status 升 progressing，只认已写
 *      【推进章】/【推进点】/「已推进」的，其余留人工（不猜）；
 *   4) index.yml 与 chapters/ 条数不一致 → 按 buildIndexYaml 重建（派生文件）。
 *
 * 安全口径：
 *   - 不新增字段（format-core 的键白名单是死的，加 key 会变 error）；
 *   - 写前整本备份到 archive/_ledger-clean/<时间戳>/ + manifest.json；
 *   - 撤销 = 账本字节级还原、删掉本次生成的明细与归档、index.yml 还原；
 *   - 改完必须仍是条目数组、条数不变，否则整本跳过。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, rmSync, renameSync } from 'node:fs'
import path from 'node:path'

import { buildIndexYaml, collectChapters, FORESHADOW_STALE_CHAPTERS, parseFlatYamlArray } from './novel-parse.mjs'
import { checkFormat } from './format-core.mjs'
import { LEDGER_FILES, LEDGER_WARN_BYTES, LONG_ENTRY_CHARS } from './ledger-stats.mjs'
import { splitEntries } from './slim-core.mjs'

/** 与 check 的超长字段口径一致。 */
export const CLEAN_TEXT_KEYS = ['description', 'notes', 'content', 'summary']
/** 结论句保留上限（含标点）；加「明细见」后缀后仍远低于 300。 */
export const KEEP_MAX = 160
/** 账本超阈值时，主账保留最近多少章的条目（更早的进 archive/）。 */
export const ARCHIVE_KEEP_CHAPTERS = 10
export const DETAIL_DIR = 'archive/ledger-details'
export const BACKUP_ROOT = 'archive/_ledger-clean'

/** v01-c003 / c3 / 3 → { vol, num }；认不出返回 null。 */
export function parseRef(raw) {
  const text = String(raw ?? '').trim()
  if (text === '') return null
  const withVol = /^v(\d+)-c?(\d+)$/i.exec(text)
  if (withVol !== null) return { vol: Number(withVol[1]), num: Number(withVol[2]) }
  const bare = /^c?(\d+)$/i.exec(text)
  if (bare !== null) return { vol: 0, num: Number(bare[1]) }
  return null
}

function ordOf(ref) {
  const parsed = parseRef(ref)
  return parsed === null ? null : parsed.vol * 1000 + parsed.num
}

/** 只接受规范卷章号参与排序（裸章号 vol=0 与 v01 混用会把老条目算成「未来」）。 */
function strictOrd(ref) {
  const parsed = parseRef(ref)
  if (parsed === null || parsed.vol === 0) return null
  return parsed.vol * 1000 + parsed.num
}

/** 已写章节的最大卷章序数（与 check 的 maxWritten 同口径）。 */
export function maxWrittenOf(novelDir) {
  const chapters = collectChapters(novelDir)
  if (chapters === null) return null
  let best = null
  for (const chapter of chapters) {
    const key = chapter.sortKey
    if (key === null || key === undefined) continue
    if (best === null || key.vol * 1000 + key.num > best.vol * 1000 + best.num) best = { vol: key.vol, num: key.num }
  }
  return best
}

function sanitize(label) {
  return String(label)
    .replace(/[^\w\u4e00-\u9fff-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

/** 条目的人类可读标识：id → 关系两端 → 线索号 → 标题 → 序号。 */
export function labelOf(entry, index) {
  const clue = typeof entry.content === 'string' ? /(cl-\d+)/.exec(entry.content) : null
  const base =
    (typeof entry.id === 'string' && entry.id !== '' && entry.id) ||
    (typeof entry.a === 'string' && typeof entry.b === 'string' && entry.a !== '' && entry.b !== '' && entry.a + '-' + entry.b) ||
    (clue !== null ? clue[1] : '') ||
    (typeof entry.title === 'string' && entry.title !== '' && entry.title) ||
    'entry'
  return String(index + 1).padStart(2, '0') + '-' + sanitize(base)
}

const OPEN_QUOTES = new Set(['「', '『', '“', '（', '(', '《', '【'])
const CLOSE_QUOTES = new Set(['」', '』', '”', '）', ')', '》', '】'])

/** 括号/引号里的句子不算「结论句」——切在引号内会留下半句对话。 */
export function outsideBrackets(text) {
  const flags = []
  let level = 0
  for (const ch of text) {
    if (OPEN_QUOTES.has(ch)) { level += 1; flags.push(false); continue }
    if (CLOSE_QUOTES.has(ch)) { level = Math.max(0, level - 1); flags.push(false); continue }
    flags.push(level === 0)
  }
  return flags
}

/**
 * 结论句：切在括号外的「真句末」（。！？…），至少 20 字才认；没有就退到
 * 括号外的「，、；：」再补省略号；再没有就硬切 140（剥掉被截断的英文/数字
 * 残词）——绝不切在引号里，也不留「gossi……」「（六千是意……」这种半截。
 */
export function cutText(text) {
  const head = text.slice(0, KEEP_MAX)
  const flags = outsideBrackets(head)
  const lastOutside = (chars, minAt) => {
    let at = -1
    for (let i = 0; i < head.length; i += 1) {
      if (chars.indexOf(head[i]) === -1) continue
      if (!flags[i]) continue
      at = i
    }
    return { last: at, minAt }
  }
  const sentence = lastOutside('。！？…')
  if (sentence.last >= 20) return head.slice(0, sentence.last + 1)
  const clause = lastOutside('，、；：,;')
  if (clause.last >= 60) {
    // 「，……」不如「……」：去掉分隔逗号再接省略号，读起来是「到这儿被截了」
    return head.slice(0, clause.last).replace(/[，、,：:；;\s]+$/, '') + '……'
  }
  return head.slice(0, 140).replace(/[A-Za-z0-9]+$/, '').replace(/[，、,：:；;]$/, '') + '……'
}

function nowStamp(now) {
  const date = now instanceof Date ? now : new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return (
    String(date.getFullYear()) + pad(date.getMonth() + 1) + pad(date.getDate()) + '-' +
    pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds()) + '-' + String(date.getTime()).slice(-3)
  )
}

function isoLocal(now) {
  const date = now instanceof Date ? now : new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return (
    String(date.getFullYear()) + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' +
    pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
  )
}

/**
 * 超阈值账本按章归档：把「最大章 - keep」之前的条目整块搬走，主账留最近的。
 * 认不出章号的条目永远留在主账（宁可多读，不可错搬）。
 */
export function paragraphArchivePlan(file, text, maxWritten, keep) {
  const { header, blocks } = splitEntries(text)
  // 保留最近 keep 章（含最大章）：floor 是「第一条该留」的序数
  const floor = maxWritten.vol * 1000 + maxWritten.num - keep + 1
  const moved = []
  const kept = []
  let lastMovedNum = null
  let lastMovedVol = null
  for (const block of blocks) {
    const parsed = parseFlatYamlArray(block.join('\n'))
    const entry = Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : null
    const ref = entry === null ? null : entry.source_chapter ?? entry.chapter ?? entry.related_chapter ?? entry.chapters
    const ord = ref === null || ref === undefined ? null : strictOrd(ref)
    if (ord !== null && ord < floor) {
      moved.push(block)
      const at = parseRef(ref)
      if (at !== null && (lastMovedNum === null || at.num > lastMovedNum || at.vol > lastMovedVol)) {
        lastMovedNum = at.num
        lastMovedVol = at.vol
      }
    } else {
      kept.push(block)
    }
  }
  if (moved.length === 0) return null
  // 安全阀：搬空主账＝写手读到空账本，比不归档更糟，直接放弃这本的归档。
  if (kept.length === 0) return { blocked: true, moved: moved.length, kept: 0 }
  const tag = 'v' + String(lastMovedVol ?? maxWritten.vol).padStart(2, '0') + '-c' + String(lastMovedNum ?? 0).padStart(3, '0')
  const archiveFile = 'archive/' + file.replace(/\.yml$/, '') + '-before-' + tag + '.yml'
  return {
    blocked: false,
    archiveFile,
    moved: moved.length,
    kept: kept.length,
    text: [...header, ...kept.flat()].join('\n'),
    archiveText: moved.map((block) => block.join('\n')).join('\n') + '\n',
  }
}

/**
 * index.yml 与 chapters/ 条数是否不一致。判据直接借 format-core 的同一条
 * warn（它认流式与块式两种写法），保证清账本消掉的正是 check 报的那条。
 */
export function indexNeedsRebuild(novelDir) {
  const dir = path.resolve(novelDir)
  if (!existsSync(path.join(dir, 'index.yml'))) return false
  const problems = checkFormat(dir).problems || []
  return problems.some((p) => p.file === 'index.yml' && /条与 chapters\//.test(p.message))
}

/**
 * 计划（只读）：返回每本账要压几条、归档几条、升级几条，明细要落到哪个文件。
 * 返回对象里的 text 是算好的新全文（apply 用），API 层会剥掉。
 */
export function planLedgerClean(novelDir, options = {}) {
  const dir = path.resolve(novelDir)
  const now = options.now instanceof Date ? options.now : new Date()
  const maxWritten = maxWrittenOf(dir)
  const minBytes = Number.isInteger(options.minBytes) ? options.minBytes : LEDGER_WARN_BYTES
  const keepChapters = Number.isInteger(options.keepChapters) ? options.keepChapters : ARCHIVE_KEEP_CHAPTERS
  const files = []
  let trimmedTotal = 0
  let advancedTotal = 0
  let archivedTotal = 0
  let charsRemoved = 0
  for (const file of LEDGER_FILES) {
    const abs = path.join(dir, file)
    if (!existsSync(abs)) continue
    const raw = readFileSync(abs, 'utf8')
    const { header, blocks } = splitEntries(raw)
    const parsedAll = parseFlatYamlArray(raw)
    if (!Array.isArray(parsedAll)) continue // 解析不出条目的账本不冒险动
    const trimmed = []
    const advanced = []
    const skipped = []
    const details = []
    const nextBlocks = blocks.map((block, index) => {
      const parsed = parseFlatYamlArray(block.join('\n'))
      const entry = Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : null
      if (entry === null || typeof entry !== 'object') return block
      const label = labelOf(entry, index)
      const lines = block.slice()
      // 1) 超长字段 → 结论 + 明细外置
      for (let i = 0; i < lines.length; i += 1) {
        const match = /^(\s+)(description|notes|content|summary):[ \t]+(.*)$/.exec(lines[i])
        if (match === null || CLEAN_TEXT_KEYS.indexOf(match[2]) === -1) continue
        const value = match[3]
        if (value.length < LONG_ENTRY_CHARS) continue
        const stripped = value.trimStart()
        if (/^[|>]/.test(stripped) || /^["']/.test(stripped)) {
          skipped.push({ file, index, label, field: match[2], reason: '多行或引号写法，留人工' })
          break
        }
        const kept = cutText(value)
        const rel = DETAIL_DIR + '/' + file.replace(/\.yml$/, '') + '/' + label + '.md'
        const next = kept + ' （明细见 ' + rel + '）'
        if (next.length >= LONG_ENTRY_CHARS) {
          skipped.push({ file, index, label, field: match[2], reason: '压缩后仍超阈值，留人工' })
          break
        }
        lines[i] = match[1] + match[2] + ': ' + next
        trimmed.push({ file, index, label, field: match[2], before: value.length, after: next.length, detailFile: rel })
        details.push({ file, rel, label, field: match[2], original: value })
        charsRemoved += value.length - next.length
        trimmedTotal += 1
        break // 与 check 一致：一条只计一次
      }
      // 2) 超期伏笔 → planted 升 progressing（只认已写【推进章】的）
      if (file === 'foreshadows.yml' && entry.status === 'planted' && maxWritten !== null) {
        const planted = parseRef(entry.planted_chapter)
        if (planted !== null) {
          const gap =
            planted.vol === 0
              ? maxWritten.num - planted.num
              : maxWritten.vol * 1000 + maxWritten.num - (planted.vol * 1000 + planted.num)
          if (gap > FORESHADOW_STALE_CHAPTERS) {
            // 只认方括号标记（【推进章】/【推进点】）或明写「已推进」——
            // 普通叙述里的「未写推进章」不能算证据，否则会把真·遗忘的伏笔
            // 静默升成 progressing，警告消失但漏洞留下。
            const marked = /【推进[章点]】|已推进/.test(String(entry.notes ?? '') + String(entry.title ?? ''))
            if (!marked) {
              skipped.push({ file, index, label, reason: '超期但 notes 无【推进章】标记，留人工确认' })
            } else {
              const at = lines.findIndex((line) => /^\s+status:\s*planted\s*$/.test(line))
              if (at !== -1) {
                lines[at] = lines[at].replace('planted', 'progressing')
                advanced.push({ file, index, label, gap })
                advancedTotal += 1
              }
            }
          }
        }
      }
      return lines
    })
    let nextText = [...header, ...nextBlocks.flat()].join('\n')
    // 3) 账本仍超阈值 → 按章归档最老的一段
    let archive = null
    if (maxWritten !== null && Buffer.byteLength(nextText, 'utf8') >= minBytes) {
      archive = paragraphArchivePlan(file, nextText, maxWritten, keepChapters)
      if (archive !== null && archive.blocked === false) {
        nextText = archive.text
        archivedTotal += archive.moved
      }
    }
    // 安全阀：改完必须仍是条目数组、条数相等（减去被归档的），否则这本账整本跳过。
    const nextParsed = parseFlatYamlArray(nextText)
    const expectedCount = parsedAll.length - (archive !== null && archive.blocked === false ? archive.moved : 0)
    const sane = Array.isArray(nextParsed) && nextParsed.length === expectedCount
    files.push({
      file,
      trimmed,
      advanced,
      skipped,
      details,
      archive: archive !== null && archive.blocked === false ? archive : null,
      archiveBlocked: archive !== null && archive.blocked === true,
      sane,
      text: nextText,
      bytesBefore: Buffer.byteLength(raw, 'utf8'),
      bytesAfter: Buffer.byteLength(nextText, 'utf8'),
    })
  }
  return {
    ok: true,
    dryRun: true,
    at: isoLocal(now),
    stamp: nowStamp(now),
    trimmedTotal,
    advancedTotal,
    archivedTotal,
    charsRemoved,
    indexStale: indexNeedsRebuild(dir),
    detailDir: DETAIL_DIR,
    backupDir: BACKUP_ROOT + '/' + nowStamp(now),
    files,
  }
}

/** 对外计划（剥掉全文与明细原文，面板契约）。 */
export function describePlan(plan) {
  return {
    ok: true,
    dryRun: true,
    at: plan.at,
    trimmedTotal: plan.trimmedTotal,
    advancedTotal: plan.advancedTotal,
    archivedTotal: plan.archivedTotal,
    charsRemoved: plan.charsRemoved,
    indexStale: plan.indexStale,
    detailDir: plan.detailDir,
    files: plan.files
      .filter((item) => item.trimmed.length > 0 || item.advanced.length > 0 || item.skipped.length > 0 || item.archive !== null || item.archiveBlocked)
      .map((item) => ({
        file: item.file,
        sane: item.sane,
        trimmed: item.trimmed,
        advanced: item.advanced,
        skipped: item.skipped,
        archive: item.archive === null ? null : { archiveFile: item.archive.archiveFile, moved: item.archive.moved, kept: item.archive.kept },
        archiveBlocked: item.archiveBlocked,
      })),
  }
}

function writeDetail(dir, detail, at) {
  const abs = path.join(dir, detail.rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  const header =
    '# ' + detail.file + ' · ' + detail.label + ' · ' + detail.field + '\n' +
    '> 由 xiaoyu-novel 清账本于 ' + at + ' 移至此处：账本条目只留结论，原文一字未改。\n\n'
  if (existsSync(abs)) {
    writeFileSync(abs, readFileSync(abs, 'utf8').replace(/\s*$/, '\n') + '\n---\n\n' + header.replace(/^# .*\n/, '') + detail.original + '\n', 'utf8')
  } else {
    writeFileSync(abs, header + detail.original + '\n', 'utf8')
  }
}

/** 执行清理：备份 → 写明细 → 归档 → 写回账本 → 重建索引。 */
export function applyLedgerClean(novelDir, options = {}) {
  const dir = path.resolve(novelDir)
  const plan = planLedgerClean(dir, options)
  const nothing =
    plan.trimmedTotal === 0 && plan.advancedTotal === 0 && plan.archivedTotal === 0 && plan.indexStale !== true
  if (nothing) {
    return {
      ok: true,
      dryRun: false,
      changed: false,
      at: plan.at,
      trimmedTotal: 0,
      advancedTotal: 0,
      archivedTotal: 0,
      charsRemoved: 0,
      indexRebuilt: false,
      files: [],
      backupDir: '',
      detailDir: DETAIL_DIR,
    }
  }
  const backupAbs = path.join(dir, plan.backupDir)
  mkdirSync(backupAbs, { recursive: true })
  const written = []
  const createdDetails = []
  const createdArchives = []
  for (const item of plan.files) {
    const touched = item.trimmed.length > 0 || item.advanced.length > 0 || (item.archive !== null && item.sane)
    if (!touched || !item.sane) continue
    const abs = path.join(dir, item.file)
    copyFileSync(abs, path.join(backupAbs, item.file))
    for (const detail of item.details) {
      writeDetail(dir, detail, plan.at)
      createdDetails.push(detail.rel)
    }
    if (item.archive !== null) {
      const archiveAbs = path.join(dir, item.archive.archiveFile)
      mkdirSync(path.dirname(archiveAbs), { recursive: true })
      const existed = existsSync(archiveAbs)
      if (existed) copyFileSync(archiveAbs, path.join(backupAbs, path.basename(item.archive.archiveFile)))
      const head = existed
        ? readFileSync(archiveAbs, 'utf8').replace(/\s*$/, '\n')
        : '# 归档：' + plan.at + ' 由 xiaoyu-novel 清账本迁入（' + item.file + ' 的早期条目）\n'
      writeFileSync(archiveAbs, head + item.archive.archiveText, 'utf8')
      createdArchives.push({ rel: item.archive.archiveFile, existed })
    }
    const tmp = abs + '.clean-tmp'
    writeFileSync(tmp, item.text, 'utf8')
    renameSync(tmp, abs)
    written.push({
      file: item.file,
      trimmed: item.trimmed,
      advanced: item.advanced,
      skipped: item.skipped,
      archive: item.archive === null ? null : { archiveFile: item.archive.archiveFile, moved: item.archive.moved, kept: item.archive.kept },
      bytesBefore: item.bytesBefore,
      bytesAfter: item.bytesAfter,
    })
  }
  let indexRebuilt = false
  if (plan.indexStale) {
    const indexAbs = path.join(dir, 'index.yml')
    if (existsSync(indexAbs)) copyFileSync(indexAbs, path.join(backupAbs, 'index.yml'))
    const chapters = collectChapters(dir) || []
    const volumesRaw = existsSync(path.join(dir, 'volumes.yml')) ? parseFlatYamlArray(readFileSync(path.join(dir, 'volumes.yml'), 'utf8')) : []
    const built = buildIndexYaml(chapters, Array.isArray(volumesRaw) ? volumesRaw : [])
    writeFileSync(indexAbs, built.text, 'utf8')
    indexRebuilt = true
  }
  const manifest = {
    at: plan.at,
    stamp: plan.stamp,
    files: written.map((item) => ({
      file: item.file,
      trimmed: item.trimmed.map((row) => ({ label: row.label, field: row.field, detailFile: row.detailFile })),
      advanced: item.advanced.map((row) => ({ label: row.label, gap: row.gap })),
      archive: item.archive,
    })),
    details: createdDetails,
    archives: createdArchives,
    index: indexRebuilt,
  }
  writeFileSync(path.join(backupAbs, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  return {
    ok: true,
    dryRun: false,
    changed: written.length > 0 || indexRebuilt,
    at: plan.at,
    trimmedTotal: written.reduce((n, item) => n + item.trimmed.length, 0),
    advancedTotal: written.reduce((n, item) => n + item.advanced.length, 0),
    archivedTotal: written.reduce((n, item) => n + (item.archive === null ? 0 : item.archive.moved), 0),
    charsRemoved: plan.charsRemoved,
    indexRebuilt,
    files: written,
    backupDir: plan.backupDir,
    detailDir: DETAIL_DIR,
  }
}

/** 最近一次有效备份目录（无则 null）。 */
export function latestBackup(novelDir) {
  const root = path.join(path.resolve(novelDir), BACKUP_ROOT)
  if (!existsSync(root)) return null
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(path.join(root, name, 'manifest.json')))
    .sort()
  if (dirs.length === 0) return null
  const name = dirs[dirs.length - 1]
  return { name, dir: path.join(root, name), manifest: JSON.parse(readFileSync(path.join(headOf(root, name)), 'utf8')) }
}

function headOf(root, name) {
  return path.join(root, name, 'manifest.json')
}

/** 撤销最近一次清账：还原账本与索引、删掉本次生成的明细与归档，再清掉备份目录。 */
export function undoLedgerClean(novelDir) {
  const dir = path.resolve(novelDir)
  const latest = latestBackup(dir)
  if (latest === null) throw new Error('没有可撤销的清账记录（archive/_ledger-clean 为空）')
  const restored = []
  for (const item of latest.manifest.files) {
    const backupFile = path.join(latest.dir, item.file)
    if (!existsSync(backupFile)) continue
    const target = path.join(dir, item.file)
    if (existsSync(target)) copyFileSync(target, target + '.pre-undo.bak')
    copyFileSync(backupFile, target)
    restored.push(item.file)
  }
  if (latest.manifest.index === true && existsSync(path.join(latest.dir, 'index.yml'))) {
    copyFileSync(path.join(latest.dir, 'index.yml'), path.join(dir, 'index.yml'))
    restored.push('index.yml')
  }
  const removedDetails = []
  for (const rel of latest.manifest.details || []) {
    const abs = path.join(dir, rel)
    if (existsSync(abs)) { rmSync(abs, { force: true }); removedDetails.push(rel) }
  }
  const removedArchives = []
  for (const item of latest.manifest.archives || []) {
    const abs = path.join(dir, item.rel)
    if (item.existed) {
      const backup = path.join(latest.dir, path.basename(item.rel))
      if (existsSync(backup)) copyFileSync(backup, abs)
    } else if (existsSync(abs)) {
      rmSync(abs, { force: true })
      removedArchives.push(item.rel)
    }
  }
  rmSync(latest.dir, { recursive: true, force: true })
  return { ok: true, at: latest.manifest.at, restored, removedDetails, removedArchives }
}
