import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const css = read('lib/base.css')

// ── 按钮尺度契约（0.4.2）─────────────────────────────────────────────────────
// 面板按钮只许两档：常规 30px / 紧凑 22px，圆角与字号随档走同一组变量。局部
// 容器不得再写死 height/padding/font-size/border-radius，否则同一行里按钮就
// 会一大一小（0.4.1 及之前阅读页工具行就是这个毛病：复制类按钮 22px、其余 30px）。

test('按钮尺寸令牌：两档高度 + 两档圆角 + 胶囊高度', () => {
  for (const decl of [
    '--myt-btn-h: 30px',
    '--myt-btn-sm: 22px',
    '--myt-btn-r: 8px',
    '--myt-btn-rsm: 6px',
    '--myt-chip-h: 26px',
  ]) {
    assert.ok(css.includes(decl), '缺少尺寸令牌 ' + decl)
  }
})

test('.myt-btn 用令牌定高定圆角（不再靠 padding 撑出高度）', () => {
  const block = css.slice(css.indexOf('.myt-btn {'), css.indexOf('.myt-btn:hover'))
  assert.ok(block.includes('box-sizing: border-box'), '.myt-btn 缺 box-sizing: border-box')
  assert.ok(block.includes('height: var(--myt-btn-h)'), '.myt-btn 没走 --myt-btn-h')
  assert.ok(block.includes('padding: 0 12px'), '.myt-btn 内距应只有左右（纵向归 height）')
  assert.ok(block.includes('border-radius: var(--myt-btn-r)'), '.myt-btn 没走 --myt-btn-r')
})

test('紧凑档整行列名：阅读页/编辑器/看板卡/按单写作/逐句建议', () => {
  const start = css.indexOf('.myt-btnSm,')
  assert.ok(start > 0, '缺紧凑档合并规则 .myt-btnSm')
  const block = css.slice(start, css.indexOf('}', start))
  for (const sel of [
    '.myt-readerBar .myt-btn',
    '.myt-editTools .myt-btn',
    '.myt-editFsGroup .myt-btn',
    '.myt-writeOrderRow .myt-btn',
    '.myt-itemActions .myt-btn',
    '.myt-fsActions .myt-btn',
    '.myt-gateFixBtn',
  ]) {
    assert.ok(block.includes(sel), '紧凑档缺 ' + sel)
  }
  assert.ok(block.includes('height: var(--myt-btn-sm)'), '紧凑档没走 --myt-btn-sm')
  assert.ok(block.includes('border-radius: var(--myt-btn-rsm)'), '紧凑档没走 --myt-btn-rsm')
})

test('无上下文私设按钮尺寸：.x .myt-btn 规则只许布局属性', () => {
  const re = /\.myt-[A-Za-z0-9]+ \.myt-btn\s*\{([^}]*)\}/g
  let m
  const offenders = []
  while ((m = re.exec(css)) !== null) {
    const body = m[1]
    if (/\b(height|padding|font-size|border-radius)\s*:/.test(body)) {
      offenders.push(m[0].replace(/\s+/g, ' ').slice(0, 80))
    }
  }
  assert.deepEqual(offenders, [], '这些上下文规则私设了按钮尺寸：' + offenders.join(' | '))
})

test('图标按钮方形、胶囊同高', () => {
  assert.ok(css.includes('.myt-btnIcon { width: var(--myt-btn-h); padding: 0; }'), '图标按钮应宽=高')
  for (const sel of ['.myt-filterPill', '.myt-setOpt']) {
    const i = css.indexOf(sel + ' {')
    const block = css.slice(i, css.indexOf('}', i))
    assert.ok(block.includes('height: var(--myt-chip-h)'), sel + ' 没走 --myt-chip-h')
  }
})

// ── 主编派单提示词契约（0.4.2）─────────────────────────────────────────────
// 人设「派活」四段与面板复制的派单提示词必须同构，且条件与 0.4.1 一致（≥78、
// 检测器五项、字数 ≤10%、零改动确认）——优化的是表达结构，不是验收结果。

const sectionOf = (text, head, next) => {
  const i = text.indexOf(head)
  const j = text.indexOf(next, i + head.length)
  assert.ok(i >= 0 && j > i, '找不到段落 ' + head)
  return text.slice(i, j).replace(/^[ \t]+/gm, '').trim()
}

test('人设「派活」四段：v1 与 v2 逐字一致（防漂移）', () => {
  const v1 = sectionOf(read('presets/xiaoyu-novel/agent.cordis.yml'), '## 派活', '## 开工纪律')
  const v2 = sectionOf(read('presets/xiaoyu-novel/agent.cordis.v2.yml'), '## 派活', '## 开工纪律')
  assert.equal(v1, v2, 'v1/v2 的派活段落不一致')
  for (const part of ['1. 目标', '2. 输入', '3. 边界', '4. 回报']) {
    assert.ok(v1.includes(part), '派活四段缺 ' + part)
  }
  assert.ok(v1.includes('缺段不派'), '缺「缺段不派」硬约束')
  assert.ok(v1.includes('三不：不替帮手写实现方案、不改写用户需求、不追加验收标准'), '缺三不')
  for (const role of ['outline', 'draft', 'polish', 'review', 'lore', 'research']) {
    assert.ok(v1.includes(role + '（'), '派活分工缺 ' + role)
  }
})

test('面板派单提示词：四段结构 + 原验收条件不放松（zh/en）', () => {
  const js = read('lib/client.js')
  const NL = String.fromCharCode(92) + 'n' // 源码里是字面量 \n 转义
  const briefLine = (marker) => {
    const line = js.split('\n').find((l) => l.includes(marker))
    assert.ok(line, '找不到派单提示词行：' + marker)
    return line
  }
  for (const [label, marker, gateLine, drift] of [
    ['zh', '"gate.brief": "请以小鱼创作主编身份派单给 polish', '人味指数 ≥78，检测器五项同步过线', '字数浮动不超过 10%'],
    ['en', '"gate.brief": "Dispatch from the Xiaoyu editor-in-chief', 'human score ≥78 and all five detector metrics', 'word-count drift ≤10%'],
  ]) {
    const line = briefLine(marker)
    assert.ok(line.includes(gateLine), label + ' 丢了过闸线原文')
    assert.ok(line.includes(drift), label + ' 丢了字数上限')
    for (const n of ['1', '2', '3', '4']) {
      assert.ok(line.includes(NL + n + '. '), label + ' 缺第 ' + n + ' 段编号')
    }
  }
})
