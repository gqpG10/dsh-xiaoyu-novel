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

test('面板正文：包 InstanceScope/.myt-view，关闭回对话面板', () => {
  assert.match(source, /function PanelBody\(\)/)
  assert.match(source, /h\(InstanceScope, \{ className: "myt-viewRoot" \}/)
  assert.match(source, /className: "myt-view myt-viewTab"/)
  assert.match(source, /layout\.selectPanel\(null\)/)
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
