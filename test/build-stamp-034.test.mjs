/**
 * 3.1.7 —— 构建戳（真机「改了没反应」的可观测性修复）。
 *
 * 事故经过：连续四轮修手机黑屏都没在真机体现。最后从自检日志反推出根因——
 * 那个标签页里的 client.js 是开页时的那一份，重启宿主只换服务端、不换页面里的
 * JS，所以所有修改（含 collectDiag 本身）都没到达浏览器。
 * 这次的守卫不是为了修黑屏，而是为了让「跑的是哪一版」变成一眼可见的事实。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const JS = readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
const PKG = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

test('client.js 里有构建戳，且与 package.json 版本一致', () => {
  const m = JS.match(/var BUILD_STAMP = "([^"]*)";/)
  assert.ok(m, '缺 BUILD_STAMP')
  assert.equal(m[1], PKG.version, 'BUILD_STAMP 必须等于 package.json 的 version（跑 npm run stamp 同步）')
})

test('构建戳必须打到 DOM 上（手机的开发者工具不可用，徽章是唯一出口）', () => {
  assert.match(JS, /"data-xiaoyu-build": BUILD_STAMP/, '标题要带 data 属性')
  assert.match(JS, /"b" \+ BUILD_STAMP/, '标题要显示可见文本（b + 版本）')
  assert.match(JS, /out\.build = BUILD_STAMP/, '自检上报里要带构建戳')
})

test('构建戳不来自接口（否则缓存/离线时又看不出版本）', () => {
  const at = JS.indexOf('var BUILD_STAMP')
  assert.ok(at > 0)
  const line = JS.slice(at, JS.indexOf('\n', at))
  assert.match(line, /"[0-9]+\.[0-9]+\.[0-9]+"/, '必须是字面量版本号，不许从 API 取')
})

test('右侧栏 tab 形态也会上报自检（否则该形态在日志里完全静默）', () => {
  assert.match(JS, /tab-after-mount/, 'tab 形态要上报首次观察')
  assert.match(JS, /tab-settled/, 'tab 形态要上报收敛后观察')
  const at = JS.indexOf('function CreatorTabBody')
  const body = JS.slice(at, at + 3000)
  assert.match(body, /sendDiag\(collectDiag/, 'CreatorTabBody 里要真的调用上报')
})

test('pack 前自动同步构建戳（不靠人手记得改两处）', () => {
  assert.ok(PKG.scripts && PKG.scripts.stamp, '缺 npm run stamp')
  assert.match(PKG.scripts.pack || '', /stamp-build\.mjs/, 'pack 脚本要先跑 stamp')
})
