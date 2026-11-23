// 给 base.css 里每个 var(--dsw-alias-*) 就地补后备值（3.1.6）。
//
// 为什么必须逐个补、不能只在根部定义一套：
//   有些设备的 WebView 里 DSH 的主题变量压根不存在（实测：Android 10 WebView，
//   Chrome 150，7 个 --dsw-alias-* 全部为空）。CSS 规则是——变量不存在且没有
//   后备值时，整条声明在计算值阶段退化成 unset：background 变透明、color 变继承、
//   border 宽度归零。于是面板变成「一堆没有边框的透明块」，肉眼就是一片黑。
//   在根部（.myt-view / :root）重定义又会盖掉桌面亮色主题，所以只能逐处补：
//   宿主有变量时后备值被忽略，没有时落到深色调色板。
//
// 幂等：已经有后备值的 var() 不再动。用法：
//   node scripts/ensure-var-fallback.mjs          改写文件
//   node scripts/ensure-var-fallback.mjs --check   只报告缺口（CI 用）
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'base.css')

/** 深色后备调色板：与 [data-myt-novars] 块保持一致。 */
export const FALLBACKS = {
  '--dsw-alias-bg-base': '#17181c',
  '--dsw-alias-bg-layer-1': '#1d1f24',
  '--dsw-alias-bg-layer-2': '#23262c',
  '--dsw-alias-bg-layer-3': '#292d34',
  '--dsw-alias-label-primary': '#e9eaec',
  '--dsw-alias-label-secondary': '#b9bdc4',
  '--dsw-alias-label-tertiary': '#8d939c',
  '--dsw-alias-label-primary-inverted': '#17181c',
  '--dsw-alias-text-secondary': '#b9bdc4',
  '--dsw-alias-border-l1': '#34383f',
  '--dsw-alias-border-l2': '#3d424a',
  '--dsw-alias-border-l3': '#474d56',
  '--dsw-alias-border-l4': '#535a64',
  '--dsw-alias-interactive-bg-hover': '#2e333a',
  '--dsw-alias-state-business-primary': '#4b8bf5',
  '--dsw-alias-button-primary-fill': '#4b8bf5',
  '--dsw-alias-state-success-primary': '#3fbf7f',
  '--dsw-alias-state-warn-primary': '#e0a63c',
  '--dsw-alias-state-warning-primary': '#e0a63c',
  '--dsw-alias-state-error-primary': '#ef5b5b',
}

/** 找到与 open 处左括号配对的右括号位置。 */
function matchParen(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** 在顶层（不跨括号）按逗号切分。 */
function splitTopLevel(inner) {
  const parts = []
  let depth = 0
  let cur = ''
  for (const ch of inner) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue }
    cur += ch
  }
  parts.push(cur)
  return parts
}

export function ensureVarFallbacks(css) {
  const gaps = []
  /**
   * 递归处理：不仅要补「外层 var()」，还要钻进它的后备值参数里继续补。
   * 否则 var(--a, var(--b)) 这种写法在「a、b 都缺失」的设备上照样整条作废
   * ——外层有后备值，但后备值本身又是一个缺失的变量。
   */
  function walk(text) {
    let out = ''
    let i = 0
    while (i < text.length) {
      const at = text.indexOf('var(', i)
      if (at === -1) { out += text.slice(i); break }
      out += text.slice(i, at)
      const open = at + 3
      const close = matchParen(text, open)
      if (close === -1) { out += text.slice(at); break }
      const inner = walk(text.slice(open + 1, close))
      const parts = splitTopLevel(inner)
      const name = parts[0].trim()
      let rebuilt = 'var(' + inner
      if (name.startsWith('--dsw-alias-')) {
        if (parts.length === 1) {
          const fb = FALLBACKS[name]
          if (fb) rebuilt += ', ' + fb
          else gaps.push(name)
        }
      }
      out += rebuilt + ')'
      i = close + 1
    }
    return out
  }
  return { css: walk(css), gaps }
}

function main() {
  const checkOnly = process.argv.includes('--check')
  const original = readFileSync(FILE, 'utf8')
  // 多轮收敛：外层 var() 一旦补上后备值，里面嵌套的 var() 才「露出来」变成下一轮
  // 的待补对象。例：var(--a, var(--b)) 第一轮只能补 --a，--b 要第二轮才轮到。
  // 在手机上两个都缺失时，内层没后备值照样让整条声明作废，所以必须补干净。
  const { css, gaps } = ensureVarFallbacks(original)
  const added = (css.match(/var\(--dsw-alias-[a-z0-9-]+, /g) || []).length
  if (gaps.length) {
    console.log('未覆盖的变量（需补进 FALLBACKS）：', [...new Set(gaps)].join(', '))
  }
  if (checkOnly) {
    console.log(original === css ? '无需改动（全部 ' + added + ' 处已有后备值）' : '有 ' + added + ' 处缺后备值')
    process.exit(original === css ? 0 : 1)
  }
  if (original === css) { console.log('无需改动'); return }
  writeFileSync(FILE, css)
  console.log('已补后备值；当前 var(--dsw-alias-*, …) 总数：' + added)
}

if (process.argv[1] && process.argv[1].endsWith('ensure-var-fallback.mjs')) main()
