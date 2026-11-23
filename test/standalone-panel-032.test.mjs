/**
 * 3.1.5 —— 独立版面板（零依赖页）的守卫。
 *
 * 主面板在中低端 Android WebView 上连续四轮黑屏，最后的手段是给一个
 * 「什么都不依赖」的版本：内联样式 + 原生 DOM + 文档流布局 + 同一套 API。
 * 本文件锁死三条不可退让的性质：
 *   1. 自包含——不许引任何外部样式表或脚本（引了就可能再黑一次）
 *   2. 脚本语法必须可解析（页面里的内联脚本是手写的，没有构建期校验）
 *   3. 必须真的把数据接口用起来（不是个空壳）
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { STANDALONE_PANEL_HTML as H } from '../lib/standalone-panel.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERVER = readFileSync(path.join(root, 'index.mjs'), 'utf8')

test('独立版面板：完整 HTML 文档', () => {
  assert.ok(H.startsWith('<!DOCTYPE html>'), '要有 doctype')
  assert.ok(H.trimEnd().endsWith('</html>'), '要闭合')
  assert.match(H, /<meta[^>]+viewport/, '要有 viewport（手机上不缩放错乱）')
  assert.match(H, /lang="zh-CN"/, '要声明语言')
})

test('独立版面板：完全自包含（不引外部样式/脚本，否则可能再黑一次）', () => {
  assert.doesNotMatch(H, /<link[^>]+stylesheet/i, '不许引外部样式表')
  assert.doesNotMatch(H, /<script[^>]+src=/i, '不许引外部脚本')
  assert.match(H, /<style>/, '样式必须内联')
  // 不许依赖宿主主题变量：变量缺失时整条声明会退化，这正是黑屏的成因之一
  assert.doesNotMatch(H, /--dsw-alias-/, '不许依赖宿主 CSS 变量')
})

test('独立版面板：内联脚本语法可解析', () => {
  const m = H.match(/<script>([\s\S]*?)<\/script>/)
  assert.ok(m, '要有内联脚本')
  assert.doesNotThrow(() => new Function(m[1]), '内联脚本语法必须合法')
})

test('独立版面板：真的接了数据接口（不是空壳）', () => {
  for (const route of ['workspaces', 'state', 'chapter', 'update-check', 'client-diag']) {
    assert.ok(H.includes("'" + route + "'"), '要调用 ' + route + ' 接口')
  }
  assert.match(H, /\/api\/xiaoyu-novel\//, '接口前缀要对')
})

test('独立版面板：九个分区都在', () => {
  for (const tab of ['overview', 'chapters', 'characters', 'foreshadows', 'relations', 'timeline', 'world', 'index']) {
    assert.ok(H.includes("'" + tab + "'"), '缺分区 ' + tab)
  }
})

test('独立版面板：服务端有路由且禁止缓存', () => {
  assert.match(SERVER, /route === 'panel' && req.method === 'GET'/, '要有 panel 路由')
  assert.match(SERVER, /standalone-panel\.html/, '路由要下发独立版 HTML')
  const at = SERVER.indexOf("route === 'panel'")
  const block = SERVER.slice(at, at + 900)
  assert.match(block, /no-store/, '独立版页面不许被缓存')
  // 页面正文现读磁盘，改版不必重启宿主（与 client.css 同款）
  assert.match(block, /readFile\(new URL\('\.\/lib\/standalone-panel\.html'/, '要现读 lib/standalone-panel.html')
  assert.match(block, /ok: false/, '文件缺失时要有明确错误，不能静默')
})

test('独立版面板：快照 ok:false 必须显式报错（主面板就栽在静默吞掉）', () => {
  assert.match(H, /d\.ok === false/, '要显式判断 ok:false 并报错')
  assert.match(H, /状态快照为空/, '要给出可读原因')
})
