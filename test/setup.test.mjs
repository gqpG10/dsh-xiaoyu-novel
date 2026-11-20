import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkSetup } from '../lib/setup-core.mjs'
import { checkFormat } from '../lib/format-core.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const PROJECT = `title: 测试书
author: 测试
genre: 都市异能
length: 约100万字
language: zh
phase: writing
mode: ai-draft
description: 一句话简介
`

const CHAPTER = (volume, num, title) => `---
volume: v01
num: ${num}
title: ${title}
status: pending
summary: 一句话梗概
cognitive_frame: 读者认知推进
emotional_anchor: 情绪锚点
world_texture: 世界细节
suspense: 章尾问题
interpersonal_tension: 人物压力
---

正文段落，写得像人写的。门开了，谁也没进来。
`

const CHAR = (name, role) => `---
name: ${name}
age: 20
gender: 男
role: ${role}
appearance: 外貌一句话
personality: 性格
background: 出身
motivation: 动机
arc: 成长弧线
---

备注。
`

function makeProject(dir, { complete = true } = {}) {
  const novel = path.join(dir, 'novel')
  mkdirSync(path.join(novel, 'chapters'), { recursive: true })
  mkdirSync(path.join(novel, 'characters'), { recursive: true })
  mkdirSync(path.join(novel, 'world'), { recursive: true })
  writeFileSync(path.join(novel, 'project.yml'), complete ? PROJECT : 'title: 测试书\nphase: writing\n', 'utf8')
  const chapters = ['v01-c001.md', 'v01-c002.md', 'v01-c003.md']
  chapters.forEach((file, i) => writeFileSync(path.join(novel, 'chapters', file), CHAPTER('v01', i + 1, '第' + (i + 1) + '章'), 'utf8'))
  writeFileSync(path.join(novel, 'chapters', 'v01-c001.md'), `---
volume: v01
num: 1
title: 第一章
status: writing
summary: 一句话梗概
cognitive_frame: 读者认知推进
emotional_anchor: 情绪锚点
world_texture: 世界细节
suspense: 章尾问题
interpersonal_tension: 人物压力
---

${'门是被踹开的。他先听见鞋跟磕在门槛上，金属磕水泥。'.repeat(20)}
`, 'utf8')
  ;['lin', 'shen', 'su'].forEach((slug, i) => writeFileSync(path.join(novel, 'characters', slug + '.md'), CHAR(['林晚儿', '沈墨', '苏三'][i], i === 0 ? 'protagonist' : (i === 1 ? 'antagonist' : 'supporting')), 'utf8'))
  writeFileSync(path.join(novel, 'foreshadows.yml'), ['fs-001', 'fs-002', 'fs-003'].map((id, i) => `- id: ${id}
  title: 伏笔${i}
  status: planted
  priority: high
  source: plan
  planted_chapter: v01-c00${i + 1}
  expected_resolve: v01-c020
  resolved_chapter: ""
  notes: 备注`).join('\n'), 'utf8')
  writeFileSync(path.join(novel, 'relations.yml'), `- a: lin
  b: shen
  type: 宿敌
  description: 张力
  intensity: 4
  started: v01-c001
  ended: ""
- a: su
  b: lin
  type: 同门
  description: 张力
  intensity: 3
  started: v01-c002
  ended: ""
`, 'utf8')
  writeFileSync(path.join(novel, 'timeline.yml'), `- year: 玄历1024年
  title: 前史一
  description: 说明
  importance: 4
  chapter: v01-c001
- year: 玄历1025年
  title: 前史二
  description: 说明
  importance: 3
  chapter: v01-c002
`, 'utf8')
  ;['world-rules', 'world-factions'].forEach((slug) => writeFileSync(path.join(novel, 'world', slug + '.md'), `---
category: 概念
tags:
  - 测试
---

${'这条规则写清了边界与代价。'.repeat(12)}
`, 'utf8'))
  writeFileSync(path.join(novel, 'style.md'), '# 写作风格基准\n\n## 语言\n\n' + '大白话，口语，短句。'.repeat(30) + '\n\n## 节奏\n\n单章两千字。\n\n## 禁忌\n\n不写翻译腔。\n', 'utf8')
  writeFileSync(path.join(novel, 'index.yml'), `chapters:
  - no: 1
    title: 第一章
    file: chapters/v01-c001.md
  - no: 2
    title: 第二章
    file: chapters/v01-c002.md
  - no: 3
    title: 第三章
    file: chapters/v01-c003.md
`, 'utf8')
  return novel
}

test('开书九件套：齐全时九项全绿', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-setup-'))
  try {
    const novel = makeProject(dir, { complete: true })
    const result = checkSetup(novel)
    assert.equal(result.total, 9)
    assert.equal(result.complete, true, JSON.stringify(result.items, null, 2))
    assert.deepEqual(result.items.map((i) => i.key), ['overview', 'chapters', 'characters', 'foreshadows', 'relations', 'timeline', 'world', 'style', 'index'])
    // 格式全绿
    const fmt = checkFormat(novel)
    assert.deepEqual(fmt.problems.filter((p) => p.level === 'error'), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('开书九件套：空项目逐项报缺', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-setup-empty-'))
  try {
    const novel = makeProject(dir, { complete: false })
    // 删掉角色与设定，模拟只搭了骨架
    rmSync(path.join(novel, 'characters'), { recursive: true, force: true })
    rmSync(path.join(novel, 'world'), { recursive: true, force: true })
    const result = checkSetup(novel)
    assert.equal(result.complete, false)
    const missing = result.items.filter((i) => !i.done).map((i) => i.key)
    for (const key of ['overview', 'characters', 'world']) assert.ok(missing.includes(key), '应缺 ' + key)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('格式硬校验：未知键/缺字段/围栏未闭合/文件名不合规/索引不一致', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-format-'))
  try {
    const novel = makeProject(dir)
    // project.yml 塞未知键 + 删一个字段
    writeFileSync(path.join(novel, 'project.yml'), PROJECT.replace('language: zh\n', 'language: zh\nfoo: bar\n').replace('author: 测试\n', ''), 'utf8')
    // 章节文件名不合规 + frontmatter 未闭合
    writeFileSync(path.join(novel, 'chapters', 'badname.md'), '---\ntitle: 坏文件\n', 'utf8')
    // 角色卡未知键
    writeFileSync(path.join(novel, 'characters', 'lin.md'), CHAR('林晚儿', 'protagonist').replace('age: 20', 'age: 20\nlevel: 99'), 'utf8')
    // 索引条数不符
    writeFileSync(path.join(novel, 'index.yml'), 'chapters:\n  - no: 1\n    title: 一\n    file: chapters/v01-c001.md\n', 'utf8')
    const fmt = checkFormat(novel)
    const all = fmt.problems.map((p) => p.file + '|' + p.message).join('\n')
    assert.match(all, /project\.yml\|未知字段「foo」/)
    assert.match(all, /project\.yml\|缺字段「author」/)
    assert.match(all, /chapters\/badname\.md\|文件名不合/)
    assert.match(all, /characters\/lin\.md\|frontmatter 未知字段「level」/)
    assert.match(all, /index\.yml\|索引 1 条与 chapters\/ 4 章不一致/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI setup：齐全退出 0，缺项退出 1', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-setup-cli-'))
  try {
    const novel = makeProject(dir)
    const bin = path.join(root, 'bin', 'xiaoyu-novel.mjs')
    const ok = spawnSync(process.execPath, [bin, 'setup', novel], { encoding: 'utf8' })
    assert.equal(ok.status, 0, ok.stdout + ok.stderr)
    assert.match(ok.stdout, /开书九件套：9\/9/)

    rmSync(path.join(novel, 'characters'), { recursive: true, force: true })
    const bad = spawnSync(process.execPath, [bin, 'setup', novel], { encoding: 'utf8' })
    assert.equal(bad.status, 1)
    assert.match(bad.stdout, /✗ 角色/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
test('章节索引：流式 index.yml（派生重建的真实形状）也算已建', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-setup-index-'))
  try {
    const novel = makeProject(dir, { complete: true })
    // 真实项目里 index.yml 是 novel-parse 现写的流式条目——旧判据只认 "- no:" /
    // "- file:"，一条都匹配不上，有 19 章也报「内容为空」。
    writeFileSync(path.join(novel, 'index.yml'), `volumes:
  - id: v01
    title: 卷一
    chapters:
        - {num: 1, title: 第一章, status: accepted, words: 2540, summary: 梗概}
        - {num: 2, title: 第二章, status: accepted, words: 2100, summary: 梗概}
orphans:
  - {volume: v02, num: 3, title: 第三章, status: accepted, words: 2000, summary: 梗概}
`, 'utf8')
    const item = checkSetup(novel).items.find((i) => i.key === 'index')
    assert.equal(item.done, true, '流式条目被误判：' + item.detail)
    assert.equal(item.label, '章节索引', '标签仍叫索引板，会和面板「索引板」tab（clues/memories）看串')
    // 只有注释 / 空索引壳仍算空
    writeFileSync(path.join(novel, 'index.yml'), '# 空索引\nvolumes: []\norphans: []\n', 'utf8')
    assert.equal(checkSetup(novel).items.find((i) => i.key === 'index').done, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
test('格式硬校验：派生流式索引不再误报「索引 0 条与 chapters/ N 章不一致」', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-format-index-'))
  try {
    const novel = makeProject(dir, { complete: true })
    // 3 章 + 流式 3 条（与 buildIndex 输出同形）
    writeFileSync(path.join(novel, 'index.yml'), `volumes:
  - id: v01
    title: 卷一
    chapters:
        - {num: 1, title: 第一章, status: accepted, words: 2540, summary: 梗概}
        - {num: 2, title: 第二章, status: accepted, words: 2100, summary: 梗概}
        - {num: 3, title: 第三章, status: accepted, words: 2000, summary: 梗概}
`, 'utf8')
    const fmt = checkFormat(novel)
    assert.deepEqual(fmt.problems.filter((p) => p.file === 'index.yml'), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
