import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ── 0.15.1 章节表：章号 + 窄屏卡片 ────────────────────────────────────────
// 手机实拍：标题被省略号截断、门禁徽标压到字上，且看不出这是第几章。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const client = readFileSync(path.join(root, 'lib/client.js'), 'utf8')
const css = readFileSync(path.join(root, 'lib/base.css'), 'utf8')

test('章节表：每行带章号（num 优先，回落 vXX-cYYY 反推）', () => {
  assert.ok(client.includes('function chNo(ch)'), '缺 chNo 助手')
  assert.ok(/if \(n === null\) \{[\s\S]{0,160}-c\(\\d\+\)\$/i.test(client) || client.includes('/-c(\\d+)$/i'), '缺从文件名反推章号')
  assert.ok(client.includes('h("span", { className: "myt-chNo" }, chNo(ch))'), '标题单元格没渲染章号')
  const hits = client.split('"common.chapterNum":').length - 1
  assert.ok(hits >= 2, 'common.chapterNum 中英未双全')
})

test('章节表：六个单元格都带类名，窄屏可按类重排', () => {
  for (const cls of ['myt-tdVol', 'myt-tdTitle', 'myt-tdGate', 'myt-tdStatus', 'myt-tdWords', 'myt-tdSummary']) {
    assert.ok(client.includes('"' + cls + '"'), '缺单元格类 ' + cls)
  }
  assert.ok(client.includes('myt-table myt-table--chapters'), '表格根没加 myt-table--chapters')
})

test('窄屏卡片：容器查询里表格改 flex 行，标题可折行、门禁不再压字', () => {
  const start = css.indexOf('@container (max-width: 640px)')
  assert.ok(start > 0)
  let depth = 0
  let block = ''
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') { depth--; if (depth === 0) { block = css.slice(start, i + 1); break } }
  }
  assert.ok(/\.myt-table--chapters tr \{[^}]*display: flex/.test(block), '窄屏没把行改成 flex 卡片')
  assert.ok(/\.myt-tdTitle \.myt-chTitle \{[^}]*white-space: normal/.test(block), '标题仍然 nowrap（还是会被截断）')
  assert.ok(/\.myt-chNo \{ display: inline/.test(block), '窄屏没显示章号')
  assert.ok(/\.myt-tdGate \.myt-gate \{ margin-left: 0/.test(block), '门禁徽标仍带左外边距（贴着标题字）')
  assert.ok(/\.myt-tdVol, \.myt-tdSummary \{ display: none/.test(block), '窄屏没隐藏卷/摘要列')
})
