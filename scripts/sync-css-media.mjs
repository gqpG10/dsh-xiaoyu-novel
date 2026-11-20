// 把 lib/base.css 里的 @container (max-width: Npx) 窄屏块同步成 @media 副本。
//
// 为什么两份：
//   - @container 按「实例实宽」判，桌面上把右栏拖窄也生效（0.4.3 的初衷）；
//   - 但宿主 WebView 未必支持容器查询（手机实拍：窄屏规则整体没命中，正文框
//     被基础规则挤成空条）。@media 按视口宽判，手机上一律命中，是兜底路径。
// 两份内容必须逐字一致（test/mobile-layout.test.mjs 比对），所以由脚本生成，
// 手改 @container 后跑：node scripts/sync-css-media.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'base.css')
const MARK = '/* @sync-media 由 scripts/sync-css-media.mjs 从上面的 @container 块生成，勿手改 */'

function blockEnd(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  throw new Error('未闭合的块：' + text.slice(open, open + 40))
}

function stripGenerated(text) {
  const re = /@media \(max-width: \d+px\) \{ \/\* @sync-media/g
  let out = text
  let m
  while ((m = re.exec(out)) !== null) {
    const open = out.indexOf('{', m.index)
    const end = blockEnd(out, open)
    // 连同前面的空行一起去掉
    let start = m.index
    while (start > 0 && (out[start - 1] === '\n' || out[start - 1] === ' ')) start--
    out = out.slice(0, start) + out.slice(end)
    re.lastIndex = 0
  }
  return out
}

function main() {
  let css = readFileSync(file, 'utf8')
  css = stripGenerated(css)
  const inserts = []
  const re = /@container \(max-width: (\d+)px\) \{/g
  let m
  while ((m = re.exec(css)) !== null) {
    const open = css.indexOf('{', m.index)
    const end = blockEnd(css, open)
    const body = css.slice(open + 1, end - 1)
    inserts.push({ at: end, width: m[1], body })
  }
  inserts.sort((a, b) => b.at - a.at) // 从后往前插，避免偏移
  for (const ins of inserts) {
    const media = '\n\n@media (max-width: ' + ins.width + 'px) { ' + MARK + ins.body + '}'
    css = css.slice(0, ins.at) + media + css.slice(ins.at)
  }
  writeFileSync(file, css)
  console.log('synced', inserts.map((i) => '@media ' + i.width + 'px').join(', '))
}

main()
