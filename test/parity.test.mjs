import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeChapter } from '../lib/gate-core.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SAMPLE = '门是被踹开的。\n\n他先听见鞋跟磕在门槛上，金属磕水泥，一下，不响。然后才闻到味儿，血腥气混着雨。\n\n“醒了？”\n\n林尘没答。他撑着床沿坐起来，掌心压在木板上，硌得慌——底下有颗钉子尖露出来，昨天他就发现了。\n\n“三天。”那人竖起三根手指，指甲缝里全是黑的，“你睡了三天。”\n'

test('JS 引擎与 python 脚本对拍：人味指数差 ≤1、人写度差 ≤1', (t) => {
  const probe = spawnSync('python3', ['-V'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) { t.skip('未安装 python3，跳对拍'); return }
  const dir = mkdtempSync(path.join(tmpdir(), 'xiaoyu-parity-'))
  const file = path.join(dir, 's.txt')
  writeFileSync(file, SAMPLE, 'utf8')
  try {
    const js = analyzeChapter(SAMPLE)
    const run = spawnSync('python3', [path.join(root, 'skills/xiaoyu-qu-ai-wei/scripts/aiwei_scan.py'), file, '--json'], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    const py = JSON.parse(run.stdout)
    assert.ok(Math.abs(js.score - py.score) <= 1, 'human delta ' + Math.abs(js.score - py.score))
    assert.ok(Math.abs(js.detector.score - py.detector.score) <= 1, 'detector delta ' + Math.abs(js.detector.score - py.detector.score))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
