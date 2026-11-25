/**
 * update-meta.mjs —— 更新 GitHub / Gitee 仓库简介、topics、homepage，并改写最新 Release 说明。
 * 令牌从环境变量取：XIAOYU_PUBLISH_TOKEN（GitHub）、GITEE_TOKEN（Gitee）。
 */
const GH = process.env.XIAOYU_PUBLISH_TOKEN;
const GT = process.env.GITEE_TOKEN;
const GH_REPO = 'gqpG10/dsh-xiaoyu-novel';
const GT_REPO = 'gqp20031110/dsh-xiaoyu-novel';

const GH_DESC = '小鱼创作台 —— DSH 网文创作辅助插件。AI 主编带六帮手写长篇：七阶段工作流、逐章去 AI 味门禁、伏笔状态机、可视化创作台（15 tab / 全书体检 / 六维趋势 / 章节蓝图 / 合规体检 / 题材雷达）。书稿是 novel/ 纯文本文件，grep 即得。';
const GT_DESC = '小鱼创作台 —— DSH 网文创作插件（GitHub 同步，国内直连可用）。AI 主编 + 六帮手写长篇网文：七阶段工作流、逐章去 AI 味门禁、伏笔状态机、可视化创作台（15 tab / 全书体检 / 六维趋势 / 章节蓝图 / 合规敏感词体检 / 题材雷达 / 写作热力格）。书稿是 novel/ 下的纯文本文件，可 git 版本化。';
const TOPICS = ['dsh', 'deepseek-harness', 'plugin', 'novel', 'writing', 'web-novel', 'ai-writing', 'chinese-novel', 'novel-writing', 'writing-tools'];

const RELEASE_BODY = `## 小鱼创作台 v3.25.3

**先说这插件是干嘛的**（每版都放这段，第一次点进来的人也看得懂）

小鱼创作台是 DSH（DeepSeek Harness）里的网文创作辅助插件。装上后，AI 主助手变成「网文主编」，带大纲、写手、去 AI 味、审校、设定、考据六个帮手一起写长篇。整本书就是工作区里的 \`novel/\` 目录——纯 markdown/YAML，没有数据库也没有 API 层。

配上可视化创作台面板：15 个 tab（概览/项目/章节/门禁/体检/待办/本章/角色/伏笔/关系/时间线/设定/索引/风格/工具），外加全书体检、六维质量趋势、章节蓝图、合规敏感词体检、题材雷达、写作热力格、本章上下文包。逐章去过 AI 味门禁，人味指数不到线就打回重写。

**本版改了什么**

- **README 完全重写**：中文与英文两份都换成完整版——它解决什么问题、安装、五分钟上手、面板 15 个 tab 逐个说明、七阶段工作流、主编与六帮手分工、命令行 22 条命令、novel/ 目录结构、十个技能包、19 档风格预设、质量工具、更新与国内加速、常见问题。
- **致谢补全**：把代码注释里散落的借鉴来源逐条列明——Pagekin（章节蓝图）、oh-story-claudecode（按需加载 / 质检记录）、webnovel-writer（六维审查）、chronicler 与墨屿（作者管资产 / 章后记忆）、novel-skills（活设定集）、sumeru（三级敏感内容分级）、fanqie-radar（榜单快照）、StoryGraphs（出席矩阵）、obsidian-writing-studio（写作冲刺）、obsidian-snowflake-method（雪花法）、open-wrimo（统计口径）、random_chinese_fantasy_names（起名类目）、graphify-novel（群像 hub 检测），以及 DSH 宿主、Node.js、node:test。
- **名字的来历更正**：删掉「韩愈《小鱼传》」的错误说法——韩愈写的是《毛颖传》，喻毛笔「毛颖」，与「小鱼」无关。名字是本插件自取的，取「笔」之意。
- **补上真正的源头**：本项目由 [dsh-maoying（毛颖创作台）](https://github.com/lifangjin/dsh-maoying) 更改而来——书稿结构、主编 + 帮手分工、创作台面板的形态都源自那里；小鱼在它之后把帮手扩到六个、加重了去 AI 味门禁与体检体系。
- **仓库简介统一口径**：「六帮手」（原 package.json 误写五帮手）；GitHub 简介去掉过时的「私有」字样；Gitee 简介改为完整功能说明；GitHub 补上 topics 标签与主页字段。

**安装**

\`dsha-plugin import dsh-xiaoyu-novel-3.25.2.zip\`，然后重启 DSH Web。升级走面板「检测更新」，GitHub 被墙时自动回落 Gitee 通道。

**测试**：339 项，0 失败。
`;

async function gh(url, opts = {}) {
  return fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + GH, 'User-Agent': 'xiaoyu-meta', Accept: 'application/vnd.github+json', ...(opts.headers || {}) } });
}
async function gt(url, opts = {}) {
  return fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
}

async function updateGithub() {
  const r = await gh('https://api.github.com/repos/' + GH_REPO, {
    method: 'PATCH',
    body: JSON.stringify({ description: GH_DESC, homepage: 'https://gitee.com/gqp20031110/dsh-xiaoyu-novel', topics: TOPICS }),
  });
  console.log('github repo PATCH:', r.status);
  if (r.status !== 200) console.log((await r.text()).slice(0, 200));

  const rel = await gh('https://api.github.com/repos/' + GH_REPO + '/releases/tags/v3.25.3');
  if (rel.status === 200) {
    const d = await rel.json();
    const up = await gh('https://api.github.com/repos/' + GH_REPO + '/releases/' + d.id, {
      method: 'PATCH',
      body: JSON.stringify({ body: RELEASE_BODY }),
    });
    console.log('github release body PATCH:', up.status);
  } else {
    console.log('github release v3.25.3 not found:', rel.status);
  }
}

async function updateGitee() {
  const r = await gt('https://gitee.com/api/v5/repos/' + GT_REPO, {
    method: 'PATCH',
    body: JSON.stringify({ access_token: GT, description: GT_DESC }),
  });
  console.log('gitee repo PATCH:', r.status, (await r.text()).slice(0, 160));
}

if (process.argv[2] === 'github') await updateGithub();
else if (process.argv[2] === 'gitee') await updateGitee();
else { await updateGithub(); await updateGitee(); }
