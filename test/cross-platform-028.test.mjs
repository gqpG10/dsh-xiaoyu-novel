import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')

/**
 * 跨端兼容守卫（3.1.1）。
 *
 * Windows 上这批测试曾报一片红：`new URL(import.meta.url).pathname` 在 Windows
 * 返回 `/C:/...`（带前导斜杠、百分号未解码），喂给 path.resolve 得到不存在的
 * 路径，包根读不到 → package.json 读不到 → 版本恒为 fallback。表现是「检测更新
 * 没反应」。另外测试里 `execFileSync('cp')` 在 Windows 上根本没有这个命令。
 *
 * 这些是平台差异，Linux 上永远不会暴露——只能靠静态断言守住。
 */

test('不许用 new URL(...).pathname 当文件路径（Windows 会带前导斜杠且不解码）', () => {
  const files = [
    'index.mjs',
    'lib/github-update.mjs',
    'lib/yaml-loader.mjs',
    'lib/version.mjs',
    'bin/xiaoyu-novel.mjs',
    'test/adopt-023.test.mjs',
    'test/github-update.test.mjs',
    'test/ledger-clean.test.mjs',
    'test/portable-024.test.mjs',
  ]
  for (const file of files) {
    let text
    try {
      text = read(file)
    } catch {
      continue
    }
    // 只抓「当路径用」的写法；url.pathname 是 HTTP 路由解析，合法
    const bad = /\(new URL\([^)]*\)\.pathname\)|\(new URL\([^)]*\)\)\.pathname/
    assert.equal(bad.test(text), false, file + ' 用了 new URL().pathname 当路径，Windows 会错位')
  }
})

test('测试里不许 execFileSync 调 POSIX-only 命令（Windows 没有 cp/mkdir/rm）', () => {
  const files = ['test/github-update.test.mjs', 'test/adopt-023.test.mjs', 'test/ledger-clean.test.mjs', 'test/portable-024.test.mjs']
  const posixOnly = /execFileSync\(\s*['"](cp|rm|mv|mkdir|chmod|touch|cat)['"]/
  for (const file of files) {
    let text
    try {
      text = read(file)
    } catch {
      continue
    }
    assert.equal(posixOnly.test(text), false, file + ' 里有 POSIX-only 命令，Windows 跑不了')
  }
})

test('插件根必须用 fileURLToPath 解析', () => {
  const text = read('lib/github-update.mjs')
  assert.match(text, /fileURLToPath/, 'pluginRootOf 要用 fileURLToPath')
  assert.match(text, /path\.resolve\(path\.dirname\(fileURLToPath\(moduleUrl\)\), '\.\.'\)/)
  const index = read('index.mjs')
  assert.match(index, /const PLUGIN_ROOT = path\.dirname\(fileURLToPath\(import\.meta\.url\)\)/)
})

test('update-check 有服务端硬超时（不让请求挂死＝「检测更新没反应」）', () => {
  const text = read('index.mjs')
  assert.match(text, /Promise\.race\(/, 'update-check 要 race 硬超时')
  assert.match(text, /timedOut: true/)
  assert.match(text, /检测超时/, '超时要给中文原因')
})

test('客户端检测更新有短超时（不永久停在「检测中…」）', () => {
  const text = read('lib/client.js')
  assert.match(text, /xiaoyuApi\("update-check\?fresh=1", undefined, 20000\)/, '检测更新要 20s 超时')
})
