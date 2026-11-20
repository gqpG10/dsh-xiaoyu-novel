import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { analyzeChapter } from '../lib/gate-core.mjs'

const corpus = JSON.parse(readFileSync(new URL('./fixtures/corpus.json', import.meta.url), 'utf8'))
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length

test('检测器回归：人写语料与 AI 味语料分离（回归守卫）', () => {
  assert.ok(corpus.human.length >= 3, '人写语料至少 3 段')
  assert.ok(corpus.ai.length >= 3, 'AI 味语料至少 3 段')
  const H = corpus.human.map((text) => analyzeChapter(text))
  const A = corpus.ai.map((text) => analyzeChapter(text))
  const hHuman = mean(H.map((r) => r.score))
  const aHuman = mean(A.map((r) => r.score))
  const hDet = mean(H.map((r) => r.detector.score))
  const aDet = mean(A.map((r) => r.detector.score))

  assert.ok(hHuman >= 85, '人写均值应 ≥85，实际 ' + hHuman.toFixed(1))
  assert.ok(aHuman <= 60, 'AI 均值应 ≤60，实际 ' + aHuman.toFixed(1))
  assert.ok(hHuman - aHuman >= 20, '人味分离应 ≥20，实际 ' + (hHuman - aHuman).toFixed(1))
  assert.ok(hDet - aDet >= 15, '人写分离应 ≥15，实际 ' + (hDet - aDet).toFixed(1))

  const minHumanDet = Math.min(...H.map((r) => r.detector.score))
  const maxAiDet = Math.max(...A.map((r) => r.detector.score))
  assert.ok(minHumanDet > maxAiDet, '两类样本不应重叠：最差人写 ' + minHumanDet + ' vs 最好 AI ' + maxAiDet)
})
