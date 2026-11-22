#!/usr/bin/env node
/**
 * 打包脚本（pack）——把整个插件打成**一个可分发的离线包**，一个字节都不漏。
 *
 * 为什么要有它：DSH 的插件不是「插件目录里那几个文件」就算完——装饰在别处的
 * 东西一样会丢：技能包、预设源文件、模板、CLI、文档、CI 配置、图标、LICENSE。
 * 手工 zip 一定会漏，漏了的表现就是用户装完「面板在，但写手点不到方法论」「预设
 * 里没有小鱼」。所以把清单写死成代码，逐条核，缺一个就报错不打包。
 *
 * 零依赖：zip 用 node:zlib 的 deflateRaw 自己写（本地文件头 + 中央目录 + EOCD），
 * 不引任何 npm 包——和插件本身一样，装到哪台机器都能跑。
 *
 * 用法：
 *   node scripts/pack.mjs                          # 输出 dist/dsh-xiaoyu-novel-<版本>.zip
 *   node scripts/pack.mjs --out ~/Download         # 指定输出目录
 *   node scripts/pack.mjs --tar                    # 同时生成 .tar.gz（Linux 侧安装用）
 *   node scripts/pack.mjs --list                   # 只列会打进去的文件，不写盘
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync, gzipSync } from 'node:zlib'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 必打清单：目录以 / 结尾表示递归整目录，其余是单文件。
 * 缺任何一项都直接失败——发行包不许「大概齐」。
 */
const MUST_INCLUDE = [
  'package.json',
  '.gitignore',
  'index.mjs',
  'cordis.patch.yml',
  'icon.svg',
  'LICENSE',
  'README.md',
  'README.en.md',
  'INSTALL.md',
  'bin/',
  'lib/',
  'presets/',
  'skills/',
  'templates/',
  'docs/',
  'scripts/',
  'test/',
  '.github/',
]

/** 一律不打包（构建产物、垃圾、本机状态）。 */
const SKIP_NAMES = new Set(['node_modules', '.git', '__pycache__', '.DS_Store', 'dist', '.cache'])
const SKIP_EXT = ['.pyc', '.bac', '.orig', '.rej']
/** 明确排除的后缀（.bak 之类是本机残留，不该进发行包）。 */
const SKIP_SUFFIX = ['.bak', '.tmp', '.swp']

/** 递归收集某条清单项下的全部文件，返回相对 ROOT 的 posix 路径。 */
function collect(entry, out) {
  const abs = path.join(ROOT, entry)
  if (!existsSync(abs)) throw new Error('必打清单项不存在：' + entry)
  const st = statSync(abs)
  if (st.isFile()) {
    out.push(entry.split(path.sep).join('/'))
    return
  }
  const walk = (dir) => {
    for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (SKIP_NAMES.has(item.name)) continue
      const full = path.join(dir, item.name)
      if (item.isSymbolicLink()) continue
      if (item.isDirectory()) {
        walk(full)
        continue
      }
      if (!item.isFile()) continue
      if (SKIP_SUFFIX.some((suffix) => item.name.endsWith(suffix))) continue
      if (SKIP_EXT.some((ext) => item.name.endsWith(ext))) continue
      out.push(path.relative(ROOT, full).split(path.sep).join('/'))
    }
  }
  walk(abs)
}

/** 收集全部待打包文件（去重、排序）。 */
export function collectFiles() {
  const out = []
  for (const entry of MUST_INCLUDE) collect(entry, out)
  return [...new Set(out)].sort()
}

// ── 最小 zip 写入器（store + deflate，UTF-8 文件名，无 zip64）────────────────

/** CRC32（zip 需要；node:zlib 不直接给）。 */
function crc32(buffer) {
  let table = crc32.table
  if (table === undefined) {
    table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
    crc32.table = table
  }
  let crc = -1
  for (let i = 0; i < buffer.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buffer[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

/** DOS 时间戳（zip 传统字段；1980 年下限）。 */
function dosTime(date) {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

/**
 * 把 [{name, data}] 打成 zip Buffer。
 * @param {Array<{name:string,data:Buffer}>} entries
 */
export function buildZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const data = entry.data
    const deflated = deflateRawSync(data, { level: 9 })
    // 压不小就别压（对已压缩内容如 png/zip 有效）
    const useDeflate = deflated.length < data.length
    const payload = useDeflate ? deflated : data
    const method = useDeflate ? 8 : 0
    const crc = crc32(data)
    const stamp = dosTime(new Date())

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 名称
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(stamp.time, 10)
    local.writeUInt16LE(stamp.date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBytes, payload)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(stamp.time, 12)
    central.writeUInt16LE(stamp.date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk
    central.writeUInt16LE(0, 36) // internal attrs
    // 外部属性：可执行脚本 0755，其余 0644（高 16 位）
    const isExecutable = /(^|\/)bin\/.*\.mjs$/.test(entry.name) || /\.sh$/.test(entry.name)
    central.writeUInt32LE(((isExecutable ? 0o100755 : 0o100644) << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBytes)

    offset += local.length + nameBytes.length + payload.length
  }
  const centralBuffer = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuffer.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, centralBuffer, eocd])
}

// ── tar.gz（Linux 侧安装用；与 portable.mjs 的 ustar 同款）──────────────────

function tarHeader(name, size, mtime, mode) {
  const header = Buffer.alloc(512, 0)
  let prefix = ''
  let base = name
  if (Buffer.byteLength(name) > 100) {
    for (let i = name.length - 1; i > 0; i--) {
      if (name[i] === '/' && Buffer.byteLength(name.slice(0, i)) <= 155 && Buffer.byteLength(name.slice(i + 1)) <= 100) {
        prefix = name.slice(0, i)
        base = name.slice(i + 1)
        break
      }
    }
  }
  header.write(base, 0, 100, 'utf8')
  header.write(mode.toString(8).padStart(7, '0'), 100, 8, 'ascii')
  header.write('0000000', 108, 8, 'ascii')
  header.write('0000000', 116, 8, 'ascii')
  header.write(size.toString(8).padStart(11, '0'), 124, 12, 'ascii')
  header.write(Math.floor(mtime / 1000).toString(8).padStart(11, '0'), 136, 12, 'ascii')
  header.write('        ', 148, 8, 'ascii')
  header.write('0', 156, 1, 'ascii')
  header.write('ustar', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  header.write(prefix, 345, 155, 'utf8')
  let sum = 0
  for (const byte of header) sum += byte
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
  return header
}

/** 把 [{name, data, mtime}] 打成 tar.gz。 */
export function buildTarGz(entries) {
  const parts = []
  for (const entry of entries) {
    const { mtime = Date.now(), data } = entry
    parts.push(tarHeader(entry.name, data.length, mtime, 0o644))
    parts.push(data)
    const pad = data.length % 512
    if (pad !== 0) parts.push(Buffer.alloc(512 - pad, 0))
  }
  parts.push(Buffer.alloc(1024, 0))
  return gzipSync(Buffer.concat(parts), { level: 9 })
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function main(argv) {
  let outDir = path.join(ROOT, 'dist')
  let withTar = false
  let listOnly = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--out') {
      outDir = path.resolve(argv[++i] ?? outDir)
      continue
    }
    if (arg.startsWith('--out=')) {
      outDir = path.resolve(arg.slice('--out='.length))
      continue
    }
    if (arg === '--tar') {
      withTar = true
      continue
    }
    if (arg === '--list') {
      listOnly = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      console.log('用法：node scripts/pack.mjs [--out <目录>] [--tar] [--list]')
      return
    }
    console.error('未知选项：' + arg)
    process.exit(1)
  }

  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const files = collectFiles()

  if (listOnly) {
    console.log('会打包 ' + files.length + ' 个文件（' + pkg.name + '@' + pkg.version + '）：')
    for (const file of files) console.log('  ' + file)
    return
  }

  const entries = files.map((name) => ({ name, data: readFileSync(path.join(ROOT, name)), mtime: statSync(path.join(ROOT, name)).mtimeMs }))
  // 顶层目录名 = 包名，解开就是 dsh-xiaoyu-novel/（dsha-plugin import 认这个结构）
  const prefixed = entries.map((entry) => ({ ...entry, name: pkg.name + '/' + entry.name }))
  const zip = buildZip(prefixed)

  mkdirSync(outDir, { recursive: true })
  const zipPath = path.join(outDir, pkg.name + '-' + pkg.version + '.zip')
  writeFileSync(zipPath, zip)
  const sha256 = createHash('sha256').update(zip).digest('hex')
  writeFileSync(zipPath + '.sha256', sha256 + '  ' + path.basename(zipPath) + '\n')

  console.log('插件包：' + zipPath)
  console.log('  版本 ' + pkg.version + ' / 文件 ' + prefixed.length + ' 个 / ' + (zip.length / 1024).toFixed(1) + ' KB')
  console.log('  sha256 ' + sha256.slice(0, 16) + '…')
  console.log('  校验文件：' + zipPath + '.sha256')

  if (withTar) {
    const tar = buildTarGz(prefixed)
    const tarPath = path.join(outDir, pkg.name + '-' + pkg.version + '.tar.gz')
    writeFileSync(tarPath, tar)
    console.log('  tar.gz：' + tarPath + '（' + (tar.length / 1024).toFixed(1) + ' KB）')
  }

  console.log('')
  console.log('安装：dsha-plugin import <上面的 zip>，然后重启 DSH Web。')
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
