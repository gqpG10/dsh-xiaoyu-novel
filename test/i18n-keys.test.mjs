import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ── i18n 键覆盖（0.15.0）──────────────────────────────────────────────────
// 手写双语词典最怕「加了 tt("x.y") 忘了加键」——界面直接裸显 x.y。
// 这条用静态扫描兜住：凡 tt/tf 里出现的字面量键，必须已定义；
// 动态拼接（tt("gate.hook." + kind)）以结尾的点识别，跳过。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const client = readFileSync(path.join(root, 'lib/client.js'), 'utf8')

test('i18n：所有字面量键都已定义', () => {
  const defined = new Set([...client.matchAll(/"([a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z0-9_.]+)"\s*:/g)].map((m) => m[1]))
  const used = [...client.matchAll(/(?:tt|tf)\(\s*"([a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z0-9_.]+)"/g)].map((m) => m[1])
  const missing = [...new Set(used)].filter((k) => !k.endsWith('.') && !defined.has(k))
  assert.deepEqual(missing, [], '未定义的 i18n 键：' + missing.join(', '))
})

test('i18n：0.15.0 之前的核心键仍然中英双全', () => {
  for (const key of ['common.loading', 'header.settings', 'tabs.overview', 'reader.save', 'search.open', 'palette.open']) {
    const hits = client.split('"' + key + '":').length - 1
    assert.ok(hits >= 2, key + ' 中英未双全')
  }
})
