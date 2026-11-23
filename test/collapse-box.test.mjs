import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ── 长文折叠块契约（0.4.11）───────────────────────────────────────────────
// 手机上「长页」不止正文：分卷规划、写作风格基准、设定条目描述、时间线、
// 索引板两列、伏笔看板——平铺出来比正文还长。统一成跟正文/章纲一个范式：
//   ① 头一行可点收起/展开（.myt-cbToggle，data-open 交 CSS 判，不用 :has）；
//   ② 展开时内容装进带边框方框自己滚（.myt-cbBody，高 --myt-box-h），
//      滚到底不把整页带走（overscroll-behavior: contain）；
//   ③ 条目级单条长描述用无头版 .myt-scrollBox（高 --myt-box-item-h）；
//   ④ tab 实例里长文块不许被 flex 挤扁（0.4.9 正文面板血泪同源）；
//   ⑤ 窄屏头部至少 38px 可点，且 @media 兜底副本与 @container 块一致。
// 设备上没有无头浏览器，只能守源码契约（与 mobile-layout.test.mjs 同法）。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(path.join(root, 'lib/base.css'), 'utf8')
const js = readFileSync(path.join(root, 'lib/client.js'), 'utf8')

// 顶格起块的括号配对切片（@container / @media 块都靠它取体）
const atRuleBlock = (query) => {
  const start = css.indexOf(query)
  assert.ok(start >= 0, '缺 at-rule 块 ' + query)
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) return css.slice(start, i + 1)
    }
  }
  throw new Error('at-rule 块未闭合：' + query)
}

// 顶层（任何 at-rule 之前）规则：基础样式必须无条��成立，不能只写在窄屏块里
const baseCss = css.slice(0, css.indexOf('@container (max-width: 560px)'))

test('折叠方框：带边框 + 框内滚动 + 不带走整页', () => {
  const body = css.match(/\.myt-cbBody \{([\s\S]*?)\n\}/)
  assert.ok(body, '缺 .myt-cbBody 规则')
  assert.match(body[1], /max-height: var\(--myt-box-h\)/, '框高没跟正文/章纲同一令牌')
  assert.match(body[1], /overflow-y: auto/, '框内没开纵向滚动')
  assert.match(body[1], /overscroll-behavior: contain/, '框内滚到底会带着整页跑')
  assert.match(body[1], /border: 1px solid var\(--dsw-alias-border-l1\)/, '方框没边框')
  assert.match(body[1], /border-radius:/, '方框没圆角')
})

test('条目级方框：矮一档的独立令牌', () => {
  assert.match(css, /--myt-box-item-h:\s*\d+vh/, ':root 缺 --myt-box-item-h 令牌')
  const box = css.match(/\.myt-scrollBox \{([\s\S]*?)\n\}/)
  assert.ok(box, '缺 .myt-scrollBox 规则')
  assert.match(box[1], /max-height: var\(--myt-box-item-h\)/, '条目框没用矮一档的高度')
  assert.match(box[1], /overflow-y: auto/, '条目框不能滚')
  assert.match(box[1], /overscroll-behavior: contain/, '条目框滚到底会带走整页')
})

test('折叠块不许被 flex 挤扁（0.4.9 血泪同源）', () => {
  assert.match(baseCss, /\.myt-viewTab \.myt-cbBox \{[^}]*flex: 0 0 auto/, 'tab 实例里折叠块会被挤成一条线')
  assert.match(baseCss, /\.myt-viewTab \.myt-cbBody \{[^}]*flex: 0 0 auto/, '框本身会被挤扁')
})

test('窄屏：头部 38px 可点，@media 兜底与 @container 一致', () => {
  const phone = atRuleBlock('@container (max-width: 640px)')
  assert.match(phone, /\.myt-cbToggle \{[^}]*min-height: 38px/, '窄屏折叠头没给够可点高度')
  assert.match(phone, /\.myt-cbHead \{[^}]*flex-wrap: wrap/, '窄屏折叠头挤成一行不折')
  assert.match(phone, /\.myt-cbExtra \{[^}]*margin-left: auto/, '窄屏动作行没右靠')
  const media = atRuleBlock('@media (max-width: 640px)')
  assert.ok(media.includes('.myt-cbToggle { min-height: 38px; }'), '@media 副本没同步折叠块（老 WebView 会漏）')
  assert.ok(media.includes('.myt-cbBody { padding: 8px 10px; }'), '@media 副本没同步框内留白')
})

test('组件：头一行可点收起，动作位不与 toggle 嵌套', () => {
  assert.match(js, /function CollapseBox\(props\)/, 'client.js 缺 CollapseBox 组件')
  const comp = js.slice(js.indexOf('function CollapseBox(props)'), js.indexOf('function OutlinePanel(props)'))
  assert.match(comp, /myt-cbBox/, '折叠块根没挂 .myt-cbBox')
  assert.match(comp, /"data-open": open \? "true" : "false"/, '根没给 data-open（老 WebView 无 :has 时要靠它）')
  assert.match(comp, /"aria-expanded": open \? "true" : "false"/, '折叠头缺 aria-expanded')
  assert.match(comp, /className: "myt-cbToggle"/, '折叠头不是可点按钮')
  assert.match(comp, /className: "myt-cbExtra"/, '动作位没独立容器（按钮不能嵌在 head 按钮里）')
  assert.match(comp, /open \? h\("div", \{ className: "myt-cbBody" \}/, '收起时正文仍在渲染')
})

test('长文落点：六个出口都接上折叠块', () => {
  const uses = js.match(/h\(CollapseBox/g) || []
  assert.ok(uses.length >= 6, '接上折叠块的出口只有 ' + uses.length + ' 个（分卷规划/写作风格/时间线/索引板两列/伏笔看板）')
  for (const [name, re] of [
    ['分卷规划', /title: tt\("overview\.volumes"\)/],
    ['写作风格', /title: tt\("tabs\.style"\)/],
    ['时间线', /title: tt\("tabs\.timeline"\)/],
    ['线索板', /title: tt\("index\.clueBoard"\)/],
    ['记忆板', /title: tt\("index\.memBoard"\)/],
    ['伏笔看板', /title: tt\("tabs\.foreshadows"\)/],
  ]) {
    assert.match(js, re, name + ' 没接折叠块')
  }
  const scrollBoxes = (js.match(/className: "myt-scrollBox"/g) || []).length
  assert.ok(scrollBoxes >= 3, '条目级长描述（概览简介/设定/科学/调研）只接了 ' + scrollBoxes + ' 处')
})
