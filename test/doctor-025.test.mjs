import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { SKILL_NAMES, diagnose, patchEntryText, renderDiagnosis, scalarOf } from '../lib/doctor.mjs'

function tempHome(tag) {
  const dir = path.join(tmpdir(), 'xiaoyu-doctor-' + tag + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6))
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 造一个「健康」的 home，测试时再逐项破坏。 */
function makeHealthy(home) {
  mkdirSync(path.join(home, '.agent-presets', 'xiaoyu-novel'), { recursive: true })
  for (const name of ['preset.yml', 'agent.cordis.yml', 'restrict.mjs', 'delegation-labels.mjs', 'guard.mjs']) {
    writeFileSync(path.join(home, '.agent-presets', 'xiaoyu-novel', name), 'x')
  }
  writeFileSync(
    path.join(home, 'cordis.patch.yml'),
    [
      '- insert:',
      '    - id: preset-xiaoyu-novel',
      '      name: "@deepseek-ai/dsh-agent-preset"',
      '    - id: preset-xiaoyu-novel-outline',
      '      name: "@deepseek-ai/dsh-agent-preset"',
    ].join('\n') + '\n' + '# --- dsh-xiaoyu-novel preset managed (auto-generated; do not edit) ---\n',
  )
  mkdirSync(path.join(home, 'profiles', 'web'), { recursive: true })
  writeFileSync(
    path.join(home, 'profiles', 'web', 'cordis.patch.yml'),
    [
      '- id: ui-settings',
      '  name: "@deepseek-ai/dsh-client-ui-settings"',
      '  config:',
      '    enabled: true',
      '- id: agent-preset-registry',
      '  name: "@deepseek-ai/dsh-agent-preset-registry"',
      '  config:',
      '    default: standard',
      '    selectedDefault: xiaoyu-novel',
      '- id: dsh-ops',
      '  name: "dsh-ops"',
      '  config:',
      '    global:',
      '      forceDefaultOpsPtc: false',
    ].join('\n') + '\n',
  )
  for (const name of SKILL_NAMES) {
    mkdirSync(path.join(home, 'skills', name), { recursive: true })
    writeFileSync(path.join(home, 'skills', name, 'SKILL.md'), '# skill\n')
  }
  mkdirSync(path.join(home, 'storages'), { recursive: true })
  writeFileSync(path.join(home, 'storages', 'workspace.json'), JSON.stringify({ tables: { workspaces: { a: {} } } }))
}

const levelOf = (result, id) => result.checks.find((row) => row.id === id)?.level

test('健康 home：全绿，ok = true', () => {
  const home = tempHome('ok')
  makeHealthy(home)
  const result = diagnose({ home, profile: 'web' })
  assert.equal(result.ok, true)
  assert.equal(result.errors, 0)
  assert.equal(result.warns, 0)
  assert.equal(levelOf(result, 'preset-files'), 'ok')
  assert.equal(levelOf(result, 'default-preset'), 'ok')
  rmSync(home, { recursive: true, force: true })
})

test('预设源文件缺失：报 error 且点名缺哪几个（助手名字变了的真因）', () => {
  const home = tempHome('missing')
  makeHealthy(home)
  rmSync(path.join(home, '.agent-presets', 'xiaoyu-novel', 'agent.cordis.yml'))
  rmSync(path.join(home, '.agent-presets', 'xiaoyu-novel', 'guard.mjs'))
  const result = diagnose({ home, profile: 'web' })
  assert.equal(result.ok, false)
  const row = result.checks.find((item) => item.id === 'preset-files')
  assert.equal(row.level, 'error')
  assert.match(row.detail, /agent\.cordis\.yml/)
  assert.match(row.detail, /guard\.mjs/)
  rmSync(home, { recursive: true, force: true })
})

test('home patch 缺托管块：报 error（预设声明行没了）', () => {
  const home = tempHome('noblock')
  makeHealthy(home)
  writeFileSync(path.join(home, 'cordis.patch.yml'), '- insert: []\n')
  const result = diagnose({ home, profile: 'web' })
  assert.equal(result.ok, false)
  assert.equal(levelOf(result, 'home-patch'), 'error')
  rmSync(home, { recursive: true, force: true })
})

test('默认预设被 ops-ptc 抢：报 warn 并给出 --fix 指引（新建对话不是小鱼）', () => {
  const home = tempHome('ops')
  makeHealthy(home)
  const file = path.join(home, 'profiles', 'web', 'cordis.patch.yml')
  writeFileSync(file, readFileSync(file, 'utf8').replace('selectedDefault: xiaoyu-novel', 'selectedDefault: ops-ptc'))
  const result = diagnose({ home, profile: 'web' })
  assert.equal(result.ok, true, '这是 warn 不是 error：面板还能用')
  const row = result.checks.find((item) => item.id === 'default-preset')
  assert.equal(row.level, 'warn')
  assert.match(row.title, /ops-ptc/)
  assert.match(row.fix, /--fix/)
  rmSync(home, { recursive: true, force: true })
})

test('ui-settings.enabled = false：报 warn（预设切换器被藏）', () => {
  const home = tempHome('uiset')
  makeHealthy(home)
  const file = path.join(home, 'profiles', 'web', 'cordis.patch.yml')
  writeFileSync(file, readFileSync(file, 'utf8').replace('enabled: true', 'enabled: false'))
  const result = diagnose({ home, profile: 'web' })
  assert.equal(levelOf(result, 'ui-settings'), 'warn')
  rmSync(home, { recursive: true, force: true })
})

test('dsh-ops 未覆盖 forceDefaultOpsPtc：报 warn（默认 true 会抢）', () => {
  const home = tempHome('opsforce')
  makeHealthy(home)
  const file = path.join(home, 'profiles', 'web', 'cordis.patch.yml')
  const text = readFileSync(file, 'utf8')
  writeFileSync(file, text.slice(0, text.indexOf('- id: dsh-ops')))
  const result = diagnose({ home, profile: 'web' })
  assert.equal(levelOf(result, 'ops-force'), 'warn', '没写覆盖行＝用包内默认 true')
  rmSync(home, { recursive: true, force: true })
})

test('技能缺失：报 warn 并点名', () => {
  const home = tempHome('skills')
  makeHealthy(home)
  rmSync(path.join(home, 'skills', 'xiaoyu-qu-ai-wei'), { recursive: true, force: true })
  const result = diagnose({ home, profile: 'web' })
  const row = result.checks.find((item) => item.id === 'skills')
  assert.equal(row.level, 'warn')
  assert.match(row.detail, /xiaoyu-qu-ai-wei/)
  rmSync(home, { recursive: true, force: true })
})

test('工作区列表损坏：报 warn 而不是抛错', () => {
  const home = tempHome('ws')
  makeHealthy(home)
  writeFileSync(path.join(home, 'storages', 'workspace.json'), '{ broken json')
  const result = diagnose({ home, profile: 'web' })
  assert.equal(levelOf(result, 'workspace'), 'warn')
  rmSync(home, { recursive: true, force: true })
})

test('patchEntryText / scalarOf：能取出条目与标量', () => {
  const text = ['- id: a', '  config:', '    enabled: false', '- id: b', '  config:', '    enabled: true'].join('\n')
  const entry = patchEntryText(text, 'a')
  assert.ok(entry.includes('enabled: false'))
  assert.equal(entry.includes('- id: b'), false, '不能跨到下一条')
  assert.equal(scalarOf(entry, 'enabled'), 'false')
  assert.equal(patchEntryText(text, 'zzz'), null)
  assert.equal(scalarOf(null, 'enabled'), null)
})

test('renderDiagnosis：三类图标与结论都在', () => {
  const home = tempHome('render')
  makeHealthy(home)
  writeFileSync(path.join(home, 'cordis.patch.yml'), '- insert: []\n')
  const text = renderDiagnosis(diagnose({ home, profile: 'web' }))
  assert.match(text, /✗/)
  assert.match(text, /结论：有 1 项致命缺失/)
  assert.match(text, /→/)
  rmSync(home, { recursive: true, force: true })
})
