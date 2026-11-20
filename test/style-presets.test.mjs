import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ── 语言档位扩编（0.8.0）──────────────────────────────────────────────────
// ① 档位清单由 templates/novel/style-presets/*.md 动态扫出，新增文件自动生效；
// ② 至少 10 档，覆盖爽文/悬疑/言情/幽默/史诗/极简/治愈；
// ③ 每个档位文件都有「# 语言档位：」标题与至少 5 条规则；
// ④ 服务端接受新档位、拒绝未知档位。

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const presetDir = path.join(rootDir, 'templates/novel/style-presets')
const EXPECT = ['plain', 'semi', 'classical', 'fast', 'suspense', 'romance', 'humor', 'epic', 'minimal', 'warm', 'tomatohumor']

async function harness() {
  process.env.DSH_HOME = process.env.DSH_HOME || mkdtempSync(path.join(tmpdir(), 'xiaoyu-style-home-'))
  const { registerCreatorRoutes } = await import('../index.mjs')
  const captured = []
  const ctx = {
    webServer: { register: async (route) => { captured.push(route); return () => {} } },
    workspaceRegistry: { list: () => ctx.__roots, create: async (p, t) => ({ path: p, title: t || p }) },
    get: () => undefined,
    logger: { warn() {}, info() {} },
    __roots: [],
  }
  await registerCreatorRoutes(ctx)
  return { route: captured[0], ctx }
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

function call(route, url, body) {
  return new Promise((resolve) => {
    const res = { code: 0, writeHead(c) { this.code = c }, end(b) { resolve({ code: this.code, body: b }) } }
    const req = body === undefined
      ? { method: 'GET', url, headers: { host: '127.0.0.1:46013' }, socket: { remoteAddress: '127.0.0.1' } }
      : postReq(url, body)
    route.handler(req, res).catch((e) => resolve({ code: 500, body: String(e && e.message) }))
  })
}

test('档位清单：模板目录里的每一档都出现，至少 10 档', async () => {
  const { route } = await harness()
  const res = await call(route, '/api/xiaoyu-novel/style-presets')
  assert.equal(res.code, 200)
  const data = JSON.parse(res.body)
  assert.equal(data.ok, true)
  const regs = data.items.map((i) => i.register)
  for (const want of EXPECT) assert.ok(regs.includes(want), '缺档位 ' + want)
  assert.ok(regs.length >= 10, '档位不足 10 个')
  for (const item of data.items) {
    assert.ok(item.label && item.label !== item.register, '档位 ' + item.register + ' 缺中文标题')
  }
})

test('档位文件：都有标题与至少 5 条规则', () => {
  for (const reg of EXPECT) {
    const text = readFileSync(path.join(presetDir, reg + '.md'), 'utf8')
    assert.ok(/^# 语言档位：/.test(text), reg + ' 缺标题')
    const rules = text.split('\n').filter((line) => line.trim().startsWith('- '))
    assert.ok(rules.length >= 5, reg + ' 规则少于 5 条：' + rules.length)
  }
})

test('新档位可套用：只改「## 语言」节，其余节原样', async () => {
  const { route, ctx } = await harness()
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-style-apply-'))
  try {
    const novel = path.join(dir, 'novel')
    mkdirSync(novel, { recursive: true })
    writeFileSync(path.join(novel, 'project.yml'), 'title: 测试书\n', 'utf8')
    ctx.__roots = [{ path: dir, title: '测试工作区' }]
    writeFileSync(path.join(novel, 'style.md'), '# 写作风格\n\n## 语言\n\n旧的语言基线。\n\n## 节奏\n\n两千到三千字。\n', 'utf8')
    const res = await call(route, '/api/xiaoyu-novel/style-register', { path: dir, register: 'suspense' })
    assert.equal(res.code, 200)
    const after = readFileSync(path.join(novel, 'style.md'), 'utf8')
    assert.ok(after.includes('只写看得见听得见的事实'), '未写入新档位规则')
    assert.ok(!after.includes('旧的语言基线'), '旧语言节未替换')
    assert.ok(after.includes('## 节奏'), '不该动的节被删了')
    const bad = await call(route, '/api/xiaoyu-novel/style-register', { path: dir, register: '不存在' })
    assert.equal(bad.code, 422)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})