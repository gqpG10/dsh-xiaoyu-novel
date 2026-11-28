import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chapterContext } from '../lib/chapter-context.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ── 3.57.0 文风基准进入写作流程 + 可打回 ─────────────────────

function book(styleMd, presetMd) {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-357-'))
  mkdirSync(path.join(dir, 'chapters'), { recursive: true })
  mkdirSync(path.join(dir, 'style-presets'), { recursive: true })
  writeFileSync(path.join(dir, 'chapters', 'v01-c001.md'), '---\nnum: 1\n---\n正文。', 'utf8')
  if (styleMd) writeFileSync(path.join(dir, 'style.md'), styleMd, 'utf8')
  if (presetMd) writeFileSync(path.join(dir, 'style-presets', 'baihua-fengqu.md'), presetMd, 'utf8')
  return dir
}

test('本章上下文带出文风规则（style.md 语言节）', () => {
  const dir = book('## 语言\n\n- 短句优先，口语动词优先。\n- 禁书面腔。\n\n## 节奏\n\n- 别的节不要带。\n')
  const ctx = chapterContext(dir, 'v01-c001')
  assert.ok(ctx.styleRules, '要有 styleRules')
  assert.match(ctx.styleRules.md, /短句优先/)
  assert.match(ctx.styleRules.md, /禁书面腔/)
  assert.ok(!ctx.styleRules.md.includes('别的节'), '不能带出其他节')
})

test('本章上下文带出当前档位要点', () => {
  const dir = book('## 语言\n\n- 白话打底。（style-presets/baihua-fengqu.md）\n',
    '# 档位\n\n- 句长必须错落\n- 脏话 ≤3 处\n')
  const ctx = chapterContext(dir, 'v01-c001')
  assert.equal(ctx.styleRules.register, 'baihua-fengqu')
  assert.ok(ctx.styleRules.points.length >= 2)
  assert.ok(ctx.styleRules.points.some((p) => p.includes('句长')))
})

test('没有 style.md 时 styleRules 不炸', () => {
  const dir = book(null, null)
  const ctx = chapterContext(dir, 'v01-c001')
  assert.ok(ctx.styleRules === null || typeof ctx.styleRules === 'object')
})

test('预检：文风 ≥3 条升级为 block，1~2 条仍 warn', () => {
  const pf = readFileSync(path.join(root, 'lib/preflight.mjs'), 'utf8')
  assert.ok(pf.includes("n >= 3 ? 'block' : 'warn'"), '要按条数分级')
  assert.ok(pf.includes('建议打回重写'), 'block 时给打回提示')
  assert.ok(pf.includes('count: n'), '要带问题条数')
})

test('面板：本章显示文风基准卡 + 预检有打回重写按钮', () => {
  const panel = readFileSync(path.join(root, 'lib/standalone-panel.html'), 'utf8')
  assert.ok(panel.includes('文风基准'), '本章要有文风基准卡')
  assert.ok(panel.includes('styleRules'), '要读 ctx.styleRules')
  assert.ok(panel.includes('rewriteBtn'), '预检要有打回按钮')
  assert.ok(panel.includes('bindRewriteButtons'), '要绑定打回按钮')
  assert.ok(panel.includes('已复制重写指令'), '点打回要复制重写指令')
})
