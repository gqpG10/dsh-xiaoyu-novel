// 把 package.json 的 version 写进两处「写死的构建戳」（3.1.7 / 3.1.8）：
//   - lib/client.js        var BUILD_STAMP = "x.y.z"   （面板标题显示 b<版本>）
//   - lib/standalone-panel.html  var BUILD = 'x.y.z'   （独立版顶栏徽章）
//
// 为什么需要：client.js 是手写、零构建的浏览器 bundle，宿主把它一次性编进页面；
// 改完重启 DSH 也不会换掉已经打开的那个标签页里的 JS。真机「改了四轮都没反应」
// 就栽在这里。构建戳写死在 bundle 里，面板上直接显示，一眼可判跑的是哪一版。
//
// 用法：node scripts/stamp-build.mjs（npm run pack 已自动串联）
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version

const targets = [
  { file: path.join(ROOT, 'lib', 'client.js'), re: /var BUILD_STAMP = "[^"]*";/, make: (v) => 'var BUILD_STAMP = "' + v + '";' },
  { file: path.join(ROOT, 'lib', 'standalone-panel.html'), re: /var BUILD = '[^']*';/, make: (v) => "var BUILD = '" + v + "';" },
]

let changed = 0
for (const t of targets) {
  const src = readFileSync(t.file, 'utf8')
  if (!t.re.test(src)) {
    console.error('找不到构建戳锚点：' + t.file)
    process.exit(1)
  }
  const next = src.replace(t.re, t.make(version))
  if (next !== src) { writeFileSync(t.file, next); changed++ }
  console.log(path.basename(t.file) + ' → ' + version + (next === src ? '（已是最新）' : '（已更新）'))
}
console.log(changed ? '构建戳已同步' : '构建戳无需改动')
