/**
 * dsh-xiaoyu-novel — cordis 插件（启动安装器）
 *
 * 机制：
 * `dsh plugin --profile <name> add dsh-xiaoyu-novel` 时，包内 cordis.patch.yml 的
 * bundle insert（id: xiaoyu-novel-installer / name: dsh-xiaoyu-novel）由宿主
 * reconcilePlugins 并入该 profile 的 dsh.profile.bundles；boot 时 cordis 挂载
 * 本文件（main: index.mjs），apply() 里做一次幂等的 ensurePresetInstalled：
 *
 *   1) 解析 dsh home：process.env.DSH_HOME，缺省 os.homedir()/.dsh；
 *   2) 把 presets/xiaoyu-novel/ 四个源文件（preset.yml / agent.cordis.yml /
 *      restrict.mjs / delegation-labels.mjs）复制到 <home>/.agent-presets/xiaoyu-novel/
 *      ——逐字节比较，内容一致不写（避免无谓的 mtime 抖动）；复制完落
 *      .installed-version 标记（本包版本号，从 package.json 读）；
 *   3) 把包内 skills/ 的 xiaoyu-* 技能目录复制到 <home>/skills/<name>/
 *      ——同样逐字节比较、一致不写，每个技能目录落 .installed-version 标记；
 *      只碰 xiaoyu-* 前缀目录，用户自己的技能一个字节都不动；
 *   4) 维护 patch 托管块（起止标记见 MANAGED_BEGIN / MANAGED_END），块内是
 *      dsh-agent-preset 声明行——preset.yml 的 name/description/order 与
 *      agent.cordis.yml 解析出的完整 plugins 数组全部内联。DSH 0.1.7 起宿主
 *      靠这条声明行发现预设；不写它，预设选择器里就不会出现「小鱼创作
 *      (Xiaoyu)」。写入层随环境选择（resolvePatchLayer）：默认 home 层
 *      <home>/cordis.patch.yml；Android compat 壳每次启动会把 home 层 patch
 *      重写坏（把 preset 的 name/description 拍平成缩进错误的声明行，宿主
 *      解析 fatal，issue #1）——命中壳启发式或环境变量 DSH_XIAOYU_PATCH_LAYER
 *      =profile 时改写 profile 层 <home>/profiles/<name>/cordis.patch.yml
 *      （壳不碰 profile 层的托管块，每次 boot 补写即自愈），并清掉 home 层
 *      遗留托管块防双声明。写前把最终文件整体 yaml.parse 自检（!!js 先经
 *      preprocessPatchText 中和），块外存在结构性坏行时拒绝写盘只 warn；
 *      托管块外检测到「- id: <预设显示名>」形状的坏行同样只 warn 不动
 *      （那是块外用户内容，安装器绝不替用户删）。
 *
 * 幂等语义：托管块已存在、.installed-version 与当前版本一致、且块内容与本次
 *   生成的文本逐字节一致 → 跳过；任一不符 → 保住块外用户内容，整块替换；块
 *   不存在 → 文末追加（home 层默认路径的文件不存在则创建，带一行头注释说明
 *   这是 home 级 patch 层；profile 层等自定义 patchPath 的新文件不写头注释）。
 *   内容比对是版本比对之外的兜底：开发检出（link 安装）改了预设源而没改版本
 *   号时，重启照样换新，不会带着旧组合过夜。
 *
 * 形态选择（双形状）：生成内容 = f(宿主版本, 插件版本)。宿主 ≤ 0.2.1-rc.1 用
 *   v1 内联形状（agent.cordis.yml，1 条声明行，委派行内联 persona/toolFilter）；
 *   ≥ 0.2.1-rc.2 用 v2 AgentPreset 形状（agent.cordis.v2.yml，6 条声明行——
 *   主编 preset + 5 张角色 preset，委派行以 agentPreset 指向角色 preset，该版
 *   本起 dsh-tool-subagent 拒绝内联形状）；≥ 0.2.2-alpha.2 额外剥离主编 preset
 *   的 tool-subagent-list-agents 行（0.2.2 把 list_agents 并进 control 主导出，
 *   旧行会拖垮整张主编 preset，issue #7）。宿主升降级后重启即整块切换，无需
 *   重装插件（见 composeManagedRows）。版本完全未知（五级探针全败）时不写
 *   声明行、走 partial 自愈——绝不把可能已 ≥ 0.2.1-rc.2 的宿主声明成 v1 内联。
 *
 * YAML：解析与序列化都从 <home>/node_modules 惰性加载 yaml 包（dsh 自带 v2，
 *   本包零 npm 依赖）。agent.cordis.yml / agent.cordis.v2.yml 解析前先中和
 *   `!!js` 表达式——两个文件都只有 process.platform 两种（tool-bash /
 *   tool-pwsh 的 disabled），直接 replaceAll 成 true/false。yaml 包不可用时：
 *   序列化回退为整段 JSON 单行（YAML 1.2 是 JSON 超集，合法）并 warn；解析没
 *   有可靠回退（plugins 数组结构深，手写子集解析器得不偿失），此时只落预设
 *   文件、跳过声明行并 warn——下次宿主启动（yaml 可用）自动补写，自愈。
 *
 * 失败面：全程 try/catch，任何失败只 warn 不抛——安装器绝不能弄死宿主启动。
 *
 * 三期追加（创作台面板，Node 侧）：本文件同时是 /api/xiaoyu-novel/* 前缀路由的
 *   注册点（inject webServer + workspaceRegistry，见 registerCreatorRoutes）。
 *   路由段与安装段彼此独立、各失败各的：路由注册/请求处理失败只 warn，
 *   安装器语义分毫不动。要点：信任围栏、duplicate prefix route 短重试、
 *   限额 JSON 读体、client.css 现读下发、disposer 挂 ctx.effect（宿主对
 *   cordis.patch.yml 的 HMR 热重载会重建插件纤维，路由必须随纤维注销，
 *   否则残留死 handler 报 inactive context，见 apply 内注释）。
 */

import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { getVersionInfo } from './lib/version.mjs'
import { analyzeChapter, paragraphHeat, fixSentence } from './lib/gate-core.mjs'
import { auditMarkdown, auditProject } from './lib/audit-core.mjs'
import { checkFormat } from './lib/format-core.mjs'
import { checkSetup } from './lib/setup-core.mjs'
// 0.18.0 私有库更新：版本源与安装包都走作者自己的 GitHub 仓库（见 lib/github-update.mjs）。
import { applyGithubUpdate, fetchLatestGithubVersion, recordUpdate, resolveGithubRepo } from './lib/github-update.mjs'
// 0.19.0 多端开箱即用：内嵌凭据兜底（环境变量仍优先）。
import { EMBEDDED_TOKEN_ISSUED_AT, TOKEN_REFRESH_DAYS, resolveGithubToken, tokenAgeDays } from './lib/github-token.mjs'
import { compareVersions, currentVersion, invalidateVersionCache } from './lib/version.mjs'
import { gzipSync } from 'node:zlib'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createChapterFromOutline,
  createManagedFile,
  deleteManagedFile,
  invalidateSnapshotCache,
  listWorkspaces,
  mutateChapterBody,
  mutateChapterStatus,
  mutateForeshadowStatus,
  mutateOutlineBody,
  mutatePhase,
  mutateProject,
  parseStateSnapshot,
  purgeTrashItem,
  readChapter,
  readManagedFile,
  readOutlineFile,
  appendOutlineNote,
  readStyleState,
  rebuildIndex,
  resolveNovelRoot,
  restoreTrashItem,
  listTrashItems,
  saveManagedFile,
  saveStyleText,
} from './lib/panel-core.mjs'
// 0.15.0 回收站与整本导出/账本瘦身：面板侧工具入口的服务端实现。
import { archiveApply, archivePlan } from './lib/slim-core.mjs'
// 0.15.0 账本体检（体积/超长条目）与「本章记账了没」提示。
import { chapterLedgerHint, ledgerStats } from './lib/ledger-stats.mjs'
// 0.16.0 清账本：超长条目压成结论（明细外置）、超期伏笔升推进，一键可撤销。
import { applyLedgerClean, describePlan, planLedgerClean, undoLedgerClean } from './lib/ledger-clean.mjs'
// 0.15.3 本章出场名单：关系图按当前章节过滤节点。
import { chapterCast } from './lib/cast-core.mjs'
// 静态体检（check 路由）与 CLI check 同源：直接复用 novel-parse 的检查器。
import { checkProject } from './lib/novel-parse.mjs'
// 0.22.0 重计算结果缓存：文件没动就别重算（audit 466ms / check 228ms 全是白烧）。
import { cachedResult, clearResultCache, fingerprintOf, fingerprintOfCached } from './lib/result-cache.mjs'
import { loadYamlLib, resolveDshHome } from './lib/yaml-loader.mjs'
// 0.6.0 写作台：正文版本历史与全书搜索/替换（各失败各的，主流程不受影响）。
import { listVersions, readVersion, snapshotChapter } from './lib/history-core.mjs'
import { replaceInNovel, searchNovel } from './lib/search-core.mjs'
import { buildSelectionExport } from './lib/novel-export.mjs'
// 0.10.0 书稿版本安全网（agent 改动不进面板历史，git 是唯一回滚网）。
import { commitAll, gitAvailable, initRepo, listCommits, repoStatus, restoreFile, safeRel } from './lib/git-core.mjs'
import { buildHandoff, renderHandoff } from './lib/handoff-core.mjs'
import { applyRelationStarts, proposeRelationStarts } from './lib/relations-tools.mjs'

// loadYamlLib / resolveDshHome 已迁至 lib/yaml-loader.mjs（创作台业务层与
// 安装器共用，避免 panel-core 反向 import 主入口）；这里再导出保住本入口的
// 既有公开 API。
export { loadYamlLib, resolveDshHome }

/** Cordis plugin name used by loader diagnostics. */
export const name = 'xiaoyu-novel-installer'

/**
 * 需要宿主注入的服务：webServer 注册 /api/xiaoyu-novel 前缀路由，
 * workspaceRegistry 提供工作区白名单（path 参数的安全边界）。webRuntime
 * 不进 inject——非 web 部署没有它，经 ctx.get 每请求软探测（见
 * registerCreatorRoutes 内 trustedHostsOf）。
 */
export const inject = ['webServer', 'workspaceRegistry']

/** 插件包根（本文件所在目录）。 */
const PLUGIN_ROOT = path.dirname(fileURLToPath(import.meta.url))

/** 预设 id：目录名与声明行 config.id 同名。 */
export const PRESET_ID = 'xiaoyu-novel'

/**
 * 旧「毛颖创作台」时期留下的存量项目目录：创建面板只列 workspaceRegistry 里的
 * 根目录，这些目录当年直接建在存储卡上、没进过工作区表，换到小鱼创作台后
 * 就看不见了。启动时按下面的清单幂等注册一次（create 对同一 canonical 路径
 * 重复调用只返回既有实体，不改标题）。目录不存在或没有 novel/project.yml
 * 的条目直接跳过——清单里可以放心留历史路径。
 */
export const EXTRA_WORKSPACES = [
  { path: '/storage/emulated/0/小说创作', title: '小说创作' },
]

/** home patch 托管块起止标记（成对出现；只认首对）。 */
export const MANAGED_BEGIN = '# --- dsh-xiaoyu-novel preset managed (auto-generated; do not edit) ---'
export const MANAGED_END = '# --- end dsh-xiaoyu-novel preset managed ---'

/** 声明行挂载的宿主 preset 包名（0.1.7+ 的 agent-preset-registry 组件包）。 */
const PRESET_ROW_NAME = '@deepseek-ai/dsh-agent-preset'

/**
 * subagent 会话内清点工具（list_agents）的两代挂载形状：
 *   - ≤ 0.2.1-rc.x：独立模块 @deepseek-ai/dsh-tool-subagent-control/list-agents
 *     （子路径导出），委派组里要单独声明一行；
 *   - ≥ 0.2.2-alpha.2：该子路径导出被移除，list_agents 的注册并入
 *     @deepseek-ai/dsh-tool-subagent-control 主导出（apply 末尾自动注册）——
 *     再声明那一行会因模块解析失败整行 never started，注册表审计把整张
 *     主编 preset 判 broken、从选择器消失（issue #7，0.2.2-rc.1 实测复现）。
 * v2 组合源按 ≤ 0.2.1 的形状写（唯一样式来源），组装时按宿主版本剥离旧行。
 */
const SUBAGENT_LIST_AGENTS_ROW_NAME = '@deepseek-ai/dsh-tool-subagent-control/list-agents'

/** 需要落盘的预设源文件（与 presets/xiaoyu-novel/ 一一对应）。 */
const PRESET_FILES = ['preset.yml', 'agent.cordis.yml', 'restrict.mjs', 'delegation-labels.mjs', 'guard.mjs']

/** v2 组合源（AgentPreset 形状，仅宿主 ≥ 0.2.1-rc.2 解析；不落盘，包内直读）。 */
const AGENT_CORDIS_V2_FILE = 'agent.cordis.v2.yml'

/**
 * 新建 home 层 <home>/cordis.patch.yml 时的一行头注释：说明这是 home 级 patch
 * 层。仅默认 home 路径使用——profile 层等自定义 patchPath 的新文件不写头注释
 * （不该自称 home 级）。
 */
const HOME_PATCH_HEADER =
  '# DeepSeek Harness home 级 patch 层（作用于所有 profile）：手工条目可直接追加，各插件的托管块由起止标记维护。'

// ── 小工具 ──────────────────────────────────────────────────────────────────

/** 本包版本号（package.json 的 version）；读不到返回 null。 */
export function pluginVersion() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8'))
    return typeof pkg?.version === 'string' && pkg.version !== '' ? pkg.version : null
  } catch {
    return null
  }
}

/**
 * 中和 cordis 的 `!!js` 表达式（preprocessPatchText 式）。agent.cordis.yml 与
 * agent.cordis.v2.yml 都只有 process.platform 两种表达式（tool-bash / tool-pwsh
 * 的 disabled，v2 里 continuable 三角色的工具行各一对），直接 replaceAll；未来
 * 任一文件新增其他 `!!js` 表达式，必须同步扩充这里，否则 yaml.parse 会告
 * unresolved tag（test/composition.test.mjs 对 v2 有 grep 断言兜底）。
 */
export function preprocessPatchText(text) {
  const isWin = process.platform === 'win32'
  return text
    .replaceAll("!!js process.platform === 'win32'", isWin ? 'true' : 'false')
    .replaceAll("!!js process.platform !== 'win32'", isWin ? 'false' : 'true')
}

/**
 * 逐字节比较复制（预设文件与技能文件共用）：dst 已存在且内容与 src 完全一致
 * 时不写（保住 mtime，二跑零写盘）；读不到/比较失败一律按「不一致」重写。
 * 读/写失败原样抛出，由调用方决定 warn 还是中止——失败语义归调用方。
 * @returns {boolean} 本次是否有复制动作
 */
function syncFileIfChanged(src, dst) {
  let same = false
  try {
    same = existsSync(dst) && readFileSync(dst).equals(readFileSync(src))
  } catch {
    same = false
  }
  if (same) return false
  mkdirSync(path.dirname(dst), { recursive: true })
  copyFileSync(src, dst)
  return true
}

/**
 * .installed-version 版本标记写入（预设目录与技能目录共用）：内容与 version
 * 一致即不重写（mtime 也是产物，少动一次是一次）。标记读不到按过期处理；
 * 写失败原样抛出，warn 文案由调用方按现场拼。
 * @returns {boolean} 本次是否有写入动作
 */
function writeMarkerIfChanged(dir, version) {
  const markerPath = path.join(dir, '.installed-version')
  let current = false
  try {
    current = existsSync(markerPath) && readFileSync(markerPath, 'utf8').trim() === version
  } catch {
    current = false
  }
  if (current) return false
  writeFileSync(markerPath, `${version}\n`, 'utf8')
  return true
}

// ── semver（手写，零依赖）────────────────────────────────────────────────────

/** 解析 major.minor.patch[-prerelease][+build]；解析不了返回 null。 */
export function parseSemver(text) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    String(text ?? '').trim(),
  )
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] ?? null }
}

/** prerelease 逐 token 比较（数字 token 按数值，其余按字典序，数字恒小于字母）。 */
function comparePrereleaseTokens(a, b) {
  const as = String(a).split('.')
  const bs = String(b).split('.')
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const x = as[i]
    const y = bs[i]
    if (x === undefined) return -1 // 前缀更短 = 更小（1.0.0-rc < 1.0.0-rc.1）
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) {
      const d = Number(x) - Number(y)
      if (d !== 0) return d < 0 ? -1 : 1
    } else if (xn !== yn) {
      return xn ? -1 : 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

/**
 * semver 全序比较：a<b → -1，a=b → 0，a>b → 1；任一侧解析失败返回 null。
 * prerelease 按 semver 规则：正式版 > 同号 prerelease（0.2.1 > 0.2.1-rc.2）。
 */
export function compareSemver(a, b) {
  const va = parseSemver(a)
  const vb = parseSemver(b)
  if (!va || !vb) return null
  for (const k of ['major', 'minor', 'patch']) {
    if (va[k] !== vb[k]) return va[k] < vb[k] ? -1 : 1
  }
  if (va.prerelease === vb.prerelease) return 0
  if (va.prerelease === null) return 1
  if (vb.prerelease === null) return -1
  return comparePrereleaseTokens(va.prerelease, vb.prerelease)
}

/**
 * 该宿主版本是否已落地内联委派行守卫（≥ 0.2.1-rc.2，含 0.2.1-rc.2 这个
 * prerelease 本身与之后的正式版）：dsh-tool-subagent 自该版起拒绝 config 里
 * 的 persona / toolFilter 键。版本解析不了返回 false（保守侧：不惊扰）。
 */
export function hostRejectsInlineDelegation(version) {
  const c = compareSemver(version, '0.2.1-rc.2')
  return c !== null && c >= 0
}

/**
 * 该宿主版本是否已把 list_agents 并入 dsh-tool-subagent-control 主导出
 * （≥ 0.2.2-alpha.2，含该 prerelease 本身与之后的 rc/正式版）：独立子路径导出
 * ./list-agents 已删除，v2 组合源里的 tool-subagent-list-agents 声明行必须剥离。
 * 版本解析不了返回 false（保守侧：旧行在旧宿主上是必需的，不乱删）。
 */
export function hostMergedSubagentListAgents(version) {
  const c = compareSemver(version, '0.2.2-alpha.2')
  return c !== null && c >= 0
}

/** 宿主包版本：从 <home>/node_modules require('@deepseek-ai/dsh/package.json')。 */
/**
 * 裸读 asar 内文件（零依赖，不依赖 Electron 的 asar fs 补丁）。asar 格式：
 * 头部 [0..4]=pickle 定长、[12..16]=头 JSON 字节数，头 JSON 是文件树（每个
 * 文件带 offset/size），文件区从 16+jsonSize 起按 offset 裸存。桌面应用的
 * 运行时进程里 existsSync(asar 内路径) 行为不可靠（实测探针轨迹：existsSync
 * 为真但 readFileSync 拿不到内容），按字节切是唯一确定性读法。
 * @returns {object|null} 解析后的 JSON；任何一步失败返回 null
 */
function asarReadJson(asarPath, innerPath) {
  let fd = null
  try {
    fd = openSync(asarPath, 'r')
    const head = Buffer.alloc(16)
    if (readSync(fd, head, 0, 16, 0) !== 16) return null
    const jsonSize = head.readUInt32LE(12)
    const header = Buffer.alloc(jsonSize)
    if (readSync(fd, header, 0, jsonSize, 16) !== jsonSize) return null
    let node = JSON.parse(header.toString('utf8'))
    for (const seg of innerPath.split('/')) {
      node = node?.files?.[seg]
      if (!node) return null
    }
    if (node.files || typeof node.offset !== 'string' || typeof node.size !== 'number') return null
    // 桌面壳的 asar 文件区带块对齐位移（实测 +2 字节），头里的 integrity.hash
    // （文件 SHA256）就是权威标尺：读一带余量窗口，滑窗找到哈希命中的精确切片。
    const size = node.size
    const want = typeof node.integrity?.hash === 'string' ? node.integrity.hash : null
    const slack = 64
    const win = Buffer.alloc(size + 2 * slack)
    const base = 16 + jsonSize
    const at = base + Number(node.offset) - slack
    if (readSync(fd, win, 0, win.length, at) !== win.length) return null
    for (let off = 0; off + size <= win.length; off++) {
      if (win[off] !== 0x7b) continue // JSON 必以 { 开头，先粗筛再哈希
      if (want !== null && createHash('sha256').update(win.subarray(off, off + size)).digest('hex') !== want) continue
      try {
        return JSON.parse(win.toString('utf8', off, off + size))
      } catch { /* 哈希没配或解析失败继续滑 */ }
    }
    return null
  } catch {
    return null
  } finally {
    if (fd !== null) { try { closeSync(fd) } catch { /* 关闭失败无所谓 */ } }
  }
}

/** 从 start 向上最多 8 层找最近的 @deepseek-ai/dsh package.json，命中记轨迹 */
function anchorVersion(start, probe, trace) {
  let dir = path.dirname(path.resolve(start))
  for (let i = 0; i < 8 && dir && dir !== path.dirname(dir); i++, dir = path.dirname(dir)) {
    const pkgPath = path.join(dir, 'package.json')
    if (!existsSync(pkgPath)) continue
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      if (pkg?.name === '@deepseek-ai/dsh' && typeof pkg.version === 'string' && pkg.version !== '') {
        trace.push({ probe, hit: pkg.version, via: pkgPath })
        return pkg.version
      }
    } catch { /* 单个坏 package.json 跳过继续走 */ }
  }
  trace.push({ probe, hit: null })
  return null
}

/**
 * 宿主版本探测（带轨迹）。五级优先，前四级都锚定「当前进程的真实宿主」，
 * home 全局那份（老 CLI 残留，版本可能差几个大版本）只做最后兜底：
 *   ① argv[1]——CLI 下就是 @deepseek-ai/dsh 包内入口；
 *   ② 全 argv 扫描——Electron 主进程常见 argv 里带 app 入口或 .asar 路径；
 *   ③ app.asar 锚定——桌面应用 execPath 反推 Resources/app.asar/dsh（Electron
 *      主进程 fs 可透读 asar）；
 *   ④ Electron app.getVersion()——桌面应用版本即其内置 dsh 版本；
 *   ⑤ home 全局安装兜底。
 * 轨迹经 trace 数组透出（host-debug 路由用），方便现场诊断每级看到了什么。
 */
function collectHostVersion(dshHome, trace) {
  // ① argv[1]
  const argv1 = process.argv?.[1]
  if (typeof argv1 === 'string' && argv1 !== '') {
    const hit = anchorVersion(argv1, 'argv[1]', trace)
    if (hit) return hit
  } else {
    trace.push({ probe: 'argv[1]', hit: null, note: 'argv[1] 缺席' })
  }
  // ② 全 argv 扫描
  let scanned = 0
  for (const arg of process.argv ?? []) {
    if (typeof arg !== 'string' || arg === argv1 || arg.startsWith('-')) continue
    if (!/\.asar($|\/)|\.(mjs|cjs|js)$/.test(arg)) continue
    scanned++
    const hit = anchorVersion(arg, 'argv-scan', trace)
    if (hit) return hit
  }
  if (scanned === 0) trace.push({ probe: 'argv-scan', hit: null, note: '无可锚定的 argv 项' })
  // ③ app.asar 裸读锚定（桌面应用的确定性读法，见 asarReadJson 说明）
  if (process.versions?.electron) {
    const execDir = path.dirname(process.execPath)
    const asarPaths = [
      path.resolve(execDir, '..', 'Resources', 'app.asar'),
      path.resolve(execDir, 'resources', 'app.asar'),
    ]
    let sawAsar = false
    for (const asarPath of asarPaths) {
      if (!existsSync(asarPath)) continue
      sawAsar = true
      for (const inner of ['dsh/package.json', 'package.json']) {
        const pkg = asarReadJson(asarPath, inner)
        // 桌面壳内置 dsh 的包名是 @deepseek-ai/dsh-desktop-runtime（实测），CLI
        // 源码包叫 @deepseek-ai/dsh——两者都算命中。
        const okName = pkg?.name === '@deepseek-ai/dsh' || pkg?.name === '@deepseek-ai/dsh-desktop-runtime'
        if (okName && typeof pkg.version === 'string' && pkg.version !== '') {
          trace.push({ probe: 'asar', hit: pkg.version, via: `${asarPath}!${inner}` })
          return pkg.version
        }
      }
    }
    trace.push({ probe: 'asar', hit: null, note: sawAsar ? 'asar 存在但未读到 @deepseek-ai/dsh' : 'asar 路径不存在' })
  } else {
    trace.push({ probe: 'asar', hit: null, note: '非 Electron 进程' })
  }
  // ③′ 桌面运行时 payload 版本：primary-runtime/runtime.json 的 desktopVersion
  //     （真实文件系统，任何上下文可读；比 asar 略弱——payload 可能落后应用壳）
  {
    const execDir = path.dirname(process.execPath)
    const runtimeJsons = (process.argv ?? [])
      .filter((a) => typeof a === 'string' && a !== '' && !a.startsWith('-'))
      .map((a) => path.join(a, 'runtime.json'))
    runtimeJsons.push(path.resolve(execDir, '..', 'Resources', 'runtime', 'primary-runtime', 'runtime.json'))
    for (const rj of runtimeJsons) {
      try {
        if (!existsSync(rj)) continue
        const meta = JSON.parse(readFileSync(rj, 'utf8'))
        const v = meta?.desktopVersion
        if (typeof v === 'string' && v !== '') {
          trace.push({ probe: 'desktop-runtime', hit: v, via: rj })
          return v
        }
      } catch { /* 单个坏文件换下一个 */ }
    }
    trace.push({ probe: 'desktop-runtime', hit: null })
  }
  // ④ Electron app.getVersion()。纯 Node 下 require('electron') 得到路径字符串
  //    或直接找不到，类型守卫天然挡掉。
  try {
    const electron = createRequire(import.meta.url)('electron')
    if (electron && typeof electron === 'object' && typeof electron.app?.getVersion === 'function') {
      const v = electron.app.getVersion()
      const hit = typeof v === 'string' && v !== '' ? v : null
      trace.push({ probe: 'electron-api', hit })
      if (hit) return hit
    } else {
      trace.push({ probe: 'electron-api', hit: null, note: 'require 结果非 API 对象' })
    }
  } catch {
    trace.push({ probe: 'electron-api', hit: null, note: 'require 失败' })
  }
  // ⑤ home 全局兜底
  try {
    const req = createRequire(path.join(dshHome, 'node_modules', 'package.json'))
    const pkg = req('@deepseek-ai/dsh/package.json')
    const hit = typeof pkg?.version === 'string' && pkg.version !== '' ? pkg.version : null
    trace.push({ probe: 'home-global', hit, note: hit ? '兜底命中——home 全局版本可能陈旧' : null })
    return hit
  } catch {
    trace.push({ probe: 'home-global', hit: null })
    return null
  }
}

export function readHostVersion(dshHome) {
  return collectHostVersion(dshHome, [])
}

/** host-debug 路由用：版本 + 每级探针轨迹 */
export function readHostVersionDebug(dshHome) {
  const trace = []
  return { version: collectHostVersion(dshHome, trace), trace }
}

// ── 预设源解析 ──────────────────────────────────────────────────────────────

/**
 * 解析 preset.yml 的显示元数据（name / description / order）。description 在
 * 源文件里是折叠多行纯量，yaml.parse 自动拼成单值。字段缺失返回 null——
 * 它们在声明行 config 里都是宿主可选键。
 */
export function parsePresetMeta(yaml, presetYmlText) {
  const data = yaml.parse(presetYmlText)
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('preset.yml 顶层不是键值映射')
  }
  return {
    name: typeof data.name === 'string' && data.name !== '' ? data.name : null,
    description: typeof data.description === 'string' && data.description !== '' ? data.description : null,
    order: Number.isInteger(data.order) ? data.order : null,
  }
}

/**
 * 解析 agent.cordis.yml 为完整 plugins 数组。`!!js` 先中和（见
 * preprocessPatchText）；顶层必须是数组。
 */
export function parseAgentPlugins(yaml, agentYmlText) {
  const data = yaml.parse(preprocessPatchText(agentYmlText))
  if (!Array.isArray(data)) throw new Error('agent.cordis.yml 顶层不是数组')
  return data
}

/**
 * 组装声明行（insert 列表元素）：id 固定 preset-xiaoyu-novel，config 内联 preset
 * 元数据与 plugins 全量数组。name/description/order 缺省时不写（宿主可选键）。
 */
export function buildPresetRow({ meta, plugins }) {
  const config = { id: PRESET_ID }
  if (meta.name !== null) config.name = meta.name
  if (meta.description !== null) config.description = meta.description
  if (meta.order !== null) config.order = meta.order
  config.plugins = plugins
  return {
    insert: [
      {
        id: `preset-${PRESET_ID}`,
        name: PRESET_ROW_NAME,
        config,
      },
    ],
  }
}

/**
 * 解析 agent.cordis.v2.yml（v2 组合源，patch 形态）为声明行数组。`!!js` 先
 * 中和（见 preprocessPatchText）；顶层必须是单元素数组、唯一元素带非空 insert
 * 数组（6 条 preset 声明行），不合形即抛——坏了宁可 fail-open 也不写半截块。
 */
export function parsePresetRows(yaml, agentCordisV2Text) {
  const data = yaml.parse(preprocessPatchText(agentCordisV2Text))
  if (!Array.isArray(data) || data.length !== 1 || data[0] === null || typeof data[0] !== 'object' || Array.isArray(data[0])) {
    throw new Error('agent.cordis.v2.yml 顶层必须是单元素数组，唯一元素为带 insert 键的映射')
  }
  const rows = data[0].insert
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('agent.cordis.v2.yml 缺少非空 insert 数组')
  for (const row of rows) {
    if (row === null || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string' || typeof row.name !== 'string') {
      throw new Error('agent.cordis.v2.yml 的 insert 数组里存在不合形的声明行（缺 id/name）')
    }
  }
  return rows
}

/**
 * 按宿主版本组装托管块声明行数组（双形态的唯一决策点）：
 *   - 宿主 ≥ 0.2.1-rc.2（hostRejectsInlineDelegation）→ 'v2'：解析
 *     agent.cordis.v2.yml，返回 6 条声明行（主编 preset + 5 张角色 preset，
 *     委派行 agentPreset 形状）。其中宿主 ≥ 0.2.2-alpha.2
 *    （hostMergedSubagentListAgents）时再剥离主编 preset 的
 *     tool-subagent-list-agents 行——0.2.2 把 list_agents 并进了
 *     dsh-tool-subagent-control 主导出，旧行会因模块不存在整张 preset 被
 *     注册表判 broken（issue #7）；
 *   - 宿主 < 0.2.1-rc.2（确知旧版）→ 'v1'：现有单行组装路径原样（内联
 *     persona/toolFilter 形状）；
 *   - 版本完全未知（五级探针全败）→ 不组装：rows 返回 null、reason
 *     'version-unknown'。真实宿主若 ≥ 0.2.1-rc.2，dsh-tool-subagent 会拒绝
 *     v1 内联形状（五路委派全废、只能等探测成功才自愈），「不声明」比
 *     「声明成 v1」安全；shape 仍保守记 'v1'（仅名义标签，本次不落盘）。
 * yaml 包不可用或组合源解析失败时同样 rows 返回 null（shape/hostVersion 照常
 * 带回，reason 区分 'yaml-unavailable' / 'compose-failed' / 'version-unknown'），
 * 由调用方走既有的「只落文件、跳过声明行并 warn、下次自愈」分支。
 * 返回对象另带 presetName：包内 preset.yml 顶层 name:（预设显示名，坏块检测
 * 用，见 upsertManagedBlock）；读不到为 null，绝不因它拖累组合主流程。
 */
/**
 * 读预设显示名（包内 preset.yml 顶层 name:），供坏块检测匹配「- id: <显示名>」
 * 坏块形状（issue #1：Android compat 壳把 preset 元数据拍平成这种坏行）。
 * 任何失败（文件缺失 / 解析炸）返回 null——它只是可选输入，读不到就跳过检测。
 */
function readPresetName(yaml) {
  try {
    return parsePresetMeta(yaml, readFileSync(path.join(PLUGIN_ROOT, 'presets', PRESET_ID, 'preset.yml'), 'utf8')).name
  } catch {
    return null
  }
}
/**
 * preset 声明行里的本地插件名换成 file:// 绝对地址。相对名按「声明方 baseUrl」
 * 解析——home 托管块的声明基座在宿主 asar 内部，'./x.mjs' 在桌面应用里永远
 * 落空（注册表审计报 never started，0.1.8 host-debug 实测坐实）。Node ESM 对
 * file:// URL 是合法模块说明符，指向 <home>/.agent-presets/xiaoyu-novel/ 安装副本
 * （真实文件系统，任何进程可读）。
 *
 * 遍历策略：保守递归下钻声明行整棵结构（对象/数组逐层走），不只盯
 * config.plugins 一层——v1 组合源的 cordis:group 子件就挂在 config 数组里，
 * 未来再嵌套一层的 './' 本地名只盯单层会静默漏改。凡遍历到的 './' 开头字符串
 * 一律视为插件名候选替换：声明行里其余字符串都是 persona/提示词类文案，约定
 * 不会以 './' 开头，误替换面为零。
 */
function absolutizeLocalPluginNames(rows, presetDir) {
  const walk = (node) => {
    if (typeof node === 'string') {
      return node.startsWith('./') ? pathToFileURL(path.join(presetDir, node.slice(2))).href : node
    }
    if (Array.isArray(node)) return node.map(walk)
    if (node !== null && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]))
    }
    return node
  }
  return walk(rows)
}

/**
 * 从解析后的 v2 声明行里剥离 tool-subagent-list-agents 行（issue #7）：
 * 0.2.2-alpha.2 起该子路径导出已删除，行保留会让模块解析失败 → 行 never
 * started → 注册表审计把整张主编 preset 判 broken、从选择器消失。list_agents
 * 工具本身由 control 主导出的 apply 末尾自动注册，剥离后能力无损。
 *
 * 匹配按插件名（name === '@deepseek-ai/dsh-tool-subagent-control/list-agents'）
 * 而非行 id——id 是书写约定，name 才是宿主解析模块的键。保守递归下钻整棵
 * 结构（对象/数组逐层走），任何深度的行都剥；原地修改并回传同一数组。
 * @param {Array<object>} rows - parsePresetRows 产物（insert 列表元素数组）
 * @returns {Array<object>} 同一 rows（已剥离）
 */
function stripMergedSubagentListAgents(rows) {
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        const item = node[i]
        if (item !== null && typeof item === 'object' && !Array.isArray(item) && item.name === SUBAGENT_LIST_AGENTS_ROW_NAME) {
          node.splice(i, 1)
          continue
        }
        walk(item)
      }
      return
    }
    if (node !== null && typeof node === 'object') {
      for (const v of Object.values(node)) walk(v)
    }
  }
  walk(rows)
  return rows
}

export function composeManagedRows(home, logger = console) {
  const hostVersion = readHostVersion(home)
  const useV2 = hostVersion !== null && hostRejectsInlineDelegation(hostVersion)
  const shape = useV2 ? 'v2' : 'v1'
  // 版本完全未知（五级探针全败）时保持「不声明」而不是「声明成 v1 内联」：
  // 若真实宿主 ≥ 0.2.1-rc.2，v1 内联声明行会被 dsh-tool-subagent 整批拒绝，
  // 五路委派全废且探测成功前无法自愈。走既有的 partial 分支（预设文件照落、
  // warn 留痕、下次宿主启动自动补写），与 yaml-unavailable 同一自愈语义。
  // 确知宿主 < 0.2.1-rc.2 时 v1 内联仍照写（下方原路径不变）。
  if (hostVersion === null) {
    return { shape, rows: null, hostVersion, yaml: null, reason: 'version-unknown', presetName: null }
  }
  const yaml = loadYamlLib(home)
  if (!yaml) return { shape, rows: null, hostVersion, yaml: null, reason: 'yaml-unavailable', presetName: null }
  try {
    const installedDir = path.join(home, '.agent-presets', PRESET_ID)
    if (useV2) {
      const text = readFileSync(path.join(PLUGIN_ROOT, 'presets', PRESET_ID, AGENT_CORDIS_V2_FILE), 'utf8')
      let rows = parsePresetRows(yaml, text)
      // ≥ 0.2.2-alpha.2：list-agents 子路径导出已并入 control 主导出（issue #7），
      // 剥离前再 absolutize——剥离只删行，不影响 './' 名的替换。
      if (hostMergedSubagentListAgents(hostVersion)) rows = stripMergedSubagentListAgents(rows)
      return {
        shape,
        rows: absolutizeLocalPluginNames(rows, installedDir),
        hostVersion,
        yaml,
        reason: null,
        presetName: readPresetName(yaml),
      }
    }
    const sourceDir = path.join(PLUGIN_ROOT, 'presets', PRESET_ID)
    const meta = parsePresetMeta(yaml, readFileSync(path.join(sourceDir, 'preset.yml'), 'utf8'))
    const plugins = parseAgentPlugins(yaml, readFileSync(path.join(sourceDir, 'agent.cordis.yml'), 'utf8'))
    // rows 统一为 insert 列表（stringifyManagedBlock 据此渲染同一 - insert: 结构；
    // 与 v1 历史产物逐字节同形，老 home 升级零抖动）
    return {
      shape,
      rows: absolutizeLocalPluginNames(buildPresetRow({ meta, plugins }).insert, installedDir),
      hostVersion,
      yaml,
      reason: null,
      presetName: meta.name,
    }
  } catch (err) {
    logger.warn?.(`xiaoyu-novel-installer: 组合源解析失败（${shape} 形态，已跳过声明行）: ${err?.message ?? err}`)
    return { shape, rows: null, hostVersion, yaml, reason: 'compose-failed', presetName: null }
  }
}

/**
 * 序列化声明行为托管块正文（不含起止标记）。参数 rows 是 insert 列表
 * （v1 一行 / v2 六行），统一渲染为同一 `- insert:` 列表结构；yaml 可用走
 * YAML 块形态，yaml 不可用回退为整段 JSON 单行（YAML 1.2 是 JSON 超集，
 * 宿主解析无感）。
 */
export function stringifyManagedBlock(yaml, rows) {
  const doc = [{ insert: Array.isArray(rows) ? rows : [rows] }]
  if (yaml) {
    // lineWidth: 0 关掉自动折行——plain 标量折行虽合法但产物不可读、diff 噪音大
    return `${MANAGED_BEGIN}\n${yaml.stringify(doc, { lineWidth: 0 }).replace(/\n+$/, '')}\n${MANAGED_END}`
  }
  // JSON 回退分支生产不可达（宿主 <home>/node_modules 必带 yaml 包，loadYamlLib
  // 读不到时 composeManagedRows 已提前返回 null rows）——仅测试直传 yaml=null
  // 可达（test/installer-shape.test.mjs 验证 JSON 形态同为合法 YAML）。
  return `${MANAGED_BEGIN}\n${JSON.stringify(doc)}\n${MANAGED_END}`
}

// ── patch 托管块手术：写入层选择 + 块 upsert + 块删除 ────────────────────────

/**
 * 托管块写入层的环境变量覆盖名：插件包名 dsh-xiaoyu-novel 转大写、`-` 换 `_`，再加
 * 后缀 `_PATCH_LAYER`。从包名现算而非手写死串，杜绝拼写漂移。合法值
 * 'home' | 'profile'，非法值 warn 后按启发式走（见 resolvePatchLayer）。
 */
export const PATCH_LAYER_ENV = `${'dsh-xiaoyu-novel'.toUpperCase().replaceAll('-', '_')}_PATCH_LAYER`

/**
 * 选托管块写入层：返回 'home'（<home>/cordis.patch.yml）或 'profile'
 * （<home>/profiles/<name>/cordis.patch.yml）。
 *
 * 环境变量覆盖优先：PATCH_LAYER_ENV 合法值 'home'/'profile'（大小写与首尾
 * 空白宽容）直接生效；非法值 warn 一次、按启发式走（显式点名写错了不该静默
 * 吞掉，也不该炸主流程）。
 *
 * 启发式（Android compat 壳检测，issue #1）：壳每次启动都会把 home 层 patch
 * 重写坏——把 preset 的 name/description 拍平成缩进错误的声明行（形如
 * `- id: 小鱼创作 (Xiaoyu)` 后跟 8 空格缩进的 name:），宿主
 * loadOptionalPatches 解析 fatal。命中 platform === 'android'、home 路径含
 * `com.deepseek.harness.compat`、或含 `/payload/` 路径段任一条件即判为该壳
 * 环境 → 'profile'（壳不碰 profile 层的托管块，宿主对两层 patch 都挂 HMR，
 * profile 层是合法写入目标）；其余环境 → 'home'。home/env/platform 均可
 * 注入（纯函数，测试缝）。
 */
export function resolvePatchLayer(home, env = process.env, { platform = process.platform, logger = console } = {}) {
  const heuristic =
    platform === 'android' ||
    String(home).includes('com.deepseek.harness.compat') ||
    String(home).split(/[\\/]+/).includes('payload')
      ? 'profile'
      : 'home'
  const raw = typeof env?.[PATCH_LAYER_ENV] === 'string' ? env[PATCH_LAYER_ENV].trim().toLowerCase() : ''
  if (raw === 'home' || raw === 'profile') return raw
  if (raw !== '') {
    logger.warn?.(
      `xiaoyu-novel-installer: 环境变量 ${PATCH_LAYER_ENV}=${env[PATCH_LAYER_ENV]} 非法（合法值 home/profile），按环境启发式处理 → ${heuristic} 层`,
    )
  }
  return heuristic
}

/**
 * 解析 profile 层 patch 文件路径：从 argv 找 `--profile <name>`（兼容
 * `--profile=<name>`，首个命中为准；参数在但值缺失视同没传），没有该参数兜底
 * 'web'。目标目录 <home>/profiles/<name>/ 存在才返回绝对路径——该层由宿主建
 * 好后插件才写，绝不越权替宿主 mkdir 整条 profiles 链；不存在返回 null，由
 * 调用方退回 home 层并 warn。argv 可注入（纯函数，测试缝）。
 */
export function resolveProfilePatchPath(home, argv = process.argv) {
  let name = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--profile') {
      const next = argv[i + 1]
      name = typeof next === 'string' && next !== '' ? next : null
      break
    }
    if (typeof arg === 'string' && arg.startsWith('--profile=')) {
      name = arg.slice('--profile='.length)
      break
    }
  }
  if (name === null || name === '') name = 'web'
  const dir = path.join(home, 'profiles', name)
  return existsSync(dir) ? path.join(dir, 'cordis.patch.yml') : null
}

/**
 * 在行数组里定位托管块 [begin, end]（闭区间下标）。无起始标记返回 null；
 * 有起始无结束（托管块损坏，多半是手工删了半截）throw——拒绝写盘，绝不覆盖
 * 手工内容。只认首对：首对之后若再出现起始标记（用户误复制了一份托管块），
 * warn 提醒手工清理，多余的块按普通用户内容原样保留、绝不动它。
 */
export function findManagedSpan(lines, { logger = console } = {}) {
  const begin = lines.findIndex((l) => l.trim() === MANAGED_BEGIN)
  if (begin === -1) return null
  for (let i = begin + 1; i < lines.length; i++) {
    if (lines[i].trim() === MANAGED_END) {
      if (lines.slice(i + 1).some((l) => l.trim() === MANAGED_BEGIN)) {
        logger.warn?.(
          'xiaoyu-novel-installer: cordis.patch.yml 里检测到第二处 dsh-xiaoyu-novel 托管块起始标记——' +
            '疑似误复制；本安装器只维护第一对，多余的块请手工删除',
        )
      }
      return { begin, end: i }
    }
  }
  throw new Error(
    `cordis.patch.yml 的 dsh-xiaoyu-novel 托管块已损坏（只有起始标记、找不到结束标记 "${MANAGED_END}"）：` +
      '请手工补回结束标记，或把整个托管块删除后重试；已拒绝写盘以免覆盖手工内容',
  )
}

/**
 * 把托管块文本 upsert 进指定 patch 文件。目标文件：opts.patchPath（profile
 * 层等自定义目标）优先，未传维持 home 层 <home>/cordis.patch.yml 默认。返回
 * 动作：
 *   'skipped'  — 托管块已在且内容与版本标记都一致，零写盘；
 *   'updated'  — 整块替换（块外用户内容一字节不动）；
 *   'created'  — 原无托管块，文末追加（home 层默认路径的文件不存在则连头注释
 *                一起新建；自定义 patchPath 的新文件不写头注释）；
 *   'rejected' — 写前 YAML 自检未过：整笔不写盘，warn 带文件路径与解析错误
 *                （块外多半有宿主都解不了的结构性坏行，交手工清理）。
 *
 * opts.yaml（可选）：传入时把拼装完的最终文件内容整体 yaml.parse 回验一遍
 *（!!js 表达式先经 preprocessPatchText 中和——宿主解析前做同样预处理，别把
 * 手工 `!!js` 条目误判成坏内容）。issue #1 场景里壳写坏的行混在托管块之外，
 * 盲写救不了宿主 fatal，自检失败就整笔不写、留 warn 自愈线索。未传（旧调用
 * 方/直测）维持原行为、不自检。
 *
 * opts.presetName（可选，预设显示名）：坏块检测——托管块之外若有行长成
 * `- id: <presetName>`（显示名被当 id，正是壳拍平 preset.yml 的坏块形状），
 * warn 提示手工清理；只警告不删——那是块外「用户内容」，安装器绝不动它。
 *
 * 并发与原子性考量（不变，宿主级共享文件，CLI 与桌面可能双开）：写盘走「同
 * 目录临时文件 + renameSync 原子替换」（临时件随 patchPath 落其所在目录，带
 * pid 命名，多进程各写各的互不踩踏），不做整文件截断覆写——rename 在同一文
 * 件系统内要么整体成功要么不动，任何时刻盘上只有完整的旧内容或完整的新内容，
 * 进程中途崩溃也绝不会留下半截 YAML。跨进程仍是「各自基于快照整文件替换」
 * 的后写者赢语义（零依赖设计不引文件锁）；配合写前重读对比，把「内容并无
 * 变化」的二跑收敛为零写盘，交错写的实际危害只剩同刻并发更新的丢失，不会
 * 产生损坏文件。
 */
export function upsertManagedBlock(dshHome, blockText, { versionMarkerCurrent, logger = console, patchPath, yaml, presetName } = {}) {
  const custom = typeof patchPath === 'string' && patchPath !== ''
  const target = custom ? patchPath : path.join(dshHome, 'cordis.patch.yml')
  const targetDir = path.dirname(target)
  let text = null
  try {
    text = readFileSync(target, 'utf8')
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err
  }
  const eol = text !== null && text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text !== null ? text.split(/\r?\n/) : custom ? [] : [HOME_PATCH_HEADER, '']
  const incoming = blockText.replace(/\r?\n/g, '\n')

  const span = findManagedSpan(lines, { logger }) // 损坏块 throw，直接中止（未写任何盘）
  if (span !== null) {
    const existing = lines.slice(span.begin, span.end + 1).join('\n')
    if (versionMarkerCurrent && existing === incoming) return 'skipped'
    lines.splice(span.begin, span.end - span.begin + 1, ...incoming.split('\n'))
  } else {
    // 文末追加。非空文件先补尾换行（若缺）——split 出的末尾 '' 元素正好兼任
    // 块前空行分隔；刚补的 '' 同理。空文件（text === null）时 home 层默认路径
    // 前面已有头注释，自定义路径直接以托管块开头。
    if (text !== null && text.trim() !== '' && lines[lines.length - 1].trim() !== '') lines.push('')
    lines.push(...incoming.split('\n'), '')
  }
  // 坏块检测（只 warn 不动）：托管块之外若有人把预设显示名写成了 id（壳拍平
  // preset.yml 的典型坏块形状，issue #1），提示手工清理——这些行宿主解不了，
  // 但它们是块外「用户内容」，安装器绝不替用户删。
  if (typeof presetName === 'string' && presetName !== '') {
    const escaped = presetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const badLine = new RegExp(`^\\s*-\\s*id:\\s*${escaped}\\s*(#.*)?$`)
    const outside = span !== null ? [...lines.slice(0, span.begin), ...lines.slice(span.end + 1)] : lines
    const badCount = outside.filter((line) => badLine.test(line)).length
    if (badCount > 0) {
      logger.warn?.(
        `xiaoyu-novel-installer: ${target} 托管块之外检测到 ${badCount} 处「- id: ${presetName}」形状的坏行` +
          '（预设显示名被当作 id，常见于 Android compat 壳重写 home patch 时拍平 preset 元数据）——' +
          '这些行宿主无法解析，请手工删除（安装器不替你动块外内容）',
      )
    }
  }
  const content = lines.join(eol)
  // 写前 YAML 自检（传了 yaml 才做）：最终文件整体回验，坏内容一笔不写。
  try {
    if (yaml) yaml.parse(preprocessPatchText(content))
  } catch (err) {
    logger.warn?.(
      `xiaoyu-novel-installer: ${target} 拼装结果未过 YAML 自检，已拒绝写盘` +
        `（托管块之外多半有宿主也解不了的结构性坏行，请手工清理后重启自愈；本块内容已在上方逐字保留）: ${err?.message ?? err}`,
    )
    return 'rejected'
  }
  // 写前重读对比（幂等强化）：首次读到真正写盘之间文件可能已被并发进程改成
  // 与目标一致的内容——已一致就不再写盘，省一次 mtime 抖动、也收窄交错写窗口。
  try {
    if (readFileSync(target, 'utf8') === content) return 'skipped'
  } catch { /* 重读失败（文件被并发删/权限抖动）按首次写处理 */ }
  // 原子落盘：临时文件带 pid 命名，多进程各写各的临时件互不踩踏。
  mkdirSync(targetDir, { recursive: true })
  const tmpPath = path.join(targetDir, `.cordis.patch.yml.tmp-${process.pid}`)
  writeFileSync(tmpPath, content, 'utf8')
  try {
    renameSync(tmpPath, target)
  } catch (err) {
    // rename 失败（极端：目标被锁/跨设备等）清掉自己的临时件后原样抛出，
    // 由调用方 warn 兜底——绝不让安装器炸宿主。
    try { unlinkSync(tmpPath) } catch { /* 临时件清理失败无所谓，pid 命名不互踩 */ }
    throw err
  }
  return span !== null ? 'updated' : 'created'
}

/**
 * 删除 home 层 <home>/cordis.patch.yml 里的本插件托管块（含起止标记），块外
 * 用户内容一字节不动；写回沿用「同目录临时件 + renameSync 原子替换」纪律
 *（临时件带 pid 命名，与 upsertManagedBlock 同款）。返回动作：
 *   'removed' — 找到并已整段删除；
 *   'absent'  — 文件不存在 / 无托管块 / 文件读不了（warn 留痕后按无需清理
 *               处理）——都是 no-op；
 *   'damaged' — 托管块损坏（只有起始标记、找不到结束标记）：warn、原文件
 *               一字节不动、不炸主流程（升级清理是尽力而为，坏块留给人工，
 *               或交给既有写路径的损坏即中止语义）。
 * 用途：写入层切到 profile 层时清掉 home 层遗留托管块，防 home+profile 双
 * 声明（issue #1 的升级路径）。rename 失败原样抛出，由调用方兜 try/catch。
 */
export function removeManagedBlockFromHome(home, { logger = console } = {}) {
  const patchPath = path.join(home, 'cordis.patch.yml')
  let text = null
  try {
    text = readFileSync(patchPath, 'utf8')
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      logger.warn?.(`xiaoyu-novel-installer: 读取 ${patchPath} 失败，跳过 home 层托管块清理: ${err?.message ?? err}`)
    }
    return 'absent'
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  let span = null
  try {
    span = findManagedSpan(lines, { logger })
  } catch (err) {
    logger.warn?.(`xiaoyu-novel-installer: home 层托管块损坏，跳过清理（文件保持原样）: ${err?.message ?? err}`)
    return 'damaged'
  }
  if (span === null) return 'absent'
  lines.splice(span.begin, span.end - span.begin + 1)
  const content = lines.join(eol)
  const tmpPath = path.join(path.dirname(patchPath), `.cordis.patch.yml.tmp-${process.pid}`)
  writeFileSync(tmpPath, content, 'utf8')
  try {
    renameSync(tmpPath, patchPath)
  } catch (err) {
    // rename 失败清掉自己的临时件后原样抛出——调用方（ensurePresetInstalled
    // 第 4 步）兜 try/catch，绝不让清理动作炸宿主启动。
    try { unlinkSync(tmpPath) } catch { /* 临时件清理失败无所谓，pid 命名不互踩 */ }
    throw err
  }
  return 'removed'
}

/**
 * 清扫托管块临时件残留：upsertManagedBlock / removeManagedBlockFromHome 在
 * writeFileSync 与 renameSync 之间崩溃（kill -9 / 断电）时，
 * `.cordis.patch.yml.tmp-<pid>` 会永远留在目标目录。仅在插件启动（apply 早期）
 * 顺带跑一次，纪律：
 *   - 只认本插件的临时件命名（`.cordis.patch.yml.tmp-` 前缀 + 纯数字 pid 后缀，
 *     与 upsertManagedBlock 的命名一字不差），其余文件一概不碰；
 *   - mtime 超过 1 小时才删——正常写盘从建临时件到 rename 是毫秒级，1h 窗口
 *     绝不误杀并发进程正在写的临时件；
 *   - 只扫 home 根：profile 层等自定义 patchPath 的临时件落各自目录（宿主管
 *     理的目录不顺手扩面），崩溃残留概率极低且是纯注释性垃圾文件，无害；
 *   - 全程自吞错（目录读不到 / 单个 stat/unlink 失败都跳过）：清扫是顺手卫生，
 *     绝不能影响宿主启动，也不为它打日志刷屏。
 * @returns {number} 本次删除的残留临时件个数（测试与观察用）
 */
export function sweepStaleManagedBlockTmp(dshHome, { now = Date.now(), maxAgeMs = 3_600_000 } = {}) {
  let names
  try {
    names = readdirSync(dshHome)
  } catch {
    return 0 // home 不存在/读不到：无事可扫
  }
  let removed = 0
  for (const name of names) {
    if (!/^\.cordis\.patch\.yml\.tmp-\d+$/.test(name)) continue
    try {
      if (now - statSync(path.join(dshHome, name)).mtimeMs <= maxAgeMs) continue
      unlinkSync(path.join(dshHome, name))
      removed += 1
    } catch {
      /* 单个探测/删除失败跳过——下个启动周期再试 */
    }
  }
  return removed
}

// ── 方法论技能落盘 ──────────────────────────────────────────────────────────

/** 技能源目录（包内 skills/）。 */
const SKILLS_SOURCE_DIR = path.join(PLUGIN_ROOT, 'skills')

/** 只搬 xiaoyu-* 前缀的技能目录——<home>/skills 里用户自己的技能绝不触碰。 */
const SKILL_DIR_PREFIXES = ['xiaoyu-', 'xiaoyu-']

/**
 * 递归收集目录下全部文件的相对路径（POSIX 分隔）。目录打不开/不存在返回
 * null——与「空目录返回 []」严格区分：源目录读失败时调用方必须跳过版本标记
 * （否则标记谎报，下次启动误判无需重装）；子目录读失败整棵按失败算。
 * @returns {string[]|null} 相对路径列表；读取失败返回 null
 */
function listSkillFiles(dir, relBase = '') {
  const files = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = relBase === '' ? entry.name : `${relBase}/${entry.name}`
    if (entry.isDirectory()) {
      const sub = listSkillFiles(path.join(dir, entry.name), rel)
      if (sub === null) return null
      files.push(...sub)
    } else if (entry.isFile()) files.push(rel)
  }
  return files
}

/**
 * 把包内 skills/ 的 xiaoyu-* 技能目录复制到 <home>/skills/<name>/：
 *   - 文件逐字节比较（Buffer.equals），内容一致不写（保住 mtime，二跑零写盘）；
 *   - 每个技能目录落 .installed-version 标记（语义同预设标记：一致不重写）；
 *   - <home>/skills 不存在则递归创建；非 xiaoyu-* 前缀的目录一概不看。
 * 返回本次有复制动作的技能目录名列表。单个技能失败只 warn 不拖累其余。
 */
export function installSkills(dshHome, { version, logger = console } = {}) {
  const copied = []
  let entries
  try {
    entries = readdirSync(SKILLS_SOURCE_DIR, { withFileTypes: true })
  } catch (err) {
    logger.warn?.(`xiaoyu-novel-installer: 读取包内技能目录 ${SKILLS_SOURCE_DIR} 失败（已跳过技能落盘）: ${err?.message ?? err}`)
    return copied
  }
  const skillsHome = path.join(dshHome, 'skills')
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !SKILL_DIR_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) continue
    const srcDir = path.join(SKILLS_SOURCE_DIR, entry.name)
    const dstDir = path.join(skillsHome, entry.name)
    let touched = false
    try {
      const files = listSkillFiles(srcDir)
      if (files === null) {
        // 源目录读失败：这次连「已装」的版本标记都不能写——标记谎报会让下次
        // 启动误判无需重装。throw 进下面的 per-skill catch，warn 留痕待自愈。
        throw new Error('包内技能源目录不可读')
      }
      for (const rel of files) {
        if (syncFileIfChanged(path.join(srcDir, rel), path.join(dstDir, rel))) touched = true
      }
      try {
        writeMarkerIfChanged(dstDir, version)
      } catch (err) {
        logger.warn?.(`xiaoyu-novel-installer: 技能 ${entry.name} 的 .installed-version 标记写入失败（不影响技能本体）: ${err?.message ?? err}`)
      }
    } catch (err) {
      logger.warn?.(`xiaoyu-novel-installer: 技能 ${entry.name} 落盘失败（已跳过，不影响其他技能与预设）: ${err?.message ?? err}`)
    }
    if (touched) copied.push(entry.name)
  }
  return copied
}

// ── 创作台面板：/api/xiaoyu-novel/* 路由（三期）─────────────────────────────────
//
// 要点：
//   · 宿主路由自带信任围栏只挂在 /api 网关上；/api/xiaoyu-novel 前缀更长，
//     webserver 最长前缀优先会命中本插件而绕过网关围栏，故在此复刻同一
//     围栏语义（Host 回环或 webRuntime.trustedHosts + 拒 cross-site +
//     origin 同源校验）。
//   · 所有响应 JSON；错误形状统一 { ok: false, error }（读路由按契约可省
//     ok），状态码 403/404/409/413/422/500 语义见 docs/creator-panel.md §2。
//   · 业务读写全部在 lib/panel-core.mjs，这里只做围栏与分发。

function header(headers, name) {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

function parseAuthority(authority) {
  try { return new URL(`http://${authority}`) } catch { return undefined }
}

/** 回环地址判定：localhost、[::1] 与 127.0.0.0/8 全段。 */
function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127'
    && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}

/** Host 头是否落在部署信任列表（精确 host:port，或裸 hostname 放行全端口）。 */
function isTrustedAuthority(hostUrl, trustedHosts) {
  return (trustedHosts ?? []).some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return entryUrl.port === ''
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/**
 * 信任围栏：Host 必须回环或在部署信任表里（防 DNS-rebinding），再拒绝
 * cross-site 浏览器请求；带了 origin 头的还须与 Host 同源。无认证部署的
 * 唯一一道门，任何一步拿不准都按不受信处理。
 */
function isTrustedApiRequest(req, trustedHosts) {
  const host = header(req.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  if (header(req.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(req.headers, 'origin')
  if (origin === undefined) return true
  // origin 与 Host 做 scheme+host+port 全串比较（URL.origin 对 URL.origin）：
  // 只比 hostname 会放过「同站不同端口」的页面——sec-fetch-site 对它是
  // same-site 而非 cross-site，http://localhost:9999 打本面板端口必须挡下。
  // 威胁模型边界：这道门防外网页面借浏览器发跨源请求（CSRF/DNS-rebinding），
  // 不防本机其他进程/内核——本机攻击面由「只听回环 + 部署信任表」约束。
  try { return new URL(origin).origin === hostUrl.origin } catch { return false }
}

/** JSON 读体限额：5MB，对面板单章正文/设定批量写入量级余量充足。 */
const BODY_LIMIT_BYTES = 5 * 1024 * 1024

/** 读体 idle 超时：连续 30s 无任何数据到达即放弃（防挂起连接占住 handler）。 */
const BODY_IDLE_MS = 30_000

/**
 * 读 JSON 请求体（限额 5MB + 30s idle 超时）。约定：
 *   - 超限 413 / idle 超时 408：本函数先向 res 回 JSON、再销毁连接（顺序反了
 *     客户端只能收到 ECONNRESET，拿不到明确状态码），并 reject 带 responded
 *     标记的错误——外层 catch 看到 responded 不再重复回包；
 *   - 非法 JSON 400、客户端提前断开（close/aborted/流错误）499/400——错误都
 *     带 statusCode，外层 catch 据此回状态码，绝不落到 500；
 *   - 响应已发出的场景 Promise 已结算，后续 reject 是无害 no-op。
 */
function readBody(req, res) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let done = false

    const rejectWith = (statusCode, message) => {
      if (done) return
      done = true
      clearTimeout(idleTimer)
      const err = new Error(message)
      err.statusCode = statusCode
      reject(err)
    }

    // 先响应后断开（413/408 专用）：响应写完再 destroy，客户端拿得到 JSON。
    const respondThenClose = (statusCode, message) => {
      if (done) return
      done = true
      clearTimeout(idleTimer)
      json(res, statusCode, { ok: false, error: message })
      req.destroy()
      const err = new Error(message)
      err.statusCode = statusCode
      err.responded = true
      reject(err)
    }

    // idle 超时：每收到一段数据重置一次；超时按 408 语义先回包再断开。
    const idleTimer = setTimeout(() => respondThenClose(408, 'request body idle timeout (30s no data)'), BODY_IDLE_MS)

    req.on('data', (c) => {
      idleTimer.refresh?.()
      size += c.length
      if (size > BODY_LIMIT_BYTES) {
        respondThenClose(413, `request body too large (limit ${BODY_LIMIT_BYTES} bytes)`)
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (done) return
      clearTimeout(idleTimer)
      try {
        // done 置真必须在解析成功之后：先置真再走 catch，rejectWith 的 done
        // 守卫会把 400 拒绝吞掉——promise 永不结算，handler 挂死（坏 JSON 必挂）。
        const parsed = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
        done = true
        resolve(parsed)
      } catch {
        rejectWith(400, 'invalid JSON body')
      }
    })
    req.on('error', (err) => {
      // 流级错误（连接重置等）：无码按 400 语义兜底，不落 500
      if (done) return
      done = true
      clearTimeout(idleTimer)
      if (!Number.isInteger(err?.statusCode)) err.statusCode = 400
      reject(err)
    })
    req.on('close', () => rejectWith(499, 'request closed before body completed'))
    req.on('aborted', () => rejectWith(499, 'request aborted'))
  })
}

function json(res, status, payload) {
  // 无缩进序列化：状态快照等响应可到百 KB 量级，缩进纯增体积（客户端自行格式化）
  const text = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

// 错误原文（可能带本机绝对路径）只进日志；回给浏览器的 message 先把插件
// 安装根与目录锚点替换成 ~ 再说。
const SANITIZE_HOME_DIR = path.resolve(os.homedir())
const SANITIZE_PLUGIN_ROOT = PLUGIN_ROOT.replace(/[\\/]+$/, '')

/** 私有库版本检测缓存（1 小时；fresh=1 强制现测）——外网抖动不该让面板反复等。 */
const GITHUB_VERSION_TTL_MS = 60 * 60 * 1000
let githubVersionCache = { at: 0, info: null }

/**
 * 私有库版本检测：仓库来源 = package.json 的 dsh.githubRepo / repository.url，
 * 认不出再看环境变量 XIAOYU_GITHUB_REPO。命中 releases/latest（没发 release 时
 * 退 tags 取最高），与本地 package.json 版本比较。任何失败都收敛成带 error 的
 * 结果对象，不抛错（面板按「失败即静默 + 报一句」处理）。
 */
async function checkGithubVersion({ pkg, force = false, timeoutMs = 8000 } = {}) {
  const repo = resolveGithubRepo(pkg, process.env)
  if (repo === '') return null
  const now = Date.now()
  if (!force && githubVersionCache.info && now - githubVersionCache.at < GITHUB_VERSION_TTL_MS) return { ...githubVersionCache.info }
  const { version: current, source: currentSource } = await currentVersion()
  const hit = await fetchLatestGithubVersion({ repo, token: resolveGithubToken(process.env).token, timeoutMs, pinnedRepo: repo })
  let info
  if (hit.ok) {
    info = {
      current, latest: hit.tag, repo, source: hit.source,
      // 凭据年龄（0.22.0）：面板据此在快过期时劝一次，别等到更新失败才发现。
      tokenAge: tokenAgeDays(EMBEDDED_TOKEN_ISSUED_AT),
      tokenRefreshDays: TOKEN_REFRESH_DAYS,
      updateAvailable: currentSource === 'fallback' ? false : compareVersions(current, hit.tag) < 0,
      releaseUrl: hit.releaseUrl, checkedAt: new Date().toISOString(), error: null,
    }
    githubVersionCache = { at: now, info }
  } else {
    info = { current, latest: null, repo, source: null, updateAvailable: false, releaseUrl: 'https://github.com/' + repo + '/releases', checkedAt: new Date().toISOString(), error: hit.error }
  }
  return info
}
// DSH_HOME 可指向家目录外（如 /opt/dsh）——它的绝对路径与家目录同级敏感，
// 同样不出门，进替换表。等于文件系统根时置 null 跳过（split('/') 会毁掉
// 整条文本，宁可不脱敏也不能把响应毁成乱码）。
const SANITIZE_DSH_HOME = (() => {
  const resolved = path.resolve(resolveDshHome())
  return resolved === path.sep ? null : resolved.replace(/[\\/]+$/, '')
})()

function sanitizeMessage(message) {
  let text = String(message ?? '')
  // 先长后短：安装根通常是 home/DSH_HOME 的子路径，先替换更具体的
  text = text.split(SANITIZE_PLUGIN_ROOT).join('~')
  text = text.split(SANITIZE_HOME_DIR).join('~')
  if (SANITIZE_DSH_HOME !== null) text = text.split(SANITIZE_DSH_HOME).join('~')
  return text
}

/**
 * 递归脱敏：结构里所有字符串值过一遍 sanitize（默认模块级 sanitizeMessage，
 * 可传路由层的 sanitizeWithRoots 把已注册工作区根并入替换表）。host-debug
 * 响应用——trace.via / runtime.argv / execPath / cwd 等带本机绝对路径的字段，
 * 与错误 message 同一纪律：诊断信息照给，本机路径不出门。
 */
function sanitizeDeep(value, sanitize = sanitizeMessage) {
  if (typeof value === 'string') return sanitize(value)
  if (Array.isArray(value)) return value.map((v) => sanitizeDeep(v, sanitize))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeDeep(v, sanitize)]))
  }
  return value
}

// 宿主热切换竞态兜底：「禁用→启用」等操作会重建插件条目纤维，新 apply 先
// 跑、旧实例的路由注销异步落地，注册瞬间旧路由常仍在表里，webServer.register
// 对同 (kind, path) 抛 duplicate。只对 duplicate prefix route 这一种错误短
// 重试等旧注销落地；其余错误原样抛出，真组合冲突不掩盖。
const DUPLICATE_PREFIX_ROUTE_RE = /^webserver: duplicate prefix route "/

/** 带兜底重试的路由注册：仅对 duplicate prefix route 错误重试，其余立即抛出。 */
export async function registerPrefixRouteWithRetry(webServer, route, { attempts = 8, delayMs = 30 } = {}) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      // 必须 await：宿主 register 可能返回 rejected promise（异步校验路径），
      // 不 await 则 rejection 接不住（unhandled rejection），duplicate 短重试
      // 形同虚设；await 对同步抛出的路径行为不变，兼容保留。
      return await webServer.register(route)
    } catch (err) {
      if (!DUPLICATE_PREFIX_ROUTE_RE.test(String(err?.message ?? ''))) throw err
      lastError = err
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw lastError
}

/**
 * 注册创作台全部路由（docs/creator-panel.md §2 的 23 条）。返回宿主 disposer
 *（由 apply 挂接 ctx.effect——纤维销毁时注销路由，防 HMR 热重载后残留死
 * handler）；webServer 缺席（非 web 部署）时抛错，由 apply 侧统一降级为 warn。
 */
// ── 门禁跑分：章节正文 → lib/gate-core.mjs（纯 JS，零依赖）──────────────
// 面板「门禁分」与「去 AI 味」按钮的数据源。只读：把章节 body 交给与
// skills/xiaoyu-qu-ai-wei/scripts/aiwei_scan.py 同指标同权重的 JS 实现，
// 不 spawn 解释器——任何设备（哪怕没装 python3）都能在面板里看到分数。
// 结果按「文件 + mtime + size」缓存，正文一改缓存自然失效。
/**
 * 给「重计算」类路由算指纹：章节目录 + 账本 + 章纲 + 角色卡目录。
 * 用目录 mtime 代表「增删了文件」，用子文件 mtime:size 代表「改了内容」——
 * 任一变化指纹就变，缓存自动失效；跨设备（Android/桌面/容器）都只是 stat，
 * 没有平台相关逻辑。
 */
function novelFingerprint(novelDir) {
  const dir = path.resolve(novelDir)
  const paths = [
    path.join(dir, 'project.yml'),
    path.join(dir, 'style.md'),
    path.join(dir, 'index.yml'),
    path.join(dir, 'volumes.yml'),
    path.join(dir, 'relations.yml'),
    path.join(dir, 'foreshadows.yml'),
    path.join(dir, 'timeline.yml'),
    path.join(dir, 'memories.yml'),
    path.join(dir, 'clue-board.yml'),
    path.join(dir, 'decisions.yml'),
  ]
  for (const sub of ['chapters', 'outlines', 'characters', 'world', 'science', 'research']) {
    const abs = path.join(dir, sub)
    paths.push(abs)
    try {
      for (const name of readdirSync(abs)) paths.push(path.join(abs, name))
    } catch { /* 目录不存在：只把目录本身编进指纹 */ }
  }
  // 一次刷新里 audit/check 会连着问，指纹按目录短 TTL 复用（写路径会显式清）。
  return fingerprintOfCached(dir, paths)
}

/**
 * 写盘后的统一失效：快照缓存 + 重计算结果缓存一起清。
 * 为什么不能只靠指纹：Android /sdcard 与部分容器文件系统的 mtime 只有秒级
 * 精度，同一秒内连写两次且大小不变时指纹不变，会读到上一版结果。写路径
 * 显式清一遍最稳（清空是 O(1)，代价可以忽略）。
 */
function invalidateAllCaches() {
  invalidateSnapshotCache()
  clearResultCache()
}

const GATE_CACHE_LIMIT = 300
const gateCache = new Map()

function stripChapterFrontmatter(text) {
  if (!text.startsWith('---')) return text
  const end = text.indexOf('\n---', 3)
  return end === -1 ? text : text.slice(end + 4)
}

// 门禁历史：每章最近 20 次的分数，落在 <home>/xiaoyu-gate-history.json。
// 面板用它显示「上次多少 → 这次多少」，看改写有没有真效果；只记变化点，
// 同一分数重复跑不刷记录。写盘失败只忽略——历史是附赠，不能拖垮门禁。
const GATE_HISTORY_FILE = 'xiaoyu-gate-history.json'
const GATE_HISTORY_PER_FILE = 20
let gateHistoryCache = null

function gateHistoryPath() {
  return path.join(resolveDshHome(), GATE_HISTORY_FILE)
}

function loadGateHistory() {
  if (gateHistoryCache !== null) return gateHistoryCache
  try { gateHistoryCache = JSON.parse(readFileSync(gateHistoryPath(), 'utf8')) } catch { gateHistoryCache = {} }
  if (gateHistoryCache === null || typeof gateHistoryCache !== 'object') gateHistoryCache = {}
  // 剪枝：工作区目录已不存在（测试临时目录、卸载的外置卡）或总数超过 50 的，
  // 按最近一次记录时间保留最新的——历史是附赠，不能无限长大。
  const entries = Object.entries(gateHistoryCache).filter(([ws]) => {
    try { return statSync(ws).isDirectory() } catch { return false }
  })
  if (entries.length !== Object.keys(gateHistoryCache).length || entries.length > 50) {
    entries.sort((a, b) => {
      const latest = (v) => {
        let max = 0
        for (const list of Object.values(v || {})) {
          for (const item of list || []) if (item && typeof item.t === 'number' && item.t > max) max = item.t
        }
        return max
      }
      return latest(b[1]) - latest(a[1])
    })
    gateHistoryCache = Object.fromEntries(entries.slice(0, 50))
  }
  return gateHistoryCache
}

function saveGateHistory() {
  try {
    const tmp = gateHistoryPath() + '.tmp'
    writeFileSync(tmp, JSON.stringify(gateHistoryCache ?? {}), 'utf8')
    renameSync(tmp, gateHistoryPath())
  } catch { /* 历史写不进去不影响门禁 */ }
}

const sha256 = (text) => createHash('sha256').update(String(text), 'utf8').digest('hex')

function recordGate(wsPath, file, result, body) {
  const all = loadGateHistory()
  const workspace = all[wsPath] || (all[wsPath] = {})
  const list = workspace[file] || (workspace[file] = [])
  const last = list[list.length - 1]
  if (last && last.h === result.human && last.d === result.detector) return
  const plain = String(body ?? '')
  list.push({
    h: result.human,
    d: result.detector,
    w: plain.replace(/\s/g, '').length,
    f: plain === '' ? '' : sha256(plain.slice(0, 40)).slice(0, 10),
    t: Date.now(),
  })
  if (list.length > GATE_HISTORY_PER_FILE) list.splice(0, list.length - GATE_HISTORY_PER_FILE)
  saveGateHistory()
}

async function gateForFile(novelDir, file, wsPath) {
  const raw = String(file ?? '')
  if (raw.includes('/') || raw.includes('\\') || raw.includes('..')) return { ok: false, reason: 'bad-file' }
  const safe = path.basename(raw)
  if (!/^[A-Za-z0-9._\-\u4e00-\u9fa5]+\.md$/.test(safe)) return { ok: false, reason: 'bad-file' }
  const full = path.join(novelDir, 'chapters', safe)
  let stat
  try { stat = statSync(full) } catch { return { ok: false, reason: 'missing' } }
  const key = full + ':' + stat.mtimeMs + ':' + stat.size
  const hit = gateCache.get(key)
  if (hit) return hit
  const body = stripChapterFrontmatter(readFileSync(full, 'utf8'))
  if (body.trim().length < 50) return { ok: false, reason: 'empty' }
  let result
  try {
    const analyzed = analyzeChapter(body)
    result = {
      ok: true,
      human: analyzed.score,
      detector: analyzed.detector?.score ?? null,
      words: analyzed.meta?.chars ?? 0,
      hard: analyzed.hard || [],
      hook: analyzed.hook ?? null,
      flags: Array.isArray(analyzed.flags) ? analyzed.flags.slice(0, 12) : [],
      heat: paragraphHeat(body),
    }
  } catch (error) {
    result = { ok: false, reason: 'analyze-failed', message: String(error?.message ?? error) }
  }
  gateCache.set(key, result)
  if (result.ok && typeof wsPath === 'string' && wsPath !== '') recordGate(wsPath, safe, result, body)
  if (gateCache.size > GATE_CACHE_LIMIT) {
    const oldest = gateCache.keys().next().value
    if (oldest !== undefined) gateCache.delete(oldest)
  }
  return result
}

// ── 门禁通过线 / 撤销快照 / 写作进度（0.4.0）──────────────────────────────

/** 项目级门禁配置文件名（novel/xiaoyu.json，纯插件私有，不动项目账本）。 */
const GATE_CONFIG_FILE = 'xiaoyu.json'
const DEFAULT_PASS_MARK = 78
const UNDO_KEEP = 10

function gateConfigPath(novelDir) { return path.join(novelDir, GATE_CONFIG_FILE) }

/** 读项目门禁线；缺失/坏文件/越界一律回落 78，绝不因配置坏掉而门禁失败。 */
export function readGateConfig(novelDir) {
  try {
    const raw = JSON.parse(readFileSync(gateConfigPath(novelDir), 'utf8'))
    const n = Number(raw?.gate?.passMark)
    if (Number.isInteger(n) && n >= 50 && n <= 100) return { passMark: n, exists: true }
  } catch { /* 缺失或坏 JSON：用默认线 */ }
  return { passMark: DEFAULT_PASS_MARK, exists: false }
}

/** 写项目门禁线（与既有 xiaoyu.json 合并，不覆盖别家键）。 */
function writeGateConfig(novelDir, patch) {
  let current = {}
  try { current = JSON.parse(readFileSync(gateConfigPath(novelDir), 'utf8')) || {} } catch { current = {} }
  const next = { ...current, gate: { ...(current.gate || {}), ...patch } }
  mkdirSync(novelDir, { recursive: true })
  const tmp = gateConfigPath(novelDir) + '.tmp'
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8')
  renameSync(tmp, gateConfigPath(novelDir))
  return readGateConfig(novelDir)
}

function undoDirOf(novelDir) { return path.join(novelDir, '.xiaoyu', 'undo') }

/** 写盘前留原文快照（每文件保留最近 10 份），自动修可撤销。 */
function backupChapter(novelDir, file, text) {
  const dir = undoDirOf(novelDir)
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = path.join(dir, file + '.' + stamp + '.bak')
  writeFileSync(target, text, 'utf8')
  try {
    const list = readdirSync(dir).filter((name) => name.startsWith(file + '.') && name.endsWith('.bak')).sort()
    for (const name of list.slice(0, Math.max(0, list.length - UNDO_KEEP))) {
      try { unlinkSync(path.join(dir, name)) } catch { /* 删旧失败不影响本次备份 */ }
    }
  } catch { /* 目录读失败：备份已写，剪枝跳过 */ }
  return target
}

/** 最近一份快照（无则 null）。 */
function latestUndo(novelDir, file) {
  try {
    const dir = undoDirOf(novelDir)
    const list = readdirSync(dir).filter((name) => name.startsWith(file + '.') && name.endsWith('.bak')).sort()
    if (list.length === 0) return null
    const target = path.join(dir, list[list.length - 1])
    return { text: readFileSync(target, 'utf8'), at: statSync(target).mtimeMs, name: list[list.length - 1] }
  } catch { return null }
}

// ── 写作进度（每日字数快照，按作品分开记账）───────────────────────────────

const PROGRESS_FILE = 'xiaoyu-progress.json'

function progressPath() { return path.join(resolveDshHome(), PROGRESS_FILE) }

function todayKey() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

function loadProgress() {
  try { return JSON.parse(readFileSync(progressPath(), 'utf8')) || {} } catch { return {} }
}

/** 记录当天总字数（同日取最大值：删章回退不抹掉今天已记的峰值）。 */
function recordProgress(novelDir, words) {
  const n = Number(words)
  if (!Number.isFinite(n) || n <= 0) return
  try {
    const all = loadProgress()
    const book = all[novelDir] || (all[novelDir] = {})
    const day = todayKey()
    book[day] = Math.max(Number(book[day]) || 0, Math.round(n))
    const keys = Object.keys(book).sort()
    for (const key of keys.slice(0, Math.max(0, keys.length - 120))) delete book[key]
    const home = resolveDshHome()
    mkdirSync(home, { recursive: true })
    const tmp = progressPath() + '.tmp'
    writeFileSync(tmp, JSON.stringify(all), 'utf8')
    renameSync(tmp, progressPath())
  } catch { /* 进度记账失败不影响门禁 */ }
}

export async function registerCreatorRoutes(ctx) {
  const webServer = ctx?.webServer
  if (!webServer || typeof webServer.register !== 'function') {
    throw new Error('webServer 服务不可用（非 web 部署），创作台路由无处注册')
  }
  // webRuntime 由宿主 web-runtime 行提供；非 web 部署缺失时退化为仅回环信任。
  // 每请求实时读，trustedHosts 变化无需重启插件；读取自捕——围栏检查不能以
  // unhandled rejection 收场，读不到按空信任表继续。
  const trustedHostsOf = () => {
    try { return ctx.get('webRuntime')?.trustedHosts ?? [] } catch { return [] }
  }
  // 纵深加固（本文件可达处）：模块级 sanitizeMessage 的替换表只认 homedir /
  // 插件根 / DSH_HOME；已注册工作区根是 ctx 级事实（registry 可枚举、运行时
  // 可增删），且 sanitizeMessage 定义在本文件而非不可改的 panel-core.mjs，
  // 故在路由层包一层把注册根并入替换表——工作区根落在家目录外时，host-debug
  // trace 与错误 message 里的绝对路径同样不出门。只包本前缀路由内的使用点；
  // registry 读不到按「无根可换」继续，脱敏层绝不炸请求（围栏内仅回环受信
  // 客户端可见，此层属纵深而非唯一防线）。
  const workspaceRoots = () => {
    try {
      return (ctx.workspaceRegistry?.list?.() ?? [])
        .map((entry) => (typeof entry?.path === 'string' && entry.path.trim() !== '' ? path.resolve(entry.path) : null))
        .filter((root) => root !== null && root !== path.sep)
        .sort((a, b) => b.length - a.length) // 先长后短：嵌套根先替换更具体的
    } catch {
      return []
    }
  }
  const sanitizeWithRoots = (message) => {
    let text = sanitizeMessage(message)
    for (const root of workspaceRoots()) text = text.split(root).join('~')
    return text
  }

  return registerPrefixRouteWithRetry(webServer, {
    kind: 'prefix',
    path: '/api/xiaoyu-novel',
    handler: async (req, res) => {
      if (!isTrustedApiRequest(req, trustedHostsOf())) {
        // 错误形状契约（本文件 §路由要点：「错误形状统一 { ok: false, error }」）：
        // 围栏 403 也带 ok:false，客户端形状检查不必对这一条网开一面。
        json(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      try {
        // url/route 解析进 try：畸形 requestTarget 不至于绕过错误通道裸崩
        const url = new URL(req.url, 'http://dsh.internal')
        const route = url.pathname.replace(/^\/api\/xiaoyu-novel\/?/, '')
        // ── 静态样式：面板 CSS 正文（lib/base.css）按请求现读下发 ──────────
        // 客户端只注入 <link href="/api/xiaoyu-novel/client.css">，正文现读——
        // 改样式无需重启，GUI 刷新即生效（no-cache）。同前缀、已被围栏把关。
        if (route === 'client.css' && req.method === 'GET') {
          try {
            const css = await readFile(new URL('./lib/base.css', import.meta.url), 'utf8')
            const acceptsGzip = String(req.headers['accept-encoding'] || '').includes('gzip')
            if (acceptsGzip) {
              const zipped = gzipSync(Buffer.from(css, 'utf8'))
              res.writeHead(200, {
                'content-type': 'text/css; charset=utf-8',
                'content-encoding': 'gzip',
                'content-length': zipped.length,
                'cache-control': 'no-cache',
              })
              res.end(zipped)
            } else {
              res.writeHead(200, {
                'content-type': 'text/css; charset=utf-8',
                'content-length': Buffer.byteLength(css),
                'cache-control': 'no-cache',
              })
              res.end(css)
            }
          } catch (err) {
            ctx.logger?.warn?.('xiaoyu-novel 创作台: client.css 读取失败: ' + String(err?.message ?? err))
            json(res, 500, { ok: false, error: sanitizeWithRoots(`client.css 不可用: ${err?.message ?? err}`) })
          }
          return
        }

        if (route === 'update-check' && req.method === 'GET') {
          // 版本源优先级（0.18.0）：配了 GitHub 仓库就只认它——私有库没有 npm
          // 通路，老逻辑跑两轮 registry 再报网络错，纯浪费时间。仓库来源见
          // lib/github-update.mjs 的 resolveGithubRepo（package.json → 环境变量）。
          let pkg = null
          try { pkg = JSON.parse(readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8')) } catch { /* 读不到按常规探测 */ }
          const fresh = url.searchParams.get('fresh') === '1'
          const viaGithub = await checkGithubVersion({ pkg, force: fresh })
          if (viaGithub !== null) {
            json(res, 200, { ok: true, privateRelease: true, ...viaGithub })
            return
          }
          if (pkg && pkg.dsh && pkg.dsh.privateRelease === true) {
            json(res, 200, { ok: false, privateRelease: true, error: '私有发行：请从 GitHub Release 手动更新' })
            return
          }
          // 新版检测（模仿 dsh-paoding）：三级源 + 缓存都在 lib/version.mjs，
          // 全失败也静默降级——这里只做转发，绝不影响面板主流程。
          // fresh=1（query，写法同 workspaces/check 路由的 searchParams）：
          // 手动检测更新，绕过 1h 缓存强制现测（getVersionInfo force）；
          // 用户在前端等结果，超时由 3s 放宽到 10s。缺省维持常态 3s。
          json(res, 200, {
            ok: true,
            ...(await getVersionInfo(fresh ? { force: true, timeoutMs: 10000 } : { timeoutMs: 3000 })),
          })
          return
        }

        if (route === 'self-update' && req.method === 'POST') {
          // 面板内一键升级（0.18.0 起只走私有库）：从配好的 GitHub 仓库下载该
          // tag 的源码包 → 校验包名与版本 → 整目录备份 → 覆盖 → 提示重启。
          // 可预期失败统一 HTTP 200 + ok:false（kind 给客户端分流，error 经
          // sanitizeWithRoots 脱敏）；成功带 restartRequired: true——磁盘换新了，
          // 运行中的进程还是旧代码，必须重启 DeepSeek 才生效。
          // pnpm 那套（lib/self-update.mjs）0.22.0 已删：私有发行不在 npm 上，
          // 它唯一能给出的结果是「未找到包」。
          let pkgSelf = null
          try { pkgSelf = JSON.parse(readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8')) } catch { /* 读不到就走原逻辑 */ }
          const ghRepo = resolveGithubRepo(pkgSelf, process.env)
          if (ghRepo !== '') {
            const token = resolveGithubToken(process.env).token
            const { version: curVer } = await currentVersion()
            const hit = await fetchLatestGithubVersion({ repo: ghRepo, token, timeoutMs: 10000, pinnedRepo: ghRepo })
            if (!hit.ok) {
              json(res, 200, { ok: false, kind: 'no-target', error: sanitizeWithRoots(String(hit.error || '查不到最新版本')) })
              return
            }
            if (compareVersions(curVer, hit.tag) >= 0) {
              json(res, 200, { ok: true, kind: 'up-to-date', from: curVer, to: hit.tag, repo: ghRepo })
              return
            }
            const out = await applyGithubUpdate({
              repo: ghRepo,
              tag: hit.tag,
              pluginRoot: PLUGIN_ROOT,
              backupRoot: path.join(path.dirname(PLUGIN_ROOT), '.backup'),
              token,
              pinnedRepo: ghRepo,
            })
            if (out.ok) {
              await recordUpdate(path.join(path.dirname(PLUGIN_ROOT), '.backup'), {
                at: new Date().toISOString(),
                repo: out.repo,
                tag: out.tag,
                from: out.from,
                to: out.to,
                backupDir: out.backupDir,
              })
              invalidateVersionCache()
              githubVersionCache = { at: 0, info: null }
              json(res, 200, {
                ok: true, kind: 'installed', from: out.from ?? null, to: out.to ?? null,
                restartRequired: true, repo: out.repo, tag: out.tag,
                backupDir: sanitizeWithRoots(String(out.backupDir ?? '')),
              })
            } else {
              json(res, 200, { ok: false, kind: out.kind || 'failed', error: sanitizeWithRoots(String(out.error || '更新失败')) })
            }
            return
          }
          // 没配 GitHub 仓库时不再退回 pnpm 那套（0.22.0）：本插件是私有发行，
          // npm 上没有它，pnpm 只会给出「未找到包」这种没用的报错。直接说清楚。
          json(res, 200, {
            ok: false, kind: 'no-target',
            error: '没配更新源：在 package.json 的 dsh.githubRepo 写 owner/repo（或设环境变量 XIAOYU_GITHUB_REPO），或手动从 Release 装新版',
          })
          return
        }

        if (route === 'host-debug' && req.method === 'GET') {
          // 现场诊断：宿主版本五级探针轨迹 + 形状判定。与 client.css 同级信任
          // 围栏（loopback + 可信 Host 才放行），只暴露版本与路径类信息。
          const home = resolveDshHome()
          const dbg = readHostVersionDebug(home)
          let shape = null
          try { shape = composeManagedRows(home, ctx.logger).shape } catch { /* 诊断信息尽力而为 */ }
          // 预设注册表内窥：每张 preset 的激活诊断只有注册表自己知道，防御式
          // 探测其服务面（方法名在宿主版本间可能变动，全部吞错尽力而为）。
          const jsonSafe = (v, depth = 0) => {
            if (depth > 4) return '…'
            try {
              if (v === null || v === undefined) return v
              if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
              if (typeof v === 'function') return `[fn ${v.name || 'anon'}]`
              if (Array.isArray(v)) return v.slice(0, 50).map((x) => jsonSafe(x, depth + 1))
              if (v instanceof Map) return { __map: [...v.keys()].slice(0, 50) }
              if (v instanceof Set) return { __set: [...v].slice(0, 50).map((x) => jsonSafe(x, depth + 1)) }
              const out = {}
              for (const k of Object.keys(v).slice(0, 80)) out[k] = jsonSafe(v[k], depth + 1)
              return out
            } catch { return '[unserializable]' }
          }
          const registryDump = {}
          try {
            const svc = typeof ctx.get === 'function' ? ctx.get('agentPresets') : null
            if (svc && typeof svc.list === 'function') {
              // list() 返回每张 preset 的 {id,name,order,broken}——broken 即
              // 面板上显示的逐行激活诊断（注册表自带审计，一行一条不可用原因）。
              const rows = await svc.list()
              registryDump.presets = jsonSafe(rows)
            }
          } catch (e) { registryDump.error = String(e?.message ?? e) }
          // 出口统一过 sanitizeDeep + 工作区根扩展表：trace.via / argv / execPath /
          // cwd 带本机绝对路径，诊断照给、路径脱敏（与错误 message 同一纪律）。
          json(res, 200, {
            ok: true,
            hostVersion: dbg.version,
            trace: sanitizeDeep(dbg.trace, sanitizeWithRoots),
            shape,
            registry: registryDump,
            runtime: {
              argv: sanitizeDeep(process.argv, sanitizeWithRoots),
              execPath: sanitizeWithRoots(process.execPath),
              cwd: sanitizeWithRoots(process.cwd()),
              electron: process.versions?.electron ?? null,
              node: process.version,
            },
          })
          return
        }

        if (route === 'workspaces' && req.method === 'GET') {
          // 工作区清单：宿主注册表逐根探测 novel/project.yml，面板顶部
          // 工作区选择器取数（hasNovel 的排前由客户端做，这里保序即可）。
          json(res, 200, { ok: true, workspaces: listWorkspaces(ctx.workspaceRegistry) })
          return
        }

        if (route === 'state' && req.method === 'GET') {
          // 全量快照（§3 契约）：path 钉死在注册表白名单内后才进解析层；
          // 单个坏文件进 warnings 不炸快照。
          const novelDir = resolveNovelRoot(url.searchParams.get('path'), ctx.workspaceRegistry)
          // scope=lite（0.15.0）：首屏精简体——只回书稿骨架，账本正文/世界/考据/
          // 章纲留空（payload.partial 列出缺块），客户端随后补一次全量。冷启动
          // 首屏从 ~1.26s 降到 ~0.8s、传输从 386KB 降到 87KB。
          // blocks=xxx（0.22.0）：按需只解析点名的块。首屏只要骨架，
          // memories/research/clues/timeline 这些大头等切到对应 tab 再拉，
          // 传输从 448KB 降到 105KB（省 77%）。缺省仍全量，老客户端不受影响。
          const snapshot = parseStateSnapshot(novelDir, {
            lite: url.searchParams.get('scope') === 'lite',
            blocks: url.searchParams.get('blocks') || undefined,
          })
          // 快照可到百 KB（记忆/时间线随书写长），gzip 后约 1/6；fetch 透明解压
          const text = JSON.stringify(snapshot)
          if (String(req.headers['accept-encoding'] || '').includes('gzip')) {
            const zipped = gzipSync(Buffer.from(text, 'utf8'))
            res.writeHead(200, {
              'content-type': 'application/json; charset=utf-8',
              'content-encoding': 'gzip',
              'content-length': zipped.length,
              'cache-control': 'no-store',
            })
            res.end(zipped)
          } else {
            json(res, 200, snapshot)
          }
          return
        }

        if (route === 'gate' && req.method === 'GET') {
          // 门禁分：单章（file=xxx.md）或整本批量（缺 file）。只读、按文件
          // mtime 缓存；python3 不在时整批短路成 python:false，面板据此隐藏徽标。
          const novelDir = resolveNovelRoot(url.searchParams.get('path'), ctx.workspaceRegistry)
          const one = url.searchParams.get('file')
          const wsKey = url.searchParams.get('path')
          if (one) {
            const result = await gateForFile(novelDir, one, wsKey)
            const safeName = path.basename(one)
            const cfg = readGateConfig(novelDir)
            const list = (loadGateHistory()[wsKey] || {})[safeName] || []
            const prev = list.length >= 2 ? list[list.length - 2] : null
            json(res, 200, {
              ok: true,
              ...result,
              passMark: cfg.passMark,
              pass: typeof result.human === 'number' ? result.human >= cfg.passMark : null,
              canUndo: latestUndo(novelDir, safeName) !== null,
              prev,
              history: list.slice(-5),
            })
            return
          }
          let files = []
          let totalFiles = 0
          // files 参数（分片拉取）：面板首屏只算可见几章，其余后台补；
          // 传了就只扫这几章，不传仍整本（CLI / 老客户端兼容）。
          const pick = String(url.searchParams.get('files') || '')
            .split(',')
            .map((name) => path.basename(String(name).trim()))
            .filter((name) => name !== '' && name.endsWith('.md'))
          try {
            const all = readdirSync(path.join(novelDir, 'chapters'))
              .filter((name) => typeof name === 'string' && name.endsWith('.md'))
              .sort()
            totalFiles = all.length
            files = pick.length > 0 ? all.filter((name) => pick.includes(name)) : all.slice(0, 200)
          } catch { /* chapters/ 缺席：空表 */ }
          const gates = {}
          const queue = files.slice()
          const worker = async () => {
            while (queue.length > 0) {
              const name = queue.shift()
              gates[name] = await gateForFile(novelDir, name, url.searchParams.get('path'))
            }
          }
          await Promise.all(Array.from({ length: Math.min(4, Math.max(files.length, 1)) }, worker))
          const pythonMissing = Object.values(gates).some((g) => g && g.reason === 'no-python')
          const cfg = readGateConfig(novelDir)
          const scored = Object.values(gates).filter((g) => g && g.ok)
          const failed = scored.filter((g) => g.human < cfg.passMark).length
          const totalWords = scored.reduce((sum, g) => sum + (Number(g.words) || 0), 0)
          if (totalFiles <= 200) recordProgress(novelDir, totalWords)
          json(res, 200, {
            ok: true,
            python: !pythonMissing,
            gates,
            total: totalFiles,
            truncated: totalFiles > files.length,
            passMark: cfg.passMark,
            failed,
            words: totalWords,
          })
          return
        }

        if (route === 'gate-config' && req.method === 'GET') {
          // 项目级门禁线：novel/xiaoyu.json 的 gate.passMark（默认 78）。
          const novelDir = resolveNovelRoot(url.searchParams.get('path'), ctx.workspaceRegistry)
          json(res, 200, { ok: true, ...readGateConfig(novelDir), defaults: { passMark: DEFAULT_PASS_MARK } })
          return
        }

        if (route === 'gate-config' && req.method === 'POST') {
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          const n = Number(body.passMark)
          if (!Number.isInteger(n) || n < 50 || n > 100) {
            json(res, 422, { ok: false, error: 'passMark 需要 50-100 的整数' })
            return
          }
          json(res, 200, { ok: true, ...writeGateConfig(novelDir, { passMark: n }) })
          return
        }

        if (route === 'gate-undo' && req.method === 'POST') {
          // 撤销最近一次自动修/整章修：恢复 .xiaoyu/undo 下的原文快照。
          // 写入仍走 mutateChapterBody（baseHash 对当前磁盘内容），并发改动不覆盖。
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          const raw = String(body.file ?? '')
          if (raw.includes('/') || raw.includes('\\') || raw.includes('..')) {
            json(res, 400, { ok: false, error: 'bad-file' })
            return
          }
          const safe = path.basename(raw)
          const backup = latestUndo(novelDir, safe)
          if (backup === null) {
            json(res, 404, { ok: false, error: '没有可撤销的自动修记录' })
            return
          }
          let full
          try { full = readFileSync(path.join(novelDir, 'chapters', safe), 'utf8') } catch {
            json(res, 404, { ok: false, error: '章节不存在' })
            return
          }
          // 快照是原文逐字节副本：直接回写，不做 frontmatter 重排（撤销要的是
          // 「和改之前一模一样」，不是「格式等价的正文」）。
          const restoredBody = stripChapterFrontmatter(backup.text)
          writeFileSync(path.join(novelDir, 'chapters', safe), backup.text, 'utf8')
          const analyzed = analyzeChapter(restoredBody)
          json(res, 200, {
            ok: true,
            human: analyzed.score,
            detector: analyzed.detector?.score ?? null,
            at: backup.at,
            hash: sha256(backup.text),
            canUndo: latestUndo(novelDir, safe) !== null,
          })
          return
        }

        if (route === 'setup' && req.method === 'GET') {
          // 开书九件套：概览/章节/角色/伏笔/关系/时间线/设定/写作风格/索引板。
          const novelDir = resolveNovelRoot(url.searchParams.get('path'), ctx.workspaceRegistry)
          json(res, 200, checkSetup(novelDir))
          return
        }

        if (route === 'audit' && req.method === 'GET') {
          // 全书体检：跨章重复 / 人物出场 / 章纲兑现 / 节奏 / 章末钩子。
          const novelDir = resolveNovelRoot(url.searchParams.get('path'), ctx.workspaceRegistry)
          // 按指纹缓存：热调用 466ms → 几毫秒（文件没动结果必然一样）。
          const { value: audit } = cachedResult('audit', novelFingerprint(novelDir), () => auditProject(novelDir))
          recordProgress(novelDir, audit.totals.words)
          json(res, 200, audit)
          return
        }

        if (route === 'audit-report' && req.method === 'POST') {
          // 体检报告落盘到 novel/reports/，同名自动加序号，绝不覆盖旧报告。
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          const audit = auditProject(novelDir)
          const bookTitle = typeof body.title === 'string' && body.title.trim() !== '' ? body.title.trim() : '全书'
          const dir = path.join(novelDir, 'reports')
          mkdirSync(dir, { recursive: true })
          const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
          let target = path.join(dir, 'audit-' + stamp + '.md')
          let n = 2
          while (existsSync(target)) {
            target = path.join(dir, 'audit-' + stamp + '-' + n + '.md')
            n += 1
          }
          writeFileSync(target, auditMarkdown(audit, bookTitle), 'utf8')
          json(res, 200, { ok: true, file: path.basename(target), rel: 'reports/' + path.basename(target), chapters: audit.totals.chapters })
          return
        }

        if (route === 'trend' && req.method === 'GET') {
          // 门禁趋势：按章序返回每章最新人味/人写（面板折线图取数）。
          const novelDir = resolveNovelRoot(url.searchParams.get('path'), ctx.workspaceRegistry)
          const cfg = readGateConfig(novelDir)
          let names = []
          try {
            names = readdirSync(path.join(novelDir, 'chapters'))
              .filter((name) => typeof name === 'string' && name.endsWith('.md'))
              .sort()
          } catch { /* 无 chapters/：空表 */ }
          const rows = []
          for (const name of names.slice(0, 200)) {
            const g = await gateForFile(novelDir, name, url.searchParams.get('path'))
            if (!g || !g.ok) continue
            rows.push({ file: name, human: g.human, detector: g.detector, words: g.words ?? 0 })
          }
          const avg = rows.length ? rows.reduce((sum, r) => sum + r.human, 0) / rows.length : null
          json(res, 200, { ok: true, passMark: cfg.passMark, rows, avg: avg === null ? null : Math.round(avg * 10) / 10 })
          return
        }

        if (route === 'progress' && req.method === 'GET') {
          // 写作进度：每日总字数快照（按作品分开），今日新增 = 今天 − 上一记录日。
          const novelDir = resolveNovelRoot(url.searchParams.get('path'), ctx.workspaceRegistry)
          const book = loadProgress()[novelDir] || {}
          const keys = Object.keys(book).sort()
          const days = keys.slice(-30).map((date) => ({ date, words: book[date] }))
          const today = days.find((d) => d.date === todayKey())
          const before = days.filter((d) => d.date !== todayKey()).pop() || null
          json(res, 200, {
            ok: true,
            today: today ? today.words : null,
            previous: before ? before.words : null,
            delta: today && before ? today.words - before.words : null,
            days,
          })
          return
        }

        if (route === 'workspace-remove' && req.method === 'POST') {
          // 移除工作区登记（0.23.0）：只从注册表摘掉，绝不动磁盘文件。
          // 为什么需要：接入测试过、或目录被作者删掉的死条目会一直留在选择器里，
          // 点进去是空面板，看着像坏了。
          const body = await readBody(req, res)
          const target = typeof body.path === 'string' ? body.path.trim().replace(/\/+$/, '') : ''
          if (target === '' || !path.isAbsolute(target)) {
            json(res, 400, { ok: false, error: '需要一个绝对路径' })
            return
          }
          const registry = ctx.workspaceRegistry
          if (!registry) {
            json(res, 503, { ok: false, error: '工作区服务不可用' })
            return
          }
          // 宿主的删除接口名各版本不一：remove / delete / unregister 全试一遍。
          const fn = [registry.remove, registry.delete, registry.unregister].find((f) => typeof f === 'function')
          if (fn === undefined) {
            json(res, 503, { ok: false, error: '当前宿主不支持移除工作区（只能接入，不能摘除）' })
            return
          }
          try {
            await fn.call(registry, target)
          } catch (error) {
            json(res, 400, { ok: false, error: sanitizeWithRoots(String(error && error.message ? error.message : error)) })
            return
          }
          invalidateAllCaches()
          json(res, 200, { ok: true, path: target })
          return
        }

        if (route === 'workspace-add' && req.method === 'POST') {
          // 接入已有项目：把磁盘上的 novel/ 目录登记成工作区。只登记，不动文件。
          const body = await readBody(req, res)
          let target = typeof body.path === 'string' ? body.path.trim() : ''
          // 容错（0.23.0）：用户常把书目录本身（…/novel）贴进来，或带尾部斜杠。
          // 这里统一退到「含 novel/project.yml 的那一级」，别让一撇斜杠毁掉一次接入。
          target = target.replace(/\u3000/g, ' ').trim().replace(/\/+$/, '')
          if (target === '' || !path.isAbsolute(target)) {
            json(res, 400, { ok: false, error: '需要一个绝对路径' })
            return
          }
          if (/^\/(proc|sys|dev)(\/|$)/.test(target) || path.resolve(target) === path.sep) {
            json(res, 400, { ok: false, error: '系统目录不能作为工作区' })
            return
          }
          let stat
          try { stat = statSync(target) } catch {
            json(res, 404, { ok: false, error: '目录不存在' })
            return
          }
          if (!stat.isDirectory()) {
            json(res, 400, { ok: false, error: '不是目录' })
            return
          }
          // 贴的是 …/novel 就退回父目录；贴的是工作区根就直接用。
          if (!existsSync(path.join(target, 'novel', 'project.yml')) && existsSync(path.join(target, 'project.yml')) && path.basename(target) === 'novel') {
            target = path.dirname(target)
          }
          if (!existsSync(path.join(target, 'novel', 'project.yml'))) {
            // 报错里带上人话的两种正确写法，比「没有 project.yml」有用得多
            json(res, 422, {
              ok: false,
              error: '该目录下没有 novel/project.yml。请填工作区根目录（如 /sdcard/小说工作台），它下面要有 novel/project.yml',
            })
            return
          }
          const registry = ctx.workspaceRegistry
          if (!registry || typeof registry.create !== 'function') {
            json(res, 503, { ok: false, error: '工作区服务不可用' })
            return
          }
          const title = typeof body.title === 'string' && body.title.trim() !== '' ? body.title.trim() : path.basename(target)
          const entity = await registry.create(target, title)
          json(res, 200, {
            ok: true,
            workspace: {
              path: (entity && entity.path) || target,
              title: (entity && entity.title) || title,
            },
          })
          return
        }

        if (route === 'gate-fix' && req.method === 'POST') {
          // 按建议改一句：只做保守的规则微调（删副词/模糊量词、拆长句、打散并列），
          // 改完立刻重算分数。写入走 mutateChapterBody（frontmatter 保字节 +
          // baseHash 冲突检测），不会覆盖并发改动。
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          const raw = String(body.file ?? '')
          if (raw.includes('/') || raw.includes('\\') || raw.includes('..')) {
            json(res, 400, { ok: false, error: 'bad-file' })
            return
          }
          const safe = path.basename(raw)
          let full
          try { full = readFileSync(path.join(novelDir, 'chapters', safe), 'utf8') } catch {
            json(res, 404, { ok: false, error: '章节不存在' })
            return
          }
          const chapterBody = stripChapterFrontmatter(full)
          const sentence = String(body.sentence ?? '')
          if (sentence === '' || !chapterBody.includes(sentence)) {
            json(res, 422, { ok: false, error: '这句不在本章正文里（可能已被改写，刷新后再试）' })
            return
          }
          const fixed = fixSentence(sentence)
          if (!fixed.changed) {
            json(res, 422, { ok: false, error: '这句没有可自动处理的病灶' })
            return
          }
          const nextBody = chapterBody.replace(sentence, fixed.text)
          backupChapter(novelDir, safe, full)
          const written = mutateChapterBody(novelDir, safe, nextBody, { baseHash: sha256(full) })
          const analyzed = analyzeChapter(nextBody)
          json(res, 200, {
            ok: true,
            before: sentence,
            after: fixed.text,
            ops: fixed.ops,
            hash: written.hash,
            human: analyzed.score,
            detector: analyzed.detector.score,
          })
          return
        }

        if (route === 'gate-fix-all' && req.method === 'POST') {
          // 整章一键保守修：对全章嫌疑句逐句跑 fixSentence，能改的都改掉，
          // 一次写盘。写前给预览干跑（preview:true）不落盘；写盘沿用
          // mutateChapterBody（frontmatter 保字节 + baseHash 冲突检测）。
          // 只做不增删信息的微调（删副词/量词、拆长句、打散并列），情节与
          // 对话语义零改动——这是「按建议改」的批量版，不是重写。
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          const raw = String(body.file ?? '')
          if (raw.includes('/') || raw.includes('\\') || raw.includes('..')) {
            json(res, 400, { ok: false, error: 'bad-file' })
            return
          }
          const safe = path.basename(raw)
          let full
          try { full = readFileSync(path.join(novelDir, 'chapters', safe), 'utf8') } catch {
            json(res, 404, { ok: false, error: '章节不存在' })
            return
          }
          const chapterBody = stripChapterFrontmatter(full)
          const before = analyzeChapter(chapterBody)
          let nextBody = chapterBody
          const items = []
          for (const flag of before.flags) {
            if (!nextBody.includes(flag.text)) continue
            const fixed = fixSentence(flag.text)
            if (!fixed.changed) continue
            nextBody = nextBody.replace(flag.text, fixed.text)
            items.push({ before: flag.text, after: fixed.text, ops: fixed.ops })
          }
          const after = analyzeChapter(nextBody)
          const summary = {
            ok: true,
            count: items.length,
            items: items.slice(0, 20),
            before: { h: before.score, d: before.detector?.score ?? null },
            after: { h: after.score, d: after.detector?.score ?? null },
            hook: after.hook ?? null,
            dryRun: body.preview === true || items.length === 0,
          }
          if (summary.dryRun) { json(res, 200, summary); return }
          backupChapter(novelDir, safe, full)
          const written = mutateChapterBody(novelDir, safe, nextBody, { baseHash: sha256(full) })
          json(res, 200, { ...summary, dryRun: false, hash: written.hash })
          return
        }


/** 语言档位清单：templates/novel/style-presets/*.md 的 stem（按文件名排序）。
 * 档位是插件自带的写作风格模板，新增 .md 即自动出现在面板按钮里。 */
const STYLE_PRESET_DIR = path.join(PLUGIN_ROOT, 'templates', 'novel', 'style-presets')
function listStyleRegisters() {
  try {
    return readdirSync(STYLE_PRESET_DIR)
      .filter((name) => typeof name === 'string' && name.endsWith('.md'))
      .map((name) => name.slice(0, -3))
      .sort()
  } catch {
    return ['plain', 'semi', 'classical']
  }
}
function styleRegisterLabel(register) {
  try {
    const text = readFileSync(path.join(STYLE_PRESET_DIR, register + '.md'), 'utf8')
    const first = text.split('\n')[0].replace(/^#\s*语言档位[：:]\s*/, '').trim()
    return first === '' ? register : first
  } catch {
    return register
  }
}

        if (route === 'style-presets' && req.method === 'GET') {
          json(res, 200, { ok: true, items: listStyleRegisters().map((register) => ({ register, label: styleRegisterLabel(register) })) })
          return
        }

        if (route === 'style-register' && req.method === 'POST') {
          // 套用语言档位：把 templates/novel/style-presets/<档位>.md 的正文
          // 写进 style.md 的「## 语言」节（没有该节就追加）。只动语言节，别节不碰。
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          const register = String(body.register ?? '')
          const available = listStyleRegisters()
          if (!available.includes(register)) {
            json(res, 422, { ok: false, error: '未知档位「' + register + '」——可用：' + available.join(' / ') })
            return
          }
          let snippet
          try {
            snippet = readFileSync(path.join(PLUGIN_ROOT, 'templates', 'novel', 'style-presets', register + '.md'), 'utf8')
          } catch {
            json(res, 500, { ok: false, error: '档位模板缺失' })
            return
          }
          const lines = snippet.split('\n')
          const sectionBody = lines.slice(1).join('\n').trim()
          const style = readStyleState(novelDir)
          const base = style.found ? style.text : style.template
          const replaceSection = (text, heading, inner) => {
            const rows = text.split('\n')
            const start = rows.findIndex((line) => line.trim() === heading)
            if (start === -1) return text.replace(/\s*$/, '') + '\n\n' + heading + '\n\n' + inner + '\n'
            let end = rows.length
            for (let i = start + 1; i < rows.length; i += 1) { if (/^##\s/.test(rows[i])) { end = i; break } }
            return [...rows.slice(0, start), heading, '', inner, '', ...rows.slice(end)].join('\n')
          }
          const next = replaceSection(base, '## 语言', sectionBody)
          json(res, 200, saveStyleText(novelDir, next, {}))
          return
        }

        if (route === 'ledger-clean' && req.method === 'GET') {
          // 清账本计划（只读）：面板按钮点之前先知道会压几条、升几条。
          try {
            const novelDir = resolveNovelRoot(url.searchParams.get('path'), ctx.workspaceRegistry)
            json(res, 200, describePlan(planLedgerClean(novelDir)))
          } catch (error) {
            json(res, 400, { ok: false, error: sanitizeWithRoots(String(error && error.message ? error.message : error)) })
          }
          return
        }

        if (route === 'ledger-clean' && req.method === 'POST') {
          // 执行清账（0.16.0）：超长条目留结论、明细写 archive/ledger-details/，
          // 超期伏笔 planted→progressing；写前整本备份，body.undo 还原上一次。
          try {
            const body = await readBody(req, res)
            const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
            if (body.undo === true) {
              const undone = undoLedgerClean(novelDir)
              invalidateAllCaches()
              json(res, 200, undone)
              return
            }
            const out = applyLedgerClean(novelDir)
            invalidateAllCaches()
            json(res, 200, {
              ok: true,
              changed: out.changed,
              at: out.at,
              trimmedTotal: out.trimmedTotal,
              advancedTotal: out.advancedTotal,
              archivedTotal: out.archivedTotal,
              charsRemoved: out.charsRemoved,
              indexRebuilt: out.indexRebuilt,
              backupDir: out.backupDir,
              detailDir: out.detailDir,
              files: out.files.map((item) => ({
                file: item.file,
                bytesBefore: item.bytesBefore,
                bytesAfter: item.bytesAfter,
                trimmed: item.trimmed,
                advanced: item.advanced,
                skipped: item.skipped,
                archive: item.archive,
              })),
            })
          } catch (error) {
            json(res, 400, { ok: false, error: sanitizeWithRoots(String(error && error.message ? error.message : error)) })
          }
          return
        }

        if (route === 'check' && req.method === 'GET') {
          // 静态体检：checkProject 读章节 frontmatter 原文——快照会把越枚举
          // status 归一成 pending（人工改坏在面板里看不出来），这里原样透出
          // 问题清单，概览「静态体检」黄条取数。checkProject 自带的 ok 是
          // 「无 error」语义、summary 是 CLI 退出码原料，都不进面板契约
          // （§2 出参就是 { ok, problems }），客户端自己按 level 计数。
          const novelDir = resolveNovelRoot(url.searchParams.get('path'), ctx.workspaceRegistry)
          // 合并格式硬校验（键名/键序/围栏/文件名规范/索引一致性），与 CLI 同源。
          // 按指纹缓存：check 228ms + format 74ms，文件没动就不必重算。
          const fp = novelFingerprint(novelDir)
          const { value: problems } = cachedResult('check', fp, () => {
            const format = checkFormat(novelDir)
            const seen = new Set()
            const list = []
            for (const p of checkProject(novelDir).problems.concat(format.problems)) {
              const key = p.level + '|' + p.file + '|' + p.message
              if (seen.has(key)) continue
              seen.add(key)
              list.push(p)
            }
            return list
          })
          json(res, 200, { ok: true, problems })
          return
        }

        if (route === 'export-selection' && req.method === 'GET') {
          // 勾选导出（0.7.0）：按面板勾中的章节拼 TXT / Word，直发附件字节流。
          // format 只认 txt|docx；files 是逗号分隔的章号或文件 stem——选择器与
          // CLI `xiaoyu-novel export --chapters` 同一套（lib/novel-export.mjs）。
          try {
            const novelDir = resolveNovelRoot(url.searchParams.get('path'), ctx.workspaceRegistry)
            const format = String(url.searchParams.get('format') || 'txt').toLowerCase()
            const files = url.searchParams.get('files') || ''
            const snap = parseStateSnapshot(novelDir)
            const bookTitle = snap && snap.project && typeof snap.project.title === 'string' ? snap.project.title : ''
            const built = buildSelectionExport({ novelDir, files, format, title: bookTitle })
            const now = new Date()
            const stamp = String(now.getFullYear()) + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0')
            const fileName = (bookTitle || '书稿') + '-选中' + built.chapters.length + '章-' + stamp + '.' + format
            const MIME = {
              docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              epub: 'application/epub+zip',
            }
            const mime = MIME[format] || 'text/plain; charset=utf-8'
            res.writeHead(200, {
              'content-type': mime,
              'content-length': built.buffer.length,
              'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(fileName),
              'cache-control': 'no-store',
            })
            res.end(built.buffer)
          } catch (error) {
            json(res, 400, { ok: false, error: sanitizeWithRoots(String(error && error.message ? error.message : error)) })
          }
          return
        }

        if (route === 'chapter' && req.method === 'GET') {
          // 章节正文全文（抽屉用）：file 只认 chapters/ 下纯文件名；响应组装
          // 直传 readChapter 结果（五期起含对应章纲 outline 字段，无章纲为
          // null；0.1.19 起顶层与 outline 各带原文 hash——正文/章纲编辑保存
          // 的 base_hash 基线），照 §2 契约 { ok, file, frontmatter, body, hash, outline }。
          const novelDir = resolveNovelRoot(url.searchParams.get('path'), ctx.workspaceRegistry)
          json(res, 200, readChapter(novelDir, url.searchParams.get('file')))
          return
        }

        if (route === 'outline' && req.method === 'GET') {
          // 章纲全文（0.1.15，章纲弹层用）：file 只认 outlines/ 下合 vXX-cXXX
          // 规范的纯文件名；响应 { ok, file, words, body }——章纲纯 markdown
          // 无 frontmatter，body 即原文，words 为 CJK 计数。
          const novelDir = resolveNovelRoot(url.searchParams.get('path'), ctx.workspaceRegistry)
          json(res, 200, readOutlineFile(novelDir, url.searchParams.get('file')))
          return
        }

        if (route === 'style' && req.method === 'GET') {
          // 写作风格基准（0.1.19，写作风格 tab 取数）：novel/style.md 全文 +
          // 指纹（保存路由 base_hash 的基线）+ 插件模板全文（客户端用它预填
          // 默认基线创建）。found:false = 文件尚未创建，是常态不是错误。
          const novelDir = resolveNovelRoot(url.searchParams.get('path'), ctx.workspaceRegistry)
          const style = readStyleState(novelDir)
          json(res, 200, { ok: true, found: style.found, text: style.text, hash: style.hash, template: style.template })
          return
        }

        if (route === 'chapter-status' && req.method === 'POST') {
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          json(res, 200, mutateChapterStatus(novelDir, body.file, body.status))
          return
        }

        if (route === 'chapter-create' && req.method === 'POST') {
          // 从章纲建章（0.1.15，按单写作的未建章章纲一键建章）：chapters/
          // 落 status=pending 空章节（frontmatter 按模板、正文待写），建后走
          // 既有 pending 流转；已存在 409、章纲缺失 404、非章纲文件名 422。
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          json(res, 200, createChapterFromOutline(novelDir, body.file))
          return
        }

        if (route === 'foreshadow-status' && req.method === 'POST') {
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          json(res, 200, mutateForeshadowStatus(novelDir, body.id, body.status))
          return
        }

        if (route === 'phase' && req.method === 'POST') {
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          json(res, 200, mutatePhase(novelDir, body.phase))
          return
        }

        if (route === 'project-save' && req.method === 'POST') {
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          // base_hash = 面板表单载入时的 project.yml 指纹：外部改过 → 409 拒写
          // （人工改动保护）；旧客户端不带该字段 → undefined，跳过检查。
          json(res, 200, mutateProject(novelDir, body.values, { baseHash: body.base_hash }))
          return
        }

        if (route === 'style-save' && req.method === 'POST') {
          // 写作风格保存（0.1.19）：style.md 整文件覆写（纯 markdown 基准
          // 文档，无行级键位，整文件替换即最小手术）；base_hash 过期 → 409
          // 拒写（人工改动保护，与 project-save 同口径）；text 非 string 422。
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          json(res, 200, saveStyleText(novelDir, body.text, { baseHash: body.base_hash }))
          return
        }

        if (route === 'chapter-save' && req.method === 'POST') {
          // 章节正文保存（0.1.19，面板章节阅读页编辑态）：frontmatter 围栏
          // （含）之前逐字节保留、围栏后整段替换（正文是自由形态文本，无行级
          // 键位可手术）；base_hash 过期 → 409 拒写（人工改动保护，与
          // project-save 同口径）；body 非 string / 缺围栏 422、章节缺 404。
          // title 可选（0.1.25），提供则与正文同刀原子替换围栏内 title 行。
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          // 写盘前留旧正文快照（0.6.0）：历史是保险，失败静默不拦保存。
          try {
            const cur = path.join(novelDir, 'chapters', path.basename(String(body.file || '')))
            if (existsSync(cur)) snapshotChapter(novelDir, body.file, readFileSync(cur, 'utf8'))
          } catch { /* 快照失败不影响主流程 */ }
          const saved = mutateChapterBody(novelDir, body.file, body.body, { baseHash: body.base_hash, title: body.title })
          // 记账提示（0.15.0）：本章在 memories / timeline / clue-board 里有没有
          // 对应条目。只读三本账（带 mtime 缓存），失败不影响保存结果——记账
          // 是纪律不是保存的前置条件。
          let ledger = null
          try {
            const safe = path.basename(String(body.file ?? ''))
            let num = null
            try {
              const head = readFileSync(path.join(novelDir, 'chapters', safe), 'utf8').slice(0, 1200)
              const m = /^---[\s\S]*?\n\s*num:\s*(\d+)/m.exec(head)
              if (m) num = Number(m[1])
            } catch { /* 章号读不到就只按 stem 匹配 */ }
            ledger = chapterLedgerHint(novelDir, safe, num)
          } catch { /* 提示失败静默 */ }
          json(res, 200, ledger ? { ...saved, ledger } : saved)
          return
        }

        if (route === 'outline-save' && req.method === 'POST') {
          // 章纲保存（0.1.19，章节阅读页章纲对照栏编辑态）：章纲纯 markdown
          // 无 frontmatter，整文件替换；file 认章节文件名或 stem，目标恒为
          // outlines/<stem>.md（不存在 404，v1 不做面板新建章纲）；base_hash
          // 检测同上；stem 不合 vXX-cXXX 规范 422。
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          json(res, 200, mutateOutlineBody(novelDir, body.file, body.body, { baseHash: body.base_hash }))
          return
        }

        if (route === 'file-source' && req.method === 'GET') {
          // 受管文件读（0.1.20「全量可编辑写面」，四条通用路由之一）：rel 白
          // 名单校验 + 结构口径在 panel-core（managedRelCheck / readManagedFile），
          // 路由只做围栏与分发。hash 为原文指纹——编辑态保存的 base_hash 基线。
          const novelDir = resolveNovelRoot(url.searchParams.get('path'), ctx.workspaceRegistry)
          json(res, 200, readManagedFile(novelDir, url.searchParams.get('rel')))
          return
        }

        if (route === 'file-save' && req.method === 'POST') {
          // 受管文件存：整文件覆写 + 保存时结构校验（解析失败/缺围栏 422）+
          // base_hash 过期 409（人工改动保护，与 project-save 同口径文案）。
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          json(res, 200, saveManagedFile(novelDir, body.rel, body.text, { baseHash: body.base_hash }))
          return
        }

        if (route === 'file-create' && req.method === 'POST') {
          // 受管文件建：已存在 409（绝不覆盖），结构校验同存（新角色卡/新章
          // 纲由客户端模板预填，服务端只验形状）。
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          json(res, 200, createManagedFile(novelDir, body.rel, body.text))
          return
        }

        if (route === 'file-delete' && req.method === 'POST') {
          // 受管文件删：不可逆，服务端不做二次确认（UI 层强制确认弹层）；
          // 白名单最严——账本 yml / md 实体卡 / outlines 之外只有 chapters/
          // 的删除（正文编辑走 chapter-save，通用存不开放防绕过状态机语义）。
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          json(res, 200, deleteManagedFile(novelDir, body.rel))
          return
        }

        if (route === 'chapter-cast' && req.method === 'GET') {
          // 本章出场名单（0.15.3）：关系图选中某一章时只画本章露过面的人。
          // 口径与 audit 的「角色 0 出场」一致（正文命中角色卡 name），带 mtime 缓存。
          try {
            const novelDir = resolveNovelRoot(url.searchParams.get('path'), ctx.workspaceRegistry)
            json(res, 200, chapterCast(novelDir, url.searchParams.get('file')))
          } catch (error) {
            const status = error && error.status ? error.status : 500
            json(res, status, { ok: false, error: sanitizeWithRoots(String(error && error.message ? error.message : error)) })
          }
          return
        }

        if (route === 'ledger-stats' && req.method === 'GET') {
          // 账本体检（0.15.0）：每本账体积/条数/超长条数/最长几条预览。
          // 口径与 checkProject 的账本膨胀 warn 一致，面板概览页据此出卡。
          const novelDir = resolveNovelRoot(url.searchParams.get('path'), ctx.workspaceRegistry)
          json(res, 200, ledgerStats(novelDir))
          return
        }

        if (route === 'trash' && req.method === 'GET') {
          // 回收站列表（0.15.0）：删除先进 .trash/，面板「工具 → 回收站」恢复。
          const novelDir = resolveNovelRoot(url.searchParams.get('path'), ctx.workspaceRegistry)
          json(res, 200, listTrashItems(novelDir))
          return
        }

        if (route === 'trash-restore' && req.method === 'POST') {
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          json(res, 200, restoreTrashItem(novelDir, body.id))
          return
        }

        if (route === 'trash-purge' && req.method === 'POST') {
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          json(res, 200, purgeTrashItem(novelDir, body.id))
          return
        }

        if (route === 'export-book' && req.method === 'GET') {
          // 整本导出（0.15.0）：与勾选导出同一套排版，只是不筛章——面板
          // 「工具 → 导出」直出 TXT / Word / EPUB，省得去终端跑 xiaoyu-novel export。
          try {
            const novelDir = resolveNovelRoot(url.searchParams.get('path'), ctx.workspaceRegistry)
            const format = String(url.searchParams.get('format') || 'txt').toLowerCase()
            const snap = parseStateSnapshot(novelDir)
            const project = snap && snap.project && typeof snap.project === 'object' ? snap.project : {}
            const bookTitle = typeof project.title === 'string' ? project.title : ''
            const author = typeof project.author === 'string' ? project.author : ''
            const list = Array.isArray(snap && snap.chapters) ? snap.chapters : []
            if (list.length === 0) {
              json(res, 400, { ok: false, error: 'novel/chapters 里没有可导出的章节' })
              return
            }
            const built = buildSelectionExport({ novelDir, files: list.map((c) => c.file), format, title: bookTitle, author })
            const now = new Date()
            const stamp = String(now.getFullYear()) + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0')
            const fileName = (bookTitle || '书稿') + '-全本' + built.chapters.length + '章-' + stamp + '.' + format
            const MIME = {
              docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              epub: 'application/epub+zip',
            }
            res.writeHead(200, {
              'content-type': MIME[format] || 'text/plain; charset=utf-8',
              'content-length': built.buffer.length,
              'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(fileName),
              'cache-control': 'no-store',
            })
            res.end(built.buffer)
          } catch (error) {
            json(res, 400, { ok: false, error: sanitizeWithRoots(String(error && error.message ? error.message : error)) })
          }
          return
        }

        if (route === 'slim-plan' && req.method === 'GET') {
          // 账本瘦身计划（0.15.0，只读）：archivePlan 原样带 moveBlocks/keepBlocks
          // 会几十 KB，面板只要清单——剥掉正文块，只回每本账搬几留几、blocked 与
          // 目标归档文件名。
          try {
            const novelDir = resolveNovelRoot(url.searchParams.get('path'), ctx.workspaceRegistry)
            const before = String(url.searchParams.get('before') || '').trim()
            const planned = archivePlan(novelDir, before)
            json(res, 200, {
              ok: true,
              before: planned.before,
              fromVolume: planned.fromVolume,
              plan: planned.plan.map((item) => ({
                blocked: item.blocked,
                file: item.file,
                archiveFile: item.archiveFile,
                move: item.move,
                keep: item.keep,
              })),
              moveTotal: planned.plan.reduce((n, item) => n + item.move, 0),
              blockedAny: planned.plan.some((item) => item.blocked),
            })
          } catch (error) {
            json(res, 400, { ok: false, error: sanitizeWithRoots(String(error && error.message ? error.message : error)) })
          }
          return
        }

        if (route === 'slim-apply' && req.method === 'POST') {
          // 执行归档：只搬已写完卷的条目，写前 .bak，写后校验主账仍可解析
          // （lib/slim-core.mjs archiveApply 的口径，与 CLI xiaoyu-novel slim 同源）。
          try {
            const body = await readBody(req, res)
            const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
            const before = String(body.before || '').trim()
            const out = archiveApply(novelDir, before)
            invalidateAllCaches()
            json(res, 200, out)
          } catch (error) {
            json(res, 400, { ok: false, error: sanitizeWithRoots(String(error && error.message ? error.message : error)) })
          }
          return
        }

        if (route === 'versions' && req.method === 'GET') {
          // 正文版本列表（0.6.0）：每章保留最近 30 份，倒序。
          const novelDir = resolveNovelRoot(url.searchParams.get('path'), ctx.workspaceRegistry)
          json(res, 200, { ok: true, versions: listVersions(novelDir, url.searchParams.get('file')) })
          return
        }

        if (route === 'git-status' && req.method === 'GET') {
          // 书稿版本安全网（0.10.0）：是否已建仓 + 有多少未提交改动。
          const novelDir = resolveNovelRoot(url.searchParams.get("path"), ctx.workspaceRegistry)
          json(res, 200, { ok: true, available: gitAvailable(), ...repoStatus(novelDir) })
          return
        }

        if (route === 'git-init' && req.method === 'POST') {
          // 一键建仓：.git + .gitignore + 首次提交。幂等。
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          const result = initRepo(novelDir)
          if (result.ok) invalidateAllCaches()
          json(res, result.ok ? 200 : 500, result)
          return
        }

        if (route === 'git-commit' && req.method === 'POST') {
          // 提交当前改动；无改动不造空提交（前端按 commit:null 提示）。
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          const result = commitAll(novelDir, body.message)
          json(res, result.ok ? 200 : 500, result)
          return
        }

        if (route === 'git-log' && req.method === 'GET') {
          // 最近提交（含每次改了哪些文件），面板按「这次动了哪几章」展示。
          const novelDir = resolveNovelRoot(url.searchParams.get("path"), ctx.workspaceRegistry)
          json(res, 200, listCommits(novelDir, Number(url.searchParams.get("limit")) || 20))
          return
        }

        if (route === 'git-restore' && req.method === 'POST') {
          // 单文件回滚到某次提交。落盘前给章节留一份面板历史快照（双保险）。
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          const rel = String(body.rel ?? "")
          const safe = safeRel(novelDir, rel)
          if (safe === null || safe.startsWith(".git") || safe.includes("/.git")) {
            json(res, 403, { ok: false, error: "只能回滚书稿目录内的文件" })
            return
          }
          const result = restoreFile(novelDir, safe, body.rev, {
            snapshot: (targetRel, text) => {
              const m = /^chapters\/([^/]+\.md)$/.exec(targetRel)
              if (m) snapshotChapter(novelDir, m[1], text)
            },
          })
          if (result.ok) invalidateAllCaches()
          json(res, result.ok ? 200 : 400, result)
          return
        }

        if (route === 'handoff' && req.method === 'GET') {
          // 章节交接卡（0.10.0）：把「写下一章需要的全部前提」压成一张卡，
          // 写手拿一张就能开写，不必通读五本账。只读。
          const novelDir = resolveNovelRoot(url.searchParams.get("path"), ctx.workspaceRegistry)
          const model = buildHandoff(novelDir, url.searchParams.get("file"))
          json(res, 200, { ...model, markdown: renderHandoff(model) })
          return
        }

        if (route === 'relations-autofill' && req.method === 'GET') {
          // 关系起始章补全提议（0.10.0）：以正文为唯一证据，只提议不改文件。
          const novelDir = resolveNovelRoot(url.searchParams.get("path"), ctx.workspaceRegistry)
          json(res, 200, proposeRelationStarts(novelDir))
          return
        }

        if (route === 'relations-autofill' && req.method === 'POST') {
          // 写回：逐行改 started，写前备份 .bak，写后校验仍是条目数组。
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          const result = applyRelationStarts(novelDir, body.patches)
          if (result.ok && result.applied > 0) invalidateAllCaches()
          json(res, result.ok ? 200 : 422, result)
          return
        }

        if (route === 'outline-note' && req.method === 'POST') {
          // 章纲「待补」备忘（0.11.0）：体检报章纲点名未落地时，作者一键记下。
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          const result = appendOutlineNote(novelDir, body.file, body.note)
          if (result.ok) invalidateAllCaches()
          json(res, 200, result)
          return
        }
        if (route === 'version' && req.method === 'GET') {
          // 单个历史版本正文（恢复时放回编辑器，不直接落盘）。
          const novelDir = resolveNovelRoot(url.searchParams.get('path'), ctx.workspaceRegistry)
          json(res, 200, readVersion(novelDir, url.searchParams.get('file'), url.searchParams.get('id')))
          return
        }

        if (route === 'search' && req.method === 'GET') {
          // 全书搜索（0.6.0）：chapters/ + outlines/，多词空格分隔取交集。
          const novelDir = resolveNovelRoot(url.searchParams.get('path'), ctx.workspaceRegistry)
          const all = url.searchParams.get('all') !== '0'
          json(res, 200, searchNovel(novelDir, url.searchParams.get('q'), { all, limit: Number(url.searchParams.get('limit')) || 200 }))
          return
        }

        if (route === 'replace' && req.method === 'POST') {
          // 全书替换（0.6.0）：逐章走 mutateChapterBody，冲突/失败逐文件回报，
          // 一章失败不拖累其他章；前端必须先预览确认再调这里。
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          json(res, 200, replaceInNovel(novelDir, body.find, body.replace, { file: body.file }))
          return
        }

        if (route === 'rebuild-index' && req.method === 'POST') {
          const body = await readBody(req, res)
          const novelDir = resolveNovelRoot(body.path, ctx.workspaceRegistry)
          json(res, 200, rebuildIndex(novelDir))
          return
        }

        json(res, 404, { ok: false, error: `no such route: ${req.method} /api/xiaoyu-novel/${route}` })
      } catch (err) {
        // 错误原文（可能带本机绝对路径）留日志；对外 message 先脱敏。读体的
        // 413/408 已由 readBody 先回包再断开（err.responded），这里只留日志不
        // 重复回包；其余按 statusCode 回（读体断开 499/400、业务错误自带码），
        // 裸异常 500。
        ctx.logger?.warn?.('xiaoyu-novel 创作台: 请求处理失败: ' + String(err?.message ?? err))
        if (err?.responded) return
        json(res, Number.isInteger(err?.statusCode) ? err.statusCode : 500, {
          ok: false,
          error: sanitizeWithRoots(err?.message ?? String(err)),
        })
      }
    },
  })
}

// ── 存量项目接入 ────────────────────────────────────────────────────────────

/**
 * 解析要自动接入的存量项目目录，优先级：
 *   1) 环境变量 XIAOYU_EXTRA_WORKSPACES（JSON 数组，元素为路径串或 {path,title}；也接受逗号分隔路径）；
 *   2) <home>/xiaoyu-workspaces.json（同形状数组，给不熟环境变量的用户一张配置文件）；
 *   3) 内置 EXTRA_WORKSPACES。
 * 坏 JSON / 文件缺失一律静默回退，接入流程绝不因为配置写坏而崩。
 */
export function resolveExtraWorkspaces(env = process.env, home = null) {
  const normalize = (list) => list.flatMap((item) => {
    if (typeof item === 'string' && item.trim() !== '') {
      const value = item.trim()
      return [{ path: value, title: path.basename(value) }]
    }
    if (item && typeof item.path === 'string' && item.path.trim() !== '') {
      const value = item.path.trim()
      const title = typeof item.title === 'string' && item.title.trim() !== '' ? item.title.trim() : path.basename(value)
      return [{ path: value, title }]
    }
    return []
  })
  const raw = env?.XIAOYU_EXTRA_WORKSPACES
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return normalize(parsed)
    } catch { /* 非 JSON：按逗号分隔路径处理 */ }
    return normalize(raw.split(','))
  }
  try {
    const file = path.join(home ?? resolveDshHome(), 'xiaoyu-workspaces.json')
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (Array.isArray(parsed)) return normalize(parsed)
  } catch { /* 文件不存在或坏 JSON：用内置默认 */ }
  return EXTRA_WORKSPACES.slice()
}

/**
 * 把 EXTRA_WORKSPACES 里的存量项目目录注册进工作区表。
 * 幂等：已有同路径工作区则跳过；目录不在 / 没有 novel/project.yml / 注册接口
 * 缺席都只 warn 或静默跳过，绝不影响宿主启动与创作台其余功能。
 * @returns {Promise<string[]>} 本次真正新建的工作区路径
 */
export async function ensureExtraWorkspaces(ctx = {}, { logger = console } = {}) {
  const registry = ctx?.workspaceRegistry
  if (!registry || typeof registry.create !== 'function') return []
  const created = []
  for (const extra of resolveExtraWorkspaces()) {
    try {
      if (!existsSync(path.join(extra.path, 'novel', 'project.yml'))) continue
      const known = typeof registry.resolveByPath === 'function'
        ? await Promise.resolve(registry.resolveByPath(extra.path)).catch(() => undefined)
        : undefined
      if (known) continue
      await registry.create(extra.path, extra.title)
      created.push(extra.path)
      logger.info?.(`xiaoyu-novel-installer: 已接入存量项目工作区 ${extra.path}（${extra.title}）`)
    } catch (error) {
      logger.warn?.(`xiaoyu-novel-installer: 存量项目工作区 ${extra.path} 接入失败（已跳过）: ${error?.message ?? error}`)
    }
  }
  return created
}

// ── 安装主流程 ──────────────────────────────────────────────────────────────

/**
 * 幂等安装小鱼预设。步骤彼此独立、各自可失败：
 *   1) 预设文件落盘（不依赖 yaml，任何情况都先做）；
 *   2) .installed-version 标记（内容与当前版本一致即不重写）；
 *   3) 方法论技能落盘到 <home>/skills/xiaoyu-*（不依赖 yaml，独立可失败）；
 *   4) patch 托管块（依赖 yaml；形态随宿主版本，见 composeManagedRows；写入
 *      层随环境，见 resolvePatchLayer——Android compat 壳或
 *      DSH_XIAOYU_PATCH_LAYER=profile 时写 profile 层并清 home 层遗留块；
 *      yaml 缺席、组合源坏或宿主版本探测全败时跳过并 warn，下次启动自愈）。
 * ctx.argv（可选）：层解析用的 argv 注入缝（resolveProfilePatchPath 找
 *   --profile 用），缺省 process.argv。
 * 返回 { status, home, presetDir, copied, skillsCopied, blockAction, reason,
 * shape, hostVersion, patchLayer, patchPath }，status 取 'ok'（全链路完成）|
 * 'partial'（托管块未写，原因见 reason）；shape 为本次所选委派行形态
 *（'v1' | 'v2'）；skillsCopied 为本次有复制动作的技能目录名列表；patchLayer /
 * patchPath 为托管块的目标层与目标文件（'rejected'/partial 时是「将要写」的
 * 目标，供上层诊断）。
 */
export function ensurePresetInstalled(ctx = {}) {
  const logger = ctx?.logger ?? console
  const home = resolveDshHome()
  const version = pluginVersion() ?? '0.0.0'
  const sourceDir = path.join(PLUGIN_ROOT, 'presets', PRESET_ID)
  const presetDir = path.join(home, '.agent-presets', PRESET_ID)

  // 1) 预设文件：内容一致不写（逐字节比较），变化才覆盖。copyFileSync 必须在
  //    per-file try 之内——单文件失败（如目标只读 EACCES）只 warn，不能冲出
  //    主流程把后面的版本标记/技能落盘/托管块全跳过（违背「各自可失败」；
  //    失败文件下次启动自愈重试）。
  const copied = []
  mkdirSync(presetDir, { recursive: true })
  for (const file of PRESET_FILES) {
    try {
      if (syncFileIfChanged(path.join(sourceDir, file), path.join(presetDir, file))) copied.push(file)
    } catch (err) {
      logger.warn?.(`xiaoyu-novel-installer: 预设文件 ${file} 复制失败（已跳过，不影响其余文件）: ${err?.message ?? err}`)
    }
  }

  // 2) 版本标记：一致不重写（mtime 也是产物，少动一次是一次）
  let markerCurrent = false
  try {
    markerCurrent = !writeMarkerIfChanged(presetDir, version)
  } catch (err) {
    logger.warn?.(`xiaoyu-novel-installer: .installed-version 标记写入失败（不影响预设本体）: ${err?.message ?? err}`)
  }

  // 3) 方法论技能落盘（与 yaml 无关；装不上不拖累预设，下次启动自愈）
  let skillsCopied = []
  try {
    skillsCopied = installSkills(home, { version, logger })
  } catch (err) {
    logger.warn?.(`xiaoyu-novel-installer: 技能落盘失败（已跳过，不影响预设本体）: ${err?.message ?? err}`)
  }

  // 4) patch 托管块（v1 内联形状 / v2 AgentPreset 形状，随宿主版本切换）。
  //    写入层随环境选择（resolvePatchLayer）：默认 home 层 <home>/cordis.patch
  //    .yml；Android compat 壳每次启动会把 home 层 patch 重写坏（issue #1），
  //    命中壳启发式或环境变量点名时改写 profile 层 <home>/profiles/<name>/
  //    cordis.patch.yml（壳不碰该层，每次 boot 补写自愈）。profile 目录不存在
  //    退回 home 层并 warn；home 层模式下若 profile patch 已有本插件托管块
  //   （手工搬迁 / issue 作者本地补丁残留）只 warn 可能双声明，不自动删。
  const homePatchPath = path.join(home, 'cordis.patch.yml')
  let patchLayer = resolvePatchLayer(home)
  let patchPath = homePatchPath
  let profileName = null
  if (patchLayer === 'profile') {
    const profilePatchPath = resolveProfilePatchPath(home, ctx?.argv)
    if (profilePatchPath === null) {
      logger.warn?.(
        'xiaoyu-novel-installer: 当前按 profile 层策略写托管块，但 <home>/profiles/<name>/ 目录不存在（profile 尚未创建？）——本次退回 home 层',
      )
      patchLayer = 'home'
    } else {
      patchPath = profilePatchPath
      profileName = path.basename(path.dirname(profilePatchPath))
    }
  } else {
    const profilePatchPath = resolveProfilePatchPath(home, ctx?.argv)
    if (profilePatchPath !== null) {
      let profileText = null
      try {
        profileText = readFileSync(profilePatchPath, 'utf8')
      } catch { /* profile patch 不存在/读不了都无所谓——只做残留提示 */ }
      if (profileText !== null && profileText.includes(MANAGED_BEGIN)) {
        logger.warn?.(
          `xiaoyu-novel-installer: home 层与 profile 层（${profilePatchPath}）疑似都有 dsh-xiaoyu-novel 托管块，可能双声明——请择一保留（安装器不替你删）`,
        )
      }
    }
  }
  const layerLabel = patchLayer === 'profile' ? `profile 层（${profileName}）` : 'home 层'

  const composed = composeManagedRows(home, logger)
  const { shape, hostVersion } = composed
  if (composed.rows === null) {
    logger.warn?.(
      composed.reason === 'yaml-unavailable'
        ? 'xiaoyu-novel-installer: <home>/node_modules 下找不到 yaml 包，无法解析预设组合——' +
            '预设文件已复制，但 cordis.patch.yml 声明行本次跳过，下次宿主启动自动补写'
        : composed.reason === 'version-unknown'
          ? 'xiaoyu-novel-installer: 宿主版本探测全败，无法安全判定委派行形状' +
              '（误写 v1 内联会被 0.2.1-rc.2+ 宿主拒绝、五路委派全废）——' +
              '预设文件已复制，但 cordis.patch.yml 声明行本次跳过，下次宿主启动自动补写'
          : 'xiaoyu-novel-installer: 预设组合源解析失败——预设文件已复制，但 cordis.patch.yml 声明行本次跳过，' +
              '修复后下次宿主启动自动补写（详见上方 warn）',
    )
    return {
      status: 'partial',
      home,
      presetDir,
      copied,
      skillsCopied,
      blockAction: null,
      reason: composed.reason,
      shape,
      hostVersion,
      patchLayer,
      patchPath,
    }
  }

  const blockText = stringifyManagedBlock(composed.yaml, composed.rows)
  if (patchLayer === 'profile') {
    // 升级清理：home 层遗留托管块整段删除，防 home+profile 双声明（宿主对两
    // 层都挂 HMR，重复声明的实际后果是预设重复注册）。尽力而为——失败只
    // warn，不挡本次 profile 层写入。
    try {
      if (removeManagedBlockFromHome(home, { logger }) === 'removed') {
        logger.info?.('xiaoyu-novel-installer: 已清理 home 层遗留托管块（声明迁移到 profile 层）')
      }
    } catch (err) {
      logger.warn?.(`xiaoyu-novel-installer: home 层遗留托管块清理失败（不影响本次 profile 层写入）: ${err?.message ?? err}`)
    }
  }
  const blockAction = upsertManagedBlock(home, blockText, {
    versionMarkerCurrent: markerCurrent,
    logger,
    patchPath,
    yaml: composed.yaml,
    presetName: composed.presetName,
  })

  if (copied.length > 0) {
    logger.info?.(`xiaoyu-novel-installer: 预设文件已更新 ${PRESET_ID}: ${copied.join(', ')}`)
  }
  if (skillsCopied.length > 0) {
    logger.info?.(`xiaoyu-novel-installer: 方法论技能已落盘 <home>/skills: ${skillsCopied.join(', ')}`)
  }
  if (blockAction === 'skipped') {
    logger.info?.(`xiaoyu-novel-installer: 预设 ${PRESET_ID} 已就绪（v${version}，声明行与文件均无变化，托管块位于 ${layerLabel}）`)
  } else if (blockAction === 'updated') {
    logger.info?.(`xiaoyu-novel-installer: 托管块已按 v${version} 重写（${layerLabel}: ${patchPath}）`)
  } else if (blockAction === 'created') {
    logger.info?.(`xiaoyu-novel-installer: 托管块已写入 ${layerLabel}（v${version}）`)
  }
  // blockAction === 'rejected'：写盘前 YAML 自检未过，upsertManagedBlock 已带
  // 文件路径与解析错误 warn 过——这里不重复刷屏，动作经返回值透出，不抛。
  const listAgentsNote = shape === 'v2' && hostMergedSubagentListAgents(hostVersion)
    ? '，list-agents 行已按 0.2.2+ 并入形状剥离（issue #7）'
    : ''
  logger.info?.(
    shape === 'v2'
      ? `xiaoyu-novel-installer: 委派行形状 v2（AgentPreset，宿主 DSH ${hostVersion ?? '版本未知'}${listAgentsNote}）`
      : `xiaoyu-novel-installer: 委派行形状 v1（内联 persona/toolFilter，宿主 DSH ${hostVersion ?? '版本未知'}）`,
  )
  return { status: 'ok', home, presetDir, copied, skillsCopied, blockAction, reason: null, shape, hostVersion, patchLayer, patchPath }
}

/**
 * cordis 插件入口。任何失败只 warn 不抛——安装器绝不能弄死宿主启动。
 * @param {{ logger?: object, effect?: Function }} ctx - cordis context
 * @param {object} _config - 预留（一期无配置键）
 */
export function apply(ctx = {}, _config = {}) {
  const logger = ctx?.logger ?? console
  // 启动顺带清扫上次崩溃可能残留的托管块临时件（见 sweepStaleManagedBlockTmp；
  // 自吞错、只认本插件命名前缀且 mtime>1h，绝不影响启动）。
  try {
    sweepStaleManagedBlockTmp(resolveDshHome())
  } catch {
    /* 防御性兜底：函数本身不抛，这里再兜一层 */
  }
  try {
    ensurePresetInstalled({ logger })
  } catch (error) {
    logger.warn?.(`xiaoyu-novel-installer: 预设安装失败（已跳过，不影响宿主启动）: ${error?.message ?? error}`)
  }

  // 注：0.2.1-rc.2+ 的内联委派行守卫已由 v2 AgentPreset 形态适配（composeManagedRows
  // 按宿主版本自动选形状，所选形态带在安装日志里），不再需要降级提示。

  // 路由 disposer 挂接宿主生命周期（0.1.23，修「inactive context」面板瘫）：
  // 宿主 dsh CLI 的 runProfile 对 <home>/cordis.patch.yml 与 profile 级
  // cordis.patch.yml 都挂了 HMR 热重载（dsh-app-boot watchUserPatches），本插件
  // 安装器恰会在版本变化时重写 home patch 托管块——插件纤维随即被整树重建。
  // 若 disposer 不挂 ctx.effect，旧纤维销毁后 /api/xiaoyu-novel 路由残留在
  // webServer 表里（handler 闭包攥着死 ctx），新纤维 apply 又被 duplicate
  // prefix route 挡住，面板请求全落死 handler，报
  // `cannot get required service "workspaceRegistry" in inactive context`。
  // 挂接语义：ctx.effect 可用则挂（纤维销毁时 cordis 自动注销路由）；注册
  // 完成时纤维已销毁（effect 抛 INACTIVE_EFFECT 等）则立即手动注销，堵住
  // 「注册与销毁竞态」的残留窗口；宿主连 effect/on 都不提供时只 warn 提示
  // 路由可能残留（不主动注销——此时纤维活着，路由该留）。注销本身自吞错：
  // 卸载路径的失败不能炸宿主。
  const wireRouteDisposal = (dispose) => {
    const removeRoute = () => {
      try { dispose() } catch { /* 卸载路径绝不抛 */ }
    }
    try {
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => removeRoute)
        return
      }
      if (typeof ctx.on === 'function') {
        ctx.on('dispose', removeRoute)
        return
      }
    } catch {
      // 注册完成时纤维已销毁（cordis effect 对 inactive context 抛
      // INACTIVE_EFFECT）：路由立即手动注销，不留残留。
      removeRoute()
      return
    }
    logger.warn?.('xiaoyu-novel-installer: 宿主 ctx 无 effect/on 生命周期接口，创作台路由在插件卸载后可能残留')
  }

  // 创作台路由（三期）：与安装段彼此独立——注册失败只 warn，面板不可用不
  // 拖累安装器语义。registerCreatorRoutes 是 async 函数，同步阶段不可能 throw
  //（异常一律进 rejected promise），外层 try 对它是永假防御——只挂 .catch
  // 一条兜底通道即可，异常不会冒出 apply。
  // 存量项目接入（旧毛颖创作台时期的目录）：只补工作区登记，不动任何数据文件；
  // 失败只 warn，面板与预设不受影响。
  ensureExtraWorkspaces(ctx, { logger }).catch((error) => {
    logger.warn?.(`xiaoyu-novel-installer: 存量项目接入失败（已跳过，可在面板里手动添加工作区）: ${error?.message ?? error}`)
  })

  registerCreatorRoutes(ctx).then(wireRouteDisposal, (error) => {
    logger.warn?.(`小鱼创作台路由注册失败（面板不可用，其余功能不受影响）: ${error?.message ?? error}`)
  })
}
