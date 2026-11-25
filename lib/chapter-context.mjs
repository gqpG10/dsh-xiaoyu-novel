/**
 * chapter-context.mjs —— 3.21.0 每章智能上下文（参考 oh-story「只加载不知道就会写错的信息」）。
 *
 * 为什么：写手写第 N 章时把全书设定全量塞过去，75+ 章的书既超上下文又淹没重点，
 * 还会提前泄底。本模块按章扫描，只输出三类「不知道就会写错」的信息：
 *   1) 本章命中角色（cast-matrix 已有出场数据，直接复用）
 *   2) 本章需推进/回收的伏笔（planted/expected 落在窗口内的）
 *   3) 涉及设定条目（world/setting 里被本章正文或章纲提及关键词命中）
 *
 * 同时输出信息差警戒表：reader_known 晚于本章的伏笔 = 读者还不知道，
 * 写手不得在正文提及；characters 里标 secret 的设定同理。
 *
 * 纯函数 + 只读文件；路由层缓存 30s TTL（cast-matrix 同款策略）。
 */

import path from 'node:path'
import { readTextCached, listDirCached } from './read-cache.mjs'
import { chapterSortKey } from './novel-parse.mjs'

const ordOfStem = (stem) => {
  const key = chapterSortKey(String(stem ?? '').replace(/\.md$/i, ''))
  return key === null ? null : key.vol * 1e6 + key.num
}

/** 伏笔台账行级读取（与 audit-core 同款轻量解析，坏行跳过）。 */
function readForeshadows(novelDir) {
  const raw = readTextCached(path.join(path.resolve(novelDir), 'foreshadows.yml'))
  if (raw === null) return []
  const out = []
  let cur = null
  for (const line of String(raw).split(/\r?\n/)) {
    const m = /^\s*-?\s*(id|title|status|planted_chapter|reader_known|expected_resolve)\s*:\s*(.*)$/.exec(line)
    if (m === null) continue
    let v = m[2].trim()
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1)
    if (m[1] === 'id') { cur = { id: v }; out.push(cur) }
    else if (cur !== null) cur[m[1]] = v
  }
  return out.filter((e) => String(e.id ?? '') !== '')
}

/** 角色卡名提取（characters/*.yml 的 name/出场名）。 */
function readCastNames(novelDir) {
  const dir = path.join(path.resolve(novelDir), 'characters')
  const files = listDirCached(dir) || []
  const names = []
  for (const f of files) {
    if (!/\.ya?ml$/i.test(f)) continue
    const raw = readTextCached(path.join(dir, f))
    if (raw === null) continue
    const m = /^\s*(?:name|名字)\s*:\s*(.+)$/m.exec(String(raw))
    if (m !== null) {
      let v = m[1].trim()
      if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1)
      names.push({ file: f, name: v })
    }
  }
  return names
}

/**
 * 每章智能上下文。
 * @param {string} novelDir 书目录
 * @param {string} chapterFile 章文件名（如 v02-c076.md）
 * @param {object} castRows cast-matrix 的出场数据（可选；缺省自扫正文）
 * @returns {{ chapter, cast, foreshadows: {due:[],warm:[]}, secrets: [], stats }}
 */
export function chapterContext(novelDir, chapterFile, castRows) {
  const dir = path.resolve(novelDir)
  const stem = String(chapterFile ?? '').replace(/\.md$/i, '')
  const ord = ordOfStem(stem)
  const fs = readForeshadows(dir)
  // 正文（命中角色判定兜底用）
  const body = readTextCached(path.join(dir, 'chapters', stem + '.md')) || readTextCached(path.join(dir, stem + '.md')) || ''

  // 1) 命中角色：优先 castRows，兜底正文包含名字
  let cast = []
  if (Array.isArray(castRows)) {
    cast = castRows.filter((r) => r && (r.stem === stem || r.file === stem)).map((r) => r.name || r.id)
  }
  if (cast.length === 0) {
    cast = readCastNames(dir).map((c) => c.name).filter((n) => n.length >= 2 && body.includes(n))
  }

  // 2) 伏笔窗口：本章前后 3 章内 planted 的 = warm（背景记得），expected_resolve 落在
  //    本章或已过期未回收的 = due（本章必须处理）
  const ordNum = (v) => ordOfStem(v)
  const warm = []
  const due = []
  for (const f of fs) {
    if (f.status === 'resolved' || f.status === 'abandoned') continue
    const p = ordNum(f.planted_chapter)
    const e = ordNum(f.expected_resolve)
    if (e !== null && ord !== null && e <= ord) {
      due.push({ id: f.id, title: f.title || '', expected: f.expected_resolve, status: f.status })
    } else if (p !== null && ord !== null && p <= ord && p >= ord - 3e6) {
      warm.push({ id: f.id, title: f.title || '', planted: f.planted_chapter })
    }
  }

  // 3) 信息差警戒：reader_known 缺失或晚于本章 → 读者未知，正文禁提
  const secrets = []
  for (const f of fs) {
    if (f.status === 'resolved' || f.status === 'abandoned') continue
    const k = ordNum(f.reader_known)
    const hasRK = 'reader_known' in f
    if (!hasRK || (k !== null && ord !== null && k > ord)) {
      secrets.push({ id: f.id, title: f.title || '', hint: !hasRK ? '未分家：按作者真相处理，读者视角未知' : '读者从 ' + f.reader_known + ' 才知道，本章正文不得提及' })
    }
  }

  // 3.23.0 章后记忆：自动携带上一章摘要（前情梗概，长篇连载最易断的线）。
  let prevMemory = null
  try {
    const memFiles = (listDirCached(path.join(dir, 'memory')) || []).filter((f) => /\.ya?ml$/.test(f)).sort()
    if (memFiles.length) {
      const prevStem = memFiles[memFiles.length - 1].replace(/\.ya?ml$/i, '')
      const memRaw = readTextCached(path.join(dir, 'memory', prevStem + '.yml'))
      if (memRaw !== null && prevStem !== stem) prevMemory = { chapter: prevStem, text: String(memRaw) }
    }
  } catch (e) { /* 无 memory/ 目录：不带前情 */ }
  return {
    chapter: stem,
    cast: Array.from(new Set(cast)),
    foreshadows: { due, warm },
    secrets,
    prevMemory,
    stats: { castN: new Set(cast).size, dueN: due.length, warmN: warm.length, secretN: secrets.length, bodyChars: body.length },
  }
}
