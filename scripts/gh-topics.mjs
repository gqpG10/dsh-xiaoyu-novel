const t = process.env.XIAOYU_PUBLISH_TOKEN;
const H = { Authorization: "Bearer " + t, "User-Agent": "xiaoyu-meta", Accept: "application/vnd.github+json" };
const topics = ["dsh","deepseek-harness","plugin","novel","writing","web-novel","ai-writing","chinese-novel","novel-writing","writing-tools"];
const r = await fetch("https://api.github.com/repos/gqpG10/dsh-xiaoyu-novel/topics", { method: "PUT", headers: H, body: JSON.stringify({ names: topics }) });
console.log("topics PUT:", r.status, (await r.text()).slice(0, 300));