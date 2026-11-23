import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CSS = readFileSync(path.join(ROOT, 'lib/base.css'), 'utf8')
const CLIENT = readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8')

/**
 * 手机黑屏守卫（3.1.2）。
 *
 * 症状：手机上打开创作台，顶栏与页签都渲染出来了，下面一整块纯黑，看不见任何
 * 内容；同一份代码在桌面浏览器完全正常。
 *
 * 两条独立成因，都得挡：
 *   ① CSS：`inset: 0` 是 Chrome 87+ 语法。更老的 WebView 直接丢弃该声明，
 *      绝对定位的 overlay 容器没有宽高 → 面积 0 → 整屏只剩 body 底色。
 *      `@container` 同理（Chrome 105+），手机实拍早就有过「窄屏规则整体
 *      没命中」的先例，所以必须有 @media 孪生兜底。
 *   ② JS：外壳（顶栏 + tab 条 + 加载分支）没有被错误边界包住。`TabErrorBoundary`
 *      只护住 tab 内容，外壳一抛错整棵树就被 React 抹空——容器还在、有背景色、
 *      里面什么都没有，一样是「黑屏」。
 */

test('所有 inset:0 都补了四边（旧 WebView 不认 inset 简写）', () => {
  const hits = []
  const re = /inset:\s*0;/g
  let match
  while ((match = re.exec(CSS)) !== null) {
    const after = CSS.slice(match.index, match.index + 160)
    if (!/top:\s*0/.test(after)) {
      hits.push(CSS.slice(0, match.index).split('\n').length)
    }
  }
  assert.deepEqual(hits, [], '这些行的 inset 没有 top/right/bottom/left 兜底')
})

test('overlay 根即使四边全失效也要铺满（width/height 100% + min-height）', () => {
  const start = CSS.indexOf('[data-dsh-xiaoyu-novel-view]')
  assert.notEqual(start, -1, 'overlay 根选择器要存在')
  const block = CSS.slice(start, start + 900)
  // 3.2.0：改 fixed 定位后，宽高用 vw/vh 显式钉死（视口基准，不受祖先影响）。
  // 断言放宽成「显式写了视口单位或百分比」，语义不变：尺寸必须写死，不能靠继承。
  assert.match(block, /width:\s*(100%|100vw)/, '要显式写宽度')
  assert.match(block, /height:\s*(100%|100vh)/, '要显式写高度')
  assert.match(block, /min-height:/, '要有最小高，防止被内容撑成 0')
  assert.match(block, /background-color:\s*#/, '要有不依赖变量的兜底底色')
  assert.match(block, /position:\s*fixed/, '要用视口基准定位（absolute 会被祖先滚动/裁切坑死）')
})

test('每个 @container(max-width) 都有 @media 孪生（WebView 不支持容器查询）', () => {
  const containerWidths = [...CSS.matchAll(/@container \(max-width: (\d+)px\)/g)].map((m) => m[1])
  const mediaWidths = [...CSS.matchAll(/@media \(max-width: (\d+)px\) \{ \/\* @sync-media/g)].map((m) => m[1])
  assert.ok(containerWidths.length > 0, '应该有窄屏容器查询块')
  for (const width of containerWidths) {
    assert.ok(mediaWidths.includes(width), '缺 @media ' + width + 'px 孪生')
  }
  assert.equal(mediaWidths.length, containerWidths.length, '@container 与 @media 孪生数量要一致')
})

test('外壳有错误边界（否则手机上一抛错就是空白，连原因都看不到）', () => {
  assert.match(CLIENT, /class ShellErrorBoundary extends React\.Component/, '要有外壳级错误边界')
  assert.match(CLIENT, /getDerivedStateFromError/, '错误边界必须有 getDerivedStateFromError')
  assert.match(CLIENT, /h\(ShellErrorBoundary, \{/, '错误边界必须真的挂在树上')
  // 文案要人能看懂，并且给出可操作项
  assert.match(CLIENT, /面板渲染出错/, '降级文案要说明是渲染出错')
  assert.match(CLIENT, /浏览器版本/, '要告诉用户是浏览器兼容问题')
  assert.match(CLIENT, /sessionStorage\.setItem\("xiaoyu\.renderErrors"/, '手机上没法开控制台，错误要落盘可查')
})

test('错误边界降级页给出重试与关闭（不是死路）', () => {
  const start = CLIENT.indexOf('class ShellErrorBoundary')
  const block = CLIENT.slice(start, start + 2600)
  assert.match(block, /onClick: this\.retry/, '要有重试')
  assert.match(block, /this\.props\.onClose/, '要有关闭')
  assert.match(block, /navigator\.userAgent/, '要带上浏览器标识，便于判断兼容性')
})
