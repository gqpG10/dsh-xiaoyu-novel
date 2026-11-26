import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const panel = readFileSync(path.join(root, 'lib/standalone-panel.html'), 'utf8')

// ── 3.31.0 批量勾选不跳顶 / 滚动保持 ───────────────────────────────

test('批量勾选：勾一下不再整页 render（只就地更新计数）', () => {
  const seg = panel.slice(panel.indexOf("querySelectorAll('.selChk')"), panel.indexOf("querySelectorAll('.selChk')") + 900)
  assert.ok(seg.includes('updateSelCount()'), '勾选后必须调 updateSelCount 而不是 render')
  assert.ok(!/S\.selSet\[c\.getAttribute\('data-file'\)\] = c\.checked;\s*render\(\)/.test(seg), '不许整页重绘（会跳回顶部）')
  assert.match(panel, /function updateSelCount\(\)/)
  assert.match(panel, /id="selCount"/)
})

test('滚动保持：render 前后记/恢复 scrollTop + 下一帧再还原', () => {
  assert.match(panel, /keepScroll/)
  assert.match(panel, /restoreScroll/)
  assert.match(panel, /requestAnimationFrame\(restoreScroll\)/)
  assert.match(panel, /vv\.scrollTop = keepScroll/)
})

test('雷达：新解析（INITIAL_STATE 无空格等号 + category_id 翻名）', () => {
  const mod = readFileSync(path.join(root, 'lib/trend-radar.mjs'), 'utf8')
  assert.match(mod, /window\.__INITIAL_STATE__/)
  assert.match(mod, /rankCategoryTypeList/)
  assert.match(mod, /curent_category_id/)
  assert.match(mod, /mergeBookLists/)
})
