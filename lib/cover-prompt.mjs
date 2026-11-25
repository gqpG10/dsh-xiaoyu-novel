/**
 * cover-prompt.mjs —— 3.27.0 封面提示词生成器（参考 story-cover 的分层思路）。
 *
 * 为什么做提示词而不是直接生图：插件的定位是零依赖纯文本；生图要接模型、
 * 要传图、要处理商用授权。把「书名 / 作者名 / 题材」转成两套可直接粘到
 * 任何文生图工具的提示词，是同一目的地的最低成本路径。
 *
 * 三层信息结构（平台封面通行做法）：
 *   第一层 书名 + 作者名 —— 最高优先级，必须可读
 *   第二层 题材暗示       —— 一眼看出是不是这盘菜
 *   第三层 氛围与钩子     —— 配色、光影、构图
 *
 * 输出两套风格：A 商业主图风（高对比、大字号、竖版 3:4）；B 概念艺术风
 * （少字、氛围、留白）。落盘 novel/exports/cover-prompt.md。
 */

import path from 'node:path'

/** 题材 → 视觉关键词映射（覆盖常见网文赛道，未命中走通用）。 */
const GENRE_VISUALS = {
  玄幻: { palette: '深紫与鎏金，灵光粒子', motif: '浮空古殿、断裂的封印环、远山剑影', mood: '恢弘压迫感' },
  仙侠: { palette: '青碧与月白，云雾流动', motif: '云海孤峰、剑光划破长空、白衣背影', mood: '清冷超然' },
  都市: { palette: '霓虹青紫与雨夜反光', motif: '摩天楼夜景、车灯拉丝、雨中剪影', mood: '克制又躁动' },
  悬疑: { palette: '冷灰与低饱和暗红', motif: '单一光源、长走廊、半开的门缝', mood: '不安与窥视' },
  科幻: { palette: '冷青与纯黑，蓝光边缘', motif: '巨构空间站、环形舷窗、星云背景', mood: '疏离的宏大' },
  甜宠: { palette: '奶油粉与暖白', motif: '逆光窗边、两颗靠近的心影、飘落的花瓣', mood: '柔软温热' },
  古言: { palette: '黛青与藕荷，绢本质感', motif: '宫墙回廊、半掩团扇、垂落帷幔', mood: '端庄下的暗涌' },
  末世: { palette: '灰绿与锈红，尘埃体积光', motif: '废弃城市天际线、孤身持械背影', mood: '荒凉的坚持' },
  历史: { palette: '赭石与墨黑，宣纸肌理', motif: '沙场旗幡、城楼剪影、远山如黛', mood: '厚重沉郁' },
}

const FALLBACK = { palette: '深色底与单点强光', motif: '主体剪影 + 大面积留白 + 一处关键道具', mood: '克制而有力' }

const pick = (genre) => {
  const g = String(genre ?? '')
  for (const key of Object.keys(GENRE_VISUALS)) if (g.includes(key)) return { key, ...GENRE_VISUALS[key] }
  return { key: '通用', ...FALLBACK }
}

/**
 * 生成两套封面提示词。
 * @param {{title:string, author:string, genre:string, synopsis?:string}} meta
 * @returns {{text:string, styles: {commercial:string, concept:string}}}
 */
export function buildCoverPrompt(meta) {
  const title = String(meta?.title ?? '未命名').trim() || '未命名'
  const author = String(meta?.author ?? '').trim() || '佚名'
  const genre = String(meta?.genre ?? '').trim() || '通用题材'
  const g = pick(genre)
  const commercial = [
    '【风格 A · 商业主图风｜竖版 3:4｜适配起点/番茄封面区】',
    '',
    '画面：' + g.motif + '，' + g.mood + '。',
    '配色：' + g.palette + '。',
    '构图：主体居中偏右，左上留出竖排书名区，底部留作者名条；整体高对比、边缘锐利、拒绝柔光大雾。',
    '文字层（提示词里只描述位置与质感，不要求模型写字）：' +
      '"《' + title + '》"竖排大字号压在上部三分之一，字体粗黑或宋体加描边；"' + author + ' 著"压在底部，字号小一到两档。',
    '题材暗示：一眼能看出这是「' + genre + '」。',
    '',
    '负面：多余文字、乱码、水印、logo、印章、模糊、低分辨率、压缩噪点。',
  ].join('\n')
  const concept = [
    '【风格 B · 概念艺术风｜竖版 3:4｜适配晋江/实体感封面】',
    '',
    '画面：' + g.motif + '，大片留白，主体只占画面 %d%% 面积。'.replace('%d', '28'),
    '配色：' + g.palette + '，整体压低饱和度，只保留一处高光。',
    '构图：留白呼吸感优先，视线引导到那处高光；无边框、无装饰纹样。',
    '文字层：仅书名「' + title + '」一行小字，字号克制，可置于画面中下部；作者名置于最底一行。',
    '题材暗示：靠意象而非符号（不要画成「套路模板封面」）。',
    '',
    '负面：大字号堆叠、发光特效、金属质感、过多元素、水印。',
  ].join('\n')
  const text = [
    '# 《' + title + '》封面提示词',
    '',
    '- 书名：' + title,
    '- 作者：' + author,
    '- 题材：' + genre + '（视觉映射：' + g.key + '）',
    '- 生成：' + new Date().toISOString().slice(0, 19),
    '',
    '> 用法：直接复制任一套到文生图工具。两套都按「书名 + 作者 + 题材暗示」三层结构写；',
    '> 平台封面的第一优先级是可读的书名，别让画面把字压死。',
    '',
    commercial,
    '',
    concept,
    '',
  ].join('\n')
  return { text, styles: { commercial, concept } }
}
