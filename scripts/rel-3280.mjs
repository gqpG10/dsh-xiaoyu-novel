const t = process.env.XIAOYU_PUBLISH_TOKEN;
const H = { Authorization: "Bearer " + t, "User-Agent": "xiaoyu-meta", Accept: "application/vnd.github+json" };
const body = [
  "## 小鱼创作台 v3.28.0",
  "",
  "**章节列表支持正序 / 倒序**",
  "",
  "- 章节 tab 右上角新增「正序 ↑ / 倒序 ↓」切换按钮。",
  "- 正序：按卷章号从第 1 章往后（默认）；倒序：最近写的章在最上面，便于追更视角回看最近几章。",
  "- 选择记忆在 localStorage（xiaoyu.chapDesc），重开面板、切书、换设备登录同一浏览器都保持上次的顺序。",
  "- 排序用文件名字典序：v01-c002.md < v02-c001.md，卷章号天然可比，不依赖额外索引。",
  "",
  "**说明**：搜索、批量选择、门禁徽标、状态标签在两种顺序下都照常工作。",
  "",
  "**测试**：346 项，0 失败。",
].join("\n");
const rel = await fetch("https://api.github.com/repos/gqpG10/dsh-xiaoyu-novel/releases/tags/v3.28.0", { headers: H });
const d = await rel.json();
const up = await fetch("https://api.github.com/repos/gqpG10/dsh-xiaoyu-novel/releases/" + d.id, { method: "PATCH", headers: H, body: JSON.stringify({ body }) });
console.log("release PATCH:", up.status);