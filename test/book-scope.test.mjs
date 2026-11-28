import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const panel = readFileSync(path.join(root, 'lib/standalone-panel.html'), 'utf8')
const core = readFileSync(path.join(root, 'lib/panel-core.mjs'), 'utf8')

// ── 3.58.0 选书是最高规则：选了哪本，所有功能都指向哪本 ─────

test('所有请求统一经 withNovel 注入 novel（get/postJson 两个入口）', () => {
  assert.ok(panel.includes('var merged = withNovel(params)'), 'get() 必须注入')
  assert.ok(panel.includes('JSON.stringify(withNovel('), 'postJson() 必须注入')
  assert.ok(panel.includes('if (S.novelDir) o.novel = S.novelDir'), 'withNovel 要有 novel 字段')
})

test('后端：没有 novel 参数时不许替用户挑（多本就 422）', () => {
  assert.ok(core.includes('这个工作区有'), '多本要明确报错')
  assert.ok(core.includes('必须先在「书库」选一本'), '要提示去选书')
  assert.ok(!core.includes('candidates.push'), '旧的兜底探测必须删掉')
})

test('后端：单书工作区自动用它（唯一解，不算猜默认）', () => {
  assert.ok(core.includes('if (found.length === 1) return found[0]'), '单书自动')
})

test('缓存键必须带书目录（否则切书命中老书缓存）', () => {
  assert.ok(panel.includes("'state.' + S.ws + '#' + (S.novelDir || '')"), '缓存键要含书')
})

test('切书时清缓存 + 重置数据', () => {
  assert.ok(panel.includes('切书必须先清缓存'), '要清缓存')
  assert.ok(panel.includes('S.data = null; S.dataErr'), '要重置数据')
})

test('顶栏始终显示当前书（选书可见）', () => {
  assert.ok(panel.includes("bn.id = 'bookName'"), '要有 bookName')
  assert.ok(panel.includes("'当前书：'"), '显示当前书')
  assert.ok(panel.includes("'未选书'"), '没选要提示')
})
