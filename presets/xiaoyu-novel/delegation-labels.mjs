/**
 * 委派子代理标签带角色名（delegation-labels.mjs）
 *
 * dsh-xiaoyu-novel 小鱼创作 preset 组件。主 agent 委派角色（outline /
 * draft / review / lore / research）时，委派工具调用的 description 参数会成为
 * 子会话的持久 label——任务管理页、会话头子代理目录树、后台任务列表展示的
 * 都是它。主编随手写的 description 只是一句任务短语，分不清哪条子代理是谁
 * 在干活；本插件在 tools/pre-execute 瀑布上把命中角色的委派调用改写成
 * `角色名 · 原任务短语`（如「写手 · 第 12 章正文」），三处展示面统一带角色名。
 *
 * 机制（提示词约束做不到的确定性改写）：dsh-tools 调度器在每次工具执行前跑
 * tools/pre-execute 瀑布，随后把同一个 exec.arguments 对象原样交给工具本体。
 * 子会话 label、jobs label、continuable label 三者都取自 args.description，
 * 在这里原地改写该字段，下游一并生效并随子会话 descriptor 持久化。处理完
 * 必须 return await next() 放行——本插件只管标签，永不拦截委派。
 *
 * config.roles 是委派行里写死的静态映射（toolName → 显示名）；全空时不注册
 * 任何处理器。幂等：已带 `角色名 · ` 前缀的 description 不重复加前缀。
 *
 * 失败面：整段 try/catch 包住，任何异常只 warn 一次后照常放行。
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'xiaoyu-delegation-labels'

/** The waterfall rides on ctx events; tools guarantees the registry exists first. */
export const inject = ['tools']

/** 角色名与任务短语之间的缺省分隔符。 */
const DEFAULT_SEPARATOR = ' · '

/**
 * 把主编随手写的任务短语收敛成中文标签短语。
 *
 * 模型偶尔会把 description 写成英文或中英混排（如 Outline ch022 耗格式），
 * 直接当 label 会污染任务页、会话头与后台列表。这里做确定性兜底：短语里出现
 * 任何 ASCII 字母就判定为不合格，改用 prompt 里的章号（第 N 章）当短语；
 * prompt 里也取不到章号时返回空串，由调用方退化成纯角色名。
 *
 * @param {unknown} description 主编传入的任务短语
 * @param {unknown} prompt 委派正文，用来兜底抽取章号
 * @returns {string} 合格的中文短语，或空串表示退化成纯角色名
 */
function normalizePhrase(description, prompt) {
  const phrase = String(description).trim().replace(/\s+/g, ' ')
  if (phrase === '') return ''
  if (!/[A-Za-z]/.test(phrase)) return phrase
  const chapter = /第\s*([0-9]+)\s*章/.exec(typeof prompt === 'string' ? prompt : '')
  return chapter === null ? '' : '第' + chapter[1] + '章'
}

/** 标签改写出错只提醒一次，避免每次委派都刷一条日志。 */
let warned = false

/**
 * @param {object} ctx - cordis context（事件瀑布 / logger）。
 * @param {{ separator?: string, roles?: Record<string, string> }} config
 *   委派行写入的角色显示名映射与可选分隔符。
 */
export function apply(ctx, config = {}) {
  const separator =
    typeof config.separator === 'string' && config.separator !== '' ? config.separator : DEFAULT_SEPARATOR
  const displayNames = new Map()
  for (const [toolName, displayName] of Object.entries(config.roles ?? {})) {
    if (typeof toolName !== 'string' || toolName === '') continue
    if (typeof displayName !== 'string' || displayName.trim() === '') continue
    displayNames.set(toolName, displayName.trim())
  }
  if (displayNames.size === 0) return

  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      const toolName = exec?.name
      if (typeof toolName === 'string' && displayNames.has(toolName)) {
        const args = exec.arguments
        if (args !== null && typeof args === 'object') {
          const roleName = displayNames.get(toolName)
          const prefix = `${roleName}${separator}`
          const description = args.description
          if (typeof description === 'string' && description.trim() !== '' && !description.startsWith(prefix)) {
            const phrase = normalizePhrase(description, args.prompt)
            args.description = phrase === '' ? roleName : `${prefix}${phrase}`
          }
        }
      }
    } catch (error) {
      if (!warned) {
        warned = true
        ctx.logger?.warn?.(`${name}: 标签前缀注入失败，本次按原 description 放行（后续不再提醒）: ${String(error)}`)
      }
    }
    return await next()
  })
}
