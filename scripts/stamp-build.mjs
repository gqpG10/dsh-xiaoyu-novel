// 把 package.json 的 version 写进 lib/client.js 的 BUILD_STAMP（3.1.7）。
//
// 为什么需要：client.js 是手写、零构建的浏览器 bundle，宿主把它一次性编进页面；
// 之后改 client.js、重启 DSH 都不会换掉已经打开的那个标签页里的 JS。
// 真机上「改了四轮都没反应」就是栽在这里。BUILD_STAMP 是写死在 bundle 里的字符串，
// 面板标题会把它显示出来（b3.1.7），于是肉眼就能判断浏览器跑的是哪一版。
// 这个脚本保证它和 package.json 的版本永远一致（另有测试断言）。
//
// 用法：node scripts/stamp-build.mjs（npm run stamp 已接在 pack 之前）
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG = path.join(ROOT, 'package.json')
const CLIENT = path.join(ROOT, 'lib', 'client.js')

const version = JSON.parse(readFileSync(PKG, 'utf8')).version
const src = readFileSync(CLIENT, 'utf8')
const re = /var BUILD_STAMP = "[^"]*";/
if (!re.test(src)) {
  console.error('client.js 里找不到 var BUILD_STAMP = "…";')
  process.exit(1)
}
const next = src.replace(re, 'var BUILD_STAMP = "' + version + '";')
if (next === src) {
  console.log('build stamp 已是 ' + version)
} else {
  writeFileSync(CLIENT, next)
  console.log('build stamp 更新为 ' + version)
}
