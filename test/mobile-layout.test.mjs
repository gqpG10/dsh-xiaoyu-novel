import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ── 手机宽度适配契约（0.4.3）───────────────────────────────────────────────
// 面板会被塞进手机中栏（340-420px）或桌面右栏。守住四条：
//   ① 实例根是容器（container-type: inline-size），窄不窄按实例实宽判、不按窗口宽；
//   ② 窄容器里 .myt-page 的 720px 下限归零，否则整页横向滚动；
//   ③ 桌面上的紧凑档按钮在窄屏必须整体并到常规档（触控尺寸），且不能漏掉任何
//      一个紧凑容器——CSS 结构与桌面紧凑档逐一对照；
//   ④ 章节表砍两列、阅读页标题独占一行、弹层铺满。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(path.join(root, 'lib/base.css'), 'utf8')

const containerBlock = (query) => {
  const start = css.indexOf(query)
  assert.ok(start >= 0, '缺容器查询 ' + query)
  // 括号配对扫到本块结束（\n}\n 顶格）
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) return css.slice(start, i + 1)
    }
  }
  throw new Error('容器查询块未闭合：' + query)
}

test('实例根是容器：按自身实宽做容器查询', () => {
  assert.match(css, /\.myt-view \{[^}]*container-type: inline-size/, '.myt-view 缺 container-type: inline-size')
  assert.match(css, /\.myt-viewTab \{[^}]*container-type: inline-size/, '.myt-viewTab 缺 container-type: inline-size')
})

test('窄容器：整页不再有 720px 下限，骨架让位', () => {
  const phone = containerBlock('@container (max-width: 640px)')
  assert.ok(/\.myt-page \{[^}]*min-width: 0/.test(phone), '手机档没有把 .myt-page 的 min-width 归零')
  assert.ok(/\.myt-header \{[^}]*flex-wrap: wrap/.test(phone), '顶栏没折行')
  assert.ok(/\.myt-headActions \{[^}]*width: 100%/.test(phone), '动作行没整行占满')
  assert.ok(/\.myt-body \{[^}]*padding: 12px 14px/.test(phone), '内容区留白没收紧')
  assert.ok(/\.myt-tabs \{/.test(phone), 'tab 条没适配')
})

test('窄屏按钮并档：桌面紧凑档的每个容器都要覆盖到', () => {
  const compactStart = css.indexOf('.myt-btnSm,')
  assert.ok(compactStart > 0, '找不到桌面紧凑档合并规则')
  const selectorText = css.slice(compactStart, css.indexOf('{', compactStart))
  const selectors = selectorText.split(',').map((s) => s.trim()).filter(Boolean)
  assert.ok(selectors.length >= 8, '桌面紧凑档选择器数量异常：' + selectors.length)
  const phone = containerBlock('@container (max-width: 640px)')
  for (const sel of selectors) {
    assert.ok(phone.includes(sel), '手机档漏了紧凑容器 ' + sel + '（会留 22px 小按钮）')
  }
  assert.ok(/height: var\(--myt-btn-h\)/.test(phone), '手机档没有并到常规档高度')
})

test('窄屏章节表：砍两列 + 固定布局，不再横向滑', () => {
  const phone = containerBlock('@container (max-width: 640px)')
  assert.ok(/\.myt-table \{ table-layout: fixed/.test(phone), '章节表没改固定布局')
  assert.ok(/\.myt-table th:nth-child\(1\), \.myt-table td:nth-child\(1\)/.test(phone), '没隐藏「卷·章」列')
  assert.ok(/.myt-table th:nth-child\(6\)/.test(phone), '没隐藏「梗概」列')
})

test('窄屏阅读页与弹层：标题整行、正文不套内层滚动、弹层铺满', () => {
  const phone = containerBlock('@container (max-width: 640px)')
  assert.ok(/\.myt-readerTitle \{[^}]*flex-basis: 100%/.test(phone), '阅读页标题没独占一行')
  assert.ok(/\.myt-chapterBody \{ max-height: var\(--myt-box-h\)/.test(phone), '正文高度没给足（仍 48vh 或失控）')
  assert.ok(/\.myt-editFsShell \{[^}]*width: 100%/.test(phone), '全屏编辑没铺满')
  assert.ok(/\.myt-modalCard, \.myt-srcCard, \.myt-confirmCard, \.myt-settings \{ width: 100%/.test(phone), '弹层没铺满')
})

test('更窄一档（≤440px）：看板与九件套单列', () => {
  const tiny = containerBlock('@container (max-width: 440px)')
  assert.ok(/\.myt-board \{ grid-template-columns: 1fr/.test(tiny), '看板没单列')
  assert.ok(/\.myt-setupGrid \{ grid-template-columns: 1fr/.test(tiny), '九件套没单列')
  assert.ok(/\.myt-writeOrderExcerpt \{ display: none/.test(tiny), '摘要行没让位')
})
// ── 0.4.4：阅读页正文优先 ────────────────────────────────────────────────
// 手机上章纲一展开，正文卡（flex:1 1 auto + min-height:0）把剩余高度全让出去、
// 只剩一行。守住：正文卡在窄实例里按内容自然长，章纲面局限高让位，且窄实例
// 默认收起（布局前按自身实宽判，避免闪一下再收）。

test('窄屏阅读页：正文给足高度 + 字号可读（不再被 flex 压成一行）', () => {
  const phone = containerBlock('@container (max-width: 640px)')
  assert.ok(/\.myt-viewTab \.myt-bodyPanel \.myt-chapterBody \{ flex: 0 0 auto; max-height: var\(--myt-box-h\)/.test(phone), '正文仍会被 flex 收缩压成一行 / 没给足高度')
  assert.ok(/\.myt-chapterBody \{ max-height: var\(--myt-box-h\); font-size: 14px; line-height: 24px/.test(phone), '正文窄屏字号/行高没抬到 14/24')
})

test('正文面板：与章纲对照同族的可折叠块（data-open 判折叠态）', () => {
  assert.ok(/\.myt-bodyHead \{[^}]*display: flex/.test(css), '缺正文面板头（不可折叠）')
  assert.ok(/\.myt-viewTab \.myt-bodyPanel \{ flex: 0 0 auto/.test(css), '面板没改成按内容定高（0.4.9：收起与展开都不许吃剩余高度）')
  const phone = containerBlock('@container (max-width: 640px)')
  assert.ok(/\.myt-bodyHead \{ min-height: 38px/.test(phone), '正文面板头触控高度不足')
  const js = readFileSync(path.join(root, 'lib/client.js'), 'utf8')
  const idx = js.indexOf('function BodyPanel(props)')
  assert.ok(idx > 0, '找不到 BodyPanel')
  const chunk = js.slice(idx, idx + 1400)
  assert.ok(/data-open/.test(chunk), '面板根没带 data-open（CSS 判不了折叠态）')
  assert.ok(/aria-expanded/.test(chunk), '折叠头缺 aria-expanded')
})

test('窄屏章纲对照：限高让位 + 头部可点', () => {
  const phone = containerBlock('@container (max-width: 640px)')
  assert.ok(/\.myt-outlineBody \{ max-height: var\(--myt-box-h\)/.test(phone), '章纲对照展开没限高（会顶掉正文）')
  assert.ok(/\.myt-outlineHead \{[^}]*min-height: 38px/.test(phone), '章纲头触控高度不足')
  assert.ok(/\.myt-outlinePanel \{ flex: 0 0 auto/.test(phone), '章纲面板没禁收缩')
})

test('章纲对照：窄实例默认收起（按自身实宽判，宽实例仍展开）', () => {
  const js = readFileSync(path.join(root, 'lib/client.js'), 'utf8')
  const idx = js.indexOf('function OutlinePanel(props)')
  assert.ok(idx > 0, '找不到 OutlinePanel')
  const chunk = js.slice(idx, idx + 1600)
  assert.ok(/useLayoutEffect\(function \(\)/.test(chunk), '缺布局前测量：手机上会先展开闪一下再收起')
  assert.ok(/el\.clientWidth/.test(chunk), '判据不是面板自身实宽（窗口宽在右栏/中栏都测不准）')
  assert.ok(/w > 0 && w < 560/.test(chunk), '缺窄实例阈值 560')
  assert.ok(/className: "myt-outlinePanel", ref: panelRef/.test(chunk), '测宽的 ref 没挂到面板根')
})
test('正文是"一个框"：带边框、框内滚动、滚动链不外溢', () => {
  // 同 collapse-box：允许令牌自带后备值（缺主题变量的设备靠它才看得见边框）
  assert.ok(/\.myt-bodyPanel \.myt-chapterBody \{[^}]*border: 1px solid var\(--dsw-alias-border-l1(?:,[^)]*)?\)/.test(css), '正文在面板里没有自己的边框（不成框）')
  assert.ok(/\.myt-bodyPanel \.myt-chapterBody \{[^}]*overscroll-behavior: contain/.test(css), '框内滚到底会带着整页跑')
  assert.ok(/\.myt-outlineBody \{[^}]*overscroll-behavior: contain/.test(css), '章纲框同样缺滚动隔离')
  assert.ok(/\.myt-chapterBody \{ max-height: var\(--myt-box-h\)/.test(css), '正文框没给固定高度（要么撑长要么太小）')
})
test('章纲框与正文框同高（一个 --myt-box-h 管两条框），且面板不被 flex 挤扁', () => {
  assert.ok(/:root \{[\s\S]*--myt-box-h: 40vh/.test(css), ':root 缺 --myt-box-h（两条框各写死高度会漂）')
  const phone = containerBlock('@container (max-width: 640px)')
  assert.ok(/\.myt-viewTab \.myt-bodyPanel \{ flex: 0 0 auto/.test(phone), '正文面板会被 flex 挤扁（overflow:hidden 把框裁成两行）')
  assert.ok(/\.myt-outlineBody \{ max-height: var\(--myt-box-h\)/.test(phone), '章纲框没用共享高度')
  assert.ok(/\.myt-chapterBody \{ max-height: var\(--myt-box-h\)/.test(phone), '正文框没用共享高度')
})
// ── 0.4.9：@media 兜底 + 面板不许被挤扁 + 样式热更 ──────────────────────
// 手机实拍：窄屏规则整体没命中（WebView 未必支持容器查询），正文面板被基础
// 规则的 flex 收缩压成空条，且改完 CSS 重开面板还是旧样式（<link> 只注入一次）。

const blockOf = (text, start, label) => {
  assert.ok(start >= 0, '找不到块 ' + label)
  let depth = 0
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) return text.slice(text.indexOf('{', start) + 1, i)
    }
  }
  throw new Error('块未闭合：' + label)
}

test('@media 兜底：每个 @container 窄屏块都有一份逐字相同的 @media 副本', () => {
  const re = /@container \(max-width: (\d+)px\) \{/g
  let m
  let count = 0
  while ((m = re.exec(css)) !== null) {
    count++
    const w = m[1]
    const body = blockOf(css, m.index, '@container (max-width: ' + w + 'px)')
    const mediaBody = blockOf(css, css.indexOf('@media (max-width: ' + w + 'px) {'), '@media (max-width: ' + w + 'px)')
    assert.equal(mediaBody.replace(/\/\* @sync-media[^*]*\*\//, '').trim(), body.replace(/\/\*[^*]*@sync-media[^*]*\*\//, '').trim(),
      '@media ' + w + 'px 与 @container ' + w + 'px 内容不一致（跑 node scripts/sync-css-media.mjs）')
  }
  assert.ok(count >= 3, '容器查询块数量异常：' + count)
})

test('正文面板在基础规则里就不许被挤扁（不靠 at-rule 兜底）', () => {
  const baseRule = /\.myt-viewTab \.myt-bodyPanel \{ flex: 0 0 auto/.test(css)
  assert.ok(baseRule, '基础规则仍是 flex:1 1 auto（面板会被压成空条，框整个被 overflow 裁掉）')
  assert.ok(!/\.myt-viewTab \.myt-bodyPanel \.myt-chapterBody \{ flex: 1 1 auto; max-height: none/.test(css), '仍存在把正文拉满并禁上限的旧规则')
})

test('样式热更：重开面板会重新取 CSS（不必重启宿主）', () => {
  const js = readFileSync(path.join(root, 'lib/client.js'), 'utf8')
  assert.ok(js.includes('function refreshCss()'), '缺 refreshCss')
  assert.ok(/link\.setAttribute\("href", CSS_URL \+ "\?t=" \+ Date\.now\(\)\)/.test(js), '没带时间戳换 href（WebView 会吃内存缓存）')
  assert.ok(js.includes('refreshCss(); // 样式也重取'), '面板重开时没刷新样式')
})