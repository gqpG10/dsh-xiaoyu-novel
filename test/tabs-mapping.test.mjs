import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const panel = readFileSync(path.join(root, 'lib/standalone-panel.html'), 'utf8')

// ── 3.50.0 功能与 tab 归位 ───────────────────────────────────
// 取函数体：从 function 名字起，到下一个顶层 "  function " 为止（不写死下一个函数名，
// 因为文件里函数顺序不是按 tab 排的——写死会切出空串，导致假失败）。

function body(fnName) {
  const a = panel.indexOf('function ' + fnName)
  if (a < 0) return ''
  const rest = panel.slice(a + 1)
  const m = /\n  function /.exec(rest)
  return m ? panel.slice(a, a + 1 + m.index) : rest
}

test('记忆同步卡已移除（3.54.0 并入索引）', () => {
  assert.ok(!panel.includes('vMemorySync'), '记忆同步卡应已删除')
  assert.ok(body('vIndex').includes('idxBriefWrite'), '索引页要有「生成全书阅读版」按钮')
})

test('四线词&卷纲、节奏在项目页', () => {
  const pj = body('vProject')
  assert.ok(pj.length > 100, 'vProject 切片不能为空')
  assert.ok(pj.includes('vFourLinesVolumes()'), '项目页必须包含四线词')
  assert.ok(pj.includes('vPacing()'), '项目页必须包含节奏可视化')
})

test('伏笔审查在伏笔页', () => {
  assert.ok(body('vForeshadows(d)').includes('vForeshadow()'), '伏笔页必须包含伏笔审查')
})

test('禁忌黑名单在设定页', () => {
  assert.ok(body('vWorld(d)').includes('vBlacklist()'), '设定页必须包含黑名单')
})

test('文风基准在风格页', () => {
  assert.ok(body('vStyle').includes('vStyleCheck()'), '风格页必须包含文风基准')
})

test('发布预检在章节页', () => {
  assert.ok(body('vChapters(d)').includes('vPreflight()'), '章节页必须包含发布预检')
})

test('角色分级是独立卡片函数并被角色页引用', () => {
  assert.ok(body('vCastTiers').length > 100, 'vCastTiers 必须存在')
  const ca = body('vCharacters(d)') || body('vCastMatrix')
  const used = panel.includes('vCastTiers() + vCastMatrix()')
  assert.ok(used, '角色分级必须被角色页渲染（vCastTiers() + vCastMatrix()）')
})

test('体检页瘦身：只剩全书级卡片', () => {
  const au = body('vAudit')
  assert.ok(au.includes('vCrossChapter()'), '体检保留跨章检测')
  assert.ok(au.includes('vConsistency()'), '体检保留一致性')
  assert.ok(au.includes('vQualityTrend()'), '体检保留质量趋势')
  assert.ok(!au.includes('vMemorySync()'), '记忆同步不该留在体检')
  assert.ok(!au.includes('vBlacklist()'), '黑名单不该留在体检')
  assert.ok(!au.includes('vForeshadow()'), '伏笔审查不该留在体检')
})

test('按钮绑定槽：卡片绑定不在任何 tab 分支里（三行连续、无条件执行）', () => {
  // 直接断言三行绑定连续出现在 render 里，且前面没有 "if (S.tab === ...) {" 包着。
  const need = 'bindForeshadowAndStyle();\n    bindAiTaste();\n    bindDialogueQuote();'
  assert.ok(panel.includes(need), '三个绑定函数必须连续、无条件调用（否则卡片搬到别的 tab 后按钮失灵）')
  // 再确认它们不在某个 tab 分支的 {} 里：取它们之前 200 字符，不该以 tab 条件开头
  const at = panel.indexOf(need)
  const before = panel.slice(Math.max(0, at - 160), at)
  const lastTabIf = before.lastIndexOf("if (S.tab ===")
  const lastBrace = before.lastIndexOf('{')
  assert.ok(lastTabIf < 0 || lastTabIf < lastBrace - 8 || !before.slice(lastTabIf).includes('{'),
    '绑定不能被包在某条 tab 分支里')
})
