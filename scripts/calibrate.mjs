#!/usr/bin/env node
/**
 * calibrate.mjs —— 检测器指标回归：拿标注好的人写 / AI 味语料跑一遍门禁引擎，
 * 看两类样本的分数分布与实际分离度，顺便给每个特征打印均值，方便调阈值。
 *
 * 用法：
 *   node scripts/calibrate.mjs                      # 用内置语料 test/fixtures/corpus.json
 *   node scripts/calibrate.mjs my-corpus.json       # 用自己的语料（{"human":[...],"ai":[...]}）
 *
 * 只读：不改任何源码。调阈值是人的判断，脚本只负责把分布摆出来。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { analyzeChapter } from '../lib/gate-core.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const file = process.argv[2] || path.join(here, '..', 'test', 'fixtures', 'corpus.json')
const corpus = JSON.parse(readFileSync(file, 'utf8'))

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const round = (x) => Math.round(x * 10) / 10

function summarize(samples) {
  const results = samples.map((text) => analyzeChapter(text))
  return {
    human: results.map((r) => r.score),
    detector: results.map((r) => r.detector.score),
    feats: results[0].detector.feats.map((f, i) => ({
      name: f[0],
      human: mean(results.map((r) => r.detector.feats[i][1])),
      score: mean(results.map((r) => r.detector.feats[i][3])),
    })),
  }
}

const H = summarize(corpus.human)
const A = summarize(corpus.ai)

console.log('样本：人写 ' + H.human.length + ' 段 / AI 味 ' + A.human.length + ' 段')
console.log('')
console.log('指标  人写均值  AI 均值  分离度')
console.log('人味指数   ' + round(mean(H.human)) + '     ' + round(mean(A.human)) + '     ' + round(mean(H.human) - mean(A.human)))
console.log('人写度     ' + round(mean(H.detector)) + '     ' + round(mean(A.detector)) + '     ' + round(mean(H.detector) - mean(A.detector)))
console.log('')
console.log('特征           人写    AI    分差')
for (let i = 0; i < H.feats.length; i += 1) {
  const h = H.feats[i]
  const a = A.feats[i]
  console.log(String(h.name).padEnd(12) + ' ' + round(h.human).toString().padStart(6) + ' ' + round(a.human).toString().padStart(6) + ' ' + round(h.human - a.human).toString().padStart(6))
}
console.log('')
const gapHuman = round(mean(H.human) - mean(A.human))
const gapDet = round(mean(H.detector) - mean(A.detector))
const minHuman = round(Math.min(...H.detector))
const maxAi = round(Math.max(...A.detector))
console.log('判定：人味分离 ' + gapHuman + '（目标 ≥20）' + (gapHuman >= 20 ? ' ✓' : ' ✗'))
console.log('      人写分离 ' + gapDet + '（目标 ≥10）' + (gapDet >= 10 ? ' ✓' : ' ✗'))
console.log('      最差人写样本 ' + minHuman + ' vs 最好 AI 样本 ' + maxAi + (minHuman > maxAi ? ' ✓ 无重叠' : ' ✗ 有重叠'))
