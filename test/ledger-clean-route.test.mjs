import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// 路由层验收：面板按钮打的就是这条 POST /api/xiaoyu-novel/ledger-clean——
// lib 层的单测已覆盖手术本身，这里只确认接线接对了：GET 出计划、POST 落盘、
// 再 GET 归零、POST {undo:true} 还原。

let HOME_DIR = ''
before(() => {
  HOME_DIR = mkdtempSync(path.join(tmpdir(), 'xiaoyu-clean-home-'))
  process.env.DSH_HOME = HOME_DIR
})
after(() => {
  if (HOME_DIR) rmSync(HOME_DIR, { recursive: true, force: true })
})

async function harness() {
  const { registerCreatorRoutes } = await import('../index.mjs')
  const captured = []
  const roots = []
  const ctx = {
    webServer: { register: async (route) => { captured.push(route); return () => {} } },
    workspaceRegistry: {
      list: () => roots,
      create: async (target, title) => ({ path: target, title: title || target }),
    },
    get: () => undefined,
    logger: { warn: () => {}, info: () => {} },
  }
  await registerCreatorRoutes(ctx)
  return { route: captured[0], roots }
}

function postReq(url, body) {
  const handlers = {}
  const payload = Buffer.from(JSON.stringify(body))
  return {
    method: 'POST',
    url,
    headers: { host: '127.0.0.1:46013', 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
    on(event, cb) {
      (handlers[event] || (handlers[event] = [])).push(cb)
      if (event === 'data') setImmediate(() => cb(payload))
      if (event === 'end') setImmediate(() => cb())
      return this
    },
    destroy() {},
  }
}

function call(route, urlStr, reqOverride) {
  return new Promise((resolve, reject) => {
    const res = {
      code: 0,
      writeHead(code) { this.code = code },
      end(body) { resolve({ code: this.code, body: String(body) }) },
    }
    const req = reqOverride || { method: 'GET', url: urlStr, headers: { host: '127.0.0.1:46013' }, socket: { remoteAddress: '127.0.0.1' } }
    try {
      route.handler(req, res).catch(reject)
    } catch (error) {
      reject(error)
    }
  })
}

// 工作区根目录 ≠ 书目录：resolveNovelRoot 一律拼 <workspace>/novel。
function makeBook() {
  const root = mkdtempSync(path.join(tmpdir(), 'xiaoyu-clean-route-'))
  const novel = path.join(root, 'novel')
  mkdirSync(path.join(novel, 'chapters'), { recursive: true })
  for (let i = 1; i <= 33; i += 1) {
    writeFileSync(path.join(novel, 'chapters', 'v01-c' + String(i).padStart(3, '0') + '.md'), '---\ntitle: 第' + i + '章\nvolume: v01\nnum: ' + i + '\nstatus: accepted\n---\n\n正文。\n', 'utf8')
  }
  // 阈值 >=300 字：306 字，保证必被压
  const long = '开头结论句。' + '细节片段，'.repeat(60)
  writeFileSync(path.join(novel, 'relations.yml'), '- a: chen-lei\n  b: song-jiajia\n  type: 暧昧\n  description: ' + long + '\n  intensity: 5\n  started: v01-c001\n  ended: ""\n', 'utf8')
  writeFileSync(path.join(novel, 'foreshadows.yml'), '- id: fs-004\n  title: 造信组织痕迹\n  status: planted\n  priority: high\n  source: backfill\n  planted_chapter: v01-c001\n  expected_resolve: v01-c048\n  resolved_chapter: ""\n  notes: 点位①面板乱码提示。【推进章】v01-c008。\n', 'utf8')
  return { root, novel }
}

test('POST ledger-clean：计划 → 执行 → 归零 → 撤销，全程走路由', async () => {
  const { route, roots } = await harness()
  assert.ok(route && typeof route.handler === 'function')
  const { root, novel } = makeBook()
  // resolveNovelRoot 只认已注册工作区（防任意路径读写），测试里手工登记
  roots.push({ path: root, title: '测试书' })
  const q = '?path=' + encodeURIComponent(root)

  const planned = await call(route, '/api/xiaoyu-novel/ledger-clean' + q)
  assert.equal(planned.code, 200)
  const plan = JSON.parse(planned.body)
  assert.equal(plan.ok, true)
  assert.equal(plan.trimmedTotal, 1)
  assert.equal(plan.advancedTotal, 1)
  assert.equal(readFileSync(path.join(novel, 'relations.yml'), 'utf8').includes('明细见'), false, '计划不能落盘')

  const applied = await call(route, '/api/xiaoyu-novel/ledger-clean', postReq('/api/xiaoyu-novel/ledger-clean', { path: root }))
  assert.equal(applied.code, 200)
  const done = JSON.parse(applied.body)
  assert.equal(done.changed, true)
  assert.ok(done.trimmedTotal >= 1)
  assert.ok(readFileSync(path.join(novel, 'relations.yml'), 'utf8').includes('明细见'), '执行后才写盘')

  const again = JSON.parse((await call(route, '/api/xiaoyu-novel/ledger-clean' + q)).body)
  assert.equal(again.trimmedTotal, 0, '幂等：再点一次没有可清的')

  const undone = await call(route, '/api/xiaoyu-novel/ledger-clean', postReq('/api/xiaoyu-novel/ledger-clean', { path: root, undo: true }))
  assert.equal(undone.code, 200)
  const back = JSON.parse(undone.body)
  assert.ok(back.restored.includes('relations.yml'))
  assert.equal(readFileSync(path.join(novel, 'relations.yml'), 'utf8').includes('明细见'), false, '撤销后账本还原')
})

test('未注册工作区的 path 被 403 拒绝（按钮拿不到别人的书）', async () => {
  const { route } = await harness()
  const { root } = makeBook()
  const res = await call(route, '/api/xiaoyu-novel/ledger-clean?path=' + encodeURIComponent(root))
  // 路由统一把 resolveNovelRoot 的 403 包成 400 + 中文原因（与其它写路由一致）
  assert.equal(res.code, 400)
  assert.match(res.body, /不在已注册工作区/)
})
