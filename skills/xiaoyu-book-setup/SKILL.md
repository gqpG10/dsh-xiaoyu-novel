---
name: xiaoyu-book-setup
description: （小鱼创作台·开书与连载）开书九件套（概览/章节/角色/伏笔/关系/时间线/设定/写作风格/索引板）的必填内容与合格线、缺件补建流程、每章收尾要同步维护的账目清单。新书立项、phase 从 setting 进 outline/writing、或面板「开书清单」有缺项时加载。
---

# 开书九件套与连载维护（xiaoyu-book-setup）

## 0. 格式铁律（先于内容）

模板（`templates/novel/` 与项目内 `novel/README.md`）是唯一格式权威，生成/改写任何文件都只能照抄：

- 键名与键序不许动，不加自创字段，不删注释行以外的结构；
- frontmatter 必须 `---` 起、`---` 收，键一行一个，两空格缩进；
- yml 顶层只能是数组或平键，数组写法固定 `- key: value`，禁止深嵌套、禁止 JSON；
- 枚举只用全称（pending/writing/review/accepted 等），不自造缩写；
- 章节文件名 `vXX-cXXX.md`，角色/设定/考据用英文 slug；
- 正文不写 Markdown 标题、不加 HTML；`index.yml` 只重建不手改。

每次落盘后跑 `xiaoyu-novel check`（或面板「静态体检」）：未知键、缺字段、键序偏差、围栏未闭合、文件名不合规、索引与目录不一致都会报出来，改到全绿为止。

## 0. 为什么必须补全

写作卡（`xiaoyu-novel brief`）和帮手开工时读的就是这九个面：project.yml 定基调与阶段，index.yml 定章节全局，style.md 定语言，characters/world 定人，foreshadows/relations/timeline 定因果与期待。任何一面空着，写手只能靠猜——猜出来的情节后面全部要返工。**九件套没齐，不开写。**

## 1. 九件套总表

| # | 面 | 文件/目录 | 最低合格线 | 落盘角色 |
|---|---|---|---|---|
| 1 | 概览 | `novel/project.yml` | title/genre/length/language/description/phase 全非空；phase 在七枚举内 | 主编 |
| 2 | 章节 | `novel/chapters/` | ≥3 章章纲 + 首章正文 ≥300 字；frontmatter 含五维字段 | 大纲师 / 写手 |
| 3 | 角色 | `novel/characters/*.md` | ≥3 张卡（主角/核心反派/关键配角），name+role+motivation+arc 齐全 | 设定管理员 |
| 4 | 伏笔 | `novel/foreshadows.yml` | ≥3 条，id 唯一，含 planted_chapter 与 expected_resolve | 设定管理员 |
| 5 | 关系 | `novel/relations.yml` | ≥2 条，a/b 用角色卡 slug，intensity 1-5 | 设定管理员 |
| 6 | 时间线 | `novel/timeline.yml` | ≥2 条开篇前史，year 可排序 | 设定管理员 |
| 7 | 设定 | `novel/world/*.md` | ≥2 条：金手指规则（能力/代价/边界）、对抗格局；每条有正文而非只 frontmatter | 设定管理员 |
| 8 | 写作风格 | `novel/style.md` | 语言档位（大白话/文白/古风）+ 禁忌 + 节奏约定，正文 ≥200 字 | 主编 |
| 9 | 索引板 | `novel/index.yml` | 建章后重建，章节数与 chapters/ 一致 | 设定管理员 |

外加两个**写作期才需要**的账：`volumes.yml`（outline 阶段必须）、`memories.yml` + `clue-board.yml`（写够一卷后必须有内容）。

## 2. 每面的合格线（不是有文件就算）

- **概览**：description 要能让没读过的人一句话说清这书讲什么；phase 与真实进度一致，不许提前上报。
- **章节**：章纲必须写「本章发生什么、谁想要什么、被什么挡住、结尾钩子」；五维字段不许全填「无」。
- **角色**：主角卡必须有「想要什么 / 被什么挡住 / 手里有什么筹码」；反派卡必须有「他和主角争的是什么」；配角卡至少一句动机。名字、年龄、身份要与正文一致。
- **伏笔**：每条写清「埋什么、读者该起什么疑、计划哪章回收」。status 用 planted/progressing/resolved/abandoned，不许自造。
- **关系**：每条写 a/b/type/intensity/description；新角色进场只要和在场者有关系，必须登记。
- **时间线**：year 用可排序格式（如「开元三年」或「2026-03-01」），同一条目只写一幕，不写综述。
- **设定**：写清**边界与代价**。只写「很强」等于没写；写「用一次少活一年」才算数。
- **写作风格**：语言档位、禁用词、句长节奏、视角规则各一行，可以直接被写手当验收标准。
- **索引板**：每次建章/改章号后重建（面板「重建索引」或 `xiaoyu-novel index`），不许手改到与目录不符。

## 3. 开书流程（与 Collab 四步咬合）

1. Collab① 设定共创结束前：把 1/3/4/5/6/7/8 七面落盘（概要、角色、伏笔、关系、时间线、设定、风格），缺一项先问用户，不臆测。
2. Collab② 分卷规划：`volumes.yml` 落盘，章节范围写到卷。
3. Collab③ 前三章：先落 3 章章纲（面 2 的前半），再写首章正文；写完重建 `index.yml`（面 9）。
4. 自检：`xiaoyu-novel setup` 或面板概览「开书清单」九项全绿，才允许 phase 进 writing。

## 4. 每章收尾维护（定稿前必做）

一章写完后，按「被谁动到就更新谁」逐项过：

- `chapters/`：正文与 frontmatter（status/words/summary/五维）与实际一致；
- `characters/`：本章新出场角色补卡；老角色有身份/伤势/立场变化，改卡；
- `foreshadows.yml`：新埋的登记（planted），推进的改 progressing，回收的改 resolved 并写 resolved_chapter；
- `relations.yml`：新关系/关系变化逐条登记，不合并、不覆盖历史；
- `timeline.yml`：本章关键事件按时间入账，一条一幕；
- `world/`：本章新规则、新地点、新组织落条，写清边界；
- `memories.yml`：章级记忆一条（谁做了什么、结果如何）；
- `clue-board.yml`：本章新线索/红鲱鱼入板；
- `index.yml`：建章或改章号后重建。

只写正文不记这几本账，下一章就会自相矛盾——这是长篇最常见的崩盘点。

## 5. 缺件补建流程（委派模板）

```
以 lore 身份补齐开书九件套中的缺项：<逐项列缺什么>。
每项按 novel/README.md 的数据规范落盘；角色卡 name/role/motivation/arc 必填，
伏笔写 planted_chapter 与 expected_resolve，关系 a/b 用角色卡 slug，
设定写清边界与代价。补完逐项回报「已落盘：<文件>」，不要只报完成。
```

补建顺序：概览 → 风格 → 角色 → 设定 → 关系 → 伏笔 → 时间线 → 章节 → 索引。前五项是后面四项的输入，顺序反了会重写。

## 6. 自检

- 面板概览「开书清单」：九项逐条 ✓/缺，点行直接跳对应 tab。
- `xiaoyu-novel setup [dir]`：命令行同一套判据，缺项退出码 1（可接 pre-commit）。
- `xiaoyu-novel check [dir]`：结构之外的字段级问题（枚举越界、伏笔章号、时间线乱序）。

## 7. 常见错误

- 只建文件不填内容：模板占位（「一句话简介」「待定」）不算完成。
- 角色卡建了不用：出场 0 次的卡要么补戏要么删——面板「全书体检」会点名。
- 伏笔只埋不收：expected_resolve 到期未收，check 会报超期。
- 关系只记主角：配角之间的关系决定群像戏，别只画主角星形图。
- index.yml 手改：永远从 volumes.yml + chapters/ 重建。
