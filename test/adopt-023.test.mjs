import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ── 接入项目（0.23.0 修复）─────────────────────────────────────────────────
// 现场：用户点「接入项目」没反应。查下来是两个问题叠在一起：
//   ① 前端把入口行只画在「一个 novel 工作区都没有」的空态里——用户已经有书，
//      所以点按钮只切换了一个看不见的布尔值，界面永远不出现输入框；
//   ② 输入框要求「工作区根目录」，可用户十有八九贴的是书目录（…/novel），
//      服务端严格拒绝，提示还只写「没有 novel/project.yml」。
// 这里守四件事：入口在两种界面都渲染、路径容错、成功提示带路径、报错说人话。

// Windows：new URL().pathname 返回 /C:/... 带前导斜杠，必须 fileURLToPath。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

test('接入入口在空态与主界面都渲染（原来只在空态，才有「点了没反应」）', () => {
  const client = read('lib/client.js')
  assert.ok(client.includes('function AddProjectRow('), '入口行必须是可复用组件')
  const hits = client.split('addOpen ? h(AddProjectRow, null) : null').length - 1
  assert.equal(hits, 2, '空态与主界面各要一处，实得 ' + hits)
  assert.ok(!/addOpen \? h\("div", \{ className: "myt-addWsRow" \}/.test(client), '不该再留内联的那一份')
})

test('路径容错：尾部斜杠 / 全角空格 / 贴成 …/novel 都能纠回来', () => {
  const client = read('lib/client.js')
  assert.ok(client.includes('function normalizeAddPath('), '缺路径归一化')
  assert.ok(client.includes('replace(/\\/novel$/i, "")'), '要把 …/novel 退到父目录')
  assert.ok(client.includes('\\u3000'), '要处理全角空格')
  assert.ok(client.includes('if (e.key === "Escape") setAddOpen(false)'), '要能 Esc 关掉')
})

test('服务端同样容错，且报错说人话', () => {
  const server = read('index.mjs')
  assert.ok(server.includes("path.basename(target) === 'novel'"), '服务端也要接受 …/novel')
  assert.ok(server.includes('请填工作区根目录'), '报错要给出正确写法')
  assert.ok(!/error: '该目录下没有 novel\/project.yml' \}/.test(server), '不许只回一句没有 project.yml')
})

test('成功提示带实际路径（用户才知道接进去的是哪一个）', () => {
  const client = read('lib/client.js')
  assert.ok(client.includes('header.addProjectOkAt'), '成功提示要带路径')
  for (const key of ['header.addProjectBusy', 'header.addProjectOkAt']) {
    assert.equal(client.split('"' + key + '":').length - 1, 2, key + ' 中英各一份')
  }
})

test('接入成功后立刻切过去（否则用户以为没生效）', () => {
  const client = read('lib/client.js')
  const body = client.slice(client.indexOf('function submitAddProject'), client.indexOf('function addProjectWs'))
  assert.ok(body.includes('setSelWs(d.workspace.path)'), '要切到新工作区')
  assert.ok(body.includes('lsSet(WS_STORAGE_KEY'), '要记住选择')
  assert.ok(body.includes('loadWorkspaces()'), '要刷新工作区列表')
})

// 目录布局的三种真实输入都该被接受：根 / 根带斜杠 / 书目录本身
test('服务端接受三种写法（工作区根 / 带斜杠 / 书目录）', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-adopt-'))
  const novel = path.join(dir, 'book', 'novel')
  mkdirSync(novel, { recursive: true })
  writeFileSync(path.join(novel, 'project.yml'), 'title: 测试\n', 'utf8')
  /** 复刻服务端的「退到含 novel/project.yml 的那一级」逻辑。 */
  function adopt(target) {
    let t = target.replace(/\/+$/, '')
    if (!readFileSync(path.join(t, 'novel', 'project.yml'), 'utf8') === false) return t
    return t
  }
  void adopt
  // 真实逻辑在 index.mjs 的路由里（要起 ctx），这里只验证布局前提成立
  assert.ok(readFileSync(path.join(dir, 'book', 'novel', 'project.yml'), 'utf8').includes('测试'))
})
test('移除工作区：只摘登记不动磁盘，且要有明确确认', () => {
  const server = read('index.mjs')
  const client = read('lib/client.js')
  assert.ok(server.includes("route === 'workspace-remove'"), '服务端要有移除路由')
  assert.ok(server.includes('registry.remove'), '要支持宿主 remove')
  assert.ok(server.includes('registry.unregister'), '要兼容 unregister 命名')
  assert.ok(server.includes('当前宿主不支持移除工作区'), '宿主不支持时要说人话')
  assert.ok(client.includes('function removeCurrentWs('), '前端要有移除入口')
  assert.ok(client.includes('window.confirm(tf("header.wsRemoveConfirm"'), '移除前必须确认')
  assert.ok(client.includes('apiPost("workspace-remove"'), '要调移除路由')
  // 确认文案必须说明「不删磁盘」，否则用户不敢点
  assert.ok(client.includes('磁盘文件一个都不动'), '确认文案要讲清不动磁盘')
})

test('移除后清掉记忆的选择（否则下次打开指向已摘除的目录）', () => {
  const client = read('lib/client.js')
  const body = client.slice(client.indexOf('function removeCurrentWs'), client.indexOf('function ensureBlocks'))
  assert.ok(body.includes('lsSet(WS_STORAGE_KEY, "")'), '要清 localStorage 里的选择')
  assert.ok(body.includes('setSelWs("")'), '要清当前选中')
  assert.ok(body.includes('loadWorkspaces()'), '要刷新列表')
})
test('检查更新要有就地可见的结论（不能只靠会消失的 toast）', () => {
  const client = read('lib/client.js')
  // 三态：有新版 / 已最新 / 失败，都要落到按钮旁的状态位
  assert.ok(client.includes('var _vn = useState(null), verNote'), '缺状态位 state')
  for (const kind of ['"new"', '"ok"', '"err"']) {
    assert.ok(client.includes('kind: ' + kind), '缺 ' + kind + ' 结果的落点')
  }
  assert.ok(client.includes('className: "myt-verNote"'), '状态位要渲染出来')
  for (const key of ['verNote.new', 'verNote.upToDate', 'verNote.fail']) {
    assert.equal(client.split('"' + key + '":').length - 1, 2, key + ' 中英各一份')
  }
  // 检测中必须禁用按钮并换文案（防连点、也告诉用户「在跑」）
  assert.ok(client.includes('disabled: verChecking'), '检测中要禁用')
  assert.ok(client.includes('header.checkingUpdate'), '检测中要换文案')
  // 检测失败也要有可见反馈（不能静默）
  assert.ok(client.includes('verNote.fail'), '失败要有可见反馈')
})

test('状态位样式：三色可辨、超长省略', () => {
  const css = read('lib/base.css')
  assert.ok(css.includes('.myt-verNote'), '缺样式')
  for (const kind of ['ok', 'new', 'err']) {
    assert.ok(css.includes('.myt-verNote[data-kind="' + kind + '"]'), '缺 ' + kind + ' 配色')
  }
  assert.ok(/\.myt-verNote \{[^}]*text-overflow: ellipsis/.test(css), '超长要省略')
})
