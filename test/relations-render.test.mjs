import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ── 关系图首帧渲染 ──────────────────────────────────────────────────────────
// 面板黑屏/白屏是这套 UI 最贵的故障（用户已经被两次改版锁在门外），所以关系
// 图 0.9.0 补一层「不启浏览器也能渲染一次」的护栏：
//   ① 把 client.js 里从 NODE_ROLE_COLORS 到 RelationsTab 结束的整段源码抠出来，
//      配 stub 版 React（useState/useMemo/useRef 直通、useEffect 不执行）求值；
//   ② 用真实快照喂一次首帧，断言渲染成树、没有抛错、根节点是 .myt-stack；
//   ③ 顺着树找关系行/人名按钮/类型 chip，点一下确认回调真的接到了 setter 与
//      onOpenChar（事件接线断掉同样是「点了没反应」级故障）；
//   ④ 空书（无角色无关系）走空态分支，不许抛错。
// 只覆盖渲染与事件接线，画布绘制仍靠 scripts/smoke-client.mjs 与真机验收。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')

function sliceRelationsBlock() {
  const start = source.indexOf('    var NODE_ROLE_COLORS =')
  assert.ok(start > 0, '找不到关系图代码段起点（NODE_ROLE_COLORS）')
  const end = source.indexOf('\n    // ── cordis client 插件入口')
  assert.ok(end > start, '找不到关系图代码段终点（cordis 入口注释）')
  return source.slice(start, end)
}

const BLOCK = sliceRelationsBlock()

function h(type, props) {
  const children = Array.prototype.slice.call(arguments, 2)
  return { type: type, props: props || {}, children: children }
}
function flatten(node, out) {
  if (node === null || node === undefined || node === false || node === true) return out
  if (Array.isArray(node)) {
    node.forEach(function (n) { flatten(n, out) })
    return out
  }
  if (typeof node === 'string' || typeof node === 'number') return out
  // 函数式组件就地展开，模拟 React 的一次渲染（Empty 之类才会真出树）
  if (typeof node.type === 'function') {
    flatten(node.type(node.props), out)
    return out
  }
  out.push(node)
  node.children.forEach(function (n) { flatten(n, out) })
  return out
}
const walk = (tree) => flatten(tree, [])
const byClass = (tree, cls) => walk(tree).filter((n) => n.props && n.props.className === cls)

function makeHarness(snap) {
  const calls = { setters: [], openChar: [] }
  let stateIdx = 0
  const states = []
  const makeComponent = new Function(
    'h', 'useState', 'useEffect', 'useMemo', 'useRef', 'useCallback',
    'tt', 'tf', 'Empty', 'srcEditBtn', 'MaskPortal', 'SourceEditorModal', 'toast',
    'chFullTitle', 'truncate',
    BLOCK + '\nreturn RelationsTab;'
  )
  const RelationsTab = makeComponent(
    h,
    function useState(initial) {
      const i = stateIdx++
      if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial
      const setter = function (v) {
        const next = typeof v === 'function' ? v(states[i]) : v
        calls.setters.push({ slot: i, value: next })
        states[i] = next
      }
      return [states[i], setter]
    },
    function useEffect() {}, // 副作用不跑：画布/全屏都依赖真 DOM
    function useMemo(fn) { return fn() },
    function useRef(v) { return { current: v } },
    function useCallback(fn) { return fn },
    function tt(key) { return key },
    function tf(key, vars) { return vars ? key + ':' + JSON.stringify(vars) : key },
    function Empty(props) { return h('div', { className: 'empty' }, props.text) },
    function srcEditBtn() { return h('button', { className: 'srcEdit' }) },
    function MaskPortal(props) { return h('div', { className: 'mask' }, props.children) },
    function SourceEditorModal() { return h('div', { className: 'srcModal' }) },
    { ok() {}, warn() {}, err() {} },
    function chFullTitle(ch) { return ch.title || ch.file },
    function truncate(s, n) {
      const t = String(s === null || s === undefined ? '' : s)
      return t.length > n ? t.slice(0, n - 1) + '…' : t
    }
  )
  const tree = RelationsTab({
    snap: snap,
    wsPath: '/tmp/ws',
    reload: function () {},
    gotoTab: function () {},
    onOpenChar: function (name) { calls.openChar.push(name) },
  })
  return { tree: tree, calls: calls }
}

const SNAP = {
  // 快照里 chapters[].file 带 .md 后缀，relations.started 是裸 stem——两边必须
  // 能对上号，否则按章过滤静默失效（0.9.2 现场故障：选章节整张图纹丝不动）
  chapters: [
    { file: 'v01-c001.md', volume: 'v01', num: 1, title: '第一章', status: 'done', words: 2000 },
    { file: 'v01-c003.md', volume: 'v01', num: 3, title: '第三章', status: 'writing', words: 1800 },
  ],
  characters: [
    { file: 'chen-lei.md', name: '陈磊', role: 'protagonist' },
    { file: 'song-jiajia.md', name: '宋佳佳', role: 'supporting' },
    { file: 'jia-zhengjing.md', name: '贾正经', role: 'antagonist' },
  ],
  relations: [
    {
      a: '陈磊', b: '贾正经', type: '对立', description: '裁员上司造谣他偷数据', intensity: 5,
      started: 'v01-c001', ended: '', direction: 'a-to-b', phase: 'now', tags: ['打脸'], stages: [],
    },
    {
      a: '陈磊', b: '宋佳佳', type: '同盟', description: '里应外合递刀', intensity: 5,
      started: 'v01-c001', ended: '', direction: 'both', phase: 'now', tags: [],
      stages: [
        { chapter: 'v01-c001', type: '雇佣', description: '刚招进来', intensity: 2, phase: 'now' },
        { chapter: 'v01-c003', type: '同盟', description: '正式递刀', intensity: 5, phase: 'now' },
      ],
    },
    // 未开始（第 3 章之后才出现）：默认按章过滤必须藏起来
    {
      a: '宋佳佳', b: '贾正经', type: '雇佣', description: '夹缝玩火', intensity: 2,
      started: 'v01-c009', ended: '', direction: 'both', phase: 'now', tags: [], stages: [],
    },
  ],
}

test('关系图首帧：渲染成树，不抛错，根是 .myt-stack', () => {
  const { tree } = makeHarness(SNAP)
  assert.ok(tree && tree.props && tree.props.className === 'myt-stack', '根节点不是 .myt-stack')
  const nodes = walk(tree)
  assert.ok(nodes.length > 30, '渲染树过小，疑似提前 return：' + nodes.length)
  assert.equal(byClass(tree, 'myt-graphCanvas').length, 1, '画布没渲染')
  assert.equal(byClass(tree, 'myt-relList').length, 1, '关系清单没渲染')
})

test('关系图首帧：默认只画到最新章节，未来关系与阶段都按章解析', () => {
  const { tree } = makeHarness(SNAP)
  const rows = byClass(tree, 'myt-relRow')
  // 默认章 = 最后一章 v01-c003：c009 才开始的雇佣关系本该隐藏 → 只剩两条
  assert.equal(rows.length, 2, '按章过滤没生效，实得 ' + rows.length + ' 行')
  // 陈磊—宋佳佳 在第 3 章解析为「同盟 5」，不是基字段之外的第 1 阶段
  const types = byClass(tree, 'myt-relType').map((n) => n.children[0])
  assert.ok(types.includes('同盟'), '阶段解析没取到当前章的类型：' + types.join('/'))
})

test('关系图首帧：点行/点人名/点类型 chip 都接到回调', () => {
  const { tree, calls } = makeHarness(SNAP)
  const row = byClass(tree, 'myt-relRow')[0]
  row.props.onClick()
  assert.equal(calls.setters.length, 1, '点行没有触发状态更新')
  assert.equal(calls.setters[0].value, 0, '点行应把选中下标置 0')

  const nameBtn = byClass(tree, 'myt-relNameBtn')[0]
  nameBtn.props.onClick({ stopPropagation() {} })
  assert.equal(calls.openChar.length, 1, '点人名没有跳角色卡')
  assert.equal(calls.openChar[0], '陈磊')

  const chip = byClass(tree, 'myt-chip').find((n) => n.props['data-on'] !== undefined)
  chip.props.onClick()
  const last = calls.setters[calls.setters.length - 1]
  // 塞进 setState 的是函数（基于旧值增删），stub 已按旧值求值：空 → ['对立']
  assert.deepEqual(last.value, ['对立'], '点 chip 没把该类型加入筛选')
})

test('关系图首帧：空书走空态，不抛错', () => {
  const { tree } = makeHarness({ chapters: [], characters: [], relations: [] })
  assert.ok(tree && tree.props.className === 'myt-stack')
  assert.equal(byClass(tree, 'myt-graphCanvas').length, 0, '空书不该渲染画布')
  assert.equal(byClass(tree, 'empty').length, 1, '空书没给空态文案')
})
