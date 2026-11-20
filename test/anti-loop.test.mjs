import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ── 反打转契约（0.9.4）─────────────────────────────────────────────────────
// 现场故障：审校子代理在一个「1 轮 81 步」的会话里跑了 6 小时 42 分——同一个
// grep 连发两次（中间夹着「已重试模型请求」），再到点就重来。根因有三层：
//   ① 模型请求被重试后，模型倾向把上一步的调用原样再发一次；
//   ② 各角色只有「≤40 步」这类文案预算，没有「重复就停」的判据；
//   ③ 审校的交付模板写着「缺项视为未完成」，等于逼它为了凑齐七层六维一直搜。
// 这层守：六张角色卡都带反打转硬线、主编会掐打转、审校改成「结论缺失才算
// 未完成」，且「缺项视为未完成」这句诱导性的话被彻底删掉。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const PRESETS = ['presets/xiaoyu-novel/agent.cordis.v2.yml', 'presets/xiaoyu-novel/agent.cordis.yml']

test('六个角色都带「反打转」硬线（同一调用不重发、重复即停）', () => {
  for (const rel of PRESETS) {
    const text = read(rel)
    const hits = text.split('反打转（硬线').length - 1
    assert.equal(hits, 6, rel + ' 应有的六张角色卡各一条反打转硬线，实得 ' + hits)
    assert.ok(text.includes('同一工具 + 同一参数只发一次'), rel + ' 没写「同一工具同一参数只发一次」')
    assert.ok(text.includes('已重试模型请求'), rel + ' 没覆盖「模型请求被重试」这种情况')
    assert.ok(text.includes('宁可交一份带「未核实」的报告'), rel + ' 没给「宁可交报告也不许拖」的出口')
    // 每个角色的文案预算仍在（40/30 步），反打转不替代预算
    assert.ok(text.includes('≤40 步'), rel + ' 步数预算被删了')
  }
})

test('六个角色都能「不靠自觉」自己收工：todo 清单 + 报告骨架', () => {
  for (const rel of PRESETS) {
    const text = read(rel)
    const hits = text.split('清单全勾＝必须交报告').length - 1
    assert.equal(hits, 6, rel + ' 应有六张角色卡各一条「清单全勾＝必须交报告」，实得 ' + hits)
    assert.ok(text.includes('别把「我记得我搜过」当判据'), rel + ' 没把「靠记忆」换成「靠清单」')
    assert.ok(text.includes('这一步和上一步有什么不同'), rel + ' 没给每步自问句')
    assert.ok(text.includes('「未核实」不算失败'), rel + ' 没解除「必须消灭未核实」的压力')
  }
})

test('落盘方式：章纲/正文/账本/笔记都一次成稿，不许 +1 -1 逐段填', () => {
  for (const rel of PRESETS) {
    const text = read(rel)
    // 大纲师：占位符逐段填充是最常见的一类碎改，必须点名禁止
    assert.ok(text.includes('第 2 次 edit 就说明方法错了'), rel + ' 大纲师没有「第 2 次 edit 换方法」的闸')
    assert.ok(text.includes('禁止占位符逐段填充'), rel + ' 大纲师没禁占位符逐段填')
    // 写手：正文一次成章
    assert.ok(text.includes('不按段落追加、不留占位符逐段填'), rel + ' 写手没禁按段落追加')
    // 设定：多条改动合并一次
    assert.ok(text.includes('同一文件的几条改动合并成一次 edit'), rel + ' 设定没要求合并落盘')
    // 考据：笔记一次成稿
    assert.ok(text.includes('笔记一个文件一次 write 成稿'), rel + ' 考据没要求一次成稿')
    // 主编：委派单点名一次成稿
    assert.ok(text.includes('一次成稿，不要分段落盘'), rel + ' 主编委派单没点名一次成稿')
  }
})

test('审校没有 shell：跨章统计交给主编的 CLI，不在书里自己翻', () => {
  for (const rel of PRESETS) {
    const text = read(rel)
    assert.ok(text.includes('审校没有 shell'), rel + ' 没说明审校没有 shell')
    assert.ok(text.includes('xiaoyu-novel audit / gate / check'), rel + ' 没点名可用的 CLI')
    assert.ok(text.includes('派 review 之前先跑'), rel + ' 主编派单前没先跑 audit/gate')
  }
})

test('七个 preset 都挂了宿主自带的重复调用守卫（提示词之外的第二道闸）', () => {
  const v2 = read(PRESETS[0])
  const hits = v2.split('@deepseek-ai/dsh-repeat-tool-reminder').length - 1
  assert.equal(hits, 7, 'v2 每个 preset（主编 + 六个角色）都要挂 repeat-tool-reminder，实得 ' + hits)
  assert.ok(v2.includes('thresholds: [2, 3, 5, 8, 12]'), 'v2 守卫阈值不是 2/3/5/8/12')
  const v1 = read(PRESETS[1])
  assert.ok(v1.includes('@deepseek-ai/dsh-repeat-tool-reminder'), 'v1 没挂重复调用守卫')
  assert.ok(v1.includes('thresholds: [2, 3, 5, 8, 12]'), 'v1 守卫阈值不对')
})

test('去 AI 味：零差异就是结果，不许写核对脚本反复跑', () => {
  for (const rel of PRESETS) {
    const text = read(rel)
    assert.ok(text.includes('状态核对只跑两遍'), rel + ' 没限制状态核对的次数')
    assert.ok(text.includes('零差异＝这就是结果'), rel + ' 没说清零差异该怎么收')
  }
})

test('主编会盯打转并掐断子代理', () => {
  for (const rel of PRESETS) {
    const text = read(rel)
    assert.ok(text.includes('盯打转：'), rel + ' 主编纪律里没有「盯打转」')
    assert.ok(text.includes('interrupt_agent'), rel + ' 没给掐断动作')
    assert.ok(text.includes('停手，用现有证据出结论'), rel + ' 没给一句停手指令')
  }
})

test('审校：不再用「缺项视为未完成」逼自己反复检索', () => {
  for (const rel of PRESETS) {
    const text = read(rel)
    assert.ok(!text.includes('缺项视为未完成'), rel + ' 还留着诱导反复检索的「缺项视为未完成」')
    assert.ok(text.includes('结论缺失才算未完成'), rel + ' 没有把完成判据改成「结论缺失」')
    assert.ok(text.includes('不许为凑齐清单一遍遍重搜'), rel + ' 没明说不许为凑清单重搜')
  }
})

test('审校仍保持只读与检索预算（反打转不改职责）', () => {
  for (const rel of PRESETS) {
    const text = read(rel)
    assert.ok(text.includes('只读不改'), rel + ' 审校的只读纪律被改坏')
    assert.ok(text.includes('同一文件最多 3 次'), rel + ' 审校的 grep 预算被删了')
  }
})
