/**
 * 跨设备搬迁内核（portable）——把「这台机器上的 DSH 长什么样」打成**一个文件**，
 * 换手机/换电脑解开即还原。
 *
 * 为什么需要它：DSH 的个性全在 <home> 里散着——profile patch（模型渠道、主题、
 * 默认预设）、home patch（小鱼预设那一整块托管行）、.agent-presets（预设源文件）、
 * skills（方法论技能包）、storages/workspace.json（工作区列表）、.credentials.yaml
 * （渠道 key）。搬设备时少拷一个，表现就是「助手名字变了」「面板打不开」「技能没了」
 * ——用户只会看到「好多东西都用不了」，根因永远是漏件。所以这里按清单整包，不靠记忆。
 *
 * 零依赖：tar 用 512 字节 ustar 头自己写，压缩只用 node:zlib 的 gzip。
 * 不打包 node_modules（几百 MB，且按平台不同），只打包 package.json 里的依赖清单，
 * 还原时用 pnpm 重装——这是唯一跨平台安全的做法。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'

/** 打包格式版本（清单里落盘，还原时校验，格式变了宁可报错也不半还原）。 */
export const PORTABLE_FORMAT = 1

/** 包内清单文件名。 */
export const MANIFEST_NAME = 'xiaoyu-portable.json'

/** 一律不打包的目录名（重建成本低或跨平台不可移植）。 */
const SKIP_DIRS = new Set(['node_modules', '.git', '.pnpm', '__pycache__', 'cache', 'sessions', 'attachments', 'token-optimizer'])

/** 打包项：绝对路径 → 包内相对路径。relative 为 null 表示整目录递归。 */
function addFile(items, abs, rel) {
  if (!existsSync(abs)) return
  const st = statSync(abs)
  if (!st.isFile()) return
  items.push({ abs, rel: rel.split(path.sep).join('/'), size: st.size, mtime: st.mtime })
}

/** 递归收一个目录（跳过 SKIP_DIRS 与符号链接，避免把别人的盘带进来）。 */
function addTree(items, absDir, relDir) {
  if (!existsSync(absDir)) return
  let entries
  try {
    entries = readdirSync(absDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP_DIRS.has(entry.name)) continue
    const abs = path.join(absDir, entry.name)
    const rel = relDir === '' ? entry.name : relDir + '/' + entry.name
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) addTree(items, abs, rel)
    else if (entry.isFile()) addFile(items, abs, rel)
  }
}

/** 读 profile 的 package.json，取需要在新机器重装的依赖清单。 */
function readProfilePackages(home, profile) {
  const file = path.join(home, 'profiles', profile, 'package.json')
  if (!existsSync(file)) return { dependencies: {}, bundles: [] }
  let pkg
  try {
    pkg = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return { dependencies: {}, bundles: [] }
  }
  const dependencies = {}
  for (const [name, spec] of Object.entries(pkg.dependencies ?? {})) {
    // link: 是本地路径依赖，新机器上路径必然不同——只记包名，还原时用 dsh plugin add <name>
    dependencies[name] = String(spec).startsWith('link:') ? { name, link: true } : { name, spec: String(spec) }
  }
  const bundles = Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles.slice() : []
  return { dependencies, bundles }
}

/**
 * 收集需要搬迁的文件。
 *
 * @param {object} options
 * @param {string} options.home DSH home（DSH_HOME 或 ~/.dsh）
 * @param {string} [options.profile='web'] 要打包的 profile 名
 * @param {boolean} [options.secrets=true] 是否打包 .credentials.yaml（渠道 key）
 * @returns {{items:Array, manifest:object}} 待打包文件与清单
 */
export function collectPortable(options) {
  const home = path.resolve(options.home)
  const profile = options.profile ?? 'web'
  const secrets = options.secrets !== false
  const items = []

  // ① home 层 patch：小鱼预设的托管块在这里，缺了面板和六个帮手全消失
  addFile(items, path.join(home, 'cordis.patch.yml'), 'home/cordis.patch.yml')
  // ② profile 层 patch：模型渠道、主题、默认预设、ui-settings 开关
  addFile(items, path.join(home, 'profiles', profile, 'cordis.patch.yml'), 'home/profiles/' + profile + '/cordis.patch.yml')
  addFile(items, path.join(home, 'profiles', profile, 'cordis.yml'), 'home/profiles/' + profile + '/cordis.yml')
  // ③ 预设源文件
  addTree(items, path.join(home, '.agent-presets'), 'home/.agent-presets')
  // ④ 方法论技能包
  addTree(items, path.join(home, 'skills'), 'home/skills')
  // ⑤ 工作区列表（路径可能不同，还原时逐条校验）
  addFile(items, path.join(home, 'storages', 'workspace.json'), 'home/storages/workspace.json')
  // ⑥ 渠道 key
  if (secrets) addFile(items, path.join(home, '.credentials.yaml'), 'home/.credentials.yaml')
  // ⑦ 插件自带状态（破甲规则/额度、免费模型渠道、渠道包账号）
  addTree(items, path.join(home, 'xiaoyu-armor'), 'home/xiaoyu-armor')
  addTree(items, path.join(home, 'our-free-model'), 'home/our-free-model')
  addTree(items, path.join(home, 'channel-pack'), 'home/channel-pack')
  addTree(items, path.join(home, 'plugin-src'), 'home/plugin-src')

  const { dependencies, bundles } = readProfilePackages(home, profile)
  const manifest = {
    format: PORTABLE_FORMAT,
    kind: 'xiaoyu-dsh-portable',
    createdAt: new Date().toISOString(),
    dshHome: home,
    profile,
    secrets,
    sourceVersion: readDshVersion(home),
    dependencies,
    bundles,
    // 还原顺序：先装包 → 再写 patch → 最后重启。清单里写死，免得漏步。
    restoreSteps: [
      '1. dsh plugin 安装清单 dependencies 里的每个包（link: 项用源码目录重装）',
      '2. 把 home/ 下所有文件覆盖到新机器的 DSH_HOME',
      '3. 重启 DSH（dsh web），检查「设置 → Agent 预设」里有「小鱼创作」',
    ],
  }
  return { items, manifest }
}

/** 读宿主 DSH 版本（装到 profile 里那份，不是全局 CLI）。 */
function readDshVersion(home) {
  for (const candidate of [path.join(home, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), path.join(home, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh', 'package.json')]) {
    try {
      return JSON.parse(readFileSync(candidate, 'utf8')).version ?? null
    } catch {
      /* 继续找下一个 */
    }
  }
  return null
}

/** 写一个 ustar 头（512 字节，全部字段 ASCII，路径超 100 字节走 prefix 拆分）。 */
function tarHeader(name, size, mtime, mode = 0o644) {
  const header = Buffer.alloc(512, 0)
  let prefix = ''
  let base = name
  if (Buffer.byteLength(name) > 100) {
    // ustar 允许 155 字节 prefix + 100 字节 name；在最后一个能切开的分隔符处拆
    let cut = -1
    for (let i = name.length - 1; i > 0; i--) {
      if (name[i] === '/' && Buffer.byteLength(name.slice(0, i)) <= 155 && Buffer.byteLength(name.slice(i + 1)) <= 100) {
        cut = i
        break
      }
    }
    if (cut === -1) throw new Error('打包路径过长且无法拆分：' + name)
    prefix = name.slice(0, cut)
    base = name.slice(cut + 1)
  }
  header.write(base, 0, 100, 'utf8')
  header.write(mode.toString(8).padStart(7, '0'), 100, 8, 'ascii')
  header.write('0000000', 108, 8, 'ascii') // uid
  header.write('0000000', 116, 8, 'ascii') // gid
  header.write(size.toString(8).padStart(11, '0'), 124, 12, 'ascii')
  header.write(Math.floor(mtime / 1000).toString(8).padStart(11, '0'), 136, 12, 'ascii')
  header.write('        ', 148, 8, 'ascii') // checksum 占位（8 空格）
  header.write('0', 156, 1, 'ascii') // 普通文件
  header.write('ustar', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  header.write(prefix, 345, 155, 'utf8')
  let sum = 0
  for (const byte of header) sum += byte
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
  return header
}

/** 把若干 {name, mtime, data} 打成 ustar 流（每文件补 512 对齐 + 结尾两个空块）。 */
export function buildTar(entries) {
  const parts = []
  for (const entry of entries) {
    parts.push(tarHeader(entry.name, entry.data.length, entry.mtime ?? Date.now()))
    parts.push(entry.data)
    const pad = entry.data.length % 512
    if (pad !== 0) parts.push(Buffer.alloc(512 - pad, 0))
  }
  parts.push(Buffer.alloc(1024, 0))
  return Buffer.concat(parts)
}

/** 解析 ustar 流，返回到 {name → Buffer}。只认普通文件，目录/链接自动跳过。 */
export function parseTar(buffer) {
  const out = []
  let offset = 0
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break // 结束块
    const read = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '').trim()
    const base = read(0, 100)
    const prefix = read(345, 155)
    const name = prefix === '' ? base : prefix + '/' + base
    const size = parseInt(read(124, 12), 8) || 0
    const mtime = (parseInt(read(136, 12), 8) || 0) * 1000
    const typeflag = header.subarray(156, 157).toString('ascii')
    offset += 512
    const data = buffer.subarray(offset, offset + size)
    offset += Math.ceil(size / 512) * 512
    if (typeflag === '0' || typeflag === '\0' || typeflag === '') out.push({ name, data, mtime })
  }
  return out
}

/**
 * 打包成单个 .tar.gz 文件（返回清单与统计，不打印）。
 *
 * @param {object} options collectPortable 的参数 + {out} 输出文件路径
 * @returns {{out:string, files:number, bytes:number, manifest:object}}
 */
export function exportPortable(options) {
  const { items, manifest } = collectPortable(options)
  const out = path.resolve(options.out)
  const entries = items.map((item) => ({ name: item.rel, data: readFileSync(item.abs), mtime: item.mtime.getTime() }))
  entries.push({ name: MANIFEST_NAME, data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), mtime: Date.now() })
  const tar = buildTar(entries)
  const gz = gzipSync(tar, { level: 9 })
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, gz)
  return { out, files: entries.length, bytes: gz.length, manifest }
}

/** 读包：解压 + 解 tar + 分离清单。损坏抛中文错误。 */
export function readPortable(file) {
  const abs = path.resolve(file)
  if (!existsSync(abs)) throw new Error('找不到搬迁包：' + abs)
  let tar
  try {
    tar = gunzipSync(readFileSync(abs))
  } catch (error) {
    throw new Error('搬迁包解压失败（不是 .tar.gz，或文件损坏）：' + String(error.message ?? error))
  }
  const entries = parseTar(tar)
  if (entries.length === 0) throw new Error('搬迁包里没有任何文件：' + abs)
  const manifestEntry = entries.find((entry) => entry.name === MANIFEST_NAME)
  if (manifestEntry === undefined) throw new Error('搬迁包缺少清单 ' + MANIFEST_NAME + '，不是本 CLI 生成的包')
  let manifest
  try {
    manifest = JSON.parse(manifestEntry.data.toString('utf8'))
  } catch (error) {
    throw new Error('搬迁包清单解析失败：' + String(error.message ?? error))
  }
  if (manifest.kind !== 'xiaoyu-dsh-portable') throw new Error('搬迁包类型不符：' + String(manifest.kind))
  if (manifest.format !== PORTABLE_FORMAT) {
    throw new Error('搬迁包格式版本 ' + String(manifest.format) + ' 与当前 ' + PORTABLE_FORMAT + ' 不一致，请用同版本或更新的 xiaoyu-novel 还原')
  }
  return { manifest, entries: entries.filter((entry) => entry.name !== MANIFEST_NAME) }
}

/** 目标文件已存在时的处理：备份（带时间戳），不静默覆盖。 */
function backupExisting(abs) {
  if (!existsSync(abs)) return null
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const backup = abs + '.bak-portable-' + stamp
  writeFileSync(backup, readFileSync(abs))
  return backup
}

/** 包内相对路径 → 落地绝对路径（home/ 前缀映射到目标 DSH home，防目录穿越）。 */
export function resolveTarget(targetHome, name) {
  const normalized = name.split('/').filter((part) => part !== '' && part !== '.').join('/')
  if (normalized.split('/').includes('..')) throw new Error('搬迁包含非法路径（目录穿越）：' + name)
  if (!normalized.startsWith('home/')) throw new Error('搬迁包含未知根目录（应全部在 home/ 下）：' + name)
  return path.join(targetHome, normalized.slice('home/'.length))
}

/**
 * 还原到目标机器。
 *
 * @param {object} options
 * @param {string} options.file 搬迁包路径
 * @param {string} options.home 目标 DSH home
 * @param {boolean} [options.dryRun=false] 只报会改哪些文件，不写盘
 * @param {(abs:string)=>boolean} [options.filter] 逐文件过滤（如跳过 workspace.json）
 * @returns {{written:Array<{file:string, backup:string|null}>, skipped:Array<string>, manifest:object}}
 */
export function importPortable(options) {
  const { manifest, entries } = readPortable(options.file)
  const home = path.resolve(options.home)
  const dryRun = options.dryRun === true
  const written = []
  const skipped = []
  for (const entry of entries) {
    const target = resolveTarget(home, entry.name)
    if (typeof options.filter === 'function' && !options.filter(target)) {
      skipped.push(target)
      continue
    }
    if (dryRun) {
      written.push({ file: target, backup: null })
      continue
    }
    mkdirSync(path.dirname(target), { recursive: true })
    const backup = backupExisting(target)
    writeFileSync(target, entry.data)
    written.push({ file: target, backup })
  }
  return { written, skipped, manifest }
}

/** 人读的还原指引（命令清单，直接可粘）。 */
export function restoreHint(manifest, home = '<DSH_HOME>') {
  const lines = []
  lines.push('搬迁包来自：' + manifest.dshHome + '（profile ' + manifest.profile + '，' + (manifest.sourceVersion ?? '版本未知') + '）')
  lines.push('')
  lines.push('还原三步：')
  lines.push('① 装插件（新机器上没有这些包，缺一个面板就少一块）：')
  const names = Object.values(manifest.dependencies ?? {})
  const linked = names.filter((item) => item.link).map((item) => item.name)
  const pinned = names.filter((item) => !item.link).map((item) => item.name + '@' + item.spec)
  if (pinned.length > 0) lines.push('   dsh plugin --profile ' + manifest.profile + ' add ' + pinned.join(' '))
  if (linked.length > 0) lines.push('   本地源码包（需先把源码拷到新机器）：' + linked.join(', '))
  lines.push('② 覆盖配置：')
  lines.push('   xiaoyu-novel portable import <包> --home ' + home + ' --profile ' + manifest.profile)
  lines.push('③ 重启 DSH，打开「设置 → Agent 预设」确认「小鱼创作 (Xiaoyu)」在列；没有就说明①漏了包。')
  return lines.join('\n')
}
