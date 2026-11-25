import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const panel = readFileSync(path.join(root, 'lib/standalone-panel.html'), 'utf8')
const index = readFileSync(path.join(root, 'index.mjs'), 'utf8')

// ── 3.22.0 蓝图 + 六维趋势 UI 契约 ─────────────────────────────────────

test('蓝图 UI：本章 tab 含三填表单 + 保存按钮 + postJson 通道', () => {
  assert.match(panel, /function vBlueprint\(file, bp\)/)
  assert.match(panel, /id="bpGoal"/)
  assert.match(panel, /id="bpConflict"/)
  assert.match(panel, /id="bpHook"/)
  assert.match(panel, /id="bpSave"/)
  assert.match(panel, /postJson\('blueprint'/)
  assert.match(panel, /ensureBlueprint\(cf\)/, 'context tab 渲染时必须拉蓝图')
})

test('六维趋势 UI：体检页六线 SVG + 全书均值 + 预警', () => {
  assert.match(panel, /function vQualityTrend\(\)/)
  assert.match(panel, /ensureQualityTrend\(\);/, 'vAudit 必须触发趋势加载')
  for (const k of ['human','beat','hook','rhythm','consist','pull']) {
    assert.ok(panel.includes("'" + k + "'"), '六维键 ' + k + ' 必须在面板出现')
  }
  assert.match(panel, /q\.alerts/, '预警列表必须渲染')
})

test('后端路由：blueprint GET/POST + quality-trend 三条齐', () => {
  assert.match(index, /route === 'blueprint' && req\.method === 'GET'/)
  assert.match(index, /route === 'blueprint' && req\.method === 'POST'/)
  assert.match(index, /route === 'quality-trend' && req\.method === 'GET'/)
  assert.match(index, /serializeBlueprint\(body\.chapter, body\)/, 'POST 必须过三填闸')
  assert.match(index, /cachedResult\('quality-trend'/, '趋势必须 TTL 缓存')
})
