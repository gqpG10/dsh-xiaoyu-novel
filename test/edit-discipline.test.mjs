import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ── edit 纪律契约（0.9.1）───────────────────────────────────────────────────
// 现场故障：去 AI 味师反复收到 `old_string and new_string must differ`——它按
// 「整段替换」把没改的段落也发了一遍 edit，宿主 dsh-tool-fs 见两串逐字相同直接
// 拒绝，一步白烧、还会重试。这层守四件事：
//   ① 两个版本的 preset（polish 与写手）都写明「只对真改过的段落发 edit」；
//   ② 去 AI 味技能里有一节落盘纪律，讲清 must differ = 这段没病、跳过别重试；
//   ③ 面板「复制去 AI 味委派指令」两语版都带上同一条（用户手抄派单也不丢）；
//   ④ 报错后的正确动作是跳过/回报「本章已达标」，不是加字凑数。
// 只校文案契约：真正的 edit 行为在宿主工具侧，插件改不了，只能把纪律讲死。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const PRESETS = ['presets/xiaoyu-novel/agent.cordis.yml', 'presets/xiaoyu-novel/agent.cordis.v2.yml']
const MUST_DIFFER = 'old_string and new_string must differ'

test('preset：polish 与写手都写了「只对真改过的段落发 edit」', () => {
  for (const rel of PRESETS) {
    const text = read(rel)
    assert.ok(text.includes(MUST_DIFFER), rel + ' 没点名 must differ 这个报错')
    assert.ok(text.includes('只对真改过的段落发 edit') || text.includes('只对**真的改过**的段落发 edit'),
      rel + ' 没要求「只对真改过的段落发 edit」')
    // 报错后的正确动作：跳过、别重试、整章没改就回报已达标
    assert.ok(text.includes('跳过'), rel + ' 没说报错后跳过')
    assert.ok(text.includes('本章已达标'), rel + ' 没说整章无改动时回报已达标')
    // 两个角色各自都要有：polish 的 edit 纪律 + 写手的交稿纪律
    assert.ok(text.includes('edit 纪律（硬线'), rel + ' 缺 polish 的 edit 纪律段')
    assert.ok(text.includes('只做一轮（改动不超过 10 处）'), rel + ' 写手的交稿纪律被改坏了')
  }
})

test('技能：落盘纪律成节，讲清 must differ 的语义与善后', () => {
  const skill = read('skills/xiaoyu-qu-ai-wei/SKILL.md')
  assert.ok(skill.includes('## 5.5 落盘纪律（edit 硬线）'), '技能里没有落盘纪律一节')
  assert.ok(skill.includes(MUST_DIFFER), '技能没点名这个报错')
  assert.ok(skill.includes('跳过它发下一段'), '技能没给报错后的动作')
  assert.ok(skill.includes('合并发送'), '技能没讲相邻段落合并成一次 edit')
  assert.ok(skill.includes('不要硬改出 AI 味'), '技能没拦住「为改而改」')
})

test('面板委派指令：中英两版都把落盘纪律写进派单', () => {
  const js = read('lib/client.js')
  const hits = js.split(MUST_DIFFER).length - 1
  assert.ok(hits >= 2, '委派指令应中英各带一条 must differ 提醒，实得 ' + hits)
  assert.ok(js.includes('按五段写'), '中文派单没升到五段')
  assert.ok(js.includes('five-part brief'), '英文派单没升到五段')
  assert.ok(js.includes('只对真改过的段落发 edit'), '中文派单没写落盘纪律')
})

test('已安装副本与源码不一致时，版本号必须已经动了', () => {
  // 技能是「复制安装 + .installed-version 标记」，版本一致即整目录跳过：
  // 内容改了却不升版本，重启后现场跑的还是旧纪律（这正是本次故障的复发路径）。
  // 判据不写死版本号：装完重启后本地副本与源码一致，这条自然放行。
  const pkg = JSON.parse(read('package.json'))
  assert.ok(/^\d+\.\d+\.\d+$/.test(pkg.version), '版本号不合三段落格式：' + pkg.version)
  const home = process.env.DSH_HOME || path.join(process.env.HOME || '', '.dsh')
  const installedSkill = path.join(home, 'skills', 'xiaoyu-qu-ai-wei', 'SKILL.md')
  const installedMarker = path.join(home, 'skills', 'xiaoyu-qu-ai-wei', '.installed-version')
  if (!existsSync(installedSkill) || !existsSync(installedMarker)) return // 未安装：安装器本次就会落地
  const same = readFileSync(installedSkill, 'utf8') === read('skills/xiaoyu-qu-ai-wei/SKILL.md')
  if (same) return // 已同步
  const installed = readFileSync(installedMarker, 'utf8').trim()
  assert.notEqual(installed, pkg.version, '技能内容与已安装副本不一致但版本号没动——安装器会跳过，现场还是旧纪律')
})
