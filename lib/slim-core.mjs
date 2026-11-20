/**
 * slim-core.mjs —— 账本归档（0.11.0）
 *
 * 现场：memories 234KB / timeline 165KB / clue-board 74KB，写手每章都要读，
 * 单条描述最长 11053 字。光提醒不管用，这里给「按卷归档」：把某一卷之前的
 * 条目整块搬进 archive/<账本>-before-vXX.yml，主账只留当前卷与之后。
 *
 * 安全口径：
 *   - 默认 dry-run，只报告要搬多少条；--apply 才写；
 *   - 按顶层「- 」块整块搬运，不动注释头、不重排字段、不重写内容；
 *   - 主账先备份 .bak，archive 目标存在则追加（不覆盖旧归档）；
 *   - 搬完主账仍能解析成条目数组，否则放弃写入（先写临时文件再校验）。
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { parseFlatYamlArray, chapterSortKey } from './novel-parse.mjs'

/** 账本 → 章节号字段（决定一条属于哪一卷）。 */
export const ARCHIVE_TARGETS = [
  { file: 'memories.yml', chapterKey: 'source_chapter' },
  { file: 'timeline.yml', chapterKey: 'chapter' },
  { file: 'clue-board.yml', chapterKey: 'related_chapter' },
]

/** v02 / 2 / v02-c003 → 卷号；认不出返回 null。 */
export function volumeOf(before) {
  const raw = String(before ?? '').trim()
  const m = /^v?(\d+)(?:-[a-z]?\d+)?$/i.exec(raw)
  if (m === null) return null
  return Number(m[1])
}

/** 章号 → 卷号（v01-c003 → 1）；认不出返回 null。 */
export function volumeOfChapter(ref) {
  const stem = String(ref ?? '').trim().replace(/\.md$/i, '')
  const key = chapterSortKey(stem)
  return key === null ? null : key.vol
}

/** 把一份账本按顶层「- 」切块：header = 第一个条目之前的注释/空行。 */
export function splitEntries(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const header = []
  const blocks = []
  let current = null
  for (const line of lines) {
    if (/^-\s/.test(line)) {
      if (current !== null) blocks.push(current)
      current = [line]
    } else if (current === null) {
      header.push(line)
    } else {
      current.push(line)
    }
  }
  if (current !== null) blocks.push(current)
  return { header, blocks }
}

/** 块 → 条目对象（只为读章号；解析失败按「留在主账」处理，不冒险）。 */
function entryOf(block) {
  const parsed = parseFlatYamlArray(block.join('\n'))
  if (!Array.isArray(parsed) || parsed.length === 0) return null
  return parsed[0]
}

/**
 * 归档计划（只读）：返回每个账本要搬走的条目数、留在主账的条目数与目标文件名。
 */
export function archivePlan(novelDir, before) {
  const vol = volumeOf(before)
  if (vol === null) throw new Error('卷号写法不合法：' + before + '（写 v02 或 2）')
  const dir = path.resolve(novelDir)
  const tag = 'v' + String(vol).padStart(2, '0')
  const plan = []
  for (const target of ARCHIVE_TARGETS) {
    const file = path.join(dir, target.file)
    if (!existsSync(file)) continue
    const { header, blocks } = splitEntries(readFileSync(file, 'utf8'))
    const move = []
    const keep = []
    for (const block of blocks) {
      const entry = entryOf(block)
      const ref = entry === null ? null : entry[target.chapterKey]
      const entryVol = volumeOfChapter(ref)
      // 章号认不出、或没有章号字段：留在主账（宁可多读，不可错搬）
      if (entryVol !== null && entryVol < vol) move.push(block)
      else keep.push(block)
    }
    // 安全阀：一本账全被搬走＝主账变空，写手/审校读到的是空账本——比不归档更糟。
    // 只有当前还在这一卷（没写下一卷）时就会出现这种计划，直接标 blocked 不搬。
    const blocked = keep.length === 0 && move.length > 0
    plan.push({
      blocked,
      file: target.file,
      archiveFile: 'archive/' + target.file.replace(/\.yml$/, '') + '-before-' + tag + '.yml',
      move: move.length,
      keep: keep.length,
      header,
      moveBlocks: move,
      keepBlocks: keep,
    })
  }
  return { ok: true, before: tag, fromVolume: vol, plan }
}

/**
 * 执行归档：主账只留未归档条目（保留 header），被搬条目追加到 archive 文件。
 * 写前备份 .bak；写后用极简解析校验主账仍是条目数组。
 */
export function archiveApply(novelDir, before) {
  const planned = archivePlan(novelDir, before)
  const dir = path.resolve(novelDir)
  mkdirSync(path.join(dir, 'archive'), { recursive: true })
  let moved = 0
  const written = []
  for (const item of planned.plan) {
    if (item.move === 0 || item.blocked) continue
    const mainPath = path.join(dir, item.file)
    const archivePath = path.join(dir, item.archiveFile)
    const nextMain = [...item.header, ...item.keepBlocks].join('\n').replace(/\n{3,}$/, '\n')
    const parsed = parseFlatYamlArray(nextMain)
    if (item.keepBlocks.length > 0 && !Array.isArray(parsed)) {
      throw new Error(item.file + ' 归档后不再是条目数组，已放弃写入')
    }
    copyFileSync(mainPath, mainPath + ".bak")
    let existing = ''
    if (existsSync(archivePath)) existing = readFileSync(archivePath, 'utf8')
    const addition = item.moveBlocks.map((block) => block.join('\n')).join('\n')
    const merged = existing.trim() === ''
      ? '# 归档：' + planned.before + ' 之前的条目（由 xiaoyu-novel slim --archive 迁入）\n' + addition + '\n'
      : existing.replace(/\s*$/, '\n') + addition + '\n'
    writeFileSync(archivePath, merged, 'utf8')
    writeFileSync(mainPath, nextMain, 'utf8')
    moved += item.move
    written.push({ file: item.file, archiveFile: item.archiveFile, moved: item.move, kept: item.keep })
  }
  return { ok: true, before: planned.before, moved, written }
}
