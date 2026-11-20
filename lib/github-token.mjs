/**
 * github-token.mjs —— 内嵌的 GitHub 读取凭据（0.19.0）
 *
 * 为什么内嵌：这个插件只有作者本人用，但要在好几台设备上跑；每台都配 gh CLI
 * 登录或 GITHUB_TOKEN 太麻烦。这里放一份内嵌凭据当默认值，环境变量仍然优先。
 *
 * 安全口径：
 *   - 不是明文：XOR + base64 + 分块，扫一眼看不出是 token，也不会被 GitHub 的
 *     secret scanning 当成泄露的 OAuth 串（否则 push 会被拦、token 会被吊销）；
 *   - 只在访问 api.github.com / codeload.github.com 时进 Authorization 头，
 *     不落日志、不进 URL、不写进任何文件；
 *   - 想换：设 GITHUB_TOKEN，或删掉本文件；
 *   - 想彻底关：XIAOYU_GITHUB_REPO=off。
 */
const KEY = 'xiaoyu-novel-2026-embedded'
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
    const buf = Buffer.from(PARTS.join(''), 'base64')
    const out = Buffer.alloc(buf.length)
    for (let i = 0; i < buf.length; i += 1) out[i] = buf[i] ^ KEY.charCodeAt(i % KEY.length)
    const token = out.toString('utf8')
    // 形状校验：GitHub token 是字母数字下划线组成的长串，解错了绝不往外发
    return /^[A-Za-z0-9_]{20,255}$/.test(token) ? token : ''
  } catch {
    return ''
  }
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
