import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadYamlLib, resolveDshHome } from '../lib/yaml-loader.mjs'

// ── preset 源文件结构护栏（0.12.0）──────────────────────────────────────────
// 现场踩到：往 persona 里插纪律时缩进写成了 0，YAML 直接解析失败——整个
// preset 会被宿主拒挂，所有帮手消失，而且只有真机重启才会暴露。
// 这层用宿主自带的 yaml 包把两个源文件解析一遍，再校几条关键结构。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const yaml = loadYamlLib(resolveDshHome())

test('v2 组合源：yaml 能解析，七个 preset 各自挂了带预算的 guard', (t) => {
  if (!yaml) { t.skip('宿主没有 yaml 包，跳过结构解析'); return }
  const doc = yaml.parse(read('presets/xiaoyu-novel/agent.cordis.v2.yml'))
  assert.ok(Array.isArray(doc) && doc.length === 1, 'v2 顶层必须是单元素数组')
  const rows = doc[0].insert
  assert.ok(Array.isArray(rows), 'insert 必须是数组')
  const presets = rows.filter((r) => r && /^preset-xiaoyu-novel/.test(String(r.id)))
  assert.equal(presets.length, 7, '应有七个 preset 行，实得 ' + presets.length)
  for (const row of presets) {
    const plugins = (row.config && row.config.plugins) || []
    const guard = plugins.find((p) => p && p.id === 'xiaoyu-novel-guard')
    assert.ok(guard, row.id + ' 没挂 guard')
    assert.equal(guard.name, './guard.mjs')
    assert.ok(guard.config && Number.isInteger(guard.config.stopAt), row.id + ' 缺绝对上限')
    assert.ok(Number.isInteger(guard.config.ledgerEvery), row.id + ' 缺步骤台账周期')
    assert.ok(Number.isInteger(guard.config.softAt), row.id + ' 缺软提醒阈值')
  }
})

test('v1 组合源：yaml 能解析，guard 行带预算', (t) => {
  if (!yaml) { t.skip('宿主没有 yaml 包，跳过结构解析'); return }
  const doc = yaml.parse(read('presets/xiaoyu-novel/agent.cordis.yml'))
  assert.ok(Array.isArray(doc) && doc.length >= 20, 'v1 应为行数组')
  const guard = doc.find((r) => r && r.id === 'xiaoyu-novel-guard')
  assert.ok(guard, 'v1 没挂 guard')
  assert.ok(guard.config.stopAt >= 1 && guard.config.ledgerEvery >= 1)
})

test('persona 正文没有脱格行（缩进写错会让整个 preset 拒挂）', () => {
  for (const rel of ['presets/xiaoyu-novel/agent.cordis.v2.yml', 'presets/xiaoyu-novel/agent.cordis.yml']) {
    const lines = read(rel).split('\n')
    // 顶格的中文列表行只可能出现在 YAML 顶层的行（v1 是 '- id:' 结构，不带中文）
    const bad = lines
      .map((line, i) => ({ line, i: i + 1 }))
      .filter((x) => /^-\s*[\u4e00-\u9fa5]/.test(x.line))
    assert.deepEqual(bad.map((x) => x.i), [], rel + ' 有顶格中文行（缩进丢失）：' + JSON.stringify(bad.slice(0, 3)))
  }
})

test('纪律文案确实落在 persona 里（不是落在文件顶格）', () => {
  const v2 = read('presets/xiaoyu-novel/agent.cordis.v2.yml')
  assert.ok(v2.includes('                - 连载书别推进到 export'), 'v2 连载纪律缩进不对')
  assert.ok(v2.includes('                - 角色卡记登场计划'), 'v2 登场计划纪律缩进不对')
  const v1 = read('presets/xiaoyu-novel/agent.cordis.yml')
  assert.ok(v1.includes('          - 连载书别推进到 export'), 'v1 连载纪律缩进不对')
})
