/**
 * gate-core.mjs —— 门禁分的纯 JS 实现（零依赖，面板路由用）。
 *
 * 与 skills/xiaoyu-qu-ai-wei/scripts/aiwei_scan.py 同一套指标、同一组权重、
 * 同一批阈值：面板不该为了一个分数去 spawn python3（很多设备没有解释器，
 * 一次 spawn 也要几百毫秒）。两边输出允许极小浮点误差，测试里做对拍。
 *
 * 只算两件事：人味指数（含硬伤封顶）与检测器视角人写度。逐句嫌疑与报告
 * 排版留在 python 脚本里给 CLI 与写手用。
 */

const BANKS = {
  环境套话: [
    '空气中弥漫', '气氛瞬间', '时间仿佛', '仿佛整个世界', '死一般', '落针可闻',
    '汗毛', '不寒而栗', '脊背发凉', '头皮发麻', '喘不过气', '凝固了', '安静得可怕',
    '像是凝固', '令人窒息', '压迫着每个人',
  ],
  表情套话: [
    '嘴角勾起', '嘴角微微', '嘴角上扬', '眼神中闪过', '眼中闪过', '眼底深处',
    '瞳孔骤缩', '瞳孔一缩', '脸色瞬间', '面色一沉', '眉头微皱', '眉头一挑',
    '嘴角抽搐', '眸子', '目光深邃', '意味深长',
  ],
  动作套话: [
    '深吸一口气', '缓缓开口', '淡淡地', '淡淡道', '沉声道', '冷笑一声',
    '不置可否', '耸了耸肩', '摊了摊手', '双手抱胸', '负手而立', '拂袖',
    '转身离去', '站起身来', '点了点头',
  ],
  心理套话: [
    '心中一凛', '心中一震', '心中暗道', '不由得', '不由自主', '下意识',
    '鬼使神差', '说不清道不明', '不知为何', '隐隐觉得', '隐约感到',
    '说不出话', '心中五味杂陈', '五味杂陈',
  ],
  叙述连接: [
    '然而', '与此同时', '紧接着', '下一刻', '就在这时', '话音未落',
    '说时迟', '只见', '此时此刻', '刹那间', '下一秒', '很快',
  ],
  抽象大词: [
    '气息', '意志', '命运', '宿命', '存在感', '规则', '维度', '灵魂',
    '气场', '压迫感', '杀意', '寒意', '威压', '生命层次', '力量感', '境界',
  ],
  万能量词: [
    '一抹', '一丝', '一缕', '一道', '一股', '一片', '一阵', '一种',
    '一层', '一枚', '一声',
  ],
  软化副词: [
    '缓缓', '轻轻', '微微', '淡淡', '静静', '默默', '死死', '紧紧',
    '猛地', '骤然', '陡然', '悄然', '兀自', '竟然', '居然',
    '仿佛', '似乎', '宛如', '犹如',
  ],
  解释插入: [
    '也就是说', '换句话说', '这意味着', '说白了', '实际上', '事实上',
    '换言之', '简单来说', '正是因为', '这也是为什么',
  ],
}

const STRUCT = new Set(['环境套话', '表情套话', '动作套话', '心理套话', '叙述连接', '抽象大词', '解释插入'])

const SENSES = {
  视觉: ['看', '望', '见', '光', '亮', '暗', '影', '色', '红', '蓝', '白', '黑', '闪', '映', '盯', '瞥', '眼眶', '屏', '灯'],
  听觉: ['听', '声', '响', '吵', '静', '嗡', '咔', '哗', '吱', '哐', '喊', '叫', '吼', '喘', '咳嗽', '脚步'],
  触觉: ['摸', '触', '冷', '热', '烫', '凉', '硬', '软', '粗糙', '滑', '湿', '疼', '痛', '扎', '硌'],
  嗅觉: ['闻', '气味', '味道', '香', '臭', '腥', '霉', '烟味', '酒味', '汗味'],
  味觉: ['尝', '甜', '苦', '咸', '酸', '辣', '涩', '口感', '咽'],
  体感: ['胃', '心跳', '呼吸', '喉咙', '后背', '指尖', '腿', '冷汗', '发抖', '耳鸣', '恶心', '头晕', '胸口', '眼皮', '手掌'],
}

const CONNECTIVES = ['然而', '因此', '此外', '同时', '不仅', '而且', '尽管', '虽然', '因为', '所以',
  '并且', '以及', '从而', '进而', '总的来说', '值得注意', '由此可见', '换言之',
  '一方面', '另一方面', '首先', '其次', '最后', '与此同时', '除此之外', '正因如此']

const IDIOMS = ['一举两得', '不寒而栗', '不由自主', '小心翼翼', '若无其事', '恍然大悟', '若有所思',
  '不动声色', '不约而同', '难以置信', '如释重负', '心有余悸', '目瞪口呆', '面面相觑',
  '喃喃自语', '迫不及待', '莫名其妙', '理所当然', '显而易见', '络绎不绝', '鸦雀无声',
  '千钧一发', '屏息凝神', '电光石火', '意味深长', '司空见惯', '蓄势待发', '井然有序',
  '错综复杂', '坚不可摧', '深不可测', '望而生畏', '不动如山', '波澜不惊', '心如止水']

const ORAL = ['呢', '吧', '啊', '嘛', '呗', '哈', '啦', '咯', '唉', '哦', '噢', '嗯', '哎', '嘿',
  '哟', '咱', '俺', '咋', '啥', '甭', '俩', '仨', '愣', '瞅', '瞧', '拽', '拎', '揣',
  '搁', '折腾', '嘟囔', '嘀咕', '扒拉', '得亏', '回头', '压根', '敢情', '合着', '拉倒',
  '得了', '算了', '反正', '半天', '半晌', '死活', '硬是', '愣是', '偏不', '才不', '行吧']

const PUNCT = new Set('，。！？；：、…—·（）“”‘’《》〈〉～')
const ONO = ['砰', '咚', '哐', '哗', '咔', '嗒', '滴答', '咕', '嗤', '嗡', '唰', '沙沙']

const SENT_END = new Set('。！？!?')
const OPEN_Q = new Set('“‘「『')
const CLOSE_Q = new Set('”’」』')

function count(text, word) {
  if (word === '') return 0
  let n = 0
  let i = text.indexOf(word)
  while (i !== -1) { n += 1; i = text.indexOf(word, i + word.length) }
  return n
}

function density(n, total, per = 1000) {
  return (n / Math.max(total, 1)) * per
}

function interp(v, pts) {
  const sorted = pts.slice().sort((a, b) => a[0] - b[0])
  if (v <= sorted[0][0]) return sorted[0][1]
  if (v >= sorted[sorted.length - 1][0]) return sorted[sorted.length - 1][1]
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const [x0, y0] = sorted[i]
    const [x1, y1] = sorted[i + 1]
    if (x0 <= v && v <= x1) {
      const t = x1 > x0 ? (v - x0) / (x1 - x0) : 0
      return y0 + t * (y1 - y0)
    }
  }
  return sorted[sorted.length - 1][1]
}

function normalizeQuotes(text) {
  let out = ''
  let opened = false
  for (const ch of text) {
    if (ch === '"') { out += opened ? '”' : '“'; opened = !opened } else out += ch
  }
  return out
}

function clean(text) {
  let t = String(text == null ? '' : text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  t = normalizeQuotes(t)
  t = t.replace(/^[ \t]{0,3}#{1,6}[ \t]*/gm, '')
  t = t.replace(/^[ \t]*[-*>][ \t]+/gm, '')
  t = t.replace(/\*{1,3}([^*\n]+)\*{1,3}/g, '$1')
  return t
}

function splitParagraphs(text) {
  return text.split('\n').map((line) => line.trim()).filter((line) => line !== '')
}

function splitSentences(text) {
  const out = []
  let buf = ''
  let depth = 0
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]
    if (OPEN_Q.has(ch)) { depth += 1; buf += ch; i += 1; continue }
    if (CLOSE_Q.has(ch)) { depth = Math.max(0, depth - 1); buf += ch; i += 1; continue }
    if (SENT_END.has(ch) && (depth === 0 || (depth === 1 && i + 1 < n && CLOSE_Q.has(text[i + 1])))) {
      buf += ch
      let j = i + 1
      while (j < n && CLOSE_Q.has(text[j])) { buf += text[j]; depth = Math.max(0, depth - 1); j += 1 }
      const s = buf.trim()
      if (s !== '') out.push(s)
      buf = ''
      i = j
      continue
    }
    if (ch === '…') {
      let j = i
      while (j < n && text[j] === '…') j += 1
      buf += text.slice(i, j)
      if (depth === 0 && j - i >= 2) {
        let k = j
        while (k < n && CLOSE_Q.has(text[k])) { buf += text[k]; k += 1 }
        const s = buf.trim()
        if (s !== '') out.push(s)
        buf = ''
        i = k
        continue
      }
      i = j
      continue
    }
    buf += ch
    i += 1
    if (buf.length >= 150 && (ch === '，' || ch === ',' || ch === '、')) {
      const s = buf.trim()
      if (s !== '') out.push(s)
      buf = ''
    }
  }
  const s = buf.trim()
  if (s !== '') out.push(s)
  return out
}


const HOOK_TURNS = ['突然', '忽然', '竟', '却', '没想到', '不对劲', '异样', '声音', '脚步', '敲门', '电话', '血', '死', '冷', '颤', '黑', '盯', '问', '响', '停', '门', '影']

/**
 * 章末钩子检测（网文专用）：网文靠章尾把人勾到下一章，平收是常见失血点。
 * 判据按优先级：问句 > 未完成（省略号/破折号）> 转折词 > 短收（末句 ≤14 字
 * 或末段 ≤30 字）。都不过就是「平收」，提示改写而不是判错——抒情章、收束章
 * 确实可以不挂钩子，这是提示不是硬伤。
 * @returns {{ok:boolean, kind:'question'|'unfinished'|'turn'|'short'|'plain'|'empty', tail:string}}
 */
export function chapterHook(paragraphs) {
  const paras = (Array.isArray(paragraphs) ? paragraphs : []).filter((p) => String(p).trim() !== '')
  if (paras.length === 0) return { ok: false, kind: 'empty', tail: '' }
  const last = String(paras[paras.length - 1])
  const sents = splitSentences(last).filter((s) => /[\u4e00-\u9fa5A-Za-z0-9]/.test(s))
  const tail = (sents.length ? sents[sents.length - 1] : last).trim()
  const bare = tail.replace(/[\s，。！？；：、…—·（）“”‘’「」『』]/g, '')
  if (/[？?]\s*$/.test(tail)) return { ok: true, kind: 'question', tail }
  if (/(……|…|——|—)\s*$/.test(tail)) return { ok: true, kind: 'unfinished', tail }
  for (const w of HOOK_TURNS) {
    if (tail.includes(w)) return { ok: true, kind: 'turn', tail }
  }
  if (bare.length <= 14 || last.length <= 30) return { ok: true, kind: 'short', tail }
  return { ok: false, kind: 'plain', tail }
}

const SOFT_ADVERBS = ['缓缓', '轻轻', '微微', '淡淡地', '淡淡', '静静地', '静静地', '默默', '死死', '紧紧', '猛地', '骤然', '陡然', '悄然']
const VAGUE_QUANTIFIERS = ['一抹', '一丝', '一缕', '一道', '一股', '一片', '一阵', '一种', '一层', '一枚']

/**
 * 对单句做保守的规则微调（面板「按建议改」用）：
 *   1) 删软化副词（删掉句子仍通顺的，如「缓缓站起身」→「站起身」）；
 *   2) 删模糊量词（「一股寒意」→「寒意」）；
 *   3) 45 字以上长句在第一个逗号处拆成两句；
 *   4) 三项并列的顿号改成逗号（保留全部词项，只打散列表节奏）。
 * 只改写法，不动词义：任何一条都不增删信息，最多删掉修饰。
 * @returns {{changed:boolean, text:string, ops:string[]}}
 */
export function fixSentence(sentence) {
  let text = String(sentence == null ? '' : sentence)
  const ops = []
  for (const word of SOFT_ADVERBS) {
    if (text.includes(word)) {
      const next = text.split(word).join('')
      if (next.trim() !== '') { text = next; ops.push('删副词「' + word + '」') }
    }
  }
  for (const word of VAGUE_QUANTIFIERS) {
    if (text.includes(word)) {
      const next = text.split(word).join('')
      if (next.trim() !== '') { text = next; ops.push('删模糊量词「' + word + '」') }
    }
  }
  if (text.replace(/\s/g, '').length >= 45) {
    const idx = text.indexOf('，')
    if (idx > 0) {
      text = text.slice(0, idx) + '。' + text.slice(idx + 1)
      ops.push('长句拆分')
    }
  }
  const separators = (text.match(/、/g) || []).length
  if (separators >= 2) {
    let seen = 0
    text = text.replace(/、/g, () => { seen += 1; return '，' })
    ops.push('打散三项并列')
  }
  return { changed: text !== sentence, text, ops }
}

function detectorProfile(text, sents, paras) {
  const chars = text.replace(/\s/g, '')
  const total = chars.length || 1
  const lens = (sents.length ? sents.map((s) => s.replace(/\s/g, '').length) : [0])
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length || 1
  const diffs = []
  for (let i = 1; i < lens.length; i += 1) diffs.push(Math.abs(lens[i] - lens[i - 1]))
  const burst = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length / mean : 0
  let connN = 0
  for (const w of CONNECTIVES) connN += count(text, w)
  let idiomN = 0
  for (const w of IDIOMS) idiomN += count(text, w)
  let oralN = 0
  for (const w of ORAL) oralN += count(text, w)
  const ptypes = new Set(Array.from(text).filter((ch) => PUNCT.has(ch))).size
  const deD = density(count(text, '的') + count(text, '地'), total, 100)
  const shortPara = paras.filter((p) => p.replace(/\s/g, '').length <= 15).length / Math.max(paras.length, 1)
  const starts = new Set(sents.map((s) => s.slice(0, 1)))
  const startsDiv = starts.size / Math.max(sents.length, 1)

  const feats = [
    ['句长突变度', burst, '≥0.55', interp(burst, [[0.15, 10], [0.3, 40], [0.45, 70], [0.55, 88], [0.7, 100], [0.9, 95]]), '长短句交替：每 5-7 句放一个 3-6 字短句', 25],
    ['连接词密度', density(connN, total), '≤6/千字', interp(density(connN, total), [[2, 100], [4, 92], [6, 80], [9, 55], [13, 25], [18, 5]]), '然而/因此/不仅 是书面骨架，删掉一半', 15],
    ['四字格密度', density(idiomN, total), '≤1.5/千字', interp(density(idiomN, total), [[0.3, 100], [1, 92], [2, 75], [3.5, 45], [5.5, 15]]), '成语连发是默认文风，换大白话动作', 10],
    ['口语标记密度', density(oralN, total), '≥5/千字', interp(density(oralN, total), [[0.5, 5], [1.5, 25], [3, 55], [5, 82], [8, 100], [14, 95]]), '呢/吧/啊/咋/啥 是白话指纹', 18],
    ['标点种类', ptypes, '≥6', interp(ptypes, [[2, 10], [3, 40], [4, 68], [5, 86], [6, 96], [7, 100]]), '补 …… —— ？！（） 与破折号停顿', 10],
    ['虚词密度', deD, '≤6/百字', interp(deD, [[1.5, 100], [2.5, 96], [3.5, 88], [4.5, 76], [6, 55], [8, 25]]), '的/地 连缀＝定语套定语', 10],
    ['短段比例', shortPara * 100, '≥10%', interp(shortPara * 100, [[0, 30], [5, 55], [10, 78], [18, 92], [30, 100]]), '一句一段是呼吸', 6],
    ['句首多样度', startsDiv * 100, '≥50%', interp(startsDiv * 100, [[25, 30], [35, 55], [45, 75], [55, 92], [70, 100]]), '连续同字开头＝模板推进', 6],
  ]
  const weight = feats.reduce((a, f) => a + f[5], 0)
  const score = feats.reduce((a, f) => a + f[3] * f[5], 0) / weight
  return { score: Math.round(score * 10) / 10, burst, feats }
}

const FLAG_WEIGHT = {
  环境套话: 3, 表情套话: 3, 动作套话: 2, 心理套话: 3,
  叙述连接: 2, 抽象大词: 2, 万能量词: 2, 软化副词: 1, 解释插入: 3,
}

function sentenceFlags(sents) {
  const out = []
  for (let idx = 0; idx < sents.length; idx += 1) {
    const s = sents[idx]
    const flags = []
    for (const [cat, words] of Object.entries(BANKS)) {
      for (const w of words) {
        if (s.includes(w)) { flags.push({ hit: w, weight: FLAG_WEIGHT[cat] || 1, cat }); break }
      }
    }
    const len = s.replace(/\s/g, '').length
    if (len >= 45) flags.push({ hit: '长句 ' + len + ' 字', weight: 2, cat: '长句' })
    if (/不是[\s\S]{1,20}而是/.test(s)) flags.push({ hit: '不是A而是B', weight: 2, cat: '对称' })
    if (/像[\s\S]{1,12}一样/.test(s) || /仿佛[\s\S]{1,12}般/.test(s)) flags.push({ hit: '通用比喻', weight: 2, cat: '比喻' })
    if ((s.match(/、/g) || []).length >= 2) flags.push({ hit: '三项并列', weight: 2, cat: '对称' })
    if (s.includes('——')) flags.push({ hit: '破折号解释', weight: 1, cat: '叙述' })
    const weight = flags.reduce((a, f) => a + f.weight, 0)
    if (weight >= 3) out.push({ text: s, weight, flags })
  }
  out.sort((a, b) => b.weight - a.weight || sents.indexOf(a.text) - sents.indexOf(b.text))
  return out.slice(0, 40)
}

// ── 段落热度（0.10.0）：门禁只给整章一个分，改稿时不知道先改哪段。 ──────────
// 这里给每段一个 0-100 的「AI 味热度」：只数得出证据的病灶（软副词、模糊量词、
// 三项并列、45 字以上长句、解释性插入、抽象大词），不猜语义。热度高的段落
// 优先改，比从头润一遍省一半工。
const HEAT_ABSTRACT = [
  '一种', '某种', '仿佛', '似乎', '像是', '宛如', '恍若', '莫名的', '不知为何',
  '无法形容', '难以言喻', '不可思议', '复杂', '情绪', '气氛', '氛围', '压迫感',
  '安全感', '存在感', '仪式感', '宿命', '命运', '灵魂', '深渊', '虚无', '力量',
]
const HEAT_EXPLAIN = [
  '也就是说', '换句话说', '这意味着', '这说明', '换言之', '毕竟', '显然', '事实上',
  '不得不说', '值得一提的是', '某种程度上', '从某种意义上',
]

/**
 * 逐段热度：返回 [{ index, chars, heat, hits: [病名...] }]，按原顺序。
 * 只统计可数证据；空段跳过（不计入序号，保持与正文段落对齐）。
 */
export function paragraphHeat(rawText) {
  const text = clean(rawText)
  const paras = splitParagraphs(text)
  const out = []
  paras.forEach((para, index) => {
    const body = String(para ?? '').trim()
    if (body === '') return
    const chars = body.replace(/\s/g, '').length
    if (chars < 8) { out.push({ index, chars, heat: 0, hits: [] }); return }
    const hits = []
    let score = 0
    let soft = 0
    for (const word of SOFT_ADVERBS) soft += body.split(word).length - 1
    if (soft > 0) { score += soft * 12; hits.push('软副词 ' + soft) }
    let vague = 0
    for (const word of VAGUE_QUANTIFIERS) vague += body.split(word).length - 1
    if (vague > 0) { score += vague * 10; hits.push('模糊量词 ' + vague) }
    const triple = (body.match(/(?:[^\s，。！？；：、”“"（）()]{1,8}、){2}[^\s，。！？；：、”“"（）()]{1,8}/g) || []).length
    if (triple > 0) { score += triple * 14; hits.push('三项并列 ' + triple) }
    let long = 0
    for (const s of splitSentences(body)) if (s.replace(/\s/g, '').length >= 45) long += 1
    if (long > 0) { score += long * 9; hits.push('长句 ' + long) }
    let explain = 0
    for (const word of HEAT_EXPLAIN) explain += body.split(word).length - 1
    if (explain > 0) { score += explain * 11; hits.push('解释插入 ' + explain) }
    let abstract = 0
    for (const word of HEAT_ABSTRACT) abstract += body.split(word).length - 1
    if (abstract > 0) { score += abstract * 6; hits.push('抽象词 ' + abstract) }
    // 归一化到 0-100：按字数摊薄，避免长段落因为「长」而被判热。
    const per100 = (score / Math.max(1, chars)) * 100
    const heat = Math.max(0, Math.min(100, Math.round(per100 * 2.4)))
    out.push({ index, chars, heat, hits })
  })
  return out
}
export function analyzeChapter(rawText) {
  const text = clean(rawText)
  const chars = text.replace(/\s/g, '')
  const total = chars.length
  const paras = splitParagraphs(text)
  const sents = splitSentences(text).filter((s) => /[\u4e00-\u9fa5A-Za-z0-9]/.test(s))

  const lens = sents.length ? sents.map((s) => s.replace(/\s/g, '').length) : [0]
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length
  const variance = lens.reduce((a, x) => a + (x - mean) * (x - mean), 0) / lens.length
  const cv = mean ? Math.sqrt(variance) / mean : 0
  const shortRatio = lens.filter((x) => x <= 8).length / lens.length
  const longRatio = lens.filter((x) => x >= 45).length / lens.length

  const plens = paras.length ? paras.map((p) => p.replace(/\s/g, '').length) : [0]
  const pmean = plens.reduce((a, b) => a + b, 0) / plens.length
  const pvar = plens.reduce((a, x) => a + (x - pmean) * (x - pmean), 0) / plens.length
  const pcv = pmean ? Math.sqrt(pvar) / pmean : 0

  let cliche = 0
  let adv = 0
  let qnt = 0
  let abstractN = 0
  let expl = 0
  for (const [cat, words] of Object.entries(BANKS)) {
    for (const w of words) {
      const c = count(text, w)
      if (!c) continue
      if (STRUCT.has(cat)) cliche += c
      if (cat === '软化副词') adv += c
      if (cat === '万能量词') qnt += c
      if (cat === '抽象大词') abstractN += c
      if (cat === '解释插入') expl += c
    }
  }

  const triple = (text.match(/(?:[^\s，。！？；：、”“"（）()]{1,8}、){2}[^\s，。！？；；：、”“"（）()]{1,8}/g) || []).length

  const senseCounts = {}
  for (const [sense, words] of Object.entries(SENSES)) {
    let n = 0
    for (const w of words) n += count(text, w)
    senseCounts[sense] = n
  }
  const sTotal = Object.values(senseCounts).reduce((a, b) => a + b, 0) || 1
  const present = Object.entries(senseCounts).filter(([, v]) => v >= Math.max(1, sTotal * 0.01)).length
  const visual = senseCounts['视觉'] / sTotal

  let dialogChars = 0
  for (const m of text.matchAll(/“[^”]*”|「[^」]*」/g)) dialogChars += m[0].length
  const dialogRatio = dialogChars / Math.max(total, 1)

  const starts2 = sents.map((s) => s.slice(0, 2))
  let repeated = 0
  for (let i = 1; i < starts2.length; i += 1) if (starts2[i] === starts2[i - 1] && starts2[i].length === 2) repeated += 1
  const startRep = repeated / Math.max(starts2.length - 1, 1)

  const norm = text.replace(/[^\u4e00-\u9fa5]/g, '')
  const grams = new Map()
  for (let i = 0; i < Math.max(0, norm.length - 3); i += 1) {
    const g = norm.slice(i, i + 4)
    grams.set(g, (grams.get(g) || 0) + 1)
  }
  let hot = 0
  for (const c of grams.values()) if (c >= 3) hot += c
  const templateRep = hot / Math.max(norm.length - 3, 1)

  const digits = (text.match(/\d+/g) || []).length
  let ono = 0
  for (const w of ONO) ono += count(text, w)
  const cnNum = (text.match(/[一二三四五六七八九十百千万半两]{1,3}(?:只|条|根|块|张|把|双|粒|颗|片|滴|支|瓶|碗|包|盒|杯|辆|间|年|天|岁|步|次|个人)/g) || []).length
  const concrete = density(digits + ono + cnNum, total)
  const deDensity100 = density(count(text, '的'), total, 100)

  const metrics = [
    ['句长变异系数', interp(cv, [[0.2, 0], [0.35, 30], [0.45, 55], [0.55, 78], [0.7, 100], [0.95, 95], [1.3, 78], [1.8, 55]]), 18],
    ['短句占比', interp(shortRatio * 100, [[0, 5], [5, 45], [12, 88], [20, 100], [32, 88], [45, 55]]), 8],
    ['长句占比', interp(longRatio * 100, [[0, 80], [2, 90], [5, 96], [10, 100], [18, 85], [28, 50], [40, 25]]), 7],
    ['段落长度变异系数', interp(pcv, [[0.15, 20], [0.35, 55], [0.6, 92], [0.9, 100], [1.3, 85], [2.2, 60]]), 8],
    ['套话密度', interp(density(cliche, total), [[0, 100], [1, 95], [2.5, 80], [4, 55], [6, 30], [9, 8]]), 16],
    ['副词密度', interp(density(adv, total), [[0, 100], [4, 92], [8, 78], [12, 55], [18, 25], [26, 5]]), 9],
    ['万能量词密度', interp(density(qnt, total), [[0, 100], [3, 92], [6, 78], [10, 55], [16, 25]]), 6],
    ['三项并列密度', interp(density(triple, total), [[0, 100], [0.4, 90], [0.9, 68], [1.6, 42], [2.5, 18]]), 8],
    ['抽象大词密度', interp(density(abstractN, total), [[0, 100], [2, 92], [4, 72], [7, 45], [11, 18], [16, 5]]), 9],
    ['解释插入密度', interp(density(expl, total), [[0, 100], [0.5, 92], [1.2, 70], [2.2, 45], [3.5, 18]]), 6],
    ['感官类别数', interp(present, [[1, 10], [2, 35], [3, 60], [4, 88], [5, 100], [6, 100]]), 6],
    ['视觉占比', interp(visual * 100, [[35, 100], [55, 92], [70, 68], [85, 35], [95, 12]]), 4],
    ['对话占比', interp(dialogRatio * 100, [[0, 35], [5, 55], [12, 85], [22, 100], [35, 95], [55, 72], [75, 45]]), 6],
    ['句首重复率', interp(startRep * 100, [[0, 100], [12, 92], [22, 78], [35, 55], [50, 30], [65, 12]]), 6],
    ['模板重复率', interp(templateRep * 100, [[0.5, 100], [2, 92], [3.5, 75], [6, 50], [10, 25], [15, 8]]), 5],
    ['具体细节密度', interp(concrete, [[0, 30], [0.8, 55], [2, 82], [4, 96], [7, 100]]), 6],
    ['的密度', interp(deDensity100, [[0, 85], [1.5, 92], [2.5, 100], [4.2, 100], [5.4, 85], [7, 55], [9, 25]]), 5],
  ]

  const totalWeight = metrics.reduce((a, m) => a + m[2], 0)
  let score = metrics.reduce((a, m) => a + m[1] * m[2], 0) / totalWeight
  const floor = Math.min(...metrics.map((m) => m[1]))
  const cap = floor <= 8 ? 46 : (floor <= 15 ? 58 : (floor <= 22 ? 70 : 100))
  score = Math.min(score, cap)
  const hard = metrics.filter((m) => m[1] <= 22).map((m) => m[0])

  const hook = chapterHook(paras)

  return {
    score: Math.round(score * 10) / 10,
    hard,
    flags: sentenceFlags(sents),
    hook,
    detector: detectorProfile(text, sents, paras),
    meta: { chars: total, sentences: sents.length, paragraphs: paras.length },
  }
}
