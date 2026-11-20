import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { rmSync as rmSyncFs } from 'node:fs'

let HOME_DIR = ''
before(() => {
  HOME_DIR = mkdtempSync(path.join(tmpdir(), 'xiaoyu-gate-home-'))
  process.env.DSH_HOME = HOME_DIR
})
after(() => {
  if (HOME_DIR) rmSyncFs(HOME_DIR, { recursive: true, force: true })
})
import path from 'node:path'

async function harness() {
  const { registerCreatorRoutes } = await import('../index.mjs')
  const captured = []
  const ctx = {
    webServer: { register: async (route) => { captured.push(route); return () => {} } },
    workspaceRegistry: {
      list: () => ctx.__roots,
      create: async (target, title) => ({ path: target, title: title || target }),
    },
    get: () => undefined,
    logger: { warn: () => {}, info: () => {} },
    __roots: [],
  }
  await registerCreatorRoutes(ctx)
  return { route: captured[0], ctx }
}

function call(route, urlStr, opts, reqOverride) {
  return new Promise((resolve) => {
    const res = {
      code: 0,
      writeHead(code) { this.code = code },
      end(body) { resolve({ code: this.code, body }) },
    }
    const req = reqOverride || (opts && opts.method === 'POST'
      ? postReq(urlStr, {})
      : { method: 'GET', url: urlStr, headers: { host: '127.0.0.1:46013' }, socket: { remoteAddress: '127.0.0.1' } })
    route.handler(req, res).catch((error) => resolve({ code: 500, body: String(error && error.message) }))
  })
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

const HUMAN_BODY = '---\ntitle: 测试章\nstatus: writing\n---\n\n门是被踹开的。\n\n他先听见鞋跟磕在门槛上，金属磕水泥，一下，不响。然后才闻到味儿，血腥气混着雨，还有股劣质旱烟。\n\n来的人不高，湿头发贴在额角，手里拎着把伞，伞骨断了一根，另一根翘着。\n'
const AI_BODY = '---\ntitle: 测试章二\nstatus: pending\n---\n\n夜色如墨，浓稠得仿佛化不开。他缓缓睁开双眼，一股难以言喻的力量在体内缓缓涌动，如同沉睡已久的巨兽苏醒。他深吸一口气，站起身，眼神中闪过一丝坚定。\n'

test('门禁路由（纯 JS）：单章出分、批量出表、坏文件名被拒', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-gate-'))
  const chapters = path.join(dir, 'novel', 'chapters')
  mkdirSync(chapters, { recursive: true })
  writeFileSync(path.join(chapters, 'ch001.md'), HUMAN_BODY, 'utf8')
  writeFileSync(path.join(chapters, 'ch002.md'), AI_BODY, 'utf8')
  try {
    const { route, ctx } = await harness()
    ctx.__roots = [{ path: dir }]

    const one = JSON.parse((await call(route, '/api/xiaoyu-novel/gate?path=' + encodeURIComponent(dir) + '&file=ch001.md')).body)
    assert.equal(one.ok, true)
    assert.equal(typeof one.human, 'number')
    assert.ok(one.human >= 80, '人写样章应高分，实际 ' + one.human)
    assert.ok(Array.isArray(one.flags), '单章应带回逐句建议')

    const aiOne = JSON.parse((await call(route, '/api/xiaoyu-novel/gate?path=' + encodeURIComponent(dir) + '&file=ch002.md')).body)
    assert.ok(Array.isArray(aiOne.flags) && aiOne.flags.length > 0, 'AI 味样章应有逐句病灶')
    assert.ok(aiOne.flags.every((f) => typeof f.text === 'string' && Array.isArray(f.flags)))

    const batch = JSON.parse((await call(route, '/api/xiaoyu-novel/gate?path=' + encodeURIComponent(dir))).body)
    assert.equal(batch.ok, true)
    assert.deepEqual(Object.keys(batch.gates).sort(), ['ch001.md', 'ch002.md'])
    assert.ok(batch.gates['ch001.md'].human > batch.gates['ch002.md'].human, '人写样章应高于 AI 味样章')

    const bad = JSON.parse((await call(route, '/api/xiaoyu-novel/gate?path=' + encodeURIComponent(dir) + '&file=../secret.md')).body)
    assert.equal(bad.ok, false)
    assert.equal(bad.reason, 'bad-file')

    // 缓存：同文件再请求仍一致
    const again = JSON.parse((await call(route, '/api/xiaoyu-novel/gate?path=' + encodeURIComponent(dir) + '&file=ch001.md')).body)
    assert.equal(again.human, one.human)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('门禁历史：正文改动后能拿到「上次分数」', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-hist-'))
  const chapters = path.join(dir, 'novel', 'chapters')
  mkdirSync(chapters, { recursive: true })
  const file = path.join(chapters, 'ch001.md')
  writeFileSync(file, HUMAN_BODY, 'utf8')
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    const { route, ctx } = await harness()
    ctx.__roots = [{ path: dir }]
    const first = JSON.parse((await call(route, '/api/xiaoyu-novel/gate?path=' + encodeURIComponent(dir) + '&file=ch001.md')).body)
    assert.equal(first.ok, true)
    writeFileSync(file, AI_BODY.replace('---\ntitle: 测试章二\nstatus: pending\n---', '---\ntitle: 测试章\nstatus: writing\n---'), 'utf8')
    await new Promise((r) => setTimeout(r, 20))
    const second = JSON.parse((await call(route, '/api/xiaoyu-novel/gate?path=' + encodeURIComponent(dir) + '&file=ch001.md')).body)
    assert.equal(second.ok, true)
    assert.ok(second.prev && typeof second.prev.h === 'number', '第二次应带回上次分数')
    assert.equal(second.prev.h, first.human)
    assert.ok(Array.isArray(second.history) && second.history.length >= 2)
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    rmSync(dir, { recursive: true, force: true })
  }
})

test('接入项目：合法目录登记成功，缺 novel/project.yml 被拒', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-add-'))
  const project = path.join(dir, 'novel')
  mkdirSync(project, { recursive: true })
  writeFileSync(path.join(project, 'project.yml'), 'title: 测试书\nphase: writing\n', 'utf8')
  const empty = mkdtempSync(path.join(tmpdir(), 'xiaoyu-empty-'))
  try {
    const { route, ctx } = await harness()
    ctx.__roots = []
    const ok = JSON.parse((await call(route, '/api/xiaoyu-novel/workspace-add', { method: 'POST' }, postReq('/api/xiaoyu-novel/workspace-add', { path: dir }))).body)
    assert.equal(ok.ok, true)
    assert.equal(ok.workspace.path, dir)

    const bad = JSON.parse((await call(route, '/api/xiaoyu-novel/workspace-add', { method: 'POST' }, postReq('/api/xiaoyu-novel/workspace-add', { path: empty }))).body)
    assert.equal(bad.ok, false)
    assert.match(bad.error, /novel/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(empty, { recursive: true, force: true })
  }
})


test('按建议改：gate-fix 改写句子、重算分数、落盘保 frontmatter', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-fix-'))
  const chapters = path.join(dir, 'novel', 'chapters')
  mkdirSync(chapters, { recursive: true })
  const file = path.join(chapters, 'ch001.md')
  writeFileSync(file, AI_BODY, 'utf8')
  try {
    const { route, ctx } = await harness()
    ctx.__roots = [{ path: dir }]
    const sentence = '他缓缓睁开双眼，一股难以言喻的力量在体内缓缓涌动，如同沉睡已久的巨兽苏醒。'
    const res = JSON.parse((await call(route, '/api/xiaoyu-novel/gate-fix', { method: 'POST' }, postReq('/api/xiaoyu-novel/gate-fix', { path: dir, file: 'ch001.md', sentence }))).body)
    assert.equal(res.ok, true, JSON.stringify(res))
    assert.ok(res.after.includes('睁开双眼'))
    assert.ok(!res.after.includes('缓缓'))
    assert.ok(typeof res.human === 'number')
    const saved = readFileSync(file, 'utf8')
    assert.ok(saved.includes(res.after), '改写结果应落盘')
    assert.ok(saved.startsWith('---'), 'frontmatter 不应被破坏')
    assert.ok(saved.includes('title: 测试章二'))

    const bad = JSON.parse((await call(route, '/api/xiaoyu-novel/gate-fix', { method: 'POST' }, postReq('/api/xiaoyu-novel/gate-fix', { path: dir, file: 'ch001.md', sentence: '这句不存在。' }))).body)
    assert.equal(bad.ok, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('整章一键修：批量落盘、frontmatter 完好、分数不降、可重复跑', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-fixall-'))
  const chapters = path.join(dir, 'novel', 'chapters')
  mkdirSync(chapters, { recursive: true })
  const file = path.join(chapters, 'ch001.md')
  writeFileSync(file, AI_BODY, 'utf8')
  try {
    const { route, ctx } = await harness()
    ctx.__roots = [{ path: dir }]
    const res = JSON.parse((await call(route, '/api/xiaoyu-novel/gate-fix-all', { method: 'POST' }, postReq('/api/xiaoyu-novel/gate-fix-all', { path: dir, file: 'ch001.md' }))).body)
    assert.equal(res.ok, true, JSON.stringify(res))
    assert.ok(res.count >= 1, 'AI 味样章应至少改一处')
    assert.ok(res.after.h >= res.before.h - 5, '批量改不应明显掉分')
    assert.ok(Array.isArray(res.items) && res.items.length >= 1)
    const saved = readFileSync(file, 'utf8')
    assert.ok(saved.startsWith('---'), 'frontmatter 不应被破坏')
    assert.ok(saved.includes('title: 测试章二'), 'title 行应保留')
    assert.ok(!saved.includes('他缓缓睁开双眼'), '「缓缓」应被删掉')

    // 预览态不落盘
    const preview = JSON.parse((await call(route, '/api/xiaoyu-novel/gate-fix-all', { method: 'POST' }, postReq('/api/xiaoyu-novel/gate-fix-all', { path: dir, file: 'ch001.md', preview: true }))).body)
    assert.equal(preview.ok, true)
    assert.equal(preview.dryRun, true)
    assert.equal(readFileSync(file, 'utf8'), saved, 'preview 不应改文件')

    // 坏文件名被拒
    const bad = JSON.parse((await call(route, '/api/xiaoyu-novel/gate-fix-all', { method: 'POST' }, postReq('/api/xiaoyu-novel/gate-fix-all', { path: dir, file: '../x.md' }))).body)
    assert.equal(bad.ok, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('章末钩子判定：问句/未完成/转折/短收/平收', async () => {
  const { chapterHook } = await import('../lib/gate-core.mjs')
  assert.equal(chapterHook(['他抬起头，问了一句：为什么？']).kind, 'question')
  assert.equal(chapterHook(['门开了，外面站着一个人……']).kind, 'unfinished')
  assert.equal(chapterHook(['他推开门，却看见桌上摆着另一份合同。']).kind, 'turn')
  assert.equal(chapterHook(['夜深了。']).kind, 'short')
  const plain = chapterHook(['会议在友好的气氛中结束，双方就合作前景交换了意见并达成初步共识。'])
  assert.equal(plain.ok, false)
  assert.equal(plain.kind, 'plain')
  assert.equal(chapterHook([]).kind, 'empty')
  // 章节分析结果自带 hook 字段
  const { analyzeChapter } = await import('../lib/gate-core.mjs')
  assert.ok(analyzeChapter('门开着。\n\n他问：谁？').hook)
})

test('CLI report：输出 markdown 报告（标题/逐章表/优先返修）', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-report-'))
  const novel = path.join(dir, 'novel')
  const chapters = path.join(novel, 'chapters')
  mkdirSync(chapters, { recursive: true })
  writeFileSync(path.join(novel, 'project.yml'), 'title: 测试书\nphase: writing\n', 'utf8')
  writeFileSync(path.join(chapters, 'v01-c001.md'), HUMAN_BODY, 'utf8')
  writeFileSync(path.join(chapters, 'v01-c002.md'), AI_BODY, 'utf8')
  try {
    const { spawnSync } = await import('node:child_process')
    const { fileURLToPath } = await import('node:url')
    const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'xiaoyu-novel.mjs')
    const r = spawnSync(process.execPath, [bin, 'report', novel], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /测试书 · 质检报告/)
    assert.match(r.stdout, /## 逐章/)
    assert.match(r.stdout, /## 优先返修/)
    assert.match(r.stdout, /v01-c002\.md/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('全书体检：跨章重复、0 出场角色、章纲点名未落地', async () => {
  const { auditProject } = await import('../lib/audit-core.mjs')
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-audit-'))
  const novel = path.join(dir, 'novel')
  mkdirSync(path.join(novel, 'chapters'), { recursive: true })
  mkdirSync(path.join(novel, 'characters'), { recursive: true })
  mkdirSync(path.join(novel, 'outlines'), { recursive: true })
  const shared = '面板叮了一声，检测到新谣言陈磊是否真信，系统建议尽快处理。'
  writeFileSync(path.join(novel, 'chapters', 'v01-c001.md'), '---\ntitle: 一\n---\n\n' + shared + '\n\n' + shared + '\n\n' + shared + '\n', 'utf8')
  writeFileSync(path.join(novel, 'chapters', 'v01-c002.md'), '---\ntitle: 二\n---\n\n' + shared + '\n\n' + shared + '\n\n门开着，谁？\n', 'utf8')
  writeFileSync(path.join(novel, 'characters', 'hua.md'), '---\nname: 花无顶\nrole: supporting\n---\n', 'utf8')
  writeFileSync(path.join(novel, 'outlines', 'v01-c001.md'), '# 第一章 章纲\n\n花无顶登场，和马尚宏对质。\n', 'utf8')
  try {
    const audit = auditProject(novel)
    assert.equal(audit.ok, true)
    assert.ok(audit.repeats.length >= 1, '应有跨章重复片段')
    assert.ok(audit.repeats[0].chapters.length >= 2)
    const missing = audit.characters.filter((c) => c.missing).map((c) => c.name)
    assert.ok(missing.includes('花无顶'), '0 出场角色应被标出')
    assert.ok(audit.outlines.some((o) => o.file === 'v01-c001.md' && o.promised.includes('花无顶')), '章纲点名未落地应被标出')
    assert.equal(audit.hooks.plain.length >= 0, true)
    // markdown 报告有骨架
    const md = (await import('../lib/audit-core.mjs')).auditMarkdown(audit, '测试书')
    assert.match(md, /测试书 · 全书体检/)
    assert.match(md, /## 跨章重复片段/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('门禁线配置：POST 写 novel/xiaoyu.json，gate 返回 pass/failed', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-cfg-'))
  const chapters = path.join(dir, 'novel', 'chapters')
  mkdirSync(chapters, { recursive: true })
  writeFileSync(path.join(chapters, 'ch001.md'), HUMAN_BODY, 'utf8')
  try {
    const { route, ctx } = await harness()
    ctx.__roots = [{ path: dir }]
    const cfg = JSON.parse((await call(route, '/api/xiaoyu-novel/gate-config', { method: 'POST' }, postReq('/api/xiaoyu-novel/gate-config', { path: dir, passMark: 86 }))).body)
    assert.equal(cfg.ok, true)
    assert.equal(cfg.passMark, 86)
    assert.ok(readFileSync(path.join(dir, 'novel', 'xiaoyu.json'), 'utf8').includes('86'))

    const g = JSON.parse((await call(route, '/api/xiaoyu-novel/gate?path=' + encodeURIComponent(dir) + '&file=ch001.md')).body)
    assert.equal(g.passMark, 86)
    assert.equal(typeof g.pass, 'boolean')

    const batch = JSON.parse((await call(route, '/api/xiaoyu-novel/gate?path=' + encodeURIComponent(dir))).body)
    assert.equal(batch.passMark, 86)
    assert.equal(typeof batch.failed, 'number')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('撤销自动修：gate-fix-all 后 gate-undo 恢复原文', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-undo-'))
  const chapters = path.join(dir, 'novel', 'chapters')
  mkdirSync(chapters, { recursive: true })
  const file = path.join(chapters, 'ch001.md')
  writeFileSync(file, AI_BODY, 'utf8')
  try {
    const { route, ctx } = await harness()
    ctx.__roots = [{ path: dir }]
    const fixed = JSON.parse((await call(route, '/api/xiaoyu-novel/gate-fix-all', { method: 'POST' }, postReq('/api/xiaoyu-novel/gate-fix-all', { path: dir, file: 'ch001.md' }))).body)
    assert.equal(fixed.ok, true)
    assert.notEqual(readFileSync(file, 'utf8'), AI_BODY)

    const one = JSON.parse((await call(route, '/api/xiaoyu-novel/gate?path=' + encodeURIComponent(dir) + '&file=ch001.md')).body)
    assert.equal(one.canUndo, true)

    const undone = JSON.parse((await call(route, '/api/xiaoyu-novel/gate-undo', { method: 'POST' }, postReq('/api/xiaoyu-novel/gate-undo', { path: dir, file: 'ch001.md' }))).body)
    assert.equal(undone.ok, true, JSON.stringify(undone))
    assert.equal(readFileSync(file, 'utf8'), AI_BODY, '应恢复原文')
    assert.ok(typeof undone.human === 'number')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('体检路由与报告落盘：audit / audit-report / progress', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-auditroute-'))
  const novel = path.join(dir, 'novel')
  const chapters = path.join(novel, 'chapters')
  mkdirSync(chapters, { recursive: true })
  writeFileSync(path.join(novel, 'project.yml'), 'title: 测试书\nphase: writing\n', 'utf8')
  writeFileSync(path.join(chapters, 'v01-c001.md'), HUMAN_BODY, 'utf8')
  writeFileSync(path.join(chapters, 'v01-c002.md'), AI_BODY, 'utf8')
  try {
    const { route, ctx } = await harness()
    ctx.__roots = [{ path: dir }]
    const audit = JSON.parse((await call(route, '/api/xiaoyu-novel/audit?path=' + encodeURIComponent(dir))).body)
    assert.equal(audit.ok, true)
    assert.equal(audit.totals.chapters, 2)

    const rep = JSON.parse((await call(route, '/api/xiaoyu-novel/audit-report', { method: 'POST' }, postReq('/api/xiaoyu-novel/audit-report', { path: dir, title: '测试书' }))).body)
    assert.equal(rep.ok, true, JSON.stringify(rep))
    assert.match(rep.rel, /^reports\/audit-/)
    assert.ok(readFileSync(path.join(novel, rep.rel), 'utf8').includes('测试书 · 全书体检'))

    const prog = JSON.parse((await call(route, '/api/xiaoyu-novel/progress?path=' + encodeURIComponent(dir))).body)
    assert.equal(prog.ok, true)
    assert.ok(Array.isArray(prog.days))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('套用语言档位：只改「## 语言」节，其他节保留', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-reg-'))
  const novel = path.join(dir, 'novel')
  mkdirSync(novel, { recursive: true })
  writeFileSync(path.join(novel, 'project.yml'), 'title: 测试书\nphase: writing\n', 'utf8')
  const style = path.join(novel, 'style.md')
  writeFileSync(style, '# 写作风格基准\n\n## 语言\n\n- 旧规则：白描为主\n\n## 节奏\n\n- 单章 2000 字\n', 'utf8')
  try {
    const { route, ctx } = await harness()
    ctx.__roots = [{ path: dir }]
    const res = JSON.parse((await call(route, '/api/xiaoyu-novel/style-register', { method: 'POST' }, postReq('/api/xiaoyu-novel/style-register', { path: dir, register: 'plain' }))).body)
    assert.equal(res.ok, true, JSON.stringify(res))
    const saved = readFileSync(style, 'utf8')
    assert.ok(saved.includes('怎么说顺口怎么写'), '应写入大白话档位')
    assert.ok(!saved.includes('旧规则'), '旧语言节应被替换')
    assert.ok(saved.includes('## 节奏'), '其他节应保留')
    assert.ok(saved.includes('单章 2000 字'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

