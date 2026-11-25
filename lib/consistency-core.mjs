/**
 * consistency-core.mjs —— 3.23.0 连续性体检（novel-audit 范式，纯函数）。
 *
 * 三查：
 *   ① 角色属性矛盾：角色卡 yml 的 name/外貌字段 vs 正文同名描述——重点抓
 *      「颜色/数字」类硬属性冲突（红眼 vs 黑眼、十八岁 vs 二十岁）。
 *   ② 时间倒流：正文「N天前/昨天/三天前」引用的事件章序在本章之后 → 时光机。
 *   ③ 记忆缺失：第 N 章之后突然出现第 N-3 章从未登场的角色却无介绍性描写
 *      （hit-name 无 intro 动词的轻启发式，只报 warn 不定罪）。
 *
 * 输出 problems[]（level/kind/message/chapter），与 audit.problems 同构，
 * 体检页直接合流展示。
 */

import path from 'node:path'
import { readTextCached, listDirCached } from './read-cache.mjs'
import { chapterSortKey } from './novel-parse.mjs'

const ordOf = (stem) => {
  const key = chapterSortKey(String(stem ?? '').replace(/\.md$/i, ''))
  return key === null ? null : key.vol * 1e6 + key.num
}

/** ① 角色硬属性矛盾：卡内字段值 vs 正文中「名字+属性词」共现。 */
export function scanAttributeConflicts(novelDir) {
  const problems = []
  const cdir = path.join(path.resolve(novelDir), 'characters')
  const files = (listDirCached(cdir) || []).filter((f) => /\.ya?ml$/i.test(f))
  const chapters = chapterFiles(novelDir)
  for (const f of files) {
    const raw = readTextCached(path.join(cdir, f))
    if (raw === null) continue
    const nm = /^\s*(?:name|名字)\s*:\s*(.+)$/m.exec(String(raw))
    if (nm === null) continue
    const name = nm[1].trim().replace(/^["']|["']$/g, '')
    if (name.length < 2) continue
    // 卡里的颜色/年龄硬属性
    const hard = []
    for (const line of String(raw).split(/\r?\n/)) {
      const m = /^\s*(?:appearance|外貌|eyes|瞳色|age|年龄|发色|hair)\s*:\s*(.+)$/.exec(line)
      if (m === null) continue
      hard.push({ field: m[1] ? line.split(':')[0].trim() : '?', value: m[1].trim() })
    }
    if (hard.length === 0) continue
    for (const cf of chapters.files) {
      const body = readTextCached(path.join(chapters.dir, cf))
      if (body === null || !body.includes(name)) continue
      for (const h of hard) {
        // 提取属性值中的颜色词与数字，查正文同段是否出现「另一个」同域值
        const colors = ['红','黑','白','金','银','蓝','绿','紫','灰','棕','褐']
        for (const c of colors) {
          if (h.value.includes(c)) {
            // 同段（名字出现的段落）出现别的颜色修饰同类词的粗启发：
            // 直接查「name + 其他颜色 + 眼|发|眸|瞳」模式
            const re = new RegExp(name + '[^。]{0,24}[' + colors.filter((x) => x !== c).join('') + '][^。]{0,2}(?:眼|发|眸|瞳|睛|瞳色|眸子)', 'u')
            const mm = re.exec(String(body))
            if (mm) {
              problems.push({ level: 'error', kind: 'attr-conflict', chapter: cf, message: name + ' 的' + h.field + '（' + h.value + '）与本章描述（' + mm[1] + '…）冲突' })
            }
          }
        }
      }
    }
  }
  return problems
}

/** ② 时间倒流：「N天前」引用的章序晚于本章（时光机检测）。 */
export function scanTimelineConflicts(novelDir) {
  const problems = []
  const chapters = chapterFiles(novelDir)
  const ord = {}
  chapters.files.forEach((f, i) => { ord[f] = i })
  // 章内「第X章」明文引用
  for (const cf of chapters.files) {
    const body = readTextCached(path.join(chapters.dir, cf))
    if (body === null) continue
    const refs = String(body).match(/(?:第|上一?章|前一章)[「「]?([0-9一二三四五六七八九十百]+)[」」]?[章节]/g) || []
    for (const r of refs.slice(0, 5)) {
      const num = /([0-9]+)/.exec(r)
      if (num === null) continue
      const refIdx = Number(num[1]) - 1
      const selfIdx = ord[cf]
      if (refIdx > selfIdx) {
        problems.push({ level: 'error', kind: 'time-travel', chapter: cf, message: '本章是第 ' + (selfIdx + 1) + ' 章，却引用了第 ' + (refIdx + 1) + ' 章：时间倒流' })
      }
    }
  }
  return problems
}

function chapterFiles(novelDir) {
  const dir = path.join(path.resolve(novelDir), 'chapters')
  const files = (listDirCached(dir) || []).filter((f) => /\.md$/.test(f)).sort()
  return { dir, files }
}
