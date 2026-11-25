import test from 'node:test'
import assert from 'node:assert/strict'
import { qualityOfBlueprint } from '../lib/chapter-blueprint.mjs'
import { buildCoverPrompt } from '../lib/cover-prompt.mjs'

test('蓝图质量：好的三填零警告', () => {
  const q = qualityOfBlueprint({ goal: '陈默夺回断刀', conflict: '追兵封桥 vs 唯一渡口，却被反将一军', hook: '刀身刻着一个不该出现的名字？' })
  assert.equal(q.level, 'ok')
  assert.equal(q.issues.length, 0)
})

test('蓝图质量：目标无动作 / 冲突单向 / 钩子平铺 三条都报', () => {
  const q = qualityOfBlueprint({ goal: '他很难过', conflict: '天气很坏', hook: '他回家睡觉了' })
  assert.equal(q.level, 'warn')
  const fields = q.issues.map((i) => i.field)
  assert.ok(fields.includes('goal'))
  assert.ok(fields.includes('conflict'))
  assert.ok(fields.includes('hook'))
})

test('封面提示词：两套风格 + 三层结构 + 题材命中', () => {
  const c = buildCoverPrompt({ title: '刀客', author: '老鱼', genre: '玄幻' })
  assert.ok(c.styles.commercial.includes('风格 A'))
  assert.ok(c.styles.concept.includes('风格 B'))
  assert.ok(c.styles.commercial.includes('《刀客》'))
  assert.ok(c.styles.commercial.includes('老鱼'))
  assert.ok(c.styles.commercial.includes('玄幻'))
  assert.ok(c.styles.commercial.includes('深紫与鎏金'))
})

test('封面提示词：未知题材走通用兜底，不炸', () => {
  const c = buildCoverPrompt({ title: 'x', author: 'y', genre: '随便什么' })
  assert.ok(c.text.includes('# 《x》封面提示词'))
  assert.ok(c.styles.concept.includes('风格 B'))
})
