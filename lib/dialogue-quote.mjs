/**
 * dialogue-quote.mjs —— 3.40.0 对话引号强制规则。
 *
 * 规则：人物对话只能用双引号。
 *   合法 —— 中文弯双引号 “ ”、英文直双引号 " "
 *   违规 —— 直角引号「」、单引号‘’、书名式对话（《》里是成句台词时另议，不在此列）
 *
 * 为什么不能只做「出现即报」：
 *   直角引号也常用于强调、术语、章节小标题；单引号可能是英文撇号（don't、'90s）。
 *   所以判定要加「像不像成句对话」的门槛：长度 + 是否含常见对话标点 + 是否在叙述行里。
 */

/** 视为「成句对话」的最短字数（去掉标点后）。短于这个的引号内容按术语/强调放过。 */
const MIN_DIALOGUE_CHARS = 6

/** 对话里常见、术语/强调里少见的标点。出现任一个更像在说话。 */
const DIALOGUE_PUNCT = /[，。！？…、；：~～—]/

/** 违规的引号对（开 → 闭）。 */
const BAD_PAIRS = [
  { open: '\u300c', close: '\u300d', name: '直角引号「」', key: 'corner' },
  { open: '\u2018', close: '\u2019', name: '中文单引号‘’', key: 'single_cn' },
  { open: '\u201c', close: '\u201d', name: '中文弯双引号“”', key: 'double_cn', allowed: true },
  { open: '"', close: '"', name: '英文直双引号""', key: 'double_en', allowed: true },
]

/** 去掉空白与控制字符后的可见字数。 */
function visibleLen(s) {
  return String(s || '').replace(/\s/g, '').length
}

/**
 * 判定一段引号内的内容「像不像人物对话」。
 * @param {string} inner 引号内文本
 * @param {string} line 整行（用于看上下文）
 */
export function looksLikeDialogue(inner, line) {
  const t = String(inner || '').trim()
  if (!t) return false

  // ① 以句末标点结尾 → 一定是成句台词，哪怕只有 1 个字（「走。」「好。」「等等我。」）
  //    术语、书名从不以 。！？… 结尾，所以这条不会误伤
  if (/[。！？?!…]$/.test(t)) return true

  // ② 含对话常见标点且 ≥4 字 → 台词（「走，快点」这种不带句号的也一样抓）
  if (DIALOGUE_PUNCT.test(t) && visibleLen(t) >= 4) return true

  // ③ 没有标点但很长（≥10 字）且不是纯英文术语 → 也当作对话
  if (visibleLen(t) >= 10 && !/^[A-Za-z0-9_\-\. ]+$/.test(t)) return true

  // 其余（「量子纠缠」「三体」这类短术语）放过
  return false
}

/**
 * 扫描一段正文，找出所有违规的对话引号。
 * @param {string} text 章节正文（不含 frontmatter）
 * @returns {{violations:Array<{line:number,index:number,quote:string,inner:string,kind:string,text:string}>, count:number, ok:boolean}}
 */
export function scanDialogueQuotes(text) {
  const lines = String(text || '').split(/\r?\n/)
  const violations = []
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    if (!line) continue
    for (const pair of BAD_PAIRS) {
      if (pair.allowed) continue // 双引号是合法目标形态，跳过
      let from = 0
      for (let guard = 0; guard < 200; guard++) {
        const s = line.indexOf(pair.open, from)
        if (s < 0) break
        const e = line.indexOf(pair.close, s + 1)
        if (e < 0) { from = s + 1; continue }
        const inner = line.slice(s + 1, e)
        const span = line.slice(s, e + 1)
        if (looksLikeDialogue(inner, line)) {
          violations.push({
            line: li + 1,
            index: s,
            quote: pair.name,
            kind: pair.key,
            inner: inner.trim().slice(0, 60),
            text: span.slice(0, 80),
          })
        }
        from = e + 1
      }
    }
    // 英文单引号：只在明显是中文台词时算（避免 don't / '90s 误报）
    let from2 = 0
    for (let guard = 0; guard < 200; guard++) {
      const s = line.indexOf("'", from2)
      if (s < 0) break
      const e = line.indexOf("'", s + 1)
      if (e < 0) { from2 = s + 1; continue }
      const inner = line.slice(s + 1, e)
      // 前后紧邻 ASCII 字母 = 撇号，不是引号
      const prev = s > 0 ? line[s - 1] : ''
      const next = e + 1 < line.length ? line[e + 1] : ''
      const isApostrophe = /[A-Za-z0-9]/.test(prev) || /[A-Za-z0-9]/.test(next)
      if (!isApostrophe && /[\u4e00-\u9fa5]/.test(inner) && looksLikeDialogue(inner, line)) {
        violations.push({
          line: li + 1,
          index: s,
          quote: "英文单引号''",
          kind: 'single_en',
          inner: inner.trim().slice(0, 60),
          text: line.slice(s, Math.min(e + 1, s + 80)),
        })
      }
      from2 = e + 1
    }
  }
  violations.sort((a, b) => a.line - b.line || a.index - b.index)
  return { violations, count: violations.length, ok: violations.length === 0 }
}

/**
 * 给面板用的一句话摘要。
 */
export function summarizeDialogueQuotes(result) {
  if (!result || result.ok) return '对话引号合规（全部使用双引号）'
  const first = result.violations[0]
  const where = first ? '第 ' + first.line + ' 行：' + first.text : ''
  return '发现 ' + result.count + ' 处非双引号对话 · ' + where
}

/**
 * 发布前的拦截判定。
 * @param {object} result scanDialogueQuotes 的返回
 * @param {'block'|'warn'} mode 项目设置里的策略
 */
export function gateDialogueQuotes(result, mode) {
  if (!result || result.ok) return { pass: true }
  if (mode === 'block') {
    return { pass: false, reason: '对话必须用双引号：' + summarizeDialogueQuotes(result) }
  }
  return { pass: true, warning: summarizeDialogueQuotes(result) }
}
