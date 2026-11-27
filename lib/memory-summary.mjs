/**
 * memory-summary.mjs —— 3.51.0 加强版章摘要（前情提要的原料）。
 *
 * 老版只抓「首段 + 末段 + 对话轮数 + 字数」，写手读它只知道开头结尾，
 * 不知道这一章**发生了什么事、谁在场、什么冲突、留了什么悬念**。
 *
 * 加强版七项（全部纯规则，不调模型）：
 *   ① 开章式   —— 首段（定调）
 *   ② 核心事件 —— 抓「动词 + 宾语」的强动作句（拿下/揭穿/翻脸/拍板…）
 *   ③ 出场人物 —— 与 characters/ 名单比对，列出本章出场者 + 出现次数
 *   ④ 场景     —— 地点名词（公司/办公室/楼道/街口/水摊…）频次 top3
 *   ⑤ 冲突强度 —— 短句占比 + 感叹/问句密度（吵架多就高）
 *   ⑥ 章尾钩子 —— 末段 + 悬念类型判定（问句/未竟/反差/平收）
 *   ⑦ 关键对白 —— 最长的一句台词（最有信息量）
 */

import path from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

/** 强动作动词（命中说明这章"有事发生"）。 */
const ACTION_VERBS = [
  '拿下', '揭穿', '翻脸', '拍板', '签了', '当场', '按了', '撕了', '摔了', '砸了',
  '认了', '认下', '翻了', '顶了', '怼了', '骂了', '撵了', '走了', '进了', '退了',
  '换了', '撬了', '捅了', '挡了', '拦了', '开了', '关了', '锁了', '丢了', '抓了',
]

/** 场景常见词（地点）。 */
const PLACES = [
  '公司', '办公室', '工位', '会议室', '楼道', '街口', '楼下', '楼上', '水摊', '门房',
  '柜台', '大厅', '车里', '电梯', '门口', '街上', '院子里', '窗前', '桌边', '门外',
]

/** 悬念类型。 */
export function hookType(lastPara) {
  const t = String(lastPara || '').slice(-80)
  if (/[？?]$/.test(t.trim())) return '问句'
  if (/[—…]$/.test(t.trim()) || /……/.test(t)) return '未竟'
  if (/可是|但是|却|然而|偏偏|谁知/.test(t)) return '转折'
  if (/[！!]$/.test(t.trim())) return '惊呼'
  return '平收'
}

/** 读角色名单。 */
function loadNames(novelDir) {
  const dir = path.join(path.resolve(novelDir || ''), 'characters')
  if (!novelDir || !existsSync(dir)) return []
  const out = []
  try {
    for (const f of readdirSync(dir)) {
      if (!/\.md$/i.test(f) || /\.(bak|pre-)/.test(f)) continue
      const raw = readFileSync(path.join(dir, f), 'utf8')
      const m = /^\s*name\s*:\s*(.+)$/m.exec(raw) || /^\s*title\s*:\s*(.+)$/m.exec(raw)
      if (m) {
        const n = m[1].trim().replace(/^["']|["']$/g, '')
        // 排除描述式假名（那个人/某位/机构）
        if (n && n.length >= 2 && n.length <= 6 && !/那个人|那位|某个|有人|谁|机构|部门|处$|局$/.test(n)) out.push(n)
      }
    }
  } catch { /* 读不到就空 */ }
  return out
}

/**
 * 生成加强版摘要。
 * @param {string} body 正文（已剥 frontmatter）
 * @param {object} opts { novelDir, characterNames }
 */
export function summarizeRich(body, opts = {}) {
  const text = String(body || '')
  const paras = text.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean)
  if (!paras.length) return { ok: false, error: '空章' }
  // 角色名单要在事件提取之前就绪（事件判定要用它判断"有没有主语"）
  const names = Array.isArray(opts.characterNames) ? opts.characterNames : loadNames(opts.novelDir)

  const chars = text.replace(/\s/g, '').length
  const head = paras[0].slice(0, 90)
  const last = paras[paras.length - 1]

  // ② 核心事件：只从「叙述句」里抓 —— 先把引号内的台词剥掉，
  //    否则「认下/签了/接了」这些词在对话里遍地都是，抓出来全是半截台词。
  const narrated = text.replace(/[\u201c"][\s\S]*?[\u201d"]/g, '。')
  const sentences = narrated.split(/[。！？…]+/).map((s) => s.trim()).filter((s) => s.length >= 6)
  const events = []
  for (const s of sentences) {
    if (events.length >= 3) break
    const plain = s.replace(/[\u3000\s]/g, '')
    // 长度约束：太短是碎句，太长是整段摘要
    if (plain.length < 12 || plain.length > 60) continue
    // 以冒号/引号结尾 = 剥掉台词后留下的残句（后面原本接对话）
    if (/[:：\u201c\u201d"\u2018\u2019']$/.test(s.trim())) continue
    // 必须有主语（人名或代词），否则抓的是环境描写
    const hasSubject = names.some((n) => s.includes(n)) || /[他她它我你咱们]/.test(s)
    if (!hasSubject) continue
    if (ACTION_VERBS.some((v) => s.includes(v))) events.push(s.slice(0, 46))
  }

  // ③ 人物：名单比对 + 次数（names 已在函数开头算好）
  const cast = names
    .map((n) => ({ name: n, cnt: text.split(n).length - 1 }))
    .filter((x) => x.cnt > 0)
    .sort((a, b) => b.cnt - a.cnt)

  // ④ 场景
  const places = PLACES
    .map((p) => ({ p, cnt: text.split(p).length - 1 }))
    .filter((x) => x.cnt > 0)
    .sort((a, b) => b.cnt - a.cnt)
    .slice(0, 3)

  // ⑤ 冲突强度：短句占比 + 感叹问句密度
  const shorts = sentences.filter((s) => s.replace(/\s/g, '').length <= 8).length
  const excited = (text.match(/[！!]/g) || []).length
  const asked = (text.match(/[？?]/g) || []).length
  const shortRatio = sentences.length ? shorts / sentences.length : 0
  const tension = Math.min(100, Math.round(shortRatio * 60 + Math.min(40, (excited + asked) * 4)))

  // ⑥ 章尾
  const hook = hookType(last)
  const dialogLines = (text.match(/[“\"]([^”\"]{2,40})[”\"]/g) || []).length

  // ⑦ 最长台词
  let longestLine = ''
  for (const m of text.matchAll(/[“\"]([^”\"]{4,80})[”\"]/g)) {
    if (m[1].length > longestLine.length) longestLine = m[1]
  }

  const lines = []
  lines.push('开章：' + head)
  if (events.length) lines.push('事件：' + events.join(' / '))
  if (cast.length) lines.push('人物：' + cast.slice(0, 5).map((x) => x.name + '×' + x.cnt).join('、'))
  if (places.length) lines.push('场景：' + places.map((x) => x.p).join('、'))
  if (longestLine) lines.push('关键台词：「' + longestLine.slice(0, 34) + '」')
  lines.push('收章：' + last.slice(0, 90))
  lines.push('强度：' + tension + '/100 · 钩子：' + hook + ' · 对话 ' + dialogLines + ' 轮 · ' + chars + ' 字')

  return {
    ok: true,
    summary: lines.join('\n'),
    chars, dialogLines, tension, hookType: hook,
    cast: cast.slice(0, 8), places: places.map((x) => x.p), events,
  }
}

/** 兼容 living-bible 的签名：summarizeChapter(text) → {ok, summary, ...} */
export function makeSummarizer(novelDir) {
  const names = loadNames(novelDir)
  return (text) => summarizeRich(text, { novelDir, characterNames: names })
}
