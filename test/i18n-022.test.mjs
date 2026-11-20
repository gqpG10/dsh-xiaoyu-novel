import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ── i18n 词典体检（0.22.0）─────────────────────────────────────────────────
// 现场：client.js 里两份词典（zh / en）+ 三处 Object.assign 追加，共 700+ 键，
// 7000 行里靠肉眼找「这个键只加了中文没加英文」不现实。这里用正则把词典
// 抽出来做机器校验——不重构、不改加载契约（bundle 是手写零构建、不能 require
// 本地文件），只保证「加键时漏一边」当场被测试拦住。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const client = readFileSync(path.join(root, 'lib/client.js'), 'utf8')

/** 抽出 var I18N = { zh: {...}, en: {...} } 里某一语言的键集合。 */
function keysOf(lang) {
  const start = client.indexOf('    var I18N = {')
  assert.ok(start !== -1, '找不到 I18N 定义')
  const zhAt = client.indexOf('zh: {', start)
  const enAt = client.indexOf('en: {', start)
  const from = lang === 'zh' ? zhAt : enAt
  assert.ok(from !== -1, lang + ' 词典找不到')
  // 词典本体到下一个顶层键为止：zh 到 en:，en 到 Object.assign 或 }; 结尾
  const to = lang === 'zh' ? enAt : client.indexOf('\n    };', enAt)
  const body = client.slice(from, to)
  const keys = new Set()
  const re = /"([a-zA-Z][\w.]*)":\s/g
  let m
  while ((m = re.exec(body)) !== null) keys.add(m[1])
  return keys
}

test('中英词典键集合一致（加键漏一边会被拦住）', () => {
  const zh = keysOf('zh')
  const en = keysOf('en')
  assert.ok(zh.size > 300, '中文词典键数异常偏少：' + zh.size)
  const missingInEn = [...zh].filter((k) => !en.has(k))
  const missingInZh = [...en].filter((k) => !zh.has(k))
  assert.deepEqual(missingInEn, [], '这些键只有中文：' + missingInEn.join(', '))
  assert.deepEqual(missingInZh, [], '这些键只有英文：' + missingInZh.join(', '))
})

test('0.22.0 新增的键中英都在', () => {
  for (const key of [
    'check.clean', 'check.cleaning', 'check.cleanTip', 'check.cleanDirty',
    'toast.ledgerCleaned', 'toast.ledgerCleanEmpty', 'toast.tokenAging',
  ]) {
    assert.equal(client.split('"' + key + '":').length - 1, 2, key + ' 应中英各一份')
  }
})

test('代码里用到的键都在词典里（防拼错键名出英文原样）', () => {
  // 词典分两批：主字典 + 后面若干 Object.assign(I18N.zh/en, {...}) 追加块。
  // 所以「键存在」= 整个文件里 "key": 出现 ≥2 次（中英各一），比只扫主字典可靠。
  const counts = new Map()
  const def = /"([a-zA-Z][\w.]*)":\s/g
  let d
  while ((d = def.exec(client)) !== null) counts.set(d[1], (counts.get(d[1]) || 0) + 1)
  const used = new Set()
  const re = /\bt[ft]\(\s*"([^"]+)"/g
  let m
  while ((m = re.exec(client)) !== null) {
    // 前缀拼装的键（如 "role." + tone）在源码里就是半个名字，跳过
    if (!m[1].endsWith(".")) used.add(m[1])
  }
  const missing = [...used].filter((k) => !counts.has(k))
  assert.deepEqual(missing, [], '这些键在代码里用到但词典里没有：' + missing.join(', '))
  const oneSided = [...used].filter((k) => (counts.get(k) || 0) < 2)
  assert.deepEqual(oneSided, [], '这些键只出现一次（中英缺一边）：' + oneSided.join(', '))
})

test('同一语言内没有重复键（重复会让后一个静默覆盖前一个）', () => {
  for (const lang of ['zh', 'en']) {
    const start = client.indexOf('    var I18N = {')
    const from = client.indexOf(lang + ': {', start)
    const to = lang === 'zh' ? client.indexOf('en: {', start) : client.indexOf('\n    };', from)
    const body = client.slice(from, to)
    const seen = new Set()
    const dup = []
    const re = /"([a-zA-Z][\w.]*)":\s/g
    let m
    while ((m = re.exec(body)) !== null) {
      if (seen.has(m[1])) dup.push(m[1])
      seen.add(m[1])
    }
    assert.deepEqual(dup, [], lang + ' 词典里重复定义：' + dup.join(', '))
  }
})
