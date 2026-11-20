import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ── 0.10.0 首帧渲染护栏 ────────────────────────────────────────────────────
// 面板黑屏是最贵的故障。新组件（版本卡/交接卡/热度条/派单菜单/关系补全）
// 至少要在无头环境真渲染一次：首帧不抛错、结构对、点得动。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(path.join(root, 'lib/client.js'), 'utf8')

function slice(startMark, endMark) {
  const i = source.indexOf(startMark)
  const j = source.indexOf(endMark)
  assert.ok(i > 0 && j > i, '找不到切片：' + startMark)
  return source.slice(i, j)
}

const BLOCK = slice('    // ── 书稿版本安全网（0.10.0）', '    // ── 关系起始章补全（0.10.0）')

function h(type, props) {
  return { type, props: props || {}, children: Array.prototype.slice.call(arguments, 2) }
}
function walk(node, out) {
  if (node === null || node === undefined || node === false || node === true) return out
  if (Array.isArray(node)) { node.forEach((n) => walk(n, out)); return out }
  if (typeof node === 'string' || typeof node === 'number') return out
  if (typeof node.type === 'function') { walk(node.type(node.props), out); return out }
  out.push(node)
  node.children.forEach((n) => walk(n, out))
  return out
}
const render = (tree) => walk(tree, [])
const byClass = (tree, cls) => render(tree).filter((n) => n.props && n.props.className === cls)

function harness(componentName) {
  const make = new Function('h', 'useState', 'useEffect', 'useRef', 'tt', 'tf', 'toast',
    'apiGet', 'apiPost', 'copyText', 'fmtNum', 'truncate', 'MaskPortal', 'tt2',
    BLOCK + '\nreturn ' + componentName + ';')
  let stateIndex = 0
  const states = []
  const calls = { posts: [], copied: [] }
  const C = make(
    h,
    function useState(initial) {
      const i = stateIndex++
      if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial
      return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v }]
    },
    function useEffect() {},
    function useRef(v) { return { current: v } },
    function tt(k) { return k },
    function tf(k, v) { return v ? k + ':' + JSON.stringify(v) : k },
    { ok() {}, warn() {}, err() {} },
    function apiGet() { return Promise.resolve(null) },
    function apiPost(p, b) { calls.posts.push({ p, b }); return Promise.resolve({ ok: true }) },
    function copyText(t) { calls.copied.push(t); return Promise.resolve() },
    function fmtNum(n) { return String(n) },
    function truncate(s, n) { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s },
    function MaskPortal(p) { return h('div', { className: 'mask' }, p.children) },
    function tt2(k) { return k }
  )
  return { C: (props) => { stateIndex = 0; return C(props) }, states, calls }
}

test('版本卡：首帧（数据未到）不抛错、不渲染半张卡', () => {
  const { C } = harness('VersionCard')
  const tree = C({ wsPath: '/x', reload: () => {} })
  assert.equal(tree, null)
})

test('热度条：分段上色，最热段落点名，空数据不渲染', () => {
  const { C } = harness('HeatStrip')
  assert.equal(C({ heat: [] }), null)
  const tree = C({ heat: [
    { index: 0, chars: 40, heat: 0, hits: [] },
    { index: 1, chars: 60, heat: 72, hits: ['长句 1', '软副词 2'] },
    { index: 2, chars: 30, heat: 35, hits: ['三项并列 1'] },
  ] })
  const cells = byClass(tree, 'myt-heatCell')
  assert.equal(cells.length, 3)
  assert.deepEqual(cells.map((c) => c.props['data-level']), ['0', '3', '2'])
  const head = byClass(tree, 'myt-heatHead')[0]
  assert.match(JSON.stringify(head.children), /第2段/, '没点名最热段')
})

test('派单菜单：点开有三份模板，点击复制对应正文', () => {
  const { C, states, calls } = harness('BriefMenu')
  const closed = C({ file: 'v01-c001.md', title: '第1章' })
  assert.equal(byClass(closed, 'myt-briefPop').length, 0)
  const openBtn = byClass(closed, 'myt-btn')[0]
  openBtn.props.onClick()
  const opened = C({ file: 'v01-c001.md', title: '第1章' })
  const items = byClass(opened, 'myt-briefItem')
  assert.equal(items.length, 3)
  items[0].props.onClick()
  assert.equal(calls.copied.length, 1)
  assert.match(calls.copied[0], /v01-c001\.md/)
})

test('客户端里每个 tt(key) / tf(key) 都在词典中（防键名笔误显示原文）', () => {
  const used = new Set()
  const re = /\b(?:tt|tf)\("([a-zA-Z][\w.]*)"/g
  let m
  while ((m = re.exec(source)) !== null) used.add(m[1])
  const missing = []
  for (const key of used) {
    if (key.endsWith('.')) continue // 动态拼接前缀（role./status./...），运行时才成完整键
    if (!source.includes('"' + key + '":')) missing.push(key)
  }
  assert.deepEqual(missing, [], '这些键没有出现在词典里：' + missing.join('、'))
})
