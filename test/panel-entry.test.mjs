import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ── 入口位置契约（0.14.0）──────────────────────────────────────────────────
// 用户要求把「小鱼创作台」从左侧栏底部动作位挪到顶部面板列表（和插件/自动化
// 任务同一组）。宿主的面板列表读 `sidebar.panellist`，点行调
// `layout.selectPanel(id)`，而它要求同 id 的 `main` 面板已注册——所以入口必须
// 成对注册。这层守住三件事：
//   ① 成对注册（main.key === panellist.id === xiaoyu-novel-creator）；
//   ② 老宿主没有 layout/main 槽时能退回 footer.action，功能不丢；
//   ③ 关闭按钮回「对话」面板（selectPanel(null)），不把用户卡在空面板。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(path.join(root, 'lib/client.js'), 'utf8')

test('入口成对注册：main.key 与 panellist.id 同为 xiaoyu-novel-creator', () => {
  assert.match(source, /var PANEL_ID = "xiaoyu-novel-creator"/)
  assert.match(source, /register\(\{ name: "main", key: PANEL_ID \}/)
  assert.match(source, /register\(\{ name: "sidebar\.panellist", id: PANEL_ID, order: PANEL_ORDER, label: "小鱼创作台" \}/)
  assert.match(source, /selectPanel === "function"/)
})

test('面板正文：iframe 挂独立版面板（3.2.1 起黑屏源 PageShell 不再渲染）', () => {
  assert.match(source, /function PanelBody\(\)/)
  // 3.2.1：三种形态（main 槽/overlay/tab）的正文一律 iframe 挂 /api/xiaoyu-novel/panel。
  // 真机实测 PageShell（React 主面板）全黑且与版本无关，独立版是唯一被验证能显示的。
  assert.match(source, /var STANDALONE_URL = "\/api\/xiaoyu-novel\/panel"/)
  const frames = (source.match(/src: STANDALONE_URL/g) || []).length
  assert.ok(frames >= 3, 'main 槽/overlay/右侧栏 tab 三处都要 iframe 挂独立版，实际 ' + frames)
  // 黑屏源必须彻底退出创作台主面板的渲染（ReaderTabBody 的阅读页除外）
  assert.doesNotMatch(source, /h\(PageShell/, 'PageShell 不许再被渲染（真机黑屏本体）')
})

test('注册失败退回底部入口 + 中栏 overlay（老宿主不丢功能）', () => {
  assert.match(source, /if \(panelHandle\) \{/)
  assert.match(source, /mountFooterEntry\(ctx, controller, sbHandleRef, ensureSbHandle\)/)
  assert.match(source, /mountPanel\(controller, \{ sbReady: sbReady/)
  assert.match(source, /falling back to footer/)
})

test('smoke 同步了新入口契约（否则 CI 会按旧 footer 断言误报）', () => {
  const smoke = readFileSync(path.join(root, 'scripts/smoke-client.mjs'), 'utf8')
  assert.match(smoke, /injectedSlots\.includes\('main'\)/)
  assert.match(smoke, /sidebar\.panellist/)
  assert.match(smoke, /mainMeta\.key !== 'xiaoyu-novel-creator'/)
})
