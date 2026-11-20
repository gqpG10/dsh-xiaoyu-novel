#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
aiwei_scan.py —— 中文小说「去 AI 味」量化扫描器

用途：只做诊断，不改写。所有指标都指向一件事——
      "这段文字是不是在用最省力的方式推进"。
      分数低不代表会被任何检测器判定，只代表手艺上偷懒了。

依赖：Python 3.8+，纯标准库。

用法：
    python3 aiwei_scan.py 稿件.txt
    python3 aiwei_scan.py 稿件.txt --top 20
    python3 aiwei_scan.py 稿件.txt --json
    python3 aiwei_scan.py 稿件.txt --gate 75      # 低于阈值时退出码 1
    python3 aiwei_scan.py 稿件.txt --compare 人类样本.txt
    cat 稿件.txt | python3 aiwei_scan.py -

输出：分层体检报告 + 高嫌疑句子清单 + 手术清单（改哪儿、改几处）。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

# ---------------------------------------------------------------- 词库

BANKS = {
    "环境套话": [
        "空气中弥漫", "气氛瞬间", "时间仿佛", "仿佛整个世界", "死一般", "落针可闻",
        "汗毛", "不寒而栗", "脊背发凉", "头皮发麻", "喘不过气", "凝固了", "安静得可怕",
        "像是凝固", "令人窒息", "压迫着每个人",
    ],
    "表情套话": [
        "嘴角勾起", "嘴角微微", "嘴角上扬", "眼神中闪过", "眼中闪过", "眼底深处",
        "瞳孔骤缩", "瞳孔一缩", "脸色瞬间", "面色一沉", "眉头微皱", "眉头一挑",
        "嘴角抽搐", "眸子", "目光深邃", "意味深长",
    ],
    "动作套话": [
        "深吸一口气", "缓缓开口", "淡淡地", "淡淡道", "沉声道", "冷笑一声",
        "不置可否", "耸了耸肩", "摊了摊手", "双手抱胸", "负手而立", "拂袖",
        "转身离去", "站起身来", "点了点头",
    ],
    "心理套话": [
        "心中一凛", "心中一震", "心中暗道", "不由得", "不由自主", "下意识",
        "鬼使神差", "说不清道不明", "不知为何", "隐隐觉得", "隐约感到",
        "说不出话", "心中五味杂陈", "五味杂陈",
    ],
    "叙述连接": [
        "然而", "与此同时", "紧接着", "下一刻", "就在这时", "话音未落",
        "说时迟", "只见", "此时此刻", "刹那间", "下一秒", "很快",
    ],
    "抽象大词": [
        "气息", "意志", "命运", "宿命", "存在感", "规则", "维度", "灵魂",
        "气场", "压迫感", "杀意", "寒意", "威压", "生命层次", "力量感", "境界",
    ],
    "万能量词": [
        "一抹", "一丝", "一缕", "一道", "一股", "一片", "一阵", "一种",
        "一层", "一枚", "一声",
    ],
    "软化副词": [
        "缓缓", "轻轻", "微微", "淡淡", "静静", "默默", "死死", "紧紧",
        "猛地", "骤然", "陡然", "悄然", "兀自", "竟然", "居然",
        "仿佛", "似乎", "宛如", "犹如",
    ],
    "解释插入": [
        "也就是说", "换句话说", "这意味着", "说白了", "实际上", "事实上",
        "换言之", "简单来说", "正是因为", "这也是为什么",
    ],
}

# 分类权重：命中的词条越"结构性"，句子嫌疑越大
FLAG_WEIGHT = {
    "环境套话": 3, "表情套话": 3, "动作套话": 2, "心理套话": 3,
    "叙述连接": 2, "抽象大词": 2, "万能量词": 2, "软化副词": 1, "解释插入": 3,
}

SENSES = {
    "视觉": ["看", "望", "见", "光", "亮", "暗", "影", "色", "红", "蓝", "白", "黑",
             "闪", "映", "盯", "瞥", "眼眶", "屏", "灯"],
    "听觉": ["听", "声", "响", "吵", "静", "嗡", "咔", "哗", "吱", "哐", "喊",
             "叫", "吼", "喘", "咳嗽", "脚步"],
    "触觉": ["摸", "触", "冷", "热", "烫", "凉", "硬", "软", "粗糙", "滑",
             "湿", "疼", "痛", "扎", "硌"],
    "嗅觉": ["闻", "气味", "味道", "香", "臭", "腥", "霉", "烟味", "酒味", "汗味"],
    "味觉": ["尝", "甜", "苦", "咸", "酸", "辣", "涩", "口感", "咽"],
    "体感": ["胃", "心跳", "呼吸", "喉咙", "后背", "指尖", "腿", "冷汗", "发抖",
             "耳鸣", "恶心", "头晕", "胸口", "眼皮", "手掌"],
}

SUMMARY_STARTS = ("这", "那", "正", "原", "其", "所", "于", "从", "因", "也", "而")
SUMMARY_WORDS = ("意味着", "证明", "才是", "便是", "从此", "终将", "注定", "才是真正")

ONO = ["砰", "咚", "哐", "哗", "咔", "嗒", "滴答", "咕", "嗤", "嗡", "唰", "沙沙"]


# --- 检测器视角用的特征词表（朱雀一类分类器看的是统计分布，不是关键词命中，
#     这里的词只作为分布特征的代理采样：连接词/成语/口语标记/标点种类） ---
CONNECTIVES = [
    "然而", "因此", "此外", "同时", "不仅", "而且", "尽管", "虽然", "因为", "所以",
    "并且", "以及", "从而", "进而", "总的来说", "值得注意", "由此可见", "换言之",
    "一方面", "另一方面", "首先", "其次", "最后", "与此同时", "除此之外", "正因如此",
]
IDIOMS = [
    "一举两得", "不寒而栗", "不由自主", "小心翼翼", "若无其事", "恍然大悟", "若有所思",
    "不动声色", "不约而同", "难以置信", "如释重负", "心有余悸", "目瞪口呆", "面面相觑",
    "喃喃自语", "迫不及待", "莫名其妙", "理所当然", "显而易见", "络绎不绝", "鸦雀无声",
    "千钧一发", "屏息凝神", "电光石火", "意味深长", "司空见惯", "蓄势待发", "井然有序",
    "错综复杂", "坚不可摧", "深不可测", "望而生畏", "不动如山", "波澜不惊", "心如止水",
]
ORAL = [
    "呢", "吧", "啊", "嘛", "呗", "哈", "啦", "咯", "唉", "哦", "噢", "嗯", "哎", "嘿",
    "哟", "咱", "俺", "咋", "啥", "甭", "俩", "仨", "愣", "瞅", "瞧", "拽", "拎", "揣",
    "搁", "折腾", "嘟囔", "嘀咕", "扒拉", "得亏", "回头", "压根", "敢情", "合着", "拉倒",
    "得了", "算了", "反正", "半天", "半晌", "死活", "硬是", "愣是", "偏不", "才不", "行吧",
]
PUNCT = set("，。！？；：、…—·（）“”‘’《》〈〉～")

SENT_END = set("。！？!?")
OPEN_Q = set("“‘「『")
CLOSE_Q = set("”’」』")

# ---------------------------------------------------------------- 文本处理


def read_text(path: str) -> str:
    if path == "-":
        return sys.stdin.read()
    raw = Path(path).read_bytes()
    for enc in ("utf-8-sig", "utf-8", "gb18030", "big5"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def normalize_quotes(text: str) -> str:
    """把成对的半角引号折成中文引号，便于切句与统计对话占比。"""
    out, opened = [], False
    for ch in text:
        if ch == '"':
            out.append("”" if opened else "“")
            opened = not opened
        else:
            out.append(ch)
    return "".join(out)


def clean(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = normalize_quotes(text)
    text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.M)   # markdown 标题
    text = re.sub(r"^\s*[-*>]\s+", "", text, flags=re.M)        # 列表/引用
    text = re.sub(r"\*{1,3}([^*\n]+)\*{1,3}", r"\1", text)      # 粗斜体
    return text


def split_paragraphs(text: str):
    lines = [ln.strip() for ln in text.split("\n")]
    return [ln for ln in lines if ln]


def split_sentences(text: str):
    out, buf, depth = [], [], 0
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch in OPEN_Q:
            depth += 1
            buf.append(ch); i += 1; continue
        if ch in CLOSE_Q:
            depth = max(0, depth - 1)
            buf.append(ch); i += 1; continue
        if ch in SENT_END and (depth == 0 or (depth == 1 and i + 1 < n and text[i + 1] in CLOSE_Q)):
            buf.append(ch)
            j = i + 1
            while j < n and text[j] in CLOSE_Q:
                buf.append(text[j]); depth = max(0, depth - 1); j += 1
            s = "".join(buf).strip()
            if s:
                out.append(s)
            buf, i = [], j
            continue
        if ch == "…":
            j = i
            while j < n and text[j] == "…":
                j += 1
            buf.append(text[i:j])
            if depth == 0 and (j - i) >= 2:
                k = j
                while k < n and text[k] in CLOSE_Q:
                    buf.append(text[k]); depth = max(0, depth - 1); k += 1
                s = "".join(buf).strip()
                if s:
                    out.append(s)
                buf, i = [], k
                continue
            i = j
            continue
        if ch in ('"', "\u201d") and len(buf) > 90:
            pass
        buf.append(ch); i += 1
        if len(buf) >= 150 and ch in "，,、":
            s = "".join(buf).strip()
            if s:
                out.append(s)
            buf = []
    s = "".join(buf).strip()
    if s:
        out.append(s)
    return out


def density(count: float, total: int, per: int = 1000) -> float:
    return count / max(total, 1) * per


def interp(v: float, pts) -> float:
    pts = sorted(pts)
    if v <= pts[0][0]:
        return float(pts[0][1])
    if v >= pts[-1][0]:
        return float(pts[-1][1])
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= v <= x1:
            t = (v - x0) / (x1 - x0) if x1 > x0 else 0.0
            return float(y0 + t * (y1 - y0))
    return float(pts[-1][1])


def char_width(s: str) -> int:
    return sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in s)


def pad(s: str, width: int, align: str = "left") -> str:
    gap = max(0, width - char_width(s))
    return s + " " * gap if align == "left" else " " * gap + s

# ---------------------------------------------------------------- 指标


def detector_profile(text: str, sents, paras):
    """检测器视角的统计特征面。

    朱雀一类检测器不是关键词匹配，是分类器：喂进去的是困惑度、句长突变度（burstiness）、
    连接词/虚词分布、标点与段落节奏。这里不去猜它的权重，只把同一批特征在本机算出来，
    给出「往人写一侧推」的方向。全部是文本自身的统计量，不涉及任何字符级噪声手段。
    """
    chars = re.sub(r"\s", "", text)
    total = len(chars) or 1
    lens = [len(re.sub(r"\s", "", s)) for s in sents] or [0]
    mean = (sum(lens) / len(lens)) or 1
    diffs = [abs(b - a) for a, b in zip(lens, lens[1:])]
    burst = (sum(diffs) / len(diffs) / mean) if diffs else 0.0
    even = (sum(1 for d in diffs if d <= 3) / len(diffs)) if diffs else 1.0
    conn_d = density(sum(text.count(w) for w in CONNECTIVES), total)
    idiom_d = density(sum(text.count(w) for w in IDIOMS), total)
    oral_d = density(sum(text.count(w) for w in ORAL), total)
    ptypes = len({ch for ch in text if ch in PUNCT})
    de_d = density(text.count("的") + text.count("地"), total, 100)
    short_para = sum(1 for x in paras if len(re.sub(r"\s", "", x)) <= 15) / max(len(paras), 1)
    starts_div = len({s[:1] for s in sents}) / max(len(sents), 1)

    feats = [
        ("句长突变度", burst, "≥0.55", interp(burst, [(0.15, 10), (0.3, 40), (0.45, 70), (0.55, 88), (0.7, 100), (0.9, 95)]),
         "长短句交替：每 5-7 句放一个 3-6 字短句，别让段落等长推进", 25),
        ("连接词密度", conn_d, "≤6/千字", interp(conn_d, [(2, 100), (4, 92), (6, 80), (9, 55), (13, 25), (18, 5)]),
         "然而/因此/此外/不仅 是书面论证骨架，小说里删掉一半，让因果自己长", 15),
        ("四字格密度", idiom_d, "≤1.5/千字", interp(idiom_d, [(0.3, 100), (1, 92), (2, 75), (3.5, 45), (5.5, 15)]),
         "成语连发是默认文风；换成大白话动作，一章留一两个点睛就够", 10),
        ("口语标记密度", oral_d, "≥5/千字", interp(oral_d, [(0.5, 5), (1.5, 25), (3, 55), (5, 82), (8, 100), (14, 95)]),
         "呢/吧/啊/嘛/咋/啥 是白话指纹；对话与心声里要自然出现", 18),
        ("标点种类", ptypes, "≥6", interp(ptypes, [(2, 10), (3, 40), (4, 68), (5, 86), (6, 96), (7, 100)]),
         "只有逗号句号＝机器排版；补 …… —— ？！（） 与破折号停顿", 10),
        ("虚词密度", de_d, "≤6/百字", interp(de_d, [(1.5, 100), (2.5, 96), (3.5, 88), (4.5, 76), (6, 55), (8, 25)]),
         "的/地 连缀＝定语套定语；'他的那把生锈的刀'→'他那把锈刀'", 10),
        ("短段比例", short_para * 100, "≥10%", interp(short_para * 100, [(0, 30), (5, 55), (10, 78), (18, 92), (30, 100)]),
         "一句一段是呼吸；全是大段＝匀速机器排版", 6),
        ("句首多样度", starts_div * 100, "≥50%", interp(starts_div * 100, [(25, 30), (35, 55), (45, 75), (55, 92), (70, 100)]),
         "连续同字开头＝模板推进，换切入口", 6),
    ]
    weight = sum(f[5] for f in feats)
    score = sum(f[3] * f[5] for f in feats) / weight
    return dict(score=round(score, 1), burst=burst, even=even, feats=feats)


def analyze(text: str):
    text = clean(text)
    chars = re.sub(r"\s", "", text)
    total = len(chars)
    paras = split_paragraphs(text)
    sents = split_sentences(text)
    sents = [s for s in sents if re.search(r"[\u4e00-\u9fa5A-Za-z0-9]", s)]

    m = {}
    n_sent = len(sents)
    n_para = len(paras)

    # --- 句长
    lens = [len(re.sub(r"\s", "", s)) for s in sents] or [0]
    mean = sum(lens) / len(lens)
    var = sum((x - mean) ** 2 for x in lens) / len(lens)
    std = var ** 0.5
    cv = std / mean if mean else 0.0
    short_ratio = sum(1 for x in lens if x <= 8) / len(lens)
    long_ratio = sum(1 for x in lens if x >= 45) / len(lens)
    m["句数"] = n_sent
    m["平均句长"] = mean
    m["句长变异系数"] = cv
    m["短句占比"] = short_ratio
    m["长句占比"] = long_ratio

    # --- 段长
    plens = [len(re.sub(r"\s", "", p)) for p in paras] or [0]
    pmean = sum(plens) / len(plens)
    pstd = (sum((x - pmean) ** 2 for x in plens) / len(plens)) ** 0.5
    m["段落数"] = n_para
    m["段落长度变异系数"] = (pstd / pmean) if pmean else 0.0

    # --- 套话
    hits = []
    for cat, words in BANKS.items():
        for w in words:
            c = text.count(w)
            if c:
                hits.append((w, cat, c))
    # 套话密度只统计"结构性套话"；副词与模糊量词各有独立指标，避免重复扣分
    STRUCT = {"环境套话", "表情套话", "动作套话", "心理套话", "叙述连接", "抽象大词", "解释插入"}
    cliche_total = sum(h[2] for h in hits if h[1] in STRUCT)
    m["套话总命中"] = cliche_total
    m["套话密度"] = density(cliche_total, total)
    m["套话数"] = cliche_total

    adv = sum(text.count(w) for w in BANKS["软化副词"])
    qnt = sum(text.count(w) for w in BANKS["万能量词"])
    m["副词密度"] = density(adv, total)
    m["万能量词密度"] = density(qnt, total)

    absn = sum(text.count(w) for w in BANKS["抽象大词"])
    m["抽象大词密度"] = density(absn, total)

    expl = sum(text.count(w) for w in BANKS["解释插入"])
    m["解释插入密度"] = density(expl, total)

    # --- 对称结构：三项并列
    triple = re.findall(
        r"(?:[^\s，。！？；：、”“\"（）()]{1,8}、){2}[^\s，。！？；：、”“\"（）()]{1,8}",
        text,
    )
    m["三项并列"] = len(triple)
    m["三项并列密度"] = density(len(triple), total)

    # --- 感官
    sense_counts = {}
    for sense, words in SENSES.items():
        sense_counts[sense] = sum(text.count(w) for w in words)
    s_total = sum(sense_counts.values()) or 1
    present = [k for k, v in sense_counts.items() if v >= max(1, s_total * 0.01)]
    m["感官类别数"] = len(present)
    m["视觉占比"] = sense_counts["视觉"] / s_total
    m["感官分布"] = sense_counts

    # --- 对话
    dlg = sum(len(x) for x in re.findall(r"“[^”]*”|「[^」]*」", text))
    m["对话占比"] = dlg / max(total, 1)

    # --- 句首重复
    starts = [s[:2] for s in sents]
    rep = sum(1 for a, b in zip(starts, starts[1:]) if a == b and len(a) == 2)
    m["句首重复率"] = rep / max(len(starts) - 1, 1)

    # --- 四字片段重复
    norm = re.sub(r"[^\u4e00-\u9fa5]", "", text)
    grams = Counter(norm[i:i + 4] for i in range(max(0, len(norm) - 3)))
    hot = sum(c for g, c in grams.items() if c >= 3)
    m["模板重复率"] = hot / max(len(norm) - 3, 1)

    # --- 具体度
    digits = len(re.findall(r"\d+", text))
    ono = sum(text.count(w) for w in ONO)
    cn_num = len(re.findall(r"[一二三四五六七八九十百千万半两]{1,3}(?:只|条|根|块|张|把|双|粒|颗|片|滴|支|瓶|碗|包|盒|杯|辆|间|年|天|岁|步|次|个人)", text))
    m["具体细节密度"] = density(digits + ono + cn_num, total)

    # --- 的 密度
    m["的密度"] = density(text.count("的"), total, 100)

    # --- 打分
    metrics = []

    def add(key, value, unit, target, score, weight, hint, group):
        metrics.append(dict(key=key, value=value, unit=unit, target=target,
                            score=round(score, 1), weight=weight, hint=hint, group=group))

    add("句长变异系数", cv, "", "≥0.55", interp(cv, [(0.2, 0), (0.35, 30), (0.45, 55),
        (0.55, 78), (0.7, 100), (0.95, 95), (1.3, 78), (1.8, 55)]), 18,
        "每 5-7 句里插一个 3-6 字短句；把一句 40 字以上的长句拆成动作串", "句法")
    add("短句占比", short_ratio * 100, "%", "10-30%", interp(short_ratio * 100,
        [(0, 5), (5, 45), (12, 88), (20, 100), (32, 88), (45, 55)]), 8,
        "短句是呼吸点，缺了就是匀速朗读；补在情绪落地处，别均匀撒", "句法")
    add("长句占比", long_ratio * 100, "%", "3-15%", interp(long_ratio * 100,
        [(0, 80), (2, 90), (5, 96), (10, 100), (18, 85), (28, 50), (40, 25)]), 7,
        "长句要有'拖着走'的必要（回忆、铺陈、窒息感），否则拆", "句法")
    add("段落长度变异系数", m["段落长度变异系数"], "", "0.6-1.2",
        interp(m["段落长度变异系数"], [(0.15, 20), (0.35, 55), (0.6, 92), (0.9, 100),
                                       (1.3, 85), (2.2, 60)]), 8,
        "长段之后必须有一句一段；连续 5 段等长 = 机器排布", "节奏")
    add("套话密度", m["套话密度"], "处/千字", "≤2", interp(m["套话密度"],
        [(0, 100), (1, 95), (2.5, 80), (4, 55), (6, 30), (9, 8)]), 16,
        "按清单逐个换成具体动作或物件；套话是'通用人'的表情包", "词汇")
    add("副词密度", m["副词密度"], "处/千字", "≤8", interp(m["副词密度"],
        [(0, 100), (4, 92), (8, 78), (12, 55), (18, 25), (26, 5)]), 9,
        "缓缓/轻轻/微微 是最省力的手感；一个动作能自证速度就别加副词", "词汇")
    add("万能量词密度", m["万能量词密度"], "处/千字", "≤6", interp(m["万能量词密度"],
        [(0, 100), (3, 92), (6, 78), (10, 55), (16, 25)]), 6,
        "一抹/一丝/一缕 是模糊计量；换成具体形状、尺寸、来源", "词汇")
    add("三项并列密度", m["三项并列密度"], "处/千字", "≤0.8", interp(m["三项并列密度"],
        [(0, 100), (0.4, 90), (0.9, 68), (1.6, 42), (2.5, 18)]), 8,
        "三项并列是排比惯性；改成两项或四项、或只留一项最狠的", "句法")
    add("抽象大词密度", m["抽象大词密度"], "处/千字", "≤4", interp(m["抽象大词密度"],
        [(0, 100), (2, 92), (4, 72), (7, 45), (11, 18), (16, 5)]), 9,
        "气息/意志/压迫感 是在替读者总结感受；改写成可测的物理现象", "词汇")
    add("解释插入密度", m["解释插入密度"], "处/千字", "≤1", interp(m["解释插入密度"],
        [(0, 100), (0.5, 92), (1.2, 70), (2.2, 45), (3.5, 18)]), 6,
        "把结论喂给读者；删掉连词让因果自己长出来", "叙述")
    add("感官类别数", len(present), "类", "≥4", interp(len(present),
        [(1, 10), (2, 35), (3, 60), (4, 88), (5, 100), (6, 100)]), 6,
        "补听觉/触觉/嗅觉/体感，尤其体感（胃、喉咙、指尖）", "感官")
    add("视觉占比", m["视觉占比"] * 100, "%", "≤60%", interp(m["视觉占比"] * 100,
        [(35, 100), (55, 92), (70, 68), (85, 35), (95, 12)]), 4,
        "视觉词过载是最典型的'摄像头写作'", "感官")
    add("对话占比", m["对话占比"] * 100, "%", "12-40%", interp(m["对话占比"] * 100,
        [(0, 35), (5, 55), (12, 85), (22, 100), (35, 95), (55, 72), (75, 45)]), 6,
        "对话是唯一能自然带出口癖、打断和答非所问的地方；按体裁浮动，议论为主可忽略", "叙述")
    add("句首重复率", m["句首重复率"] * 100, "%", "≤15%", interp(m["句首重复率"] * 100,
        [(0, 100), (12, 92), (22, 78), (35, 55), (50, 30), (65, 12)]), 6,
        "连续三句同一开头 = 模板推进；换视角主语、换切入口", "句法")
    add("模板重复率", m["模板重复率"] * 100, "%", "≤3%", interp(m["模板重复率"] * 100,
        [(0.5, 100), (2, 92), (3.5, 75), (6, 50), (10, 25), (15, 8)]), 5,
        "四字片段反复出现，说明句壳复用；这类句子读起来眼熟", "句法")
    add("具体细节密度", m["具体细节密度"], "处/千字", "≥2", interp(m["具体细节密度"],
        [(0, 30), (0.8, 55), (2, 82), (4, 96), (7, 100)]), 6,
        "数字、拟声、品牌、价格、尺寸——具体是可信度的唯一来源", "叙述")
    add("的密度", m["的密度"], "字/百字", "≤5", interp(m["的密度"],
        [(0, 85), (1.5, 92), (2.5, 100), (4.2, 100), (5.4, 85), (7, 55), (9, 25)]), 5,
        "的 连缀=定语套定语；'他的那把生锈的刀'→'他那把锈刀'", "词汇")

    W = sum(x["weight"] for x in metrics)
    score = sum(x["score"] * x["weight"] for x in metrics) / W

    # 硬伤封顶：任何一维低到 22 以下，都说明有一处显眼的模板痕迹，
    # 其余维度再好也盖不住——总评不允许被平均分抬高。
    floor = min(x["score"] for x in metrics)
    cap = 46 if floor <= 8 else (58 if floor <= 15 else (70 if floor <= 22 else 100))
    score = min(score, cap)
    hard = [x["key"] for x in metrics if x["score"] <= 22]

    # --- 逐句嫌疑
    sent_flags = []
    for idx, s in enumerate(sents):
        flags = []
        for cat, words in BANKS.items():
            for w in words:
                if w in s:
                    flags.append((w, FLAG_WEIGHT[cat], cat))
                    break
        ln = len(re.sub(r"\s", "", s))
        if ln >= 45:
            flags.append(("长句 %d 字" % ln, 2, "长句"))
        if re.search(r"不是.{1,20}而是", s):
            flags.append(("不是A而是B", 2, "对称"))
        if re.search(r"像.{1,12}一样", s) or re.search(r"仿佛.{1,12}般", s):
            flags.append(("通用比喻", 2, "比喻"))
        if s.count("、") >= 2:
            flags.append(("三项并列", 2, "对称"))
        if "--" in s or "——" in s:
            flags.append(("破折号解释", 1, "叙述"))
        w = sum(f[1] for f in flags)
        if w >= 3:
            sent_flags.append((w, idx, s, flags))
    sent_flags.sort(key=lambda x: (-x[0], x[1]))

    # --- 段末总结句
    para_last = []
    for p in paras:
        ps = split_sentences(p)
        if not ps:
            continue
        last = ps[-1]
        body = last.strip("“”「」。！？… ")
        if len(body) <= 26 and (body.startswith(SUMMARY_STARTS) or any(
                k in last for k in SUMMARY_WORDS)):
            para_last.append(last)

    # --- 手术清单
    ops = [
        ("删套话", cliche_total, "按清单替换，一条换一个具体物象"),
        ("拆长句", sum(1 for x in lens if x >= 45), "≥45 字的句子拆成动作串"),
        ("打散三项并列", len(triple), "留最狠的一项，其余转成动作"),
        ("去段末总结句", len(para_last), "段末停在动作/物件上"),
        ("减虚词", adv + qnt, "副词与模糊量词各砍一半"),
        ("补体感", max(0, 4 - len(present)), "胃/喉咙/指尖/耳鸣 各一"),
    ]

    risk = "低" if score >= 80 else ("中" if score >= 65 else ("中高" if score >= 50 else "高"))

    return dict(
        total=total, sents=n_sent, paras=n_para,
        metrics=metrics, score=round(score, 1), risk=risk, hard=hard,
        detector=detector_profile(text, sents, paras),
        cliche_hits=sorted(hits, key=lambda x: -x[2])[:24],
        cliche_count=cliche_total,
        sent_flags=sent_flags[:40], para_last=para_last,
        ops=ops, sense=sense_counts,
        pass_gate=None,
    )

# ---------------------------------------------------------------- 输出


GROUP_ORDER = ["句法", "节奏", "词汇", "叙述", "感官"]


def bar(score: float, width: int = 20) -> str:
    fill = int(round(score / 100 * width))
    return "[" + "#" * fill + "." * (width - fill) + "]"


def render(res, path: str, top: int, detailed_detector: bool = False):
    L = []
    L.append("=" * 74)
    L.append("  AI 味扫描报告 · %s" % path)
    L.append("  字数 %s · 句数 %s · 段数 %s" % (res["total"], res["sents"], res["paras"]))
    L.append("=" * 74)
    L.append("")
    L.append("【总评】人味指数 %.1f / 100   风险等级：%s   %s" % (
        res["score"], res["risk"], bar(res["score"])))
    if res.get("hard"):
        L.append("  硬伤维度（单项 ≤22，总评已封顶）：%s" % "、".join(res["hard"]))
    L.append("")
    det = res.get("detector")
    if det:
        L.append("")
        L.append("  【检测器视角】人写度 %.1f / 100（统计分布，不保证任何检测器通过）" % det["score"])
        for name, val, target, sc, tip, _w in det["feats"]:
            L.append("    %s %5.1f 分  实测 %s（目标 %s）" % (pad(name, 14), sc, _num(val), target))
        weak = [f for f in det["feats"] if f[3] < 75]
        shown = weak if detailed_detector else weak[:3]
        for f in shown:
            L.append("    ↳ %s：%s" % (f[0], f[4]))

    worst = sorted(res["metrics"], key=lambda x: x["score"] * x["weight"])[:4]
    L.append("首要病灶（按扣分权重）：")
    for i, x in enumerate(worst, 1):
        L.append("  %d. %-10s %-10s 目标 %-9s 得分 %.0f" % (
            i, x["key"], fmt(x["value"], x["unit"]) + x["unit"], x["target"], x["score"]))
        L.append("     → %s" % x["hint"])
    L.append("")

    for g in GROUP_ORDER:
        rows = [x for x in res["metrics"] if x["group"] == g]
        if not rows:
            continue
        L.append("-" * 74)
        L.append("  【%s】" % g)
        for x in rows:
            L.append("  %s %s %5.1f  %s" % (
                pad(x["key"], 16), bar(x["score"], 12), x["score"],
                "实测 %s / 目标 %s" % (fmt(x["value"], x["unit"]), x["target"])))
        L.append("")

    L.append("-" * 74)
    cd = [x for x in res["metrics"] if x["key"] == "套话密度"][0]
    L.append("  【套话命中】结构性套话 %d 处（每千字 %.1f，目标 %s）；下列含高频虚词，按类看" % (
        res["cliche_count"], cd["value"], cd["target"]))
    for w, cat, c in res["cliche_hits"][:16]:
        L.append("    · %-6s ×%-3d [%s]" % (w, c, cat))
    L.append("")

    L.append("-" * 74)
    L.append("  【高嫌疑句】（只列前 %d 条，权重越高越像模板）" % top)
    for w, idx, s, flags in res["sent_flags"][:top]:
        L.append("    #%d 嫌疑 %d | %s" % (idx + 1, w, s))
        L.append("        ↳ %s" % "、".join("%s(%s)" % (f[0], f[2]) for f in flags))
    L.append("")

    if res["para_last"]:
        L.append("-" * 74)
        L.append("  【疑似段末总结句】%d 句（每段末尾都要点题 → 读者没有自己想的余地）"
                 % len(res["para_last"]))
        for s in res["para_last"][:8]:
            L.append("    · %s" % s)
        L.append("")

    L.append("-" * 74)
    L.append("  【手术清单】改多少算够")
    for name, cnt, how in res["ops"]:
        L.append("    %-12s %-6s  %s" % (name, ("%d 处" % cnt) if cnt else "—", how))
    L.append("")
    L.append("  说明：分数只衡量'写作是否偷懒'，与任何检测器无关。")
    L.append("  单项 >85 且总评 <75 时，问题通常只在最差的两三项上。")
    L.append("=" * 74)
    return "\n".join(L)


def _num(v):
    return ("%.2f" % v) if isinstance(v, float) else str(v)


def fmt(v, unit):
    if unit in ("%",):
        return "%.1f" % v
    if isinstance(v, float):
        return "%.2f" % v
    return str(v)


def compare(res_a, res_b, name_a="稿件", name_b="样本"):
    rows, rev = [], {}
    for x in res_a["metrics"]:
        rev[x["key"]] = x
    print("=" * 88)
    print("  对比：%s vs %s" % (name_a, name_b))
    print("=" * 88)
    print("  %s %s %s %s" % (pad("指标", 16), pad(name_a, 12, "right"),
                             pad(name_b, 12, "right"), pad("差值", 10, "right")))
    for x in res_b["metrics"]:
        y = rev.get(x["key"])
        if not y:
            continue
        d = y["value"] - x["value"]
        print("  %s %s %s %s" % (pad(x["key"], 16), pad("%.2f" % y["value"], 12, "right"),
                                 pad("%.2f" % x["value"], 12, "right"),
                                 pad("%+.2f" % d, 10, "right")))
    print("-" * 88)
    print("  总评：%s %.1f  |  %s %.1f   差 %+.1f" % (
        name_a, res_a["score"], name_b, res_b["score"], res_a["score"] - res_b["score"]))
    print("=" * 88)


def main(argv=None):
    ap = argparse.ArgumentParser(description="中文小说 AI 味量化扫描（只诊断，不改写）")
    ap.add_argument("file", help="稿件路径；- 表示从 stdin 读取")
    ap.add_argument("--top", type=int, default=12, help="列出多少条高嫌疑句")
    ap.add_argument("--json", action="store_true", help="输出 JSON")
    ap.add_argument("--gate", type=float, default=None, help="人味指数低于阈值时退出码 1")
    ap.add_argument("--compare", metavar="HUMAN", help="与人类样本对比")
    ap.add_argument("--detector", action="store_true", help="展开检测器视角的全部改法")
    args = ap.parse_args(argv)

    text = read_text(args.file)
    if not text.strip():
        print("空文件。", file=sys.stderr)
        return 2
    res = analyze(text)

    if args.compare:
        base = analyze(read_text(args.compare))
        compare(res, base, Path(args.file).name, Path(args.compare).name)
    elif args.json:
        out = {k: v for k, v in res.items() if k != "sent_flags"}
        out["sent_flags"] = [
            dict(weight=w, index=i + 1, text=s,
                 flags=[dict(hit=f[0], weight=f[1], cat=f[2]) for f in fl])
            for w, i, s, fl in res["sent_flags"]
        ]
        print(json.dumps(out, ensure_ascii=False, indent=2))
    else:
        if res["total"] < 300:
            print("[注意] 文本不足 300 字，句长/段落类指标波动很大，只作参考。\n")
        print(render(res, args.file, args.top, args.detector))

    if args.gate is not None and res["score"] < args.gate:
        print("\n[闸门] 人味指数 %.1f < %.1f，退回重写。" % (res["score"], args.gate),
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
