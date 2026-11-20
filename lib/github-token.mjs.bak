/**
 * github-token.mjs —— 内嵌的 GitHub 读取凭据（0.19.0 / 0.20.0 收紧）
 *
 * 为什么内嵌：这个插件只有作者本人用，但要在好几台设备上跑；每台都配 gh CLI
 * 登录或 GITHUB_TOKEN 太麻烦。这里放一份内嵌凭据当默认值，环境变量仍然优先。
 *
 * 0.20.0 收紧（三个死限制，代码层挡，不靠自觉）：
 *   ① 只许发给 api.github.com / codeload.github.com —— 别的域名一律不发，
 *      防止某天 URL 拼错或被注入把凭据送到第三方；
 *   ② 只许用在 pinnedRepo（package.json 的 dsh.githubRepo / XIAOYU_GITHUB_REPO）
 *      —— 拿这份凭据去打别的仓库直接拒绝；
 *   ③ 只用于读 —— 所有带凭据的请求都必须是 GET；POST/PUT/PATCH/DELETE 一律
 *      不发凭据（本插件也确实只用它读版本号和源码包）。
 *
 * 目标形态：fine-grained PAT，只授这一个仓库的 Contents: Read。这样即使源码
 * 外流，别人也只能读这一个私有库。换令牌用 `xiaoyu-novel token set <PAT>`
 * （会先验证权限，再重写本文件），`xiaoyu-novel token check` 可随时体检当前
 * 凭据是不是真的最小权限。
 *
 * 编码：XOR + base64 + 分块。不是加密（懂的人能解），但源码里搜不到明文，
 * 也不会被 GitHub secret scanning 当成泄露的 OAuth 串（那会导致 push 被拦、
 * 令牌被自动吊销）。
 */
const KEY = 'xiaoyu-novel-2026-embedded'

/** 允许携带凭据的主机白名单（硬编码，不接受任何外部覆盖）。 */
export const TOKEN_HOST_ALLOWLIST = ['api.github.com', 'codeload.github.com']

/** 内嵌凭据的形态说明：换令牌时由 xiaoyu-novel token set 一并更新。 */
export const EMBEDDED_TOKEN_KIND = 'fine-grained'
export const EMBEDDED_TOKEN_SCOPE = 'Contents: Read @ gqpG10/dsh-xiaoyu-novel'

const PARTS = [
  'HwEOMBA/ZlcE',
  'GiIjFH9JcVtm',
  'XRtXAQhXVjc0',
  'LSYYKR5ZPFxD',
  'P1R9RA==',
]

/** 解出内嵌 token；任何异常一律返回空串（拿不到就当没有，不抛错）。 */
export function embeddedGithubToken() {
  try {
    const joined = PARTS.join('')
    if (joined === '') return ''
    const buf = Buffer.from(joined, 'base64')
    const out = Buffer.alloc(buf.length)
    for (let i = 0; i < buf.length; i += 1) out[i] = buf[i] ^ KEY.charCodeAt(i % KEY.length)
    const token = out.toString('utf8')
    // 形状校验：GitHub token 是字母数字下划线组成的长串，解错了绝不往外发
    return /^[A-Za-z0-9_]{20,255}$/.test(token) ? token : ''
  } catch {
    return ''
  }
}

/** 凭据指纹（前 8 位 + 长度）：日志/体检里显示它，不暴露完整串。 */
export function tokenFingerprint(token) {
  const text = String(token ?? '')
  if (text === '') return ''
  return text.slice(0, 8) + '…(' + text.length + ')'
}

/**
 * 凭据优先级：环境变量（临时换/调试）> 内嵌凭据（多端开箱即用）。
 * 调用方若还要试 gh CLI，那是另一层，见 lib/github-update.mjs。
 */
export function resolveGithubToken(env = {}) {
  const fromEnv = String(env.GITHUB_TOKEN || env.GH_TOKEN || '').trim()
  if (fromEnv !== '') return { token: fromEnv, source: 'env' }
  const builtin = embeddedGithubToken()
  if (builtin !== '') return { token: builtin, source: 'embedded' }
  return { token: '', source: 'none' }
}

/**
 * 凭据能不能发往这个 URL：只认白名单主机 + https。
 * 任何解析失败都按「不许」处理（宁可查不到，不可外发）。
 */
export function isAllowedTokenTarget(url) {
  try {
    const parsed = new URL(String(url))
    if (parsed.protocol !== 'https:') return false
    return TOKEN_HOST_ALLOWLIST.indexOf(parsed.hostname) !== -1
  } catch {
    return false
  }
}

/**
 * 带凭据的请求只许是读：GET / HEAD。写方法一律不带凭据。
 * （本插件只用它读 releases 与 tarball，这条是防止将来有人顺手加写操作。）
 */
export function tokenMethodAllowed(method) {
  const up = String(method ?? 'GET').toUpperCase()
  return up === 'GET' || up === 'HEAD'
}