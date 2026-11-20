import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply as applyGuard, name as guardName } from '../presets/xiaoyu-novel/guard.mjs'

// ── xiaoyu-novel-guard（0.13.0）：先消除不确定，再谈刹车 ─────────────────────────
// 0.12 的教训：把绕圈当错误惩罚，会连带砍掉正在产出的工作。模型是因为
// 「不确定搜够了没有」才反复搜的。所以这版守三条预防 + 两条刹车：
//   预防① 同参重复 → 回放上次结果（不执行、不报错）；
//   预防② 同果（换参数结果不变）→ 只加提示；
//   预防③ 步骤台账 → 每 N 步回放「你已经做过什么」；
//   刹车① 同参连续 4 次 → block（原样重发没有任何正当理由）；
//   刹车② 绝对上限 → block（兜住失控花费，正常任务碰不到）。
// 另外守住 additionalContexts 必须是「消息」（id/role/content/source），
// 不是内容块——0.12 这里写错了，插进去会被 inbox 的 id 去重逻辑拒掉。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function makeCtx() {
  const listeners = new Map()
  return {
    on(event, fn) {
      const list = listeners.get(event) ?? []
      list.push(fn)
      listeners.set(event, list)
    },
    async fire(event, ...args) {
      const list = listeners.get(event) ?? []
      if (list.length === 0) throw new Error('no listener for ' + event)
      return list[0](...args)
    },
  }
}

const ACCEPT = async () => ({ kind: 'accept' })
const res = (text) => ({ content: [{ type: 'text', text }] })
const cfg = (over) => ({ blockAt: 4, softAt: 999, stopAt: 9999, ledgerEvery: 999, ...over })

test('预防①：同参数第 2 次回放上次结果，不是失败，也不再执行新结果', async () => {
  const ctx = makeCtx()
  applyGuard(ctx, cfg({}))
  const agent = {}
  const call = { agent, name: 'grep', arguments: { pattern: '陈磊' } }
  const first = await ctx.fire('tools/post-execute', call, res('命中 14 处'), ACCEPT)
  assert.equal(first.kind, 'accept')
  const second = await ctx.fire('tools/post-execute', call, res('SECOND-RUN-MARKER 命中 14 处'), ACCEPT)
  assert.equal(second.kind, 'accept', '同参重复不该判失败')
  const text = second.content.map((b) => b.text).join('')
  assert.match(text, /命中 14 处/, '应回放上一次结果')
  assert.ok(!text.includes('SECOND-RUN-MARKER'), '不应把这次新结果交出去')
  assert.match(text, /同参数第 2 次调用/)
})

test('预防②：换参数但结果相同只加提示，不拦不判错', async () => {
  const ctx = makeCtx()
  applyGuard(ctx, cfg({}))
  const agent = {}
  const same = res('同一批命中')
  const a = await ctx.fire('tools/post-execute', { agent, name: 'grep', arguments: { q: '陈磊' } }, same, ACCEPT)
  assert.equal(a.kind, 'accept')
  const b = await ctx.fire('tools/post-execute', { agent, name: 'grep', arguments: { q: '陈磊 ' } }, same, ACCEPT)
  assert.equal(b.kind, 'accept', '同果不许判失败')
  assert.ok(Array.isArray(b.additionalContexts) && b.additionalContexts.length === 1)
  const msg = b.additionalContexts[0]
  assert.match(msg.content[0].text, /与上一次完全相同/)
})

test('预防②升级：同果第 3 次起只回「无新信息」占位，第 5 次才终止', async () => {
  const ctx = makeCtx()
  applyGuard(ctx, cfg({ sameResultBlockAt: 5 }))
  const agent = {}
  const same = res('同一批命中')
  const kinds = []
  const texts = []
  for (let i = 1; i <= 5; i++) {
    const r = await ctx.fire('tools/post-execute', { agent, name: 'grep', arguments: { q: '陈磊' + ' '.repeat(i) } }, same, ACCEPT)
    kinds.push(r.kind)
    const body = r.kind === 'block' ? r.feedback[0].text : (r.content || []).map((b) => b.text).join('')
    const notes = (r.additionalContexts || []).map((m) => (m.content || []).map((b) => b.text).join('')).join('|')
    texts.push(body + ' | ' + notes)
  }
  assert.equal(kinds[0], 'accept')
  assert.equal(kinds[1], 'accept', '第 2 次只提示')
  assert.match(texts[1], /信息没有增加|完全相同/)
  assert.equal(kinds[2], 'accept', '第 3 次不拦，但不再交出重复内容')
  assert.match(texts[2], /不再重复输出/, '第 3 次应回占位而不是原结果')
  assert.equal(kinds[3], 'accept')
  assert.equal(kinds[4], 'block', '连续 5 次同果才终止')
  assert.match(texts[4], /连续 5 次拿回完全相同的结果/)
})
test('预防③：步骤台账按周期回放，且是合法消息（id/role/source 齐全）', async () => {
  const ctx = makeCtx()
  applyGuard(ctx, cfg({ ledgerEvery: 3 }))
  const agent = {}
  let ledger = null
  for (let i = 1; i <= 3; i++) {
    const r = await ctx.fire('tools/post-execute', { agent, name: 'read', arguments: { file: 'f' + i } }, res('内容' + i), ACCEPT)
    if (Array.isArray(r.additionalContexts) && r.additionalContexts.length > 0) ledger = r.additionalContexts[0]
  }
  assert.ok(ledger, '第 3 步没出台账')
  assert.equal(typeof ledger.id, 'string')
  assert.ok(ledger.id.length >= 8, '台账消息缺 id，会被 inbox 去重逻辑拒掉')
  assert.equal(ledger.role, 'user')
  assert.equal(ledger.source.kind, 'xiaoyu-novel-guard')
  assert.match(ledger.content[0].text, /你已经做过/)
  assert.match(ledger.content[0].text, /read\(file=f1\)/)
})

test('刹车①：同参连续第 4 次才 block（前 3 次都是回放）', async () => {
  const ctx = makeCtx()
  applyGuard(ctx, cfg({}))
  const agent = {}
  const call = { agent, name: 'grep', arguments: { p: 'x' } }
  const kinds = []
  for (let i = 1; i <= 4; i++) {
    const r = await ctx.fire('tools/post-execute', call, res('同一结果'), ACCEPT)
    kinds.push(r.kind)
  }
  assert.deepEqual(kinds, ['accept', 'accept', 'accept', 'block'])
  const blocked = await ctx.fire('tools/post-execute', call, res('同一结果'), ACCEPT)
  assert.ok(blocked.kind === 'accept' || blocked.kind === 'block') // 计数已重置，行为不崩即可
})

test('刹车②：绝对上限才终止；softAt 只提醒收口，不拦', async () => {
  const ctx = makeCtx()
  applyGuard(ctx, cfg({ softAt: 3, stopAt: 6 }))
  const agent = {}
  const out = []
  for (let i = 1; i <= 7; i++) {
    const r = await ctx.fire('tools/post-execute', { agent, name: 'read', arguments: { file: 'f' + i } }, res('内容' + i), ACCEPT)
    out.push(r)
  }
  assert.equal(out[0].kind, 'accept')
  assert.equal(out[1].kind, 'accept')
  const noticeTexts = (out[2].additionalContexts || []).map((m) => m.content[0].text).join('|')
  assert.match(noticeTexts, /开始收口|已 \d+ 步/, 'softAt 没给收口提醒')
  assert.equal(out[2].kind, 'accept', 'softAt 不许拦')
  assert.equal(out[4].kind, 'accept', '未到绝对上限不许拦')
  assert.equal(out[6].kind, 'block', '到绝对上限必须终止')
  assert.match(out[6].feedback[0].text, /绝对上限/)
})

test('用户发话重置：预算与缓存清零，可以再试一次', async () => {
  const ctx = makeCtx()
  applyGuard(ctx, cfg({ softAt: 9, stopAt: 2 }))
  const agent = {}
  const call = { agent, name: 'read', arguments: { f: 'a' } }
  await ctx.fire('tools/post-execute', call, res('x'), ACCEPT)
  // 第二次换参数：同参重复会走「回放」分支，不经过预算判定
  const blocked = await ctx.fire('tools/post-execute', { agent, name: 'read', arguments: { f: 'b' } }, res('y'), ACCEPT)
  assert.equal(blocked.kind, 'block')
  await ctx.fire('agent/pre-step', { agent, messages: [{ source: { kind: 'user' } }] }, async () => {})
  const after = await ctx.fire('tools/post-execute', call, res('z'), ACCEPT)
  assert.equal(after.kind, 'accept')
})

test('七个 preset 都挂了 guard，参数是 v3 键名，且没有残留旧键', () => {
  assert.equal(guardName, 'xiaoyu-novel-guard')
  const v2 = readFileSync(path.join(root, 'presets/xiaoyu-novel/agent.cordis.v2.yml'), 'utf8')
  assert.equal(v2.split('./guard.mjs').length - 1, 7, 'v2 每个 preset 都要挂')
  assert.equal((v2.match(/stopAt: \d+/g) || []).length, 7, '每个 preset 都要有绝对上限')
  assert.equal((v2.match(/ledgerEvery: \d+/g) || []).length, 7, '每个 preset 都要开台账')
  assert.ok(!v2.includes('hardAt:'), '还残留 0.12 的 hardAt 键')
  assert.ok(!v2.includes('sameResultAt:'), '还残留 0.12 的 sameResultAt 键')
  const v1 = readFileSync(path.join(root, 'presets/xiaoyu-novel/agent.cordis.yml'), 'utf8')
  assert.ok(v1.includes('./guard.mjs'))
  assert.ok(/stopAt: \d+/.test(v1), 'v1 没有绝对上限')
  const installer = readFileSync(path.join(root, 'index.mjs'), 'utf8')
  assert.ok(/PRESET_FILES = \[[^\]]*'guard\.mjs'/.test(installer), '安装器没把 guard.mjs 纳入复制清单')
})
