/**
 * 3.1.6 —— 主题变量后备值（手机黑屏第五轮，最终定位的根因）。
 *
 * 现场数据（手机自己上报到 xiaoyu-diag.log）：
 *   missingVars = [--dsw-alias-bg-base, --dsw-alias-bg-layer-1/2/3,
 *                  --dsw-alias-label-primary, --dsw-alias-border-l1,
 *                  --dsw-alias-state-business-primary]
 * 这台设备的 WebView 里，DSH 的主题变量**一个都没注入**。
 * 而 CSS 的规则是：变量不存在且没有后备值时，整条声明在计算值阶段退化成 unset
 * —— background 透明、color 继承、border 宽度归零。于是整块面板变成
 * 「一堆没有边框的透明块」，肉眼就是一片黑。
 *
 * 守卫目标：base.css 里**不许存在裸 var(--dsw-alias-*)**，包括嵌套在后备值里的
 * 那种（外层有后备值、后备值本身又是缺失变量，照样整条作废）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureVarFallbacks, FALLBACKS } from '../scripts/ensure-var-fallback.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RAW = readFileSync(path.join(root, 'lib', 'base.css'), 'utf8')
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, '')

test('base.css 里不许有裸 var(--dsw-alias-*)（含嵌套后备值里的）', () => {
  const bare = [...CSS.matchAll(/var\(--dsw-alias-[a-z0-9-]+\)/g)].map((m) => m[0])
  assert.deepEqual(
    [...new Set(bare)],
    [],
    '这些主题变量缺后备值：宿主不注入时整条声明会退化成 unset（= 黑屏）',
  )
})

test('后备值脚本幂等（跑第二遍不该再改任何东西）', () => {
  const first = ensureVarFallbacks(CSS)
  const second = ensureVarFallbacks(first.css)
  assert.equal(second.css, first.css, '脚本必须幂等，否则每次同步都会漂')
})

test('后备值覆盖所有实际用到的主题变量', () => {
  const used = new Set([...CSS.matchAll(/var\((--dsw-alias-[a-z0-9-]+)/g)].map((m) => m[1]))
  assert.ok(used.size > 10, '主题变量数目异常（' + used.size + '）')
  const missing = [...used].filter((name) => !FALLBACKS[name])
  assert.deepEqual(missing, [], '这些变量没有登记后备值')
})

test('后备值是深色且与兜底调色板块一致（否则又会出现深字深底）', () => {
  for (const [name, value] of Object.entries(FALLBACKS)) {
    assert.match(value, /^#[0-9a-f]{6}$/i, name + ' 的后备值必须是六位十六进制色')
  }
  assert.equal(FALLBACKS['--dsw-alias-bg-layer-1'], '#1d1f24')
  assert.equal(FALLBACKS['--dsw-alias-label-primary'], '#e9eaec')
  // 兜底属性块里定义的必须和脚本一致，否则「有 JS 探测」与「纯 CSS 兜底」两套会打架
  const block = CSS.slice(CSS.indexOf('[data-myt-novars]'))
  const end = block.indexOf('}')
  const body = block.slice(0, end)
  for (const [name, value] of Object.entries(FALLBACKS)) {
    if (!body.includes(name + ':')) continue
    assert.ok(body.includes(name + ': ' + value), name + ' 在 data-myt-novars 块里的值与脚本不一致')
  }
})

test('关键视觉属性都拿到了后代值（背景/文字/边框/主色）', () => {
  for (const needle of [
    'var(--dsw-alias-bg-layer-3, ',
    'var(--dsw-alias-label-primary, ',
    'var(--dsw-alias-border-l1, ',
    'var(--dsw-alias-state-business-primary, ',
  ]) {
    assert.ok(CSS.includes(needle), '缺 ' + needle)
  }
})

test('npm 里有同步脚本（改完 CSS 能一键补后备值）', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.ok(pkg.scripts && pkg.scripts['css:fallback'], '缺 css:fallback 脚本')
})
