import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeAiTaste, gateAiTaste, splitSentences, repeatRatio, AI_CLICHES } from '../lib/ai-taste.mjs'
import { checkSixBeats, SIX_BEAT_FIELDS } from '../lib/chapter-blueprint.mjs'

// ── 3.41.0 P0：AI 味量化检测 + 六节拍硬门禁 ───────────────────

test('AI 味：明显机器文本得低分（D 级）', () => {
  const t = '他仿佛看到了希望的曙光，不禁微微一笑。与此同时，心中的五味杂陈久久不能平静。' +
    '他深吸一口气，缓缓抬起头，眼中闪过一丝坚定。空气仿佛凝固了，时间仿佛静止。'
  const r = analyzeAiTaste(t)
  assert.ok(r.score < 50, '机器味文本应低于 50，实际 ' + r.score)
  assert.equal(r.grade.startsWith('D'), true)
  assert.ok(r.metrics.some((m) => m.key === 'cliche_per_1k' && !m.ok), '套话密度应超标')
})

test('AI 味：长短错落的真人文本得高分', () => {
  const t = '林辰把手机扣在桌上。他没有说话。\n' +
    '窗外的雨下了一整夜，楼道里的感应灯坏了三天没人修，他每天摸黑上楼，' +
    '脚趾撞过一次水管，疼得原地站了半分钟才缓过来。\n' +
    '“钱得省着花。”他对自己说。\n' +
    '碗里还剩半口汤。\n她笑了。“真的？”'
  const r = analyzeAiTaste(t)
  assert.ok(r.score >= 55, '人味文本应达标，实际 ' + r.score)
})

test('六指标都在、含 key/label/value/target/ok', () => {
  const r = analyzeAiTaste('第一句。第二句话稍微长一点。他说：“走吧。”')
  assert.equal(r.metrics.length, 6)
  for (const m of r.metrics) {
    assert.ok(m.key && m.label && m.target)
    assert.equal(typeof m.value, 'number')
    assert.equal(typeof m.ok, 'boolean')
  }
})

test('gateAiTaste：block 低于阈值拒发、warn 放行', () => {
  const bad = analyzeAiTaste('他仿佛微微一笑。空气中弥漫着恐惧。他缓缓抬头。')
  const min = Math.max(bad.score + 1, 60)
  assert.equal(gateAiTaste(bad, 'block', min).pass, false)
  assert.ok(gateAiTaste(bad, 'block', min).reason.includes('AI 味'))
  assert.equal(gateAiTaste(bad, 'warn', min).pass, true)
  assert.ok(gateAiTaste(bad, 'warn', min).warning)
  assert.equal(gateAiTaste({ score: 95, ok: true, issues: [], metrics: [] }, 'block', 55).pass, true)
})

test('辅助函数：切句与重复率', () => {
  assert.equal(splitSentences('甲。乙！丙？').length, 3)
  assert.equal(repeatRatio('短'), 0)
  assert.equal(AI_CLICHES.includes('仿佛'), true)
})

test('六节拍门禁：six 模式缺项不过、齐全通过、warn 默认放行', () => {
  const ok = { beat_open: '开场', conflict: '冲突', beat_progress: '推进', beat_payoff: '爽点', beat_setup: '伏笔', hook: '钩子' }
  assert.equal(checkSixBeats(ok, 'six').pass, true)
  const bad = { beat_open: '开场', conflict: '', beat_progress: '', beat_payoff: '', beat_setup: '', hook: '钩子' }
  const r = checkSixBeats(bad, 'six')
  assert.equal(r.pass, false)
  assert.equal(r.missing.length, 4)
  assert.match(r.message, /缺 4 项/)
  assert.equal(checkSixBeats(bad, 'off').pass, true, '未开启六节拍模式不拦')
  assert.equal(SIX_BEAT_FIELDS.length, 6)
})
