/**
 * 3.1.3 —— 手机黑屏第二轮：「inset 丢失 + 缺错误边界」两个假设都被实拍否掉之后的
 * 静态守卫。这一版的思路从「猜根因」改成「让它自己报现场 + 把可能塌陷的几何/
 * 配色全部兜死」。本文件只断言那些「只有手机才会暴露、桌面永远正常」的不变式。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CSS_RAW = readFileSync(path.join(root, 'lib', 'base.css'), 'utf8')
// 断言声明时必须先剥掉注释：注释里会引用旧写法（"原来是 min-height:0"），
// 不剥就会把说明文字当成真声明来判，测试自己骗自己。
const CSS = CSS_RAW.replace(/\/\*[\s\S]*?\*\//g, '')
const JS = readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
const SERVER = readFileSync(path.join(root, 'index.mjs'), 'utf8')

test('内容区不允许 min-height:0（祖先高度链一断就是精确 0 高，手机即黑屏）', () => {
  const start = CSS.indexOf('.myt-body {')
  assert.notEqual(start, -1, '要有 .myt-body 规则')
  const block = CSS.slice(start, CSS.indexOf('}', start))
  assert.doesNotMatch(block, /min-height:\s*0/, '.myt-body 不能 min-height:0')
  assert.match(block, /min-height:\s*\d+px/, '.myt-body 要有像素下限')
})

test('外壳与实例根都有 min-height 兜底（height:100% 解析成 auto 时不塌）', () => {
  const shell = CSS.slice(CSS.indexOf('.myt-shell {'), CSS.indexOf('}', CSS.indexOf('.myt-shell {')))
  assert.match(shell, /min-height:\s*100%/, '.myt-shell 要 min-height:100%')
  const viewRoots = [...CSS.matchAll(/\.myt-viewRoot \{[^}]*\}/g)].map((m) => m[0])
  assert.ok(viewRoots.length > 0, '要有 .myt-viewRoot 规则')
  for (const rule of viewRoots) {
    assert.doesNotMatch(rule, /min-height:\s*0/, '.myt-viewRoot 不能 min-height:0')
    assert.match(rule, /min-height:/, '.myt-viewRoot 要有 min-height')
  }
})

test('宿主主题变量缺席时有兜底调色板（变量没定义 → 整条声明退化成 unset → 全透明）', () => {
  assert.match(CSS, /\[data-myt-novars\]/, '要有 data-myt-novars 兜底块')
  const start = CSS.indexOf('[data-myt-novars]')
  const block = CSS.slice(start, CSS.indexOf('}', start))
  for (const name of ['--dsw-alias-bg-layer-1', '--dsw-alias-label-primary', '--dsw-alias-border-l1', '--dsw-alias-state-business-primary']) {
    assert.ok(block.includes(name + ':'), '兜底块要定义 ' + name)
  }
  // 兜底块绝不能挂在 .myt-view / :root 上，否则会盖掉宿主主题（桌面亮色也被拖黑）
  assert.doesNotMatch(CSS, /\.myt-view\s*\{[^}]*--dsw-alias-bg-layer-1/, '不能直接在 .myt-view 上重定义主题变量')
})

test('客户端探测主题变量并在缺失时打 data-myt-novars', () => {
  assert.match(JS, /function applyVarFallback/, '要有探测函数')
  assert.match(JS, /--dsw-alias-bg-layer-1/, '探测要读实际存在的那个变量')
  assert.match(JS, /data-myt-novars/, '缺失时要打属性')
  const callSites = (JS.match(/applyVarFallback\(/g) || []).length
  assert.ok(callSites >= 3, 'overlay 与 tab 两种形态都要探测（至少 3 处：定义 1 + 调用 2），实际 ' + callSites)
})

test('黑屏自检：能把量到的几何/样式/命中元素上报服务端', () => {
  assert.match(JS, /function collectDiag/, '要有 collectDiag')
  assert.match(JS, /function sendDiag/, '要有 sendDiag')
  assert.match(JS, /elementFromPoint/, '要记录黑区中心点上到底压着谁')
  assert.match(JS, /getBoundingClientRect/, '要记录真实几何')
  assert.match(JS, /client-diag/, '要走 client-diag 上报路由')
  for (const key of ['myt-shell', 'myt-body', 'myt-header']) {
    assert.ok(JS.includes(key), '自检要覆盖 ' + key)
  }
  assert.match(SERVER, /route === 'client-diag'/, '服务端要有接收路由')
  assert.match(SERVER, /xiaoyu-diag\.log/, '上报要落盘成日志文件')
})

test('自检面板有手动入口（顶栏「自检」按钮，不依赖用户开控制台）', () => {
  assert.match(JS, /"自检"/, '顶栏要有自检按钮')
  assert.match(JS, /copyText\(text\)/, '要把现场数据复制到剪贴板')
})

test('自检绝不反过来弄坏面板：所有采集/上报都在 try 内', () => {
  const start = JS.indexOf('function collectDiag')
  const body = JS.slice(start, JS.indexOf('function sendDiag'))
  assert.match(body, /try \{/, 'collectDiag 要包 try')
  assert.match(body, /catch \(e\)/, 'collectDiag 要 catch')
  const sendStart = JS.indexOf('function sendDiag')
  const sendBody = JS.slice(sendStart, sendStart + 700)
  assert.match(sendBody, /catch/, 'sendDiag 要有 catch')
})

test('内容区永远不许渲染成空：body 分支必须有兜底 else（这才是手机黑屏真凶）', () => {
  // 病灶：workspaces 到手、工作区有效、不在加载、无报错，但 snap 为 null
  // （loadState 里 setSnap(d && d.ok ? d : null) 把 ok:false 的载荷丢了，且没
  // 设置 stateErr）。旧代码没有兜底分支，body 保持 null → 内容区精确空。
  assert.match(JS, /SHELL_BRANCH/, '要有分支记录变量')
  assert.match(JS, /function workspaceBranch/, '要有分支判定函数')
  assert.match(JS, /empty:snapshot-missing/, '要能区分「快照缺席」这一分支')
  // 兜底分支必须自带重试入口，不能只显示一句死话
  const idx = JS.indexOf('内容区没有拿到数据')
  assert.notEqual(idx, -1, '兜底分支要有可读标题')
  const around = JS.slice(idx, idx + 1200)
  assert.match(around, /重新拉取/, '兜底分支要给重试按钮')
  assert.match(around, /effectiveWs/, '兜底分支要显示是哪个工作区')
})

test('快照缺席的分支要能在自检里被识别（否则下次仍只能靠猜）', () => {
  assert.match(JS, /out.shellBranch = SHELL_BRANCH/, '自检要上报当前分支')
})

