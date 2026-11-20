/**
 * 体检内核（doctor）——把「换设备后助手名字变了、面板打不开、新建对话不是小鱼」
 * 这三类症状对应的**具体配置事实**逐条查出来，而不是让用户猜。
 *
 * 为什么单列一个模块：这三条全是「配置在、但值不对」的静默故障——插件装好了、
 * 面板也在，只是默认预设被别人抢走、预设切换器被藏起来、或者必备的预设源文件
 * 没落地。只靠日志查不出来，只能把判定写成代码。
 *
 * 纯函数：只读文本、返回结构化结论；写面（--fix）由 CLI 负责，便于测试。
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/** 预设源文件清单（缺任何一个，预设声明行都挂不上，整套帮手消失）。 */
export const PRESET_FILES = ['preset.yml', 'agent.cordis.yml', 'restrict.mjs', 'delegation-labels.mjs', 'guard.mjs']

/** 方法论技能目录清单（缺了不影响开面板，但派活时点不到方法论）。 */
export const SKILL_NAMES = [
  'xiaoyu-golden-opening',
  'xiaoyu-beat-pacing',
  'xiaoyu-review-checklist',
  'xiaoyu-foreshadow-discipline',
  'xiaoyu-suspense-craft',
  'xiaoyu-volume-craft',
  'xiaoyu-qu-ai-wei',
  'xiaoyu-book-setup',
]

/** 托管块起始标记（与 index.mjs 的 MANAGED_BEGIN 同字面量）。 */
export const MANAGED_BEGIN = '# --- dsh-xiaoyu-novel preset managed (auto-generated; do not edit) ---'

/**
 * 从 patch 文本里截出某个 `- id: <id>` 条目的文本块（到下一个顶层 `- id:` 或文件尾）。
 * 找不到返回 null。纯文本扫描——patch 是 YAML，但这里只需要「这一条里写了什么」。
 */
export function patchEntryText(text, id) {
  const lines = String(text ?? '').split(/\r?\n/)
  const start = lines.findIndex((line) => line.trimEnd() === '- id: ' + id)
  if (start === -1) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const trimmed = lines[i].trimStart()
    if (trimmed.startsWith('- id: ') && lines[i].startsWith('- ')) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

/** 从条目文本里读一个标量键（只认 `key: value`，去引号）。 */
export function scalarOf(entryText, key) {
  if (entryText === null) return null
  for (const line of entryText.split('\n')) {
    const trimmed = line.trimStart()
    if (!trimmed.startsWith(key + ':')) continue
    const rest = trimmed.slice(key.length + 1).trim()
    if (rest === '') return ''
    return rest.replace(/^["']/, '').replace(/["']$/, '').trim()
  }
  return null
}

/** 读文件文本，读不到返回 null（体检不该因为缺文件抛错）。 */
function readTextOrNull(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/**
 * 体检。返回 { ok, errors, warns, checks }。
 *
 * level：error（不修就不能用）/ warn（能用但会让人误判「坏了」）/ ok。
 *
 * @param {object} options
 * @param {string} options.home DSH home
 * @param {string} [options.profile='web'] profile 名
 */
export function diagnose(options) {
  const home = path.resolve(options.home)
  const profile = options.profile ?? 'web'
  const checks = []
  const push = (id, level, title, detail, fix) => checks.push({ id, level, title, detail, ...(fix === undefined ? {} : { fix }) })

  // ① 预设源文件
  const presetDir = path.join(home, '.agent-presets', 'xiaoyu-novel')
  const missingPreset = PRESET_FILES.filter((name) => !existsSync(path.join(presetDir, name)))
  if (missingPreset.length === 0) push('preset-files', 'ok', '预设源文件齐全', presetDir)
  else {
    push(
      'preset-files',
      'error',
      '预设源文件缺失——「小鱼创作」预设挂不上，面板与六个帮手会一起消失',
      '缺：' + missingPreset.join('、') + '（目录 ' + presetDir + '）',
      '重启 DSH 让插件重新安装预设（安装器每次启动会核对并补拷）',
    )
  }

  // ② home 层 patch 的托管块
  const homePatchPath = path.join(home, 'cordis.patch.yml')
  const homePatch = readTextOrNull(homePatchPath)
  if (homePatch === null) {
    push('home-patch', 'error', 'home 层 patch 不存在——预设声明行没了', homePatchPath, '重启 DSH 让插件写入托管块')
  } else if (!homePatch.includes(MANAGED_BEGIN)) {
    push('home-patch', 'error', 'home 层 patch 里没有本插件的托管块——预设声明行没了', homePatchPath, '重启 DSH 让插件写入托管块')
  } else {
    let rows = 0
    for (const line of homePatch.split('\n')) if (line.trimStart().startsWith('- id: preset-xiaoyu-novel')) rows += 1
    push('home-patch', 'ok', 'home 层 patch 托管块在（preset 声明行 ' + rows + ' 条）', homePatchPath)
  }

  // ③ profile 层 patch：默认预设被 dsh-ops 抢走 / 预设切换器被藏
  const profilePatchPath = path.join(home, 'profiles', profile, 'cordis.patch.yml')
  const profilePatch = readTextOrNull(profilePatchPath)
  if (profilePatch === null) {
    push('profile-patch', 'warn', 'profile 层 patch 不存在（模型渠道/主题/默认预设都在这里）', profilePatchPath, '从搬迁包还原，或手动新建')
  } else {
    const registryEntry = patchEntryText(profilePatch, 'agent-preset-registry')
    const selectedDefault = scalarOf(registryEntry, 'selectedDefault')
    if (selectedDefault === 'xiaoyu-novel') {
      push('default-preset', 'ok', '新会话默认预设 = xiaoyu-novel', profilePatchPath)
    } else if (selectedDefault === 'ops-ptc') {
      push(
        'default-preset',
        'warn',
        '新会话默认预设被 dsh-ops 抢成 ops-ptc——新建对话出来的不是小鱼',
        'agent-preset-registry.selectedDefault = ops-ptc',
        '把 selectedDefault 改成 xiaoyu-novel，并关掉 dsh-ops 的 global.forceDefaultOpsPtc（xiaoyu-novel doctor --fix）',
      )
    } else {
      push('default-preset', 'warn', '新会话默认预设不是 xiaoyu-novel', 'agent-preset-registry.selectedDefault = ' + String(selectedDefault), 'xiaoyu-novel doctor --fix')
    }

    const uiSettingsEntry = patchEntryText(profilePatch, 'ui-settings')
    const uiEnabled = scalarOf(uiSettingsEntry, 'enabled')
    if (uiEnabled === 'false') {
      push(
        'ui-settings',
        'warn',
        '预设切换器被藏起来了（ui-settings.enabled = false）',
        '「显示代码工作视图 / 完整 Agent 预设切换」不可见，换不了预设',
        'xiaoyu-novel doctor --fix（改成 true）',
      )
    } else {
      push('ui-settings', 'ok', '预设切换器可见（ui-settings.enabled 未关闭）', profilePatchPath)
    }

    const opsEntry = patchEntryText(profilePatch, 'dsh-ops')
    const forced = scalarOf(opsEntry, 'forceDefaultOpsPtc')
    if (forced === 'false') push('ops-force', 'ok', 'dsh-ops 不再抢默认预设（forceDefaultOpsPtc = false）', profilePatchPath)
    else if (forced === 'true') push('ops-force', 'warn', 'dsh-ops 仍会抢默认预设（forceDefaultOpsPtc = true）', '新会话会被改成 ops-ptc', 'xiaoyu-novel doctor --fix')
    else {
      push(
        'ops-force',
        'warn',
        'dsh-ops 默认会抢新会话的默认预设（profile 没覆盖 forceDefaultOpsPtc，默认 true）',
        '插件包内 cordis.patch.yml 把 global.forceDefaultOpsPtc 默认设成 true',
        'xiaoyu-novel doctor --fix（写入显式 false）',
      )
    }
  }

  // ④ 方法论技能
  const missingSkills = SKILL_NAMES.filter((name) => !existsSync(path.join(home, 'skills', name, 'SKILL.md')))
  if (missingSkills.length === 0) push('skills', 'ok', '方法论技能齐全（' + SKILL_NAMES.length + ' 套）', path.join(home, 'skills'))
  else push('skills', 'warn', '方法论技能缺失', '缺：' + missingSkills.join('、'), '重启 DSH 让插件重新安装技能')

  // ⑤ 工作区列表
  const workspaceFile = path.join(home, 'storages', 'workspace.json')
  const workspaceText = readTextOrNull(workspaceFile)
  if (workspaceText === null) {
    push('workspace', 'warn', '工作区列表不存在——面板看不到任何书', workspaceFile, '打开一次 DSH 会自动建；或从搬迁包还原')
  } else {
    let count = 0
    let broken = false
    try {
      const data = JSON.parse(workspaceText)
      count = Object.keys(data?.tables?.workspaces ?? {}).length
    } catch {
      broken = true
    }
    if (broken) push('workspace', 'warn', '工作区列表解析失败（JSON 损坏）', workspaceFile, '从 .bak 备份恢复')
    else push('workspace', 'ok', '工作区列表在（' + count + ' 个）', workspaceFile)
  }

  const errors = checks.filter((row) => row.level === 'error').length
  const warns = checks.filter((row) => row.level === 'warn').length
  return { ok: errors === 0, errors, warns, checks }
}

/** 把体检结论渲染成中文清单（CLI 用）。 */
export function renderDiagnosis(result) {
  const icon = (level) => (level === 'error' ? '✗' : level === 'warn' ? '!' : '✓')
  const lines = []
  for (const row of result.checks) {
    lines.push(icon(row.level) + ' ' + row.title)
    if (row.detail !== undefined && row.detail !== '') lines.push('    ' + row.detail)
    if (row.fix !== undefined) lines.push('    → ' + row.fix)
  }
  lines.push('')
  if (result.ok) lines.push('结论：可用' + (result.warns > 0 ? '（' + result.warns + ' 项会让功能看起来像坏了，建议 --fix）' : ''))
  else lines.push('结论：有 ' + result.errors + ' 项致命缺失，先修这些')
  return lines.join('\n')
}
