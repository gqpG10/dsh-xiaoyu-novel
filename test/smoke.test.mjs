import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

test('包元数据：名称/版本/bin/面板入口', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.name, 'dsh-xiaoyu-novel')
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
  assert.equal(pkg.bin['xiaoyu-novel'], 'bin/xiaoyu-novel.mjs')
  assert.equal(pkg.exports['./client'], './lib/client.js')
  assert.ok(pkg.dsh && pkg.dsh.client && pkg.dsh.client.platform === 'web')
  assert.ok(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch === './cordis.patch.yml')
})

test('v2 预设：主编 + 六帮手（含去 AI 味师 polish）', () => {
  const v2 = read('presets/xiaoyu-novel/agent.cordis.v2.yml')
  const roles = [['outline', 61], ['write', 62], ['polish', 63], ['review', 64], ['lore', 65], ['research', 66]]
  for (const [role, order] of roles) {
    assert.ok(v2.includes('id: xiaoyu-novel-' + role), '缺少角色 preset xiaoyu-' + role)
    assert.ok(new RegExp('order: ' + order + '\\b').test(v2), 'xiaoyu-' + role + ' 的 order 应为 ' + order)
  }
  assert.ok(v2.includes('toolName: polish'))
  assert.ok(v2.includes('agentPreset: xiaoyu-novel-polish'))
  assert.ok(v2.includes('id: delegation-polish'))
})

test('v1 内联形态与 v2 同步：polish 委派行存在', () => {
  const v1 = read('presets/xiaoyu-novel/agent.cordis.yml')
  assert.ok(v1.includes('id: delegation-polish'))
  assert.ok(v1.includes('toolName: polish'))
  assert.ok(v1.includes('  - read\n'), 'v1 polish 的 toolFilter 应保留读取工具')
})

test('主编与写手 persona：七步法 / 六帮手 / 白话基线 / 初稿自检', () => {
  for (const file of ['presets/xiaoyu-novel/agent.cordis.yml', 'presets/xiaoyu-novel/agent.cordis.v2.yml']) {
    const text = read(file)
    assert.ok(text.includes('七步法'), file + ' 缺七步法')
    assert.ok(text.includes('委派 polish'), file + ' 缺 polish 委派步骤')
    assert.ok(text.includes('六人帮手'), file + ' 缺六帮手表述')
    assert.ok(text.includes('语言基线默认白话文'), file + ' 缺白话基线')
    assert.ok(text.includes('初稿自检'), file + ' 缺写手初稿自检')
    assert.ok(text.includes('开书九件套'), file + ' 缺开书九件套约束')
    assert.ok(text.includes('文档格式铁律'), file + ' 缺格式铁律')
  }
})

test('工具面白名单与委派标签包含 polish', () => {
  assert.ok(read('presets/xiaoyu-novel/restrict.mjs').includes("'polish'"))
  const labels = read('presets/xiaoyu-novel/delegation-labels.mjs')
  const v1 = read('presets/xiaoyu-novel/agent.cordis.yml')
  assert.ok(v1.includes('polish: 去AI味师'), '委派标签映射缺 polish')
  assert.ok(labels.includes('去 AI 味师') || labels.includes('draft'), '标签组件应可用')
})

test('预设元信息：小鱼创作 + 六个帮手', () => {
  const meta = read('presets/xiaoyu-novel/preset.yml')
  assert.ok(meta.includes('小鱼创作'))
  assert.ok(meta.includes('六个只带本行工具的帮手'))
})

test('存量工作区解析：默认 / 环境变量 JSON / 逗号分隔', async () => {
  const mod = await import('../index.mjs')
  // 默认清单为空（发行包不带任何作者本机路径，用户目录只走环境变量/配置文件）
  const fallback = mod.resolveExtraWorkspaces({}, '/nonexistent-home-for-test')
  assert.deepEqual(fallback, [])
  const json = mod.resolveExtraWorkspaces({ XIAOYU_EXTRA_WORKSPACES: '[{"path":"/a/书","title":"书"}]' }, '/tmp')
  assert.deepEqual(json, [{ path: '/a/书', title: '书' }])
  const csv = mod.resolveExtraWorkspaces({ XIAOYU_EXTRA_WORKSPACES: '/a,/b' }, '/tmp')
  assert.deepEqual(csv.map((x) => x.path), ['/a', '/b'])
})

test('扫描器可运行：人味指数与检测器视角都在输出里', (t) => {
  const probe = spawnSync('python3', ['-V'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) {
    t.skip('未安装 python3，跳过脚本用例')
    return
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-scan-'))
  const file = path.join(dir, 'sample.txt')
  writeFileSync(file, '夜色如墨，浓稠得仿佛化不开。他缓缓睁开眼，一股难以言喻的力量在体内涌动。\n\n“你终于醒了。”男子淡淡地说道。\n', 'utf8')
  try {
    const run = spawnSync('python3', [path.join(root, 'skills/xiaoyu-qu-ai-wei/scripts/aiwei_scan.py'), file], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout, /人味指数/)
    assert.match(run.stdout, /检测器视角/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
