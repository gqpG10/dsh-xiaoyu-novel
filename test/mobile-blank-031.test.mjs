/**
 * 3.1.4 —— 第三轮实拍反馈（还是黑屏 + 正文划不动 + 检测更新没反应）的静态守卫。
 *
 * 这一轮的关键认知：百分比高度只有在「父级高度是确定值」时才解得出来。
 * overlay 根只写 height:100% 时，中栏高度若不是确定值，整条链（.myt-view →
 * .myt-viewRoot → .myt-shell 的 100% → .myt-body 的 flex:1）全部失去参照，
 * 内容区拿到 0 高：既看不见（黑屏），也滚不动（划不动）。
 * 加多少 min-height 都救不了这一点 —— min-height 不产生确定高度。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CSS = readFileSync(path.join(root, 'lib', 'base.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const JS = readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
const SERVER = readFileSync(path.join(root, 'index.mjs'), 'utf8')

const ruleOf = (selector) => {
  const at = CSS.indexOf(selector + ' {')
  assert.notEqual(at, -1, '缺规则 ' + selector)
  return CSS.slice(at, CSS.indexOf('}', at) + 1)
}

test('overlay 根必须有确定高度（vh），只写百分比会整条链失参照', () => {
  const rule = ruleOf('[data-dsh-xiaoyu-novel-view]')
  assert.match(rule, /height:\s*100vh/, 'overlay 根要有 height:100vh 这样的确定值')
  assert.match(rule, /max-height:\s*100vh/, '要限制不超出视口（超出就滚不到底）')
  assert.match(rule, /overflow:\s*hidden/, '超出部分交给内部滚动器，别推到屏外')
})

test('内容区必须声明触摸滚动（Android WebView 缺了就是「划不动」）', () => {
  const rule = ruleOf('.myt-body')
  assert.match(rule, /overflow-y:\s*auto/, '.myt-body 要是滚动器')
  assert.match(rule, /touch-action:\s*pan-y/, '要声明纵向触摸滚动')
  assert.match(rule, /-webkit-overflow-scrolling:\s*touch/, '要惯性滚动')
  assert.match(rule, /overscroll-behavior:\s*contain/, '滚到底不许带着整页跑')
})

test('正文框同样是触摸滚动容器（框内滚）', () => {
  assert.ok(/touch-action:\s*pan-y/.test(CSS), '缺 touch-action')
  // 基础规则与窄屏规则都要覆盖到正文框
  const hits = [...CSS.matchAll(/\.myt-chapterBody \{[^}]*touch-action:\s*pan-y[^}]*\}/g)]
  assert.ok(hits.length >= 1, '正文框没声明触摸滚动')
})

test('外壳与实例根都是确定高度链（100% + max-height + overflow）', () => {
  const shell = ruleOf('.myt-shell')
  assert.match(shell, /height:\s*100%/, '外壳要撑满确定高度的父级')
  assert.match(shell, /max-height:\s*100%/, '外壳不许被内容顶出可视区')
  const viewRoots = [...CSS.matchAll(/\.myt-viewRoot \{[^}]*\}/g)].map((m) => m[0])
  assert.ok(viewRoots.length > 0, '缺 .myt-viewRoot')
  for (const r of viewRoots) {
    assert.match(r, /max-height:\s*100%/, '.myt-viewRoot 要限高')
    assert.match(r, /overflow:\s*hidden/, '.myt-viewRoot 要裁切超出部分')
  }
})

test('JS 撑高必须写确定 height，不能只写 min-height', () => {
  const start = JS.indexOf('applyHeightFloor = function')
  assert.notEqual(start, -1, '要有 applyHeightFloor')
  const body = JS.slice(start, start + 1600)
  assert.match(body, /container\.style\.height\s*=/, '必须写 container.style.height（确定值），只写 minHeight 不解题')
  assert.match(body, /container\.style\.minHeight\s*=/, '同时写 minHeight 兜底')
})

test('独立探针页存在：不依赖 React 也能自证 CSS 是否生效', () => {
  assert.match(SERVER, /route === 'client-env'/, '要有 client-env 探针路由')
  assert.match(SERVER, /client\.css\?v=/, '探针页要带缓存穿透参数加载面板 CSS')
  assert.match(SERVER, /静态副本/, '探针页要有静态副本区')
  assert.match(SERVER, /canScroll/, '探针页要检测内容区能不能滚')
  assert.match(SERVER, /missingVars/, '探针页要报告缺失的主题变量')
})

test('版本检测不再被 gh 探测拖住（结果缓存，超时压到 3s）', () => {
  const file = readFileSync(path.join(root, 'lib', 'github-update.mjs'), 'utf8')
  assert.match(file, /ghReadyCache/, 'gh 探测结果要缓存')
  assert.match(file, /timeoutMs:\s*3000/, 'gh 探测超时要压短')
})
