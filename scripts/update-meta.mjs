/**
 * update-meta.mjs —— 更新 GitHub / Gitee 仓库简介、topics、homepage，并改写最新 Release 说明。
 * 令牌从环境变量取：XIAOYU_PUBLISH_TOKEN（GitHub）、GITEE_TOKEN（Gitee）。
 */
const GH = process.env.XIAOYU_PUBLISH_TOKEN;
const GT = process.env.GITEE_TOKEN;
const GH_REPO = 'gqpG10/dsh-xiaoyu-novel';
const GT_REPO = 'gqp20031110/dsh-xiaoyu-novel';

const GH_DESC = '小鱼创作台 —— DSH 网文创作辅助插件。AI 主编带六帮手写长篇：七阶段工作流、逐章去 AI 味门禁、伏笔状态机、可视化创作台（九 tab / 全书体检 / 六维趋势 / 章节蓝图 / 合规体检）。书稿是 novel/ 纯文本文件，grep 即可查到任何一条伏笔。';
const GT_DESC = '小鱼创作台 —— DSH 网文创作插件（GitHub 同步，国内直连可用）。AI 主编 + 六帮手写长篇网文：七阶段工作流、逐章去 AI 味门禁、伏笔状态机、可视化创作台（九个 tab / 全书体检 / 六维趋势 / 章节蓝图 / 合规敏感词体检 / 题材雷达 / 写作热力格）。书稿是 novel/ 下的纯文本文件，可 git 版本化。';
const TOPICS = ['dsh', 'deepseek-harness', 'plugin', 'novel', 'writing', 'web-novel', 'ai-writing', 'chinese-novel', 'novel-writing', 'writing-tools'];

const RELEASE_BODY = `## 小鱼创作台 v3.25.1

**先说这插件是干嘛的**（每版都放这段，任何人第一次点进来都看得懂）

小鱼创作台是 DSH（DeepSeek Harness）里的网文创作辅助插件。装上后，AI 主助手变成「网文主编」，带大纲、写手、去 AI 味、审校、设定、考据六个帮手一起写长篇。整本书就是工作区里的 \`novel/\` 目录——纯 markdown/YAML，没有数据库也没有 API 层，查「所有未回收伏笔」就是 grep 一行。

配上可视化创作台面板：九个 tab（概览/章节/角色/伏笔/关系图/时间线/设定/风格/索引），外加全书体检、六维质量趋势、章节蓝图、合规敏感词体检、题材雷达、写作热力格、本章上下文包。逐章去过 AI 味门禁，人味指数不到线就打回重写。

**本版改了什么**

- 修正文案硬伤：README 曾把「小鱼」的来历错记成韩愈《小鱼传》——韩愈写的是《毛颖传》，喻的是毛笔「毛颖」，跟「小鱼」没有关系。现改为如实说明：名字是本插件自取的，取「笔」之意。
- 中英文 README、设计文档同步更正；致谢段一并改掉。
- 仓库简介统一口径：「六帮手」（原 package.json 误写五帮手）；GitHub 简介去掉过时的「私有」字样。
- Gitee 简介改写为完整功能说明（不再只是「GitHub 镜像」）。
- GitHub 补上 topics 标签与主页字段。
- **致谢补全**：把代码注释里散落的借鉴来源逐条列进 README——Pagekin（章节蓝图）、oh-story-claudecode（按需加载/质检记录）、webnovel-writer（六维审查）、chronicler 与墨屿（作者管资产/章后记忆）、novel-skills（活设定集）、sumeru（三级敏感内容分级）、fanqie-radar（榜单快照）、StoryGraphs（出席矩阵）、obsidian-writing-studio（写作冲刺）、obsidian-snowflake-method（雪花法）、open-wrimo（统计口径）、random_chinese_fantasy_names（起名类目）、graphify-novel（群像 hub 检测），以及 DSH 宿主、Node.js、node:test。

**安装**

\`dsha-plugin import dsh-xiaoyu-novel-3.25.1.zip\`，然后重启 DSH Web。升级走面板「检测更新」，GitHub 被墙时自动回落 Gitee 通道。
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

  const rel = await gh('https://api.github.com/repos/' + GH_REPO + '/releases/tags/v3.25.1');
  if (rel.status === 200) {
    const d = await rel.json();
    const up = await gh('https://api.github.com/repos/' + GH_REPO + '/releases/' + d.id, {
      method: 'PATCH',
      body: JSON.stringify({ body: RELEASE_BODY }),
    });
    console.log('github release body PATCH:', up.status);
  } else {
    console.log('github release v3.25.1 not found yet:', rel.status);
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
