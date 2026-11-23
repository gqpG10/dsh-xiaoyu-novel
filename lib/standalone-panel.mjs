/**
 * 独立版面板（3.1.5 引入，3.1.8 起正文外置到 standalone-panel.html）。
 *
 * 为什么正文放到 .html 文件：
 *   index.mjs 是服务端代码，只随宿主进程启动加载；面板页面改版频繁，每次都
 *   要重启 DSH 才能看到变化，迭代成本太高。外置成文件后，路由用 readFile 现读
 *   （与 client.css 同款），改完刷新页面即生效。这里的常量只为「文件缺失时回落」
 *   以及静态测试（测试要能拿到页面内容做断言）保留。
 *
 * 页面本身刻意零依赖：不加载宿主 bundle、不加载 React、不加载 base.css，
 * 样式全部内联，只用最老的 CSS 属性 —— 主面板在低端 WebView 上黑屏时，它必须
 * 能独立可用。它同时是判定器：这页正常而主面板黑，问题就在宿主 bundle/React 层。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

function load() {
  try {
    return readFileSync(path.join(HERE, 'standalone-panel.html'), 'utf8')
  } catch {
    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>小鱼创作台</title></head>' +
      '<body><p>独立版面板文件缺失（lib/standalone-panel.html），请重新安装插件。</p></body></html>'
  }
}

export const STANDALONE_PANEL_HTML = load()
export const STANDALONE_PANEL_FILE = path.join(HERE, 'standalone-panel.html')
