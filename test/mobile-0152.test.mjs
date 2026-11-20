import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ── 0.15.2：保存软刷新 / 位置记忆 / 窄屏顶栏与分析卡 ───────────────────────
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const client = readFileSync(path.join(root, 'lib/client.js'), 'utf8')
const css = readFileSync(path.join(root, 'lib/base.css'), 'utf8')

test('保存后走软刷新：lite 快照 + 保留账本块，不全量重拉', () => {
  assert.ok(client.includes('var reloadSoft = useCallback('), '缺 reloadSoft')
  // 0.22.0：软刷新从 scope=lite 换成 blocks=<首屏骨架>——比 lite 更精确（连
  // 章节正文之外的大块都省了），但语义一样：只拉首屏要的，别全量重拉。
  assert.ok(/reloadSoft[\s\S]{0,600}blocks: FIRST_SCREEN_BLOCKS/.test(client), '软刷新没用 blocks 裁剪')
  assert.ok(/\(d\.partial \|\| \[\]\)\.forEach/.test(client), '软刷新没把 lite 清空的块用旧值补回')
  assert.ok(client.includes('props.reloadSoft'), '保存后的定时刷新没接 reloadSoft')
})

test('位置记忆：tab 与上次打开的章节按工作区存 localStorage', () => {
  assert.ok(client.includes('myt-tab:'), '缺 tab 记忆键')
  assert.ok(client.includes('myt-reader:'), '缺章节记忆键')
  assert.ok(/savedTab && TABS\.some/.test(client), '恢复 tab 时没校验合法性')
  assert.ok(/snap\.chapters\.some\(function \(c\) \{ return c\.file === savedFile/.test(client), '恢复章节时没校验文件还在')
  assert.ok(/skipWriteRef/.test(client), '缺「恢复当轮不覆盖」保护（会把记住的 tab 冲成概览）')
})

test('窄屏顶栏：动作行可折行、工作区下拉独占一行', () => {
  const start = css.indexOf('@container (max-width: 640px)')
  let depth = 0
  let block = ''
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') { depth--; if (depth === 0) { block = css.slice(start, i + 1); break } }
  }
  assert.ok(/\.myt-headActions \{[^}]*flex-wrap: wrap/.test(block), '动作行没折行（下拉会被挤成空框）')
  assert.ok(/\.myt-headActions \.myt-wsSelect \{[^}]*flex: 1 1 100%/.test(block), '工作区下拉没独占一行')
})

test('分析卡：窄屏默认收起，按钮展开；宽屏不出现按钮', () => {
  assert.ok(client.includes('myt-analysisToggle'), '缺分析卡收纳按钮')
  assert.ok(client.includes('myt-analysisCards'), '缺分析卡容器')
  assert.ok(/\.myt-analysisToggle \{ display: none/.test(css), '按钮宽屏应隐藏')
  assert.ok(/\.myt-analysisCards\[data-open="false"\] \{ display: none/.test(css), '窄屏收起规则缺失')
})

test('门禁双分：窄屏露出检测器分（手机上 title 看不到）', () => {
  assert.ok(client.includes('myt-gateDet'), '徽标没带检测器分节点')
  assert.ok(/\.myt-gateDet \{ display: none/.test(css), '宽屏应隐藏检测器分')
  assert.ok(/\.myt-gateDet \{ display: inline/.test(css), '窄屏没显示检测器分')
})
