/**
 * publish-dual.mjs — 3.20.2 双通道发布
 * GitHub: REST API（blob→tree→commit→ref）+ Release + zip 资产
 * Gitee : contents API 逐文件 + tag
 */
import fs from "node:fs";
import path from "node:path";
import { embeddedGithubToken } from "../lib/github-token.mjs";

// 发布用写令牌（classic PAT，repo scope）：读凭据仍走内嵌 fine-grained。
const GH_TOKEN = process.env.XIAOYU_PUBLISH_TOKEN || embeddedGithubToken();
const GITEE_TOKEN = "12a8cf4180de50bf2ac8a97c72f7e33a";
const GH_REPO = "gqpG10/dsh-xiaoyu-novel";
const GITEE_REPO = "gqp20031110/dsh-xiaoyu-novel";
const VERSION = "3.50.0";
const TAG = "v" + VERSION;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, "")), "..");

const gh = async (url, opts = {}) => {
  const r = await fetch(url, { ...opts, headers: {
    Authorization: "Bearer " + GH_TOKEN,
    "User-Agent": "xiaoyu-publish",
    "Accept": "application/vnd.github+json",
    ...(opts.headers || {}),
  }});
  return r;
};
const gitee = async (url, opts = {}) => {
  const r = await fetch(url, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
  return r;
};

// ── collect files (same list as pack.mjs: everything except dist/.git/node_modules/tmp) ──
function collect(dir, base = dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if ([".git", ".github", "dist", "node_modules"].includes(name)) continue;
    if (name.startsWith("tmp-")) continue; // 临时脚本不发布
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) collect(p, base, out);
    else out.push({ abs: p, rel: path.relative(base, p).split(path.sep).join("/") });
  }
  return out;
}
const files = collect(ROOT);
console.log("files:", files.length);

// ── GitHub: create blobs + tree ──
async function ghPublish() {
  const entries = [];
  for (const f of files) {
    const content = fs.readFileSync(f.abs);
    const r = await gh("https://api.github.com/repos/" + GH_REPO + "/git/blobs", {
      method: "POST",
      body: JSON.stringify({ content: content.toString("base64"), encoding: "base64" }),
    });
    if (r.status !== 201) throw new Error("blob " + f.rel + ": " + r.status + " " + (await r.text()).slice(0, 200));
    const { sha } = await r.json();
    entries.push({ path: f.rel, mode: "100644", type: "blob", sha });
  }
  console.log("blobs done:", entries.length);
  const tr = await gh("https://api.github.com/repos/" + GH_REPO + "/git/trees", {
    method: "POST",
    body: JSON.stringify({ tree: entries }),
  });
  if (tr.status !== 201) throw new Error("tree: " + tr.status);
  const { sha: treeSha } = await tr.json();
  // parent = current main head
  const rr = await gh("https://api.github.com/repos/" + GH_REPO + "/git/ref/heads/main");
  const parent = (await rr.json()).object.sha;
  const ts = Math.floor(Date.now() / 1000);
  const cr = await gh("https://api.github.com/repos/" + GH_REPO + "/git/commits", {
    method: "POST",
    body: JSON.stringify({
      message: "v" + VERSION + ": fix sidebar panel label vanishing (register locale dictionary, align official panel pattern)",
      tree: treeSha, parents: [parent],
      author: { name: "gqpG10", email: "gqpG10@users.noreply.github.com", date: new Date(ts * 1000).toISOString() },
      committer: { name: "gqpG10", email: "gqpG10@users.noreply.github.com", date: new Date(ts * 1000).toISOString() },
    }),
  });
  if (cr.status !== 201) throw new Error("commit: " + cr.status);
  const commitSha = (await cr.json()).sha;
  const ur = await gh("https://api.github.com/repos/" + GH_REPO + "/git/refs/heads/main", {
    method: "PATCH",
    body: JSON.stringify({ sha: commitSha }),
  });
  console.log("ref update:", ur.status);
  const tr2 = await gh("https://api.github.com/repos/" + GH_REPO + "/git/refs", {
    method: "POST",
    body: JSON.stringify({ ref: "refs/tags/" + TAG, sha: commitSha }),
  });
  console.log("tag create:", tr2.status);
  // release
  const rel = await gh("https://api.github.com/repos/" + GH_REPO + "/releases", {
    method: "POST",
    body: JSON.stringify({
      tag_name: TAG, name: TAG,
      body: "## v" + VERSION + "\n\n修复侧边栏面板文字消失（第四轮根因修复）：\n\n- 对齐宿主官方面板注册范式：注册 locale 字典（zh/en/ja/es/fr/de/ru/pt）\n- label 改为 t('panel') 取词条 + 中文字面量兜底（老宿主兼容）\n- 字典注册/绑定全程 try/catch，无 locale 服务的老宿主不受影响\n\n兼容 Windows DSH 与 Android DSH（cross-platform/mobile 测试 30/30 通过，全套 307 项 0 失败）。",
    }),
  });
  console.log("release:", rel.status);
  const relData = await rel.json();
  if (relData.upload_url) {
    const zip = fs.readFileSync(ROOT + "/dist/dsh-xiaoyu-novel-" + VERSION + ".zip");
    const up = await gh("https://uploads.github.com/repos/" + GH_REPO + "/releases/" + relData.id + "/assets?name=dsh-xiaoyu-novel-" + VERSION + ".zip", {
      method: "POST",
      headers: { "Content-Type": "application/zip" },
      body: zip,
    });
    console.log("asset upload:", up.status);
  }
  return "github ok";
}

// ── Gitee: contents API per-file + tag ──
async function giteePublish() {
  let updated = 0, created = 0;
  for (const f of files) {
    const content = fs.readFileSync(f.abs).toString("base64");
    const gurl = "https://gitee.com/api/v5/repos/" + GITEE_REPO + "/contents/" + f.rel;
    // try update first (need sha)
    let sha = null;
    const gr = await gitee(gurl + "?ref=master&access_token=" + GITEE_TOKEN);
    if (gr.status === 200) sha = (await gr.json()).sha;
    const body = JSON.stringify({
      access_token: GITEE_TOKEN,
      content, branch: "master",
      message: "v" + VERSION + ": " + f.rel,
      ...(sha ? { sha } : {}),
    });
    const pr = await gitee(gurl, { method: "POST", body });
    if (pr.status !== 200 && pr.status !== 201) {
      // if sha mismatch (content same), try PUT
      const pr2 = await gitee(gurl, { method: "PUT", body });
      if (pr2.status !== 200 && pr2.status !== 201) {
        console.log("WARN", f.rel, pr.status, (await pr.text()).slice(0, 120));
        continue;
      }
      updated++;
    } else (sha ? updated++ : created++);
    if ((created + updated) % 25 === 0) console.log("gitee progress:", created + updated, "/", files.length);
  }
  console.log("gitee files created:", created, "updated:", updated);
  const tg = await gitee("https://gitee.com/api/v5/repos/" + GITEE_REPO + "/tags", {
    method: "POST",
    body: JSON.stringify({ access_token: GITEE_TOKEN, tag_name: TAG, message: "v" + VERSION, refs: "master" }),
  });
  console.log("gitee tag:", tg.status, (await tg.text()).slice(0, 150));

  // 3.39.0 补上 Gitee Release（以前只建 tag，不建 Release，发行版页面是空的）
  const bodyText = [
    "小鱼创作台 " + TAG,
    "",
    "安装：dsha-plugin import dsh-xiaoyu-novel-" + VERSION + ".zip，然后重启 DSH Web。",
    "更新：面板里点「检测更新」，或手动导入新 zip。",
  ].join("\n");
  let relId = null;
  try {
    const rr = await gitee("https://gitee.com/api/v5/repos/" + GITEE_REPO + "/releases", {
      method: "POST",
      body: JSON.stringify({
        access_token: GITEE_TOKEN,
        tag_name: TAG,
        name: "小鱼创作台 " + TAG,
        body: bodyText,
        target_commitish: "master",
        prerelease: false,
      }),
    });
    const rt = await rr.text();
    console.log("gitee release:", rr.status, rt.slice(0, 180));
    if (rr.status < 300) { try { relId = JSON.parse(rt).id } catch { /* 无 id */ } }
  } catch (e) { console.log("gitee release failed:", e.message); }

  // 附件：本地已打包的 zip（multipart/form-data）
  const zipPath = path.join(ROOT, "dist", "dsh-xiaoyu-novel-" + VERSION + ".zip");
  if (relId && fs.existsSync(zipPath)) {
    try {
      const fd = new FormData();
      fd.append("access_token", GITEE_TOKEN);
      fd.append("file", new Blob([fs.readFileSync(zipPath)]), path.basename(zipPath));
      const ar = await fetch("https://gitee.com/api/v5/repos/" + GITEE_REPO + "/releases/" + relId + "/attach_files", {
        method: "POST",
        body: fd,
        // 注意：multipart 不能手写 Content-Type，交给 fetch 自动带 boundary
      });
      console.log("gitee asset:", ar.status, (await ar.text()).slice(0, 160));
    } catch (e) { console.log("gitee asset failed:", e.message); }
  } else if (!relId) {
    console.log("gitee asset: 跳过（Release 没建成或 zip 不存在）");
  }

  return "gitee ok";
}

const only = process.argv[2] || "both";
if (only !== "gitee") console.log(await ghPublish());
if (only !== "github") console.log(await giteePublish());
