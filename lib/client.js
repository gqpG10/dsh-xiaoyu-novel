/**
 * dsh-xiaoyu-novel — 小鱼创作台 DSH Web client bundle（手写，零构建）
 *
 * 加载机制：
 *  - 宿主把声明了 dsh.client + exports["./client"] 的插件编进
 *    window.__DSH_BOOT__，并服务本文件；__ModuleLoader__.load 的 id 必须等于
 *    图行 id，否则首次加载的后置校验（factories.has(图行 id)）失败 → import
 *    报错 → 二次执行撞 duplicate factory 守卫。合并 bundle 下
 *    currentScript.src 是唯一可靠线索：宿主保证本行 URL「<挂载名>/client.js」
 *    必在 script src 里，故用正则解析，未命中回退主包名 dsh-xiaoyu-novel。
 *    URL 形状两代（issue #5）：0.2.1-rc.5 及之前 /plugins/<名>/client.js?rev=…
 *    单资源路径式；0.2.2-rc.1 起 /plugins/??<名>/client.js&rev=… 集合式（一个
 *    URL 服务同包多资源，「??」是宿主 ClientModuleSystem 的集合分隔约定，
 *    chunkUrl() 以 '/??' 定位 resource 段）。正则对「??」可选捕获、包名段
 *    禁 ?&#，两代同一条正则通吃。
 *  - factory 内 require() 只解析平台 seed 模块；本 bundle 依赖 react 与
 *    @deepseek-ai/dsh-client-ui-primitives（图标只用 …OutlineRegular 系 +
 *    size prop，缺名不渲染不抛），react-dom/client 取不到时仅失去 overlay。
 *  - 挂载点：左侧栏底部动作位入口（sidebar.footer.action 键控槽）+ 会话
 *    中栏全页 overlay（data-dsh-xiaoyu-novel-view / html[data-dsh-xiaoyu-novel-active]）；
 *    与 mnemon / taskboard / ssh 等全页面板互斥（dsh-panel-activate
 *    事件 + active 属性双通道），点侧栏会话行等上下文自动关闭。
 *  - CSS 正文在 lib/base.css，由 Node 侧 GET /api/xiaoyu-novel/client.css 现读
 *    下发；此处只在首次物化幂等注入 <link data-plugin-css="xiaoyu-novel-creator/base">
 *    （bundle 不含 CSS 正文，改样式无需重编）。数据走同源 /api/xiaoyu-novel/*。
 *  - 写操作（状态流转 / 阶段推进 / 索引重建）POST 成功后重拉 state 刷新，
 *    不做乐观更新；错误统一 toast，读取失败另在卡内留错误态。
 */
var __dshSrc = (document.currentScript && document.currentScript.src) || "";
window.__ModuleLoader__.load({
  id: (__dshSrc.match(/\/plugins\/(\?\?)?([^/?&#]+)\/client\.js/) || [])[2] || "dsh-xiaoyu-novel",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");
    var h = React.createElement;
    var useState = React.useState, useEffect = React.useEffect, useCallback = React.useCallback, useRef = React.useRef, useMemo = React.useMemo;
    var useLayoutEffect = React.useLayoutEffect || React.useEffect; // 绘制前测量（宿主无则退回 useEffect）
    var useContext = React.useContext || null; // 弹层门户目标读取（InstanceContext），缺失时 MaskPortal 退回原地渲染
    // 复制一份导出面再补属性：不往共享模块对象上写东西（避免污染宿主里
    // 其他 ui-primitives 消费者）；后续片段看到的就是这份副本。
    var P = Object.assign({}, require("@deepseek-ai/dsh-client-ui-primitives"));
    var ReactDOMClient = null;
    try { ReactDOMClient = require("react-dom/client"); } catch (err) { ReactDOMClient = null; }

    // 图标兜底：只用 …OutlineRegular 系（0.1.7+ 命名）+ size prop；导出名
    // 缺失（更老宿主）返回 null 不渲染，绝不因图标炸面板。
    function ic(name, size) {
      var C = P[name];
      if (typeof C !== "function") return null;
      return h(C, { size: size || 16, "aria-hidden": "true" });
    }

    // ── 常量与文案（全中文，禁 emoji 图标）────────────────────────────────
    var API_BASE = "/api/xiaoyu-novel/";
    var CSS_URL = "/api/xiaoyu-novel/client.css";
    var CSS_KEY = "xiaoyu-novel-creator/base";
    var WS_STORAGE_KEY = "xiaoyu.workspace";
    // 打开形态三选一（系统设置里切换，localStorage 记忆）：split=创作台中栏
    // overlay + 文章页右侧栏 tab（默认）；middle=两者都在中栏（历史唯一形态）；
    // sidebar=两者都在右侧栏。宿主缺 sidebarRight 服务（0.1.x）时右栏两项在
    // 设置里置灰，实际塌缩 middle。
    var OPEN_MODE_KEY = "xiaoyu.openMode";
    var OPEN_MODES = [["split", "settings.modeSplit"], ["middle", "settings.modeMiddle"], ["sidebar", "settings.modeSidebar"]];
    // ── 旧「毛颖创作台」浏览器态接入 ─────────────────────────────────────────
    // 旧面板的 localStorage 键以 xiaoyu.* 命名（工作区选择 / 打开形态 / 字号 /
    // 语言），新面板用 xiaoyu.*。首次加载时若新键缺失就从旧键复制：两个面板并存
    // 时各读各的，旧插件卸掉后小鱼创作台仍停在上次那本书、那套字号与形态上。
    // 旧键不删（旧面板仍要用）；localStorage 不可用（隐私模式）时静默跳过。
    function migrateLegacyPanelState() {
      var pairs = [
        ["xiaoyu.workspace", "xiaoyu.workspace"],
        ["xiaoyu.openMode", "xiaoyu.openMode"],
        ["xiaoyu.fontScale", "xiaoyu.fontScale"],
        ["xiaoyu.lang", "xiaoyu.lang"]
      ];
      try {
        for (var i = 0; i < pairs.length; i++) {
          var legacyKey = pairs[i][0], currentKey = pairs[i][1];
          var legacyValue = window.localStorage.getItem(legacyKey);
          if (legacyValue === null || legacyValue === "") continue;
          if (window.localStorage.getItem(currentKey) !== null) continue;
          window.localStorage.setItem(currentKey, legacyValue);
        }
      } catch (err) { /* 隐私模式 / 禁存环境：忽略 */ }
    }
    migrateLegacyPanelState();
    // 右侧栏 tab 类型（0.2.x 宿主 sidebarRight 服务在场才注册）：id 唯一标识
    // 实现（用包名），kind 是页型 tab 的打开键（入口/开始页卡片按 kind 开）。
    var SB_CREATOR_ID = "dsh-xiaoyu-novel";
    var SB_CREATOR_KIND = "xiaoyu-novel-creator";
    var SB_READER_ID = "dsh-xiaoyu-novel-reader";
    var SB_READER_KIND = "xiaoyu-reader";
    function openModeIsValid(m) { return m === "split" || m === "middle" || m === "sidebar"; }
    function getOpenMode() {
      var m = lsGet(OPEN_MODE_KEY);
      return openModeIsValid(m) ? m : "split";
    }
    var API_TIMEOUT_MS = 60000;
    // 一键升级单独放宽：服务端 profile pnpm add 超时上限 180s + 全局 npm i -g
    // 独立 120s（顺带更新全局 xiaoyu CLI），统一 60s 会先掐断，故 self-update
    // 请求走 340s（300s + 40s 余量），其余请求仍用 API_TIMEOUT_MS。
    var SELF_UPDATE_TIMEOUT_MS = 340000;

    var STATUS_FLOW = ["pending", "writing", "review", "accepted"];
    var FS_ORDER = ["planted", "progressing", "resolved", "abandoned"];
    var FS_FLOW = { planted: "progressing", progressing: "resolved" };
    var PHASES = ["idea", "setting", "outline", "writing", "review", "consistency", "export"];
    // 共创模式三态（key → mode.* / modeShort.* 词典后缀）：概览书稿卡展示用。
    var MODES = [["ai-draft", "aiDraft"], ["co-write", "coWrite"], ["author-draft", "authorDraft"]];
    // clue.* 词典键是小驼峰，数据里的 kind 按契约（templates/novel/README.md、
    // docs/spec.md）是 clue|red-herring|deduction|question——此前键表误按
    // snake_case + inference 写，红鲱鱼/推理两组永远查不中、只能裸显英文原值。
    // 尾两个旧键是历史手写数据的容错别名，契约值优先。
    var CLUE_KIND_KEYS = { clue: "clue", "red-herring": "redHerring", deduction: "inference", question: "question", red_herring: "redHerring", inference: "inference" };
    var TABS = [
      ["overview", "tabs.overview"], ["chapters", "tabs.chapters"], ["characters", "tabs.characters"],
      ["foreshadows", "tabs.foreshadows"], ["relations", "tabs.relations"], ["timeline", "tabs.timeline"],
      ["world", "tabs.world"], ["style", "tabs.style"], ["index", "tabs.index"],
    ];

    // 当前外壳渲染走了哪条分支（3.1.3）：手机黑屏时，日志里必须能一眼看出
    // 是「根本没数据」「加载中骨架」还是「某个 tab 抛错」。只在 PageShell
    // render 里赋值，自检上报时带出去。
    var SHELL_BRANCH = "";
    function workspaceBranch(effectiveWs, workspaces, loading, snap, stateErr, readerFile, tab) {
      if (workspaces === null) return "skeleton:first-load";
      if (!effectiveWs) return "guide:no-workspace";
      if (loading && !snap) return "skeleton:state-loading";
      if (stateErr) return "error:" + String(stateErr).slice(0, 60);
      if (snap && snap.found === false) return "guide:not-initialized";
      if (!snap) return "empty:snapshot-missing";
      if (readerFile) return "reader";
      return "tab:" + String(tab);
    }

    // 首屏只要这几块（0.22.0）：概览/章节/角色/伏笔/分卷都在这，实测 448KB→105KB。
    var FIRST_SCREEN_BLOCKS = "project,chapters,characters,relations,foreshadows,volumes";
    // tab → 它额外需要的块（缺了就补拉一次）。overview/chapters 首屏已齐，不用补。
    var TAB_BLOCKS = {
      timeline: "timeline,memories",
      world: "world,science,research",
      "index": "clues,memories",
    };

    // 角色徽章四色（role 是自由文本）：按关键词归 tone，命中即返。
    function roleTone(role) {
      var r = String(role || "");
      if (/主角|protagonist|男主|女主/i.test(r)) return "a";
      if (/反派|对立|antagonist|敌/i.test(r)) return "b";
      if (/配角|支持|盟友|friend|ally/i.test(r)) return "c";
      return "d";
    }
    // 契约四态 role（protagonist|antagonist|supporting|minor）按界面语言出标签，
    // role 是自由文本，契约外取值原样展示不翻译。
    var ROLE_CONTRACT = { protagonist: 1, antagonist: 1, supporting: 1, minor: 1 };
    function roleBadge(role) {
      var text = String(role || "").trim();
      if (!text) return null;
      var key = text.toLowerCase();
      if (!ROLE_CONTRACT[key]) key = null;
      return h("span", { className: "myt-badge myt-roleBadge", "data-tone": roleTone(text) }, key ? tt("role." + key) : text);
    }
    // 状态徽章悬停提示（「在等谁」）：stage.* 词典按归一后的 status 出文案，
    // status 越枚举回落 pending；author-draft 模式下待写章在等作者交稿，单出
    // stage.awaitAuthor（mode 未传/越枚举走默认分支，行为同旧）。
    function stageTitle(status, mode) {
      var s = STATUS_FLOW.indexOf(status) !== -1 ? status : "pending";
      if (mode === "author-draft" && s === "pending") return tt("stage.awaitAuthor");
      return tt("stage." + s);
    }
    function statusBadge(status, mode) {
      var s = STATUS_FLOW.indexOf(status) !== -1 ? status : "pending";
      return h("span", { className: "myt-badge", "data-status": s, title: stageTitle(status, mode) }, tt("status." + s) + (status && s !== status ? tf("status.rawSuffix", { raw: status }) : ""));
    }
    function phasePill(phase) {
      var p = PHASES.indexOf(phase) !== -1 ? phase : null;
      if (!p) return h("span", { className: "myt-phase", "data-phase": "idea", title: phase || "" }, phase ? String(phase) : tt("phase.unset"));
      return h("span", { className: "myt-phase", "data-phase": p }, tt("phase." + p));
    }
    function priDot(pri) {
      var p = pri === "high" || pri === "low" ? pri : "normal";
      return h("span", { className: "myt-priDot", "data-pri": p, title: tf("common.priorityTitle", { pri: tt("pri." + p) }), "aria-label": tf("common.priorityAria", { pri: tt("pri." + p) }) });
    }

    // ── 格式化小工具 ─────────────────────────────────────────────────────
    function fmtNum(n) {
      var v = typeof n === "number" && isFinite(n) ? n : null;
      if (v === null) return "—";
      try { return v.toLocaleString("zh-CN"); } catch (err) { return String(v); }
    }
    function orDash(v) {
      var s = v === null || v === undefined ? "" : String(v);
      return s.trim() === "" ? "—" : s;
    }
    function truncate(s, n) {
      var t = String(s === null || s === undefined ? "" : s);
      return t.length > n ? t.slice(0, n - 1) + "…" : t;
    }
    // 章节「卷-章」定位：volume 缺省只显示第 N 章。
    function chWhere(ch) {
      if (!ch) return "";
      var num = typeof ch.num === "number" ? tf("common.chapterNum", { n: ch.num }) : "";
      return ch.volume ? String(ch.volume) + " · " + num : num;
    }
    // 孤儿章纲的「卷-章」定位（0.1.15）：从章纲文件名 stem（v01-c003.md）
    // 反推，显示格式与 chWhere 对齐；不合规范的文件名返回空串（调用方退回
    // 文件名兜底显示）。
    function olWhere(ol) {
      var stem = ol && ol.chapter ? String(ol.chapter).replace(/\.md$/i, "") : "";
      var m = /^v(\d+)-c(\d+)$/i.exec(stem);
      if (!m) return "";
      return "v" + m[1] + " · " + tf("common.chapterNum", { n: Number(m[2]) });
    }
    // 章号（0.15.1）：章节表标题前缀用（手机窄屏没有独立「卷」列）。
    // num 缺失时从 vXX-cYYY 反推，仍取不到就返回空串由调用方省略。
    function chNo(ch) {
      if (!ch) return "";
      var n = typeof ch.num === "number" ? ch.num : null;
      if (n === null) {
        var m = /-c(\d+)$/i.exec(String(ch.file || "").replace(/\.md$/i, ""));
        if (m) n = Number(m[1]);
      }
      return n === null ? "" : tf("common.chapterNum", { n: n });
    }
    function chFullTitle(ch) {
      if (!ch) return "";
      var where = chWhere(ch);
      var title = ch.title ? String(ch.title) : (ch.file || "");
      return where ? where + " · " + title : title;
    }
    // 章节文件绝对路径（抽屉「复制路径」按钮用）：novelDir 由服务端 resolve 过，
    // 这里只补 chapters/ 段；novelDir 尾部分隔符兜掉，分隔符统一用 /（即 Windows
    // 下 novelDir 自带的 \ 不受影响，拼出的路径可直接贴进文件管理器）。
    function chapterAbsPath(novelDir, file) {
      return String(novelDir || "").replace(/[\\/]+$/, "") + "/chapters/" + file;
    }
    // localStorage 安全读写（隐私模式 / 禁存环境不炸）。
    function lsGet(key) {
      try { return window.localStorage.getItem(key); } catch (err) { return null; }
    }
    function lsSet(key, value) {
      try { window.localStorage.setItem(key, value); } catch (err) { /* 静默 */ }
    }
    // 复制：clipboard API 优先，老环境回落隐藏 textarea + execCommand。
    function copyText(text) {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return legacyCopy(text); });
      }
      return Promise.resolve(legacyCopy(text));
    }
    function legacyCopy(text) {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "readonly");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch (err) { return false; }
    }

    // ── 服务端 API 助手（同源 /api/xiaoyu-novel/*，非 2xx 抛错）─────────────────
    // 错误统一 toast（读路由调用方另留卡内错误态）；总超时防按钮永久转圈。
    function xiaoyuApi(path, body, timeoutMs) {
      // timeoutMs 缺省用统一 60s；一键升级单独放宽到 200s（见常量处注释）。
      var limit = typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : API_TIMEOUT_MS;
      var opts = body === undefined ? {} : {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      };
      var ctrl = typeof AbortController === "function" ? new AbortController() : null;
      var timer = null;
      if (ctrl) {
        opts.signal = ctrl.signal;
        timer = setTimeout(function () { ctrl.abort(); }, limit);
      }
      var p = fetch(API_BASE + path, opts).then(function (r) {
        // 先取全文再 JSON.parse：代理错误页 / 空体不再抛 SyntaxError。
        return r.text().then(function (raw) {
          var d = null;
          try { d = raw ? JSON.parse(raw) : null; } catch (err) { d = null; }
          if (!r.ok) {
            // 错误对象带状态码：调用方按码分流（如设置保存只在 409 外部改动
            // 冲突时重置表单，其余失败保留用户正在编辑的内容）。
            var e = new Error((d && d.error) || ("HTTP " + r.status));
            e.status = r.status;
            throw e;
          }
          if (!d) throw new Error(tf("api.notJson", { code: r.status }));
          return d;
        });
      }).catch(function (err) {
        if (ctrl && err && err.name === "AbortError") throw new Error(tf("api.timeout", { s: Math.round(limit / 1000) }));
        throw err;
      });
      if (!ctrl) {
        // 老宿主无 AbortController：fetch 中断不了，race 一个超时 reject 兜底，
        // 照样防按钮永久转圈（真连接留在后台，本次调用不再等它）。
        p = Promise.race([p, new Promise(function (_resolve, reject) {
          timer = setTimeout(function () { reject(new Error(tf("api.timeout", { s: Math.round(limit / 1000) }))); }, limit);
        })]);
      }
      return p.finally(function () {
        if (timer !== null) clearTimeout(timer);
      });
    }
    function apiGet(path, params, opts) {
      var quiet = opts && opts.silent;
      var qs = "";
      if (params) {
        var usp = new URLSearchParams();
        Object.keys(params).forEach(function (k) { if (params[k] !== undefined && params[k] !== null) usp.append(k, String(params[k])); });
        qs = usp.toString();
      }
      return xiaoyuApi(path + (qs ? (path.indexOf("?") === -1 ? "?" : "&") + qs : "")).catch(function (err) {
        // silent：调用方自渲染卡内错误位时抑制 toast，同一错误只展示一次。
        if (!quiet) toast.err(tf("toast.prefix", { msg: err.message }));
        throw err;
      });
    }
    function apiPost(path, body, opts) {
      var quiet = opts && opts.silent;
      return xiaoyuApi(path, body || {}).then(function (d) {
        toast.ok(apiPostOkText(path, d));
        return d;
      }, function (err) {
        if (!quiet) toast.err(tf("toast.prefix", { msg: err.message })); // silent 同 apiGet
        throw err;
      });
    }
    // 写操作成功提示按路由分流（server 返回 chapters 计数时带上）。
    function apiPostOkText(path, d) {
      if (path === "rebuild-index") return tf("toast.indexRebuilt", { n: fmtNum(d && d.chapters) });
      if (path === "chapter-status") return tt("toast.chapterStatus");
      if (path === "chapter-create") return tf("toast.chapterCreated", { title: (d && d.title) || "—" });
      if (path === "foreshadow-status") return tt("toast.foreshadowStatus");
      if (path === "phase") return tf("toast.phaseAdvanced", { phase: d && d.phase && PHASES.indexOf(d.phase) !== -1 ? tt("phase." + d.phase) : (d && d.phase) || "—" });
      if (path === "ledger-clean") {
        if (d && d.changed === false) return tt("toast.ledgerCleanEmpty");
        return tf("toast.ledgerCleaned", { n: fmtNum(d && d.trimmedTotal), a: fmtNum(d && d.archivedTotal), k: fmtNum(d && d.advancedTotal) });
      }
      if (path === "style-save") return tt("toast.styleSaved");
      if (path === "chapter-save") return tt("toast.chapterSaved");
      if (path === "outline-save") return tt("toast.outlineSaved");
      if (path === "file-save") return tf("toast.fileSaved", { rel: (d && d.rel) || "" });
      if (path === "file-create") return tf("toast.fileCreated", { rel: (d && d.rel) || "" });
      if (path === "file-delete") return tf("toast.fileDeleted", { rel: (d && d.rel) || "" });
      return tt("toast.success");
    }

    // ── Toast 控制器（模块级单例；ok 4s / warn 6s 自动消失，err 手动关）────
    function createToastCtrl() {
      var seq = 0;
      var items = [];
      var listeners = [];
      function notify() { listeners.slice().forEach(function (fn) { fn(); }); }
      function dismiss(id) {
        items = items.filter(function (it) { return it.id !== id; });
        notify();
      }
      function push(kind, text) {
        var it = { id: ++seq, kind: kind, text: String(text || "") };
        items = items.concat([it]);
        if (items.length > 4) items = items.slice(items.length - 4);
        if (kind !== "err") {
          setTimeout(function () { dismiss(it.id); }, kind === "warn" ? 6000 : 4000);
        }
        notify();
        return it.id;
      }
      return {
        ok: function (t) { return push("ok", t); },
        warn: function (t) { return push("warn", t); },
        err: function (t) { return push("err", t); },
        dismiss: dismiss,
        subscribe: function (fn) {
          listeners.push(fn);
          return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
        },
        snapshot: function () { return items.slice(); },
      };
    }
    var toast = createToastCtrl();
    // 脏退出守卫的跨组件脏标记：编辑面（正文/章纲/受管文件/风格/元信息）各自
    // 在渲染后写入「是否有未保存草稿」，切 tab 等自身不知情的退出路径读它拦截
    // 确认。面板同一时刻至多一个编辑面打开，单布尔够用；卸载时清零防残留误拦。
    var DIRTY_EXIT = { dirty: false };

    // toast 归属：toast 控制器是模块级单例，多实例并存（split 形态：中栏
    // overlay + 右侧栏文章页 tab）时只允许一处渲染 ToastHost，防同一 toast
    // 重复弹两份。规则：overlay 实例恒持有（OverlayPresence 计数在屏 overlay）；
    // tab 实例仅在无 overlay 在场时持有（sidebar 形态无 overlay，tab 自己兜）。
    var OVERLAY_PRESENCE = { count: 0, listeners: [] };
    function overlayPresenceSubscribe(fn) {
      OVERLAY_PRESENCE.listeners.push(fn);
      return function () {
        var i = OVERLAY_PRESENCE.listeners.indexOf(fn);
        if (i >= 0) OVERLAY_PRESENCE.listeners.splice(i, 1);
      };
    }
    // overlay 实例根包装：挂载计数 +1、卸载 -1，驱动 ToastHostOwned 换手。
    function OverlayPresence(props) {
      useEffect(function () {
        OVERLAY_PRESENCE.count += 1;
        OVERLAY_PRESENCE.listeners.slice().forEach(function (fn) { fn(); });
        return function () {
          OVERLAY_PRESENCE.count = Math.max(0, OVERLAY_PRESENCE.count - 1);
          OVERLAY_PRESENCE.listeners.slice().forEach(function (fn) { fn(); });
        };
      }, []);
      return props.children;
    }
    function ToastHostOwned() {
      var _o = useState(OVERLAY_PRESENCE.count > 0), overlayHere = _o[0], setOverlayHere = _o[1];
      useEffect(function () {
        return overlayPresenceSubscribe(function () { setOverlayHere(OVERLAY_PRESENCE.count > 0); });
      }, []);
      if (overlayHere) return null; // overlay 在场：toast 归它渲染
      return h(ToastHost);
    }


    function ToastHost() {
      var _t = useState(function () { return toast.snapshot(); }), items = _t[0], setItems = _t[1];
      useEffect(function () {
        return toast.subscribe(function () { setItems(toast.snapshot()); });
      }, []);
      if (!items.length) return null;
      // portal 到实例根（InstanceScope）：与弹层同一坐标系，absolute inset:0
      // 铺满所属实例，Toast 落实例底部居中（base.css）。旧方案 portal 到
      // body + fixed，靠 --myt-anchor-* 全局变量描述锚区，多实例并存
      // （右侧栏形态）会互踩，故随弹层一起迁进实例根。
      return h(MaskPortal, { className: "myt-toastHost", "aria-live": "polite" },
        items.map(function (it) {
          return h("div", {
            key: it.id,
            className: "myt-toast myt-toast" + it.kind.charAt(0).toUpperCase() + it.kind.slice(1),
            role: it.kind === "err" ? "alert" : "status",
          },
            h("div", { className: "myt-toastText" }, it.text),
            h("button", {
              type: "button", className: "myt-toastClose", "aria-label": tt("common.closeTip"),
              onClick: function () { toast.dismiss(it.id); },
            }, h("span", { className: "myt-closeGlyph", "aria-hidden": "true" }, "×")));
        }));
    }

    // ── 样式注入（幂等）：同名 data 属性的 link 已存在即跳过 ───────────────
    function mountCss() {
      if (document.querySelector('link[data-plugin-css="' + CSS_KEY + '"]')) return;
      var link = document.createElement("link");
      link.setAttribute("rel", "stylesheet");
      link.setAttribute("data-plugin", "dsh-xiaoyu-novel");
      link.setAttribute("data-plugin-css", CSS_KEY);
      link.setAttribute("href", CSS_URL);
      if (document.head) {
        document.head.appendChild(link);
      } else if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", mountCss);
      } else {
        document.documentElement.appendChild(link);
      }
    }
    // 重开面板时换一个查询串，逼 WebView 重新取样式（0.4.9）：mountCss 幂等只
    // 注入一次，之后改 base.css 重开面板拿到的还是内存里那份旧表——0.4.7/0.4.8
    // 两轮「改了没反应」就是它。挂载/重开时刷一次，样式改动不必重启宿主。
    function refreshCss() {
      if (typeof document === "undefined") return;
      try {
        var link = document.querySelector('link[data-plugin-css="' + CSS_KEY + '"]');
        if (!link) { mountCss(); return; }
        link.setAttribute("href", CSS_URL + "?t=" + Date.now());
      } catch (err) { /* 防御性兜底：样式刷新失败不该影响面板 */ }
    }
    if (typeof document !== "undefined") mountCss();

    // ── 手机黑屏自检上报（3.1.3）──────────────────────────────────────────
    // 手机上开不了控制台、也拖不出 F12：面板「看着是黑的」时，作者手里除了
    // 一张截图什么都没有——上一版按「inset 被丢弃」「没错误边界」两个假设改了
    // 两轮，实拍依旧全黑，说明病灶在别处。此处把面板自己量到的真实几何
    // （根/外壳/顶栏/tab 条/内容区的宽高与位置）、黑区中心点上到底压着哪个
    // 元素（elementFromPoint 祖先链）、内容区子节点数、计算出的 background /
    // min-height、以及错误边界记下的渲染异常，一次性 POST 到 client-diag，
    // 服务端落盘 <dshHome>/xiaoyu-diag.log。只要面板能画出顶栏，这条就一定
    // 发得出去；发不出去说明连外壳都没跑起来，那本身就是结论。
    // 宿主主题变量是否真的存在（3.1.3）：CSS 里色值全部走 var(--dsw-alias-*)，
    // 变量缺席时整条声明退化成 unset——背景透明、文字继承、边框 0，表现就是
    // 「除了写死 px 的顶栏，其余一片黑」。这里量一次，缺了就给容器打
    // data-myt-novars，让 base.css 里的兜底调色板接管（宿主正常时零影响）。
    function applyVarFallback(el) {
      if (!el || typeof window === "undefined" || !window.getComputedStyle) return false;
      try {
        var probe = window.getComputedStyle(el).getPropertyValue("--dsw-alias-bg-layer-1").trim();
        var hasVars = probe !== "";
        if (hasVars) el.removeAttribute("data-myt-novars");
        else el.setAttribute("data-myt-novars", "");
        return !hasVars;
      } catch (e) { return false; }
    }
    function rectBrief(el) {
      if (!el || typeof el.getBoundingClientRect !== "function") return null;
      var r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), t: Math.round(r.top), l: Math.round(r.left) };
    }
    function collectDiag(tag) {
      try {
        var out = {
          tag: tag, at: Date.now(),
          ua: String(navigator.userAgent || "").slice(0, 200),
          vw: window.innerWidth, vh: window.innerHeight,
          dpr: window.devicePixelRatio || 1,
          docH: document.documentElement ? document.documentElement.scrollHeight : -1,
        };
        var root = document.querySelector("[data-dsh-xiaoyu-novel-view]");
        out.root = rectBrief(root);
        var shell = root ? root.querySelector(".myt-shell") : null;
        out.shell = rectBrief(shell);           // 外壳：高度是不是 0
        out.header = rectBrief(shell ? shell.querySelector(".myt-header") : null);
        out.tabs = rectBrief(shell ? shell.querySelector(".myt-tabs") : null);
        var bodyEl = shell ? shell.querySelector(".myt-body") : null;
        out.body = rectBrief(bodyEl);           // 内容区：手机黑的就是这块
        if (bodyEl) {
          var cs = window.getComputedStyle(bodyEl);
          out.bodyStyle = {
            display: cs.display, flex: cs.flex, height: cs.height,
            minHeight: cs.minHeight, overflowY: cs.overflowY,
            color: cs.color, background: cs.backgroundColor, opacity: cs.opacity,
          };
          out.bodyChildren = bodyEl.children.length;
          var page = bodyEl.querySelector(".myt-page");
          out.page = rectBrief(page);
          out.pageChildren = page ? page.children.length : -1;
          if (page && page.children.length) {
            var first = page.children[0];
            out.firstChild = {
              tag: first.tagName, cls: String(first.className || "").slice(0, 90),
              rect: rectBrief(first), text: String(first.textContent || "").slice(0, 140),
            };
          } else if (page) {
            out.pageText = String(page.textContent || "").slice(0, 140);
          } else {
            out.bodyText = String(bodyEl.textContent || "").slice(0, 140);
          }
        }
        // 黑区正中央那个像素上，浏览器认为是谁在最上层
        var cx = out.root ? Math.round(out.root.l + out.root.w / 2) : Math.round(window.innerWidth / 2);
        var cy = out.body && out.body.h > 0 ? Math.round(out.body.t + out.body.h / 2) : Math.round(window.innerHeight * 0.62);
        out.hitPoint = [cx, cy];
        var stack = [];
        var el = document.elementFromPoint(cx, cy);
        for (var i = 0; el && i < 6; i++) {
          var r2 = el.getBoundingClientRect();
          stack.push(el.tagName + "." + String(el.className || "").slice(0, 44) + " " + Math.round(r2.width) + "x" + Math.round(r2.height));
          el = el.parentElement;
        }
        out.hitStack = stack;
        // 样式表到底有没有生效：sheet.cssRules 读得到说明同源已解析
        var link = document.querySelector('link[data-plugin-css]');
        out.css = link
          ? { href: String(link.getAttribute("href") || "").slice(0, 140), rules: (link.sheet && link.sheet.cssRules ? link.sheet.cssRules.length : -1) }
          : null;
        out.build = BUILD_STAMP;          // 浏览器里实际运行的 bundle 版本
        out.shellBranch = SHELL_BRANCH; // 这一轮外壳走的是哪条分支
        try { out.renderErrors = JSON.parse(sessionStorage.getItem("xiaoyu.renderErrors") || "[]").slice(-2); } catch (e) { out.renderErrors = []; }
        return out;
      } catch (e) {
        return { tag: tag, at: Date.now(), error: String((e && e.message) || e) };
      }
    }
    function sendDiag(payload) {
      try {
        var text = JSON.stringify(payload);
        if (typeof fetch === "function") {
          fetch(API_BASE + "client-diag", {
            method: "POST", headers: { "content-type": "application/json" },
            body: text, keepalive: true,
          }).catch(function () { /* 上报失败绝不影响面板 */ });
        }
      } catch (e) { /* 同上 */ }
    }

    // ── 挂载：底部入口 + 会话中栏全页 overlay ──────────────────────────────
    // 框架无关小状态器：侧栏入口与 overlay 共享同一份 { open } 快照。
    function createPanelController() {
      var snapshot = { open: false };
      var listeners = [];
      function notify() { listeners.slice().forEach(function (fn) { fn(); }); }
      function setOpen(open, reassert) {
        if (snapshot.open === open && !reassert) return;
        snapshot = { open: open };
        notify();
      }
      return {
        getSnapshot: function () { return snapshot; },
        subscribe: function (listener) {
          listeners.push(listener);
          return function () {
            var i = listeners.indexOf(listener);
            if (i !== -1) listeners.splice(i, 1);
          };
        },
        // open 带 reassert：属性观察兜底重复触发时也把广播重刷一遍。
        open: function () { setOpen(true, true); },
        close: function () { setOpen(false); },
        toggle: function () { setOpen(!snapshot.open); },
      };
    }

    function makeFooterEntry(controller, sbHandleRef, ensureSb) {
      return function FooterEntry(props) {
        var wide = !!(props && props.wide);
        var _st = useState(controller.getSnapshot().open), open = _st[0], setOpenState = _st[1];
        useEffect(function () {
          return controller.subscribe(function () { setOpenState(controller.getSnapshot().open); });
        }, []);
        return h("button", {
          type: "button",
          className: "myt-footerBtn" + (wide ? "" : " myt-footerRail"),
          "data-active": open ? "true" : undefined,
          "aria-label": "小鱼创作台",
          "aria-haspopup": "dialog",
          "aria-expanded": open ? "true" : "false",
          title: "小鱼创作台",
          onClick: function () {
            // 右侧栏形态且宿主支持：点击开/收右侧栏 tab；否则开关中栏 overlay。
            // 形态现读 localStorage——设置里切完不用重挂入口。
            var sbHandle = typeof ensureSb === "function" ? ensureSb() : (sbHandleRef && sbHandleRef.current);
            if (sbHandle && getOpenMode() === "sidebar") { sbHandle.open(); return; }
            controller.toggle();
          },
        },
          ic("IconEditOutlineRegular", wide ? 16 : 18),
          wide ? h("span", { className: "myt-footerLabel" }, "小鱼创作台") : null);
      };
    }

    function mountFooterEntry(ctx, controller, sbHandleRef, ensureSb) {
      if (typeof document === "undefined") return function () {};
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== "function" || typeof ctx.slots.register !== "function") {
        return function () {}; // 槽口不可用（老宿主）：只失去底部入口，不炸
      }
      var Entry = makeFooterEntry(controller, sbHandleRef, ensureSb);
      var dispose = ctx.slots.inject("sidebar.footer.action", function () {
        return ctx.slots.register({ name: "sidebar.footer.action", id: "xiaoyu-novel-creator", order: 12, label: "小鱼创作台" }, Entry);
      });
      return typeof dispose === "function" ? dispose : function () {};
    }

    // ── 顶部面板入口（0.14.0）──────────────────────────────────────────────
    // 用户要求把「小鱼创作台」从左侧栏底部动作位挪到顶部面板列表（插件/自动化
    // 任务那一组）。宿主的面板列表读 sidebar.panellist 槽，点行调 layout
    // .selectPanel(id)，而 selectPanel 要求同 id 的 main 槽面板已注册。所以
    // 正确做法是「main + panellist」成对注册（plugin-manager / schedule 同款），
    // 而不是往 footer.action 里塞按钮。注册失败（老宿主没有 layout 服务）时
    // 退回原来的底部入口，功能不丢。
    var PANEL_ID = "xiaoyu-novel-creator";
    // 面板列表里排在「上下文洞察」之后：order 大一点即可；太大会被宿主收进「更多」。
    var PANEL_ORDER = 9;
    // ── 构建戳（3.1.7）────────────────────────────────────────────────────
    // 这个字符串是**打包时写死进 client.js 的**，不来自任何接口、不受缓存影响。
    // 用途：手机上肉眼确认「浏览器跑的到底是哪一版代码」。起因是连续四轮修改
    // 都没在真机上体现——后来发现那个标签页里的 bundle 是开页时的那一份，
    // 重启宿主只换服务端、不换页面里的 JS。有了这个戳，一眼就能判断：
    // 徽章显示旧版本 = 代码没换，一切修改都还没生效，不用再猜渲染问题。
    var BUILD_STAMP = "3.1.7";

    function probeLayout(ctx) {
      try {
        if (ctx && typeof ctx.get === "function") {
          var v = ctx.get("layout", false);
          if (v && typeof v.selectPanel === "function") return v;
        }
      } catch (err) { /* 服务未激活：走属性直读 */ }
      try {
        var p = ctx && ctx.layout;
        if (p && typeof p.selectPanel === "function") return p;
      } catch (err) { /* 被代理拦：视为不可用 */ }
      return null;
    }

    function mountSidebarPanel(ctx, controller, opts) {
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== "function") return null;
      var sbReady = !!(opts && opts.sbReady);
      var sbProbe = typeof (opts && opts.sbProbe) === "function" ? opts.sbProbe : function () { return sbReady; };
      var ensureSb = typeof (opts && opts.ensureSb) === "function" ? opts.ensureSb : null;
      function openReaderTab(file, ws) {
        var handle = ensureSb ? ensureSb() : null;
        if (handle && typeof handle.openReader === "function") return handle.openReader(file, ws);
        return false;
      }
      // 主面板正文：包一层 InstanceScope / .myt-view 以复用既有 CSS、容器查询
      // 与弹层 portal 根；关闭按钮回「对话」面板（selectPanel(null)）。
      function PanelBody() {
        return h(OverlayPresence, null,
          h(InstanceScope, { className: "myt-viewRoot" },
            h("div", { className: "myt-view myt-viewTab" },
              h(PageShell, {
                onClose: function () {
                  try { var layout = probeLayout(ctx); if (layout) layout.selectPanel(null); } catch (err) { /* 已经不在面板上 */ }
                  controller.close();
                },
                sbReady: sbReady,
                sbProbe: sbProbe,
                openReaderTab: openReaderTab,
              }))));
      }
      // 列表行左侧图标：槽内容就是那一行的小图标（size 由宿主给）
      function PanelGlyph(props) {
        var size = props && typeof props.size === "number" ? props.size : 18;
        return ic("IconEditOutlineRegular", size);
      }
      var disposers = [];
      try {
        var d1 = ctx.slots.inject("main", function () {
          return ctx.slots.register({ name: "main", key: PANEL_ID }, PanelBody);
        });
        if (typeof d1 === "function") disposers.push(d1);
        var d2 = ctx.slots.inject("sidebar.panellist", function () {
          return ctx.slots.register({ name: "sidebar.panellist", id: PANEL_ID, order: PANEL_ORDER, label: "小鱼创作台" }, PanelGlyph);
        });
        if (typeof d2 === "function") disposers.push(d2);
      } catch (err) {
        disposers.forEach(function (d) { try { d(); } catch (e) { /* 清理失败不管 */ } });
        if (ctx.logger && typeof ctx.logger.warn === "function") {
          ctx.logger.warn("dsh-xiaoyu-novel: panel entry mount failed, falling back to footer: " + String((err && err.message) || err));
        }
        return null;
      }
      return {
        dispose: function () { disposers.forEach(function (d) { try { d(); } catch (err) { /* 单个失败不阻断 */ } }); },
      };
    }
    // 全页 overlay：容器 append 到会话中栏，createRoot 渲染 PageShell；懒挂载
    // （首次打开才建容器），被宿主挤掉时由 MutationObserver 重挂。互斥双通道：
    //  1) 打开时清掉四家旧面板的 active 属性（其属性观察者自行关闭）+ 广播
    //     dsh-panel-activate（新式 detail:{source:"xiaoyu"}）；
    //  2) 监听同款事件：旧式字符串 detail 或新式对象 detail.source 非
    //     "xiaoyu" → 关自己；点侧栏会话行等上下文自动关闭。
    var CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"], .dshDesktopConversationSurface';
    var ACTIVE_ATTR = "data-dsh-xiaoyu-novel-active";
    var OTHER_ACTIVE_ATTRS = ["data-dsh-mnemon-active", "data-dsh-taskboard-active", "data-dsh-ssh-active", "data-dsh-paoding-active"];
    var ACTIVATE_EVENT = "dsh-panel-activate";
    var SIDEBAR_CONTEXT_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="newSession"]';

    function mountPanel(controller, opts) {
      if (typeof document === "undefined" || typeof window === "undefined" || !ReactDOMClient) {
        return function () {};
      }
      var sbReady = !!(opts && opts.sbReady);
      var sbProbe = typeof opts.sbProbe === "function" ? opts.sbProbe : function () { return sbReady; };
      var ensureSb = typeof opts.ensureSb === "function" ? opts.ensureSb : null;
      var root;
      var container;
      var overlayContainerCleanup = null; // 每次（重）挂容器时重置：清定时器
      var ensure = function () {
        if (!controller.getSnapshot().open) return; // 懒挂载：只在打开态维护容器
        if (ensureSb) ensureSb(); // 服务晚到/首试失败：这里兜底重试（已挂即空转）
        if (getOpenMode() === "sidebar" && opts && opts.sbHandleRef && opts.sbHandleRef.current) return; // 右侧栏形态且 tab 已注册：中栏不再挂 overlay（已开的不强拆，入口再点开关照旧；服务缺席塌缩中栏）
        if (container && container.isConnected) return;
        if (container) {
          if (overlayContainerCleanup) { try { overlayContainerCleanup(); } catch (e) { /* 忽略 */ } overlayContainerCleanup = null; }
          if (root) root.unmount();
          root = undefined;
          container = undefined;
        }
        var column = document.querySelector(CONVERSATION_COLUMN_SELECTOR);
        if (!column) return;
        container = document.createElement("div");
        container.dataset.dshXiaoyuView = ""; // → data-dsh-xiaoyu-novel-view
        container.className = "myt-view";
        column.appendChild(container);
        applyVarFallback(container); // 宿主主题变量缺席 → 切内置兜底调色板
        // ── 高度兜底（3.1.3 第二条真凶）────────────────────────────────────
        // overlay 是 position:absolute + height:100%，高度取自中栏（containing
        // block）。而打开态会把中栏里「除 overlay 之外的所有子元素」全部
        // display:none —— 如果中栏自身高度是「由内容决定」的（手机上常见），
        // 子元素一隐，它的高度就塌了，overlay 的 100% 跟着塌，只剩 3.1.2 里那条
        // min-height:320px 在撑。而手机上顶栏 + 九个 tab 折行后正好吃掉 300px 上下
        // → 内容区拿到的高度≈0 → 就是「顶栏和 tab 都在、下面一片黑」。
        // 这里量一次中栏与视口，取一个确定的像素下限写在容器上，双保险。
        var applyHeightFloor = function () {
          try {
            var paneH = column.clientHeight || 0;
            var viewH = window.innerHeight || 0;
            // 以视口 82% 为下限：宁可让面板略微高出一屏（内部滚动），也不能塌成 0
            var floor = Math.max(320, Math.round(viewH * 0.82));
            if (paneH >= floor) {
              // 中栏高度健康：交回 CSS（height:100vh），别用内联值压住它
              container.style.height = "";
              container.style.minHeight = "";
            } else {
              // 中栏塌了：必须写**确定高度**（height），只写 min-height 不产生
              // 确定值，下游 height:100% / flex:1 依旧解不出来 —— 那正是
              // 「还是黑 + 正文划不动」的原因。inline 覆盖 CSS 的 100vh，
              // 更贴合真实中栏（排除宿主顶栏高度差）。
              container.style.height = floor + "px";
              container.style.minHeight = floor + "px";
            }
          } catch (e) { /* 量不到就不设，CSS 里的 min-height 仍在 */ }
        };
        applyHeightFloor();
        var floorTimer = setTimeout(applyHeightFloor, 260); // 折行/字体收敛后再校一次
        var floorOnResize = function () { applyHeightFloor(); };
        if (window.addEventListener) window.addEventListener("resize", floorOnResize);
        var prevCleanup = overlayContainerCleanup;
        overlayContainerCleanup = function () {
          clearTimeout(floorTimer);
          if (window.removeEventListener) window.removeEventListener("resize", floorOnResize);
          if (prevCleanup) { try { prevCleanup(); } catch (e) {} }
        };
        root = ReactDOMClient.createRoot(container);
        // InstanceScope 是弹层门户根（MaskPortal portal 进它）；容器只当挂载点，
        // 定位/互斥属性链照旧留在容器上
        root.render(h(OverlayPresence, null,
          h(InstanceScope, { className: "myt-viewRoot" },
            // ShellErrorBoundary 堵在最外层：手机上任一渲染异常都转成可读卡片，
            // 不再是一片黑（容器有背景色、内部空）。
            h(ShellErrorBoundary, { onClose: function () { controller.close(); } },
              h(PageShell, {
                onClose: function () { controller.close(); },
                sbReady: sbReady,
                sbProbe: sbProbe,
                openReaderTab: function (file, ws) { // split：点章开右侧栏文章页（返回开没开成）
                  var handle = ensureSb ? ensureSb() : (opts && opts.sbHandleRef && opts.sbHandleRef.current);
                  if (handle && typeof handle.openReader === "function") return handle.openReader(file, ws);
                  return false;
                },
              })))));

        // 首帧画完量一次、稍后再量一次（字体/布局收敛）：结果上报服务端日志。
        // 手机黑屏时这段就是唯一的现场记录，务必在 render 之后、且不阻断渲染。
        var diagTimers = [];
        var diagOnce = function (tag) {
          try { sendDiag(collectDiag(tag)); } catch (e) { /* 绝不冒泡 */ }
        };
        requestAnimationFrame(function () {
          diagTimers.push(setTimeout(function () { diagOnce("after-mount"); }, 60));
          diagTimers.push(setTimeout(function () { diagOnce("settled"); }, 900));
        });
        if (overlayContainerCleanup) { try { overlayContainerCleanup(); } catch (e) {} }
        overlayContainerCleanup = function () {
          for (var i = 0; i < diagTimers.length; i++) clearTimeout(diagTimers[i]);
          diagTimers = [];
        };
      };
      // 会话中栏晚于插件挂载 / 容器被挤掉时重挂
      var waitObserver = new MutationObserver(ensure);
      waitObserver.observe(document.body, { childList: true, subtree: true });

      var applyActive = function () {
        var html = document.documentElement;
        if (!controller.getSnapshot().open) {
          html.removeAttribute(ACTIVE_ATTR);
          return;
        }
        OTHER_ACTIVE_ATTRS.forEach(function (attr) { html.removeAttribute(attr); });
        html.setAttribute(ACTIVE_ATTR, "");
        ensure();
        // bubbles：document 级监听（含旧面板挂在 document 的）都能收到
        document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { bubbles: true, detail: { source: "xiaoyu" } }));
      };
      var onOtherPanelActivate = function (event) {
        if (!controller.getSnapshot().open) return;
        var detail = event && event.detail;
        var source = detail && typeof detail === "object" ? detail.source : detail;
        if (source !== "xiaoyu") controller.close();
      };
      var onSidebarContextClick = function (event) {
        if (!controller.getSnapshot().open) return;
        var target = event.target;
        if (target && typeof target.closest === "function" && target.closest(SIDEBAR_CONTEXT_SELECTOR)) {
          controller.close();
        }
      };
      // 属性兜底：自己 active 丢了、或别的面板 active 了 → 关闭
      var activeObserver = new MutationObserver(function () {
        if (!controller.getSnapshot().open) return;
        var html = document.documentElement;
        if (!html.hasAttribute(ACTIVE_ATTR) || OTHER_ACTIVE_ATTRS.some(function (a) { return html.hasAttribute(a); })) {
          controller.close();
        }
      });
      activeObserver.observe(document.documentElement, { attributes: true, attributeFilter: [ACTIVE_ATTR].concat(OTHER_ACTIVE_ATTRS) });

      document.addEventListener("click", onSidebarContextClick, true);
      document.addEventListener(ACTIVATE_EVENT, onOtherPanelActivate);
      var unsubscribe = controller.subscribe(applyActive);
      applyActive();
      return function () {
        document.removeEventListener("click", onSidebarContextClick, true);
        document.removeEventListener(ACTIVATE_EVENT, onOtherPanelActivate);
        activeObserver.disconnect();
        waitObserver.disconnect();
        unsubscribe();
        document.documentElement.removeAttribute(ACTIVE_ATTR);
        if (overlayContainerCleanup) { try { overlayContainerCleanup(); } catch (e) { /* 忽略 */ } overlayContainerCleanup = null; }
        if (root) root.unmount();
        root = undefined;
        if (container) container.remove();
        container = undefined;
      };
    }

    // ── 右侧栏 tab（0.2.x 宿主）：两阶段注册——类型进 sidebarRightTabs，正文
    // 进 keyed seat（sidebar.right.pane.tab，key=类型 id）。keepMounted 保草稿：
    // 切 tab / 切会话 / 收栏都不卸载正文，等价 overlay 的「关闭不卸载」。────
    function CreatorTabBody(props) {
      var useTabInfo = props.useTabInfo;
      // tab 形态与 overlay 同源样式：主题变量缺席时同样切兜底调色板
      var tabRootRef = function (el) { if (el) applyVarFallback(el); };
      var closeTab = props.closeTab;
      var openReaderTab = props.openReader; // 分栏路由：tab 实例里点章开文章页 tab
      var info = typeof useTabInfo === "function" ? useTabInfo() : null;
      var tab = info ? info.tab : null;
      // tab 重新可见（false→true 跳变）视作一次「重开」，驱动 PageShell 三重
      // 重拉（等价 overlay 的 dsh-panel-activate 广播）；首次挂载不触发。
      var _rs = useState(0), reopenSeq = _rs[0], setReopenSeq = _rs[1];
      var seenRef = useRef(null);
      var visible = tab ? !!tab.visible : false;
      useEffect(function () {
        if (seenRef.current === false && visible) setReopenSeq(function (nv) { return nv + 1; });
        seenRef.current = visible;
      }, [visible]);
      // tab 形态也要上报（3.1.7）：原来只有 overlay 那条路调 collectDiag，
      // 于是「打开形态 = 右侧栏」的机器在日志里完全静默，排障时等于没有现场。
      var tabDiagRef = function (el) {
        if (!el) return;
        tabRootRef(el);
        if (el.getAttribute("data-diag-done") === "1") return;
        el.setAttribute("data-diag-done", "1");
        requestAnimationFrame(function () {
          setTimeout(function () { try { sendDiag(collectDiag("tab-after-mount")); } catch (e) {} }, 80);
          setTimeout(function () { try { sendDiag(collectDiag("tab-settled")); } catch (e) {} }, 900);
        });
      };
      return h("div", { className: "myt-view myt-viewTab", ref: tabDiagRef },
        h(PageShell, {
          onClose: tab && closeTab ? function () { closeTab(tab.id); } : undefined,
          sbReady: !!props.sbReady,
          sbProbe: function () { return true; }, // tab 实例：注册成功才有它，服务必然在
          activateSeq: reopenSeq,
          openReaderTab: openReaderTab,
        }));
    }

    // 文章页 tab 正文：params { file, wsPath } 自持数据（ChapterReader 六 prop
    // 自足，快照自己拉）。复导航（navigation.revision 递增）换 key 重挂内层
    // 阅读页——换章语义等价 overlay 的 key 重挂：编辑态/草稿随章重置；
    // 0.5.1 起组件卸载前会补一次保存（卸载急救），不再赌「30s 自动保存窗口」。
    // keepMounted 保的仍是「切 tab/切会话不丢」这一半。
    function ReaderTabBody(props) {
      var useTabInfo = props.useTabInfo;
      var closeTab = props.closeTab;
      var info = typeof useTabInfo === "function" ? useTabInfo() : null;
      var tab = info ? info.tab : null;
      var nav = tab && tab.navigation ? tab.navigation : null;
      var params = nav && nav.params ? nav.params : {};
      var file = params.file || "";
      var wsPath = params.wsPath || "";
      var revision = nav && typeof nav.revision === "number" ? nav.revision : 0;
      // 下一章（0.4.6）：tab 内部换章不重新 openTab（会让宿主再推一遍 params，
      // 且 tab 自己未必有 openTab 句柄）——本地 override + key 重挂，语义与复导航
      // 换章一致：编辑态/草稿随章重置。宿主推新 params 时清掉 override，听宿主的。
      var _ov = useState(null), overrideFile = _ov[0], setOverrideFile = _ov[1];
      useEffect(function () { setOverrideFile(null); }, [file, revision]);
      var shownFile = overrideFile || file;
      // 快照自持：阅读页只用 chapters 元信息（定位当前章）与 novelDir（复制路径）
      var _sn = useState(null), snap = _sn[0], setSnap = _sn[1];
      var _ld = useState(true), loading = _ld[0], setLoading = _ld[1];
      var seqRef = useRef(0);
      var loadSnap = useCallback(function (root) {
        var seq = ++seqRef.current;
        if (!root) { setSnap(null); setLoading(false); return; }
        setLoading(true);
        apiGet("state", { path: root }).then(function (d) {
          if (seq !== seqRef.current) return; // 过期响应：已切工作区，丢弃
          setSnap(d && d.ok ? d : null);
        }).catch(function () {
          if (seq !== seqRef.current) return;
          setSnap(null);
        }).finally(function () {
          if (seq === seqRef.current) setLoading(false);
        });
      }, []);
      useEffect(function () { loadSnap(wsPath); }, [wsPath, loadSnap]);
      var reload = useCallback(function () { return wsPath ? loadSnap(wsPath) : Promise.resolve(); }, [wsPath, loadSnap]);
      // 软刷新（0.15.2）：文章页 tab 只用到 chapters 元信息，保存后没必要拉账本
      // 全量；lite + 合并即可。失败回落全量。
      var loadSnapSoft = useCallback(function (root) {
        var seq = ++seqRef.current;
        if (!root) return Promise.resolve();
        return apiGet("state", { path: root, blocks: FIRST_SCREEN_BLOCKS }).then(function (d) {
          if (seq !== seqRef.current) return null;
          if (!d || !d.ok) return loadSnap(root);
          setSnap(function (prev) {
            if (!prev || prev.novelDir !== d.novelDir) return d;
            var next = Object.assign({}, prev, d);
            (d.partial || []).forEach(function (k) { next[k] = prev[k]; });
            next.partial = [];
            return next;
          });
          return null;
        }).catch(function () { return loadSnap(root); });
      }, [loadSnap]);
      var reloadSoft = useCallback(function () { return wsPath ? loadSnapSoft(wsPath) : Promise.resolve(); }, [wsPath, loadSnapSoft]);
      // 按需补块（0.22.0）：首屏只拉骨架，切到时间线/设定/索引板时把缺的块拉回来。
      // 只补「当前快照里标着 partial」的块——重复切同一 tab 不会反复请求；失败静默，
      // 该 tab 显示空列表（账本拉不到不该挡写作）。
      var blockReqRef = useRef(Object.create(null));
      var ensureBlocks = useCallback(function (names) {
        var root = effectiveWs;
        if (!root || !names) return;
        var snapNow = snapRef.current;
        var missing = String(names).split(",").filter(function (k) {
          return snapNow && Array.isArray(snapNow.partial) && snapNow.partial.indexOf(k) !== -1;
        });
        if (missing.length === 0) return;
        var key = root + "|" + names;
        if (blockReqRef.current[key]) return;
        blockReqRef.current[key] = true;
        apiGet("state", { path: root, blocks: names }, { silent: true }).then(function (d) {
          if (!d || !d.ok) return;
          setSnap(function (prev) {
            if (!prev || prev.novelDir !== d.novelDir) return prev;
            var next = Object.assign({}, prev);
            for (var i = 0; i < missing.length; i += 1) {
              var k = missing[i];
              if (Array.isArray(d[k])) next[k] = d[k];
            }
            next.partial = (prev.partial || []).filter(function (k) { return missing.indexOf(k) === -1; });
            return next;
          });
        }).catch(function () {}).finally(function () { blockReqRef.current[key] = false; });
      }, [effectiveWs]);
      // 兜底：任何路径切到的 tab 若还缺块，这里补一次（gotoTab 之外还有 setTab 直调）。
      useEffect(function () {
        if (!snap || !snap.found) return;
        var need = TAB_BLOCKS[tab];
        if (need) ensureBlocks(need);
      }, [tab, snap, ensureBlocks]);
      // tab 重新可见（false→true）：快照现拉 + reopenSeq 自增（阅读页走 silent
      // 重拉本章，不碰草稿）。处理函数走 ref，effect 只依赖 visible。
      var _rs = useState(0), reopenSeq = _rs[0], setReopenSeq = _rs[1];
      var seenRef = useRef(null);
      var visible = tab ? !!tab.visible : false;
      var actRef = useRef({ loadSnap: loadSnap, wsPath: wsPath });
      actRef.current = { loadSnap: loadSnap, wsPath: wsPath };
      useEffect(function () {
        if (seenRef.current === false && visible) {
          setReopenSeq(function (nv) { return nv + 1; });
          actRef.current.loadSnap(actRef.current.wsPath);
        }
        seenRef.current = visible;
      }, [visible]);
      var inner = null;
      if (!file) inner = h(Empty); // 哑态：tab 只能带 params 创建，防御性兜底
      else if (loading && !snap) inner = h(SkelPage);
      else if (!snap) inner = h(ErrorStrip, { text: tt("readerTab.snapFailed"), onRetry: function () { loadSnap(wsPath); } });
      else inner = h(ChapterReader, {
        key: shownFile + ":" + revision, // 换章/复导航/下一章重挂：编辑态与草稿随章重置
        file: shownFile, wsPath: wsPath, snap: snap, reload: reload, reloadSoft: reloadSoft,
        refreshSeq: reopenSeq,
        onBack: tab && closeTab ? function () { closeTab(tab.id); } : undefined, // 顶栏返回=关 tab（脏退出确认在 ChapterReader 内）
        onOpenChapter: function (nextFile) { setOverrideFile(nextFile); }, // 下一章：挪 key 重挂
      });
      return h("div", { className: "myt-view myt-viewTab" }, inner, h(ToastHostOwned));
    }

    // 注册右侧栏 tab：成功返回句柄 { open, dispose }，失败/服务缺席返回 null
    // （入口与 overlay 挂载据此回落中栏形态）。注册抛错（id/kind 冲突等接线
    // 错误）时清干净已注册的部分再回落，绝不带病上岗。
    function mountSidebarTab(ctx, opts) {
      var sbTabs = opts && opts.tabs;
      var sbRight = opts && opts.right;
      if (!sbTabs || !sbRight || !ctx || !ctx.slots || typeof ctx.slots.inject !== "function") return null;
      var disposers = [];
      // split：点章开文章页 tab。同 kind 页 tab 在目标格内去重——已开则聚焦
      // 并推新 params（复导航换章），不开新 tab。返回是否真的开出去：无停靠面
      //（hero 页等无会话在屏时宿主控制器直接 throw）或 kind 未注册时 false，
      // 调用方回落面板内整页阅读，绝不静默吞掉一次点击。
      function openReaderFn(file, wsPath) {
        try { sbRight.openTab(SB_READER_KIND, { params: { file: file, wsPath: wsPath } }); return true; }
        catch (err) {
          if (ctx.logger && typeof ctx.logger.warn === "function") {
            ctx.logger.warn("dsh-xiaoyu-novel: openReader tab failed: " + String((err && err.message) || err));
          }
          return false;
        }
      }
      try {
        disposers.push(sbTabs.register({
          id: SB_CREATOR_ID,
          kind: SB_CREATOR_KIND,
          title: function () { return "小鱼创作台"; }, // tab 帽签（打开时捕获）
          keepMounted: true,
          guide: [{ // 开始页卡片：无 icon 用官方占位图；点击按 kind 开页
            id: "creator", order: 30,
            title: function () { return "小鱼创作台"; },
            description: function () { return "网文写作工作台：章节、角色、伏笔、时间线与设定一站管理。"; },
          }],
        }));
        var disposeSlot = ctx.slots.inject("sidebar.right.pane.tab", function () {
          return ctx.slots.register({ name: "sidebar.right.pane.tab", key: SB_CREATOR_ID }, function TabBody(tabProps) {
            return h(CreatorTabBody, {
              useTabInfo: tabProps && tabProps.useTabInfo,
              closeTab: function (tabId) { try { sbRight.close(tabId); } catch (err) { /* 已不在屏：视为已关 */ } },
              openReader: openReaderFn,
              sbReady: true,
            });
          });
        });
        disposers.push(typeof disposeSlot === "function" ? disposeSlot : function () {});
        // 文章页类型（split 形态用）：无 guide 卡，只从创作台点章进入
        disposers.push(sbTabs.register({
          id: SB_READER_ID,
          kind: SB_READER_KIND,
          title: function () { return "文章"; }, // 帽签静态；章题动态帽签要 title seat，本版不做
          keepMounted: true,
        }));
        var disposeSlotReader = ctx.slots.inject("sidebar.right.pane.tab", function () {
          return ctx.slots.register({ name: "sidebar.right.pane.tab", key: SB_READER_ID }, function ReaderTabShell(tabProps) {
            return h(ReaderTabBody, {
              useTabInfo: tabProps && tabProps.useTabInfo,
              closeTab: function (tabId) { try { sbRight.close(tabId); } catch (err) { /* 已不在屏 */ } },
            });
          });
        });
        disposers.push(typeof disposeSlotReader === "function" ? disposeSlotReader : function () {});
      } catch (err) {
        disposers.forEach(function (d) { try { d(); } catch (e2) { /* 尽力清理 */ } });
        if (ctx.logger && typeof ctx.logger.warn === "function") {
          ctx.logger.warn("dsh-xiaoyu-novel: sidebar tab mount failed: " + String((err && err.message) || err));
        }
        return null;
      }
      return {
        // 入口点击：已是活动 tab 且侧栏展开 → 收栏（开关语义）；否则打开/聚焦。
        // hero 页等无会话在屏时 openTab 抛错 → 静默（此时中栏也没有容器，行为对齐）。
        open: function () {
          try {
            var active = sbRight.active();
            if (active && active.kind === SB_CREATOR_KIND && sbRight.isExpanded()) sbRight.toggleExpanded();
            else sbRight.openTab(SB_CREATOR_KIND);
          } catch (err) { /* 无停靠面：静默 */ }
        },
        // split：点章开文章页 tab（去重/聚焦语义见 openReaderFn；返回开没开成）。
        openReader: openReaderFn,
        dispose: function () { disposers.forEach(function (d) { try { d(); } catch (e2) { /* 单个失败不阻断 */ } }); },
      };
    }

    // ── 引导卡（无 novel 工作区 / 未初始化）：xiaoyu-novel init 提示 + 复制 ──────
    function GuideCard(props) {
      var title = props.title || tt("guide.defaultTitle");
      var desc = props.desc || tt("guide.defaultDesc");
      var _b = useState(false), busy = _b[0], setBusy = _b[1];
      function doCopy() {
        setBusy(true);
        copyText("xiaoyu-novel init").then(function (ok) {
          if (ok) toast.ok(tt("guide.copied"));
          else toast.warn(tt("guide.copyFailed"));
        }).finally(function () { setBusy(false); });
      }
      return h("div", { className: "myt-card myt-guide" },
        h("h2", { className: "myt-guideTitle" }, title),
        h("p", { className: "myt-guideText" }, desc),
        h("div", { className: "myt-guideCode" },
          h("code", { className: "myt-guideCodeText" }, "xiaoyu-novel init"),
          h("button", { type: "button", className: "myt-btn myt-copyBtn", disabled: busy, onClick: doCopy }, busy ? tt("guide.copying") : tt("guide.copyCmd"))));
    }

    // ── 骨架 / 错误 / 空态小件 ──────────────────────────────────────────────
    function SkelPage() {
      return h("div", { className: "myt-stack" },
        h("div", { className: "myt-skelCard" }, h("div", { className: "myt-skel myt-skelRow", style: { width: "40%" } }), h("div", { className: "myt-skel myt-skelRow", style: { width: "72%" } }), h("div", { className: "myt-skel myt-skelRow", style: { width: "56%" } })),
        h("div", { className: "myt-grid" }, h("div", { className: "myt-skelCard" }), h("div", { className: "myt-skelCard" })));
    }
    function ErrorStrip(props) {
      return h("div", { className: "myt-strip myt-stripError" },
        h("span", { className: "myt-stripIcon" }, ic("IconWarningOutlineRegular", 14)),
        h("span", { className: "myt-stripText" }, props.text),
        props.onRetry ? h("button", { type: "button", className: "myt-btn", style: { marginLeft: "auto" }, onClick: props.onRetry }, tt("common.retry")) : null);
    }
    function Empty(props) { return h("div", { className: "myt-empty" }, props.text || tt("common.empty")); }

    // tab 内容错误边界：任何 tab / 阅读页渲染抛错都降级为卡内错误态（错误摘要
    // + 重试按钮），不再把整个面板炸成白屏。错误边界只有 class 组件能做
    // （getDerivedStateFromError / componentDidCatch），此处破例用 class。
    class TabErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { err: null };
        this.retry = this.retry.bind(this);
      }
      static getDerivedStateFromError(err) {
        return { err: err }; // 渲染抛错 → 下一次 render 走降级分支
      }
      componentDidCatch(err) {
        // 只记控制台：卡内已有降级 UI，toast 通道留给请求错误，不重复打扰。
        if (typeof console !== "undefined" && console.warn) console.warn("xiaoyu: 分区渲染出错:", err);
      }
      retry() {
        this.setState({ err: null });
        if (typeof this.props.onRetry === "function") this.props.onRetry(); // 顺手重拉快照，坏数据一并刷掉
      }
      render() {
        var err = this.state.err;
        if (!err) return this.props.children;
        var msg = String((err && err.message) || err || tt("common.unknownErr"));
        return h("div", { className: "myt-card" },
          h("div", { className: "myt-cardHead" }, h("h3", { className: "myt-cardTitle" }, tt("errBoundary.title"))),
          h("div", { className: "myt-muted", style: { overflowWrap: "anywhere" } }, tf("errBoundary.summary", { msg: truncate(msg, 300) })),
          h("div", { className: "myt-heroMeta" },
            h("button", { type: "button", className: "myt-btn", onClick: this.retry }, tt("common.retry"))));
      }
    }

    /**
     * 外壳错误边界（3.1.2）：`PageShell` 整棵树级兜底。
     *
     * `TabErrorBoundary` 只护住 tab 内容——顶栏、tab 条、加载分支（SkelPage /
     * ErrorStrip / GuideCard）仍在它外面。手机上一次外壳渲染异常（旧 WebView
     * 缺少某个 CSS/API、或数据里有它啃不动的值）就会把整棵树抹掉，用户看到
     * 的就是「黑屏」：容器有背景色、里面什么都没有，连「出错了」都看不到。
     * 这一层保证任何异常都以可读文本收场。
     */
    class ShellErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { err: null };
        this.retry = this.retry.bind(this);
      }
      static getDerivedStateFromError(err) {
        return { err: err };
      }
      componentDidCatch(err) {
        // 手机上没法开控制台：把摘要同时写进 sessionStorage，用户反馈时能取到。
        try {
          var list = JSON.parse(sessionStorage.getItem("xiaoyu.renderErrors") || "[]");
          list.push({ at: Date.now(), message: String((err && err.message) || err), stack: String((err && err.stack) || "").slice(0, 1200) });
          sessionStorage.setItem("xiaoyu.renderErrors", JSON.stringify(list.slice(-5)));
        } catch (_) { /* 隐私模式：忽略 */ }
        if (typeof console !== "undefined" && console.warn) console.warn("xiaoyu: 面板外壳渲染出错:", err);
      }
      retry() {
        this.setState({ err: null });
      }
      render() {
        var err = this.state.err;
        if (!err) return this.props.children;
        var msg = String((err && err.message) || err || "未知错误");
        return h("div", { className: "myt-shell" },
          h("div", { className: "myt-card", style: { margin: "16px" } },
            h("div", { className: "myt-cardHead" }, h("h3", { className: "myt-cardTitle" }, "面板渲染出错")),
            h("div", { className: "myt-muted", style: { overflowWrap: "anywhere" } }, msg),
            h("div", { className: "myt-muted", style: { marginTop: "8px", fontSize: "12px" } },
              "浏览器版本：" + (typeof navigator !== "undefined" ? String(navigator.userAgent || "").slice(0, 120) : "未知")),
            h("div", { className: "myt-heroMeta", style: { marginTop: "12px" } },
              h("button", { type: "button", className: "myt-btn myt-btnPrimary", onClick: this.retry }, "重试"),
              h("button", {
                type: "button", className: "myt-btn",
                onClick: this.props.onClose || function () {},
              }, "关闭"))));
      }
    }

    // ── 页面骨架：顶栏（工作区下拉 + 刷新 + 关闭）+ tab 条 + 内容区 ─────────
    // 数据流：workspaces 与 state 每次打开面板都重拉（懒挂载下关闭不卸载，
    // 见下方 activate 监听）；state 另跟随选中工作区；写操作 POST 成功后
    // 整份重拉 state（不乐观更新）。选择记 localStorage('xiaoyu.workspace')。
    function PageShell(props) {
      var onClose = props.onClose;
      var sbProbe = typeof props.sbProbe === "function" ? props.sbProbe : function () { return !!props.sbReady; }; // 活探测：旧调用只传布尔时兜底
      var openReaderTab = props.openReaderTab; // split 形态点章开右侧栏文章页 tab；null/缺省=不可用 // 宿主带右侧栏服务（sidebarRightTabs/sidebarRight）才可切右栏形态
      var _ws = useState(null), workspaces = _ws[0], setWorkspaces = _ws[1]; // null = 拉取中
      var _we = useState(""), wsErr = _we[0], setWsErr = _we[1];
      var _sel = useState(function () { return lsGet(WS_STORAGE_KEY) || ""; }), selWs = _sel[0], setSelWs = _sel[1];
      var _sn = useState(null), snap = _sn[0], setSnap = _sn[1];
      // snapRef：按需补块时要在异步回调里读「当前快照缺哪些块」，闭包里的 snap 会是旧值。
      var snapRef = useRef(null);
      snapRef.current = snap;
      var _ld = useState(true), loading = _ld[0], setLoading = _ld[1];
      var _se = useState(""), stateErr = _se[0], setStateErr = _se[1];
      var _tb = useState("overview"), tab = _tb[0], setTab = _tb[1];
      // 关系图「点人名跳角色卡」的跨 tab 请求：切到角色页后自动打开这张卡，
      // 打开即消费（置回 null），不留悬空请求。
      // 章节阅读页（整页视图，替代原右侧抽屉）：null = 列表态。
      var _rd = useState(null), readerFile = _rd[0], setReaderFile = _rd[1];
      var _cf = useState(null), charFocus = _cf[0], setCharFocus = _cf[1];
      // 面板重开序号：每次 activate 广播自增，透传 ChapterReader 驱动本章重拉。
      var _rs = useState(0), reopenSeq = _rs[0], setReopenSeq = _rs[1];
      // 系统设置：字号档位持久化 + 面板整体缩放（portal 节点读同一 CSS 变量）。
      var _sm = useState(false), showSettings = _sm[0], setShowSettings = _sm[1];
      // 0.6.0：全书搜索 / 命令面板。
      var _so = useState(false), searchOpen = _so[0], setSearchOpen = _so[1];
      // 工具弹层（0.15.0）：回收站 / 整本导出 / 账本瘦身。手机端没有终端，
      // 这三件以前只有 CLI 能做的事必须有面板入口。
      var _tool = useState(false), toolsOpen = _tool[0], setToolsOpen = _tool[1];
      var _toolTab = useState("trash"), toolsTab = _toolTab[0], setToolsTab = _toolTab[1];
      function openTools(tabKey) { setToolsTab(tabKey || "trash"); setToolsOpen(true); }
      var _sq = useState(""), searchQuery = _sq[0], setSearchQuery = _sq[1];
      var _sres = useState(null), searchRes = _sres[0], setSearchRes = _sres[1];
      var _sb = useState(false), searchBusy = _sb[0], setSearchBusy = _sb[1];
      var _rt = useState(""), replaceText = _rt[0], setReplaceText = _rt[1];
      var _pal = useState(false), paletteOpen = _pal[0], setPaletteOpen = _pal[1];
      var _pq = useState(""), paletteQuery = _pq[0], setPaletteQuery = _pq[1];
      var _pix = useState(0), paletteIndex = _pix[0], setPaletteIndex = _pix[1];
      var _fs = useState(function () {
        var stored = lsGet(FONT_SCALE_KEY) || "1";
        return FONT_SCALES.some(function (o) { return o[0] === stored; }) ? stored : "1"; // 旧档位（1.8/2）回落 100%
      }), fontScale = _fs[0], setFontScale = _fs[1];
      var _lg = useState(function () {
        var stored = lsGet(LANG_KEY) || "zh";
        return UI_LANGS.some(function (o) { return o[0] === stored; }) ? stored : "zh";
      }), lang = _lg[0], setLang = _lg[1];
      // 打开形态（split/middle/sidebar）：localStorage 记忆，系统设置里切换。
      // 切换不强拆已开的面板/页面，对下一次打开生效。
      var _om = useState(getOpenMode), openMode = _om[0], setOpenMode = _om[1];
      useEffect(function () {
        UI_LANG = lang;
        lsSet(LANG_KEY, lang);
      }, [lang]);
      useEffect(function () {
        if (typeof document !== "undefined" && document.documentElement) {
          document.documentElement.style.setProperty("--myt-zoom", fontScale);
        }
        lsSet(FONT_SCALE_KEY, fontScale);
      }, [fontScale]);

      // 弹层定位不再测量视口矩形：MaskPortal 直接 portal 进实例根（InstanceScope），
      // 弹层 absolute inset:0 铺满所属实例，居中基准天然随实例走，旧 --myt-anchor-*/
      // --myt-mask-* 全局变量机制整体退役。

      // 选中校正：记忆的工作区必须仍在列表且 hasNovel，否则落回首个 hasNovel。
      var effectiveWs = (function () {
        if (!workspaces) return "";
        var hit = null;
        for (var i = 0; i < workspaces.length; i++) {
          var w = workspaces[i];
          if (w.path === selWs && w.hasNovel) { hit = w; break; }
        }
        if (hit) return hit.path;
        for (var j = 0; j < workspaces.length; j++) {
          if (workspaces[j].hasNovel) return workspaces[j].path;
        }
        return "";
      })();

      var loadWorkspaces = useCallback(function () {
        setWsErr("");
        return apiGet("workspaces").then(function (d) {
          var list = Array.isArray(d && d.workspaces) ? d.workspaces : [];
          // hasNovel 排前，各自按 name 稳定排序（spec §4：hasNovel 排前）。
          list.sort(function (a, b) {
            if (!!a.hasNovel !== !!b.hasNovel) return a.hasNovel ? -1 : 1;
            return String(a.name || a.path || "").localeCompare(String(b.name || b.path || ""), "zh-CN");
          });
          setWorkspaces(list);
          return list;
        }).catch(function (err) {
          setWsErr(err.message);
          setWorkspaces([]);
        });
      }, []);
      var stateSeqRef = useRef(0); // state 请求序号：快速切工作区时丢弃过期响应
      // 首屏两段式（0.15.0）：每个工作区第一次打开先要 scope=lite（骨架 87KB），
      // 立刻可交互，再在后台补全量（账本正文）；之后的 reload 一律直接全量。
      // 精简请求失败不报错——直接回落全量，等于回到旧行为。
      var liteDoneRef = useRef(Object.create(null));
      var loadState = useCallback(function (root) {
        var seq = ++stateSeqRef.current; // 先自增再发请求；早退分支也作废在途旧响应
        if (!root) { setSnap(null); setStateErr(""); setLoading(false); return; }
        setLoading(true);
        setStateErr("");
        var firstLook = !liteDoneRef.current[root];
        if (!firstLook) {
          return apiGet("state", { path: root }).then(function (d) {
            if (seq !== stateSeqRef.current) return; // 过期响应：已有更新的请求在途，丢弃
            // 3.1.3：载荷 ok:false 时以前是 setSnap(null) 了事——快照被丢掉、
            // stateErr 又没设，外壳于是走到「没数据也没报错」的空档，内容区精确
            // 渲染成空（手机黑屏真凶）。现在把服务端的错误原文抬到 stateErr，
            // 至少能在卡内看见原因与重试。
            if (d && d.ok) setSnap(d);
            else { setSnap(null); setStateErr((d && d.error) || "状态快照返回为空（服务端未给出原因）"); }
          }).catch(function (err) {
            if (seq !== stateSeqRef.current) return;
            setSnap(null);
            setStateErr(err.message);
          }).finally(function () {
            if (seq === stateSeqRef.current) setLoading(false); // 过期收尾不碰加载态
          });
        }
        liteDoneRef.current[root] = true;
        // 骨架只含首屏要用的块（0.22.0）：章节/角色/关系/伏笔/分卷/项目。
        // 记忆/时间线/线索/世界/考据/章纲等切到对应 tab 时再拉（见 ensureBlock）。
        return apiGet("state", { path: root, blocks: FIRST_SCREEN_BLOCKS }).then(function (d) {
          if (seq !== stateSeqRef.current) return null;
          if (d && d.ok) { setSnap(d); setLoading(false); } // 骨架先上屏
          // 骨架也没成：直接抛给下面的 catch 走去全量，不再静默留在加载态
          else if (!(d && d.ok)) throw new Error((d && d.error) || "首屏快照返回为空");
          return apiGet("state", { path: root }).then(function (full) {
            if (seq !== stateSeqRef.current) return;
            if (full && full.ok) setSnap(full); // 全量补齐：整体替换，不做字段合并
            // 骨架已上屏时全量失败：保留骨架（总比空好），只把原因记下来
            else setStateErr((full && full.error) || "全量快照补齐失败（骨架内容不受影响）");
          });
        }).catch(function (err) {
          // 精简失败（老宿主不认识 scope、网络抖动）：直接走全量，行为与旧版一致
          return apiGet("state", { path: root }).then(function (full) {
            if (seq !== stateSeqRef.current) return;
            if (full && full.ok) setSnap(full);
            else { setSnap(null); setStateErr(`${err.message}`); }
          });
        }).catch(function (err) {
          if (seq !== stateSeqRef.current) return;
          setSnap(null);
          setStateErr(err.message);
        }).finally(function () {
          if (seq === stateSeqRef.current) setLoading(false);
        });
      }, []);
      var reload = useCallback(function () {
        return effectiveWs ? loadState(effectiveWs) : Promise.resolve();
      }, [effectiveWs, loadState]);
      // 软刷新（0.15.2）：保存正文后再拉一次全量快照是纯浪费——账本一个字没动，
      // 只是本章字数/状态变了。lite 只回骨架（69KB / 101ms），把账本等缺块用
      // 旧值补回去再整体替换，列表与统计照旧即时更新。lite 失败回落全量。
      var reloadSoft = useCallback(function () {
        var root = effectiveWs;
        if (!root) return Promise.resolve();
        var seq = ++stateSeqRef.current;
        return apiGet("state", { path: root, blocks: FIRST_SCREEN_BLOCKS }).then(function (d) {
          if (seq !== stateSeqRef.current) return null;
          if (!d || !d.ok) return loadState(root);
          setSnap(function (prev) {
            if (!prev || prev.novelDir !== d.novelDir) return d; // 换书/首次：直接用
            var next = Object.assign({}, prev, d);
            // 本次没解析的块（partial）保留旧内容：账本正文不会因为存一章而变。
            (d.partial || []).forEach(function (k) { next[k] = prev[k]; });
            next.partial = [];
            return next;
          });
          return null;
        }).catch(function () { return loadState(root); });
      }, [effectiveWs, loadState]);
      // 位置记忆（0.15.2）：关掉面板去聊天、回来重开，直接回到上次的 tab 与章节。
      // 按工作区分键；每次打开只恢复一次（用户主动返回列表后不再硬拽回去）。
      var TAB_STORE = "myt-tab:";
      var READ_STORE = "myt-reader:";
      var restoredRef = useRef(Object.create(null));
      var skipWriteRef = useRef(Object.create(null));
      useEffect(function () {
        if (!effectiveWs || !snap || !snap.found) return;
        if (restoredRef.current[effectiveWs]) return;
        restoredRef.current[effectiveWs] = true;
        skipWriteRef.current[effectiveWs] = true; // 本轮 effect 的写入跳过：值还是恢复前的
        var savedTab = lsGet(TAB_STORE + effectiveWs);
        if (savedTab && TABS.some(function (x) { return x[0] === savedTab; })) {
          setTab(savedTab);
          // 恢复上次的 tab 同样要补块（首屏只有骨架）。
          if (TAB_BLOCKS[savedTab]) ensureBlocks(TAB_BLOCKS[savedTab]);
        }
        var savedFile = lsGet(READ_STORE + effectiveWs);
        if (savedFile && Array.isArray(snap.chapters) && snap.chapters.some(function (c) { return c.file === savedFile; })) {
          setReaderFile(savedFile);
        }
      }, [effectiveWs, snap]);
      useEffect(function () {
        if (!effectiveWs || !restoredRef.current[effectiveWs]) return;
        if (skipWriteRef.current[effectiveWs]) { skipWriteRef.current[effectiveWs] = false; return; }
        lsSet(TAB_STORE + effectiveWs, tab);
      }, [effectiveWs, tab]);
      useEffect(function () {
        if (!effectiveWs || !restoredRef.current[effectiveWs]) return;
        try {
          if (readerFile) lsSet(READ_STORE + effectiveWs, readerFile);
          else window.localStorage.removeItem(READ_STORE + effectiveWs);
        } catch (err) { /* 隐私模式：记不住就算了 */ }
      }, [effectiveWs, readerFile]);
      // 全书搜索（0.6.0）：服务端遍历 chapters/ + outlines/，空格分词取交集。
      function runSearch(raw) {
        var q = String(raw == null ? searchQuery : raw).trim();
        if (q === "" || !effectiveWs) { setSearchRes(null); return; }
        setSearchBusy(true);
        apiGet("search", { path: effectiveWs, q: q }).then(function (d) {
          setSearchRes(d && d.ok ? d : { ok: false, matches: [] });
        }).catch(function (err) {
          setSearchRes({ ok: false, matches: [], error: err.message });
        }).finally(function () { setSearchBusy(false); });
      }
      function openHit(hit) {
        if (!hit || !hit.file) return;
        var known = (snap && snap.chapters ? snap.chapters : []).some(function (c) { return c.file === hit.file; });
        if (!known) { toast.warn(tt("search.empty")); return; }
        setSearchOpen(false);
        setTab("chapters");
        if (!openChapterExternal(hit.file)) setReaderFile(hit.file);
      }
      function runReplace() {
        if (!searchRes || !Array.isArray(searchRes.matches) || searchRes.matches.length === 0) { toast.warn(tt("search.preview")); return; }
        if (String(searchQuery).trim() === "") return;
        if (!window.confirm(tf("search.replaceConfirm", { n: searchRes.matches.length, find: searchQuery, to: replaceText }))) return;
        apiPost("replace", { path: effectiveWs, find: String(searchQuery).trim(), replace: replaceText }).then(function (d) {
          toast.ok(tf("search.replaced", { n: d && d.total ? d.total : 0 }));
          runSearch(searchQuery);
          return reload();
        }).catch(function () { /* apiPost 已 toast */ });
      }
      function paletteActions() {
        var list = [];
        for (var ti = 0; ti < TABS.length; ti++) {
          list.push({ label: tf("palette.actionTab", { tab: tt(TABS[ti][1]) }), run: (function (key) { return function () { gotoTab(key); }; })(TABS[ti][0]) });
        }
        list.push({ label: tt("palette.actionRefresh"), run: reload });
        list.push({ label: tt("palette.actionSearch"), run: function () { setPaletteOpen(false); setSearchOpen(true); } });
        list.push({ label: tt("palette.actionSettings"), run: function () { setPaletteOpen(false); setShowSettings(true); } });
        var chapters = snap && snap.chapters ? snap.chapters : [];
        for (var ci = 0; ci < chapters.length && ci < 60; ci++) {
          list.push({ label: tf("palette.actionChapter", { name: chFullTitle(chapters[ci]) }), run: (function (c) { return function () { setPaletteOpen(false); setTab("chapters"); if (!openChapterExternal(c.file)) setReaderFile(c.file); }; })(chapters[ci]) });
        }
        return list;
      }
      useEffect(function () {
        var onKey = function (e) {
          if (!(e.ctrlKey || e.metaKey)) return;
          var key = String(e.key || "").toLowerCase();
          if (key === "k") {
            e.preventDefault();
            setPaletteQuery("");
            setPaletteIndex(0);
            setPaletteOpen(function (v) { return !v; });
          } else if (key === "f" && e.shiftKey) {
            e.preventDefault();
            setSearchOpen(true);
          }
        };
        document.addEventListener("keydown", onKey, true);
        return function () { document.removeEventListener("keydown", onKey, true); };
      }, []);

      // 新版检测（模仿 dsh-paoding）：面板打开时拉一次（服务端有 1h 缓存），
      // updateAvailable 才渲染徽章；失败静默，不打扰任何主流程。
      var _ver = useState(null), ver = _ver[0], setVer = _ver[1];
      useEffect(function () {
        apiGet("update-check").then(function (d) {
          if (d && d.current) setVer(d); // 常态也显示当前版本号；有新版再亮徽章
          // 凭据快过期提醒（0.22.0）：fine-grained 令牌到期后更新会静默失败，
          // 提前一周在面板说一句，比事后查 401 便宜。只提醒一次（本会话）。
          if (d && typeof d.tokenAge === "number" && typeof d.tokenRefreshDays === "number"
              && d.tokenAge >= d.tokenRefreshDays && !tokenWarnedRef.current) {
            tokenWarnedRef.current = true;
            toast.warn(tf("toast.tokenAging", { n: d.tokenAge }));
          }
        }).catch(function () {});
      }, []);
      var tokenWarnedRef = useRef(false);
      // 一键升级状态机：""（可点）→ "installing"（安装中，按钮禁用）→
      // "installed"（已装完待重启，按钮永久禁用、新版徽章收起）。可预期失败
      // （dev-link / pnpm-missing / pnpm 出错）回落 "" 允许重试；服务端短路
      // up-to-date（本地已不落后线上）也回落 ""，按钮恢复可点、不进 installed 态。
      // 全局 xiaoyu CLI 顺带更新结果（服务端 globalCli 字段）拼成 toast 第二句
      // （\n 换行，配合 base.css myt-toastText 的 pre-line 显示）：
      //   - ok 且真更新了（from → to）：「全局 xiaoyu CLI a → b」；
      //   - skipped 'missing'（用户没装全局 CLI）/ 'same'（已同版）：不提，零噪音；
      //   - ok:false：如实报「全局 CLI 更新失败：{error}」，不改动主文案的成功语义
      //     （profile 已装好，重启照常生效）。
      function globalCliNote(d) {
        var g = d && d.globalCli;
        if (!g) return "";
        if (g.ok) {
          if (g.skipped) return "";
          return "\n" + tf("toast.selfUpdate.globalOk", { from: g.from || "?", to: g.to || "?" });
        }
        return "\n" + tf("toast.selfUpdate.globalFail", { error: g.error || tt("common.unknownErr") });
      }
      var _up = useState(""), upState = _up[0], setUpState = _up[1];
      function runSelfUpdate() {
        if (upState !== "") return;
        setUpState("installing");
        // 不走 apiPost：成功提示要带新版本号、失败按 kind 分流文案，且超时
        // 单独放宽（服务端 profile pnpm 最长 180s + 全局 npm 独立 120s，统一
        // 60s 会先掐断，见常量处注释）。
        xiaoyuApi("self-update", {}, SELF_UPDATE_TIMEOUT_MS).then(function (d) {
          if (d && d.ok && d.kind === "up-to-date") {
            // 短路：profile 没装任何东西，但全局 CLI 仍可能要跟进（globalCliNote
            // 拼第二句）；按钮恢复可点；版本徽章留给 update-check 自行收敛。
            setUpState("");
            toast.ok(tf("toast.selfUpdate.upToDate", { ver: (d && d.from) || "?" }) + globalCliNote(d));
          } else if (d && d.ok) {
            setUpState("installed");
            // 硬约束照实说：装完只是磁盘换新，运行中的进程仍是旧代码。
            toast.ok(tf("toast.selfUpdate.ok", { ver: (d && d.to) || "?" }) + globalCliNote(d));
          } else if (d && d.kind === "dev-link") {
            setUpState("");
            toast.warn(tt("toast.selfUpdate.devLink"));
          } else if (d && d.kind === "pnpm-missing") {
            // 服务端 message 已带可操作出路（corepack enable / 手动命令），直显不截断；
            // 拿不到 message 才回落本地通用文案。
            setUpState("");
            toast.err(tf("toast.prefix", { msg: (d && d.error) || tt("toast.selfUpdate.pnpmMissing") }));
          } else {
            setUpState("");
            toast.err(tf("toast.prefix", { msg: (d && d.error) || tt("common.unknownErr") }));
          }
        }).catch(function (err) {
          setUpState("");
          toast.err(tf("toast.prefix", { msg: err.message }));
        });
      }
      // 手动检测更新：update-check 只在面板打开时拉一次，页面开久了拿不到
      // 新判定（服务端还有 1h 缓存）——这里带 fresh=1 让服务端绕过缓存现测。
      // 不走 apiGet：成功要带版本号、失败要报「检测失败」，apiGet 会先统一
      // toast 一遍错误再 rethrow，这里直连 xiaoyuApi 与 runSelfUpdate 同一
      // 理由（避免双份错误糊屏）；超时沿用统一 60s（服务端 10s 就收敛）。
      // 错误瘦身：服务端 error 可能是三路全败的长串排障文案，只取首句，
      // 首句仍超 ~80 字符再截断加省略号，别糊屏。
      function shortErrText(msg) {
        var s = String(msg || "").trim();
        var end = s.indexOf("。");
        if (end !== -1) s = s.slice(0, end);
        if (s.length > 80) s = s.slice(0, 79) + "…";
        return s || tt("common.unknownErr");
      }
      var _verChecking = useState(false), verChecking = _verChecking[0], setVerChecking = _verChecking[1];
      // 检查更新（0.23.0 重做）：原来只靠一条 4 秒就消失的 toast 报结果，
      // 用户点完看到按钮变回原样，主观上就是「没反应」。现在结果同时落在
      // 按钮旁边的状态位（verNote），并用不同颜色标明结论；toast 只做补充。
      var _vn = useState(null), verNote = _vn[0], setVerNote = _vn[1]
      function runVerCheck() {
        if (verChecking) return;
        setVerChecking(true);
        setVerNote(null);
        // 20s：服务端有 12s 硬闸，这里留余量。超过就当网络不通给结论，
        // 不让按钮永远停在「检测中…」——那正是「检测更新没反应」的来源。
        xiaoyuApi("update-check?fresh=1", undefined, 20000).then(function (d) {
          if (d && d.current) setVer(d); // 徽章与一键升级按钮随 setVer 自然出现/消失
          if (d && d.updateAvailable) {
            setVerNote({ kind: "new", text: tf("verNote.new", { cur: d.current, latest: d.latest }) });
            toast.ok(tf("toast.selfUpdate.found", { ver: (d && d.latest) || "?" }));
          } else if (d && !d.error) {
            setVerNote({ kind: "ok", text: tf("verNote.upToDate", { ver: d.current || "?", at: new Date().toLocaleTimeString() }) });
            toast.ok(tf("toast.selfUpdate.upToDate", { ver: (d && d.current) || "?" }));
          } else {
            var msg = shortErrText(d && d.error);
            setVerNote({ kind: "err", text: tf("verNote.fail", { msg: msg }) });
            toast.err(tf("toast.selfUpdate.checkFail", { msg: msg }));
          }
        }).catch(function (err) {
          var msg = shortErrText(err && err.message);
          setVerNote({ kind: "err", text: tf("verNote.fail", { msg: msg }) });
          toast.err(tf("toast.selfUpdate.checkFail", { msg: msg }));
        }).finally(function () {
          setVerChecking(false); // 无论成败按钮都恢复可点
        });
      }
      useEffect(function () { loadWorkspaces(); }, [loadWorkspaces]);
      // 每次打开面板都重拉工作区列表与整份 state 快照：懒挂载下关闭只是摘掉
      // active 属性，组件不卸载，上面的 mount effect 整个页面生命周期只跑一
      // 次，期间外部（CLI / agent / 其他面板）新建/删除的工作区、改动的小说
      // 内容在重开时看不见——state 原本只跟 effectiveWs 走，同工作区重开不
      // 会重拉，用户得手点右上角刷新。mountPanel 每次打开都会广播
      // dsh-panel-activate（source: "xiaoyu"），借它触发三重重拉：workspaces、
      // state 快照、阅读页本章（reopenSeq 自增）；首次打开的广播早于本组件挂
      // 载（render 异步调度），收不到也无妨——mount effect 已覆盖首拉。其余
      // 面板的同名广播按 source 过滤掉。重拉不动编辑中的草稿：loadState 本就
      // 不碰草稿，阅读页走 silent 刷新（见 ChapterReader）。
      useEffect(function () {
        var onActivate = function (event) {
          var source = event && event.detail && event.detail.source;
          if (source !== "xiaoyu") return;
          refreshCss(); // 样式也重取：CSS 现读现发，改完重开即见，不必重启宿主
          loadWorkspaces();
          reload(); // 重开即最新小说内容，不必手点右上角刷新
          setReopenSeq(function (n) { return n + 1; });
          // 工作区记忆也可能被别的实例（tab↔overlay 互切后的常驻方）改过：
          // 重开时回读，防 effectiveWs 兜底回落到第一个 hasNovel 而不认用户选择
          var memo = lsGet(WS_STORAGE_KEY) || "";
          setSelWs(function (cur) { return memo !== cur ? memo : cur; });
        };
        document.addEventListener(ACTIVATE_EVENT, onActivate);
        return function () { document.removeEventListener(ACTIVATE_EVENT, onActivate); };
      }, [loadWorkspaces, reload]);
      // 右侧栏形态的「重开」入口：tab 重新可见时 CreatorTabBody 把 activateSeq
      // 自增传进来，触发与 activate 广播等价的三重重拉。0/undefined（overlay
      // 形态、首次挂载）不动作；处理函数走 ref 避免把易变的 reload 依赖进来
      // （否则切工作区也会误触发一轮重拉）。
      var actHandlersRef = useRef({ loadWorkspaces: loadWorkspaces, reload: reload });
      actHandlersRef.current = { loadWorkspaces: loadWorkspaces, reload: reload };
      useEffect(function () {
        var seq = props.activateSeq;
        if (!seq) return;
        refreshCss();
        actHandlersRef.current.loadWorkspaces();
        actHandlersRef.current.reload();
        setReopenSeq(function (n) { return n + 1; });
      }, [props.activateSeq]);
      useEffect(function () { loadState(effectiveWs); }, [effectiveWs, loadState]);
      // 校正后的选择回写记忆（首次打开 / 记忆失效时自动落位）。
      useEffect(function () {
        if (effectiveWs && effectiveWs !== selWs) { setSelWs(effectiveWs); lsSet(WS_STORAGE_KEY, effectiveWs); }
      }, [effectiveWs, selWs]);

      function chooseWs(e) {
        var path = e && e.target ? e.target.value : "";
        if (path) lsSet(WS_STORAGE_KEY, path);
        setSelWs(path);
      }
      var _ap = useState(false), addOpen = _ap[0], setAddOpen = _ap[1];
      var _apv = useState(""), addPath = _apv[0], setAddPath = _apv[1];
      var _apb = useState(false), addBusy = _apb[0], setAddBusy = _apb[1];
      // 接入已有项目（0.23.0 修）：这几条容错都是实测踩过的——
      //   ① 用户常把「…/novel」这个书目录本身贴进来，服务端要的是它的父目录；
      //   ② 路径尾部斜杠、~ 开头、中文输入法带的全角空格；
      //   ③ 接入成功后要立刻切过去，否则用户以为没生效（原来只在全空状态可用）。
      function normalizeAddPath(raw) {
        var p = String(raw || "").trim().replace(/^\s+|\s+$/g, "");
        p = p.replace(/\u3000/g, " ").trim(); // 全角空格
        if (p.slice(-1) === "/") p = p.slice(0, -1);
        p = p.replace(/\/novel$/i, ""); // 贴了书目录本身 → 退到父目录
        if (p.slice(-1) === "/") p = p.slice(0, -1);
        return p;
      }
      function submitAddProject() {
        var target = normalizeAddPath(addPath);
        if (target === "" || addBusy) return;
        setAddBusy(true);
        apiPost("workspace-add", { path: target })
          .then(function (d) {
            toast.ok(tf("header.addProjectOkAt", { path: (d && d.workspace && d.workspace.path) || target }));
            setAddOpen(false);
            setAddPath("");
            return loadWorkspaces().then(function () {
              if (d && d.workspace && d.workspace.path) {
                setSelWs(d.workspace.path);
                lsSet(WS_STORAGE_KEY, d.workspace.path);
              }
            });
          })
          .catch(function () { /* apiPost 已 toast 错误 */ })
          .finally(function () { setAddBusy(false); });
      }
      function addProjectWs() { setAddOpen(function (v) { return !v; }); }
      // 入口行：空态引导页与主界面共用同一份渲染（原来只在「一个 novel 工作区都没有」
      // 时才渲染，用户已有书就再也找不到入口——这才是「接入项目用不了」的真因）。
      function AddProjectRow() {
        return h("div", { className: "myt-addWsRow" },
          h("input", {
            className: "myt-setInput", value: addPath, placeholder: tt("header.addProjectPrompt"),
            onChange: function (e) { setAddPath(e.target.value); },
            onKeyDown: function (e) { if (e.key === "Enter") submitAddProject(); if (e.key === "Escape") setAddOpen(false); },
          }),
          h("button", { type: "button", className: "myt-btn myt-btnPrimary", disabled: addBusy, onClick: submitAddProject },
            addBusy ? tt("header.addProjectBusy") : tt("header.addProjectDo")),
          effectiveWs ? h("button", {
            type: "button", className: "myt-btn myt-btnDanger", title: tt("header.wsRemoveTip"),
            onClick: removeCurrentWs,
          }, tt("header.wsRemove")) : null,
          h("button", { type: "button", className: "myt-btn", disabled: addBusy, onClick: function () { setAddOpen(false); } }, tt("header.addProjectCancel")));
      }
      // 移除当前工作区登记（0.23.0）：只从选择器摘掉，不动磁盘。
      // 死目录（作者删了、或接入测试留下）一直留在下拉里点进去是空面板，像坏了。
      function removeCurrentWs() {
        var root = effectiveWs;
        if (!root) return;
        if (!window.confirm(tf("header.wsRemoveConfirm", { path: root }))) return;
        apiPost("workspace-remove", { path: root }).then(function () {
          toast.ok(tt("header.wsRemoved"));
          setAddOpen(false);
          lsSet(WS_STORAGE_KEY, "");
          setSelWs("");
          return loadWorkspaces();
        }).catch(function () { /* apiPost 已 toast */ });
      }
      function chooseOpenMode(m) {
        if (!openModeIsValid(m)) return;
        if (!sbProbe() && m !== "middle") return; // 老宿主：UI 已置灰，这里双保险（用点现探，服务晚到即解锁）
        lsSet(OPEN_MODE_KEY, m);
        setOpenMode(m);
      }
      // split 形态：章节改开右侧栏文章页 tab（复导航聚焦已有 tab 并推新
      // params）；路由不成立（middle/sidebar 形态、句柄缺席、无工作区）返回
      // false，调用方回落面板内整页阅读。脏退出守卫与 gotoTab 同源（DIRTY_EXIT
      // 是模块级共享标志）：tab 里编辑中点 overlay 章节行，文章页按 file:revision
      // 换 key 重挂，草稿会不经确认就丢——路由前先确认；gotoTab 已确认过的
      // 调用走 opts 旁路防双弹；宿主干掉原生 confirm 时放行（草稿仍有自动保存
      // 与卸载急救兜底），不让守卫本身把点击链炸断。取消时返回 true（视为已处理），
      // 调用方不得回落 setReaderFile 把章开进本实例。右栏接不住（hero 页无会
      // 话在屏 openTab 抛错、句柄缺席）时回落 setReaderFile 面板内整页，绝不
      // 静默吞掉一次点击。
      function openChapterExternal(file, opts) {
        // 形态现读 localStorage，不读本实例 openMode state——overlay 关闭只是
        // display:none、React 实例常驻，state 会停在别的实例（tab/新 overlay）
        // 后来改过的旧值，路由就跟着旧形态走错了。
        if (getOpenMode() !== "split" || !openReaderTab || !effectiveWs) return false;
        if (!(opts && opts.dirtyConfirmed) && DIRTY_EXIT.dirty) {
          if (typeof window.confirm === "function" && !window.confirm(tt("common.dirtyExit"))) return true;
        }
        if (!openReaderTab(file, effectiveWs)) setReaderFile(file);
        return true;
      }
      function gotoTab(next, chapterFile) {
        // 脏退出守卫：任一编辑面（DIRTY_EXIT.dirty）有未保存草稿先确认，取消
        // 则留在原地——切 tab 会卸载组件，草稿本来会被静默丢弃。
        if (DIRTY_EXIT.dirty && !window.confirm(tt("common.dirtyExit"))) return false;
        setTab(next);
        // 切到需要额外块的 tab 时补拉（0.22.0）：首屏没带时间线/线索/设定。
        if (TAB_BLOCKS[next]) ensureBlocks(TAB_BLOCKS[next]);
        if (next === "chapters" && chapterFile && openChapterExternal(chapterFile, { dirtyConfirmed: true })) return true; // split：文章页进右侧栏（脏退出已在上方确认过）
        setReaderFile(next === "chapters" && chapterFile ? chapterFile : null);
        return true; // 返回值供「切 tab + 打开指定对象」的调用方判断是否真的切过去了
      }
      // 关系图/AI 复盘等入口：切到角色页并指定要打开的卡。脏退出被拦时不落请求，
      // 免得下次进角色页莫名弹一张卡。
      function openCharCard(name) {
        if (!name) return;
        if (gotoTab("characters")) setCharFocus(name);
      }

      var novelWorkspaces = (workspaces || []).filter(function (w) { return w.hasNovel; });
      // 命令面板候选：动作 + 前 60 章，按输入子串过滤。
      var palActions = paletteActions();
      if (paletteQuery.trim() !== "") {
        var palQ = paletteQuery.trim().toLowerCase();
        palActions = palActions.filter(function (a) { return a.label.toLowerCase().indexOf(palQ) !== -1; });
      }
      var palSel = Math.max(0, Math.min(paletteIndex, palActions.length - 1));
      var body = null;
      if (workspaces === null) {
        body = h(SkelPage); // 首拉未回：骨架，不闪引导卡
      } else if (!effectiveWs) {
        // 全无 novel 工作区：引导卡（xiaoyu-novel init + 复制）。
        body = h("div", { className: "myt-stack" },
          wsErr ? ErrorStrip({ text: tf("shell.wsListFailed", { msg: wsErr }), onRetry: loadWorkspaces }) : null,
          addOpen ? h(AddProjectRow, null) : null,
          h(GuideCard, {
            title: tt("guide.noWsTitle"),
            desc: tt("guide.noWsDesc"),
          }));
      } else if (loading && !snap) {
        body = h(SkelPage);
      } else if (stateErr) {
        body = h(ErrorStrip, { text: tf("shell.stateFailed", { msg: stateErr }), onRetry: reload });
      } else if (snap && snap.found === false) {
        body = h(GuideCard, {
          title: tt("guide.notInitTitle"),
          desc: tt("guide.notInitDesc"),
        });
      } else if (snap) {
        var tabProps = { snap: snap, reload: reload, wsPath: effectiveWs, onOpenTools: openTools };
        if (readerFile) body = h(ChapterReader, {
          file: readerFile, snap: snap, reload: reload, reloadSoft: reloadSoft, wsPath: effectiveWs, refreshSeq: reopenSeq,
          onBack: function () { setReaderFile(null); },
          onOpenChapter: function (nextFile) { setReaderFile(nextFile); }, // 下一章：换 file 即 key 重挂
        });
        else if (tab === "chapters") body = h(ChaptersTab, Object.assign({ onOpenChapter: function (f) { if (!openChapterExternal(f)) setReaderFile(f); } }, tabProps));
        else if (tab === "characters") body = h(CharactersTab, Object.assign({ focusName: charFocus, onFocusDone: function () { setCharFocus(null); } }, tabProps));
        else if (tab === "foreshadows") body = h(ForeshadowsTab, tabProps);
        else if (tab === "relations") body = h(RelationsTab, Object.assign({ gotoTab: gotoTab, onOpenChar: openCharCard }, tabProps));
        else if (tab === "timeline") body = h(TimelineTab, tabProps);
        else if (tab === "world") body = h(WorldTab, tabProps);
        else if (tab === "style") body = h(StyleTab, tabProps);
        else if (tab === "index") body = h(IndexTab, tabProps);
        else body = h(OverviewTab, Object.assign({ gotoTab: gotoTab }, tabProps));
      } else {
        // 兜底分支（3.1.3，手机黑屏真凶）：
        // 走到这里意味着 workspaces 已拿到、选中的工作区有效、不在加载中、也没有
        // 报错，但 snap 仍是 null。最常见的成因是 loadState 里
        //     setSnap(d && d.ok ? d : null)
        // ——服务端返回 200 但载荷 ok:false（或载荷形状不符），于是快照被丢弃、
        // stateErr 却没被设置。此前没有这个 else，body 就保持 null，内容区渲染成
        // 真正的空：顶栏、tab 条、按钮全在，下面一片深色，正是「进面板一片黑、
        // 电脑上正常」。现在无论快照为什么缺席，这一块都必须显示可读文字与重试。
        body = h("div", { className: "myt-stack" },
          h("div", { className: "myt-card" },
            h("div", { className: "myt-cardHead" }, h("h3", { className: "myt-cardTitle" }, "内容区没有拿到数据")),
            h("div", { className: "myt-muted", style: { overflowWrap: "anywhere" } },
              "工作区已选中，但状态快照是空的（服务端返回了非预期载荷）。点「重新拉取」再试一次；仍为空就点顶栏「自检」把现场数据发回。"),
            h("div", { className: "myt-muted", style: { fontSize: "12px", overflowWrap: "anywhere" } },
              "工作区：" + String(effectiveWs || "—")),
            h("div", { className: "myt-heroMeta", style: { marginTop: "4px" } },
              h("button", { type: "button", className: "myt-btn myt-btnPrimary", onClick: function () { reload(); } }, "重新拉取"))));
      }

      // 把「这次究竟走了哪条分支」写进模块级变量：自检上报时一并带上，
      // 下次再有黑屏，日志里直接能看出是数据侧还是渲染侧。
      SHELL_BRANCH = workspaceBranch(effectiveWs, workspaces, loading, snap, stateErr, readerFile, tab);

      return h("div", { className: "myt-shell" },
        h("header", { className: "myt-header" },
          h("div", null,
            h("h1", { className: "myt-title", "data-xiaoyu-build": BUILD_STAMP }, "小鱼创作台",
              // 构建戳：不依赖接口、不受缓存影响，直接来自这份 bundle 本身
              h("span", { className: "myt-verTag", "data-build": BUILD_STAMP, title: "当前浏览器里运行的代码版本（不是服务端版本）" }, "b" + BUILD_STAMP),
              ver && ver.current ? h("span", { className: "myt-verTag", title: tt("header.curVerTitle") }, ver.current) : null,
              // 「检测更新」与新版提示互斥：无新版（或检测失败拿不到判定）时才
              // 出描边胶囊，手动触发 fresh=1 现测（常态只在开面板时拉一次，页面
              // 开久判定陈旧），检测中禁用防连点；有新版时收起，让位给下面的
              // 新版徽章 +「一键升级」。
              !(ver && ver.updateAvailable)
                ? h("button", {
                    type: "button", className: "myt-verCheck", disabled: verChecking,
                    title: verChecking ? tt("header.checkingUpdate") : tt("header.checkUpdate"),
                    onClick: runVerCheck,
                  }, verChecking ? tt("header.checkingUpdate") : tt("header.checkUpdate"))
                : null,
              // 检测结果就地显示（0.23.0）：toast 4 秒就没了，按钮旁这一行留着，
              // 用户随时能看到「上次检测到的是什么、什么时候检的」。
              verNote ? h("span", {
                className: "myt-verNote", "data-kind": verNote.kind,
                title: verNote.text,
              }, verNote.text) : null,
              // 现场自检（3.1.3）：把面板量到的几何/样式/命中元素复制到剪贴板，
              // 同时上报服务端日志。手机上「一片黑」时，这一个按钮就能交出全部
              // 现场数据，不需要用户开控制台或猜着描述。
              h("button", {
                type: "button", className: "myt-verCheck", title: "把面板自检数据复制到剪贴板（并写入服务端日志）",
                onClick: function () {
                  var payload = collectDiag("manual");
                  sendDiag(payload);
                  var text = "";
                  try { text = JSON.stringify(payload, null, 1); } catch (e) { text = String(payload); }
                  copyText(text).then(function (ok) {
                    if (ok) toast.ok("自检数据已复制（也写入了服务端 xiaoyu-diag.log），直接粘贴给助手");
                    else toast.warn("已写入服务端日志，但剪贴板不可用");
                  }, function () { toast.warn("已写入服务端日志，剪贴板失败"); });
                },
              }, "自检"),
              ver && ver.updateAvailable
                ? [
                    // 徽章（跳发布页）+「一键升级」按钮双元素；装完（installed）
                    // 徽章收起——磁盘已是新版，别再引导去发布页——按钮变
                    // 「已安装，待重启」保持禁用，重启 DeepSeek 换新进程后才消失。
                    upState !== "installed"
                      ? h("a", { key: "b", className: "myt-verBadge", href: ver.releaseUrl || "#", target: "_blank", rel: "noreferrer", title: tf("header.upgradeTip", { cur: ver.current }) },
                          tf("header.newVersion", { ver: ver.latest }))
                      : null,
                    h("button", {
                      key: "u", type: "button", className: "myt-verUpgrade",
                      disabled: upState !== "",
                      title: upState === "installed" ? tt("header.upgradedTitle") : tt("header.upgradeTitle"),
                      onClick: runSelfUpdate,
                    },
                      upState === "installing" ? tt("header.upgrading") : upState === "installed" ? tt("header.upgraded") : tt("header.upgradeBtn")),
                  ]
                : null,
              // 系统设置齿轮：从右上角动作区移入标题行，挂在版本区之后（版本号
              // /检测更新/徽章/一键升级之后），点击开设置弹层。
              h("button", {
                type: "button", className: "myt-btn myt-btnIcon myt-verGear",
                title: tt("header.settings"), "aria-label": tt("header.settings"),
                onClick: function () { setShowSettings(true); },
              }, ic("IconSettingsOutlineRegular", 14))),
            h("p", { className: "myt-subtitle" }, tt("header.subtitle"))),
          h("div", { className: "myt-headActions" },
            // 只有一个可写工作区时不出下拉（选择无意义，窄屏还会被挤成空框）；
            // 多书才显示，窄屏独占一行（CSS）。
            workspaces && novelWorkspaces.length > 1
              ? [h("span", { className: "myt-wsLabel", key: "l" }, tt("header.workspace")),
                 h("select", { className: "myt-wsSelect", key: "s", value: effectiveWs, onChange: chooseWs, "aria-label": tt("header.wsAria") },
                   workspaces.map(function (w, i) {
                     return h("option", { key: w.path || i, value: w.path || "", disabled: !w.hasNovel },
                       (w.hasNovel ? "" : tt("header.noNovel")) + (w.name || w.path || tt("header.untitled")));
                   }))]
              : null,
            h("button", { className: "myt-btn", key: "add", type: "button", title: tt("header.addProjectTip"), onClick: addProjectWs }, tt("header.addProject")),
            h("button", { className: "myt-btn", key: "search", type: "button", title: tt("search.open"), onClick: function () { setSearchOpen(true); } }, tt("search.open")),
            h("button", { className: "myt-btn", key: "tools", type: "button", title: tt("tools.tip"), onClick: function () { openTools("trash"); } }, tt("tools.open")),
            h("button", { className: "myt-btn", key: "palette", type: "button", title: tt("palette.open"), onClick: function () { setPaletteQuery(""); setPaletteIndex(0); setPaletteOpen(true); } }, "⌘K"),
            h("button", { type: "button", className: "myt-btn myt-btnIcon", title: tt("header.refresh"), "aria-label": tt("header.refresh"), disabled: loading, onClick: reload }, ic("IconRefreshOutlineRegular", 14)),
            h("button", { type: "button", className: "myt-closeBtn", "aria-label": tt("header.closeAria"), title: tt("header.closeTitle"), onClick: onClose }, h("span", { className: "myt-closeGlyph", "aria-hidden": "true" }, "×")))),
        readerFile ? null : h("nav", { className: "myt-tabs", "aria-label": tt("tabs.aria") },
          TABS.map(function (t) {
            return h("button", {
              key: t[0], type: "button", className: "myt-tab", "data-active": tab === t[0] ? "true" : undefined,
              onClick: function () { gotoTab(t[0]); },
            }, tt(t[1]));
          })),
        h("div", { className: "myt-body" },
          // 主界面也能接入项目（0.23.0）：入口原来只在「一个 novel 工作区都没有」
          // 时渲染，一旦有书就再也找不到，用户只能以为这功能坏了。
          addOpen ? h(AddProjectRow, null) : null,
          h("div", { className: "myt-page" },
            snap && Array.isArray(snap.warnings) && snap.warnings.length ? WarningsStrip(snap.warnings) : null,
            // 错误边界包住 tab 内容：key 随 tab / 阅读页变化重挂，切分区自动清错误态。
            h(TabErrorBoundary, { key: readerFile ? "reader:" + readerFile : tab, onRetry: reload }, body))),
        toolsOpen ? h(ToolsModal, { wsPath: effectiveWs, initialTab: toolsTab, chapters: snap && snap.chapters ? snap.chapters : [], onReload: reload, onClose: function () { setToolsOpen(false); } }) : null,
        searchOpen ? h(MaskPortal, { className: "myt-modalMask", onMouseDown: function (e) { if (e.target === e.currentTarget) setSearchOpen(false); } },
          h("div", { className: "myt-modal myt-searchPanel", role: "dialog", "aria-modal": "true", "aria-label": tt("search.title") },
            h("div", { className: "myt-boardHead" },
              h("strong", null, tt("search.title")),
              h("button", { type: "button", className: "myt-btn myt-btnIcon", "aria-label": tt("search.close"), onClick: function () { setSearchOpen(false); } }, "×")),
            h("div", { className: "myt-searchRow" },
              h("input", {
                className: "myt-setInput myt-searchInput", autoFocus: true, value: searchQuery, placeholder: tt("search.placeholder"), spellCheck: false,
                onChange: function (e) { setSearchQuery(e.target.value); },
                onKeyDown: function (e) { if (e.key === "Enter") runSearch(searchQuery); if (e.key === "Escape") setSearchOpen(false); },
              }),
              h("button", { type: "button", className: "myt-btn myt-btnPrimary", disabled: searchBusy, onClick: function () { runSearch(searchQuery); } }, searchBusy ? tt("common.loading") : tt("search.open"))),
            h("div", { className: "myt-searchRow" },
              h("input", {
                className: "myt-setInput", value: replaceText, placeholder: tt("search.replace"), spellCheck: false,
                onChange: function (e) { setReplaceText(e.target.value); },
              }),
              h("button", { type: "button", className: "myt-btn myt-btnDanger", disabled: !searchRes || !searchRes.matches || searchRes.matches.length === 0, onClick: runReplace }, tt("search.replaceBtn"))),
            h("div", { className: "myt-searchHint myt-muted" }, tt("search.hint")),
            h("div", { className: "myt-searchList" },
              searchBusy ? h("div", { className: "myt-muted" }, tt("common.loading"))
                : !searchRes ? null
                  : searchRes.matches && searchRes.matches.length
                    ? [
                        h("div", { key: "count", className: "myt-muted" }, tf("search.count", { n: searchRes.matches.length }) + (searchRes.truncated ? " +" : "")),
                        searchRes.matches.map(function (m, i) {
                          return h("button", { key: i, type: "button", className: "myt-searchHit", onClick: function () { openHit(m); } },
                            h("span", { className: "myt-searchKind" }, m.kind === "outline" ? tt("search.outline") : tt("search.chapter")),
                            h("span", { className: "myt-searchHitText" }, m.file + " · " + m.line + "　" + m.text));
                        }),
                      ]
                    : h("div", { className: "myt-muted" }, tt("search.empty"))))) : null,
        paletteOpen ? h(MaskPortal, { className: "myt-modalMask", onMouseDown: function (e) { if (e.target === e.currentTarget) setPaletteOpen(false); } },
          h("div", { className: "myt-modal myt-palette", role: "dialog", "aria-modal": "true", "aria-label": tt("palette.open") },
            h("input", {
              className: "myt-setInput myt-paletteInput", autoFocus: true, value: paletteQuery, placeholder: tt("palette.placeholder"), spellCheck: false,
              onChange: function (e) { setPaletteQuery(e.target.value); setPaletteIndex(0); },
              onKeyDown: function (e) {
                if (e.key === "ArrowDown") { e.preventDefault(); setPaletteIndex(function (i) { return Math.min(palActions.length - 1, i + 1); }); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setPaletteIndex(function (i) { return Math.max(0, i - 1); }); }
                else if (e.key === "Enter") { e.preventDefault(); var act = palActions[palSel]; if (act) { setPaletteOpen(false); act.run(); } }
                else if (e.key === "Escape") { setPaletteOpen(false); }
              },
            }),
            h("div", { className: "myt-paletteList" },
              palActions.length === 0 ? h("div", { className: "myt-muted" }, tt("palette.empty"))
                : palActions.slice(0, 40).map(function (a, i) {
                    return h("button", {
                      key: i, type: "button", className: "myt-paletteRow", "data-active": i === palSel ? "true" : undefined,
                      onMouseEnter: function () { setPaletteIndex(i); },
                      onClick: function () { setPaletteOpen(false); a.run(); },
                    }, a.label);
                  })),
            h("div", { className: "myt-muted myt-paletteHint" }, tt("palette.hint")))) : null,
        showSettings ? h(SettingsModal, {
          // 字号/语言/形态显示值全部现读 localStorage：常驻实例的 state 可能
          // 被别的实例改过（同 openMode 陈旧 state 一类），弹层开着即取真值；
          // onPick 落 localStorage + setState 双路刷新。
          scale: (function () { var stored = lsGet(FONT_SCALE_KEY); return FONT_SCALES.some(function (o) { return o[0] === stored; }) ? stored : fontScale; })(),
          onPick: setFontScale,
          lang: (function () { var stored = lsGet(LANG_KEY) || "zh"; return UI_LANGS.some(function (o) { return o[0] === stored; }) ? stored : lang; })(),
          onPickLang: setLang,
          mode: showSettings ? getOpenMode() : openMode,
          onPickMode: chooseOpenMode,
          sbProbe: sbProbe,
          onClose: function () { setShowSettings(false); },
        }) : null,
        h(ToastHostOwned));
    }

    // warnings 黄条（坏文件清单，spec §3：面板顶部显示）。
    function WarningsStrip(warnings) {
      return h("div", { className: "myt-strip myt-stripWarn" },
        h("span", { className: "myt-stripIcon" }, ic("IconWarningOutlineRegular", 14)),
        h("span", { className: "myt-stripText" },
          h("div", null, h("strong", null, tt("warnings.title"))),
          warnings.map(function (w, i) { return h("div", { key: i }, "· " + String(w)); })));
    }

    // 静态体检黄条：checkProject 的原始问题清单（快照侧会把越枚举 status
    // 归一成 pending，人工改坏在快照里看不出来，这里照 CLI check 同源透出）。
    // 含 error 级问题时叠加强调 class（纯 CSS，见 base.css）。
    // 清账本（0.16.0）：账本类 warn 一键清——超长条目压成结论、明细外置到
    // archive/ledger-details/、超期伏笔升 progressing；服务端先备份，可撤销。
    var LEDGER_FILE_NAMES = ["memories.yml", "timeline.yml", "clue-board.yml", "relations.yml", "foreshadows.yml"];
    function isLedgerProblem(p) {
      return p && LEDGER_FILE_NAMES.indexOf(String(p.file || "")) !== -1;
    }
    function CheckStrip(props) {
      var problems = props.problems || [];
      var errs = 0;
      for (var i = 0; i < problems.length; i++) { if (problems[i] && problems[i].level === "error") errs++; }
      var hasLedger = false;
      for (var j = 0; j < problems.length; j++) { if (isLedgerProblem(problems[j])) { hasLedger = true; break; } }
      var _b = useState(false), busy = _b[0], setBusy = _b[1];
      function cleanLedgers() {
        if (busy || !props.wsPath) return;
        // 有未保存草稿时不动盘：清账本会重写五本账，编辑面里的草稿一保存
        // 就把新内容盖回去，等于白清（还会丢明细指路）。
        if (DIRTY_EXIT.dirty) { toast.warn(tt("check.cleanDirty")); return; }
        setBusy(true);
        apiPost("ledger-clean", { path: props.wsPath }).then(function () {
          if (props.onDone) props.onDone();
        }).catch(function () { /* 错误 toast 已由 apiPost 统一提示 */ }).finally(function () { setBusy(false); });
      }
      return h("div", { className: "myt-strip myt-stripWarn" + (errs > 0 ? " myt-stripCheckErr" : "") },
        h("span", { className: "myt-stripIcon" }, ic("IconWarningOutlineRegular", 14)),
        h("span", { className: "myt-stripText" },
          h("div", { className: "myt-stripHead" },
            h("strong", null, tf("check.title", { n: fmtNum(problems.length), err: fmtNum(errs), warn: fmtNum(problems.length - errs) })),
            hasLedger ? h("button", {
              type: "button",
              className: "myt-btn myt-btnSm myt-stripAction",
              disabled: busy,
              title: tt("check.cleanTip"),
              onClick: cleanLedgers,
            }, busy ? tt("check.cleaning") : tt("check.clean")) : null),
          problems.slice(0, 8).map(function (p, i) {
            return h("div", { key: i }, "· [" + String((p && p.level) || "") + "] " + String((p && p.file) || "") + ": " + String((p && p.message) || ""));
          }),
          h("div", null, tt("check.fullHint"))));
    }

    // ── 概览 tab：project 卡（含「编辑」书稿元信息，原小说设置并入）+ 统计卡
    // + 最近更新 ─────────────────────────────────────────────────────────────
    function OverviewTab(props) {
      var snap = props.snap;
      var reload = props.reload;
      var gotoTab = props.gotoTab;
      var wsPath = props.wsPath;
      var project = snap.project || {};
      // 编辑态：true 时 hero 卡切换为书稿元信息表单（ProjectMetaForm）。
      var _ed = useState(false), editing = _ed[0], setEditing = _ed[1];
      // 分卷规划账源文件直达（0.1.20 写面）：volumes.yml 整文件可编辑。
      var _src = useState(null), srcRel = _src[0], setSrcRel = _src[1];
      var totals = snap.totals || {};
      var byStatus = totals.byStatus || {};
      var _b = useState(false), phaseBusy = _b[0], setPhaseBusy = _b[1];
      var phaseIdx = PHASES.indexOf(project.phase);
      var nextPhase = phaseIdx !== -1 && phaseIdx < PHASES.length - 1 ? PHASES[phaseIdx + 1] : null;
      // 共创模式徽章：快照 mode 缺失（老项目无该键）或越枚举时不显示。
      var modeEntry = null;
      for (var mi = 0; mi < MODES.length; mi++) { if (MODES[mi][0] === project.mode) { modeEntry = MODES[mi]; break; } }
      // 静态体检黄条：仅 found 时拉 check 路由（未初始化没有可查的东西）。
      // 工作区切换与每次 reload 都换新 snap → effect 重跑即重查；请求序号防
      // 过期响应（快速切工作区时在途旧响应不得落进新工作区的黄条）。
      var _ck = useState(null), checkProblems = _ck[0], setCheckProblems = _ck[1];
      // 写作进度（0.4.0）：今日总字数与上一次记录日的差值（服务端按天记账）。
      var _pr = useState(null), progress = _pr[0], setProgress = _pr[1];
      // 开书九件套（0.4.1）：缺项直接指到对应 tab，写作前必须全绿。
      var _su = useState(null), setup = _su[0], setSetup = _su[1];
      var _aq = useState(null), auditQ = _aq[0], setAuditQ = _aq[1]; // 章末平收返修队列
      useEffect(function () {
        if (!snap || !snap.found || !wsPath) return undefined;
        var alive = true;
        apiGet("setup", { path: wsPath }, { silent: true }).then(function (d) {
          if (alive && d && d.ok) setSetup(d);
        }).catch(function () { /* 拉不到不显示清单 */ });
        return function () { alive = false; };
      }, [snap, wsPath]);
      useEffect(function () {
        if (!snap || !snap.found || !wsPath) return undefined;
        var alive = true;
        apiGet("audit", { path: wsPath }, { silent: true }).then(function (d) {
          if (alive && d && d.ok) setAuditQ(d);
        }).catch(function () { /* 体检拉不到就不出队列卡 */ });
        return function () { alive = false; };
      }, [snap, wsPath]);
      useEffect(function () {
        if (!snap || !snap.found || !wsPath) return undefined;
        var alive = true;
        apiGet("progress", { path: wsPath }, { silent: true }).then(function (d) {
          if (alive && d && d.ok) setProgress(d);
        }).catch(function () { /* 进度拉不到不显示 */ });
        return function () { alive = false; };
      }, [snap, wsPath]);
      // 账本体检（0.15.0）：体积/条数/超长条目——每章都要整本读，胖了直接拖
      // 慢写作。拉不到就不出卡（体检失败不该影响概览）。
      var _ls = useState(null), ledgerData = _ls[0], setLedgerData = _ls[1];
      useEffect(function () {
        if (!snap || !snap.found || !wsPath) { setLedgerData(null); return undefined; }
        var alive = true;
        apiGet("ledger-stats", { path: wsPath }, { silent: true }).then(function (d) {
          if (alive && d && d.ok) setLedgerData(d);
        }).catch(function () { /* 体检拉不到不出卡 */ });
        return function () { alive = false; };
      }, [snap, wsPath]);
      var checkSeqRef = useRef(0);
      useEffect(function () {
        if (!snap || !snap.found || !wsPath) { setCheckProblems(null); return; }
        var seq = ++checkSeqRef.current; // 先自增再发请求；早退分支也作废在途旧响应
        apiGet("check", { path: wsPath }).then(function (d) {
          if (seq !== checkSeqRef.current) return; // 过期响应：已有更新的请求在途，丢弃
          setCheckProblems(d && d.ok && Array.isArray(d.problems) ? d.problems : []);
        }).catch(function () {
          if (seq !== checkSeqRef.current) return;
          setCheckProblems(null); // 拉取失败不显示黄条（toast 已由 apiGet 统一提示）
        });
      }, [snap, wsPath]);
      function advancePhase() {
        if (!nextPhase || phaseBusy) return;
        setPhaseBusy(true);
        apiPost("phase", { path: props.wsPath, phase: nextPhase }).then(reload).catch(function () {}).finally(function () { setPhaseBusy(false); });
      }
      var recent = (snap.chapters || []).slice().sort(function (a, b) { return (b.num || 0) - (a.num || 0); }).slice(0, 5);
      var volumes = snap.volumes || [];
      return h("div", { className: "myt-stack" },
        checkProblems && checkProblems.length ? h(CheckStrip, { problems: checkProblems, wsPath: props.wsPath, onDone: reload }) : null,
        h(VersionCard, { wsPath: props.wsPath, reload: reload }),
        (function () {
          var plain = auditQ && auditQ.hooks && Array.isArray(auditQ.hooks.plain) ? auditQ.hooks.plain : [];
          if (plain.length === 0) return null;
          return h("div", { className: "myt-card" },
            h("div", { className: "myt-cardHead" },
              h("h3", { className: "myt-cardTitle" }, tt("hookQueue.title")),
              h("span", { className: "myt-warnText" }, tf("hookQueue.count", { n: plain.length }))),
            h("div", { className: "myt-muted" }, tt("hookQueue.hint")),
            h("div", { className: "myt-unlinked" }, plain.map(function (file) {
              return h("button", {
                key: file, type: "button", className: "myt-unlinkedTag myt-hookChip",
                title: tt("hookQueue.openTip"),
                onClick: function () { if (typeof gotoTab === "function") gotoTab("chapters", file); },
              }, String(file).replace(/\.md$/i, ""));
            })));
        })(),
        editing
          // 编辑态：hero 卡整体换成元信息表单（保存/取消在表单卡内）。
          ? h(ProjectMetaForm, { snap: snap, wsPath: wsPath, reload: reload, onDone: function () { setEditing(false); } })
          : h("div", { className: "myt-card myt-hero" },
              [
                h("div", { className: "myt-heroMeta", key: "meta" },
                  project.author ? h("span", { className: "myt-muted" }, tf("overview.author", { name: project.author })) : null,
                  project.genre ? h("span", { className: "myt-badge" }, project.genre) : null,
                  project.length ? h("span", { className: "myt-badge" }, project.length) : null,
                  project.language ? h("span", { className: "myt-badge" }, project.language) : null,
                  h("button", { type: "button", className: "myt-btn myt-heroEdit", title: tt("overview.editTip"), "aria-label": tt("overview.editTip"), onClick: function () { setEditing(true); } },
                    ic("IconEditOutlineRegular", 13), tt("overview.edit"))),
                h("h2", { className: "myt-heroTitle", key: "title" }, orDash(project.title)),
                h("div", { className: "myt-heroMeta", key: "phase" },
                  phasePill(project.phase),
                  modeEntry ? [
                    h("span", { className: "myt-muted", key: "modeLabel" }, tt("novel.fMode")),
                    h("span", { className: "myt-badge", key: "modeBadge", title: tt("mode." + modeEntry[1]) }, tt("modeShort." + modeEntry[1])),
                  ] : null,
                  nextPhase ? h("button", { type: "button", className: "myt-btn", disabled: phaseBusy, onClick: advancePhase, title: tf("phase.advanceTitle", { next: tt("phase." + nextPhase) }) }, phaseBusy ? tt("phase.advancing") : tt("phase.advance")) : h("span", { className: "myt-muted" }, project.phase ? tt("phase.final") : null)),
                project.description
                  ? h("div", { className: "myt-scrollBox", key: "desc" }, h("p", { className: "myt-heroDesc" }, project.description))
                  : null,
              ]),
        h("div", { className: "myt-statRow" },
          h("div", { className: "myt-card myt-stat" }, h("span", { className: "myt-statNum" }, fmtNum(totals.words)), h("span", { className: "myt-statLabel" }, tt("overview.totalWords"))),
          h("div", { className: "myt-card myt-stat" }, h("span", { className: "myt-statNum" }, fmtNum(totals.chapters)), h("span", { className: "myt-statLabel" }, tt("overview.totalChapters"))),
          h("div", { className: "myt-card myt-stat" },
            h("span", { className: "myt-statNum" }, fmtNum((snap.characters || []).length)),
            h("span", { className: "myt-statLabel" }, tt("overview.characters"))),
          h("div", { className: "myt-card myt-stat" },
            h("span", { className: "myt-statNum" }, fmtNum((snap.foreshadows || []).filter(function (f) { return f.status === "planted" || f.status === "progressing"; }).length)),
            h("span", { className: "myt-statLabel" }, tt("overview.openForeshadows"))),
          h("div", { className: "myt-card myt-stat" },
            h("span", { className: "myt-statNum" }, progress && progress.delta !== null && progress.delta !== undefined
              ? (progress.delta > 0 ? "+" : "") + fmtNum(progress.delta)
              : "—"),
            h("span", { className: "myt-statLabel" }, tt("overview.todayDelta")))),
        progress ? h("div", { className: "myt-card myt-writeStats" },
          h("div", { className: "myt-cardHead" },
            h("h3", { className: "myt-cardTitle" }, tt("overview.writeStats")),
            h("span", { className: "myt-muted" }, tf("overview.today", { n: fmtNum(progress.today || 0) }))),
          (function () {
            var days = (progress.days || []).slice(-7);
            if (days.length === 0) return h("div", { className: "myt-muted" }, tt("overview.noProgress"));
            var max = 1;
            days.forEach(function (d) { if (d.words > max) max = d.words; });
            return [
              h("div", { key: "bars", className: "myt-writeSpark" }, days.map(function (d, i) {
                return h("div", { key: d.date || i, className: "myt-writeSparkBar", title: d.date + " · " + fmtNum(d.words) },
                  h("div", { className: "myt-writeSparkFill", style: { height: Math.max(4, Math.round(d.words / max * 100)) + "%" } }));
              })),
              h("div", { key: "meta", className: "myt-muted" },
                progress.delta !== null && progress.delta !== undefined
                  ? tf("overview.delta", { n: (progress.delta > 0 ? "+" : "") + fmtNum(progress.delta) })
                  : tt("overview.streak")),
            ];
          })()) : null,
        ledgerData && (ledgerData.heavyAny || ledgerData.longAny) ? h("div", { className: "myt-card myt-ledgerCard" },
          h("div", { className: "myt-cardHead" },
            h("h3", { className: "myt-cardTitle" }, tt("overview.ledgers")),
            h("span", { className: "myt-muted" }, tf("overview.ledgerTotal", { kb: Math.round(ledgerData.totalBytes / 1024) })),
            typeof props.onOpenTools === "function"
              ? h("button", { type: "button", className: "myt-btn", onClick: function () { props.onOpenTools("slim"); } }, tt("overview.ledgerSlim"))
              : null),
          h("div", { className: "myt-ledgerRows" }, (ledgerData.items || []).map(function (it) {
            return h("div", { key: it.file, className: "myt-ledgerRow", "data-heavy": it.heavy ? "true" : undefined },
              h("span", { className: "myt-ledgerName" }, it.file),
              h("span", { className: "myt-muted" }, tf("overview.ledgerMeta", { kb: Math.round(it.bytes / 1024), n: it.entries })),
              it.longEntries ? h("span", { className: "myt-badge" }, tf("overview.ledgerLong", { n: it.longEntries })) : null,
              it.top && it.top.length
                ? h("span", { className: "myt-ledgerTop", title: it.top[0].preview }, (it.top[0].ref ? it.top[0].ref + " · " : "") + it.top[0].len + " 字")
                : null);
          }))) : null,
        setup ? h("div", { className: "myt-card myt-setupCard" },
          h("div", { className: "myt-cardHead" },
            h("h3", { className: "myt-cardTitle" }, tt("setup.title")),
            h("span", { className: "myt-boardCount" }, setup.done + "/" + setup.total)),
          h("div", { className: "myt-setupGrid" }, (setup.items || []).map(function (it) {
            return h("button", {
              key: it.key, type: "button", className: "myt-setupItem",
              "data-done": it.done ? "true" : "false",
              title: it.detail + (it.done ? "" : " —— " + it.hint),
              onClick: function () { if (typeof gotoTab === "function") gotoTab(it.tab); },
            },
              h("span", { className: "myt-setupMark", "aria-hidden": "true" }, it.done ? "✓" : "✗"),
              h("span", { className: "myt-setupName" }, it.label),
              h("span", { className: "myt-setupDetail" }, it.detail));
          }))) : null,
        h("div", { className: "myt-card" },
          h("div", { className: "myt-cardHead" }, h("h3", { className: "myt-cardTitle" }, tt("overview.statusDist"))),
          h("div", { className: "myt-distBar", "aria-hidden": "true" }, STATUS_FLOW.map(function (s) {
            var n = byStatus[s] || 0;
            return n > 0 ? h("div", { key: s, className: "myt-distSeg", "data-status": s, style: { flexGrow: n } }) : null;
          })),
          h("div", { className: "myt-heroMeta" }, STATUS_FLOW.map(function (s) {
            return h("span", { key: s, className: "myt-muted" }, tt("status." + s) + " " + (byStatus[s] || 0));
          }))),
        // 分卷规划（0.4.11）：三卷各几百字的卷纲平铺出来比正文还长（用户实拍
        // 「滑半天」）。改成与正文/章纲同一范式的折叠块：头一行可收，展开时
        // 框内自己滚；「编辑源文件」留在头部右侧动作位。
        volumes.length ? h(CollapseBox, {
          key: "volumes",
          title: tt("overview.volumes"),
          meta: volumes.length,
          extra: srcEditBtn("volumes.yml", function () { setSrcRel("volumes.yml"); }),
        },
          h("div", { className: "myt-stack" }, volumes.map(function (v, i) {
            return h("div", { key: v.id || i, className: "myt-worldGroup" },
              h("div", { className: "myt-listHead" },
                h("span", { className: "myt-worldName" }, (v.id ? v.id + " · " : "") + orDash(v.title)),
                v.chapters ? h("span", { className: "myt-tag" }, v.chapters) : null),
              v.summary ? h("div", { className: "myt-worldDesc" }, v.summary) : null);
          }))) : null,
        h("div", { className: "myt-card" },
          h("div", { className: "myt-cardHead" }, h("h3", { className: "myt-cardTitle" }, tt("overview.recent"))),
          recent.length
            ? h("div", { className: "myt-recentList" }, recent.map(function (ch) {
                return h("button", { key: ch.file, type: "button", className: "myt-recentRow", onClick: function () { gotoTab("chapters", ch.file); } },
                  statusBadge(ch.status, project.mode),
                  h("span", { className: "myt-chTitle" }, orDash(ch.title)),
                  h("span", { className: "myt-chPath" }, chWhere(ch)),
                  h("span", { className: "myt-wordsCell" }, tf("common.charCount", { n: fmtNum(ch.words) })));
              }))
             : h(Empty, { text: tt("chapters.empty") })),
        srcRel ? h(SourceEditorModal, { title: tt("src.editSource"), rel: srcRel, wsPath: wsPath, onClose: function () { setSrcRel(null); }, onSaved: reload }) : null);
    }

    // ── 轻量 Markdown 渲染（零依赖）：先整体 HTML 转义再施加 md 变换，杜绝
    // 注入；支持标题/加粗/斜体/删除线/行内码/围栏码/引用/有序无序列表/分隔线/
    // 链接/GFM 管道表格/段落换行。供章纲、世界观条目等 md 阅读位使用，正文
    // 手稿仍走 pre。 ──
    function escapeHtml(s) {
      // 单引号也转义：属性当前虽全双引号，零成本防御纵深。
      return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    // 链接 scheme 白名单：仅放行 http/https 绝对地址与无 scheme 的相对路径 /
    // 锚点 / //协议相对；javascript:/data:/vbscript: 等一律拒绝（调用方落纯文本）。
    function isSafeLinkUrl(url) {
      var m = String(url || "").match(/^([a-zA-Z][a-zA-Z0-9+.\-]*):/);
      return !m || /^https?$/i.test(m[1]);
    }
    function inlineMd(s) {
      // 行内码占位保护：先抽出 `code` 区间换成哨兵占位符，加粗/斜体/删除线/
      // 链接不再命中码内文本（否则 `*x*` 会被二次加格式），最后回填。
      // 哨兵用 NUL 控制符 + 固定前缀：正文已过 escapeHtml，不可能出现该序列。
      var codes = [];
      var out = String(s).replace(/`([^`]+)`/g, function (_m, code) {
        codes.push("<code>" + code + "</code>");
        return "\u0000MYTCODE" + (codes.length - 1) + "\u0000";
      })
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/__([^_]+)__/g, "<strong>$1</strong>")
        .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
        .replace(/~~([^~]+)~~/g, "<del>$1</del>")
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_m, txt, url) {
          if (!isSafeLinkUrl(url)) return _m; // 白名单外：原样落纯文本，不生成 href
          return '<a href="' + url + '" target="_blank" rel="noreferrer">' + txt + "</a>";
        });
      return out.replace(/\u0000MYTCODE(\d+)\u0000/g, function (_m, i) { return codes[Number(i)] || ""; });
    }
    // ── GFM 管道表格辅助：输入行均已过 escapeHtml（反斜杠原样保留），只做
    // 结构识别与切格，单元格文本最终仍走 inlineMd，不自建未转义通道。 ──
    // 分隔行解析：仅由 |、:、-、空白组成，去掉首尾 | 后按 | 切出 ≥1 段、每段
    // :?-{1,}:?（--- / :--- / ---: / :---:）；是分隔行则返回各列对齐标记
    // （'l'|'c'|'r'|''，与表头单元格一一对应），否则 null。
    function tableSepAligns(line) {
      if (!/^[\s:|-]+$/.test(line) || line.indexOf("-") === -1) return null;
      var trimmed = String(line).trim();
      if (trimmed.charAt(0) === "|") trimmed = trimmed.slice(1);
      if (trimmed.charAt(trimmed.length - 1) === "|") trimmed = trimmed.slice(0, -1);
      var segs = trimmed.split("|");
      var aligns = [];
      for (var k = 0; k < segs.length; k++) {
        var seg = segs[k].trim();
        if (!/^:?-{1,}:?$/.test(seg)) return null;
        aligns.push(seg.charAt(0) === ":" && seg.charAt(seg.length - 1) === ":" ? "c"
          : seg.charAt(seg.length - 1) === ":" ? "r"
          : seg.charAt(0) === ":" ? "l" : "");
      }
      return aligns;
    }
    // 表格行切格：转义管道 \| 先换哨兵（NUL 前缀序列，正文不可能出现）再按 |
    // 切，逐格 trim 后回填为字面 |；首尾空单元（外圈竖线）丢弃。
    function splitTableCells(line) {
      var raw = String(line).replace(/\\\|/g, "\u0000MYTPIPE").split("|");
      var cells = [];
      for (var k = 0; k < raw.length; k++) cells.push(raw[k].trim().replace(/\u0000MYTPIPE/g, "|"));
      while (cells.length && cells[0] === "") cells.shift();
      while (cells.length && cells[cells.length - 1] === "") cells.pop();
      return cells;
    }
    // 表格起始：当前行含 |、下一行是分隔行，且表头至少一个非空单元格。
    function isTableStart(lines, i) {
      if (i + 1 >= lines.length || lines[i].indexOf("|") === -1) return false;
      var aligns = tableSepAligns(lines[i + 1]);
      if (!aligns) return false;
      var head = splitTableCells(lines[i]);
      // GFM 规范：表头列数须与分隔行列数相等才认表——否则「含 | 的段落行 +
      // --- 分隔线」会被误吞成表头（数据行列数宽容是另一回事，见 renderMd）。
      if (head.length !== aligns.length || head.length === 0) return false;
      for (var k = 0; k < head.length; k++) { if (head[k] !== "") return true; }
      return false;
    }
    // 对齐落 class（th/td 共用，不用 inline style，深浅色主题只吃令牌）。
    function tableAlignCls(a) {
      if (a === "l") return ' class="myt-ta-l"';
      if (a === "c") return ' class="myt-ta-c"';
      if (a === "r") return ' class="myt-ta-r"';
      return "";
    }
    function renderMd(src) {
      var lines = escapeHtml(src).split(/\r?\n/);
      var html = [];
      var i = 0;
      while (i < lines.length) {
        var line = lines[i];
        if (/^```/.test(line)) {
          var code = [];
          i++;
          while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; }
          i++; // 吃掉收尾 ```（缺失也吞到尾）
          html.push('<pre class="myt-mdCode"><code>' + code.join("\n") + "</code></pre>");
          continue;
        }
        if (/^\s*$/.test(line)) { i++; continue; }
        var h2 = line.match(/^(#{1,6})\s+(.*)$/);
        if (h2) {
          var lv = h2[1].length;
          html.push('<h' + lv + ' class="myt-mdH">' + inlineMd(h2[2]) + "</h" + lv + ">");
          i++; continue;
        }
        if (/^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { html.push('<hr class="myt-mdHr">'); i++; continue; }
        if (/^\s*&gt;\s?/.test(line)) {
          var quote = [];
          while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) { quote.push(inlineMd(lines[i].replace(/^\s*&gt;\s?/, ""))); i++; }
          html.push('<blockquote class="myt-mdQuote">' + quote.join("<br>") + "</blockquote>");
          continue;
        }
        var ul = line.match(/^\s*[-*+]\s+(.*)$/);
        if (ul) {
          var items = [];
          while (i < lines.length) {
            var m1 = lines[i].match(/^\s*[-*+]\s+(.*)$/);
            if (!m1) break;
            items.push("<li>" + inlineMd(m1[1]) + "</li>");
            i++;
          }
          html.push('<ul class="myt-mdList">' + items.join("") + "</ul>");
          continue;
        }
        var ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
        if (ol) {
          var oitems = [];
          while (i < lines.length) {
            var m2 = lines[i].match(/^\s*\d+[.)]\s+(.*)$/);
            if (!m2) break;
            oitems.push("<li>" + inlineMd(m2[1]) + "</li>");
            i++;
          }
          html.push('<ol class="myt-mdList">' + oitems.join("") + "</ol>");
          continue;
        }
        // GFM 管道表格：表头行 + |---|---| 分隔行 + 数据行。数据行逐行吃到
        // 空行 / 不含 | 的行 / 其它块起始（围栏/标题/引用/列表/hr）为止；列数
        // 不齐宽容渲染（缺列补空 td、多列照渲染，对齐按列号取、越界无 class）。
        if (isTableStart(lines, i)) {
          var aligns = tableSepAligns(lines[i + 1]);
          var headCells = splitTableCells(lines[i]);
          i += 2; // 吃掉表头行与分隔行
          var bodyCells = [];
          while (i < lines.length && lines[i].indexOf("|") !== -1 && !/^\s*$/.test(lines[i]) && !/^```|^#{1,6}\s|^\s*&gt;|^\s*[-*+]\s|^\s*\d+[.)]\s|^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])) {
            bodyCells.push(splitTableCells(lines[i]));
            i++;
          }
          var ths = [];
          for (var t = 0; t < headCells.length; t++) ths.push("<th" + tableAlignCls(aligns[t]) + ">" + inlineMd(headCells[t]) + "</th>");
          var trs = [];
          for (t = 0; t < bodyCells.length; t++) {
            var tds = [];
            for (var d = 0; d < Math.max(headCells.length, bodyCells[t].length); d++) {
              tds.push("<td" + tableAlignCls(aligns[d]) + ">" + inlineMd(bodyCells[t][d] || "") + "</td>");
            }
            trs.push("<tr>" + tds.join("") + "</tr>");
          }
          // 宽表由 .myt-mdTableWrap 横向滚动；th/td 对齐全走 myt-ta-* class。
          html.push('<div class="myt-mdTableWrap"><table class="myt-mdTable"><thead><tr>' + ths.join("") + "</tr></thead><tbody>" + trs.join("") + "</tbody></table></div>");
          continue;
        }
        var para = [line];
        i++;
        // 段落兜底遇到表格起始（|a|b| + |---|---|）也要截断：段落后紧跟表格时
        // 表格独立成块，不把管道行并进段落（GitHub 行为）。
        while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^```|^\s*&gt;|^\s*[-*+]\s|^\s*\d+[.)]\s|^#{1,6}\s/.test(lines[i]) && !isTableStart(lines, i)) {
          para.push(lines[i]); i++;
        }
        html.push('<p class="myt-mdP">' + inlineMd(para.join("<br>")) + "</p>");
      }
      // 块间直接相连不补 "\n"：落点容器（.myt-outlineBody / .myt-worldDesc）是
      // white-space:pre-wrap，块间再塞换行会渲染成额外空行 → 双倍间距；
      // 块间距已由 .myt-md* 各自 margin 承担。
      return html.join("");
    }
    function MdView(props) {
      return h("div", {
        className: "myt-md" + (props.className ? " " + props.className : ""),
        dangerouslySetInnerHTML: { __html: renderMd(props.text || "") },
      });
    }

    // ── 系统设置：字号五档（面板整体 zoom，抽屉/弹层 portal 节点同缩放）──────
    var FONT_SCALE_KEY = "xiaoyu.fontScale";
    var FONT_SCALES = [["1", "100%"], ["1.1", "110%"], ["1.2", "120%"], ["1.3", "130%"], ["1.4", "140%"], ["1.5", "150%"]];
    // ── 界面语言（系统设置可选中文/English）：UI_LANG 为模块级当前语言，
    // PageShell 在 lang state 变化时改写它并整树重渲。tt/tf 是唯一取词口：
    // zh 词典的值必须与历史硬编码文案逐字一致（中文界面零回归），en 词典
    // 不留中文；词典缺键回落 key 本身（便于渐进迁移，一眼看出漏网串）。 ──
    var LANG_KEY = "xiaoyu.lang";
    var UI_LANGS = [["zh", "中文"], ["en", "English"]];
    var UI_LANG = "zh";
    var I18N = {
      zh: {
        "shell.title": "小鱼创作台", "header.subtitle": "网文项目可视化与状态流转 · 正文/章纲可编辑保存",
        "header.curVerTitle": "当前版本", "header.upgradeTip": "当前 {cur}，点击打开新版发布页", "header.newVersion": "有新版 {ver} ↗",
        "header.upgradeBtn": "一键升级", "header.upgrading": "安装中…", "header.upgraded": "已安装，待重启",
        "header.upgradeTitle": "用 pnpm 安装 npm 最新版（最长约 3 分钟），装完需重启 DeepSeek 生效",
        "header.upgradedTitle": "已安装新版，重启 DeepSeek 后生效",
        "header.checkUpdate": "检测更新", "header.checkingUpdate": "检测中…",
        "toast.selfUpdate.ok": "已安装 {ver}，重启 DeepSeek 后生效",
        "toast.selfUpdate.upToDate": "已是最新版（{ver}）",
        "toast.selfUpdate.globalOk": "全局 xiaoyu CLI {from} → {to}", "toast.selfUpdate.globalFail": "全局 CLI 更新失败：{error}",
        "toast.selfUpdate.devLink": "开发目录安装，请 git pull 更新", "toast.selfUpdate.pnpmMissing": "未找到 pnpm，请手动安装",
        "toast.selfUpdate.found": "发现新版 {ver}", "toast.selfUpdate.checkFail": "检测失败：{msg}",
        "header.workspace": "工作区", "header.wsAria": "选择工作区", "header.noNovel": "（无 novel）", "header.untitled": "未命名",
        "header.settings": "系统设置", "header.refresh": "重新拉取", "header.closeAria": "关闭创作台", "header.closeTitle": "关闭",
        "tabs.aria": "创作台分区",
        "tabs.overview": "概览", "tabs.chapters": "章节", "tabs.characters": "角色", "tabs.foreshadows": "伏笔", "tabs.relations": "关系图",
        "tabs.timeline": "时间线", "tabs.world": "设定", "tabs.style": "写作风格", "tabs.index": "索引板",
        "style.registerTip": "把《{name}》档位的语言节写入 style.md", "style.registerOk": "已套用《{name}》档位", "style.note": "写手 / 大纲师 / 审校以此为准；改完即生效",
        "style.editTip": "编辑写作风格基准（novel/style.md）",
        "style.empty": "novel/style.md 还没有创建。写手/大纲师/审校读取风格基准时将拿不到本文；可先用插件内置的通用网文默认基线创建，再按本书题材修改。",
        "style.createFromTpl": "用默认基线创建",
        "style.loadFailed": "写作风格读取失败：{msg}",
        "shell.wsListFailed": "工作区列表拉取失败：{msg}", "shell.stateFailed": "快照拉取失败：{msg}",
        "guide.noWsTitle": "还没有可用的小说工作区", "guide.noWsDesc": "任一工作区根目录下出现 novel/project.yml 即自动入选；先用命令初始化目录骨架：",
        "guide.notInitTitle": "该工作区尚未初始化小说项目", "guide.notInitDesc": "工作区根目录下没有 novel/project.yml。在该工作区根目录执行：",
        "guide.defaultTitle": "该工作区还没有小说项目", "guide.defaultDesc": "在下面给出的命令里初始化目录骨架（或把已有 novel 目录放进工作区根），然后刷新本面板。",
        "guide.copied": "已复制 xiaoyu-novel init", "guide.copyFailed": "复制失败，请手动选择命令文本", "guide.copying": "复制中…", "guide.copyCmd": "复制命令",
        "common.retry": "重试", "common.empty": "暂无数据", "common.uncategorized": "未分类", "common.charCount": "{n} 字",
        "common.collapse": "收起（点标题展开/收起）", "common.expand": "展开（点标题展开/收起）",
        "common.closeTip": "关闭提示", "common.unknownErr": "未知错误", "common.priorityTitle": "优先级：{pri}", "common.priorityAria": "优先级{pri}",
        "common.dirtyExit": "有未保存的修改，离开将丢失。确定要放弃吗？",
        "common.chapterNum": "第 {n} 章", "pri.high": "高", "pri.normal": "中", "pri.low": "低",
        "toast.prefix": "小鱼创作台：{msg}", "toast.success": "操作成功", "toast.indexRebuilt": "索引已重建（{n} 章）",
        "toast.chapterStatus": "章节状态已更新", "toast.chapterCreated": "已从章纲建章「{title}」（待写）", "toast.foreshadowStatus": "伏笔状态已更新", "toast.phaseAdvanced": "阶段已推进到「{phase}」",
        "toast.styleSaved": "写作风格已保存", "toast.chapterSaved": "章节正文已保存", "toast.outlineSaved": "章纲已保存",
        "src.modalAria": "源文件编辑", "src.closeAria": "关闭源文件编辑",
        "src.editSource": "编辑源文件", "src.editSourceTip": "编辑源文件：{rel}",
        "src.deleteFile": "删除文件", "src.deleteTip": "删除文件：{rel}",
        "src.loading": "源文件加载中…", "src.loadFailed": "源文件读取失败：{msg}",
        "src.editHint": "直接编辑文件全文；保存时做结构校验（账本 yml 须解析为条目数组、md 实体卡须带 frontmatter 围栏），语义问题交给保存后的静态体检。",
        "edit.conflict409": "保存冲突：文件在编辑期间被外部修改（{msg}）。草稿已保留，请选择处理方式。",
        "edit.conflictDrop": "载入磁盘版（放弃草稿）", "edit.conflictKeep": "基于最新版重改",
        "src.slugLabel": "文件名 slug", "src.slugPh": "如 lin-waner（小写字母/数字与 -）", "src.slugInvalid": "slug 只接受小写字母/数字与 -，且以字母或数字开头",
        "src.createHint": "内容已按模板预填，可修改后再创建。", "src.create": "创建", "src.creating": "创建中…",
        "src.confirmTitle": "确认删除", "src.confirmText": "即将删除 {rel}。此操作不可逆——后悔靠 git 回滚；删除后静态体检会把指向它的悬空引用（伏笔/时间线/关系等）标为问题。",
        "src.confirmDelete": "确认删除", "src.deleting": "删除中…",
        "toast.fileSaved": "已保存 {rel}", "toast.fileCreated": "已创建 {rel}", "toast.fileDeleted": "已删除 {rel}",
        "reader.createOutline": "新建章纲", "reader.deleteChapter": "删除章节",
        "outline.deleteBtn": "删除章纲",
        "char.createBtn": "新建角色", "world.createBtn": "新建设定", "world.createScienceBtn": "新建科学设定",
        "api.notJson": "响应不是 JSON（HTTP {code}）", "api.timeout": "请求超时（{s} 秒）",
        "status.pending": "待写", "status.writing": "写作中", "status.review": "审校中", "status.accepted": "已定稿", "status.rawSuffix": "（{raw}）",
        "stage.pending": "等开写", "stage.writing": "写作中", "stage.review": "等审校报告", "stage.accepted": "已定稿", "stage.awaitAuthor": "等作者交稿",
        "phase.idea": "立意", "phase.setting": "设定", "phase.outline": "大纲", "phase.writing": "写作", "phase.review": "审校",
        "phase.consistency": "一致性", "phase.export": "导出", "phase.unset": "未设阶段",
        "phase.advanceTitle": "推进到「{next}」", "phase.advance": "推进阶段", "phase.advancing": "推进中…", "phase.final": "已是最终阶段",
        "foreshadow.planted": "埋设", "foreshadow.progressing": "推进中", "foreshadow.resolved": "已回收", "foreshadow.abandoned": "已弃用",
        "foreshadow.advance": "推进", "foreshadow.resolve": "回收", "foreshadow.abandon": "弃用", "foreshadow.advancing": "推进中…",
        "foreshadow.plantedUnmarked": "埋设章未标", "foreshadow.resolvedAt": "回收于 {ch}", "foreshadow.priorityLabel": "优先级 {pri}",
        "foreshadow.backfill": "回填", "foreshadow.backfillTip": "从作者正文回填", "foreshadow.missingStatus": "缺 status",
        "foreshadow.noIdTip": "该条目缺 id，无法写状态",
        "foreshadow.noStatusTip": "该条目缺 status 行，服务端会拒绝流转（409）；请先在 foreshadows.yml 补上 status",
        "foreshadow.empty": "foreshadows.yml 还没有伏笔条目", "foreshadow.colEmpty": "空",
        "clue.clue": "线索", "clue.redHerring": "红鲱鱼", "clue.inference": "推理", "clue.question": "疑问",
        "sci.known": "已确证", "sci.extrapolation": "推演", "sci.hypothesis": "假说", "world.unlabeled": "未标级",
        "warnings.title": "部分文件解析异常（已跳过）：",
        "check.title": "静态体检：{n} 项（错误 {err} / 警告 {warn}）", "check.fullHint": "全量结果请在终端运行 xiaoyu-novel check 查看",
        "check.clean": "清账本", "check.cleaning": "清理中…", "check.cleanDirty": "有未保存的编辑，先保存再清账本",
        "toast.tokenAging": "更新令牌已用 {n} 天，建议换一枚（GitHub → Settings → Developer settings → Fine-grained tokens），换完跑 xiaoyu-novel token set <新PAT>",
        "check.cleanTip": "一次清完：超长条目压成结论（明细进 archive/ledger-details/）、大账本按章归档到 archive/、超期伏笔升「推进中」、索引不一致自动重建；写前备份，可撤销",
        "toast.ledgerCleaned": "账本已清：压缩 {n} 条 · 归档 {a} 条 · 升级伏笔 {k} 条", "toast.ledgerCleanEmpty": "账本没有需要清理的条目",
        "index.title": "索引板（clue-board / memories）", "index.rebuild": "重建索引", "index.rebuilding": "重建中…",
        "index.rebuildTip": "按 CLI index 同一逻辑重建 index.yml", "index.clueBoard": "线索板", "index.clueEmpty": "clue-board.yml 还没有条目",
        "index.memBoard": "记忆板", "index.memEmpty": "memories.yml 还没有条目", "index.promise": "承诺线",
        "timeline.empty": "timeline.yml 还没有时间线条目", "timeline.importance": "重要度 {n}", "timeline.linkedChapter": "关联章节：{ch}",
        "world.title": "世界观条目", "world.empty": "world/ 目录还没有设定条目", "world.science": "科学设定",
        "world.scienceEmpty": "science/ 目录还没有科学设定", "world.research": "资料检索", "world.ref": "参考 {n}：{r}",
        "world.researchEmpty": "research/ 目录还没有考据资料", "world.subTabsAria": "设定分区", "world.catTabsAria": "世界观分类",
        "relations.title": "角色关系图", "relations.counts": "{n} 节点 · {m} 关系",
        "relations.help": "拖节点固定位置 · 点节点聚焦它的一度关系 · 点边看详情 · 双指缩放/拖动平移 · 双击复位 · 右上角全屏",
        "relations.unlinkedTitle": "未入图角色（无关系边）", "relations.noData": "没有角色或关系数据，无法绘图",
        "relations.edgeTipPrefix": "{type}：", "relations.noDesc": "（无描述）",
        "relations.zoomIn": "放大", "relations.zoomOut": "缩小", "relations.fs": "全屏", "relations.exitFs": "退出全屏",
        "relations.reset": "复位（缩放回 100% 并松开所有固定节点）",
        "relations.filterChapter": "看到第", "relations.allChapters": "全部（含剧透）",
        "relations.searchPh": "搜角色 / 关系类型 / 描述", "relations.chipClear": "清空筛选",
        "relations.noType": "（未填类型）", "relations.intensityTitle": "强度 {n} / 5",
        "relations.focusOn": "聚焦：{name}", "relations.focusClear": "取消聚焦",
        "relations.openChar": "打开角色卡",
        "relations.listTitle": "关系清单", "relations.listCount": "{n} 条",
        "relations.listEmpty": "当前筛选下没有关系（换章节或清掉筛选试试）",
        "relations.sortBy": "排序", "relations.sortIntensity": "按强度", "relations.sortChapter": "按起始章", "relations.sortType": "按类型",
        "relations.exportPng": "导出图", "relations.exportPngTip": "把当前关系图导出为 PNG（2 倍分辨率）",
        "relations.copyList": "复制清单", "relations.copyListTip": "把当前筛选下的关系清单复制为 markdown（可直接发给写手/审校）",
        "relations.copied": "关系清单已复制到剪贴板", "relations.pngSaved": "关系图已导出为 PNG",
        "relations.pngFail": "导出失败：{msg}",
        "relations.copyTitle": "复制关系清单", "relations.copyHint": "宿主不支持自动写剪贴板时，点「全选复制」再手动复制：",
        "relations.copySelect": "全选复制", "relations.copyManual": "自动复制被拦，请手动复制选中的文字", "relations.close": "关闭",
        "relations.startedMissing": "{n} 条关系未登记起始章（按章过滤时不会被隐藏）",
        "relations.startedMissingOne": "缺起始章", "relations.endedTag": "已结束", "relations.stages": "{n} 阶段",
        "relations.legendWeak": "弱", "relations.legendStrong": "强",
        "version.title": "书稿版本（git）", "version.repoOff": "尚未建版本库", "version.hint": "面板的章节历史只记录「面板保存」与「门禁自动修」；agent 直接改文件不进历史。建一个本地 git 仓库，改坏了能整章回滚。不联网、不配远端。",
        "version.init": "一键初始化版本库", "version.initDone": "已建库并提交初始快照", "version.initExists": "版本库已存在", "version.working": "处理中…",
        "version.commit": "提交当前改动", "version.commitDone": "已提交 {n} 处改动", "version.nothing": "没有未提交的改动",
        "version.changed": "{n} 处未提交", "version.clean": "工作区干净", "version.showLog": "看历史", "version.hideLog": "收起历史",
        "version.empty": "还没有提交记录", "version.noGit": "这台机器上没有 git（或不在 PATH 里），版本功能已隐藏——其余写作功能不受影响。",
        "version.restoreTip": "把 {rel} 回滚到 {rev}", "version.restoreConfirm": "把 {rel} 恢复成提交 {rev} 时的版本？当前内容会先留一份面板历史快照。", "version.restored": "已回滚 {rel}",
        "handoff.open": "交接卡", "handoff.tip": "生成这一章的交接卡：出场角色/伏笔/关系变化/钩子，写下一章直接贴", "handoff.title": "章节交接卡", "handoff.hint": "这是从现有账本自动汇总的「本章前提」，只读；复制给写手就能开下一章。",
        "handoff.copy": "复制交接卡", "handoff.copied": "交接卡已复制", "handoff.copyFail": "复制失败，请手动选中", "handoff.fail": "交接卡生成失败",
        "heat.title": "段落热度", "heat.top": "先改 {list}", "heat.cool": "全章偏冷，没有明显病灶段", "heat.cellTip": "第 {i} 段 · 热度 {heat} · {hits}",
        "brief.open": "派单指令", "brief.tip": "复制一份可直接粘给帮手的委派单（写手 / 去 AI 味 / 审校）", "brief.write": "写手（写这一章）", "brief.polish": "去 AI 味（改这一章）", "brief.review": "审校（审这一章）", "brief.copied": "已复制「{kind}」委派单",
        "brief.body.write": "派单：写手，第 N 章正文（novel/chapters/{file}）\n1. 读：本章章纲、前一章结尾约 1500 字、出场角色卡、活跃伏笔、novel/style.md。\n2. 写：按章纲节拍一次成稿（一次 write 落整章，不要分段追加），五维覆盖，章尾留钩子，字数按 style.md「节奏」节。\n3. 纪律：只改这一章正文，不动设定与账本；一次成章，不留占位符。\n4. 回报：字数、五维覆盖、伏笔异动、设定变更需求。",
        "brief.body.polish": "派单：去 AI 味师（novel/chapters/{file}）\n1. 加载 skill xiaoyu-qu-ai-wei，按十二式手术与每千字配比表改写——只改写法，不改情节、对话语义、伏笔点位，字数浮动 ≤10%。\n2. 改前、改后各跑一次 aiwei_scan.py；人味指数 ≥78 且检测器五项过线。\n3. 落盘：只对真改过的段落发 edit，old_string 与 new_string 逐字相同的段落跳过；整章无改动就回报「已达标」。\n4. 回报：改前/改后分数、改动处数、零改动确认。",
        "brief.body.review": "派单：审校（novel/chapters/{file}，只读不改）\n1. 加载 skill xiaoyu-novel-review-checklist，按七层标准与六维一致性审这一章。\n2. 先跑 xiaoyu-novel audit / gate 拿摘要，不在 chapters/ 里自己翻；审校没有 shell。\n3. 输出：结论一行（过/需修/阻塞）+ P0-P2 问题（位置｜问题｜怎么改）+ 未核实项。\n4. 铁律：结论缺失才算未完成；没查到的写「未核实」，不许为凑清单一遍遍重搜。",
        "split.on": "双栏对照", "split.off": "单栏", "split.tip": "宽屏下章纲与正文并排（手机仍上下排）",
        "relations.dedupeBtn": "合并重复 {n}", "relations.dedupeTip": "同一对角色挂 {n} 组重复关系（多出 {extra} 条边）——合并成一条：描述按章拼接，强度取最高，起始取最早。写前备份", "relations.dedupeBusy": "合并中…", "relations.dedupeDone": "已合并：{from} 条 → {to} 条", "relations.dedupeNone": "没有可合并的重复关系",
        "rel.autofillBtn": "补起始章 {n}", "rel.autofillTip": "有 {n} 条关系没写起始章——按正文证据提议补全", "rel.autofillTitle": "补全关系起始章", "rel.autofillHint": "以正文为证据：两人第一次同章出场即起点；从未同章的在下方标「需人工」，不会被自动填。只改 started 字段，写前备份 relations.yml.bak。",
        "rel.autofillEmpty": "没有需要补的关系", "rel.autofillManual": "需人工", "rel.autofillApply": "填入选中的 {n} 条", "rel.autofillDone": "已补全 {n} 条关系的起始章",
        "chapters.exportEpub": "导出 EPUB",
        "hookQueue.title": "章末平收返修队列", "hookQueue.count": "{n} 章平收", "hookQueue.hint": "这些章的结尾没钩子，读者最容易在这里停。点一个进那一章，补完钩子再回来。", "hookQueue.openTip": "打开这一章",
        "audit.fixOutline": "改章纲", "audit.fixOutlineTip": "打开这条章纲的源文件，把没落地的角色删掉或改写", "audit.noteOutline": "记待补", "audit.noteOutlineTip": "在章纲末尾的「## 待补」里记一行，下次写这章时提醒自己", "audit.noteDone": "已记入章纲「待补」", "audit.charsPlanned": "角色「{name}」计划 {ch} 登场，尚未出场",
        "char.field.debut": "计划登场章", "char.field.status": "卡状态", "char.statusPlanned": "计划中", "char.statusRetired": "已退场",
        "char.empty": "characters/ 目录还没有角色卡",
        "role.protagonist": "主角", "role.antagonist": "反派", "role.supporting": "配角", "role.minor": "龙套",
        "char.field.age": "年龄", "char.field.gender": "性别", "char.field.appearance": "外貌", "char.field.personality": "性格",
        "char.field.background": "背景", "char.field.motivation": "动机", "char.field.arc": "成长弧", "char.field.psychology": "心理曲线",
        "char.years": "{n} 岁", "char.linePersonality": "性格 ", "char.lineMotivation": "动机 ",
        "char.modalAria": "角色详情", "char.closeAria": "关闭角色卡", "char.markers": "标记", "char.file": "文件",
        "overview.author": "作者：{name}", "overview.totalWords": "总字数（CJK）", "overview.totalChapters": "章节总数",
        "overview.characters": "角色数", "overview.openForeshadows": "未回收伏笔", "overview.statusDist": "章节状态分布", "overview.recent": "最近章节",
        "overview.volumes": "分卷规划",
        "overview.edit": "编辑", "overview.editTip": "编辑书稿元信息",
        "chapters.empty": "chapters/ 目录还没有章节文件", "chapters.writeQueue": "按单写作", "chapters.rowTip": "点击打开该章",
        "header.addProject": "接入项目", "header.addProjectTip": "把已有 novel/ 项目的目录接入创作台", "header.addProjectPrompt": "输入已有项目目录的绝对路径（其下需有 novel/project.yml）", "header.addProjectOk": "已接入项目", "gate.historyTip": "括号内是与上次门禁的差值，正数为进步", "gate.tipsTitle": "去 AI 味建议（{n} 句，展开看）", "gate.fix": "改", "gate.fixTip": "按规则微调这一句（删套话/拆长句/打散并列），改完重算分数", "gate.fixEditing": "编辑中不能自动改句，先保存或退出编辑", "gate.fixed": "已改 {n} 处，人味指数 {h}", "gate.sortByScore": "按门禁分排序", "gate.th": "门禁", "header.addProjectDo": "接入", "header.addProjectCancel": "取消",
        "header.addProjectBusy": "接入中…", "header.addProjectOkAt": "已接入：{path}",
        "verNote.new": "本地 {cur} → 线上 {latest}，可升级",
        "verNote.upToDate": "已是最新 {ver}（{at} 检测）",
        "verNote.fail": "检测失败：{msg}",
        "header.wsRemove": "移除本书", "header.wsRemoveTip": "只从列表移除登记，不删磁盘上的任何文件",
        "header.wsRemoveConfirm": "把「{path}」从工作区列表移除？\n只摘登记，磁盘文件一个都不动。",
        "header.wsRemoved": "已从列表移除（磁盘文件未动）",
        "gate.human": "人味", "gate.detector": "人写", "gate.copy": "去 AI 味", "gate.copied": "已复制去 AI 味指令，新建会话粘贴给主编即可", "gate.copyFailed": "复制失败，请手动复制", "gate.copyTip": "复制交给主编的去 AI 味委派指令", "gate.tip": "人味指数 {h} · 人写度 {d}",
        // 派单提示词（0.4.2）：与主编人设「派活四段」同构——目标/输入/过闸线/回报，
        // 条件逐条照旧（≥78、检测器五项、字数 ≤10%、零改动确认），只重排结构。
        "gate.brief": "请以小鱼创作主编身份派单给 polish（去 AI 味师），稿子是 novel/chapters/{file}，按五段写：\n1. 目标：加载 skill xiaoyu-qu-ai-wei，按十二式手术与每千字配比表改写本章正文——只改写法，不改情节、对话语义与伏笔点位，字数浮动不超过 10%。\n2. 输入：novel/chapters/{file}；改前、改后各跑一次 aiwei_scan.py。\n3. 过闸线：人味指数 ≥78，检测器五项同步过线。\n4. 落盘：只对真改过的段落发 edit，old_string 与 new_string 逐字相同的段落直接跳过（否则会报 old_string and new_string must differ，白烧一步）。\n5. 回报：改前/改后分数、各手术改动处数，以及「情节/对话/伏笔零改动」确认。",
        "chapters.outlineWords": "章纲 {n} 字", "chapters.all": "全部", "chapters.thVolume": "卷 · 章", "chapters.thTitle": "标题",
        "chapters.thStatus": "状态", "chapters.thWords": "字数", "chapters.thSummary": "梗概", "chapters.rowReadTip": "点击阅读正文",
        "chapters.emptyFiltered": "该状态下没有章节",
        "chapters.outlineRowTip": "点击查看章纲全文", "chapters.noChapter": "未建章", "chapters.createBtn": "建章", "chapters.creating": "建章中…",
        "chapters.createTip": "在 chapters/ 下按章纲建一章（status=pending，正文待写）",
        "chapters.emptyWithOutlines": "chapters/ 目录还没有章节文件；下方「按单写作」已列出未建章章纲",
        "reader.back": "返回", "reader.backTip": "返回章节列表", "reader.copyPath": "复制路径", "reader.copyPathTip": "复制章节文件路径",
        "reader.edit": "编辑", "reader.editTip": "编辑章节正文（frontmatter 保留不动）",
        "reader.save": "保存", "reader.titlePlaceholder": "章节标题（可改）", "reader.bodyEditHint": "直接编辑正文：停手约 1.5 秒自动保存（连续写作每 6 秒也落一次），Ctrl/⌘+S 立即保存；回车换行自动加段首两个全角空格缩进。frontmatter（--- 围栏）保留不动；文件被外部改过时保存会被拒绝并给出处理出口。", "reader.autoSaved": "已自动保存（{time}）", "reader.wordsNoPunct": "不含标点 {n} 字", "reader.wordsWithPunct": "含标点 {n} 字", "reader.fontSmaller": "缩小字号", "reader.fontLarger": "放大字号", "reader.font": "字体", "reader.fontDefault": "系统默认", "reader.readMode": "阅读模式", "reader.editFullscreen": "全屏编辑", "reader.editExitFullscreen": "退出全屏",
        "outline.editTip": "编辑章纲", "outline.editHint": "直接编辑章纲全文；编辑期间文件被外部改过时保存会被拒绝，并放回磁盘最新内容。",
        "reader.copied": "已复制章节文件路径", "reader.copyFailed": "复制失败，请手动选择路径文本", "reader.loadFailed": "正文读取失败：{msg}",
        "reader.nextChapter": "下一章", "reader.nextTip": "跳到「{name}」", "reader.lastChapter": "已是最后一章",
        "reader.bodyPanel": "正文", "reader.collapseBody": "收起正文", "reader.expandBody": "展开正文",
        "reader.noOutline": "暂无章纲", "reader.emptyBody": "（空章节）", "reader.finalState": "已定稿（终态）", "reader.statusFlow": "状态流转：",
        "reader.flowing": "流转中…", "reader.advanceTo": "推进到「{next}」",
        "outline.title": "章纲对照", "outline.empty": "（章纲为空）", "outline.collapseTip": "收起章纲", "outline.expandTip": "展开章纲",
        "outline.modalAria": "章纲全文", "outline.closeAria": "关闭章纲", "outline.loading": "章纲加载中…", "outline.loadFailed": "章纲读取失败：{msg}",
        "novel.metaTitle": "书稿元信息", "novel.metaNote": "对应 novel/project.yml · 行尾注释会原样保留",
        "novel.fTitle": "书名", "novel.titlePh": "如：长夜余火", "novel.fAuthor": "作者", "novel.authorPh": "笔名",
        "novel.fGenre": "题材", "novel.genrePh": "如：东方玄幻 / 都市异能 / 历史架空", "novel.fLength": "预期篇幅",
        "novel.lengthPh": "如：约100万字 / 300章", "novel.fLanguage": "正文语言", "novel.fPhase": "工作流阶段", "novel.fMode": "共创模式",
        "novel.fDesc": "一句话简介", "novel.descPh": "写封面文案时可直接引用", "novel.titleRequired": "书名不能为空",
        "mode.aiDraft": "AI 代笔（AI 写正文）", "mode.coWrite": "逐章共创（按章指派谁写）", "mode.authorDraft": "作者亲笔（AI 只备料审稿）",
        "modeShort.aiDraft": "AI 代笔", "modeShort.coWrite": "逐章共创", "modeShort.authorDraft": "作者亲笔",
        "novel.saving": "保存中…", "novel.save": "保存设置", "novel.cancel": "取消",
        "settings.title": "系统设置", "settings.closeAria": "关闭设置", "settings.language": "语言",
        "settings.openMode": "打开方式", "settings.modeSplit": "分栏", "settings.modeMiddle": "中间栏", "settings.modeSidebar": "右侧栏",
        "settings.openModeHint": "创作台与文章页各自的落位：分栏=创作台中间栏 + 文章页右侧栏；中间栏=两者都在中间栏；右侧栏=两者都在右侧栏。切换对下一次打开生效。",
        "settings.openModeUnsupported": "当前宿主版本不带右侧栏，右栏形态不可用。",
        "readerTab.snapFailed": "文章页快照拉取失败，请重试。",
        "settings.languageHint": "界面文字随语言选项切换，立即生效并记忆。", "settings.fontScale": "字号",
        "settings.fontScaleHint": "按当前字号的百分比缩放整个创作台，立即生效并记忆。",
        "errBoundary.title": "该分区渲染出错", "errBoundary.summary": "错误摘要：{msg}",
        "dim.cognitiveFrame": "认知框架", "dim.emotionalAnchor": "情感锚点", "dim.worldTexture": "世界质感",
        "dim.suspense": "悬念", "dim.interpersonalTension": "人际张力",
      },
      en: {
        "shell.title": "Xiaoyu Studio", "header.subtitle": "Web-novel project dashboard & status flow · chapter text & outlines editable",
        "header.curVerTitle": "Current version", "header.upgradeTip": "Current {cur} — click to open the release page", "header.newVersion": "New version {ver} ↗",
        "header.upgradeBtn": "Upgrade now", "header.upgrading": "Installing…", "header.upgraded": "Installed — restart pending",
        "header.upgradeTitle": "Install the latest npm release with pnpm (up to ~3 min); takes effect after restarting DeepSeek",
        "header.upgradedTitle": "New version installed — takes effect after restarting DeepSeek",
        "header.checkUpdate": "Check updates", "header.checkingUpdate": "Checking…",
        "toast.selfUpdate.ok": "Installed {ver} — takes effect after restarting DeepSeek",
        "toast.selfUpdate.upToDate": "Already up to date ({ver})",
        "toast.selfUpdate.globalOk": "Global xiaoyu CLI {from} → {to}", "toast.selfUpdate.globalFail": "Global CLI update failed: {error}",
        "toast.selfUpdate.devLink": "Installed from a dev directory — update with git pull", "toast.selfUpdate.pnpmMissing": "pnpm not found — install it manually",
        "toast.selfUpdate.found": "New version {ver} found", "toast.selfUpdate.checkFail": "Check failed: {msg}",
        "header.workspace": "Workspace", "header.wsAria": "Select workspace", "header.noNovel": "(no novel)", "header.untitled": "Untitled",
        "header.settings": "Settings", "header.refresh": "Refresh", "header.closeAria": "Close Xiaoyu Studio", "header.closeTitle": "Close",
        "tabs.aria": "Studio sections",
        "tabs.overview": "Overview", "tabs.chapters": "Chapters", "tabs.characters": "Characters", "tabs.foreshadows": "Foreshadowing", "tabs.relations": "Relations",
        "tabs.timeline": "Timeline", "tabs.world": "Worldbuilding", "tabs.style": "Style", "tabs.index": "Index Board",
        "style.registerTip": "Write the {name} language register into style.md", "style.registerOk": "Applied the {name} register", "style.note": "Writer / outliner / reviewer all follow this baseline; changes take effect immediately",
        "style.editTip": "Edit the style baseline (novel/style.md)",
        "style.empty": "novel/style.md does not exist yet — the writer / outliner / reviewer will find no style baseline. Create it from the plugin's default web-novel baseline, then adapt it to this book.",
        "style.createFromTpl": "Create from default baseline",
        "style.loadFailed": "Failed to load the style baseline: {msg}",
        "shell.wsListFailed": "Failed to load workspace list: {msg}", "shell.stateFailed": "Failed to load snapshot: {msg}",
        "guide.noWsTitle": "No novel workspace available yet", "guide.noWsDesc": "A workspace is picked up automatically once novel/project.yml exists at its root; initialize the directory scaffold with this command first:",
        "guide.notInitTitle": "No novel project in this workspace yet", "guide.notInitDesc": "novel/project.yml is missing at the workspace root. Run this at the workspace root:",
        "guide.defaultTitle": "No novel project in this workspace yet", "guide.defaultDesc": "Initialize the directory scaffold with the command below (or drop an existing novel/ directory into the workspace root), then refresh this panel.",
        "guide.copied": "Copied xiaoyu-novel init", "guide.copyFailed": "Copy failed — select the command text manually", "guide.copying": "Copying…", "guide.copyCmd": "Copy command",
        "common.retry": "Retry", "common.empty": "No data", "common.uncategorized": "Uncategorized", "common.charCount": "{n} chars",
        "common.collapse": "Collapse (tap the title to toggle)", "common.expand": "Expand (tap the title to toggle)",
        "common.closeTip": "Dismiss notification", "common.unknownErr": "Unknown error", "common.priorityTitle": "Priority: {pri}", "common.priorityAria": "Priority {pri}",
        "common.dirtyExit": "You have unsaved changes that will be lost. Discard them?",
        "common.chapterNum": "Ch. {n}", "pri.high": "High", "pri.normal": "Normal", "pri.low": "Low",
        "toast.prefix": "Xiaoyu Studio: {msg}", "toast.success": "Success", "toast.indexRebuilt": "Index rebuilt ({n} chapters)",
        "toast.chapterStatus": "Chapter status updated", "toast.chapterCreated": "Created chapter \"{title}\" from the outline (pending)", "toast.foreshadowStatus": "Foreshadowing status updated", "toast.phaseAdvanced": "Phase advanced to {phase}",
        "toast.styleSaved": "Style baseline saved", "toast.chapterSaved": "Chapter text saved", "toast.outlineSaved": "Outline saved",
        "src.modalAria": "Source file editor", "src.closeAria": "Close source editor",
        "src.editSource": "Edit source file", "src.editSourceTip": "Edit source file: {rel}",
        "src.deleteFile": "Delete file", "src.deleteTip": "Delete file: {rel}",
        "src.loading": "Loading source file…", "src.loadFailed": "Failed to load source file: {msg}",
        "src.editHint": "Edit the whole file; saving runs structural validation (ledger yml must parse as an entry array, md entity cards must carry frontmatter fences) — semantics are left to the static check after saving.",
        "edit.conflict409": "Save conflict: the file was changed externally while editing ({msg}). Your draft is kept — choose how to proceed.",
        "edit.conflictDrop": "Load disk version (discard draft)", "edit.conflictKeep": "Rebase onto latest",
        "src.slugLabel": "File slug", "src.slugPh": "e.g. lin-waner (lowercase letters/digits and -)", "src.slugInvalid": "Slug accepts lowercase letters/digits and - only, starting with a letter or digit",
        "src.createHint": "Pre-filled from the template — adjust it, then create.", "src.create": "Create", "src.creating": "Creating…",
        "src.confirmTitle": "Confirm delete", "src.confirmText": "About to delete {rel}. This is irreversible — recovery is via git rollback; afterwards the static check will flag dangling references to it (foreshadows / timeline / relations etc.).",
        "src.confirmDelete": "Delete", "src.deleting": "Deleting…",
        "toast.fileSaved": "Saved {rel}", "toast.fileCreated": "Created {rel}", "toast.fileDeleted": "Deleted {rel}",
        "reader.createOutline": "Create outline", "reader.deleteChapter": "Delete chapter",
        "outline.deleteBtn": "Delete outline",
        "char.createBtn": "New character", "world.createBtn": "New world entry", "world.createScienceBtn": "New science entry",
        "api.notJson": "Response is not JSON (HTTP {code})", "api.timeout": "Request timed out ({s} s)",
        "status.pending": "Pending", "status.writing": "Writing", "status.review": "Review", "status.accepted": "Accepted", "status.rawSuffix": "({raw})",
        "stage.pending": "Awaiting draft", "stage.writing": "Writing", "stage.review": "Awaiting review report", "stage.accepted": "Accepted", "stage.awaitAuthor": "Awaiting author's manuscript",
        "phase.idea": "Idea", "phase.setting": "Setting", "phase.outline": "Outline", "phase.writing": "Writing", "phase.review": "Review",
        "phase.consistency": "Consistency", "phase.export": "Export", "phase.unset": "No phase",
        "phase.advanceTitle": "Advance to {next}", "phase.advance": "Advance phase", "phase.advancing": "Advancing…", "phase.final": "Final phase",
        "foreshadow.planted": "Planted", "foreshadow.progressing": "In Progress", "foreshadow.resolved": "Resolved", "foreshadow.abandoned": "Abandoned",
        "foreshadow.advance": "Advance", "foreshadow.resolve": "Resolve", "foreshadow.abandon": "Abandon", "foreshadow.advancing": "Advancing…",
        "foreshadow.plantedUnmarked": "Planting chapter unmarked", "foreshadow.resolvedAt": "Resolved in {ch}", "foreshadow.priorityLabel": "Priority {pri}",
        "foreshadow.backfill": "Backfill", "foreshadow.backfillTip": "Backfilled from the author's manuscript", "foreshadow.missingStatus": "missing status",
        "foreshadow.noIdTip": "This entry has no id — its status cannot be written",
        "foreshadow.noStatusTip": "This entry has no status line, the server will reject the transition (409); add a status in foreshadows.yml first",
        "foreshadow.empty": "No entries in foreshadows.yml yet", "foreshadow.colEmpty": "Empty",
        "clue.clue": "Clue", "clue.redHerring": "Red herring", "clue.inference": "Inference", "clue.question": "Question",
        "sci.known": "Confirmed", "sci.extrapolation": "Extrapolation", "sci.hypothesis": "Hypothesis", "world.unlabeled": "Unrated",
        "warnings.title": "Some files failed to parse (skipped):",
        "check.title": "Static check: {n} issue(s) ({err} errors / {warn} warnings)", "check.fullHint": "Run xiaoyu-novel check in a terminal for the full report",
        "check.clean": "Clean ledgers", "check.cleaning": "Cleaning…", "check.cleanDirty": "Save your unsaved edits before cleaning ledgers",
        "toast.tokenAging": "Update token is {n} days old — consider rotating it (GitHub → Settings → Developer settings → Fine-grained tokens), then run xiaoyu-novel token set <PAT>",
        "check.cleanTip": "All in one: trim over-long entries to a conclusion (details to archive/ledger-details/), archive big ledgers by chapter, advance stale foreshadows, rebuild a stale index; backs up first, undoable",
        "toast.ledgerCleaned": "Ledgers cleaned: {n} trimmed · {a} archived · {k} advanced", "toast.ledgerCleanEmpty": "Nothing to clean in the ledgers",
        "index.title": "Index Board (clue-board / memories)", "index.rebuild": "Rebuild index", "index.rebuilding": "Rebuilding…",
        "index.rebuildTip": "Rebuild index.yml with the same logic as the CLI index command", "index.clueBoard": "Clue board", "index.clueEmpty": "No entries in clue-board.yml yet",
        "index.memBoard": "Memory board", "index.memEmpty": "No entries in memories.yml yet", "index.promise": "Promise thread",
        "timeline.empty": "No entries in timeline.yml yet", "timeline.importance": "Importance {n}", "timeline.linkedChapter": "Related chapter: {ch}",
        "world.title": "Worldbuilding entries", "world.empty": "No worldbuilding entries in world/ yet", "world.science": "Science settings",
        "world.scienceEmpty": "No science entries in science/ yet", "world.research": "Research", "world.ref": "Ref {n}: {r}",
        "world.researchEmpty": "No research notes in research/ yet", "world.subTabsAria": "Worldbuilding sections", "world.catTabsAria": "Worldbuilding categories",
        "relations.title": "Character relations", "relations.counts": "{n} nodes · {m} relations",
        "relations.help": "Drag a node to pin it · tap a node to focus its direct relations · tap an edge for details · pinch to zoom / drag to pan · double-click to reset · top-right for full screen",
        "relations.unlinkedTitle": "Unlinked characters (no relation edges)", "relations.noData": "No character or relation data to draw",
        "relations.edgeTipPrefix": "{type}: ", "relations.noDesc": "(no description)",
        "relations.zoomIn": "Zoom in", "relations.zoomOut": "Zoom out", "relations.fs": "Full screen", "relations.exitFs": "Exit full screen",
        "relations.reset": "Reset (zoom back to 100% and unpin every node)",
        "relations.filterChapter": "Up to", "relations.allChapters": "All (spoilers included)",
        "relations.searchPh": "Search character / relation type / description", "relations.chipClear": "Clear filters",
        "relations.noType": "(no type)", "relations.intensityTitle": "Intensity {n} / 5",
        "relations.focusOn": "Focused: {name}", "relations.focusClear": "Clear focus",
        "relations.openChar": "Open character card",
        "relations.listTitle": "Relation list", "relations.listCount": "{n} relations",
        "relations.listEmpty": "No relations under the current filters (try another chapter or clear the filters)",
        "relations.sortBy": "Sort", "relations.sortIntensity": "By intensity", "relations.sortChapter": "By start chapter", "relations.sortType": "By type",
        "relations.exportPng": "Export image", "relations.exportPngTip": "Export the current graph as a PNG (2x resolution)",
        "relations.copyList": "Copy list", "relations.copyListTip": "Copy the filtered relation list as markdown (ready to hand to a writer or reviewer)",
        "relations.copied": "Relation list copied to clipboard", "relations.pngSaved": "Relation graph exported as PNG",
        "relations.pngFail": "Export failed: {msg}",
        "relations.copyTitle": "Copy relation list", "relations.copyHint": "If the host cannot write the clipboard automatically, hit “Select & copy” and copy manually:",
        "relations.copySelect": "Select & copy", "relations.copyManual": "Automatic copy was blocked — please copy the selected text manually", "relations.close": "Close",
        "relations.startedMissing": "{n} relations have no start chapter (they stay visible when filtering by chapter)",
        "relations.startedMissingOne": "no start chapter", "relations.endedTag": "Ended", "relations.stages": "{n} stages",
        "relations.legendWeak": "weak", "relations.legendStrong": "strong",
        "version.title": "Manuscript versions (git)", "version.repoOff": "No repository yet", "version.hint": "Panel history only covers panel saves and gate auto-fixes; agent edits bypass it. A local git repo lets you roll back a chapter. No network, no remotes.",
        "version.init": "Initialize repository", "version.initDone": "Repository created with an initial snapshot", "version.initExists": "Repository already exists", "version.working": "Working…",
        "version.commit": "Commit changes", "version.commitDone": "Committed {n} change(s)", "version.nothing": "Nothing to commit",
        "version.changed": "{n} uncommitted", "version.clean": "Working tree clean", "version.showLog": "History", "version.hideLog": "Hide history",
        "version.empty": "No commits yet", "version.noGit": "git is not available on this machine, so version control is hidden. Everything else still works.",
        "version.restoreTip": "Restore {rel} to {rev}", "version.restoreConfirm": "Restore {rel} to commit {rev}? The current content is snapshotted into panel history first.", "version.restored": "Restored {rel}",
        "handoff.open": "Handoff card", "handoff.tip": "Build this chapter's handoff card: cast, foreshadowing, relation changes, hooks — paste it for the next chapter", "handoff.title": "Chapter handoff card", "handoff.hint": "An automatically assembled read-only brief of this chapter; copy it to the writer to start the next one.",
        "handoff.copy": "Copy card", "handoff.copied": "Handoff card copied", "handoff.copyFail": "Copy failed — select it manually", "handoff.fail": "Failed to build the handoff card",
        "heat.title": "Paragraph heat", "heat.top": "Fix {list} first", "heat.cool": "No obviously heavy paragraphs", "heat.cellTip": "Paragraph {i} · heat {heat} · {hits}",
        "brief.open": "Dispatch brief", "brief.tip": "Copy a ready-to-paste brief (writer / de-AI / reviewer)", "brief.write": "Writer (draft this chapter)", "brief.polish": "De-AI (revise this chapter)", "brief.review": "Review (audit this chapter)", "brief.copied": "Copied the “{kind}” brief",
        "brief.body.write": "Dispatch: writer, chapter body (novel/chapters/{file})\n1. Read: this chapter outline, previous chapter's last ~1500 chars, cast cards, active foreshadowing, novel/style.md.\n2. Write: one shot to full draft (single write, no piecemeal appends), cover the five dimensions, end on a hook, word count per style.md.\n3. Discipline: only this chapter; do not touch worldbuilding or ledgers.\n4. Report: word count, five-dimension coverage, foreshadowing changes, setting needs.",
        "brief.body.polish": "Dispatch: de-AI editor (novel/chapters/{file})\n1. Load skill xiaoyu-qu-ai-wei; twelve-pass surgery, wording only, no plot/dialogue-meaning/foreshadowing changes, drift ≤10%.\n2. Run aiwei_scan.py before and after; human score ≥78 and all five detector metrics in range.\n3. Write-back: edit only paragraphs you actually changed; skip identical old/new strings; if nothing changed, report “already above gate”.\n4. Report: before/after scores, number of edits, no-plot-change confirmation.",
        "brief.body.review": "Dispatch: reviewer (novel/chapters/{file}, read-only)\n1. Load skill xiaoyu-novel-review-checklist; seven layers plus six consistency dimensions.\n2. Run xiaoyu-novel audit / gate first and use the summary; do not crawl chapters/ yourself (no shell).\n3. Output: one-line verdict (pass/fix/block) + P0-P2 issues (location | issue | fix) + unverified items.\n4. Rule: missing verdict is unfinished; mark things unverified instead of re-searching for a complete checklist.",
        "split.on": "Split view", "split.off": "Single column", "split.tip": "Side-by-side outline and body on wide screens (stacked on phones)",
        "relations.dedupeBtn": "Merge {n} dupes", "relations.dedupeTip": "{n} duplicate relation groups (extra {extra} edges) — merge each into one: descriptions concatenated by chapter, highest intensity, earliest start. Backed up first.", "relations.dedupeBusy": "Merging…", "relations.dedupeDone": "Merged: {from} → {to}", "relations.dedupeNone": "No duplicate relations to merge",
        "rel.autofillBtn": "Fill {n} start chapters", "rel.autofillTip": "{n} relations have no start chapter — propose them from the manuscript", "rel.autofillTitle": "Fill relation start chapters", "rel.autofillHint": "Evidence-based: the first chapter where both characters appear is the start. Pairs that never share a chapter are marked manual and never auto-filled. Only the started field changes; relations.yml.bak is written first.",
        "rel.autofillEmpty": "Nothing to fill", "rel.autofillManual": "manual", "rel.autofillApply": "Fill {n} selected", "rel.autofillDone": "Filled start chapters for {n} relation(s)",
        "chapters.exportEpub": "Export EPUB",
        "hookQueue.title": "Flat-ending fix queue", "hookQueue.count": "{n} flat endings", "hookQueue.hint": "These chapters end without a hook — the most likely place readers stop. Tap one to open it, fix the ending, come back.", "hookQueue.openTip": "Open this chapter",
        "audit.fixOutline": "Edit outline", "audit.fixOutlineTip": "Open this outline and remove or rewrite the character that never landed", "audit.noteOutline": "Note it", "audit.noteOutlineTip": "Add a line to the outline to-fill section as a reminder for next time", "audit.noteDone": "Added to the outline to-fill section", "audit.charsPlanned": "Character {name} is planned for {ch} but has not appeared",
        "char.field.debut": "Planned debut", "char.field.status": "Card status", "char.statusPlanned": "Planned", "char.statusRetired": "Retired",
        "char.empty": "No character cards in characters/ yet",
        "role.protagonist": "Protagonist", "role.antagonist": "Antagonist", "role.supporting": "Supporting", "role.minor": "Minor",
        "char.field.age": "Age", "char.field.gender": "Gender", "char.field.appearance": "Appearance", "char.field.personality": "Personality",
        "char.field.background": "Background", "char.field.motivation": "Motivation", "char.field.arc": "Character arc", "char.field.psychology": "Psychology",
        "char.years": "Age {n}", "char.linePersonality": "Personality ", "char.lineMotivation": "Motivation ",
        "char.modalAria": "Character details", "char.closeAria": "Close character card", "char.markers": "Tags", "char.file": "File",
        "overview.author": "Author: {name}", "overview.totalWords": "Total characters (CJK)", "overview.totalChapters": "Chapters",
        "overview.characters": "Characters", "overview.openForeshadows": "Unresolved foreshadowing", "overview.statusDist": "Chapter status breakdown", "overview.recent": "Recent chapters",
        "overview.volumes": "Volume plan",
        "overview.edit": "Edit", "overview.editTip": "Edit manuscript metadata",
        "chapters.empty": "No chapter files in chapters/ yet", "chapters.writeQueue": "Writing Queue", "chapters.rowTip": "Click to open this chapter",
        "header.addProject": "Add project", "header.addProjectTip": "Register an existing novel/ project directory", "header.addProjectPrompt": "Absolute path of an existing project directory (must contain novel/project.yml)", "header.addProjectOk": "Project added", "gate.historyTip": "Delta vs the previous gate run; positive means improvement", "gate.tipsTitle": "De-AI suggestions ({n} sentences)", "gate.fix": "Fix", "gate.fixTip": "Apply a conservative rule fix to this sentence, then rescore", "gate.fixEditing": "Cannot auto-fix while editing; save or exit edit first", "gate.fixed": "Fixed {n} issue(s), human score {h}", "gate.sortByScore": "Sort by gate score", "gate.th": "Gate", "header.addProjectDo": "Add", "header.addProjectCancel": "Cancel",
        "header.addProjectBusy": "Adding…", "header.addProjectOkAt": "Added: {path}",
        "verNote.new": "Local {cur} → remote {latest}, update available",
        "verNote.upToDate": "Up to date ({ver}), checked {at}",
        "verNote.fail": "Check failed: {msg}",
        "header.wsRemove": "Remove book", "header.wsRemoveTip": "Removes it from the list only — no files are deleted",
        "header.wsRemoveConfirm": "Remove \"{path}\" from the workspace list?\nIt only drops the registration; nothing on disk is touched.",
        "header.wsRemoved": "Removed from list (files untouched)",
        "gate.human": "Human", "gate.detector": "Human-like", "gate.copy": "De-AI pass", "gate.copied": "De-AI brief copied — paste it to the editor in a new session", "gate.copyFailed": "Copy failed, please copy manually", "gate.copyTip": "Copy the de-AI delegation brief for the editor", "gate.tip": "Human score {h} · detector score {d}",
        "gate.brief": "Dispatch from the Xiaoyu editor-in-chief to polish (de-AI), manuscript novel/chapters/{file}, five-part brief:\n1. Goal: load skill xiaoyu-qu-ai-wei and revise the chapter with the twelve-pass surgery and per-1000-char ratios — wording only, no plot, dialogue-meaning or foreshadowing changes, word-count drift ≤10%.\n2. Input: novel/chapters/{file}; run aiwei_scan.py before and after.\n3. Gate: human score ≥78 and all five detector metrics in range.\n4. Write-back: only edit paragraphs you actually changed; skip any paragraph whose old_string and new_string are identical (the tool rejects it with \"old_string and new_string must differ\" and you waste a step).\n5. Report: before/after scores, what was changed, and an explicit no-plot-change confirmation.",
        "chapters.outlineWords": "Outline {n} chars", "chapters.all": "All", "chapters.thVolume": "Vol · Ch", "chapters.thTitle": "Title",
        "chapters.thStatus": "Status", "chapters.thWords": "Words", "chapters.thSummary": "Summary", "chapters.rowReadTip": "Click to read",
        "chapters.emptyFiltered": "No chapters with this status",
        "chapters.outlineRowTip": "Click to view the full outline", "chapters.noChapter": "No chapter", "chapters.createBtn": "Create", "chapters.creating": "Creating…",
        "chapters.createTip": "Create a pending chapter in chapters/ from this outline (body to be written)",
        "chapters.emptyWithOutlines": "No chapter files in chapters/ yet — the Writing Queue below lists outlines without chapters",
        "reader.back": "Back", "reader.backTip": "Back to chapter list", "reader.copyPath": "Copy path", "reader.copyPathTip": "Copy chapter file path",
        "reader.edit": "Edit", "reader.editTip": "Edit the chapter text (frontmatter is preserved)",
        "reader.save": "Save", "reader.titlePlaceholder": "Chapter title (editable)", "reader.bodyEditHint": "Edit the chapter text directly: changes auto-save ~1.5s after you pause (and at least every 6s while typing), Ctrl/⌘+S saves now; Enter starts a new paragraph indented with two full-width spaces. The frontmatter (--- fence) is preserved; if the file was changed externally, saving is rejected with recovery options.", "reader.autoSaved": "Auto-saved ({time})", "reader.wordsNoPunct": "{n} chars (no punct.)", "reader.wordsWithPunct": "{n} chars (incl. punct.)", "reader.fontSmaller": "Smaller text", "reader.fontLarger": "Larger text", "reader.font": "Font", "reader.fontDefault": "System default", "reader.readMode": "Read mode", "reader.editFullscreen": "Fullscreen editing", "reader.editExitFullscreen": "Exit fullscreen",
        "outline.editTip": "Edit outline", "outline.editHint": "Edit the outline text directly; if the file was changed externally while editing, saving is rejected and the latest content is restored.",
        "reader.copied": "Copied chapter file path", "reader.copyFailed": "Copy failed — select the path text manually", "reader.loadFailed": "Failed to load chapter text: {msg}",
        "reader.nextChapter": "Next chapter", "reader.nextTip": "Go to “{name}”", "reader.lastChapter": "This is the last chapter",
        "reader.bodyPanel": "Text", "reader.collapseBody": "Collapse text", "reader.expandBody": "Expand text",
        "reader.noOutline": "No chapter outline", "reader.emptyBody": "(empty chapter)", "reader.finalState": "Accepted (final)", "reader.statusFlow": "Status:",
        "reader.flowing": "Transitioning…", "reader.advanceTo": "Advance to {next}",
        "outline.title": "Outline", "outline.empty": "(outline is empty)", "outline.collapseTip": "Collapse outline", "outline.expandTip": "Expand outline",
        "outline.modalAria": "Chapter outline", "outline.closeAria": "Close outline", "outline.loading": "Loading outline…", "outline.loadFailed": "Failed to load outline: {msg}",
        "novel.metaTitle": "Manuscript metadata", "novel.metaNote": "Maps to novel/project.yml · trailing comments are preserved",
        "novel.fTitle": "Title", "novel.titlePh": "e.g. The Long Night", "novel.fAuthor": "Author", "novel.authorPh": "Pen name",
        "novel.fGenre": "Genre", "novel.genrePh": "e.g. Eastern fantasy / Urban powers / Alternate history", "novel.fLength": "Planned length",
        "novel.lengthPh": "e.g. ~1M characters / 300 chapters", "novel.fLanguage": "Text language", "novel.fPhase": "Workflow phase", "novel.fMode": "Co-writing mode",
        "novel.fDesc": "One-line synopsis", "novel.descPh": "Can be quoted directly in cover copy", "novel.titleRequired": "Title is required",
        "mode.aiDraft": "AI ghostwriting (AI drafts the prose)", "mode.coWrite": "Chapter-by-chapter co-writing (assign a writer per chapter)", "mode.authorDraft": "Author writes (AI only preps and reviews)",
        "modeShort.aiDraft": "AI draft", "modeShort.coWrite": "Co-write", "modeShort.authorDraft": "Author writes",
        "novel.saving": "Saving…", "novel.save": "Save", "novel.cancel": "Cancel",
        "settings.title": "Settings", "settings.closeAria": "Close settings", "settings.language": "Language",
        "settings.openMode": "Open in", "settings.modeSplit": "Split", "settings.modeMiddle": "Center", "settings.modeSidebar": "Sidebar",
        "settings.openModeHint": "Where the studio and the article editor open: Split = studio in the center column + article in the right sidebar; Center = both in the center column; Sidebar = both in the right sidebar. Applies to the next open.",
        "settings.openModeUnsupported": "This host has no right sidebar; sidebar modes are unavailable.",
        "readerTab.snapFailed": "Failed to load the article snapshot; please retry.",
        "settings.languageHint": "UI text follows the language option; it applies immediately and is remembered.", "settings.fontScale": "Font size",
        "settings.fontScaleHint": "Scales the whole studio as a percentage of the current font size; applies immediately and is remembered.",
        "errBoundary.title": "This section failed to render", "errBoundary.summary": "Error summary: {msg}",
        "dim.cognitiveFrame": "Cognitive Frame", "dim.emotionalAnchor": "Emotional Anchor", "dim.worldTexture": "World Texture",
        "dim.suspense": "Suspense", "dim.interpersonalTension": "Interpersonal Tension",
      },
    };
    // 0.3.1 追加文案（整章自动修 / 章末钩子）：单列补齐，避免既有长行再膨胀。
    Object.assign(I18N.zh, {
      "gate.fixAll": "整章改",
      "gate.fixAllTip": "把这一章能自动处理的句子一次改完（删套话/拆长句/打散并列），改完重算分数",
      "gate.fixAllTitle": "整章自动修",
      "gate.fixAllText": "将对本章最多 {n} 句做保守微调：删软化副词与模糊量词、拆分长句、打散三项并列。只改写法，不改情节与对话语义；会直接覆盖章节原文。",
      "gate.fixAllDone": "已改 {n} 处：人味 {a} → {b}",
      "gate.fixAllNone": "这一章没有可自动处理的句子",
      "gate.fixAllEditing": "编辑中不能整章自动改，先保存或退出编辑",
      "gate.fixAllBusy": "正在改…",
      "gate.hookPlain": "章末平收",
      "gate.hookTip": "章末钩子：{kind}。平收提醒不是硬伤，收束章可忽略",
      "gate.hook.question": "问句收尾",
      "gate.hook.unfinished": "话没说完",
      "gate.hook.turn": "转折收尾",
      "gate.hook.short": "短句收尾",
      "gate.hook.plain": "平收",
      "gate.hook.empty": "空章",
      "overview.todayDelta": "今日新增字数",
      "setup.title": "开书清单（九件套）",
      "audit.title": "全书体检",
      "audit.run": "跑一次",
      "audit.loading": "分析中…",
      "audit.hint": "跨章查重、角色 0 出场、章纲点名未落地、字数离群、连续平收——单章门禁看不到的整本问题。",
      "audit.clean": "没有跨章级问题。",
      "audit.export": "导出报告",
      "audit.exported": "报告已写入 novel/{rel}",
      "audit.repeat": "跨章重复「{text}」出现在 {n} 章",
      "audit.chars": "角色「{name}」建了卡但全书 0 出场",
      "audit.outline": "章纲点名但正文未落地：{file} → {names}",
      "audit.outlier": "字数离群：{file}（{n} 字）",
      "audit.streak": "连续 {n} 章平收，读者会断档",
      "gate.trendTitle": "门禁趋势",
      "gate.trendMeta": "平均 {avg} · {n} 章有分 · {failed} 章未过线",
      "gate.passMark": "线 {n}",
      "gate.passTip": "点击切换门禁线（78 → 82 → 86 → 90），写进 novel/xiaoyu.json",
      "gate.undo": "撤销",
      "gate.undoTip": "撤销最近一次自动修（逐句改 / 整章改都会先留快照）",
      "gate.undoTitle": "撤销自动修",
      "gate.undoText": "将把本章恢复到上一次自动修之前的原文（快照保留在 novel/.xiaoyu/undo）。",
      "gate.undoDone": "已撤销：人味 {a} → {b}",
      "gate.undoNone": "没有可撤销的记录",
      "reader.copyChapter": "复制全章",
      "reader.copyChapterTip": "复制「章节名 + 正文」，直接粘到别处",
      "reader.copyChapterDone": "已复制章节名+正文",
      "reader.copyChapterEmpty": "这一章还没有正文",
      "reader.copyFailed": "复制失败，请手动选中复制",
    });
    Object.assign(I18N.en, {
      "gate.fixAll": "Fix chapter",
      "gate.fixAllTip": "Apply every conservative sentence fix in this chapter at once, then rescore",
      "gate.fixAllTitle": "Auto-fix chapter",
      "gate.fixAllText": "Up to {n} sentences will be conservatively edited: soft adverbs and vague quantifiers removed, long sentences split, triplets scattered. Wording only — plot and dialogue meaning untouched; the chapter file is overwritten.",
      "gate.fixAllDone": "Fixed {n} spots: human score {a} -> {b}",
      "gate.fixAllNone": "Nothing auto-fixable in this chapter",
      "gate.fixAllEditing": "Cannot auto-fix while editing; save or exit edit first",
      "gate.fixAllBusy": "Fixing…",
      "gate.hookPlain": "Flat ending",
      "gate.hookTip": "Chapter-end hook: {kind}. A flat ending is a hint, not a hard fail",
      "gate.hook.question": "Question",
      "gate.hook.unfinished": "Unfinished",
      "gate.hook.turn": "Turn",
      "gate.hook.short": "Short beat",
      "gate.hook.plain": "Flat",
      "gate.hook.empty": "Empty",
      "overview.todayDelta": "Words today",
      "setup.title": "Book setup checklist",
      "audit.title": "Book audit",
      "audit.run": "Run audit",
      "audit.loading": "Analyzing…",
      "audit.hint": "Cross-chapter repeats, zero-appearance characters, promised names missing from prose, word-count outliers, flat-ending streaks.",
      "audit.clean": "No cross-chapter issues.",
      "audit.export": "Export report",
      "audit.exported": "Report written to novel/{rel}",
      "audit.repeat": "Repeat \"{text}\" in {n} chapters",
      "audit.chars": "Character \"{name}\" has a card but never appears",
      "audit.outline": "Promised in outline but missing from prose: {file} → {names}",
      "audit.outlier": "Word-count outlier: {file} ({n} words)",
      "audit.streak": "{n} flat endings in a row",
      "gate.trendTitle": "Gate trend",
      "gate.trendMeta": "avg {avg} · {n} scored · {failed} below the line",
      "gate.passMark": "Line {n}",
      "gate.passTip": "Click to cycle the pass line (78 → 82 → 86 → 90); stored in novel/xiaoyu.json",
      "gate.undo": "Undo",
      "gate.undoTip": "Undo the last auto-fix (snapshots are written before every fix)",
      "gate.undoTitle": "Undo auto-fix",
      "gate.undoText": "Restore this chapter to the text before the last auto-fix (snapshot kept in novel/.xiaoyu/undo).",
      "gate.undoDone": "Undone: human {a} -> {b}",
      "gate.undoNone": "Nothing to undo",
      "reader.copyChapter": "Copy chapter",
      "reader.copyChapterTip": "Copy chapter title + body as one block",
      "reader.copyChapterDone": "Chapter title and body copied",
      "reader.copyChapterEmpty": "This chapter has no body yet",
      "reader.copyFailed": "Copy failed; select the text manually",
    });

    // 0.6.0 写作台：作战板 / 写作模式 / 版本历史 / 全书搜索 / 命令面板 / 批量。
    Object.assign(I18N.zh, {
      "common.loading": "加载中…",
      "board.title": "作战板", "board.beats": "节拍", "board.foreshadow": "伏笔", "board.chars": "角色", "board.words": "重复词", "board.check": "核对",
      "board.close": "收起作战板", "board.target": "目标 {n} 字", "board.targetLabel": "本章目标字数",
      "board.noOutline": "这一章还没有章纲，节拍 / 角色 / 伏笔清单无从核对。",
      "board.noBeats": "章纲「## 节拍」下还没有条目。", "board.goal": "本章目标",
      "board.noForeshadow": "本章没有要埋 / 要收的伏笔。", "board.plant": "埋", "board.resolve": "收",
      "board.noChars": "章纲没有列出出场角色，正文里也没匹配到角色卡。", "board.voice": "口吻",
      "board.wordsHint": "统计本章重复出现的 2–3 字词。", "board.wordsBtn": "统计重复词",
      "board.wordsEmpty": "重复词不明显（每词少于 3 次）。",
      "board.checkHint": "按章纲节拍核对正文，命中率低于 40% 标黄。", "board.hit": "已落地", "board.miss": "未落地",
      "board.count": "{n} 次", "board.charsIn": "正文 {n} 字",
      "reader.prevChapter": "上一章", "reader.prevTip": "跳到「{name}」", "reader.firstChapter": "已是第一章",
      "reader.pickChapter": "选章", "reader.pickTitle": "跳到章节", "reader.pickFilter": "输入卷号 / 章号 / 标题筛选",
      "reader.focus": "专注", "reader.exitFocus": "退出专注", "reader.board": "作战板",
      "reader.history": "历史", "reader.historyTitle": "正文版本历史",
      "reader.historyEmpty": "还没有历史版本（每次保存前的旧正文会自动留一份）。",
      "reader.historyLoad": "载入编辑器", "reader.historyLoaded": "已载入历史版本，保存后才写盘",
      "reader.historyWords": "{n} 字",
      "reader.recoverTitle": "检测到未保存草稿",
      "reader.recoverText": "{time} 的草稿，{n} 字。恢复还是丢弃？",
      "reader.recoverRestore": "恢复草稿", "reader.recoverDiscard": "丢弃",
      "reader.tts": "朗读", "reader.ttsStop": "停止朗读", "reader.ttsUnsupported": "当前环境不支持朗读",
      "reader.session": "本次 +{n} 字 · {m} 分钟", "reader.advanceNext": "保存并{next}，开下一章", "reader.saveNext": "保存并下一章",
      "search.open": "搜全书", "search.title": "全书搜索", "search.placeholder": "搜章节、章纲……（空格分词取交集）",
      "search.hint": "回车搜索；点结果直达该章。", "search.empty": "没有找到匹配内容。", "search.count": "{n} 条命中",
      "search.chapter": "正文", "search.outline": "章纲", "search.replace": "替换为", "search.replaceBtn": "全部替换",
      "search.replaceConfirm": "将在 {n} 处把「{find}」替换为「{to}」，不可撤销（历史版本可回滚）。继续？",
      "search.replaced": "已替换 {n} 处", "search.preview": "先搜一次再替换", "search.close": "关闭搜索",
      "palette.open": "命令面板", "palette.placeholder": "输入命令：章节名 / 分区 / 动作", "palette.empty": "没有匹配的命令",
      "palette.hint": "↑↓ 选择 · 回车执行 · Esc 关闭", "palette.actionTab": "切到「{tab}」", "palette.actionRefresh": "重新拉取快照",
      "palette.actionSearch": "全书搜索", "palette.actionSettings": "系统设置", "palette.actionChapter": "打开章节：{name}",
      "chapters.selectAll": "全选", "chapters.selected": "已选 {n} 章", "chapters.batchSet": "批量设为",
      "chapters.batchDone": "已更新 {n} 章", "chapters.clearSel": "清空选择", "chapters.exportTxt": "导出 TXT", "chapters.exportDocx": "导出 Word", "chapters.exporting": "正在导出 {n} 章（{fmt}）…",
      "chapters.showAnalysis": "门禁趋势 / 全书体检", "chapters.hideAnalysis": "收起分析",
      "overview.writeStats": "写作数据", "overview.today": "今日 {n} 字", "overview.delta": "较上一记录日 {n}",
      "overview.streak": "最近 7 天", "overview.noProgress": "还没有写作记录。",
    });
    Object.assign(I18N.en, {
      "common.loading": "Loading…",
      "board.title": "Workbench", "board.beats": "Beats", "board.foreshadow": "Foreshadow", "board.chars": "Cast", "board.words": "Repeats", "board.check": "Check",
      "board.close": "Close workbench", "board.target": "Target {n} words", "board.targetLabel": "Chapter word target",
      "board.noOutline": "No outline for this chapter yet — beats, cast and foreshadow cannot be checked.",
      "board.noBeats": "The outline's \"## Beats\" section is empty.", "board.goal": "Chapter goal",
      "board.noForeshadow": "Nothing to plant or resolve in this chapter.", "board.plant": "Plant", "board.resolve": "Resolve",
      "board.noChars": "No cast listed in the outline and no character card matched the prose.", "board.voice": "Voice",
      "board.wordsHint": "Count repeated 2–3 character words in this chapter.", "board.wordsBtn": "Count repeats",
      "board.wordsEmpty": "No word repeats 3+ times.",
      "board.checkHint": "Checks prose against outline beats; under 40% coverage is highlighted.", "board.hit": "Covered", "board.miss": "Missing",
      "board.count": "{n}×", "board.charsIn": "{n} chars of prose",
      "reader.prevChapter": "Previous", "reader.prevTip": "Go to “{name}”", "reader.firstChapter": "This is the first chapter",
      "reader.pickChapter": "Chapters", "reader.pickTitle": "Jump to chapter", "reader.pickFilter": "Filter by volume / number / title",
      "reader.focus": "Focus", "reader.exitFocus": "Exit focus", "reader.board": "Workbench",
      "reader.history": "History", "reader.historyTitle": "Chapter text history",
      "reader.historyEmpty": "No versions yet (the previous text is snapshotted before each save).",
      "reader.historyLoad": "Load into editor", "reader.historyLoaded": "Old version loaded — save to write it back",
      "reader.historyWords": "{n} words",
      "reader.recoverTitle": "Unsaved draft found",
      "reader.recoverText": "Draft from {time}, {n} words. Restore or discard?",
      "reader.recoverRestore": "Restore draft", "reader.recoverDiscard": "Discard",
      "reader.tts": "Read aloud", "reader.ttsStop": "Stop reading", "reader.ttsUnsupported": "Speech is unavailable here",
      "reader.session": "This session +{n} words · {m} min", "reader.advanceNext": "Save & {next}, then next", "reader.saveNext": "Save & next",
      "search.open": "Search book", "search.title": "Search the book", "search.placeholder": "Search chapters and outlines (space-separated terms)",
      "search.hint": "Enter to search; click a hit to open that chapter.", "search.empty": "No matches.", "search.count": "{n} hits",
      "search.chapter": "Text", "search.outline": "Outline", "search.replace": "Replace with", "search.replaceBtn": "Replace all",
      "search.replaceConfirm": "Replace “{find}” with “{to}” in {n} place(s)? This cannot be undone directly (history can roll back).",
      "search.replaced": "Replaced {n} place(s)", "search.preview": "Run a search first", "search.close": "Close search",
      "palette.open": "Command palette", "palette.placeholder": "Type a chapter name, tab or action", "palette.empty": "No matching command",
      "palette.hint": "↑↓ select · Enter run · Esc close", "palette.actionTab": "Go to “{tab}”", "palette.actionRefresh": "Refresh snapshot",
      "palette.actionSearch": "Search the book", "palette.actionSettings": "Settings", "palette.actionChapter": "Open chapter: {name}",
      "chapters.selectAll": "Select all", "chapters.selected": "{n} selected", "chapters.batchSet": "Set status to",
      "chapters.batchDone": "Updated {n} chapter(s)", "chapters.clearSel": "Clear selection", "chapters.exportTxt": "Export TXT", "chapters.exportDocx": "Export Word", "chapters.exporting": "Exporting {n} chapter(s) as {fmt}…",
      "chapters.showAnalysis": "Gate trend / full-book audit", "chapters.hideAnalysis": "Hide analysis",
      "overview.writeStats": "Writing stats", "overview.today": "{n} words today", "overview.delta": "{n} vs previous record",
      "overview.streak": "Last 7 days", "overview.noProgress": "No writing records yet.",
    });
    // 0.15.0 工具弹层（回收站 / 整本导出 / 账本瘦身）
    Object.assign(I18N.zh, {
      "tools.open": "工具", "tools.tip": "回收站 / 整本导出 / 账本瘦身",
      "tools.title": "工具", "tools.tabTrash": "回收站", "tools.tabExport": "整本导出", "tools.tabSlim": "账本瘦身",
      "tools.trashHint": "删除的文件先进这里，随时可以恢复；超过 200 条自动清最旧的。",
      "tools.trashEmpty": "回收站是空的。", "tools.trashFail": "回收站读取失败",
      "tools.restore": "恢复", "tools.purge": "彻底删除", "tools.restored": "已恢复：{rel}",
      "tools.purged": "已彻底删除", "tools.trashPurgeConfirm": "彻底删除「{rel}」？此操作不可恢复。",
      "tools.exportHint": "全书 {n} 章按顺序排版导出（与勾选导出同一套排版）。",
      "tools.exportNote": "EPUB 直接进手机阅读器；Word 便于投稿；TXT 最通用。",
      "tools.exporting": "正在导出全本（{fmt}）…",
      "tools.slimHint": "把「卷号早于指定卷」的账本条目折进 archive/，主账只留近期。写前自动 .bak，主账会被搬空时整条跳过。",
      "tools.slimBeforePh": "如 v02", "tools.slimPlan": "载入计划",
      "tools.slimNothing": "这一卷之前没有可归档的条目。", "tools.slimNeedVolume": "先填卷号（v02 或 2）",
      "tools.slimFail": "瘦身失败", "tools.slimRow": "搬 {move} 条 · 留 {keep} 条",
      "tools.slimBlocked": "跳过（会搬空主账）", "tools.slimBlockedNote": "有账本会被搬空，这几本不会动——等写完当前卷再归档。",
      "tools.slimApply": "执行归档（{n} 条）", "tools.slimConfirm": "把 {vol} 之前的 {n} 条账目搬进 archive/？写前会留 .bak。",
      "tools.slimDone": "已归档 {n} 条",
      "relations.castOn": "本章出场 {n} 人", "relations.castTip": "已按当前章节过滤：只有本章正文里出现过的角色才上图；选「全部章节」看全书关系网（关系清单始终是完整的）。",
      "relations.strongOnly": "只看主线", "relations.strongOnlyTip": "只画强度 ≥3 的关系：角色一多，弱关系会把图糊成一团；关掉后全部回来。",
      "overview.ledgers": "账本体积", "overview.ledgerTotal": "合计 {kb} KB",
      "overview.ledgerSlim": "去瘦身", "overview.ledgerMeta": "{kb} KB · {n} 条",
      "overview.ledgerLong": "{n} 条超长",
      "reader.ledgerMissing": "本章还没记进 {list}——账本不更新，下一章写手就缺前提。",
      "reader.ledgerDismiss": "知道了",
    });
    Object.assign(I18N.en, {
      "tools.open": "Tools", "tools.tip": "Trash / export the book / slim the ledgers",
      "tools.title": "Tools", "tools.tabTrash": "Trash", "tools.tabExport": "Export book", "tools.tabSlim": "Slim ledgers",
      "tools.trashHint": "Deleted files land here first and can be restored anytime. Capped at 200 items, oldest pruned first.",
      "tools.trashEmpty": "Trash is empty.", "tools.trashFail": "Could not read the trash",
      "tools.restore": "Restore", "tools.purge": "Delete forever", "tools.restored": "Restored: {rel}",
      "tools.purged": "Deleted permanently", "tools.trashPurgeConfirm": "Delete “{rel}” permanently? This cannot be undone.",
      "tools.exportHint": "Export all {n} chapters in order (same layout as the selection export).",
      "tools.exportNote": "EPUB for phone readers, Word for submissions, TXT for everything else.",
      "tools.exporting": "Exporting the whole book ({fmt})…",
      "tools.slimHint": "Move ledger entries older than the given volume into archive/. A .bak is written first; ledgers that would be emptied are skipped.",
      "tools.slimBeforePh": "e.g. v02", "tools.slimPlan": "Load plan",
      "tools.slimNothing": "Nothing to archive before this volume.", "tools.slimNeedVolume": "Enter a volume first (v02 or 2)",
      "tools.slimFail": "Slim failed", "tools.slimRow": "move {move} · keep {keep}",
      "tools.slimBlocked": "skipped (would empty the ledger)", "tools.slimBlockedNote": "Some ledgers would be emptied and will be left alone — archive again after the current volume is written.",
      "tools.slimApply": "Archive {n} entries", "tools.slimConfirm": "Move {n} entries older than {vol} into archive/? A .bak is kept.",
      "tools.slimDone": "Archived {n} entries",
      "relations.castOn": "{n} on stage this chapter", "relations.castTip": "Filtered by the selected chapter: only characters whose names appear in this chapter's prose are drawn. Choose “All chapters” for the full network (the list below always shows every relation).",
      "relations.strongOnly": "Main lines only", "relations.strongOnlyTip": "Draw only relations with intensity ≥3: with a big cast the weak links turn the graph into mush. Turn off to see everything.",
      "overview.ledgers": "Ledger size", "overview.ledgerTotal": "{kb} KB total",
      "overview.ledgerSlim": "Slim", "overview.ledgerMeta": "{kb} KB · {n} entries",
      "overview.ledgerLong": "{n} overlong",
      "reader.ledgerMissing": "This chapter is not recorded in {list} yet — the writer will be missing context for the next chapter.",
      "reader.ledgerDismiss": "Got it",
    });
    function tt(key) {
      var d = I18N[UI_LANG] || I18N.zh;
      var v = d[key];
      if (v === undefined) v = I18N.zh[key];
      return v === undefined ? key : v;
    }
    function tf(key, vars) {
      var s = tt(key);
      if (vars) for (var k in vars) s = s.split("{" + k + "}").join(String(vars[k]));
      return s;
    }
    function SettingsModal(props) {
      var scale = props.scale;
      var onPick = props.onPick;
      var lang = props.lang;
      var onPickLang = props.onPickLang;
      var mode = props.mode;
      var onPickMode = props.onPickMode;
      var sbProbe = typeof props.sbProbe === "function" ? props.sbProbe : function () { return !!props.sbReady; };
      var onClose = props.onClose;
      return h(MaskPortal, {
        className: "myt-settingsMask",
        onMouseDown: function (e) { if (e.target === e.currentTarget) onClose(); },
      },
        h("div", { className: "myt-settings", role: "dialog", "aria-modal": "true", "aria-label": tt("settings.title") },
          h("div", { className: "myt-settingsHead" },
            h("h3", { className: "myt-settingsTitle" }, tt("settings.title")),
            h("button", { type: "button", className: "myt-closeBtn", "aria-label": tt("settings.closeAria"), onClick: onClose }, h("span", { className: "myt-closeGlyph", "aria-hidden": "true" }, "×"))),
          h("div", { className: "myt-settingsBody" },
            h("div", { className: "myt-settingsLabel" }, tt("settings.language")),
            h("div", { className: "myt-setRow" }, UI_LANGS.map(function (o) {
              return h("button", {
                key: o[0], type: "button", className: "myt-setOpt", "data-active": lang === o[0] ? "true" : undefined,
                onClick: function () { onPickLang(o[0]); },
              }, o[1]);
            })),
            h("div", { className: "myt-settingsHint" }, tt("settings.languageHint")),
            h("div", { className: "myt-settingsLabel" }, tt("settings.fontScale")),
            h("div", { className: "myt-setRow" }, FONT_SCALES.map(function (o) {
              return h("button", {
                key: o[0], type: "button", className: "myt-setOpt", "data-active": scale === o[0] ? "true" : undefined,
                onClick: function () { onPick(o[0]); },
              }, o[1]);
            })),
            h("div", { className: "myt-settingsHint" }, tt("settings.fontScaleHint")),
            // 打开形态三选一：宿主缺右侧栏服务时右栏两项置灰（title 说明原因）。
            h("div", { className: "myt-settingsLabel" }, tt("settings.openMode")),
            h("div", { className: "myt-setRow" }, OPEN_MODES.map(function (o) {
              var locked = !sbProbe() && o[0] !== "middle"; // 弹层每次开/渲染都现探，服务晚到自动解锁
              return h("button", {
                key: o[0], type: "button", className: "myt-setOpt", disabled: locked,
                "data-active": mode === o[0] ? "true" : undefined,
                title: locked ? tt("settings.openModeUnsupported") : undefined,
                onClick: function () { onPickMode(o[0]); },
              }, tt(o[1]));
            })),
            h("div", { className: "myt-settingsHint" }, tt("settings.openModeHint")))));
    }

    // ── 章节阅读页（整页视图，替代右侧抽屉）：返回按钮 + 章纲对照 + 正文 +
    // 五维 + 状态流转。原抽屉是 position:fixed 侧弹层，在桌面端会被侧边栏
    // 遮挡；整页视图天然在面板文档流内，无遮挡问题。0.1.19 起正文/章纲可在
    // 本页编辑保存；0.1.22 起正文改自动保存（回车自动段首缩进 + 空章节/写作中
    // 直开编辑态；0.5.1 起停手 1.5s 落盘、连续打字每 6s 强制一次，另接
    // Ctrl/⌘+S、失焦/切后台、卸载急救），章纲仍手动保存；409 保护链路照 StyleTab。──
    // 下一章（0.4.6）：按章节号升序（同号按文件名）排在当前章后面那条。
    // 章节表/快照本身按 index.yml 的写入序，这里显式排序——排序口径与「最近更新」
    // 那处（num 降序）同源，避免作者手改 index 顺序后「下一章」跳错。
    // ── 写作台 2.0 辅助（0.6.0）：章纲解析 / 节拍核对 / 重复词 ─────────────
    // 章纲是纯 markdown：按 "## 标题" 切节，节拍/出场角色/本章目标各取一节；
    // 找不到对应节时退化为全文扫描，坏章纲也不至于把面板打崩。
    function outlineSections(md) {
      var lines = String(md || "").split(/\r?\n/);
      var out = [];
      var cur = null;
      for (var i = 0; i < lines.length; i++) {
        var m = /^##\s+(.+?)\s*$/.exec(lines[i]);
        if (m) { cur = { title: m[1], lines: [] }; out.push(cur); continue; }
        if (cur) cur.lines.push(lines[i]);
      }
      return out;
    }
    function outlineSection(md, keys) {
      var secs = outlineSections(md);
      for (var i = 0; i < secs.length; i++) {
        for (var j = 0; j < keys.length; j++) {
          if (secs[i].title.indexOf(keys[j]) !== -1) return secs[i];
        }
      }
      return null;
    }
    function outlineBeats(md) {
      var sec = outlineSection(md, ["节拍", "场景", "Beat", "beat"]);
      var src = sec ? sec.lines : String(md || "").split(/\r?\n/);
      var out = [];
      for (var i = 0; i < src.length; i++) {
        var m = /^\s*(?:[-*+]|\d+[.、)])\s+(.+?)\s*$/.exec(src[i]);
        if (!m) continue;
        var text = m[1].replace(/[*_]/g, "").trim();
        if (text !== "") out.push(text);
      }
      return out.slice(0, 24);
    }
    function outlineCharacters(md) {
      var sec = outlineSection(md, ["出场角色", "人物", "角色"]);
      if (!sec) return [];
      var text = sec.lines.join(" ");
      var parts = text.split(/[、，,；;\/|·\s]+/);
      var out = [];
      for (var i = 0; i < parts.length; i++) {
        var s = parts[i].replace(/^[-*+]\s*/, "").replace(/[（(].*?[）)]/g, "").trim();
        if (s.length >= 1 && s.length <= 12 && out.indexOf(s) === -1) out.push(s);
      }
      return out.slice(0, 12);
    }
    function outlineGoal(md) {
      var sec = outlineSection(md, ["本章目标", "目标", "Goal"]);
      if (!sec) return "";
      for (var i = 0; i < sec.lines.length; i++) {
        var s = sec.lines[i].replace(/^\s*(?:[-*+]|\d+[.、)])\s*/, "").trim();
        if (s !== "") return s.slice(0, 80);
      }
      return "";
    }
    var BEAT_STOP = { "的了": 1, "是在": 1, "和与": 1, "就都": 1, "而及": 1, "着过": 1, "也很": 1, "没有": 1, "他们": 1, "我们": 1, "你们": 1, "这个": 1, "那个": 1, "一个": 1, "不是": 1, "可以": 1, "自己": 1 };
    function beatCoverage(beat, body) {
      var text = String(body || "");
      var runs = String(beat || "").match(/[\u4e00-\u9fffA-Za-z0-9]{2,}/g) || [];
      var seen = {};
      var total = 0, hit = 0;
      for (var r = 0; r < runs.length; r++) {
        var s = runs[r];
        for (var i = 0; i + 2 <= s.length; i++) {
          var g = s.slice(i, i + 2);
          if (BEAT_STOP[g] || seen[g]) continue;
          seen[g] = 1; total++;
          if (text.indexOf(g) !== -1) hit++;
        }
      }
      return total === 0 ? 0 : hit / total;
    }
    function countCjkText(text) {
      var m = String(text || "").match(/[\u4e00-\u9fff\u3400-\u4dbf]/gu);
      return m ? m.length : 0;
    }
    function topRepeatedWords(text, n) {
      var clean = String(text || "").replace(/[^\u4e00-\u9fff]/g, " ");
      var segs = clean.split(/\s+/);
      var counts = {};
      for (var s = 0; s < segs.length; s++) {
        var seg = segs[s];
        for (var L = 2; L <= 3; L++) {
          for (var i = 0; i + L <= seg.length; i++) {
            var w = seg.slice(i, i + L);
            if (BEAT_STOP[w]) continue;
            counts[w] = (counts[w] || 0) + 1;
          }
        }
      }
      var rows = [];
      for (var k in counts) {
        if (!Object.prototype.hasOwnProperty.call(counts, k)) continue;
        if (counts[k] < 3) continue;
        rows.push([k, counts[k]]);
      }
      rows.sort(function (a, b) { return b[1] - a[1] || b[0].length - a[0].length; });
      return rows.slice(0, n || 18);
    }
    function prevChapterOf(chapters, file) {
      var sorted = (chapters || []).slice().sort(function (a, b) {
        var na = typeof a.num === "number" ? a.num : 0;
        var nb = typeof b.num === "number" ? b.num : 0;
        return na !== nb ? na - nb : String(a.file || "").localeCompare(String(b.file || ""));
      });
      for (var i = 0; i < sorted.length; i++) {
        if (sorted[i].file === file) return i > 0 ? sorted[i - 1] : null;
      }
      return null;
    }
    function fmtDurationMin(startMs) {
      if (!startMs) return 0;
      return Math.max(1, Math.round((Date.now() - startMs) / 60000));
    }

    function nextChapterOf(chapters, file) {
      var sorted = (chapters || []).slice().sort(function (a, b) {
        var na = typeof a.num === "number" ? a.num : 0;
        var nb = typeof b.num === "number" ? b.num : 0;
        return na !== nb ? na - nb : String(a.file || "").localeCompare(String(b.file || ""));
      });
      for (var i = 0; i < sorted.length; i++) {
        if (sorted[i].file === file) return sorted[i + 1] || null;
      }
      return null;
    }

    function ChapterReader(props) {
      var file = props.file;
      var wsPath = props.wsPath;
      var snap = props.snap;
      var reload = props.reload;
      var reopenSeq = props.refreshSeq || 0; // 面板重开序号（PageShell 广播自增）
      var onBack = props.onBack;
      var _d = useState(null), detail = _d[0], setDetail = _d[1]; // {loading, data, err}
      var _b = useState(false), flowBusy = _b[0], setFlowBusy = _b[1];
      // 编辑态：draft 是受控草稿，只在进入编辑与切章时初始化——重渲染与
      // detail 重拉都不碰它，否则打字会被中途清掉。olDraft 同构管章纲对照栏。
      var _ed = useState(false), editing = _ed[0], setEditing = _ed[1];
      var _dr = useState(""), draft = _dr[0], setDraft = _dr[1];
      var _oe = useState(false), olEditing = _oe[0], setOlEditing = _oe[1];
      var _odr = useState(""), olDraft = _odr[0], setOlDraft = _odr[1];
      var _bb = useState(false), bodyBusy = _bb[0], setBodyBusy = _bb[1];
      var _ob = useState(false), olBusy = _ob[0], setOlBusy = _ob[1];
      var _be = useState(""), bodyErr = _be[0], setBodyErr = _be[1];
      var _oerr = useState(""), olErr = _oerr[0], setOlErr = _oerr[1];
      // 409 冲突态：true 时编辑区亮出「载入磁盘版 / 基于最新版重改」两个出口，
      // 草稿绝不丢（见 saveBody/saveOutline 的 catch）。
      var _bc = useState(false), bodyConflict = _bc[0], setBodyConflict = _bc[1];
      var _oc = useState(false), olConflict = _oc[0], setOlConflict = _oc[1];
      // 正文自动保存（0.1.22 引入；0.1.23 起手动保存同样写入时刻）：最近一次
      // 保存成功的时刻（HH:MM:SS），缀在编辑 hint 后；切章时清零。
      var _as = useState(""), autoSavedAt = _as[0], setAutoSavedAt = _as[1];
      // 记账提示（0.15.0）：保存响应里带 ledger（本章在 memories / timeline /
      // clue-board 里有没有条目）。只提示不拦保存——记账是纪律，不是写盘条件。
      var _lh = useState(null), ledgerHint = _lh[0], setLedgerHint = _lh[1];
      // 章节标题编辑（0.1.25）：编辑器顶部输入框的草稿与进入编辑态时的基线——
      // 与正文一次原子保存（chapter-save 的可选 title），不做独立保存链。
      var _td = useState(""), titleDraft = _td[0], setTitleDraft = _td[1];
      // 本章门禁分：进阅读页拉一次（服务端按 mtime 缓存），切章/重开重拉；
      // python3 缺席时 gate=null，不渲染徽标。
      var _gate = useState(null), gate = _gate[0], setGate = _gate[1];
      // 整章一键保守修（0.3.1）：草稿不动磁盘，直接对章节文件做批量手术，
      // 弹层二次确认（会覆盖原文），改完重拉正文与门禁分。
      var _fa = useState(false), fixAllOpen = _fa[0], setFixAllOpen = _fa[1];
      var _ho = useState(false), handoffOpen = _ho[0], setHandoffOpen = _ho[1];
      var _sv = useState(false), splitView = _sv[0], setSplitView = _sv[1];
      var _fab = useState(false), fixAllBusy = _fab[0], setFixAllBusy = _fab[1];
      // 撤销自动修（0.4.0）：服务端每次自动改写前留快照，这里只负责确认与重拉。
      var _uo = useState(false), undoOpen = _uo[0], setUndoOpen = _uo[1];
      // ── 写作台 2.0（0.6.0）：作战板 / 专注 / 计时 / 草稿恢复 / 版本 / 选章 ──
      var _bo = useState(false), boardOpen = _bo[0], setBoardOpen = _bo[1];
      var _bt = useState("beats"), boardTab = _bt[0], setBoardTab = _bt[1];
      var _fo = useState(false), focusOn = _fo[0], setFocusOn = _fo[1];
      var _tk = useState(0), tick = _tk[0], setTick = _tk[1];
      var _ss = useState(0), sessionStart = _ss[0], setSessionStart = _ss[1];
      var sessionBaseRef = useRef(0);
      var _rcv = useState(null), recovery = _rcv[0], setRecovery = _rcv[1];
      var recTimerRef = useRef(null);
      var autoHoldRef = useRef(false); // 版本载入后暂停自动保存，等用户手动保存或开始打字
      var _bd = useState([]), beatsDone = _bd[0], setBeatsDone = _bd[1];
      var _tg = useState(function () {
        var v = parseInt(lsGet("myt-chapter-target") || "", 10);
        return v >= 300 && v <= 20000 ? v : 3000;
      }), targetWords = _tg[0], setTargetWords = _tg[1];
      var _rp = useState(null), repeats = _rp[0], setRepeats = _rp[1];
      var _vo = useState(false), versionsOpen = _vo[0], setVersionsOpen = _vo[1];
      var _vl = useState(null), versionList = _vl[0], setVersionList = _vl[1];
      var _vv = useState(null), versionView = _vv[0], setVersionView = _vv[1];
      var _vb = useState(false), versionsBusy = _vb[0], setVersionsBusy = _vb[1];
      var _pk = useState(false), pickerOpen = _pk[0], setPickerOpen = _pk[1];
      var _pks = useState(""), pickerQuery = _pks[0], setPickerQuery = _pks[1];
      var _sp = useState(false), speaking = _sp[0], setSpeaking = _sp[1];
      var touchRef = useRef(null);
      useEffect(function () {
        var alive = true;
        setGate(null);
        if (!wsPath || !file) return function () { alive = false; };
        apiGet("gate", { path: wsPath, file: file }, { silent: true }).then(function (d) {
          if (alive) setGate(d && d.ok ? d : null);
        }).catch(function () { if (alive) setGate(null); });
        return function () { alive = false; };
      }, [wsPath, file, reopenSeq]);
      function copyPolishBrief() {
        var brief = tf("gate.brief", { file: file });
        copyText(brief).then(function () { toast.ok(tt("gate.copied")); }, function () { toast.err(tt("gate.copyFailed")); });
      }
      function applyFix(sentence) {
        if (editing) { toast.warn(tt("gate.fixEditing")); return; }
        xiaoyuApi("gate-fix", { path: wsPath, file: file, sentence: sentence }).then(function (d) {
          toast.ok(tf("gate.fixed", { n: (d && d.ops ? d.ops.length : 0), h: Math.round(d && d.human ? d.human : 0) }));
          loadDetail(file, { silent: true });
          apiGet("gate", { path: wsPath, file: file }, { silent: true }).then(function (g) { if (g && g.ok) setGate(g); });
          if (reload) reload();
        }).catch(function (err) {
          toast.err(tf("toast.prefix", { msg: err.message }));
        });
      }
      function applyFixAll() {
        if (editing) { toast.warn(tt("gate.fixAllEditing")); return; }
        setFixAllOpen(true);
      }
      function runFixAll() {
        setFixAllBusy(true);
        return xiaoyuApi("gate-fix-all", { path: wsPath, file: file }).then(function (d) {
          if (!d || d.ok === false) throw new Error((d && d.error) || "fix-all failed");
          if (!d.count) { toast.warn(tt("gate.fixAllNone")); return; }
          toast.ok(tf("gate.fixAllDone", { n: d.count, a: Math.round(d.before.h), b: Math.round(d.after.h) }));
          loadDetail(file, { silent: true });
          return apiGet("gate", { path: wsPath, file: file }, { silent: true }).then(function (g) {
            if (g && g.ok) setGate(g);
            if (reload) reload();
          });
        }).catch(function (err) {
          toast.err(tf("toast.prefix", { msg: err.message }));
        }).finally(function () { setFixAllBusy(false); setFixAllOpen(false); });
      }
      // 复制「章节名 + 正文」：编辑态取草稿，只读态取磁盘正文；空章给提示。
      function copyChapterAll() {
        var data = detail && detail.data;
        var body = editing ? draft : (data && typeof data.body === "string" ? data.body : "");
        if (String(body).trim() === "") { toast.warn(tt("reader.copyChapterEmpty")); return; }
        var name = ch ? chFullTitle(ch) : file;
        copyText(name + "\n\n" + body).then(function () { toast.ok(tt("reader.copyChapterDone")); }, function () { toast.err(tt("reader.copyFailed")); });
      }
      // 撤销最近一次自动修：恢复服务端快照（.xiaoyu/undo），重拉正文与门禁。
      function runUndo() {
        return xiaoyuApi("gate-undo", { path: wsPath, file: file }).then(function (d) {
          if (!d || d.ok === false) throw new Error((d && d.error) || "undo failed");
          toast.ok(tf("gate.undoDone", { a: Math.round(gate && gate.human ? gate.human : 0), b: Math.round(d.human) }));
          loadDetail(file, { silent: true });
          return apiGet("gate", { path: wsPath, file: file }, { silent: true }).then(function (g) {
            if (g && g.ok) setGate(g);
            if (reload) reload();
          });
        }).catch(function (err) {
          toast.err(tf("toast.prefix", { msg: err.message }));
        }).finally(function () { setUndoOpen(false); });
      }
      var detailSeqRef = useRef(0); // chapter 请求序号：快速切章时丢弃过期响应
      // 409 后的一次性重置标记：loadDetail 带回磁盘真值时把草稿放回最新内容
      // （只在保存冲突「放弃草稿」出口置位；顶栏刷新、状态流转等其他重拉不动
      // 正在编辑的草稿）。
      var bodyResetRef = useRef(false);
      var olResetRef = useRef(false);
      // 进入编辑态时的原文基线：草稿 ≠ 基线即脏，供取消/返回的退出确认。
      var bodyBaseRef = useRef("");
      var olBaseRef = useRef("");
      // 进入编辑态时的标题基线（0.1.25）：titleDraft ≠ 基线即标题脏。
      var titleBaseRef = useRef("");
      // 当前选中章的实时值：在途保存/流转/建章回调用它比对闭包里的旧 file，
      // 不一致则跳过 UI 状态回填，防旧章数据覆写新章视图（B 标题+A正文）。
      var fileRef = useRef(file);
      fileRef.current = file;
      // editing 实时值：loadDetail 是 useCallback 闭包，直接读 editing state 是
      // 过期值——空章节/写作中直开编辑态的守卫必须走 ref。
      var editingRef = useRef(false);
      editingRef.current = editing;
      // 自动保存/快捷键/卸载急救共用的实时值（0.5.1）：定时器与事件监听的闭包
      // 会过期，统一走 ref 读最新草稿与忙态，避免把旧文写盘或漏存。
      var draftRef = useRef("");
      draftRef.current = draft;
      var titleRef = useRef("");
      titleRef.current = titleDraft;
      var conflictRef = useRef(false);
      conflictRef.current = bodyConflict;
      var busyRef = useRef(false);
      busyRef.current = bodyBusy;
      var saveRef = useRef(null);
      var detailRef = useRef(null);
      detailRef.current = detail;
      var wsRef = useRef(wsPath);
      wsRef.current = wsPath;
      // 本轮脏起点（ms，0 = 干净）：连续不停手打字时用它算「最多 6s 强制落盘」，
      // 纯防抖会让写两小时一次都没存。
      var dirtySinceRef = useRef(0);
      // 连续保存失败次数：网络断了不能每 1.5s 重试刷屏/刷接口，按 3/6/12/24/30s
      // 退避；一次成功即清零（0.5.1）。
      var failCountRef = useRef(0);
      // 保存后的整份快照重拉合并器（0.5.1）：自动保存变密后，每存一次都全量
      // reload 会把整本书重扫一遍；合并到停手 1.2s 后拉一次，字数照旧会更新。
      var reloadTimerRef = useRef(null);
      // 空章节/写作中直开去重：记本次访问已自动进入过编辑态的 file，同章不反复
      // 打扰（手动取消退出后不再自动重进）；切章清空，切走再切回可再次进入。
      var autoEditRef = useRef("");
      // 回车缩进的光标恢复：setDraft 提交换行+缩进后 DOM 未更新，下一轮渲染
      // （draft 已就位）再把光标挪到插入的缩进之后；areaRef 指向正文 textarea。
      var pendingCaretRef = useRef(null);
      var areaRef = useRef(null);
      // 行号栏（0.1.26）：gutterNumsRef 是滚动 transform 的平移层，mirrorRef 是
      // 软换行镜像——每个逻辑行一个子 div，offsetTop 即行号该落的视觉位置。
      var gutterNumsRef = useRef(null);
      var mirrorRef = useRef(null);
      var _lt = useState([]), lineTops = _lt[0], setLineTops = _lt[1];
      // 编辑器字体清单：id 唯一；字体名是专有名词、两种界面语言共用不进 I18N
      // 词典（ui 档的下拉文案走 reader.fontDefault）；stack 空串 = 系统默认
      // （不下发 fontFamily，走 CSS inherit），也是读值越枚举时的回落项。霞鹜
      // 文楷本机未安装时沿字体栈逐级回落（同栈前款 → Noto Serif CJK SC → serif）。
      // 阅读（只读正文 pre）与书写（编辑器 textarea/镜像）共用同一份选择，
      // stack 由 editFontStack 单源派发（见 fsButtons 与各 inline style）。
      var EDIT_FONTS = [
        { id: "ui", label: "系统默认", stack: "" },
        { id: "hei", label: "黑体", stack: "-apple-system, \"PingFang SC\", \"Microsoft YaHei\", \"Noto Sans CJK SC\", sans-serif" },
        { id: "song", label: "宋体", stack: "\"Songti SC\", \"STSong\", \"SimSun\", \"Noto Serif CJK SC\", serif" },
        { id: "kai", label: "楷体", stack: "\"Kaiti SC\", \"STKaiti\", \"KaiTi\", \"Noto Serif CJK SC\", serif" },
        { id: "fs", label: "仿宋", stack: "\"STFangsong\", \"FangSong\", \"Noto Serif CJK SC\", serif" },
        { id: "lxgw", label: "霞鹜文楷", stack: "\"LXGW WenKai Screen\", \"LXGW WenKai\", \"Noto Serif CJK SC\", serif" },
      ];
      // 编辑器字号（0.1.26）：px 绝对档位 ±2、钳 9–27，localStorage 全局记忆
      // （跨章共享一份，键 myt-edit-fs）；行高与 gutter 数字字号在渲染体按比例
      // 派生（editLh/editGutterFs 单源），textarea 与镜像同值才不错行号。
      var _efs = useState(function () {
        var v = 0;
        try { v = parseInt(localStorage.getItem("myt-edit-fs"), 10); } catch (err) {}
        return v >= 9 && v <= 27 ? v : 13;
      }), editFs = _efs[0], setEditFs = _efs[1];
      // 编辑器字体（未发版）：下拉全局记忆一份（跨章共享，键 myt-edit-font，
      // 与字号档位 myt-edit-fs 同款模式）；读值不在 EDIT_FONTS 清单回落 "ui"，
      // 写经 lsSet 兜 try/catch（隐私模式只本会话生效不炸）。
      var _efont = useState(function () {
        var v = lsGet("myt-edit-font");
        for (var fi = 0; fi < EDIT_FONTS.length; fi++) { if (EDIT_FONTS[fi].id === v) return v; }
        return "ui";
      }), editFont = _efont[0], setEditFont = _efont[1];
      function pickEditFont(id) {
        setEditFont(id);
        lsSet("myt-edit-font", id);
      }
      function bumpEditFs(d) {
        setEditFs(function (prev) {
          var next = Math.min(27, Math.max(9, prev + d));
          if (next !== prev) { try { localStorage.setItem("myt-edit-fs", String(next)); } catch (err) {} }
          return next;
        });
      }
      // 全屏编辑（0.1.26）：纯视觉层——编辑卡整体搬进 MaskPortal 覆盖层（portal
      // 进实例根，老宿主无 createPortal 时原地渲染兜底），不动编辑态/保存链/
      // 脏检查任何语义；不走 Fullscreen API（宿主 webview 里 fixed/absolute 覆盖
      // 层更稳，关系图的 canvas 全屏是特例）。
      var _ff = useState(false), fsFull = _ff[0], setFsFull = _ff[1];
      // 0.1.20 写面：新建章纲（无章纲态）/ 删除章节 / 删除章纲（各带确认弹层）。
      var stem = file.replace(/\.md$/i, "");
      var stemOk = /^v\d+-c\d+$/.test(stem); // 章纲 rel 挂钩 vXX-cXXX stem，不合规范不亮按钮
      var _co = useState(false), coBusy = _co[0], setCoBusy = _co[1];
      var _dc = useState(false), delChapterOpen = _dc[0], setDelChapterOpen = _dc[1];
      var _do = useState(false), delOutlineOpen = _do[0], setDelOutlineOpen = _do[1];
      function createOutline() {
        if (coBusy || !stemOk) return;
        setCoBusy(true);
        // 骨架照 spec 六件章纲的其中五件预填（章尾钩子独立成节，留给写的人
        // 展开成 `## 钩子`）；服务端只验形状，成败提示走 toast 通道。
        apiPost("file-create", { path: wsPath, rel: "outlines/" + stem + ".md", text: outlineTemplateOf(ch, stem) })
          .then(function () { return reload().then(function () {
            // 时序守卫：建章期间切了章——快照照刷，旧章详情不回填新章视图。
            if (fileRef.current === file) return loadDetail(file);
          }); })
          .catch(function () {}).finally(function () { setCoBusy(false); });
      }
      var loadDetail = useCallback(function (f, opts) {
        var seq = ++detailSeqRef.current;
        if (!f) { setDetail(null); return; }
        // silent：不闪骨架的原地刷新（章纲保存后对齐字数 chip 用），草稿不受影响
        if (!(opts && opts.silent)) setDetail({ loading: true, data: null, err: "" });
        apiGet("chapter", { path: wsPath, file: f }).then(function (d) {
          if (seq !== detailSeqRef.current) return; // 过期响应：已在看另一章，丢弃
          setDetail({ loading: false, data: d, err: "" });
          if (bodyResetRef.current) {
            bodyResetRef.current = false;
            var body0 = d && typeof d.body === "string" ? d.body : "";
            bodyBaseRef.current = body0; // 放回的磁盘真值即新基线（脏检查归零）
            setDraft(body0);
          }
          if (olResetRef.current) {
            olResetRef.current = false;
            var ol0 = d && d.outline && typeof d.outline.body === "string" ? d.outline.body : "";
            olBaseRef.current = ol0;
            setOlDraft(ol0);
          }
          // 崩溃草稿恢复（0.6.0）：本地草稿与磁盘不一致时先亮恢复条，不自动
          // 进编辑；用户选恢复才把草稿放回编辑器（基线仍是磁盘正文）。
          var hasRecovery = false;
          try {
            var recRaw = editingRef.current ? null : localStorage.getItem("myt-recover:" + wsPath + "|" + f);
            if (recRaw) {
              var recOne = JSON.parse(recRaw);
              if (recOne && typeof recOne.body === "string" && recOne.body !== d.body && recOne.body.trim() !== "") {
                setRecovery(recOne); hasRecovery = true;
              } else {
                localStorage.removeItem("myt-recover:" + wsPath + "|" + f);
                setRecovery(null);
              }
            } else {
              setRecovery(null);
            }
          } catch (err) { setRecovery(null); }
          // 空章节/写作中直开编辑态（0.1.22 空章节、0.1.25 扩到写作中）：
          // 正文待写（body 全空白）或 frontmatter.status === "writing" 的章打开
          // 即进编辑，不再经顶部「编辑」按钮中转。三重守卫缺一不可——正在编辑
          // 绝不打扰（409 放弃草稿等编辑中重拉天然被排除）、同章本轮只自动进
          // 一次、其余章节照常走「编辑」按钮。状态读 GET 出参 d.frontmatter，
          // 不用渲染体的 ch——loadDetail 是 useCallback 闭包，ch 是过期值。
          // 空正文预填两个全角空格让首段也有段首缩进（基线与预填同值：不判脏、
          // 纯缩进占位不触发自动保存落盘）；写作中非空正文 draft/基线都取磁盘
          // 原文不预填。空正文优先判定：两条件同时满足走预填路径。
          if (!hasRecovery && !editingRef.current && autoEditRef.current !== f && d && typeof d.body === "string" &&
              (d.body.trim() === "" || (d.frontmatter && d.frontmatter.status === "writing"))) {
            autoEditRef.current = f;
            var autoBody = d.body.trim() === "" ? "　　" : d.body; // 空正文预填缩进，非空原文直入
            bodyBaseRef.current = autoBody;
            var autoTitle = (d.frontmatter && d.frontmatter.title) || ""; // 标题基线同源初始化（0.1.25）
            titleBaseRef.current = autoTitle;
            setTitleDraft(autoTitle);
            setDraft(autoBody);
            setEditing(true);
            setBodyErr("");
          }
        }).catch(function (err) {
          if (seq !== detailSeqRef.current) return;
          setDetail({ loading: false, data: null, err: err.message });
        });
      }, [wsPath]);
      useEffect(function () { loadDetail(file); }, [file, loadDetail]);
      // 面板重开（reopenSeq 递增）：重拉本章让磁盘最新内容即时可见。编辑中
      // 走 silent——不闪骨架、不打断 textarea，draft 只在 409 冲突重置路径才
      // 动（上方注释的纪律不变）；阅读态非 silent，换血后照常渲染新正文。
      useEffect(function () {
        // 重开面板算新一轮访问：直开去重清空，空章节/写作中重开再次自动进编辑态。
        if (reopenSeq > 0) { autoEditRef.current = ""; loadDetail(file, { silent: editing }); }
      }, [reopenSeq]);
      // 切章必须退出编辑态并清草稿：草稿属于「那一章的那一次编辑」，跨章带过
      // 去会把 A 章的文字存进 B 章文件。
      useEffect(function () {
        setEditing(false); setDraft(""); setBodyErr(""); setBodyBusy(false); bodyResetRef.current = false; setBodyConflict(false);
        setOlEditing(false); setOlDraft(""); setOlErr(""); setOlBusy(false); olResetRef.current = false; setOlConflict(false);
        bodyBaseRef.current = ""; olBaseRef.current = ""; titleBaseRef.current = "";
        autoEditRef.current = ""; setAutoSavedAt(""); setTitleDraft(""); setLineTops([]); // 直开去重、保存时刻、标题草稿与行号随切章清零，新章新一轮
        setRecovery(null); setVersionsOpen(false); setVersionView(null); setVersionList(null); setRepeats(null);
        setSessionStart(0); setPickerOpen(false); setPickerQuery("");
        try { if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel(); } catch (err) {}
        setSpeaking(false);
      }, [file]);
      // 脏标记上报：Shell 的切 tab 守卫（gotoTab）读 DIRTY_EXIT 拦截；本组件
      // 不随切 tab 卸载（整页视图），标记随每轮渲染同步，卸载时清零。
      useEffect(function () {
        DIRTY_EXIT.dirty = (editing && (draft !== bodyBaseRef.current || titleDraft !== titleBaseRef.current)) || (olEditing && olDraft !== olBaseRef.current); // 标题草稿计入脏（0.1.25）
        return function () { DIRTY_EXIT.dirty = false; };
      });
      var ch = null;
      var chapters = (snap && snap.chapters) || [];
      for (var i = 0; i < chapters.length; i++) { if (chapters[i].file === file) { ch = chapters[i]; break; } }
      var nextCh = nextChapterOf(chapters, file); // 末章为 null → 「下一章」按钮禁用
      var prevCh = prevChapterOf(chapters, file);
      // 作战板数据：章纲节拍 / 出场角色 / 本章伏笔，全部从现有接口现算，
      // 不新增服务端字段；坏章纲最多让清单为空，不影响正文。
      var outlineMd = detail && detail.data && detail.data.outline ? detail.data.outline.body : "";
      var outlineBeatList = outlineBeats(outlineMd);
      var outlineCast = outlineCharacters(outlineMd);
      var chapterGoal = outlineGoal(outlineMd);
      var checkBody = editing ? draft : (detail && detail.data && typeof detail.data.body === "string" ? detail.data.body : "");
      var chapterNum = ch && typeof ch.num === "number" ? ch.num : null;
      var chapterForeshadows = [];
      if (chapterNum !== null) {
        var fsAll = (snap && snap.foreshadows) || [];
        for (var fsi = 0; fsi < fsAll.length; fsi++) {
          var fsOne = fsAll[fsi];
          var plantNum = Number(fsOne.planted_chapter);
          var resolveNum = Number(fsOne.expected_resolve);
          if (plantNum === chapterNum) chapterForeshadows.push({ item: fsOne, role: "plant" });
          else if (resolveNum === chapterNum) chapterForeshadows.push({ item: fsOne, role: "resolve" });
        }
      }
      var castCards = [];
      var charAll = (snap && snap.characters) || [];
      if (outlineCast.length > 0) {
        for (var oci = 0; oci < outlineCast.length; oci++) {
          var foundCard = null;
          for (var cci = 0; cci < charAll.length; cci++) {
            if (charAll[cci].name === outlineCast[oci] || outlineCast[oci].indexOf(charAll[cci].name) !== -1) { foundCard = charAll[cci]; break; }
          }
          castCards.push(foundCard || { name: outlineCast[oci] });
        }
      } else {
        for (var cci2 = 0; cci2 < charAll.length && castCards.length < 6; cci2++) {
          if (charAll[cci2].name && checkBody.indexOf(charAll[cci2].name) !== -1) castCards.push(charAll[cci2]);
        }
      }
      var beatsOk = 0;
      for (var bdi = 0; bdi < outlineBeatList.length; bdi++) {
        if (beatsDone.indexOf(bdi) !== -1) beatsOk++;
      }
      function openBoard(tabKey) {
        setBoardOpen(true);
        if (tabKey) setBoardTab(tabKey);
      }
      function toggleBeat(idx) {
        setBeatsDone(function (prev) {
          var arr = (prev || []).slice();
          var pos = arr.indexOf(idx);
          if (pos === -1) arr.push(idx); else arr.splice(pos, 1);
          try { localStorage.setItem("myt-beats:" + wsPath + "|" + file, JSON.stringify(arr)); } catch (err) {}
          return arr;
        });
      }
      function changeTarget(v) {
        var n = parseInt(v, 10);
        if (!(n >= 300 && n <= 20000)) return;
        setTargetWords(n);
        lsSet("myt-chapter-target", String(n));
      }
      function calcRepeats() {
        setRepeats(topRepeatedWords(checkBody, 18));
      }
      function locateWord(word) {
        if (!editing) { toast.warn(tt("reader.edit")); return; }
        setBoardOpen(false);
        setTimeout(function () {
          var ta = areaRef.current;
          if (!ta) return;
          var idx = String(ta.value).indexOf(word);
          if (idx < 0) return;
          ta.focus(); ta.setSelectionRange(idx, idx + word.length);
        }, 60);
      }
      function recoverKey() { return "myt-recover:" + wsPath + "|" + file; }
      function rememberDraft(text, title) {
        if (recTimerRef.current) clearTimeout(recTimerRef.current);
        var key = recoverKey();
        recTimerRef.current = setTimeout(function () {
          try { localStorage.setItem(key, JSON.stringify({ body: text, title: title, at: Date.now() })); } catch (err) {}
        }, 800);
      }
      function clearRecoverDraft() {
        if (recTimerRef.current) { clearTimeout(recTimerRef.current); recTimerRef.current = null; }
        try { localStorage.removeItem(recoverKey()); } catch (err) {}
        setRecovery(null);
      }
      function restoreRecovery() {
        if (!recovery || !detail || !detail.data) return;
        var baseTitle = (detail.data.frontmatter && detail.data.frontmatter.title) || "";
        bodyBaseRef.current = detail.data.body;
        titleBaseRef.current = baseTitle;
        autoHoldRef.current = false; // 恢复草稿 = 继续写，自动保存照常
        setDraft(recovery.body);
        setTitleDraft(recovery.title || baseTitle);
        setEditing(true);
        clearRecoverDraft();
      }
      function openVersions() {
        if (!file || versionsBusy) return;
        setVersionsOpen(true); setVersionsBusy(true); setVersionView(null);
        apiGet("versions", { path: wsPath, file: file }).then(function (d) {
          setVersionList(Array.isArray(d && d.versions) ? d.versions : []);
        }).catch(function () { setVersionList([]); }).finally(function () { setVersionsBusy(false); });
      }
      function loadVersion(v) {
        if (!v || !v.id) return;
        apiGet("version", { path: wsPath, file: file, id: v.id }).then(function (d) {
          if (d && d.ok) setVersionView({ id: v.id, text: d.text, words: d.words, at: v.at });
        }).catch(function () {});
      }
      function restoreVersion() {
        if (!versionView || !detail || !detail.data) return;
        if (editing && draft !== bodyBaseRef.current && !window.confirm(tt("common.dirtyExit"))) return;
        var baseTitle = (detail.data.frontmatter && detail.data.frontmatter.title) || "";
        bodyBaseRef.current = detail.data.body;
        titleBaseRef.current = baseTitle;
        setTitleDraft(baseTitle);
        autoHoldRef.current = true; // 等用户确认再写盘
        setDraft(versionView.text);
        setEditing(true);
        setVersionsOpen(false); setVersionView(null);
        toast.ok(tt("reader.historyLoaded"));
      }
      function openPicker() { setPickerQuery(""); setPickerOpen(true); }
      function jumpToChapter(targetFile) {
        if (!targetFile) return;
        if (targetFile === file) { setPickerOpen(false); return; }
        saveThenGo(function () {
          if (olEditing && olDraft !== olBaseRef.current && !window.confirm(tt("common.dirtyExit"))) return;
          setPickerOpen(false);
          if (typeof props.onOpenChapter === "function") props.onOpenChapter(targetFile);
        });
      }
      function goPrevChapter() {
        if (!prevCh || typeof props.onOpenChapter !== "function") return;
        saveThenGo(function () {
          if (olEditing && olDraft !== olBaseRef.current && !window.confirm(tt("common.dirtyExit"))) return;
          props.onOpenChapter(prevCh.file);
        });
      }
      function speakChapter() {
        if (speaking) { stopSpeak(); return; }
        if (typeof window === "undefined" || !window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== "function") {
          toast.warn(tt("reader.ttsUnsupported")); return;
        }
        var text = String(editing ? draft : (detail.data && detail.data.body) || "").trim();
        if (text === "") return;
        window.speechSynthesis.cancel();
        var u = new window.SpeechSynthesisUtterance(text.slice(0, 30000));
        u.lang = "zh-CN"; u.rate = 1.0;
        u.onend = function () { setSpeaking(false); };
        u.onerror = function () { setSpeaking(false); };
        setSpeaking(true);
        window.speechSynthesis.speak(u);
      }
      function stopSpeak() {
        try { if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel(); } catch (err) {}
        setSpeaking(false);
      }
      function saveAndAdvance() {
        if (!ch) return;
        var idx = STATUS_FLOW.indexOf(ch.status);
        var next = idx !== -1 && idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx + 1] : null;
        saveThenGo(function () {
          if (olEditing && olDraft !== olBaseRef.current && !window.confirm(tt("common.dirtyExit"))) return;
          var doNext = function () {
            if (nextCh && typeof props.onOpenChapter === "function") props.onOpenChapter(nextCh.file);
          };
          if (!next) { doNext(); return; }
          setFlowBusy(true);
          apiPost("chapter-status", { path: wsPath, file: ch.file, status: next })
            .then(function () { return reload(); })
            .then(function () { doNext(); })
            .catch(function () {})
            .finally(function () { setFlowBusy(false); });
        });
      }
      function boardContent() {
        if (boardTab === "foreshadow") {
          if (chapterForeshadows.length === 0) return h("div", { className: "myt-muted" }, tt("board.noForeshadow"));
          return h("div", { className: "myt-fsList" }, chapterForeshadows.map(function (row, i) {
            var item = row.item;
            return h("div", { key: i, className: "myt-fsRow" },
              h("span", { className: "myt-fsRole", "data-role": row.role }, tt(row.role === "plant" ? "board.plant" : "board.resolve")),
              h("div", { className: "myt-fsMain" },
                h("div", { className: "myt-fsTitle" }, item.title || item.id || "?"),
                h("div", { className: "myt-fsMeta" }, [item.id, item.priority, item.status].filter(Boolean).join(" · ")),
                item.notes ? h("div", { className: "myt-fsNotes" }, item.notes) : null));
          }));
        }
        if (boardTab === "chars") {
          if (castCards.length === 0) return h("div", { className: "myt-muted" }, tt("board.noChars"));
          return h("div", { className: "myt-castList" }, castCards.map(function (c, i) {
            return h("div", { key: i, className: "myt-castRow" },
              h("div", { className: "myt-castHead" },
                h("strong", null, c.name || "?"),
                c.role ? h("span", { className: "myt-muted" }, " · " + c.role) : null),
              c.personality ? h("div", { className: "myt-muted" }, c.personality) : null,
              c.markers && c.markers.length ? h("div", { className: "myt-castTags" },
                c.markers.map(function (m, mi) { return h("span", { key: mi, className: "myt-tag" }, m); })) : null);
          }));
        }
        if (boardTab === "words") {
          return [
            h("div", { key: "hint", className: "myt-muted" }, tt("board.wordsHint")),
            h("button", { key: "btn", type: "button", className: "myt-btn", onClick: calcRepeats }, tt("board.wordsBtn")),
            repeats === null ? null : repeats.length === 0
              ? h("div", { key: "empty", className: "myt-muted" }, tt("board.wordsEmpty"))
              : h("div", { key: "list", className: "myt-wordList" }, repeats.map(function (row, i) {
                  return h("button", { key: i, type: "button", className: "myt-wordRow", onClick: function () { locateWord(row[0]); } },
                    h("span", { className: "myt-wordText" }, row[0]),
                    h("span", { className: "myt-wordCount" }, tf("board.count", { n: row[1] })));
                })),
          ];
        }
        if (boardTab === "check") {
          return [
            h("div", { key: "hint", className: "myt-muted" }, tt("board.checkHint")),
            outlineBeatList.length === 0
              ? h("div", { key: "none", className: "myt-muted" }, tt("board.noBeats"))
              : h("div", { key: "list", className: "myt-checkList" }, outlineBeatList.map(function (b, i) {
                  var cov = beatCoverage(b, checkBody);
                  var ok = cov >= 0.4;
                  return h("div", { key: i, className: "myt-checkRow", "data-ok": ok ? "true" : "false" },
                    h("span", { className: "myt-checkDot" }),
                    h("span", { className: "myt-checkText" }, b),
                    h("span", { className: "myt-checkPct" }, Math.round(cov * 100) + "%"));
                })),
          ];
        }
        return [
          h("div", { key: "target", className: "myt-boardTarget" },
            h("label", { className: "myt-boardLabel" }, tt("board.targetLabel")),
            h("input", {
              type: "number", className: "myt-setInput myt-boardTargetInput", value: targetWords, min: 300, max: 20000,
              onChange: function (e) { changeTarget(e.target.value); },
            })),
          chapterGoal ? h("div", { key: "goal", className: "myt-boardGoal" }, h("strong", null, tt("board.goal") + "："), chapterGoal) : null,
          outlineBeatList.length === 0
            ? h("div", { key: "none", className: "myt-muted" }, tt("board.noBeats"))
            : h("div", { key: "list", className: "myt-beatList" }, outlineBeatList.map(function (b, i) {
                var done = beatsDone.indexOf(i) !== -1;
                return h("label", { key: i, className: "myt-beatRow", "data-done": done ? "true" : undefined },
                  h("input", { type: "checkbox", checked: done, onChange: function () { toggleBeat(i); } }),
                  h("span", { className: "myt-beatText" }, b));
              })),
        ];
      }
      function onTouchStart(e) {
        if (editing) return;
        var t = e.touches && e.touches[0];
        if (!t) return;
        var tag = e.target && e.target.tagName ? String(e.target.tagName).toUpperCase() : "";
        if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
        touchRef.current = { x: t.clientX, y: t.clientY };
      }
      function onTouchEnd(e) {
        var start = touchRef.current;
        touchRef.current = null;
        if (!start || editing) return;
        var t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        var dx = t.clientX - start.x;
        var dy = t.clientY - start.y;
        if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
        if (dx > 0) goPrevChapter(); else goNextChapter();
      }
      // 换章（0.5.1）：脏稿先自动落盘再走，不再拿「确认丢弃」当常态；
      // 章纲是手动保存的账，仍有草稿则照旧确认（common.dirtyExit）。
      // 落盘失败（409/422）留在原地亮出口，绝不带着未存稿切走。
      function goNextChapter() {
        if (!nextCh || typeof props.onOpenChapter !== "function") return;
        saveThenGo(function () {
          if (olEditing && olDraft !== olBaseRef.current) {
            if (!window.confirm(tt("common.dirtyExit"))) return;
          }
          props.onOpenChapter(nextCh.file);
        });
      }
      function advance() {
        if (!ch) return;
        var idx = STATUS_FLOW.indexOf(ch.status);
        var next = idx !== -1 && idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx + 1] : null;
        if (!next || flowBusy) return;
        setFlowBusy(true);
        apiPost("chapter-status", { path: wsPath, file: ch.file, status: next })
          .then(function () { return reload(); })
          .then(function () {
            // 时序守卫：流转期间切了章——快照照刷（无害），旧章详情不回填。
            if (fileRef.current === ch.file) return loadDetail(ch.file);
          })
          .catch(function () {}).finally(function () { setFlowBusy(false); });
      }
      function copyChapterPath() {
        copyText(chapterAbsPath(snap && snap.novelDir, file)).then(function (ok) {
          if (ok) toast.ok(tt("reader.copied"));
          else toast.warn(tt("reader.copyFailed"));
        });
      }
      function startBodyEdit() {
        if (!detail || !detail.data || typeof detail.data.body !== "string") return;
        autoHoldRef.current = false;
        setBodyErr("");
        setAutoSavedAt(""); // 上一次编辑会话的自动保存时刻不带进新一轮
        var t0 = (detail.data.frontmatter && detail.data.frontmatter.title) || ""; // 标题基线同源初始化（0.1.25）
        titleBaseRef.current = t0;
        setTitleDraft(t0);
        bodyBaseRef.current = detail.data.body; // 进入编辑态即记基线，供脏检查
        setDraft(detail.data.body);
        setEditing(true);
      }
      function cancelBodyEdit() {
        if (bodyBusy) return; // 保存在途不许退出：避免卸载后 setState
        if ((draft !== bodyBaseRef.current || titleDraft !== titleBaseRef.current) && !window.confirm(tt("common.dirtyExit"))) return; // 脏退出先确认（正文或标题，0.1.25）
        setEditing(false); setDraft(""); setBodyErr(""); setBodyConflict(false); setTitleDraft(""); setFsFull(false); // 退出编辑必清全屏标志：残留 true 会让「全屏中取消」后再进编辑直接全屏
        clearRecoverDraft(); // 取消 = 放弃草稿，本地恢复副本一并清掉
      }
      // 返回章节列表（0.5.1）：正文/标题先自动保存再退；章纲草稿仍确认。
      function leaveReader() {
        saveThenGo(function () {
          if (olEditing && olDraft !== olBaseRef.current) {
            if (!window.confirm(tt("common.dirtyExit"))) return;
          }
          onBack();
        });
      }
      function saveBody() {
        if (bodyBusy || !detail.data) return Promise.resolve(false);
        // 标题（0.1.25）：与正文一次原子保存——基线有变才随载荷发 title（undefined
        // 经 JSON.stringify 自然丢弃，服务端缺省不动 title 行）；trim 后空串 422
        // 在本地先拦（复用 novel.titleRequired），不发无效请求。
        var newTitle = titleDraft !== titleBaseRef.current ? titleDraft.trim() : undefined;
        if (newTitle !== undefined && newTitle === "") { setBodyErr(tt("novel.titleRequired")); return Promise.resolve(false); }
        setBodyBusy(true); setBodyErr("");
        var bodyToSave = draft; // 调用点快照：在途期间继续打字的文本不该被误标已保存
        // 失败经卡内 bodyErr 呈现（silent 抑制 apiPost 同文 toast）；成功提示仍走 toast。
        // 返回 Promise<boolean>：true = 已落盘（或无需落盘），false = 失败/拦截——
        // 「保存后再切章/返回」靠它判断能不能走（0.5.1）。
        return apiPost("chapter-save", { path: wsPath, file: file, body: bodyToSave, base_hash: detail.data.hash, title: newTitle }, { silent: true }).then(function (res) {
          // 时序守卫：保存期间切了章——旧章结果不得覆写当前 detail（快照 reload 无害照做）。
          if (fileRef.current === file) {
            // 写后指纹即下一轮基线（连续保存不再被自家 409 拦住）；本地 data 同步
            // 为新正文/新标题，编辑器即时看到刚落盘的内容（不等重拉，防闪回旧文）。
            setDetail({ loading: false, data: Object.assign({}, detail.data, {
              body: bodyToSave,
              hash: res && typeof res.hash === "string" ? res.hash : detail.data.hash,
              frontmatter: newTitle !== undefined ? Object.assign({}, detail.data.frontmatter || {}, { title: newTitle }) : detail.data.frontmatter,
            }), err: "" });
            bodyBaseRef.current = bodyToSave; // 写盘内容即新基线：连续保存不假脏
            if (newTitle !== undefined) titleBaseRef.current = newTitle; // 标题基线同刀推进
            setBodyConflict(false);
            // 0.1.23 起手动/自动保存统一：都停留编辑态续写、不清草稿——手动点保存
            // 与自动保存等价，只是人工触发；退出编辑态只走「取消」（保存后草稿
            // 已回基线，脏检查归零，无确认直退）。
            setAutoSavedAt(new Date().toTimeString().slice(0, 8));
            autoHoldRef.current = false;
            clearRecoverDraft(); // 已落盘：本地崩溃草稿使命结束
            // 写盘即新一轮干净起点：连续打字最多再等 6s 才强制下一次落盘。
            dirtySinceRef.current = 0;
            failCountRef.current = 0; // 成功即清退避
            setLedgerHint(res && res.ledger ? res.ledger : null); // 记账提示随保存结果刷新
          }
          // 字数/统计随正文变：合并到停手 1.2s 后拉一次整份快照（连续自动保存
          // 不再每次都全量重扫；手动保存后表格字数最迟 1.2s 更新）。
          if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
          reloadTimerRef.current = setTimeout(function () {
            reloadTimerRef.current = null;
            // 保存后的刷新走软刷新（0.15.2）：只回骨架并合并，省一次 386KB 全量。
            var refresh = typeof props.reloadSoft === "function" ? props.reloadSoft : reload;
            if (typeof refresh === "function") refresh();
          }, 1200);
          return true;
        }).catch(function (err) {
          if (fileRef.current !== file) return false; // 切章后的过期失败：不打扰当前章
          if (err && err.status === 409) {
            // 409 = 章节文件在进入编辑态后被外部改过：草稿绝不丢——保留编辑态
            // 与草稿原文，报冲突并亮两个出口（放弃草稿载入磁盘版 / 基于磁盘
            // 最新版重改），由用户选择，不再静默重拉覆盖草稿。
            setBodyConflict(true);
            setBodyErr(tf("edit.conflict409", { msg: err.message }));
          } else {
            setBodyErr(err.message); // 其他失败（网络抖动等）不动草稿，只报错。
            failCountRef.current += 1; // 自动保存退避：3s→6s→12s→24s→30s 封顶
          }
          return false;
        }).finally(function () { setBodyBusy(false); });
      }
      saveRef.current = saveBody; // 事件/定时器/卸载急救统一从这里取最新闭包
      // 有未保存的正文或标题（章纲是手动保存，单独判）。
      function isBodyDirty() {
        return editing && (draft !== bodyBaseRef.current || titleDraft !== titleBaseRef.current);
      }
      // 换章/返回前先保存再走（0.5.1）：把「确认丢弃草稿」从常态降级为例外，
      // 409 冲突或 422（空标题）时留在原地亮错误出口，绝不带着未存稿切走。
      function saveThenGo(go) {
        if (!isBodyDirty()) { go(); return; }
        if (bodyBusy) { toast.warn(tt("novel.saving")); return; } // 在途：让用户再点一次，绝不并发写同一章
        saveBody().then(function (ok) { if (ok) go(); });
      }
      // 正文自动保存调度（0.5.1 重做）：停手约 1.5s 落盘；连续不停手打字时
      // 最迟 6s 也强制落一次——旧版是纯 30s 防抖，每敲一键就把定时器推后，
      // 写两小时一次都没存，切章/崩页面全丢。无 dep 数组、每轮渲染按最新
      // draft 重排；切章、409 冲突、保存在途不排。纯缩进占位（trim 为空）不
      // 落盘（空章节只改标题等手动保存一次原子写）。setAutoSavedAt("") 传同值
      // 不重渲，无循环。
      useEffect(function () {
        if (!editing || bodyConflict || bodyBusy) return;
        if (!detail || !detail.data) return;
        if (autoHoldRef.current) return; // 历史版本刚载入：不自动覆盖磁盘
        var dirty = draft !== bodyBaseRef.current || titleDraft !== titleBaseRef.current;
        if (!dirty || draft.trim() === "") {
          if (dirty) setAutoSavedAt(""); // 有改动但不满足落盘条件：旧「已保存」标撤下
          dirtySinceRef.current = 0; // 干净了，下一轮脏重新计时
          return;
        }
        setAutoSavedAt(""); // 新改动入列，清掉旧的「已保存」标
        var now = Date.now();
        if (!dirtySinceRef.current) dirtySinceRef.current = now;
        var wait = Math.max(0, Math.min(1500, 6000 - (now - dirtySinceRef.current)));
        if (failCountRef.current > 0) wait = Math.max(wait, Math.min(30000, 1500 * Math.pow(2, failCountRef.current)));
        var t = setTimeout(function () { if (fileRef.current === file) saveBody(); }, wait);
        return function () { clearTimeout(t); };
      });
      // 切后台/失焦立即落盘（手机切应用、桌面切窗口都算）：不等 1.5s 停顿，
      // 也不给宿主只保留内存态的机会（0.5.1）。
      useEffect(function () {
        if (!editing) return;
        var flush = function () {
          if (!editingRef.current || conflictRef.current || busyRef.current) return;
          if (draftRef.current === bodyBaseRef.current && titleRef.current === titleBaseRef.current) return;
          if (String(draftRef.current).trim() === "") return;
          saveRef.current();
        };
        var onVis = function () { if (typeof document !== "undefined" && document.visibilityState === "hidden") flush(); };
        window.addEventListener("blur", flush);
        document.addEventListener("visibilitychange", onVis);
        return function () {
          window.removeEventListener("blur", flush);
          document.removeEventListener("visibilitychange", onVis);
        };
      }, [editing]);
      // Ctrl/⌘+S 立即保存（写作人手最快的肌肉记忆）；拦截浏览器「保存网页」。
      useEffect(function () {
        if (!editing) return;
        var onKey = function (e) {
          if (!(e.ctrlKey || e.metaKey) || String(e.key).toLowerCase() !== "s") return;
          e.preventDefault();
          if (busyRef.current || conflictRef.current) return;
          saveRef.current();
        };
        document.addEventListener("keydown", onKey, true);
        return function () { document.removeEventListener("keydown", onKey, true); };
      }, [editing]);
      // 键盘适配（0.15.0）：手机弹出软键盘时 visualViewport 缩小、布局视口不变，
      // 底部写作条会压在键盘底下。这里把「视口被吃掉的高度」写成 CSS 变量，
      // 写作条按它抬起来；同时把光标滚进可视区，长章写到末尾不至于盲打。
      useEffect(function () {
        if (!editing) return undefined;
        if (typeof window === "undefined" || !window.visualViewport) return undefined;
        var vv = window.visualViewport;
        function sync() {
          var inset = Math.max(0, Math.round((window.innerHeight || 0) - vv.height - (vv.offsetTop || 0)));
          try { document.documentElement.style.setProperty("--myt-vv-inset", inset + "px"); } catch (err) {}
          var ta = areaRef.current;
          if (ta && document.activeElement === ta) {
            try { ta.scrollIntoView({ block: "nearest" }); } catch (err) { /* 老浏览器忽略 */ }
          }
        }
        sync();
        vv.addEventListener("resize", sync);
        vv.addEventListener("scroll", sync);
        return function () {
          vv.removeEventListener("resize", sync);
          vv.removeEventListener("scroll", sync);
          try { document.documentElement.style.removeProperty("--myt-vv-inset"); } catch (err) {}
        };
      }, [editing]);
      // 作战板节拍勾选：按章独立存 localStorage，切章重新载入。
      useEffect(function () {
        try {
          var raw = localStorage.getItem("myt-beats:" + wsPath + "|" + file);
          var arr = raw ? JSON.parse(raw) : [];
          setBeatsDone(Array.isArray(arr) ? arr : []);
        } catch (err) { setBeatsDone([]); }
      }, [file, wsPath]);
      // 本次写作计时：进编辑记起点与起始字数，退出清零；15s 重渲一次即可。
      useEffect(function () {
        if (!editing) { setSessionStart(0); return; }
        if (!sessionStart) {
          sessionBaseRef.current = countCjkText(draft);
          setSessionStart(Date.now());
        }
      }, [editing, sessionStart, draft]);
      useEffect(function () {
        if (!editing) return;
        var t = setInterval(function () { setTick(function (x) { return x + 1; }); }, 15000);
        return function () { clearInterval(t); };
      }, [editing]);
      // 卸载/切章停掉朗读，避免离开页面还在念。
      useEffect(function () {
        return function () {
          try { if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel(); } catch (err) {}
        };
      }, []);
      // 卸载急救（0.5.1）：右栏 tab 换章/关 tab 会重挂组件，来不及走确认——
      // 卸载时若还有脏稿，直接发一次保存，失败也只留 toast 之外的静默（下一
      // 次打开会看到磁盘版）。正常保存过（回到基线）的不会重复发。
      useEffect(function () {
        return function () {
          if (!editingRef.current || conflictRef.current || busyRef.current) return;
          if (draftRef.current === bodyBaseRef.current && titleRef.current === titleBaseRef.current) return;
          if (String(draftRef.current).trim() === "") return;
          var t = titleRef.current !== titleBaseRef.current ? titleRef.current.trim() : undefined;
          if (t === "") return; // 空标题不合法，宁可丢草稿也不写坏文件名/标题行
          var dd = detailRef.current && detailRef.current.data;
          apiPost("chapter-save", {
            path: wsRef.current, file: fileRef.current, body: draftRef.current, // 用 ref 里的当前章：卸载瞬间 props 可能已换
            base_hash: dd ? dd.hash : undefined, title: t, // 带上进入编辑时的基线指纹：外部改过就 409 不覆盖
          }, { silent: true }).catch(function () { /* 卸载后无处报错，静默保住现场即可 */ });
        };
      }, []);
      // 回车缩进的光标恢复：DOM 换新后把光标放到插入的「\n　　」缩进之后，
      // 打字位置即视觉位置；无待恢复请求（普通打字）直接跳过。
      useEffect(function () {
        if (pendingCaretRef.current == null) return;
        var pos = pendingCaretRef.current; pendingCaretRef.current = null;
        var ta = areaRef.current;
        if (ta) { ta.selectionStart = ta.selectionEnd = pos; }
      }, [draft]);
      // 编辑器自动长高（0.1.22）+ 行号测量（0.1.26）：排版对齐只读正文（字体
      // 可选、字号档位可调，编辑与只读同源同字体），高度随内容长上去，至少
      // 320px；非编辑态（textarea
      // 已卸载）跳过。行号走镜像测量——正文一行一段且段落很长，textarea 软换行
      // 把一个逻辑行折成多个视觉行，等距排号必然错位；镜像 div 与编辑区同字体/
      // 行高/padding/换行规则、宽度用 ta.clientWidth 校准（含 padding 不含边框，
      // 镜像无 border 故内容宽即此），逐逻辑行量 offsetTop（含镜像 12px padding
      // 顶，行号与首行文字天然齐）。ResizeObserver 跟宽高变化（面板缩放、字号
      // 六档、拖窗口）重测；量高→RO 再触发→量出同高即收敛，无环。
      // dep 带上 editFs/editFont/fsFull：字号或字体变→软换行重排→必须重测
      // （RO 只兜宽高变化，字体切换宽高未必变，显式 dep 与 editFs 同理）；
      // 进/出全屏→镜像宽度
      // 与长高逻辑换挡——全屏态高度由 flex 接管（清掉 inline height），退屏后
      // 本 effect 重跑恢复自动长高。
      // 0.1.34 加固：useLayoutEffect 绘制前重排行号（消灭缩放后旧坐标闪帧），
      // 双 rAF 复测兜宿主迟到布局，测量顺带重同步滚动 transform（钳位场景）。
      useLayoutEffect(function () {
        var ta = areaRef.current;
        var mirror = mirrorRef.current;
        if (!editing || !ta || !mirror) return;
        var warned = false; // 发散只警告一次，避免刷屏
        var measure = function () {
          mirror.style.width = ta.clientWidth + "px";
          var tops = Array.prototype.map.call(mirror.children, function (el) { return el.offsetTop; });
          // 行高没变就不换数组（0.5.1）：每敲一键都 setState 会让整张编辑卡多渲
          // 一遍，长章在手机上明显掉帧；只有行位置真的变了才重排。
          setLineTops(function (prev) {
            if (prev.length === tops.length) {
              for (var ti = 0; ti < tops.length; ti++) if (prev[ti] !== tops[ti]) return tops;
              return prev;
            }
            return tops;
          });
          if (fsFull) {
            ta.style.height = ""; // 全屏：高度交给覆盖层布局（CSS height:100%）
          } else {
            ta.style.height = "auto";
            ta.style.height = Math.max(320, ta.scrollHeight + 2) + "px";
          }
          // 滚动钳位重同步：缩放后内容变矮、浏览器夹紧 scrollTop 不发 scroll 事件，
          // 行号层 transform 会停在旧值——每次测量后按当前 scrollTop 直接对齐。
          var g = gutterNumsRef.current;
          if (g) g.style.transform = "translateY(" + (-ta.scrollTop) + "px)";
        };
        var diverged = function () {
          if (warned) return;
          if (Math.abs((mirror.scrollHeight || 0) - (ta.scrollHeight || 0)) > 2) {
            warned = true;
            try { console.warn("[xiaoyu] 行号镜像与编辑区高度不一致", { taH: ta.scrollHeight, mirrorH: mirror.scrollHeight, fs: editFs, lh: Math.round(editFs * 22 / 13), w: ta.clientWidth }); } catch (err2) {}
          }
        };
        measure();
        // 双 rAF 复测：字号/字体/面板缩放变更后，宿主 webview 可能有迟到布局
        // （字体换装、zoom 应用次序），主动再测两轮收敛，不依赖 RO 是否触发。
        var r1 = requestAnimationFrame(function () { measure(); diverged(); });
        var r2 = requestAnimationFrame(function () {
          r1 = requestAnimationFrame(function () { measure(); diverged(); });
        });
        var ro = new ResizeObserver(function () { measure(); });
        ro.observe(ta);
        return function () {
          cancelAnimationFrame(r1);
          cancelAnimationFrame(r2);
          ro.disconnect();
        };
      }, [draft, editing, editFs, editFont, fsFull]);
      // 409 出口①：放弃草稿——磁盘真值放回编辑器（bodyResetRef 一次性重置链路）。
      function dropBodyDraft() {
        if (bodyBusy) return;
        setBodyConflict(false); setBodyErr("");
        bodyResetRef.current = true;
        clearRecoverDraft();
        loadDetail(file);
      }
      // 409 出口②：基于磁盘最新版重改——只把 detail 换成磁盘最新（拿到新
      // base_hash），草稿原样留在编辑器，用户改完再存即用新基线。
      function rebaseBodyDraft() {
        if (bodyBusy) return;
        var seq = ++detailSeqRef.current;
        apiGet("chapter", { path: wsPath, file: file }).then(function (d) {
          if (seq !== detailSeqRef.current) return; // 过期响应：已切章，丢弃
          setDetail({ loading: false, data: d, err: "" });
          setBodyConflict(false); setBodyErr("");
        }).catch(function (err2) {
          if (seq !== detailSeqRef.current) return;
          setBodyErr(err2.message); // 重拉失败：冲突态保留，出口仍在可重试
        });
      }
      function startOutlineEdit() {
        var ol = detail && detail.data && detail.data.outline;
        if (!ol || typeof ol.body !== "string") return;
        setOlErr("");
        setOlDraft(ol.body);
        setOlEditing(true);
      }
      function cancelOutlineEdit() {
        if (olBusy) return;
        if (olDraft !== olBaseRef.current && !window.confirm(tt("common.dirtyExit"))) return; // 脏退出先确认
        setOlEditing(false); setOlDraft(""); setOlErr(""); setOlConflict(false);
      }
      function saveOutline() {
        var ol = detail && detail.data && detail.data.outline;
        if (olBusy || !ol) return;
        setOlBusy(true); setOlErr("");
        // 失败经卡内 olErr 呈现（silent 抑制 apiPost 同文 toast）；成功提示仍走 toast。
        apiPost("outline-save", { path: wsPath, file: file, body: olDraft, base_hash: ol.hash }, { silent: true }).then(function (res) {
          if (fileRef.current === file) { // 时序守卫：同 saveBody
            setDetail({ loading: false, data: Object.assign({}, detail.data, {
              outline: Object.assign({}, ol, { body: olDraft, hash: res && typeof res.hash === "string" ? res.hash : ol.hash }),
            }), err: "" });
            setOlConflict(false);
            setOlEditing(false); setOlDraft("");
          }
          // 章纲字数 chip 客户端不算 CJK——silent 重拉静默对齐，不闪骨架。
          return reload().then(function () {
            if (fileRef.current === file) return loadDetail(file, { silent: true });
          });
        }).catch(function (err) {
          if (fileRef.current !== file) return; // 切章后的过期失败：不打扰当前章
          if (err && err.status === 409) {
            // 409 = 章纲文件被外部改过：草稿绝不丢，两个出口同 saveBody。
            setOlConflict(true);
            setOlErr(tf("edit.conflict409", { msg: err.message }));
          } else {
            setOlErr(err.message);
          }
        }).finally(function () { setOlBusy(false); });
      }
      // 409 出口①：放弃章纲草稿——磁盘真值放回编辑器（olResetRef 一次性重置链路）。
      function dropOutlineDraft() {
        if (olBusy) return;
        setOlConflict(false); setOlErr("");
        olResetRef.current = true;
        loadDetail(file);
      }
      // 409 出口②：基于磁盘最新版重改——只换 detail 拿新 base_hash，章纲草稿
      // 原样留在编辑器，改完再存即用新基线。
      function rebaseOutlineDraft() {
        if (olBusy) return;
        var seq = ++detailSeqRef.current;
        apiGet("chapter", { path: wsPath, file: file }).then(function (d) {
          if (seq !== detailSeqRef.current) return;
          setDetail({ loading: false, data: d, err: "" });
          setOlConflict(false); setOlErr("");
        }).catch(function (err2) {
          if (seq !== detailSeqRef.current) return;
          setOlErr(err2.message); // 重拉失败：冲突态保留，出口仍在可重试
        });
      }
      // 章纲编辑钩子（传给 OutlinePanel；无章纲返回 null = 只读，不给编辑入口——
      // v1 不做面板新建章纲文件）。conflict/drop/rebase：409 两出口透传。
      function outlineEditor() {
        if (!detail || !detail.data || !detail.data.outline) return null;
        return { active: olEditing, draft: olDraft, busy: olBusy, err: olErr, conflict: olConflict, start: startOutlineEdit, change: setOlDraft, cancel: cancelOutlineEdit, save: saveOutline, drop: dropOutlineDraft, rebase: rebaseOutlineDraft };
      }
      // 编辑中正文的实时 CJK 字数（0.1.23，hint 行常显）：与 lib/novel-parse.mjs
      // 的 countCjk 同口径——基本区 + 扩展 A + 扩展 B，u 标志按码点匹配（增补平面
      // 生僻字不漏计），面板本地数与服务端全库字数对得上。
      var draftCjk = draft.match(/[\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{2a6df}]/gu);
      var draftWords = draftCjk ? draftCjk.length : 0;
      // 含标点口径（0.1.26 双数并显）：去空白后的全部码点数。必须带 u 标志按
      // 码点计数——扩展 B 生僻字是代理对，String.length 会按 2 计；match(/\S/u)
      // 覆盖标点、ASCII 字母数字与全半角符号等一切非空白，中文作者码字视角。
      var draftAllChars = (draft.match(/\S/gu) || []).length;
      // 本次写作统计（0.6.0）：起点在进入编辑时记录，字数按 CJK 口径与 hint 同源。
      var sessionWords = sessionStart ? Math.max(0, draftWords - sessionBaseRef.current) : 0;
      var sessionMin = sessionStart ? fmtDurationMin(sessionStart) : 0;
      var pickerItems = (snap && snap.chapters ? snap.chapters : []).filter(function (c) {
        var q = pickerQuery.trim();
        if (q === "") return true;
        return (chFullTitle(c) + " " + String(c.file || "")).indexOf(q) !== -1;
      });
      // 行号栏宽度（0.1.26）：随最大行号位数自适应，最少 2 位起步；gutter 宽与
      // 镜像 left 用同一 gutterCh，同源不漂移。
      var gutterCh = Math.max(2, String(lineTops.length).length) + 2;
      // 字号档位派生（0.1.26）：行高与 gutter 数字按比例——textarea 与镜像的
      // inline style 必须同源同值，否则行号错位；gutter ch 宽随其 font-size 缩放。
      var editLh = Math.round(editFs * 22 / 13);
      var editGutterFs = Math.round(11 * editFs / 13);
      var fsPct = Math.round(editFs / 13 * 100);
      // 字体栈派生（未发版）：EDIT_FONTS 内查 stack，越枚举回落空串 = inherit。
      // 换字体不改行高公式（editLh 照旧）——镜像与 textarea 同值即可行号不错位；
      // 字体变→软换行重排→测量 effect dep 已带 editFont 显式重测。gutter 行号
      // 数字维持 UI 字体不动（tabular-nums 等宽已有）。
      var editFontStack = "";
      for (var efi = 0; efi < EDIT_FONTS.length; efi++) { if (EDIT_FONTS[efi].id === editFont) { editFontStack = EDIT_FONTS[efi].stack; break; } }
      // 字体下拉 + A−/比例/A+ 按钮组（0.1.26 起 A−/A+，字体下拉未发版加在最前）：
      // 非全屏在卡内工具行、全屏挪进覆盖层头部，两处同一构建器保证行为一致；
      // 比例常显 muted 小字。
      function fsButtons() {
        return [
          h("select", { key: "font", className: "myt-editFontSel",
            title: tt("reader.font"), "aria-label": tt("reader.font"),
            value: editFont, onChange: function (e) { pickEditFont(e.target.value); } },
            EDIT_FONTS.map(function (f) {
              return h("option", { key: f.id, value: f.id }, f.id === "ui" ? tt("reader.fontDefault") : f.label);
            })),
          h("button", { key: "minus", type: "button", className: "myt-btn",
            title: tt("reader.fontSmaller"), "aria-label": tt("reader.fontSmaller"),
            onClick: function () { bumpEditFs(-2); } }, "A−"),
          h("span", { key: "pct", className: "myt-editFsPct" }, fsPct + "%"),
          h("button", { key: "plus", type: "button", className: "myt-btn",
            title: tt("reader.fontLarger"), "aria-label": tt("reader.fontLarger"),
            onClick: function () { bumpEditFs(2); } }, "A+"),
        ];
      }
      // 编辑卡（0.1.26 起全屏）：标题 + 工具行 + 行号编辑区 + hint + 按钮行。
      // 全屏时同一棵树包进 MaskPortal 覆盖层（portal 进实例根；无 portal 的老
      // 宿主原地渲染兜底）——React 换父重挂，textarea 内容全部来自 state（draft/
      // titleDraft），不丢稿；Esc/遮罩/头部按钮退出只是视觉还原。
      var bodyEditNode = !editing ? null : (fsFull
        ? h(MaskPortal, { className: "myt-editFsOverlay",
            onMouseDown: function (e) { if (e.target === e.currentTarget) setFsFull(false); } },
            h("div", { className: "myt-editFsShell", role: "dialog", "aria-modal": "true", "aria-label": tt("reader.editFullscreen") },
              h("div", { className: "myt-editFsHead" },
                h("div", { className: "myt-editFsGroup" }, fsButtons()),
                // 阅读模式：复用取消链路退只读（cancelBodyEdit 顺带清 fsFull，覆盖层随编辑树卸载）
                h("button", { type: "button", className: "myt-btn",
                  title: tt("reader.readMode"), "aria-label": tt("reader.readMode"),
                  onClick: cancelBodyEdit }, tt("reader.readMode")),
                h("button", { type: "button", className: "myt-btn",
                  title: tt("reader.editExitFullscreen"), "aria-label": tt("reader.editExitFullscreen"),
                  onClick: function () { setFsFull(false); } }, tt("reader.editExitFullscreen"))),
              h("div", { className: "myt-bodyEdit myt-editFsCard" },
                h("input", { type: "text", className: "myt-chapterEditTitle", value: titleDraft,
                  placeholder: tt("reader.titlePlaceholder"), "aria-label": tt("reader.titlePlaceholder"), spellCheck: false,
                  onChange: function (e) { setTitleDraft(e.target.value); rememberDraft(draftRef.current, e.target.value); } }),
                h("div", { className: "myt-editWrap" },
                  h("div", { className: "myt-editGutter", "aria-hidden": "true", style: { width: gutterCh + "ch", fontSize: editGutterFs + "px" } },
                    h("div", { ref: gutterNumsRef, className: "myt-editNums" },
                      lineTops.map(function (top, i) { return h("span", { key: i, style: { top: top + "px", fontSize: editGutterFs + "px", lineHeight: editLh + "px" } }, String(i + 1)); }))),
                  h("textarea", {
                    ref: areaRef,
                    className: "myt-chapterEditArea", rows: 20, spellCheck: false,
                    style: { fontSize: editFs + "px", lineHeight: editLh + "px", fontFamily: editFontStack === "" ? undefined : editFontStack }, // 字体单源下发（两份编辑树同款），系统默认不下发走 inherit
                    value: draft, onChange: function (e) { autoHoldRef.current = false; setDraft(e.target.value); rememberDraft(e.target.value, titleRef.current); },
                    onScroll: function (e) {
                      var g = gutterNumsRef.current; // 滚动同步：行号层随 scrollTop 平移
                      if (g && e.target) g.style.transform = "translateY(" + (-e.target.scrollTop) + "px)";
                    },
                    onKeyDown: function (e) {
                      if (e.key === "Escape" && fsFull) { e.preventDefault(); setFsFull(false); return; } // 全屏态 Esc 退出
                      if (e.key !== "Enter") return;
                      if (e.keyCode === 229) return; // IME 组态中
                      if (e.nativeEvent && e.nativeEvent.isComposing) return; // 中文输入法回车选词
                      var ta = e.target;
                      var s = ta.selectionStart, en = ta.selectionEnd;
                      if (typeof s !== "number" || typeof en !== "number") return; // 退化环境交给默认
                      e.preventDefault();
                      // 优先走 execCommand 插入（0.5.1）：浏览器输入栈保留，Ctrl/⌘+Z 能撤回
                      // 上一个自然段；程序化换 value 会清空 undo 历史，写手最常用的撤销就废了。
                      var inserted = false;
                      try { inserted = !!(document.execCommand && document.execCommand("insertText", false, "\n　　")); } catch (err) { inserted = false; }
                      if (inserted) return; // 输入事件已驱动 onChange，光标位置由浏览器维护
                      var next = ta.value.slice(0, s) + "\n　　" + ta.value.slice(en);
                      pendingCaretRef.current = s + 3; // 退化路径：下一轮渲染后手动放光标（"\n" + 两个全角空格）
                      setDraft(next);
                    },
                  }),
                  h("div", { ref: mirrorRef, className: "myt-editMirror", "aria-hidden": "true", style: { left: gutterCh + "ch", fontSize: editFs + "px", lineHeight: editLh + "px", fontFamily: editFontStack === "" ? undefined : editFontStack } },
                    draft.split("\n").map(function (line, i) { return h("div", { key: i }, line === "" ? "\u200b" : line); }))),
                h("div", { className: "myt-editHint" },
                  tt("reader.bodyEditHint"),
                  " · " + tf("reader.wordsNoPunct", { n: fmtNum(draftWords) }),
                  " · " + tf("reader.wordsWithPunct", { n: fmtNum(draftAllChars) }),
                  autoSavedAt ? " · " + tf("reader.autoSaved", { time: autoSavedAt }) : null),
                ledgerHint && ledgerHint.missing && ledgerHint.missing.length
                  ? h("div", { className: "myt-ledgerHint", role: "status" },
                      h("span", null, tf("reader.ledgerMissing", { list: ledgerHint.missing.join("、") })),
                      h("button", { type: "button", className: "myt-btn myt-btnSm", onClick: function () { setLedgerHint(null); } }, tt("reader.ledgerDismiss")))
                  : null,
                bodyErr ? h(ErrorStrip, { text: bodyErr }) : null,
                bodyConflict ? h("div", { className: "myt-setActions" },
                  h("button", { type: "button", className: "myt-btn", disabled: bodyBusy, onClick: dropBodyDraft }, tt("edit.conflictDrop")),
                  h("button", { type: "button", className: "myt-btn myt-btnPrimary", disabled: bodyBusy, onClick: rebaseBodyDraft }, tt("edit.conflictKeep"))) : null,
                h("div", { className: "myt-setActions" },
                  h("button", { type: "button", className: "myt-btn", disabled: bodyBusy, onClick: cancelBodyEdit }, tt("novel.cancel")),
                  h("button", { type: "button", className: "myt-btn myt-btnPrimary", disabled: bodyBusy, onClick: saveBody }, bodyBusy ? tt("novel.saving") : tt("reader.save"))))))
        : h("div", { className: "myt-bodyEdit" },
            // 章节标题输入框（0.1.25）：与正文一次原子保存，非独立保存链
            h("input", { type: "text", className: "myt-chapterEditTitle", value: titleDraft,
              placeholder: tt("reader.titlePlaceholder"), "aria-label": tt("reader.titlePlaceholder"), spellCheck: false,
              onChange: function (e) { setTitleDraft(e.target.value); rememberDraft(draftRef.current, e.target.value); } }),
            // 工具行（0.1.26）：字号 A−/比例/A+ 与全屏开关，右对齐 muted 小字——
            // 独立成行放标题框与编辑区之间（不挤占全宽标题输入框）
            h("div", { className: "myt-editTools" },
              fsButtons(),
              h("span", { className: "myt-editToolsSep", "aria-hidden": "true" }, "｜"),
              h("button", { type: "button", className: "myt-btn",
                title: tt("reader.editFullscreen"), "aria-label": tt("reader.editFullscreen"),
                onClick: function () { setFsFull(true); } }, tt("reader.editFullscreen")),
              // 阅读模式：复用取消链路退只读（脏稿先确认 common.dirtyExit）
              h("span", { className: "myt-editToolsSep", "aria-hidden": "true" }, "｜"),
              h("button", { type: "button", className: "myt-btn",
                title: tt("reader.readMode"), "aria-label": tt("reader.readMode"),
                onClick: cancelBodyEdit }, tt("reader.readMode"))),
            // 行号栏 + 编辑区一体卡（0.1.26）：gutter 量出每逻辑行的视觉 offsetTop
            // 排号（镜像测量，见上方 effect），滚动用 transform 平移同步；隐藏
            // 镜像与 textarea 同排版规则，供测量，不渲染语义内容（aria-hidden）。
            h("div", { className: "myt-editWrap" },
              h("div", { className: "myt-editGutter", "aria-hidden": "true", style: { width: gutterCh + "ch", fontSize: editGutterFs + "px" } },
                h("div", { ref: gutterNumsRef, className: "myt-editNums" },
                  lineTops.map(function (top, i) { return h("span", { key: i, style: { top: top + "px", fontSize: editGutterFs + "px", lineHeight: editLh + "px" } }, String(i + 1)); }))),
              h("textarea", {
                ref: areaRef,
                className: "myt-chapterEditArea", rows: 20, spellCheck: false,
                style: { fontSize: editFs + "px", lineHeight: editLh + "px", fontFamily: editFontStack === "" ? undefined : editFontStack }, // 字体单源下发，系统默认不下发走 inherit
                value: draft, onChange: function (e) { autoHoldRef.current = false; setDraft(e.target.value); rememberDraft(e.target.value, titleRef.current); },
                onScroll: function (e) {
                  var g = gutterNumsRef.current; // 滚动同步：行号层随 scrollTop 平移
                  if (g && e.target) g.style.transform = "translateY(" + (-e.target.scrollTop) + "px)";
                },
                onKeyDown: function (e) {
                  if (e.key === "Escape" && fsFull) { e.preventDefault(); setFsFull(false); return; } // 全屏态 Esc 退出
                  // 回车 = 换行 + 段首两个全角空格（网文段落缩进惯例）；IME
                  // 组态中的回车是选词确认，不得劫持。
                  if (e.key !== "Enter") return;
                  if (e.keyCode === 229) return; // IME 组态中
                  if (e.nativeEvent && e.nativeEvent.isComposing) return; // 中文输入法回车选词
                  var ta = e.target;
                  var s = ta.selectionStart, en = ta.selectionEnd;
                  if (typeof s !== "number" || typeof en !== "number") return; // 退化环境交给默认
                  e.preventDefault();
                  // 优先走 execCommand 插入（0.5.1）：浏览器输入栈保留，Ctrl/⌘+Z 能撤回
                  // 上一个自然段；程序化换 value 会清空 undo 历史，写手最常用的撤销就废了。
                  var inserted = false;
                  try { inserted = !!(document.execCommand && document.execCommand("insertText", false, "\n　　")); } catch (err) { inserted = false; }
                  if (inserted) return; // 输入事件已驱动 onChange，光标位置由浏览器维护
                  var next = ta.value.slice(0, s) + "\n　　" + ta.value.slice(en);
                  pendingCaretRef.current = s + 3; // 退化路径：下一轮渲染后手动放光标（"\n" + 两个全角空格）
                  setDraft(next);
                },
              }),
              h("div", { ref: mirrorRef, className: "myt-editMirror", "aria-hidden": "true", style: { left: gutterCh + "ch", fontSize: editFs + "px", lineHeight: editLh + "px", fontFamily: editFontStack === "" ? undefined : editFontStack } },
                draft.split("\n").map(function (line, i) { return h("div", { key: i }, line === "" ? "\u200b" : line); }))),
            h("div", { className: "myt-editHint" },
              tt("reader.bodyEditHint"),
              " · " + tf("reader.wordsNoPunct", { n: fmtNum(draftWords) }), // 不含标点=CJK，与服务端全库字数/章节表同口径（0.1.23 实时、0.1.26 起双数并显）
              " · " + tf("reader.wordsWithPunct", { n: fmtNum(draftAllChars) }), // 含标点=去空白全部码点
              autoSavedAt ? " · " + tf("reader.autoSaved", { time: autoSavedAt }) : null),
            bodyErr ? h(ErrorStrip, { text: bodyErr }) : null,
            bodyConflict ? h("div", { className: "myt-setActions" },
              h("button", { type: "button", className: "myt-btn", disabled: bodyBusy, onClick: dropBodyDraft }, tt("edit.conflictDrop")),
              h("button", { type: "button", className: "myt-btn myt-btnPrimary", disabled: bodyBusy, onClick: rebaseBodyDraft }, tt("edit.conflictKeep"))) : null,
            h("div", { className: "myt-setActions" },
              h("button", { type: "button", className: "myt-btn", disabled: bodyBusy, onClick: cancelBodyEdit }, tt("novel.cancel")),
              h("button", { type: "button", className: "myt-btn myt-btnPrimary", disabled: bodyBusy, onClick: saveBody }, bodyBusy ? tt("novel.saving") : tt("reader.save")))));
      return h("div", {
        className: "myt-reader" + (focusOn ? " myt-focus" : ""),
        onTouchStart: onTouchStart,
        onTouchEnd: onTouchEnd,
      },
        h("div", { className: "myt-readerBar" },
          h("button", { type: "button", className: "myt-btn", onClick: leaveReader, title: tt("reader.backTip") },
            ic("IconChevronRightOutlineRegular", 13), tt("reader.back")),
          // 下一章（0.4.6）：顶栏不随正文滚动，读完一章直接点；末章禁用并说明
          h("button", {
            type: "button", className: "myt-btn",
            disabled: !nextCh || typeof props.onOpenChapter !== "function",
            title: nextCh ? tf("reader.nextTip", { name: chFullTitle(nextCh) }) : tt("reader.lastChapter"),
            "aria-label": nextCh ? tf("reader.nextTip", { name: chFullTitle(nextCh) }) : tt("reader.lastChapter"),
            onClick: goNextChapter,
          }, tt("reader.nextChapter")),
          h("button", {
            type: "button", className: "myt-btn",
            disabled: !prevCh || typeof props.onOpenChapter !== "function",
            title: prevCh ? tf("reader.prevTip", { name: chFullTitle(prevCh) }) : tt("reader.firstChapter"),
            "aria-label": prevCh ? tf("reader.prevTip", { name: chFullTitle(prevCh) }) : tt("reader.firstChapter"),
            onClick: goPrevChapter,
          }, tt("reader.prevChapter")),
          h("button", {
            type: "button", className: "myt-btn",
            title: tt("reader.pickTitle"), "aria-label": tt("reader.pickTitle"),
            onClick: openPicker,
          }, tt("reader.pickChapter")),
          h("h2", { className: "myt-readerTitle" }, ch ? chFullTitle(ch) : file),
          ch ? statusBadge(ch.status, snap && snap.project ? snap.project.mode : undefined) : null,
          gate ? (function () {
            var human = Math.round(gate.human);
            var det = gate.detector === null || gate.detector === undefined ? null : Math.round(gate.detector);
            var delta = gate.prev && typeof gate.prev.h === "number" ? human - Math.round(gate.prev.h) : null;
            var hookWarn = gate.hook && gate.hook.ok === false;
            var text = tt("gate.human") + " " + fmtNum(human)
              + (det === null ? "" : " · " + tt("gate.detector") + " " + fmtNum(det))
              + (delta === null || delta === 0 ? "" : " (" + (delta > 0 ? "+" : "") + delta + ")")
              + (hookWarn ? " · " + tt("gate.hookPlain") : "");
            var tip = tt("gate.historyTip")
              + (gate.hook ? "\n" + tf("gate.hookTip", { kind: tt("gate.hook." + (gate.hook.kind || "plain")) }) : "");
            return h("span", { className: "myt-gatePill", "data-warn": hookWarn ? "true" : undefined, title: tip }, text);
          })() : null,
          h("div", { className: "myt-readerBarActions" },
            !editing && detail !== null && detail.data !== null && !detail.err ? h("button", {
              type: "button", className: "myt-btn myt-copyBtn",
              title: tt("reader.editTip"), "aria-label": tt("reader.editTip"),
              onClick: startBodyEdit,
            }, ic("IconEditOutlineRegular", 13), tt("reader.edit")) : null,
            h("button", {
              type: "button", className: "myt-btn myt-copyBtn",
              title: tt("reader.copyChapterTip"), "aria-label": tt("reader.copyChapterTip"),
              onClick: copyChapterAll,
            }, ic("IconCopyOutlineRegular", 13), tt("reader.copyChapter")),
            h("button", {
              type: "button", className: "myt-btn",
              title: tt("reader.historyTitle"), "aria-label": tt("reader.historyTitle"),
              onClick: openVersions,
            }, tt("reader.history")),
            h("button", {
              type: "button", className: "myt-btn",
              title: speaking ? tt("reader.ttsStop") : tt("reader.tts"), "aria-label": speaking ? tt("reader.ttsStop") : tt("reader.tts"),
              onClick: speakChapter,
            }, speaking ? tt("reader.ttsStop") : tt("reader.tts")),
            gate && gate.canUndo ? h("button", {
              type: "button", className: "myt-btn",
              title: tt("gate.undoTip"), "aria-label": tt("gate.undoTip"),
              disabled: editing,
              onClick: function () { setUndoOpen(true); },
            }, tt("gate.undo")) : null,
            h("button", {
              type: "button", className: "myt-btn",
              title: tt("gate.fixAllTip"), "aria-label": tt("gate.fixAllTip"),
              disabled: editing || fixAllBusy || !gate || !gate.flags || gate.flags.length === 0,
              onClick: applyFixAll,
            }, fixAllBusy ? tt("gate.fixAllBusy") : tt("gate.fixAll")),
            h("button", {
              type: "button", className: "myt-btn",
              title: tt("handoff.tip"), "aria-label": tt("handoff.tip"),
              onClick: function () { setHandoffOpen(true); },
            }, tt("handoff.open")),
            h("button", {
              type: "button", className: "myt-btn",
              title: tt("split.tip"), "aria-label": tt("split.tip"),
              onClick: function () { setSplitView(function (v) { return !v; }); },
            }, splitView ? tt("split.off") : tt("split.on")),
            h(BriefMenu, { file: file, title: ch ? chFullTitle(ch) : file }),
            h("button", {
              type: "button", className: "myt-btn myt-copyBtn",
              title: tt("reader.copyPathTip"), "aria-label": tt("reader.copyPathTip"),
              onClick: copyChapterPath,
            }, ic("IconCopyOutlineRegular", 13), tt("reader.copyPath")),
            // 删除章节（0.1.20 写面）：服务端不做二次确认，弹层在下方强制；
            // 删除成功 → 重拉快照 + 退出阅读页回列表（章节已不存在）。
            h("button", {
              type: "button", className: "myt-btn myt-btnDanger",
              title: tt("reader.deleteChapter"), "aria-label": tt("reader.deleteChapter"),
              onClick: function () { setDelChapterOpen(true); },
            }, tt("reader.deleteChapter")))),
        gate && gate.flags && gate.flags.length ? h("details", { className: "myt-gateTips" },
          h("summary", null, tf("gate.tipsTitle", { n: gate.flags.length })),
          h("ol", null, gate.flags.slice(0, 8).map(function (f, i) {
            return h("li", { key: i },
              h("span", { className: "myt-gateTipText" }, truncate(f.text, 56)),
              h("span", { className: "myt-gateTipWhy" }, (f.flags || []).map(function (x) { return x.hit; }).join("、")),
              h("button", {
                type: "button", className: "myt-btn myt-gateFixBtn", disabled: editing,
                title: editing ? tt("gate.fixEditing") : tt("gate.fixTip"),
                onClick: function () { applyFix(f.text); },
              }, tt("gate.fix")));
          }))) : null,
        gate && gate.heat && gate.heat.length ? h(HeatStrip, { heat: gate.heat }) : null,
        h("div", { className: "myt-boardChips" },
          h("button", { type: "button", className: "myt-chipBtn myt-chipPrimary", title: tt("reader.board"), onClick: function () { openBoard(); } }, tt("reader.board")),
          h("button", { type: "button", className: "myt-chip", title: tt("board.targetLabel"), onClick: function () { openBoard("beats"); } }, tf("board.target", { n: fmtNum(targetWords) })),
          outlineBeatList.length ? h("button", { type: "button", className: "myt-chip", onClick: function () { openBoard("beats"); } }, tt("board.beats") + " " + beatsOk + "/" + outlineBeatList.length) : null,
          chapterForeshadows.length ? h("button", { type: "button", className: "myt-chip", onClick: function () { openBoard("foreshadow"); } }, tt("board.foreshadow") + " " + chapterForeshadows.length) : null,
          castCards.length ? h("button", { type: "button", className: "myt-chip", onClick: function () { openBoard("chars"); } }, tt("board.chars") + " " + castCards.length) : null,
          editing && sessionStart ? h("span", { className: "myt-chip myt-chipSession" }, tf("reader.session", { n: fmtNum(sessionWords), m: sessionMin })) : null),
        recovery ? h("div", { className: "myt-recoverStrip" },
          h("div", { className: "myt-recoverHead" }, tt("reader.recoverTitle")),
          h("div", { className: "myt-recoverText" }, tf("reader.recoverText", { time: new Date(recovery.at || Date.now()).toLocaleTimeString(), n: fmtNum(countCjkText(recovery.body)) })),
          h("div", { className: "myt-setActions" },
            h("button", { type: "button", className: "myt-btn myt-btnPrimary", onClick: restoreRecovery }, tt("reader.recoverRestore")),
            h("button", { type: "button", className: "myt-btn", onClick: clearRecoverDraft }, tt("reader.recoverDiscard")))) : null,
        h("div", { className: "myt-readerBody", "data-split": splitView ? "true" : "false" },
          !detail || detail.loading ? h("div", { className: "myt-stack" }, h("div", { className: "myt-skel myt-skelRow" }), h("div", { className: "myt-skel myt-skelRow", style: { width: "80%" } }), h("div", { className: "myt-skel myt-skelRow", style: { width: "64%" } }))
            : detail.err ? h(ErrorStrip, { text: tf("reader.loadFailed", { msg: detail.err }), onRetry: function () { loadDetail(file); } })
              : [
                  (function () {
                    var ol = detail.data && detail.data.outline;
                    return ol ? h(OutlinePanel, { key: "outline", outline: ol, editor: outlineEditor(), onDelete: stemOk ? function () { setDelOutlineOpen(true); } : null })
                      : [
                          h("div", { key: "outline-none", className: "myt-outlineEmpty" }, tt("reader.noOutline")),
                          // 新建章纲（0.1.20 写面）：outlines/<stem>.md 原不存在才走到
                          // 这里；预填五件内容骨架，建好即重拉详情点亮章纲对照栏。
                          stemOk ? h("button", {
                            key: "outline-create", type: "button", className: "myt-btn",
                            disabled: coBusy, title: tt("reader.createOutline"), "aria-label": tt("reader.createOutline"),
                            onClick: createOutline,
                          }, coBusy ? tt("src.creating") : tt("reader.createOutline")) : null,
                        ];
                  })(),
                  editing ? bodyEditNode
                    : h(BodyPanel, {
                      key: "body",
                      body: (detail.data && detail.data.body) || tt("reader.emptyBody"),
                      words: ch && typeof ch.words === "number" ? ch.words : undefined,
                      fontFamily: editFontStack,
                    }),
                ],
          ch ? h("div", { className: "myt-dimGrid" }, FIVE_DIMS.map(function (dim) {
            return h("div", { key: dim[0], className: "myt-dim" },
              h("div", { className: "myt-dimLabel" }, dim[1]),
              h("div", { className: "myt-dimText" }, orDash(ch[dim[0]])));
          })) : null),
        ch ? h("div", { className: "myt-readerFoot" },
          (function () {
            var idx = STATUS_FLOW.indexOf(ch.status);
            var next = idx !== -1 && idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx + 1] : null;
            if (!next) return h("span", { className: "myt-muted" }, tt("reader.finalState"));
            return [h("span", { className: "myt-muted", key: "t" }, tt("reader.statusFlow")),
              h("button", { key: "b", type: "button", className: "myt-btn myt-btnPrimary", disabled: flowBusy, onClick: advance },
                flowBusy ? tt("reader.flowing") : tf("reader.advanceTo", { next: tt("status." + next) })),
              h("button", { key: "sa", type: "button", className: "myt-btn", disabled: flowBusy, onClick: saveAndAdvance, title: tt("reader.saveNext") },
                flowBusy ? tt("reader.flowing") : tf("reader.advanceNext", { next: tt("status." + next) }))];
          })()) : null,
        h("div", { className: "myt-writeBar" },
          h("button", { type: "button", className: "myt-btn myt-btnPrimary", disabled: bodyBusy, onClick: editing ? saveBody : startBodyEdit },
            bodyBusy ? tt("novel.saving") : editing ? tt("reader.save") : tt("reader.edit")),
          h("button", { type: "button", className: "myt-btn", disabled: !prevCh, onClick: goPrevChapter }, tt("reader.prevChapter")),
          h("button", { type: "button", className: "myt-btn", disabled: !nextCh, onClick: goNextChapter }, tt("reader.nextChapter")),
          h("button", { type: "button", className: "myt-btn", onClick: function () { openBoard(); } }, tt("reader.board")),
          h("button", { type: "button", className: "myt-btn", onClick: function () { setFocusOn(function (v) { return !v; }); } }, focusOn ? tt("reader.exitFocus") : tt("reader.focus"))),
        boardOpen ? h(MaskPortal, { className: "myt-boardMask", onMouseDown: function (e) { if (e.target === e.currentTarget) setBoardOpen(false); } },
          h("aside", { className: "myt-board", role: "dialog", "aria-modal": "true", "aria-label": tt("board.title") },
            h("div", { className: "myt-boardHead" },
              h("div", { className: "myt-boardTabs" }, [["beats", tt("board.beats")], ["foreshadow", tt("board.foreshadow")], ["chars", tt("board.chars")], ["words", tt("board.words")], ["check", tt("board.check")]].map(function (t) {
                return h("button", { key: t[0], type: "button", className: "myt-boardTab", "data-active": boardTab === t[0] ? "true" : undefined, onClick: function () { setBoardTab(t[0]); } }, t[1]);
              })),
              h("button", { type: "button", className: "myt-btn myt-btnIcon", title: tt("board.close"), "aria-label": tt("board.close"), onClick: function () { setBoardOpen(false); } }, "×")),
            h("div", { className: "myt-boardBody" }, boardContent()))) : null,
        handoffOpen ? h(HandoffModal, { wsPath: wsPath, file: file, onClose: function () { setHandoffOpen(false); } }) : null,
        versionsOpen ? h(MaskPortal, { className: "myt-boardMask", onMouseDown: function (e) { if (e.target === e.currentTarget) setVersionsOpen(false); } },
          h("aside", { className: "myt-board myt-versionPanel", role: "dialog", "aria-modal": "true", "aria-label": tt("reader.historyTitle") },
            h("div", { className: "myt-boardHead" },
              h("strong", null, tt("reader.historyTitle")),
              h("button", { type: "button", className: "myt-btn myt-btnIcon", "aria-label": tt("board.close"), onClick: function () { setVersionsOpen(false); } }, "×")),
            h("div", { className: "myt-boardBody" },
              versionsBusy ? h("div", { className: "myt-muted" }, tt("common.loading"))
                : versionView ? [
                    h("div", { key: "meta", className: "myt-muted" }, new Date(versionView.at).toLocaleString() + " · " + tf("reader.historyWords", { n: fmtNum(versionView.words) })),
                    h("pre", { key: "text", className: "myt-versionText" }, versionView.text),
                    h("div", { key: "act", className: "myt-setActions" },
                      h("button", { type: "button", className: "myt-btn", onClick: function () { setVersionView(null); } }, tt("reader.back")),
                      h("button", { type: "button", className: "myt-btn myt-btnPrimary", onClick: restoreVersion }, tt("reader.historyLoad"))),
                  ]
                : versionList && versionList.length ? h("div", { className: "myt-versionList" }, versionList.map(function (v, i) {
                    return h("button", { key: v.id || i, type: "button", className: "myt-versionRow", onClick: function () { loadVersion(v); } },
                      h("span", null, new Date(v.at).toLocaleString()),
                      h("span", { className: "myt-muted" }, tf("reader.historyWords", { n: fmtNum(v.words) })));
                  })) : h("div", { className: "myt-muted" }, tt("reader.historyEmpty"))))) : null,
        pickerOpen ? h(MaskPortal, { className: "myt-boardMask", onMouseDown: function (e) { if (e.target === e.currentTarget) setPickerOpen(false); } },
          h("div", { className: "myt-modal myt-picker", role: "dialog", "aria-modal": "true", "aria-label": tt("reader.pickTitle") },
            h("div", { className: "myt-boardHead" },
              h("strong", null, tt("reader.pickTitle")),
              h("button", { type: "button", className: "myt-btn myt-btnIcon", "aria-label": tt("board.close"), onClick: function () { setPickerOpen(false); } }, "×")),
            h("input", { className: "myt-setInput", value: pickerQuery, placeholder: tt("reader.pickFilter"), onChange: function (e) { setPickerQuery(e.target.value); } }),
            h("div", { className: "myt-pickerList" }, pickerItems.length === 0 ? h("div", { className: "myt-muted" }, tt("common.empty")) : pickerItems.map(function (c) {
              return h("button", { key: c.file, type: "button", className: "myt-pickerRow", "data-current": c.file === file ? "true" : undefined, onClick: function () { jumpToChapter(c.file); } },
                h("span", null, chFullTitle(c)),
                h("span", { className: "myt-muted" }, c.file));
            })))) : null,
        undoOpen ? h(ConfirmModal, {
          title: tt("gate.undoTitle"),
          text: tt("gate.undoText"),
          onCancel: function () { setUndoOpen(false); },
          onConfirm: runUndo,
        }) : null,
        fixAllOpen ? h(ConfirmModal, {
          title: tt("gate.fixAllTitle"),
          text: tf("gate.fixAllText", { n: gate && gate.flags ? gate.flags.length : 0 }),
          onCancel: function () { if (!fixAllBusy) setFixAllOpen(false); },
          onConfirm: runFixAll,
        }) : null,
        delChapterOpen ? h(ConfirmModal, {
          title: tt("reader.deleteChapter"),
          text: tf("src.confirmText", { rel: "chapters/" + file }),
          onCancel: function () { setDelChapterOpen(false); },
          onConfirm: function () {
            return apiPost("file-delete", { path: wsPath, rel: "chapters/" + file }).then(function () {
              setDelChapterOpen(false);
              return reload().then(onBack); // 章已删：重拉快照后退出阅读页回列表
            });
          },
        }) : null,
        delOutlineOpen ? h(ConfirmModal, {
          title: tt("outline.deleteBtn"),
          text: tf("src.confirmText", { rel: "outlines/" + stem + ".md" }),
          onCancel: function () { setDelOutlineOpen(false); },
          onConfirm: function () {
            return apiPost("file-delete", { path: wsPath, rel: "outlines/" + stem + ".md" }).then(function () {
              setDelOutlineOpen(false);
              return reload().then(function () { return loadDetail(file); }); // 章纲栏熄灭、空态亮出
            });
          },
        }) : null);
    }

    // ── 书稿元信息编辑表单（概览「编辑」按钮展开）：可视化 project.yml 平
    // 键并保存。mode/phase 走枚举下拉，自由文本走输入框；保存走 project-save
    // 路由（服务端校验 + 保注释改写），成功后重拉快照并经 onDone 退出编辑态。
    // 表单初值（与磁盘真值同源）：首次载入与 409 重置共用同一形状。
    function settingsFormOf(project) {
      project = project || {};
      return {
        title: project.title || "", author: project.author || "", genre: project.genre || "",
        length: project.length || "", language: project.language || "zh",
        phase: PHASES.indexOf(project.phase) !== -1 ? project.phase : "idea",
        mode: project.mode || "ai-draft",
        description: project.description || "",
      };
    }
    // 快照 root 与工作区 path 同源但形态可能有差（尾斜杠等），比对前归一。
    function normRoot(s) { return String(s || "").replace(/[\\/]+$/, ""); }
    function ProjectMetaForm(props) {
      var snap = props.snap;
      var wsPath = props.wsPath;
      var reload = props.reload;
      var onDone = props.onDone;
      var project = snap.project || {};
      var _f = useState(function () { return settingsFormOf(project); }), form = _f[0], setForm = _f[1];
      // 保存基线：表单载入时的 project.yml 指纹（snap.project_hash）。服务端
      // 拿它检测表单载入后的外部改动（作者手改 / agent 推进 phase），命中即
      // 409 拒写——没有它，保存会静默覆盖同名键、丢掉人工改动。
      var baseHashRef = useRef(snap && typeof snap.project_hash === "string" ? snap.project_hash : null);
      // 409 后的一次性重置标记：reload 带回新快照时把表单与基线放回磁盘真值。
      // 只在保存失败路径置位——顶栏刷新等其他 reload 不碰正在编辑的表单。
      var pendingResetRef = useRef(false);
      useEffect(function () {
        var hash = snap && typeof snap.project_hash === "string" ? snap.project_hash : null;
        if (pendingResetRef.current) {
          pendingResetRef.current = false;
          setForm(settingsFormOf(snap && snap.project));
          baseHashRef.current = hash;
          return;
        }
        // 空闲跟随：快照确属当前工作区（root 对得上，跨工作区切换的在途旧
        // 快照不认）且表单未被用户动过（与磁盘逐键同值）时，把基线对齐本快照
        // ——本组件不随工作区切换重挂，基线若还攥着旧工作区的 hash，保存必被
        // 自家 409 拦住（假冲突）。用户已编辑则不打扰，外部改动由保存 409 兜底。
        if (!snap || !snap.found || normRoot(snap.root) !== normRoot(wsPath)) return;
        var disk = settingsFormOf(snap.project);
        for (var k in disk) {
          if (String(form[k]) !== String(disk[k])) return;
        }
        baseHashRef.current = hash;
      }, [snap, wsPath]);
      var _b = useState(false), busy = _b[0], setBusy = _b[1];
      var _e = useState(""), saveErr = _e[0], setSaveErr = _e[1];
      // 脏检查：表单与磁盘初值（进入编辑态时的 project 快照）逐键比对，任一
      // 不同即脏——取消退出确认与 Shell 切 tab 拦截共用。上报卸载即清零。
      var diskForm = settingsFormOf(project);
      var dirty = (function () {
        for (var k in diskForm) { if (String(form[k]) !== String(diskForm[k])) return true; }
        return false;
      })();
      useEffect(function () {
        DIRTY_EXIT.dirty = dirty;
        return function () { DIRTY_EXIT.dirty = false; };
      });
      function set(k, v) { setForm(Object.assign({}, form, (function () { var o = {}; o[k] = v; return o; })())); }
      function save() {
        if (busy) return;
        if (!String(form.title || "").trim()) { setSaveErr(tt("novel.titleRequired")); return; }
        setBusy(true); setSaveErr("");
        // 失败经卡内 saveErr 呈现（silent 抑制 apiPost 同文 toast）；成功提示仍走 toast。
        apiPost("project-save", { path: wsPath, values: form, base_hash: baseHashRef.current }, { silent: true }).then(function (res) {
          // 写后指纹即下一轮基线：不等 reload 快照就先接住——连续两次保存时
          // 第二次若还回传载入时的旧指纹，会被自家 409 拦住（假冲突）。
          if (res && typeof res.project_hash === "string") baseHashRef.current = res.project_hash;
          return reload();
        }).catch(function (err) {
          setSaveErr(err.message);
          // 409 = project.yml 在表单载入后被外部改过：重拉快照并一次性把表单
          // 放回磁盘真值，别让用户在过期基线上继续盲改。其他失败（网络抖动
          // 等）不动表单，保留正在编辑的内容。
          if (err && err.status === 409) {
            pendingResetRef.current = true;
            reload();
          }
        }).finally(function () { setBusy(false); });
      }
      function field(label, key, placeholder, textarea) {
        var value = form[key] || "";
        return h("label", { className: "myt-setField" },
          h("span", { className: "myt-setFieldLabel" }, label),
          textarea
            ? h("textarea", { className: "myt-setInput myt-setArea", rows: 3, placeholder: placeholder, value: value,
                onChange: function (e) { set(key, e.target.value); } })
            : h("input", { type: "text", className: "myt-setInput", placeholder: placeholder, value: value,
                onChange: function (e) { set(key, e.target.value); } }));
      }
      function picker(label, key, opts) {
        var value = form[key] || "";
        return h("label", { className: "myt-setField" },
          h("span", { className: "myt-setFieldLabel" }, label),
          h("select", { className: "myt-setInput myt-setSelect", value: value, onChange: function (e) { set(key, e.target.value); } },
            opts.map(function (o) { return h("option", { key: o[0], value: o[0] }, o[1]); })));
      }
      function cancel() {
        if (busy) return; // 保存在途不许退出：避免卸载后 setState
        if (dirty && !window.confirm(tt("common.dirtyExit"))) return; // 脏退出先确认
        onDone();
      }
      return h("div", { className: "myt-stack" },
        h("div", { className: "myt-card" },
          h("div", { className: "myt-cardHead" },
            h("h3", { className: "myt-cardTitle" }, tt("novel.metaTitle")),
            h("span", { className: "myt-muted" }, tt("novel.metaNote"))),
          h("div", { className: "myt-setGrid" },
            field(tt("novel.fTitle"), "title", tt("novel.titlePh")),
            field(tt("novel.fAuthor"), "author", tt("novel.authorPh")),
            field(tt("novel.fGenre"), "genre", tt("novel.genrePh")),
            field(tt("novel.fLength"), "length", tt("novel.lengthPh")),
            picker(tt("novel.fLanguage"), "language", [["zh", "中文"], ["en", "English"], ["ja", "日本語"]]),
            picker(tt("novel.fPhase"), "phase", PHASES.map(function (p) { return [p, tt("phase." + p)]; })),
            picker(tt("novel.fMode"), "mode", [["ai-draft", tt("mode.aiDraft")], ["co-write", tt("mode.coWrite")], ["author-draft", tt("mode.authorDraft")]]),
            field(tt("novel.fDesc"), "description", tt("novel.descPh"), true))),
        saveErr ? h(ErrorStrip, { text: saveErr }) : null,
        h("div", { className: "myt-setActions" },
          h("button", { type: "button", className: "myt-btn", disabled: busy, onClick: cancel },
            tt("novel.cancel")),
          h("button", { type: "button", className: "myt-btn myt-btnPrimary", disabled: busy, onClick: save },
            busy ? tt("novel.saving") : tt("novel.save"))));
    }

    // ── 章节 tab：状态筛选 pills + 表格 + 行抽屉（正文阅读/编辑 + 五维 + 流转）────
    var FIVE_DIMS = [
      ["cognitive_frame", tt("dim.cognitiveFrame")], ["emotional_anchor", tt("dim.emotionalAnchor")], ["world_texture", tt("dim.worldTexture")],
      ["suspense", tt("dim.suspense")], ["interpersonal_tension", tt("dim.interpersonalTension")],
    ];
    // 章纲对照栏（五期）：outline 非空时渲染可折叠原文（默认展开，样式与正文
    // 区分）；共享常量避免重渲染时折叠态意外重置——组件随抽屉挂载，切章即重
    // 挂回默认展开。0.1.19 起带编辑钩子（editor 由 ChapterReader 注入，null =
    // 只读）：编辑态整段 textarea 替换 MdView，保存走 outline-save（hash 旧版
    // 检测）；无章纲不给编辑入口（v1 不做面板新建章纲文件）。
    // ── 正文面板（0.4.5）：与章纲对照同一个折叠范式 ──────────────────────
    // 长章节在手机上把整页拉成一条长龙；头一行「正文 · 字数」，点开/点收，
    // 展开时容器给足高度（窄屏 72vh）内部滚动。默认展开——进来就是要读正文；
    // 折叠态用面板根 data-open 交给 CSS 判（老 WebView 未必支持 :has）。
    function BodyPanel(props) {
      var _b = useState(true), open = _b[0], setOpen = _b[1];
      return h("div", { className: "myt-bodyPanel", "data-open": open ? "true" : "false" },
        h("button", {
          type: "button", className: "myt-bodyHead",
          "aria-expanded": open ? "true" : "false",
          title: open ? tt("reader.collapseBody") : tt("reader.expandBody"),
          onClick: function () { setOpen(!open); },
        },
          h("span", { className: "myt-bodyTitle" }, tt("reader.bodyPanel")),
          typeof props.words === "number" ? h("span", { className: "myt-bodyWords" }, tf("common.charCount", { n: fmtNum(props.words) })) : null,
          h("span", { className: "myt-bodyChevron", "aria-hidden": "true" },
            ic(open ? "IconChevronDownOutlineRegular" : "IconChevronRightOutlineRegular", 14))),
        open ? h("pre", {
          className: "myt-chapterBody",
          style: { fontFamily: props.fontFamily === "" ? undefined : props.fontFamily },
        }, props.body) : null);
    }

    // ── 通用长文折叠块（0.4.11）───────────────────────────────────────────
    // 分卷规划/写作风格/时间线/索引板/伏笔看板这些「几百到几千字」的块，平铺
    // 出来在手机上比正文还长（用户实拍：分卷规划三卷滚半天）。跟正文/章纲同
    // 一个范式：头一行可点收起/展开，展开时内容装进带边框方框自己滚
    // （CSS .myt-cbBody，高 --myt-box-h）。
    // extra 是头部右侧的动作位（编辑源文件/重建索引/新建…）。head 里不能套
    // <button>，所以 toggle 只包标题/计数/箭头，extra 作为兄弟节点渲染。
    // 默认展开：进来就是要看内容；收起是用户主动的动作。
    function CollapseBox(props) {
      var _o = useState(props.defaultOpen !== false), open = _o[0], setOpen = _o[1];
      return h("div", { className: "myt-card myt-cbBox" + (props.full ? " myt-cbFull" : "") + (props.className ? " " + props.className : ""), "data-open": open ? "true" : "false" },
        h("div", { className: "myt-cbHead" },
          h("button", {
            type: "button", className: "myt-cbToggle",
            "aria-expanded": open ? "true" : "false",
            title: open ? tt("common.collapse") : tt("common.expand"),
            onClick: function () { setOpen(!open); },
          },
            h("h3", { className: "myt-cbTitle" }, props.title),
            props.meta !== undefined && props.meta !== null && props.meta !== ""
              ? h("span", { className: "myt-cbMeta" }, String(props.meta)) : null,
            h("span", { className: "myt-cbChevron", "aria-hidden": "true" },
              ic(open ? "IconChevronDownOutlineRegular" : "IconChevronRightOutlineRegular", 14))),
          props.extra ? h("div", { className: "myt-cbExtra" }, props.extra) : null),
        open ? h("div", { className: "myt-cbBody" }, props.children) : null);
    }

    function OutlinePanel(props) {
      var outline = props.outline;
      var ed = props.editor || null; // { active, draft, busy, err, start, change, cancel, save }
      var _op = useState(true), openState = _op[0], setOpen = _op[1];
      var open = ed !== null && ed.active === true ? true : openState; // 编辑态强制展开
      // 0.4.4 窄实例默认收起：章纲对照与正文抢高度，手机上正文只剩一行。判据是
      // **自身实宽**（手机中栏、桌面上拖窄的右栏都算），不用窗口宽；布局前测量
      // （useLayoutEffect）故收起发生在首帧之前，不闪一下再收。宽实例维持默认
      // 展开；用户点头部自行展开，折叠态不做跨章记忆（组件随章重挂回判据值）。
      var panelRef = useRef(null);
      useLayoutEffect(function () {
        var el = panelRef.current;
        if (!el) return;
        var w = el.clientWidth;
        if (w > 0 && w < 560) setOpen(false);
      }, []);
      var body = outline && typeof outline.body === "string" && outline.body.trim() !== "" ? outline.body : tt("outline.empty");
      return h("div", { className: "myt-outlinePanel", ref: panelRef },
        h("button", {
          type: "button", className: "myt-outlineHead",
          "aria-expanded": open ? "true" : "false",
          title: open ? tt("outline.collapseTip") : tt("outline.expandTip"),
          onClick: function () { setOpen(!openState); },
        },
          h("span", { className: "myt-outlineTitle" }, tt("outline.title")),
          typeof (outline && outline.words) === "number" ? h("span", { className: "myt-outlineWords" }, tf("common.charCount", { n: fmtNum(outline.words) })) : null,
          // 编辑入口：head 是 <button>，里面不能再套 button——span + role 补键盘语义
          ed !== null && !ed.active ? h("span", {
            className: "myt-outlineEditBtn", role: "button", tabIndex: 0,
            title: tt("outline.editTip"), "aria-label": tt("outline.editTip"),
            onClick: function (e) { e.stopPropagation(); ed.start(); },
            onKeyDown: function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); ed.start(); } },
          }, ic("IconEditOutlineRegular", 12), tt("reader.edit")) : null,
          // 删除章纲（0.1.20 写面）：同 head-span 形态；确认弹层由 ChapterReader 渲染。
          props.onDelete && ed !== null && !ed.active ? h("span", {
            className: "myt-outlineEditBtn myt-outlineDelBtn", role: "button", tabIndex: 0,
            title: tt("outline.deleteBtn"), "aria-label": tt("outline.deleteBtn"),
            onClick: function (e) { e.stopPropagation(); props.onDelete(); },
            onKeyDown: function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); props.onDelete(); } },
          }, tt("outline.deleteBtn")) : null,
          h("span", { className: "myt-outlineChevron", "aria-hidden": "true" },
            ic(open ? "IconChevronDownOutlineRegular" : "IconChevronRightOutlineRegular", 14))),
        open ? (ed !== null && ed.active
          ? h("div", { className: "myt-outlineEdit" },
              h("textarea", {
                className: "myt-setInput myt-setArea myt-outlineArea", rows: 10, spellCheck: false,
                value: ed.draft, onChange: function (e) { ed.change(e.target.value); },
              }),
              h("div", { className: "myt-editHint" }, tt("outline.editHint")),
              ed.err ? h(ErrorStrip, { text: ed.err }) : null,
              ed.conflict ? h("div", { className: "myt-setActions" },
                h("button", { type: "button", className: "myt-btn", disabled: ed.busy, onClick: ed.drop }, tt("edit.conflictDrop")),
                h("button", { type: "button", className: "myt-btn myt-btnPrimary", disabled: ed.busy, onClick: ed.rebase }, tt("edit.conflictKeep"))) : null,
              h("div", { className: "myt-setActions" },
                h("button", { type: "button", className: "myt-btn", disabled: ed.busy, onClick: ed.cancel }, tt("novel.cancel")),
                h("button", { type: "button", className: "myt-btn myt-btnPrimary", disabled: ed.busy, onClick: ed.save }, ed.busy ? tt("novel.saving") : tt("reader.save"))))
          : h(MdView, { text: body, className: "myt-outlineBody" })) : null);
    }
    // 弹层门户：portal 进所属实例根（InstanceScope 提供的 DOM 节点），弹层
    // absolute inset:0 铺满实例、居中基准随实例走——多实例并存（中栏 overlay
    // 与右侧栏 tab 同屏）互不干扰。旧方案 portal 到 document.body + fixed，
    // 靠全局 --myt-anchor-*/--myt-mask-* 变量描述锚区（多实例互踩），且中栏
    // transform/overflow 会把 fixed 劫持成相对自身并连同裁剪（桌面端「点了
    // 没反应」实测病灶）。取不到门户目标（老宿主无 createPortal / provider
    // 缺位）退回原地渲染：absolute 相对最近定位祖先，行为可接受。
    var InstanceContext = React.createContext ? React.createContext(null) : null;
    // 实例作用域：每份面板挂载（overlay 容器 / 右侧栏 tab 正文）包一层，把
    // 根 DOM 节点作为弹层门户目标发给子树；首帧 el 未就绪先渲染空根，ref
    // 回调触发二渲染后再放行 children。
    function InstanceScope(props) {
      var _el = useState(null), el = _el[0], setEl = _el[1];
      return h(InstanceContext.Provider, { value: el },
        h("div", { ref: setEl, className: props.className },
          el ? props.children : null));
    }
    function MaskPortal(props) {
      var target = useContext && InstanceContext ? useContext(InstanceContext) : null;
      var node = h("div", props);
      if (ReactDOMClient && typeof ReactDOMClient.createPortal === "function" && target) {
        return ReactDOMClient.createPortal(node, target);
      }
      return node;
    }

    // ── 章纲全文弹层（0.1.15）：按单写作的孤儿章纲行点击展开——GET outline
    // 路由取全文，MdView 渲染，words 一并显示；加载中/失败给简单文案，失败
    // 态可重试。请求序号防快速开关弹层时的过期响应（对照 ChapterReader）。──
    function OutlineModal(props) {
      var wsPath = props.wsPath;
      var file = props.file;
      var onClose = props.onClose;
      var _d = useState(null), detail = _d[0], setDetail = _d[1]; // {loading, data, err}
      var seqRef = useRef(0);
      var load = useCallback(function (f) {
        var seq = ++seqRef.current;
        if (!f) { setDetail(null); return; }
        setDetail({ loading: true, data: null, err: "" });
        apiGet("outline", { path: wsPath, file: f }).then(function (d) {
          if (seq !== seqRef.current) return; // 过期响应：弹层已换文件/关闭，丢弃
          setDetail({ loading: false, data: d, err: "" });
        }).catch(function (err) {
          if (seq !== seqRef.current) return;
          setDetail({ loading: false, data: null, err: err.message });
        });
      }, [wsPath]);
      useEffect(function () { load(file); }, [file, load]);
      var words = detail && detail.data && typeof detail.data.words === "number" ? detail.data.words : null;
      return h(MaskPortal, {
        className: "myt-modalMask",
        onMouseDown: function (e) { if (e.target === e.currentTarget) onClose(); },
      },
        h("div", { className: "myt-modalCard", role: "dialog", "aria-modal": "true", "aria-label": tt("outline.modalAria") },
          h("div", { className: "myt-modalHead" },
            h("h2", { className: "myt-modalTitle" }, props.title || file),
            h("div", { className: "myt-heroMeta" },
              words !== null ? h("span", { className: "myt-outlineWords" }, tf("common.charCount", { n: fmtNum(words) })) : null,
              h("button", { type: "button", className: "myt-closeBtn", "aria-label": tt("outline.closeAria"), onClick: onClose }, h("span", { className: "myt-closeGlyph", "aria-hidden": "true" }, "×")))),
          h("div", { className: "myt-modalBody" },
            !detail || detail.loading ? h("div", { className: "myt-muted" }, tt("outline.loading"))
              : detail.err ? h(ErrorStrip, { text: tf("outline.loadFailed", { msg: detail.err }), onRetry: function () { load(file); } })
                : h(MdView, { text: (detail.data && detail.data.body) || tt("outline.empty"), className: "myt-outlineBody" }))));
    }

    // ── 受管文件通用弹层三件套（0.1.20「全量可编辑写面」）────────────────────
    // 新建实体卡的预填模板（服务端只验形状，内容由客户端模板兜底——spec 各
    // 文件的最小骨架；数据文件按约定中文书写，不随界面语言切换）。
    var MANAGED_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/; // 与服务端 managedRelCheck 同一条正则
    var TPL_CHARACTER = "---\nname: \nrole: supporting\n---\n\n";
    var TPL_WORLD = "---\ncategory: 地点\n---\n\n";
    var TPL_SCIENCE = "---\nlabel: known\n---\n\n";
    function outlineTemplateOf(ch, stem) {
      var num = ch && ch.num ? ch.num : ((stem.match(/c(\d+)/i) || [])[1] || "?");
      var title = ch && ch.title ? " " + ch.title : "";
      return "# 第" + num + "章" + title + " 章纲\n\n- 本章目标：\n- 节拍：\n- 出场角色：\n- 需埋/需收伏笔：\n- 与前章接口：\n";
    }
    // 各 tab 复用的「编辑源文件 / 删除文件」小按钮：title 点名文件路径，
    // 删除走红色按钮（确认弹层由调用方持 state 渲染）。
    function srcEditBtn(rel, onOpen) {
      return h("button", {
        type: "button", className: "myt-btn",
        title: tf("src.editSourceTip", { rel: rel }), "aria-label": tf("src.editSourceTip", { rel: rel }),
        onClick: onOpen,
      }, ic("IconEditOutlineRegular", 13), tt("src.editSource"));
    }
    function srcDeleteBtn(rel, onAsk) {
      return h("button", {
        type: "button", className: "myt-btn myt-btnDanger",
        title: tf("src.deleteTip", { rel: rel }), "aria-label": tf("src.deleteTip", { rel: rel }),
        onClick: onAsk,
      }, tt("src.deleteFile"));
    }
    // 编辑既有受管文件全文。打开即 GET file-source（请求序号防快速开关时的
    // 过期响应，对照 ChapterReader）；保存 POST file-save 带 base_hash 基线，
    // 409 = 编辑期间文件被外部改过——草稿绝不丢：保留草稿报冲突，亮两个出口
    // （放弃草稿载入磁盘版 / 基于磁盘最新版重改），别让用户在过期基线上盲改
    // 也不许静默覆盖草稿。关闭统一走脏检查，未保存草稿先确认。成功后关弹层
    // 并触发调用方 reload（快照重算），成功提示走 apiPost 的 toast 通道。
    function SourceEditorModal(props) {
      var title = props.title;
      var rel = props.rel;
      var wsPath = props.wsPath;
      var onClose = props.onClose;
      var onSaved = props.onSaved;
      var _d = useState(null), detail = _d[0], setDetail = _d[1]; // { data, err }
      var _dr = useState(""), draft = _dr[0], setDraft = _dr[1];
      var _b = useState(false), busy = _b[0], setBusy = _b[1];
      var _e = useState(""), err = _e[0], setErr = _e[1];
      var _c = useState(false), conflict = _c[0], setConflict = _c[1];
      var seqRef = useRef(0);
      // 脏检查基线 = detail.data.text：拉取/重基线都随 data 一致更新，草稿是否
      // 偏离磁盘原文直接可比。上报 DIRTY_EXIT 供 Shell 切 tab 拦截，卸载清零。
      var dirty = !!detail && !!detail.data && draft !== ((detail.data && detail.data.text) || "");
      useEffect(function () {
        DIRTY_EXIT.dirty = dirty;
        return function () { DIRTY_EXIT.dirty = false; };
      });
      function close() {
        if (dirty && !window.confirm(tt("common.dirtyExit"))) return; // 脏退出先确认
        onClose();
      }
      var load = useCallback(function () {
        var seq = ++seqRef.current;
        setDetail(null); setErr(""); setConflict(false);
        apiGet("file-source", { path: wsPath, rel: rel }).then(function (d) {
          if (seq !== seqRef.current) return;
          setDetail({ data: d, err: "" });
          setDraft(d && typeof d.text === "string" ? d.text : "");
        }).catch(function (e2) {
          if (seq !== seqRef.current) return;
          setDetail({ data: null, err: e2 && e2.message ? e2.message : tt("common.unknownErr") });
        });
      }, [wsPath, rel]);
      useEffect(function () { load(); }, [load]);
      function save() {
        if (busy || !detail || !detail.data) return;
        setBusy(true); setErr("");
        // 失败经卡内 err 呈现（silent 抑制 apiPost 同文 toast）；成功提示仍走 toast。
        apiPost("file-save", { path: wsPath, rel: rel, text: draft, base_hash: detail.data.hash }, { silent: true }).then(function () {
          onClose();
          if (onSaved) onSaved();
        }).catch(function (e2) {
          if (e2 && e2.status === 409) {
            // 草稿绝不丢：报冲突并亮两个出口（见顶部注释），不再静默 load 覆盖。
            setConflict(true);
            setErr(tf("edit.conflict409", { msg: e2.message }));
          } else setErr(e2 && e2.message ? e2.message : tt("common.unknownErr"));
        }).finally(function () { setBusy(false); });
      }
      // 409 出口①：放弃草稿——重拉磁盘真值回填（load 原行为）。
      function dropDraft() { setConflict(false); setErr(""); load(); }
      // 409 出口②：基于磁盘最新版重改——只换 detail 拿新 base_hash，草稿原样
      // 留在编辑器，改完再存即用新基线。
      function rebaseDraft() {
        var seq = ++seqRef.current;
        apiGet("file-source", { path: wsPath, rel: rel }).then(function (d) {
          if (seq !== seqRef.current) return;
          setDetail({ data: d, err: "" });
          setConflict(false); setErr("");
        }).catch(function (e3) {
          if (seq !== seqRef.current) return;
          setErr(e3 && e3.message ? e3.message : tt("common.unknownErr")); // 冲突态保留可重试
        });
      }
      return h(MaskPortal, {
          className: "myt-modalMask",
          onMouseDown: function (e) { if (e.target === e.currentTarget && !busy) close(); },
        },
        h("div", { className: "myt-modalCard myt-srcCard", role: "dialog", "aria-modal": "true", "aria-label": tt("src.modalAria") },
          h("div", { className: "myt-modalHead" },
            h("h2", { className: "myt-modalTitle" }, title),
            h("button", { type: "button", className: "myt-closeBtn", "aria-label": tt("src.closeAria"), onClick: close }, h("span", { className: "myt-closeGlyph", "aria-hidden": "true" }, "×"))),
          h("div", { className: "myt-modalBody" },
            h("div", { className: "myt-srcRel" }, rel),
            h("div", { className: "myt-muted myt-srcHint" }, tt("src.editHint")),
            !detail ? h("div", { className: "myt-muted" }, tt("src.loading"))
              : detail.err ? h(ErrorStrip, { text: tf("src.loadFailed", { msg: detail.err }), onRetry: load })
                : [
                    h("textarea", { key: "a", className: "myt-setInput myt-setArea myt-srcArea", rows: 16, spellCheck: false,
                      value: draft, onChange: function (e) { setDraft(e.target.value); } }),
                    err ? h(ErrorStrip, { key: "e", text: err }) : null,
                    conflict ? h("div", { key: "c", className: "myt-setActions" },
                      h("button", { type: "button", className: "myt-btn", disabled: busy, onClick: dropDraft }, tt("edit.conflictDrop")),
                      h("button", { type: "button", className: "myt-btn myt-btnPrimary", disabled: busy, onClick: rebaseDraft }, tt("edit.conflictKeep"))) : null,
                    h("div", { key: "s", className: "myt-setActions" },
                      h("button", { type: "button", className: "myt-btn", disabled: busy, onClick: close }, tt("novel.cancel")),
                      h("button", { type: "button", className: "myt-btn myt-btnPrimary", disabled: busy, onClick: save }, busy ? tt("novel.saving") : tt("novel.save"))),
                  ])));
    }
    // 新建受管 md 实体卡（角色/设定/科学设定共用）：slug 客户端预校（与服务
    // 端同一条正则，错在敲键时就报），内容按模板预填可改；失败（409 已存在等）
    // 留在弹层内报错，草稿不丢——建卡是低频操作，丢一遍模板重填太伤。
    function CreateFileModal(props) {
      var title = props.title;
      var dir = props.dir;
      var template = props.template;
      var wsPath = props.wsPath;
      var onClose = props.onClose;
      var onSaved = props.onSaved;
      var _s = useState(""), slug = _s[0], setSlug = _s[1];
      var _t = useState(template), text = _t[0], setText = _t[1];
      var _b = useState(false), busy = _b[0], setBusy = _b[1];
      var _e = useState(""), err = _e[0], setErr = _e[1];
      var slugOk = MANAGED_SLUG_RE.test(slug);
      function create() {
        if (busy) return;
        if (!slugOk) { setErr(tt("src.slugInvalid")); return; }
        setBusy(true); setErr("");
        // 失败经卡内 err 呈现（silent 抑制 apiPost 同文 toast）；成功提示仍走 toast。
        apiPost("file-create", { path: wsPath, rel: dir + "/" + slug + ".md", text: text }, { silent: true }).then(function () {
          onClose();
          if (onSaved) onSaved();
        }).catch(function (e2) { setErr(e2 && e2.message ? e2.message : tt("common.unknownErr")); })
          .finally(function () { setBusy(false); });
      }
      return h(MaskPortal, {
          className: "myt-modalMask",
          onMouseDown: function (e) { if (e.target === e.currentTarget && !busy) onClose(); },
        },
        h("div", { className: "myt-modalCard", role: "dialog", "aria-modal": "true", "aria-label": title },
          h("div", { className: "myt-modalHead" },
            h("h2", { className: "myt-modalTitle" }, title),
            h("button", { type: "button", className: "myt-closeBtn", "aria-label": tt("src.closeAria"), onClick: onClose }, h("span", { className: "myt-closeGlyph", "aria-hidden": "true" }, "×"))),
          h("div", { className: "myt-modalBody" },
            h("label", { className: "myt-setField" },
              h("span", { className: "myt-setFieldLabel" }, tt("src.slugLabel")),
              h("input", { type: "text", className: "myt-setInput", placeholder: tt("src.slugPh"), value: slug, spellCheck: false,
                onChange: function (e) { setSlug(e.target.value); setErr(""); } })),
            h("div", { className: "myt-muted myt-srcHint" }, tt("src.createHint")),
            h("textarea", { className: "myt-setInput myt-setArea myt-srcArea", rows: 10, spellCheck: false,
              value: text, onChange: function (e) { setText(e.target.value); } }),
            err ? h(ErrorStrip, { text: err }) : null,
            h("div", { className: "myt-setActions" },
              h("button", { type: "button", className: "myt-btn", disabled: busy, onClick: onClose }, tt("novel.cancel")),
              h("button", { type: "button", className: "myt-btn myt-btnPrimary", disabled: busy || slug === "", onClick: create }, busy ? tt("src.creating") : tt("src.create"))))));
    }
    // 删除二次确认（服务端不做二次确认，UI 层强制——删除不可逆，文案点名后
    // 悔靠 git、check 会标孤儿引用）。onConfirm 返回 promise，在途禁双击；
    // 成败提示走 apiPost 的 toast 通道。
    function ConfirmModal(props) {
      var title = props.title;
      var text = props.text;
      var onCancel = props.onCancel;
      var onConfirm = props.onConfirm;
      var _b = useState(false), busy = _b[0], setBusy = _b[1];
      function confirm() {
        if (busy) return;
        setBusy(true);
        Promise.resolve(onConfirm()).catch(function () {}).finally(function () { setBusy(false); });
      }
      return h(MaskPortal, {
          className: "myt-modalMask",
          onMouseDown: function (e) { if (e.target === e.currentTarget && !busy) onCancel(); },
        },
        h("div", { className: "myt-modalCard myt-confirmCard", role: "alertdialog", "aria-modal": "true", "aria-label": title },
          h("div", { className: "myt-modalHead" },
            h("h2", { className: "myt-modalTitle" }, title),
            h("button", { type: "button", className: "myt-closeBtn", "aria-label": tt("src.closeAria"), disabled: busy, onClick: onCancel }, h("span", { className: "myt-closeGlyph", "aria-hidden": "true" }, "×"))),
          h("div", { className: "myt-modalBody" },
            h("div", { className: "myt-confirmText" }, text),
            h("div", { className: "myt-setActions" },
              h("button", { type: "button", className: "myt-btn", disabled: busy, onClick: onCancel }, tt("novel.cancel")),
              h("button", { type: "button", className: "myt-btn myt-btnDanger", disabled: busy, onClick: confirm }, busy ? tt("src.deleting") : tt("src.confirmDelete"))))));
    }

    function ChaptersTab(props) {
      var snap = props.snap;
      var wsPath = props.wsPath;
      var reload = props.reload;
      var onOpen = props.onOpenChapter; // 行点击 → 整页阅读（PageShell.readerFile）
      var project = snap.project || {}; // 状态徽章悬停「在等谁」提示用（author-draft 待写章=等作者交稿）
      var _f = useState("all"), filter = _f[0], setFilter = _f[1];
      var _src = useState(null), srcRel = _src[0], setSrcRel = _src[1]; // 体检「改章纲」直达源文件
      var chapters = snap.chapters || [];
      var rows = filter === "all" ? chapters : chapters.filter(function (c) { return c.status === filter; });
      // 批量状态（0.6.0）：多选后一次改多章状态，逐章串行发请求，失败不中断。
      var _sel = useState([]), selected = _sel[0], setSelected = _sel[1];
      var _bb = useState(false), batchBusy = _bb[0], setBatchBusy = _bb[1];
      // 分析卡收纳（0.15.2）：门禁趋势 + 全书体检在手机上一开就占半屏，表格被
      // 推到第二屏。窄屏（CSS 判）默认收起，一个按钮展开；宽屏一直显示。
      var _an = useState(false), analysisOpen = _an[0], setAnalysisOpen = _an[1];
      function toggleSel(fileName, e) {
        if (e && typeof e.stopPropagation === "function") e.stopPropagation();
        setSelected(function (prev) {
          var arr = (prev || []).slice();
          var pos = arr.indexOf(fileName);
          if (pos === -1) arr.push(fileName); else arr.splice(pos, 1);
          return arr;
        });
      }
      function selectAllRows() {
        setSelected(selected.length === rows.length ? [] : rows.map(function (c) { return c.file; }));
      }
      function batchSet(status) {
        if (batchBusy || selected.length === 0) return;
        setBatchBusy(true);
        var files = selected.slice();
        var done = 0;
        var chain = Promise.resolve();
        files.forEach(function (fileName) {
          chain = chain.then(function () {
            return apiPost("chapter-status", { path: wsPath, file: fileName, status: status }).then(function () { done++; }).catch(function () {});
          });
        });
        chain.then(function () {
          toast.ok(tf("chapters.batchDone", { n: done }));
          setSelected([]);
          return reload();
        }).finally(function () { setBatchBusy(false); });
      }
      function exportSel(format) {
        if (selected.length === 0) return;
        var href = API_BASE + "export-selection?path=" + encodeURIComponent(wsPath) +
          "&format=" + encodeURIComponent(format) +
          "&files=" + encodeURIComponent(selected.join(","));
        var a = document.createElement("a");
        a.href = href;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast.ok(tf("chapters.exporting", { n: selected.length, fmt: format === "docx" ? "Word" : (format === "epub" ? "EPUB" : "TXT") }));
      }
      var counts = snap.totals && snap.totals.byStatus ? snap.totals.byStatus : {};
      // 门禁分（人味指数 / 人写度）：批量跑一次扫描器，正文没改时服务端按
      // 文件 mtime 命中缓存，重拉几乎零成本。python3 缺席时 gates=null，
      // 页面不显示徽标（门禁仍在写作流程里，只是面板不给分）。
      var _gt = useState(null), gates = _gt[0], setGates = _gt[1];
      // 项目门禁线（novel/xiaoyu.json 的 gate.passMark，默认 78）：点徽章循环切换。
      var _pm = useState(78), passMark = _pm[0], setPassMark = _pm[1];
      var _pb = useState(false), passBusy = _pb[0], setPassBusy = _pb[1];
      useEffect(function () {
        var alive = true;
        setGates(null);
        if (!wsPath) return function () { alive = false; };
        // 分片拉门禁分（0.7.1）：首屏只算前 6 章（可见区），1.2s 后再补余下，
        // 面板打开不再卡在全书 python 扫描上；服务端按 mtime 缓存，重拉近乎零成本。
        var all = chapters.map(function (c) { return c.file; });
        var head = all.slice(0, 6);
        var rest = all.slice(6);
        var timer = null;
        function pull(files, isFirst) {
          var params = files.length > 0 ? { path: wsPath, files: files.join(",") } : { path: wsPath };
          return apiGet("gate", params, { silent: true }).then(function (d) {
            if (!alive || !d) return;
            if (typeof d.passMark === "number") setPassMark(d.passMark);
            if (!(d.ok && d.python !== false)) { setGates(null); return; }
            var got = d.gates || {};
            setGates(function (prev) {
              var merged = {};
              var key;
              for (key in (prev || {})) merged[key] = prev[key];
              for (key in got) merged[key] = got[key];
              return merged;
            });
            if (isFirst && rest.length > 0) timer = setTimeout(function () { pull(rest, false); }, 1200);
          });
        }
        pull(head, true).catch(function () { if (alive) setGates(null); });
        return function () { alive = false; if (timer) clearTimeout(timer); };
      }, [wsPath, snap && snap.generatedAt]);
      function cyclePassMark() {
        if (passBusy) return;
        var opts = [78, 82, 86, 90];
        var idx = opts.indexOf(passMark);
        var next = opts[(idx + 1) % opts.length];
        setPassBusy(true);
        apiPost("gate-config", { path: wsPath, passMark: next }).then(function (d) {
          if (d && typeof d.passMark === "number") setPassMark(d.passMark);
          return apiGet("gate", { path: wsPath }, { silent: true });
        }).then(function (d) {
          if (d && d.ok) setGates(d.gates || {});
        }).catch(function () {}).finally(function () { setPassBusy(false); });
      }
      // 全书体检（0.4.0）：跨章重复 / 人物 0 出场 / 章纲未落地 / 字数离群 /
      // 连续平收。按需拉取（一本几十章分析一次即可），报告可导出到 reports/。
      var _au = useState(null), auditData = _au[0], setAuditData = _au[1];
      var _aub = useState(false), auditBusy = _aub[0], setAuditBusy = _aub[1];
      function loadAudit() {
        if (auditBusy || !wsPath) return;
        setAuditBusy(true);
        apiGet("audit", { path: wsPath }, { silent: true }).then(function (d) {
          if (d && d.ok) setAuditData(d);
        }).catch(function () {}).finally(function () { setAuditBusy(false); });
      }
      function exportAudit() {
        apiPost("audit-report", { path: wsPath, title: project.title || "" }).then(function (d) {
          if (d && d.ok) toast.ok(tf("audit.exported", { rel: d.rel }));
        }).catch(function () {});
      }
      // 0.11.0：返回结构化条目（{kind, text, file?, names?}），章纲漂移那类可以就地
      // 给两个动作（改章纲 / 记待补），其余保持纯文本。
      function auditIssues(d) {
        var out = [];
        (d.repeats || []).slice(0, 3).forEach(function (r) {
          out.push({ kind: "repeat", text: tf("audit.repeat", { text: r.text, n: r.chapters.length }) });
        });
        (d.characters || []).forEach(function (c) {
          if (!c.missing) return;
          out.push({
            kind: "char",
            text: c.planned ? tf("audit.charsPlanned", { name: c.name, ch: c.debut }) : tf("audit.chars", { name: c.name }),
          });
        });
        (d.outlines || []).forEach(function (o) {
          out.push({ kind: "outline", text: tf("audit.outline", { file: o.file, names: o.promised.join("、") }), file: o.file, names: o.promised });
        });
        (d.rhythm && d.rhythm.outliers ? d.rhythm.outliers : []).forEach(function (o) {
          out.push({ kind: "words", text: tf("audit.outlier", { file: o.file, n: o.words }), file: o.file });
        });
        if (d.hooks && d.hooks.maxStreak >= 3) out.push({ kind: "hook", text: tf("audit.streak", { n: d.hooks.maxStreak }) });
        return out;
      }
      // 章纲漂移的两个闭环动作：改章纲（打开源文件）/ 记待补（写到章纲 ## 待补）。
      function noteOutline(issue) {
        var stem = String(issue.file || "").replace(/\.md$/i, "");
        if (!stem) return;
        apiPost("outline-note", { path: wsPath, file: stem, note: "章纲点名 " + (issue.names || []).join("、") + "，本章正文未落地" })
          .then(function () { toast.ok(tt("audit.noteDone")); })
          .catch(function () {});
      }
      // 门禁排序：等 gates 到位后才排（放在 gates 赋值之后，避免 var 提升读到 undefined）。
      var _sg = useState(false), sortGate = _sg[0], setSortGate = _sg[1];
      if (sortGate) {
        rows = rows.slice().sort(function (a, b) {
          var ga = gates && gates[a.file], gb = gates && gates[b.file];
          var va = ga && ga.ok ? ga.human : 999, vb = gb && gb.ok ? gb.human : 999;
          return va - vb;
        });
      }
      function gateBadge(fileName) {
        var g = gates && gates[fileName];
        if (!g || !g.ok) return null;
        var human = Math.round(g.human);
        var det = g.detector === null || g.detector === undefined ? null : Math.round(g.detector);
        var tier = human >= 85 ? "ok" : (human >= 70 ? "mid" : "bad");
        // 窄屏把检测器分也写出来（0.15.2）：title 提示在手机上永远看不到，
        // 「97 / 92」两个数才是能读到的信息。宽屏 CSS 藏掉后半段，保持简洁。
        return h("span", {
          className: "myt-gate myt-gate-" + tier,
          title: tf("gate.tip", { h: fmtNum(human), d: det === null ? "—" : fmtNum(det) }),
        }, fmtNum(human),
          det === null ? null : h("span", { className: "myt-gateDet", "aria-hidden": "true" }, " / " + fmtNum(det)));
      }
      // 「按单写作」（五期）：state.outlines 与 chapters 联交——有章纲且
      // status=pending 的章，按章纲（卷-章号）序列出，共创模式的主工作清单。
      // 孤儿章纲（chapter 无对应章节文件）照列（0.1.15）：章纲先于正文是共
      // 创常态，未建章行挂「未建章」徽章，行点击看章纲全文、卡上「建章」一
      // 键落 pending 空章（建后走既有 pending 流转）。outlines 快照已按卷-章
      // 号升序，孤儿行与待写章直接保序混排。
      var outlines = snap.outlines || [];
      var chapterByFile = {};
      chapters.forEach(function (c) { chapterByFile[c.file] = c; });
      var writeOrder = [];
      outlines.forEach(function (ol) {
        var ch = ol && ol.chapter ? chapterByFile[ol.chapter] : null;
        if (ch && (ch.status || "pending") === "pending") writeOrder.push({ ch: ch, ol: ol });
        else if (!ch) writeOrder.push({ ol: ol }); // 孤儿章纲：正文未建也入清单
      });
      // 章纲全文弹层：outline 文件名，null 不渲染；建章 in-flight 的文件名。
      var _mo = useState(null), outlineModalFile = _mo[0], setOutlineModalFile = _mo[1];
      var _busy = useState(null), creatingFile = _busy[0], setCreatingFile = _busy[1];
      function createFromOutline(ol, e) {
        if (e && typeof e.stopPropagation === "function") e.stopPropagation(); // 别触发行的弹层
        if (!ol || !ol.file || creatingFile) return;
        setCreatingFile(ol.file);
        // 成败提示走 apiPost 的 toast 通道；成功后重拉快照——新章节进表格、
        // 孤儿行按快照最新联交结果自然消失（与 chapter-status 流转同一模式）。
        apiPost("chapter-create", { path: wsPath, file: ol.file })
          .then(function () { return reload(); })
          .catch(function () {})
          .finally(function () { setCreatingFile(null); });
      }
      return h("div", { className: "myt-stack" },
        writeOrder.length ? h("div", { className: "myt-card myt-writeOrder" },
          h("div", { className: "myt-cardHead" },
            h("h3", { className: "myt-cardTitle" }, tt("chapters.writeQueue")),
            h("span", { className: "myt-boardCount" }, writeOrder.length)),
          h("div", { className: "myt-writeOrderList" }, writeOrder.map(function (item) {
            var ch = item.ch;
            var ol = item.ol;
            if (!ch) {
              // 孤儿章纲行：div 承担行点击（button 里不能再嵌 button），键盘
              // Enter/Space 与 role/tabIndex 补齐可达性。
              var busy = creatingFile === ol.file;
              return h("div", {
                key: "ol:" + ol.file, className: "myt-writeOrderRow", role: "button", tabIndex: 0,
                title: tt("chapters.outlineRowTip"),
                onClick: function () { setOutlineModalFile(ol.file); },
                onKeyDown: function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOutlineModalFile(ol.file); } },
              },
                h("span", { className: "myt-chPath" }, olWhere(ol) || ol.file),
                h("span", { className: "myt-noChapterBadge", title: tt("chapters.createTip") }, tt("chapters.noChapter")),
                ol && typeof ol.excerpt === "string" && ol.excerpt !== ""
                  ? h("span", { className: "myt-writeOrderExcerpt", title: ol.excerpt }, truncate(ol.excerpt, 60)) : null,
                ol && ol.words ? h("span", { className: "myt-wordsCell" }, tf("chapters.outlineWords", { n: fmtNum(ol.words) })) : null,
                h("button", {
                  type: "button", className: "myt-btn", disabled: creatingFile !== null,
                  title: tt("chapters.createTip"),
                  onClick: function (e) { createFromOutline(ol, e); },
                }, busy ? tt("chapters.creating") : tt("chapters.createBtn")));
            }
            return h("button", {
              key: ch.file, type: "button", className: "myt-writeOrderRow",
              title: tt("chapters.rowTip"),
              onClick: function () { onOpen(ch.file); },
            },
              h("span", { className: "myt-chPath" }, chWhere(ch) || ch.file),
              h("span", { className: "myt-chTitle" }, orDash(ch.title)),
              statusBadge(ch.status, project.mode),
              gateBadge(ch.file),
              ol && typeof ol.excerpt === "string" && ol.excerpt !== ""
                ? h("span", { className: "myt-writeOrderExcerpt", title: ol.excerpt }, truncate(ol.excerpt, 60)) : null,
              ol && ol.words ? h("span", { className: "myt-wordsCell" }, tf("chapters.outlineWords", { n: fmtNum(ol.words) })) : null);
          }))) : null,
        h("div", { className: "myt-filterRow" },
          h("button", {
            type: "button", className: "myt-filterPill",
            "data-active": sortGate ? "true" : undefined,
            onClick: function () { setSortGate(function (v) { return !v; }); },
          }, tt("gate.sortByScore")),
          [{ k: "all", label: tt("chapters.all"), n: chapters.length }].concat(STATUS_FLOW.map(function (s) {
            return { k: s, label: tt("status." + s), n: counts[s] || 0 };
          })).map(function (f) {
            return h("button", {
              key: f.k, type: "button", className: "myt-filterPill",
              "data-active": filter === f.k ? "true" : undefined,
              onClick: function () { setFilter(f.k); },
            }, f.label + " " + f.n);
          })),
        h("button", {
          type: "button", className: "myt-btn myt-analysisToggle",
          "aria-expanded": analysisOpen ? "true" : "false",
          onClick: function () { setAnalysisOpen(function (v) { return !v; }); },
        }, analysisOpen ? tt("chapters.hideAnalysis") : tt("chapters.showAnalysis")),
        h("div", { className: "myt-analysisCards", "data-open": analysisOpen ? "true" : "false" }, [
        (function () {
          // 门禁趋势（0.4.0）：按章节顺序取批量门禁分画折线 + 门禁线；
          // 只画有分的章，空章跳过。SVG 手绘，不引图表库。
          if (!gates) return null;
          var scored = [];
          chapters.forEach(function (c) {
            var g = gates[c.file];
            if (g && g.ok && typeof g.human === "number") scored.push({ file: c.file, human: g.human, title: c.title || c.file });
          });
          if (scored.length < 2) return null;
          var W = 640, H = 96, PAD = 12;
          var span = W - PAD * 2;
          var yOf = function (v) { return H - PAD - (Math.max(0, Math.min(100, v)) / 100) * (H - PAD * 2); };
          var xOf = function (i) { return scored.length === 1 ? W / 2 : PAD + (i / (scored.length - 1)) * span; };
          var pts = scored.map(function (r, i) { return xOf(i) + "," + yOf(r.human); }).join(" ");
          var avg = scored.reduce(function (s, r) { return s + r.human; }, 0) / scored.length;
          var failed = scored.filter(function (r) { return r.human < passMark; }).length;
          return h("div", { className: "myt-card myt-sparkCard" },
            h("div", { className: "myt-cardHead" },
              h("h3", { className: "myt-cardTitle" }, tt("gate.trendTitle")),
              h("span", { className: "myt-muted" }, tf("gate.trendMeta", { avg: Math.round(avg * 10) / 10, n: scored.length, failed: failed })),
              h("button", {
                type: "button", className: "myt-btn", disabled: passBusy,
                title: tt("gate.passTip"), onClick: cyclePassMark,
              }, tf("gate.passMark", { n: passMark }))),
            h("svg", { className: "myt-spark", viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "none", role: "img", "aria-label": tt("gate.trendTitle") },
              h("line", { className: "myt-sparkLine", x1: PAD, y1: yOf(passMark), x2: W - PAD, y2: yOf(passMark) }),
              h("polyline", { className: "myt-sparkPoly", points: pts }),
              scored.map(function (r, i) {
                return h("circle", { key: r.file, className: "myt-sparkDot", cx: xOf(i), cy: yOf(r.human), r: 2.4 },
                  h("title", null, r.title + " · " + Math.round(r.human)));
              })));
        })(),
        h("div", { className: "myt-card myt-auditCard" },
          h("div", { className: "myt-cardHead" },
            h("h3", { className: "myt-cardTitle" }, tt("audit.title")),
            auditData ? h("button", { type: "button", className: "myt-btn", onClick: exportAudit }, tt("audit.export")) : null,
            h("button", { type: "button", className: "myt-btn", disabled: auditBusy, onClick: loadAudit },
              auditBusy ? tt("audit.loading") : tt("audit.run"))),
          auditData
            ? (function () {
                var issues = auditIssues(auditData);
                return issues.length
                  ? h("ol", { className: "myt-auditList" }, issues.slice(0, 8).map(function (it, i) {
                    if (it.kind === "outline") {
                      var stem = String(it.file || "").replace(/\.md$/i, "");
                      return h("li", { key: i }, it.text,
                        h("span", { className: "myt-auditActs" },
                          h("button", { type: "button", className: "myt-btn myt-btnSm", title: tt("audit.fixOutlineTip"), onClick: function () { setSrcRel("outlines/" + stem + ".md"); } }, tt("audit.fixOutline")),
                          h("button", { type: "button", className: "myt-btn myt-btnSm", title: tt("audit.noteOutlineTip"), onClick: function () { noteOutline(it); } }, tt("audit.noteOutline"))));
                    }
                    return h("li", { key: i }, it.text);
                  }))
                  : h("div", { className: "myt-muted" }, tt("audit.clean"));
              })()
            : h("div", { className: "myt-muted" }, tt("audit.hint"))),
        ]),
        selected.length ? h("div", { className: "myt-batchBar" },
          h("span", { className: "myt-batchCount" }, tf("chapters.selected", { n: selected.length })),
          h("span", { className: "myt-muted" }, tt("chapters.batchSet")),
          STATUS_FLOW.map(function (s) {
            return h("button", { key: s, type: "button", className: "myt-btn", disabled: batchBusy, onClick: function () { batchSet(s); } }, tt("status." + s));
          }),
          h("button", { type: "button", className: "myt-btn", disabled: batchBusy, onClick: function () { exportSel("txt"); } }, tt("chapters.exportTxt")),
          h("button", { type: "button", className: "myt-btn", disabled: batchBusy, onClick: function () { exportSel("docx"); } }, tt("chapters.exportDocx")),
          h("button", { type: "button", className: "myt-btn", disabled: batchBusy, onClick: function () { exportSel("epub"); } }, tt("chapters.exportEpub")),
          h("button", { type: "button", className: "myt-btn", onClick: function () { setSelected([]); } }, tt("chapters.clearSel"))) : null,
        rows.length ? h("div", { className: "myt-tableWrap" },
          h("table", { className: "myt-table myt-table--chapters" },
            h("thead", null, h("tr", null,
              h("th", null, tt("chapters.thVolume")),
              h("th", null,
                h("input", { type: "checkbox", className: "myt-headCheck", checked: rows.length > 0 && selected.length === rows.length, onChange: selectAllRows, title: tt("chapters.selectAll") }),
                " ", tt("chapters.thTitle")),
              h("th", null, tt("gate.th")), h("th", null, tt("chapters.thStatus")), h("th", null, tt("chapters.thWords")), h("th", null, tt("chapters.thSummary")))),
            h("tbody", null, rows.map(function (ch) {
              return h("tr", { key: ch.file, onClick: function () { onOpen(ch.file); }, title: tt("chapters.rowReadTip") },
                h("td", { className: "myt-tdVol" }, h("span", { className: "myt-chPath" }, chWhere(ch) || "—")),
                h("td", { className: "myt-tdTitle" },
                  h("input", {
                    type: "checkbox", className: "myt-rowCheck", checked: selected.indexOf(ch.file) !== -1,
                    onClick: function (e) { e.stopPropagation(); },
                    onChange: function () { toggleSel(ch.file); },
                  }),
                  chNo(ch) ? h("span", { className: "myt-chNo" }, chNo(ch)) : null,
                  h("span", { className: "myt-chTitle" }, orDash(ch.title))),
                h("td", { className: "myt-tdGate" }, gateBadge(ch.file) || h("span", { className: "myt-muted" }, "—")),
                h("td", { className: "myt-tdStatus" }, statusBadge(ch.status, project.mode)),
                h("td", { className: "myt-tdWords" }, h("span", { className: "myt-wordsCell" }, fmtNum(ch.words))),
                h("td", { className: "myt-tdSummary" }, h("div", { className: "myt-summaryCell myt-muted" }, orDash(ch.summary))));
            }))))
          : (chapters.length ? h(Empty, { text: tt("chapters.emptyFiltered") }) : h(Empty, { text: outlines.length ? tt("chapters.emptyWithOutlines") : tt("chapters.empty") })),
        outlineModalFile ? h(OutlineModal, {
          wsPath: wsPath,
          file: outlineModalFile,
          // 弹层标题用「卷-章」定位（对照 olWhere 显示格式），解析不了退文件名
          title: (function () {
            for (var i = 0; i < outlines.length; i++) { if (outlines[i].file === outlineModalFile) return olWhere(outlines[i]) || outlines[i].file; }
            return outlineModalFile;
          })(),
          onClose: function () { setOutlineModalFile(null); },
        }) : null,
        srcRel ? h(SourceEditorModal, { title: tt("src.editSource"), rel: srcRel, wsPath: wsPath, onClose: function () { setSrcRel(null); }, onSaved: reload }) : null);
    }

    // ── 角色 tab：卡墙 + 全卡弹层 ───────────────────────────────────────────
    var CHAR_FULL_ROWS = [
      ["age", tt("char.field.age")], ["gender", tt("char.field.gender")], ["appearance", tt("char.field.appearance")], ["personality", tt("char.field.personality")],
      ["background", tt("char.field.background")], ["motivation", tt("char.field.motivation")], ["arc", tt("char.field.arc")],
      ["psychology", tt("char.field.psychology")],
    ];
    function CharactersTab(props) {
      var characters = props.snap.characters || [];
      var wsPath = props.wsPath;
      var reload = props.reload;
      var _m = useState(null), modalFile = _m[0], setModalFile = _m[1];
      // 受管文件三态：编辑 rel / 新建弹层开关 / 删除确认 rel（0.1.20 写面）。
      var _src = useState(null), srcRel = _src[0], setSrcRel = _src[1];
      var _new = useState(false), createOpen = _new[0], setCreateOpen = _new[1];
      var _del = useState(null), delRel = _del[0], setDelRel = _del[1];
      var modal = null;
      for (var i = 0; i < characters.length; i++) { if (characters[i].file === modalFile) { modal = characters[i]; break; } }
      // 跨 tab 请求（关系图点人名）：进本页即打开对应角色卡，打开后清请求。
      // 找不到同名角色时同样清掉，避免请求悬空、下次进页面莫名弹卡。
      useEffect(function () {
        var want = props.focusName;
        if (!want) return undefined;
        for (var ci = 0; ci < characters.length; ci++) {
          if (characters[ci].name === want) {
            setModalFile(characters[ci].file);
            if (typeof props.onFocusDone === "function") props.onFocusDone();
            return undefined;
          }
        }
        if (typeof props.onFocusDone === "function") props.onFocusDone();
        return undefined;
      }, [props.focusName]);
      return h("div", { className: "myt-stack" },
        h("div", { className: "myt-cardHead" },
          h("h3", { className: "myt-cardTitle" }, tt("tabs.characters")),
          h("span", { className: "myt-boardCount" }, characters.length),
          h("button", { type: "button", className: "myt-btn", onClick: function () { setCreateOpen(true); } }, tt("char.createBtn"))),
        characters.length ? h("div", { className: "myt-charWall" }, characters.map(function (c) {
          return h("button", { key: c.file, type: "button", className: "myt-card myt-charCard", onClick: function () { setModalFile(c.file); } },
            h("div", { className: "myt-charHead" },
              h("span", { className: "myt-charName" }, orDash(c.name)),
              roleBadge(c.role)),
            h("div", { className: "myt-charMeta" },
              [c.age !== null && c.age !== undefined ? tf("char.years", { n: c.age }) : null, c.gender || null].filter(Boolean).join(" · ") || "—"),
            c.personality ? h("div", { className: "myt-charLine" }, h("span", { className: "myt-charLabel" }, tt("char.linePersonality")), truncate(c.personality, 60)) : null,
            c.motivation ? h("div", { className: "myt-charLine" }, h("span", { className: "myt-charLabel" }, tt("char.lineMotivation")), truncate(c.motivation, 60)) : null);
        })) : h(Empty, { text: tt("char.empty") }),
        modal ? h(MaskPortal, {
          className: "myt-modalMask",
          onMouseDown: function (e) { if (e.target === e.currentTarget) setModalFile(null); },
        },
          h("div", { className: "myt-modalCard", role: "dialog", "aria-modal": "true", "aria-label": tt("char.modalAria") },
            h("div", { className: "myt-modalHead" },
              h("h2", { className: "myt-modalTitle" }, orDash(modal.name)),
              h("div", { className: "myt-heroMeta" },
                roleBadge(modal.role),
                h("button", { type: "button", className: "myt-closeBtn", "aria-label": tt("char.closeAria"), onClick: function () { setModalFile(null); } }, h("span", { className: "myt-closeGlyph", "aria-hidden": "true" }, "×")))),
            h("div", { className: "myt-modalBody" },
              CHAR_FULL_ROWS.map(function (row) {
                return h("div", { key: row[0], className: "myt-kvRow" },
                  h("span", { className: "myt-kvKey" }, row[1]),
                  h("span", { className: "myt-kvVal" }, orDash(modal[row[0]])));
              }),
              h("div", { className: "myt-kvRow" },
                h("span", { className: "myt-kvKey" }, tt("char.markers")),
                h("span", { className: "myt-kvVal myt-tagRow" },
                  (modal.markers || []).length
                    ? modal.markers.map(function (m, i) { return h("span", { key: i, className: "myt-markerTag" }, m); })
                    : "—")),
              h("div", { className: "myt-kvRow" },
                h("span", { className: "myt-kvKey" }, tt("char.field.debut")),
                h("span", { className: "myt-kvVal" }, modal.debut_chapter || "—")),
              h("div", { className: "myt-kvRow" },
                h("span", { className: "myt-kvKey" }, tt("char.field.status")),
                h("span", { className: "myt-kvVal" }, modal.status === "retired" ? tt("char.statusRetired") : (modal.status === "planned" ? tt("char.statusPlanned") : "—"))),
              h("div", { className: "myt-kvRow" },
                h("span", { className: "myt-kvKey" }, tt("char.file")),
                h("span", { className: "myt-kvVal" }, modal.file || "—")),
              // 源文件直达（0.1.20 写面）：rel 由快照 basename 拼目录前缀。
              h("div", { className: "myt-setActions" },
                h("button", { type: "button", className: "myt-btn", onClick: function () { setSrcRel("characters/" + modal.file); } },
                  ic("IconEditOutlineRegular", 13), tt("src.editSource")),
                h("button", { type: "button", className: "myt-btn myt-btnDanger", onClick: function () { setDelRel("characters/" + modal.file); } },
                  tt("src.deleteFile")))))) : null,
        srcRel ? h(SourceEditorModal, { title: tt("src.editSource"), rel: srcRel, wsPath: wsPath, onClose: function () { setSrcRel(null); }, onSaved: reload }) : null,
        createOpen ? h(CreateFileModal, { title: tt("char.createBtn"), dir: "characters", template: TPL_CHARACTER, wsPath: wsPath, onClose: function () { setCreateOpen(false); }, onSaved: reload }) : null,
        delRel ? h(ConfirmModal, {
          title: tf("src.deleteTip", { rel: delRel }),
          text: tf("src.confirmText", { rel: delRel }),
          onCancel: function () { setDelRel(null); },
          onConfirm: function () {
            return apiPost("file-delete", { path: wsPath, rel: delRel }).then(function () {
              setDelRel(null);
              if (modalFile && "characters/" + modalFile === delRel) setModalFile(null); // 删的是打开中的卡：详情弹层一并收
              return reload();
            });
          },
        }) : null);
    }

    // ── 伏笔 tab：四列看板（列头计数 + 推进按钮 + priority 色点）────────────
    function ForeshadowsTab(props) {
      var snap = props.snap;
      var reload = props.reload;
      var wsPath = props.wsPath;
      var _b = useState(null), busyId = _b[0], setBusyId = _b[1]; // 在途伏笔 id
      function setStatus(fs, status) {
        if (busyId) return;
        setBusyId(fs.id);
        apiPost("foreshadow-status", { path: wsPath, id: fs.id, status: status })
          .then(reload).catch(function () {}).finally(function () { setBusyId(null); });
      }
      var list = snap.foreshadows || [];
      // 伏笔台账源文件直达（0.1.20 写面）：foreshadows.yml 整文件可编辑。
      var _src = useState(null), srcRel = _src[0], setSrcRel = _src[1];
      var head = h("div", { className: "myt-cardHead" },
        h("h3", { className: "myt-cardTitle" }, tt("tabs.foreshadows")),
        srcEditBtn("foreshadows.yml", function () { setSrcRel("foreshadows.yml"); }));
      // 看板（0.4.11）：四条列在手机上是两列/单列堆叠，条目一多整页拉长——
      // 收进折叠块内滚；空态仍走卡头 + 空提示。
      return h("div", { className: "myt-stack" },
        list.length ? h(CollapseBox, {
          title: tt("tabs.foreshadows"),
          meta: list.length,
          extra: srcEditBtn("foreshadows.yml", function () { setSrcRel("foreshadows.yml"); }),
        }, h("div", { className: "myt-board" }, FS_ORDER.map(function (col) {
          var items = list.filter(function (f) { return (f.status || "planted") === col; });
          return h("div", { key: col, className: "myt-boardCol" },
            h("div", { className: "myt-boardHead" },
              h("span", { className: "myt-boardTitle" }, tt("foreshadow." + col)),
              h("span", { className: "myt-boardCount" }, items.length)),
            items.map(function (fs, i) {
              var next = FS_FLOW[col] || null;
              var busy = busyId === fs.id;
              // status 行缺失（服务端要求每条恰一处 status，写必 409）：禁用流
              // 转/弃用按钮，降级为只读展示并给提示，避免「可点但必失败」。
              var noStatus = !fs.status;
              var noWrite = !fs.id || noStatus;
              var noWriteTip = !fs.id
                ? tt("foreshadow.noIdTip")
                : tt("foreshadow.noStatusTip");
              var chRange = [fs.planted_chapter || tt("foreshadow.plantedUnmarked"), fs.expected_resolve].filter(Boolean).join(" → ");
              // key 索引兜底：无 id 且标题重复时 id||title 相撞会丢行
              return h("div", { key: fs.id || (fs.title + ":" + i), className: "myt-fsCard" },
                h("div", { className: "myt-fsTitle" },
                  priDot(fs.priority), h("span", null, orDash(fs.title) || orDash(fs.id)),
                  // 回填徽章（五期账本回填）：区别于写前规划条目，悬浮见来源。
                  fs.source === "backfill" ? h("span", { className: "myt-backfillBadge", title: tt("foreshadow.backfillTip") }, tt("foreshadow.backfill")) : null,
                  noStatus ? h("span", { className: "myt-fsNoStatus", title: noWriteTip }, tt("foreshadow.missingStatus")) : null),
                h("div", { className: "myt-fsMeta" },
                  h("span", null, col === "resolved" && fs.resolved_chapter ? tf("foreshadow.resolvedAt", { ch: fs.resolved_chapter }) : chRange),
                  fs.priority && fs.priority !== "normal" ? h("span", null, tf("foreshadow.priorityLabel", { pri: ["high", "low", "normal"].indexOf(fs.priority) !== -1 ? tt("pri." + fs.priority) : fs.priority })) : null),
                fs.notes ? h("div", { className: "myt-fsNotes", title: fs.notes }, fs.notes) : null,
                h("div", { className: "myt-fsActions" },
                  next ? h("button", { type: "button", className: "myt-btn", disabled: busy || noWrite, title: noWriteTip, onClick: function () { setStatus(fs, next); } }, busy ? tt("foreshadow.advancing") : (col === "planted" ? tt("foreshadow.advance") : tt("foreshadow.resolve"))) : null,
                  col !== "resolved" && col !== "abandoned"
                    ? h("button", { type: "button", className: "myt-btn myt-btnDanger", disabled: busy || noWrite, title: noWriteTip, onClick: function () { setStatus(fs, "abandoned"); } }, tt("foreshadow.abandon")) : null));
            }),
            items.length ? null : h("div", { className: "myt-muted" }, tt("foreshadow.colEmpty")));
        }))) : h("div", { className: "myt-stack" }, head, h(Empty, { text: tt("foreshadow.empty") })),
        srcRel ? h(SourceEditorModal, { title: tt("src.editSource"), rel: srcRel, wsPath: wsPath, onClose: function () { setSrcRel(null); }, onSaved: reload }) : null);
    }

    // ── 时间线 tab：垂直轴 + importance 点位（1-5 → 大小/深浅）──────────────
    function TimelineTab(props) {
      var items = (props.snap.timeline || []).slice();
      var wsPath = props.wsPath;
      var reload = props.reload;
      // 时间线账本源文件直达（0.1.20 写面）：空态也保留入口——账本空不等于
      // 不可编辑，恰恰是第一条要从这里写进去。
      var _src = useState(null), srcRel = _src[0], setSrcRel = _src[1];
      var head = h("div", { className: "myt-cardHead" },
        h("h3", { className: "myt-cardTitle" }, tt("tabs.timeline")),
        srcEditBtn("timeline.yml", function () { setSrcRel("timeline.yml"); }));
      if (items.length) {
        items.sort(function (a, b) { return String(a.year || "").localeCompare(String(b.year || ""), "zh-CN", { numeric: true }); });
      }
      if (!items.length) {
        return h("div", { className: "myt-stack" },
          head,
          h(Empty, { text: tt("timeline.empty") }),
          srcRel ? h(SourceEditorModal, { title: tt("src.editSource"), rel: srcRel, wsPath: wsPath, onClose: function () { setSrcRel(null); }, onSaved: reload }) : null);
      }
      // 时间线（0.4.11）：几十个节点平铺也是一条长龙，收进折叠块内滚。
      return h("div", { className: "myt-stack" },
        h(CollapseBox, {
          title: tt("tabs.timeline"),
          meta: items.length,
          extra: srcEditBtn("timeline.yml", function () { setSrcRel("timeline.yml"); }),
        },
        h("div", { className: "myt-timeline" }, items.map(function (t, i) {
          var imp = Math.min(5, Math.max(1, typeof t.importance === "number" ? t.importance : 3));
          return h("div", { key: i, className: "myt-tlRow" },
            h("div", { className: "myt-tlYear" }, orDash(t.year)),
            h("div", { className: "myt-tlAxis" }, h("span", { className: "myt-tlDot", "data-imp": String(imp), title: tf("timeline.importance", { n: imp }) })),
            h("div", { className: "myt-tlCard" },
              h("div", { className: "myt-tlTitle" }, orDash(t.title)),
              t.description ? h("div", { className: "myt-tlDesc" }, t.description) : null,
              t.chapter ? h("div", { className: "myt-tlChapter" }, tf("timeline.linkedChapter", { ch: t.chapter })) : null));
        }))),
        srcRel ? h(SourceEditorModal, { title: tt("src.editSource"), rel: srcRel, wsPath: wsPath, onClose: function () { setSrcRel(null); }, onSaved: reload }) : null);
    }

    // ── 设定 tab：world 按 category 分组 + science 三色标签 ─────────────────
    // ── 写作风格 tab：novel/style.md 基准的查看与编辑（写手/大纲师/审校共同
    // 遵守）。挂载/换工作区时 GET style 按需拉取（请求序号防过期响应，对照
    // OverviewTab 的 check effect）；视图态 MdView 渲染全文，缺失时空态卡用
    // 插件模板预填创建；编辑态整文件保存（style-save 携 base_hash，409 人工
    // 改动保护链路：成功接写后新指纹防连续保存假冲突；409 草稿绝不丢——保留
    // 草稿报冲突，亮「载入磁盘版 / 基于最新版重改」两个出口，同 ChapterReader）。
    function StyleTab(props) {
      var wsPath = props.wsPath;
      var _st = useState(null), st = _st[0], setSt = _st[1]; // {loading, data, err}
      var seqRef = useRef(0);
      // 编辑态：draft 为 null = 视图态；字符串 = 编辑中的全文。draftHash 是
      // 进入编辑态（或上次保存成功）时的磁盘指纹，保存时作 base_hash 回传。
      var _dr = useState(null), draft = _dr[0], setDraft = _dr[1];
      var _dh = useState(null), draftHash = _dh[0], setDraftHash = _dh[1];
      var _er = useState(""), editErr = _er[0], setEditErr = _er[1];
      var _b = useState(false), busy = _b[0], setBusy = _b[1];
      // 409 冲突态：true 时编辑区亮出「载入磁盘版 / 基于最新版重改」两个出口。
      var _cf = useState(false), conflict = _cf[0], setConflict = _cf[1];
      // 409 后的一次性重置标记：reload 带回磁盘真值时把编辑器与基线一并重置
      // （只置位于保存冲突路径；顶栏刷新等其他拉取不碰正在编辑的内容）。
      var pendingResetRef = useRef(false);
      // 换工作区：丢弃旧工作区的编辑态与在途编辑结果，再按新工作区重拉。
      var wsRef = useRef(wsPath);
      var load = useCallback(function () {
        var seq = ++seqRef.current; // 先自增再发请求；早退分支也作废在途旧响应
        setSt({ loading: true, data: null, err: "" });
        apiGet("style", { path: wsPath }).then(function (d) {
          if (seq !== seqRef.current) return; // 过期响应：已有更新的请求在途，丢弃
          setSt({ loading: false, data: d, err: "" });
          if (pendingResetRef.current) {
            // 409 冲突出口①「放弃草稿」的重拉：编辑器放回磁盘真值、基线对齐
            // 最新指纹，停留编辑态。
            pendingResetRef.current = false;
            setDraft(d && typeof d.text === "string" ? d.text : "");
            setDraftHash(d && typeof d.hash === "string" ? d.hash : null);
          }
        }).catch(function (err) {
          if (seq !== seqRef.current) return;
          setSt({ loading: false, data: null, err: err.message });
        });
      }, [wsPath]);
      useEffect(function () {
        if (wsRef.current !== wsPath) {
          wsRef.current = wsPath;
          setDraft(null); setDraftHash(null); setEditErr(""); setConflict(false); pendingResetRef.current = false;
        }
        load();
      }, [wsPath, load]);
      function startEdit() {
        if (!st.data || typeof st.data.text !== "string") return;
        setEditErr("");
        setDraftHash(typeof st.data.hash === "string" ? st.data.hash : null);
        setDraft(st.data.text);
      }
      function startFromTemplate() {
        if (!st.data || typeof st.data.template !== "string") return;
        setEditErr("");
        setDraftHash(null); // 文件尚不存在：无基线可护，保存即创建
        setDraft(st.data.template);
      }
      function cancelEdit() {
        if (busy) return; // 保存在途不许退出：避免卸载后 setState
        if (dirty && !window.confirm(tt("common.dirtyExit"))) return; // 脏退出先确认
        setDraft(null); setDraftHash(null); setEditErr(""); setConflict(false);
      }
      function save() {
        if (busy) return;
        setBusy(true); setEditErr("");
        // 失败经卡内 editErr 呈现（silent 抑制 apiPost 同文 toast）；成功提示仍走
        // toast 通道。空文本允许保存（空文件 = 无基准，agent 侧优雅降级）。
        apiPost("style-save", { path: wsPath, text: draft, base_hash: draftHash }, { silent: true }).then(function (res) {
          // 写后指纹即下一轮基线（连续保存不再被自家 409 拦住）；本地数据
          // 同步为新文本，取消编辑退回视图态时看到的已是刚落盘的内容。
          var hash = res && typeof res.hash === "string" ? res.hash : null;
          setDraftHash(hash);
          setConflict(false);
          setSt({ loading: false, data: { found: true, text: draft, hash: hash, template: st.data ? st.data.template : null }, err: "" });
        }).catch(function (err) {
          if (err && err.status === 409) {
            // 409 = style.md 在进入编辑态后被外部改过：草稿绝不丢——报冲突并
            // 亮两个出口（放弃草稿载入磁盘版 / 基于最新版重改），不再静默重置。
            setConflict(true);
            setEditErr(tf("edit.conflict409", { msg: err.message }));
          } else {
            setEditErr(err.message);
          }
        }).finally(function () { setBusy(false); });
      }
      // 409 出口①：放弃草稿——重拉磁盘真值放回编辑器（pendingResetRef 老链路）。
      function dropStyleDraft() {
        if (busy) return;
        setConflict(false); setEditErr("");
        pendingResetRef.current = true;
        load();
      }
      // 409 出口②：基于磁盘最新版重改——只换 data 拿新指纹（draftHash），草稿
      // 原样留在编辑器，改完再存即用新基线。
      function rebaseStyleDraft() {
        if (busy) return;
        var seq = ++seqRef.current;
        apiGet("style", { path: wsPath }).then(function (d) {
          if (seq !== seqRef.current) return;
          setSt({ loading: false, data: d, err: "" });
          setDraftHash(d && typeof d.hash === "string" ? d.hash : null);
          setConflict(false); setEditErr("");
        }).catch(function (err) {
          if (seq !== seqRef.current) return;
          setEditErr(err.message); // 重拉失败：冲突态保留可重试
        });
      }
      var data = st ? st.data : null;
      // 脏检查：草稿偏离磁盘原文即脏（模板创建时磁盘原文按空算）。上报
      // DIRTY_EXIT 供切 tab 拦截——本 tab 切走即卸载，草稿会丢。
      var dirty = draft !== null && draft !== (data && typeof data.text === "string" ? data.text : "");
      useEffect(function () {
        DIRTY_EXIT.dirty = dirty;
        return function () { DIRTY_EXIT.dirty = false; };
      });
      function applyRegister(register, label) {
        if (busy) return;
        setBusy(true);
        xiaoyuApi("style-register", { path: wsPath, register: register }).then(function () {
          toast.ok(tf("style.registerOk", { name: label }));
          load();
        }).catch(function (err) {
          toast.err(tf("toast.prefix", { msg: err.message }));
        }).finally(function () { setBusy(false); });
      }
      // 视图态动作位（0.4.11）：档位按钮 + 编辑入口抽成一份，视图态挂到折叠块
      // 头部右侧（收起后照样能切档/进编辑）；加载/失败/空态/编辑态仍用卡头。
      // 语言档位清单（0.8.0）：由服务端扫 templates/novel/style-presets/*.md 得出，
      // 新增档位文件即出现在按钮里，客户端不再写死三档。
      var _regs = useState(null), regs = _regs[0], setRegs = _regs[1];
      useEffect(function () {
        var alive = true;
        apiGet("style-presets", {}, { silent: true }).then(function (d) {
          if (alive && d && d.ok && Array.isArray(d.items) && d.items.length) setRegs(d.items);
        }).catch(function () {});
        return function () { alive = false; };
      }, []);
      var styleActions = [];
      if (draft === null) {
        var regList = Array.isArray(regs) && regs.length ? regs : [
          { register: "plain", label: "大白话" }, { register: "semi", label: "文白相间" }, { register: "classical", label: "古风" },
        ];
        styleActions = regList.map(function (item) {
          var key = item.register;
          var label = item.label || key;
          return h("button", {
            key: "reg-" + key, type: "button", className: "myt-btn",
            title: tf("style.registerTip", { name: label }),
            disabled: !data || (st && st.err) !== "" || busy || !data.found,
            onClick: function () { applyRegister(key, label); },
          }, label);
        });
        styleActions.push(h("button", {
          key: "style-edit", type: "button", className: "myt-btn",
          title: tt("style.editTip"), "aria-label": tt("style.editTip"),
          disabled: !data || (st && st.err) !== "" || busy,
          onClick: data && data.found ? startEdit : startFromTemplate,
        }, ic("IconEditOutlineRegular", 13), tt("overview.edit")));
      }
      var head = h("div", { className: "myt-cardHead" },
        h("h3", { className: "myt-cardTitle" }, tt("tabs.style")),
        h("span", { className: "myt-muted" }, tt("style.note")),
        h("div", { className: "myt-styleRegs" }, styleActions));
      // 拉取中：轻量骨架（对照 ChapterReader 的加载态）；失败：错误条可重试。
      if (st === null || st.loading) {
        return h("div", { className: "myt-stack" },
          h("div", { className: "myt-card" }, head,
            h("div", { className: "myt-skel myt-skelRow", style: { width: "38%" } }),
            h("div", { className: "myt-skel myt-skelRow", style: { width: "82%" } }),
            h("div", { className: "myt-skel myt-skelRow", style: { width: "64%" } }),
            h("div", { className: "myt-skel myt-skelRow", style: { width: "74%" } })));
      }
      if (st.err !== "") {
        return h("div", { className: "myt-stack" },
          h("div", { className: "myt-card" }, head),
          h(ErrorStrip, { text: tf("style.loadFailed", { msg: st.err }), onRetry: load }));
      }
      if (draft !== null) {
        // 编辑态：整文件 textarea + 取消/保存（动作区与表单卡同构）。
        return h("div", { className: "myt-stack" },
          h("div", { className: "myt-card" }, head,
            h("textarea", {
              className: "myt-setInput myt-setArea myt-styleArea", rows: 18, spellCheck: false,
              value: draft, onChange: function (e) { autoHoldRef.current = false; setDraft(e.target.value); rememberDraft(e.target.value, titleRef.current); },
            })),
          editErr ? h(ErrorStrip, { text: editErr }) : null,
          conflict ? h("div", { className: "myt-setActions" },
            h("button", { type: "button", className: "myt-btn", disabled: busy, onClick: dropStyleDraft }, tt("edit.conflictDrop")),
            h("button", { type: "button", className: "myt-btn myt-btnPrimary", disabled: busy, onClick: rebaseStyleDraft }, tt("edit.conflictKeep"))) : null,
          h("div", { className: "myt-setActions" },
            h("button", { type: "button", className: "myt-btn", disabled: busy, onClick: cancelEdit }, tt("novel.cancel")),
            h("button", { type: "button", className: "myt-btn myt-btnPrimary", disabled: busy, onClick: save },
              busy ? tt("novel.saving") : tt("novel.save"))));
      }
      if (!data || data.found !== true) {
        // 文件未创建：空态卡 + 模板创建引导（模板读不到时按钮禁用）。
        var tplReady = !!(data && typeof data.template === "string");
        return h("div", { className: "myt-stack" },
          h("div", { className: "myt-card" }, head,
            h("div", { className: "myt-styleEmpty" },
              h("p", { className: "myt-muted" }, tt("style.empty")),
              h("button", {
                type: "button", className: "myt-btn myt-btnPrimary", disabled: !tplReady || busy,
                title: tt("style.editTip"), "aria-label": tt("style.editTip"),
                onClick: startFromTemplate,
              }, tt("style.createFromTpl")))));
      }
      // 视图态（0.4.11）：整篇风格基准收进折叠块——头一行「写作风格 · 字数」，
      // 展开时框内自己滚，不再把 1800 字的基准铺成一整页（用户实拍长龙）。
      // 空文件渲出空容器——空文件 = 无基准，是保存过的合法状态，不当缺失处理。
      var styleWords = (data.text || "").length;
      return h("div", { className: "myt-stack" },
        h(CollapseBox, {
          full: true,
          title: tt("tabs.style"),
          meta: styleWords ? tf("common.charCount", { n: fmtNum(styleWords) }) : null,
          extra: null,
        }, h("div", { className: "myt-styleBody" },
          styleActions.length ? h("div", { className: "myt-styleRegs" }, styleActions) : null,
          h(MdView, { text: data.text || "" }))));
    }

    function WorldTab(props) {
      var snap = props.snap;
      var wsPath = props.wsPath;
      var reload = props.reload;
      var world = snap.world || [];
      var science = snap.science || [];
      var research = snap.research || [];
      // 受管文件三态：编辑 rel / 新建分区（world|science）/ 删除确认 rel。
      // research 是调研笔记目录，v1 无面板入口（快照有卡，写面暂不开放）。
      var _src = useState(null), srcRel = _src[0], setSrcRel = _src[1];
      var _new = useState(null), createDir = _new[0], setCreateDir = _new[1];
      var _del = useState(null), delRel = _del[0], setDelRel = _del[1];
      // 无原型容器：key 来自数据文件的自由文本（category），值为
      // constructor/__proto__/toString 等时若用普通 {} 会命中 Object.prototype
      // 真值 → TypeError → 整面板白屏；Object.create(null) 杜绝。
      var groups = Object.create(null);
      world.forEach(function (w) {
        var key = w.category || tt("common.uncategorized");
        if (!groups[key]) groups[key] = [];
        groups[key].push(w);
      });
      var groupKeys = Object.keys(groups).sort(function (a, b) { return a.localeCompare(b, "zh-CN"); });
      // 三分区改子 tab 切换：纵向三卡堆太高，改子 tab 条 + 仅渲染激活分区。
      // state 存在本组件（切走再切回不丢；卡头 h3 随卡一起只画激活分区）。
      // research 空时原实现整卡隐藏，现 tab 恒在、空态走 world.researchEmpty。
      var _st = useState("world"), subTab = _st[0], setSubTab = _st[1];
      // world 分区内的二级分类 tab：state 只存用户上次的偏好，快照重拉后该
      // 分类可能已不存在（条目被删/改名），此时回落第一个分类；null = 首选
      // 第一个。单分类时不出 tab 条、直接平铺。
      var _cat = useState(null), catPref = _cat[0], setCatPref = _cat[1];
      var subDefs = [
        ["world", tt("world.title"), world.length],
        ["science", tt("world.science"), science.length],
        ["research", tt("world.research"), research.length],
      ];
      var activeCat = catPref !== null && groupKeys.indexOf(catPref) !== -1 ? catPref : groupKeys[0];
      return h("div", { className: "myt-stack" },
        h("nav", { className: "myt-subTabs", "aria-label": tt("world.subTabsAria") },
          subDefs.map(function (s) {
            return h("button", {
              key: s[0], type: "button", className: "myt-subTab", "data-active": subTab === s[0] ? "true" : undefined,
              onClick: function () { setSubTab(s[0]); },
            }, s[1], h("span", { className: "myt-boardCount" }, String(s[2])));
          })),
        subTab === "world" ? h("div", { className: "myt-card" },
          h("div", { className: "myt-cardHead" },
            h("h3", { className: "myt-cardTitle" }, tt("world.title")),
            h("button", { type: "button", className: "myt-btn", onClick: function () { setCreateDir("world"); } }, tt("world.createBtn"))),
          // 多分类：二级子 tab 条（分类名 + 条目计数），分组头不再需要——tab
          // 已承载分类名与计数；单分类/无分类不出 tab 条直接平铺。
          groupKeys.length > 1 ? h("nav", { className: "myt-subTabs myt-subTabsInner", "aria-label": tt("world.catTabsAria") },
            groupKeys.map(function (key) {
              return h("button", {
                key: key, type: "button", className: "myt-subTab", "data-active": activeCat === key ? "true" : undefined,
                onClick: function () { setCatPref(key); },
              }, key, h("span", { className: "myt-boardCount" }, String(groups[key].length)));
            })) : null,
          groupKeys.length ? h("div", { className: "myt-stack" }, groups[activeCat].map(function (w, i) {
            return h("div", { key: w.file || i, className: "myt-worldItem" },
              h("div", { className: "myt-worldHead" },
                h("span", { className: "myt-worldName" }, orDash(w.name)),
                (w.tags || []).length ? h("span", { className: "myt-tagRow" }, w.tags.map(function (t, j) { return h("span", { key: j, className: "myt-tag" }, t); })) : null),
              w.description ? h("div", { className: "myt-scrollBox" }, h(MdView, { text: w.description, className: "myt-worldDesc" })) : null,
              h("div", { className: "myt-itemActions" },
                srcEditBtn("world/" + w.file, function () { setSrcRel("world/" + w.file); }),
                srcDeleteBtn("world/" + w.file, function () { setDelRel("world/" + w.file); })));
          })) : h(Empty, { text: tt("world.empty") })) : null,
        subTab === "science" ? h("div", { className: "myt-card" },
          h("div", { className: "myt-cardHead" }, h("h3", { className: "myt-cardTitle" }, tt("world.science")),
            h("span", { className: "myt-boardCount" }, science.length),
            h("button", { type: "button", className: "myt-btn", onClick: function () { setCreateDir("science"); } }, tt("world.createScienceBtn"))),
          science.length ? h("div", { className: "myt-stack" }, science.map(function (s, i) {
            var label = ["known", "extrapolation", "hypothesis"].indexOf(s.label) !== -1 ? s.label : null;
            return h("div", { key: s.file || i, className: "myt-worldItem" },
              h("div", { className: "myt-worldHead" },
                h("span", { className: "myt-worldName" }, orDash(s.name)),
                h("span", { className: "myt-badge myt-sciTag", "data-label": label || "hypothesis", title: s.label && !label ? s.label : undefined },
                  label ? tt("sci." + label) : (s.label || tt("world.unlabeled")))),
              s.description ? h("div", { className: "myt-scrollBox" }, h(MdView, { text: s.description, className: "myt-worldDesc" })) : null,
              (s.references || []).length ? h("div", { className: "myt-refList" },
                s.references.map(function (r, j) { return h("span", { key: j, className: "myt-refItem" }, tf("world.ref", { n: j + 1, r: r })); })) : null,
              h("div", { className: "myt-itemActions" },
                srcEditBtn("science/" + s.file, function () { setSrcRel("science/" + s.file); }),
                srcDeleteBtn("science/" + s.file, function () { setDelRel("science/" + s.file); })));
          })) : h(Empty, { text: tt("world.scienceEmpty") })) : null,
        subTab === "research" ? h("div", { className: "myt-card" },
          h("div", { className: "myt-cardHead" }, h("h3", { className: "myt-cardTitle" }, tt("world.research")),
            h("span", { className: "myt-boardCount" }, research.length)),
          research.length ? h("div", { className: "myt-stack" }, research.map(function (r, i) {
            return h("div", { key: r.file || i, className: "myt-worldGroup" },
              h("div", { className: "myt-listHead" },
                h("span", { className: "myt-worldName", title: r.file || "" }, orDash(r.topic) || r.file)),
              r.description ? h("div", { className: "myt-scrollBox" }, h(MdView, { text: r.description, className: "myt-worldDesc" })) : null,
              (r.sources || []).length ? h("div", { className: "myt-refList" },
                r.sources.map(function (s, j) { return h("span", { key: j, className: "myt-refItem", title: s }, tf("world.ref", { n: j + 1, r: s })); })) : null);
          })) : h(Empty, { text: tt("world.researchEmpty") })) : null,
        srcRel ? h(SourceEditorModal, { title: tt("src.editSource"), rel: srcRel, wsPath: wsPath, onClose: function () { setSrcRel(null); }, onSaved: reload }) : null,
        createDir ? h(CreateFileModal, {
          title: createDir === "science" ? tt("world.createScienceBtn") : tt("world.createBtn"),
          dir: createDir,
          template: createDir === "science" ? TPL_SCIENCE : TPL_WORLD,
          wsPath: wsPath, onClose: function () { setCreateDir(null); }, onSaved: reload,
        }) : null,
        delRel ? h(ConfirmModal, {
          title: tf("src.deleteTip", { rel: delRel }),
          text: tf("src.confirmText", { rel: delRel }),
          onCancel: function () { setDelRel(null); },
          onConfirm: function () {
            return apiPost("file-delete", { path: wsPath, rel: delRel }).then(function () {
              setDelRel(null);
              return reload();
            });
          },
        }) : null);
    }

    // ── 索引板 tab：clues 按 kind 分组（resolved 划线）+ memories 按 category
    // 分组（promise 类高亮）；头部「重建索引」POST rebuild-index 后重拉。───
    function IndexTab(props) {
      var snap = props.snap;
      var reload = props.reload;
      var wsPath = props.wsPath;
      var _b = useState(false), rebuildBusy = _b[0], setRebuildBusy = _b[1];
      function rebuild() {
        if (rebuildBusy) return;
        setRebuildBusy(true);
        apiPost("rebuild-index", { path: wsPath }).then(reload).catch(function () {}).finally(function () { setRebuildBusy(false); });
      }
      var clues = snap.clues || [];
      var memories = snap.memories || [];
      // 无原型容器：kind/category 是数据文件自由文本，见 WorldTab 处说明。
      var clueGroups = Object.create(null);
      clues.forEach(function (c) {
        var key = c.kind || tt("common.uncategorized");
        if (!clueGroups[key]) clueGroups[key] = [];
        clueGroups[key].push(c);
      });
      var memGroups = Object.create(null);
      memories.forEach(function (m) {
        var key = m.category || tt("common.uncategorized");
        if (!memGroups[key]) memGroups[key] = [];
        memGroups[key].push(m);
      });
      function groupKey(a, b) { return a.localeCompare(b, "zh-CN"); }
      // 两本索引账源文件直达（0.1.20 写面）：clue-board.yml / memories.yml。
      var _src = useState(null), srcRel = _src[0], setSrcRel = _src[1];
      return h("div", { className: "myt-stack" },
        h("div", { className: "myt-cardHead" },
          h("h3", { className: "myt-cardTitle" }, tt("index.title")),
          h("button", { type: "button", className: "myt-btn", disabled: rebuildBusy, onClick: rebuild, title: tt("index.rebuildTip") },
            rebuildBusy ? tt("index.rebuilding") : tt("index.rebuild"))),
        // 两本索引账（0.4.11）：条目一多就顶穿整页，各收进一个折叠块内滚。
        h("div", { className: "myt-indexCols" },
          h(CollapseBox, {
            title: tt("index.clueBoard"),
            meta: clues.length,
            extra: srcEditBtn("clue-board.yml", function () { setSrcRel("clue-board.yml"); }),
          },
            clues.length ? Object.keys(clueGroups).sort(groupKey).map(function (kind) {
              var ck = CLUE_KIND_KEYS[kind];
              var label = ck ? tt("clue." + ck) : kind;
              return h("div", { key: kind, className: "myt-worldGroup" },
                h("div", { className: "myt-listHead" }, label, h("span", { className: "myt-boardCount" }, clueGroups[kind].length)),
                clueGroups[kind].map(function (c, i) {
                  return h("div", { key: i, className: "myt-clueItem", "data-resolved": c.resolved ? "true" : undefined },
                    h("span", { className: "myt-clueText" }, orDash(c.content)),
                    c.related_chapter ? h("span", { className: "myt-clueChapter" }, c.related_chapter) : null);
                }));
            }) : h(Empty, { text: tt("index.clueEmpty") })),
          h(CollapseBox, {
            title: tt("index.memBoard"),
            meta: memories.length,
            extra: srcEditBtn("memories.yml", function () { setSrcRel("memories.yml"); }),
          },
            memories.length ? Object.keys(memGroups).sort(groupKey).map(function (cat) {
              var isPromise = /promise|承诺/i.test(cat);
              return h("div", { key: cat, className: "myt-worldGroup" },
                h("div", { className: "myt-listHead" },
                  cat, isPromise ? h("span", { className: "myt-markerTag" }, tt("index.promise")) : null,
                  h("span", { className: "myt-boardCount" }, memGroups[cat].length)),
                memGroups[cat].map(function (m, i) {
                  return h("div", { key: i, className: "myt-memItem", "data-promise": isPromise ? "true" : undefined },
                    h("span", { className: "myt-clueText" }, orDash(m.content)),
                    m.source_chapter ? h("span", { className: "myt-memChapter" }, m.source_chapter) : null);
                }));
            }) : h(Empty, { text: tt("index.memEmpty") }))),
        srcRel ? h(SourceEditorModal, { title: tt("src.editSource"), rel: srcRel, wsPath: wsPath, onClose: function () { setSrcRel(null); }, onSaved: reload }) : null);
    }

    // ── 关系图 tab：canvas 力导向 + 关系清单（0.9.0 关系图完善）─────────────
    // 力学沿用 0.8.x：斥力 + 弹簧 + 中心引力 + 硬碰撞分离（rAF 循环、静止停机、
    // 帧数上限兜底）。0.9.0 在其上补三层：
    //   ① 语义层：关系类型配色/线型、方向箭头、阶段与已结束虚化、类型图例；
    //   ② 信息层：类型筛选 + 搜索 + 按章过滤（默认只到最新章节，防剧透）+ 关系
    //      清单（点行高亮对应边、点人名跳角色卡）+ 未登记起始章的体检提示；
    //   ③ 交互/输出：点节点聚焦一度关系、点边选中、双指缩放 + 拖动平移、导出
    //      PNG、复制关系清单 markdown。
    // 数据侧只读：扩展字段（direction/phase/tags/stages）缺席时一律走缺省
    //（双向 / 现在 / 无阶段），旧 relations.yml 一条不改也照旧出图。
    var NODE_ROLE_COLORS = { protagonist: "#f53f3f", supporting: "#165dff", antagonist: "#1d2129", minor: "#fadc19" };
    function edgeWidth(intensity) {
      var n = typeof intensity === "number" && isFinite(intensity) ? Math.round(intensity) : 3;
      n = Math.min(5, Math.max(1, n));
      return 1 + ((n - 1) * 3) / 4; // 1..4px
    }
    // 关系类型视觉编码：常见类型给固定色 + 线型（同类关系恒同色，跨章节跨会话
    // 稳定）；契约外自由文本按字符串哈希落 8 色盘——类型本来就是自定文本，
    // 不能因为写了个没见过的类型就不给颜色。
    var REL_TYPE_STYLES = {
      "对立": { c: "#f53f3f", dash: [] },
      "宿敌": { c: "#f53f3f", dash: [] },
      "敌对": { c: "#f53f3f", dash: [] },
      "仇敌": { c: "#f53f3f", dash: [] },
      "同盟": { c: "#165dff", dash: [] },
      "盟友": { c: "#165dff", dash: [] },
      "合作": { c: "#165dff", dash: [] },
      "亲友": { c: "#00b42a", dash: [] },
      "亲人": { c: "#00b42a", dash: [] },
      "朋友": { c: "#00b42a", dash: [] },
      "师徒": { c: "#722ed1", dash: [] },
      "同门": { c: "#0fc6c2", dash: [] },
      "雇佣": { c: "#86909c", dash: [] },
      "上下级": { c: "#86909c", dash: [] },
      "从属": { c: "#86909c", dash: [] },
      "还债": { c: "#ff7d00", dash: [7, 4] },
      "欠债": { c: "#ff7d00", dash: [7, 4] },
      "暧昧": { c: "#f5319d", dash: [7, 4] },
      "恋人": { c: "#f5319d", dash: [] },
      "夫妻": { c: "#f5319d", dash: [] },
    };
    var REL_TYPE_FALLBACK = ["#4c7dff", "#00b42a", "#ff7d00", "#722ed1", "#0fc6c2", "#eb2f96", "#f7ba1e", "#86909c"];
    function relTypeStyle(type) {
      var t = String(type === null || type === undefined ? "" : type).trim();
      // hasOwnProperty：类型是自由文本，「constructor」这类原型键不能当命中
      if (Object.prototype.hasOwnProperty.call(REL_TYPE_STYLES, t)) return REL_TYPE_STYLES[t];
      var hcode = 0;
      for (var i = 0; i < t.length; i++) hcode = (hcode * 31 + t.charCodeAt(i)) % 100003;
      return { c: REL_TYPE_FALLBACK[hcode % REL_TYPE_FALLBACK.length], dash: [] };
    }
    // 章节号排序键：v01-c003 → 1000003。两种写法都认——快照的 chapters[].file
    // 带 .md 后缀（v01-c003.md），relations 的 started/ended 与 stages.chapter
    // 是裸 stem（v01-c003）。**必须先去后缀再匹配**：只认裸 stem 的话，按章
    // 过滤拿到 null 就等于「不过滤」，选章节一整张图纹丝不动（0.9.2 修）。
    // 合不上规范名的（自由文本章号、空串）返回 null——调用方按「未知」处理
    // （不参与按章过滤，也绝不被误藏）。
    function chapOrdinal(stem) {
      var s = String(stem === null || stem === undefined ? "" : stem).trim().replace(/\.md$/i, "");
      var m = /^v(\d+)-c(\d+)$/i.exec(s);
      return m === null ? null : Number(m[1]) * 1e6 + Number(m[2]);
    }
    // 关系在某一章是否「在场」：ord 为 null = 看全部（含剧透），一律在场。
    // started 解析不出（未登记）视为早已开始、不隐藏——宁可多画不可错藏。
    function relActiveAt(rel, ord) {
      if (ord === null) return true;
      var s = chapOrdinal(rel.started);
      var e = chapOrdinal(rel.ended);
      if (s !== null && s > ord) return false;
      if (e !== null && e < ord) return false;
      return true;
    }
    // 阶段解析：取「章号 ≤ ord 的最后一个阶段」，无阶段时用基字段。ord 为 null
    // （看全部）取最后一个阶段＝最终态。阶段里没写的字段回落基字段。
    function relAt(rel, ord) {
      var limit = ord === null ? Number.MAX_SAFE_INTEGER : ord;
      var picked = null;
      var stages = rel.stages || [];
      for (var i = 0; i < stages.length; i++) {
        var k = chapOrdinal(stages[i].chapter);
        if (k !== null && k <= limit) picked = stages[i];
      }
      if (!picked) return { type: rel.type, description: rel.description, intensity: rel.intensity, phase: rel.phase, direction: rel.direction };
      return {
        type: picked.type !== null && picked.type !== undefined ? picked.type : rel.type,
        description: picked.description !== null && picked.description !== undefined ? picked.description : rel.description,
        intensity: picked.intensity !== null && picked.intensity !== undefined ? picked.intensity : rel.intensity,
        phase: picked.phase || rel.phase,
        direction: rel.direction,
      };
    }
    function relDirGlyph(direction) {
      if (direction === "a-to-b") return "→";
      if (direction === "b-to-a") return "←";
      return "↔";
    }
    // 强度点：五格，实心格数 = 钳到 1-5 的强度；未知强度全空（不假装 3）。
    function relIntensityDots(intensity, color) {
      var n = typeof intensity === "number" && isFinite(intensity) ? Math.round(intensity) : 0;
      n = Math.min(5, Math.max(0, n));
      var dots = [];
      for (var i = 0; i < 5; i++) dots.push(h("i", { key: i, "data-on": i < n ? "1" : "0" }));
      return h("span", { className: "myt-relInt", style: { "--myt-rel-c": color }, title: tf("relations.intensityTitle", { n: n || "—" }) }, dots);
    }
    function roundRectPath(c, x, y, w, hh, r) {
      var rr = Math.min(r, w / 2, hh / 2);
      c.beginPath();
      c.moveTo(x + rr, y);
      c.lineTo(x + w - rr, y); c.quadraticCurveTo(x + w, y, x + w, y + rr);
      c.lineTo(x + w, y + hh - rr); c.quadraticCurveTo(x + w, y + hh, x + w - rr, y + hh);
      c.lineTo(x + rr, y + hh); c.quadraticCurveTo(x, y + hh, x, y + hh - rr);
      c.lineTo(x, y + rr); c.quadraticCurveTo(x, y, x + rr, y);
      c.closePath();
    }
    // 节点名最多两行：中文 5 字/行，超了第二行省略号。手机窄屏下长名不再横着
    // 糊成一坨压在相邻节点上。
    function splitLabel(name) {
      var s = String(name === null || name === undefined ? "" : name);
      if (s.length <= 5) return [s];
      var rest = s.slice(5);
      return [s.slice(0, 5), rest.length > 4 ? rest.slice(0, 4) + "…" : rest];
    }
    function sortRelRows(rows, sortBy) {
      var arr = rows.slice();
      var inten = function (r) { return typeof r.at.intensity === "number" ? r.at.intensity : 0; };
      var typeName = function (r) { return String(r.at.type || ""); };
      if (sortBy === "chapter") {
        arr.sort(function (x, y) {
          var kx = chapOrdinal(x.rel.started); var ky = chapOrdinal(y.rel.started);
          if (kx === null) kx = -1;
          if (ky === null) ky = -1;
          if (kx !== ky) return kx - ky;
          return inten(y) - inten(x);
        });
      } else if (sortBy === "type") {
        arr.sort(function (x, y) {
          var t = typeName(x).localeCompare(typeName(y), "zh");
          return t !== 0 ? t : inten(y) - inten(x);
        });
      } else {
        arr.sort(function (x, y) {
          var d = inten(y) - inten(x);
          return d !== 0 ? d : typeName(x).localeCompare(typeName(y), "zh");
        });
      }
      return arr;
    }
    function RelationsTab(props) {
      var snap = props.snap;
      var wsPath = props.wsPath;
      var reload = props.reload;
      var onOpenChar = typeof props.onOpenChar === "function" ? props.onOpenChar : null;
      // 关系账本源文件直达（0.1.20 写面）：relations.yml 整文件可编辑。
      var _src = useState(null), srcRel = _src[0], setSrcRel = _src[1];
      var _tip = useState(null), tip = _tip[0], setTip = _tip[1]; // {x, y, text}
      var _q = useState(""), q = _q[0], setQ = _q[1];
      var _ts = useState([]), typeSel = _ts[0], setTypeSel = _ts[1]; // 选中的关系类型（空 = 全部）
      var _cs = useState(null), chapSel = _cs[0], setChapSel = _cs[1]; // null = 跟最新章节，"" = 全部
      var _fn = useState(null), focusName = _fn[0], setFocusName = _fn[1];
      var _si = useState(null), selIdx = _si[0], setSelIdx = _si[1]; // 选中的关系（原始下标）
      var _sb = useState("intensity"), sortBy = _sb[0], setSortBy = _sb[1];
      var _af = useState(false), autofillOpen = _af[0], setAutofillOpen = _af[1];
      // 关系去重（3.1.0）：本地先算重复组（不联网就能显示「×6」的按钮），点了再走服务端。
      var _dd = useState(false), dedupeBusy = _dd[0], setDedupeBusy = _dd[1];
      var _ct = useState(null), copyText = _ct[0], setCopyText = _ct[1];
      var wrapRef = useRef(null);
      var canvasRef = useRef(null);
      var copyRef = useRef(null);
      var listRef = useRef(null); // 关系清单容器：画布选中边时把对应行滚进视野
      var tipRafRef = useRef(0); // hover 提示 rAF 句柄：卸载/换图时取消在途合帧
      var zoomApiRef = useRef(null); // 绘图区按钮桥：渲染层 → 绘图 effect 闭包
      var focusRef = useRef(null); // draw 读聚焦态：改聚焦不重建力导向
      var selRef = useRef(null);
      var wakeRef = useRef(null);
      var posRef = useRef(Object.create(null)); // 节点位置缓存：换筛选不重排布局
      var _fs2 = useState(false), isFs = _fs2[0], setFs = _fs2[1]; // 当前处于全屏
      // 只看强关系（0.15.0）：角色一多、关系网几十上百条时，弱关系把图糊成一团。
      // 强度 ≥3 视为主线，弱关系沉到列表里仍能看到，只是不上图。
      var _strong = useState(false), strongOnly = _strong[0], setStrongOnly = _strong[1];
      var _fok = useState(false), canFs = _fok[0], setCanFs = _fok[1]; // 宿主支持 Fullscreen API
      var chapters = snap.chapters || [];
      var defaultChap = chapters.length ? chapters[chapters.length - 1].file : "";
      var effChap = chapSel === null ? defaultChap : chapSel; // "" = 全部
      var effOrd = effChap ? chapOrdinal(effChap) : null;
      var allRels = useMemo(function () {
        return (snap.relations || []).filter(function (r) { return r && r.a && r.b && r.a !== r.b; });
      }, [snap]);
      // 本章出场过滤（0.15.3）：选中某一章时，只画这一章露过面的人。名单由
      // 服务端扫正文得出（判据与 audit 的「角色 0 出场」同一把尺子）；拉不到
      // 或一个都没认出来就退化为不过滤——图不该因为读失败/别名写法变空。
      var _cast = useState(null), cast = _cast[0], setCast = _cast[1];
      useEffect(function () {
        if (!wsPath || !effChap) { setCast(null); return undefined; }
        var alive = true;
        apiGet("chapter-cast", { path: wsPath, file: effChap }, { silent: true }).then(function (d) {
          if (!alive) return;
          setCast(d && d.ok && Array.isArray(d.names) && d.names.length ? d.names : null);
        }).catch(function () { if (alive) setCast(null); });
        return function () { alive = false; };
      }, [wsPath, effChap]);
      // 全量模型：每条关系按当前章解析出「此刻的类型/描述/强度/阶段」，并标在场与否。
      // 类型计数与「未登记起始章」体检都基于在场关系算。
      var model = useMemo(function () {
        var rows = allRels.map(function (rel, i) {
          return { idx: i, rel: rel, at: relAt(rel, effOrd), active: relActiveAt(rel, effOrd) };
        });
        var types = [];
        var seen = Object.create(null);
        var missing = 0;
        rows.forEach(function (row) {
          if (!row.active) return;
          var t = row.at.type ? String(row.at.type) : "";
          if (!seen[t]) { seen[t] = { type: t, n: 0 }; types.push(seen[t]); }
          seen[t].n += 1;
          // phase: potential（0.22.0）= 两人还没同章出现，起始章无从填——这是
          // 计划中的关系，不是漏登记，别算进「缺起始章」让作者看着心烦。
          if (row.rel.phase === "potential") return;
          if (chapOrdinal(row.rel.started) === null) missing += 1;
        });
        types.sort(function (x, y) { return y.n - x.n || String(x.type).localeCompare(String(y.type), "zh"); });
        return { rows: rows, types: types, missing: missing };
      }, [allRels, effOrd]);
      // 搜索 + 类型筛选（只在场的行参选；结束/未开始的关系不该出现在「当前关系」里）
      var shown = useMemo(function () {
        var needle = q.trim().toLowerCase();
        return model.rows.filter(function (row) {
          if (!row.active) return false;
          var t = row.at.type ? String(row.at.type) : "";
          if (typeSel.length && typeSel.indexOf(t) === -1) return false;
          if (strongOnly && Number(row.at.intensity || 0) < 3) return false; // 主线开关：弱关系不上图
          if (!needle) return true;
          var hay = [row.at.type, row.at.description, row.rel.a, row.rel.b, (row.rel.tags || []).join(" ")].join(" ").toLowerCase();
          return hay.indexOf(needle) !== -1;
        });
      }, [model, q, typeSel, strongOnly]);
      var sorted = useMemo(function () { return sortRelRows(shown, sortBy); }, [shown, sortBy]);
      // 建图：>30 角色只画有边的节点（其余进「未入图」）；角色空时退化为关系端点名。
      // 用无原型对象：角色名/关系端点是数据文件自由文本。
      var graph = useMemo(function () {
        var chars = snap.characters || [];
        var byName = Object.create(null);
        chars.forEach(function (c) { if (c && c.name && !byName[c.name]) byName[c.name] = c; });
        var deg = Object.create(null);
        shown.forEach(function (row) { deg[row.rel.a] = (deg[row.rel.a] || 0) + 1; deg[row.rel.b] = (deg[row.rel.b] || 0) + 1; });
        var names = chars.length ? chars.map(function (c) { return c.name; }) : Object.keys(deg);
        // 本章没露面的人不上图（0.15.3）：关系仍留在下面的清单里（清单是账本），
        // 只是画布只画「此刻在场的人」——这正是关系图该回答的问题。
        if (Array.isArray(cast) && cast.length) {
          var keep = Object.create(null);
          cast.forEach(function (n) { keep[n] = true; });
          names = names.filter(function (n) { return keep[n]; });
        }
        var linked = names.filter(function (n) { return deg[n]; });
        var drawNames = names.length > 30 ? linked : names;
        var unlinked = names.filter(function (n) { return drawNames.indexOf(n) === -1; });
        var nodes = drawNames.map(function (n) { return { id: n, role: byName[n] ? byName[n].role : null, x: 0, y: 0, vx: 0, vy: 0, fixed: false }; });
        var idx = Object.create(null);
        nodes.forEach(function (nd, i) { idx[nd.id] = i; });
        var edges = shown.filter(function (row) { return idx[row.rel.a] !== undefined && idx[row.rel.b] !== undefined; })
          .map(function (row) {
            var rel = row.rel, at = row.at;
            var st = relTypeStyle(at.type);
            var endedOrd = chapOrdinal(rel.ended);
            var ended = String(rel.ended === null || rel.ended === undefined ? "" : rel.ended).trim() !== "" &&
              (effOrd === null || (endedOrd !== null && endedOrd <= effOrd));
            var phase = at.phase || rel.phase || "now";
            var alpha = 0.85, dash = st.dash;
            if (ended) { alpha = 0.34; dash = [3, 4]; }
            else if (phase === "past") { alpha = 0.45; dash = [3, 4]; }
            else if (phase === "potential") { alpha = 0.6; dash = [6, 4]; }
            return {
              a: idx[rel.a], b: idx[rel.b], na: rel.a, nb: rel.b,
              type: at.type ? String(at.type) : "", desc: at.description || "",
              w: edgeWidth(at.intensity), color: st.c, dash: dash, alpha: alpha,
              dir: rel.direction || "both", rowIdx: row.idx,
            };
          });
        // 同一对节点的重复边编号：dup = 按 (a,b) 无序对分组后的组内序号（0 起）。
        // draw 的 edgeCtrl 按 dup 放大曲线偏移并交替朝向，重复边互相分开不重合。
        var dupCount = Object.create(null);
        edges.forEach(function (e) {
          var key = Math.min(e.a, e.b) + "-" + Math.max(e.a, e.b);
          e.dup = dupCount[key] || 0;
          dupCount[key] = e.dup + 1;
        });
        return { nodes: nodes, edges: edges, unlinked: unlinked };
      }, [snap, shown, effOrd, cast]);
      // 关系重复配对（3.1.0）：同一对角色同一类型挂了几条——这正是图上一对关系
      // 被画成多条并行边的根因。本地先算，不联网就能显示「合并 N 条」的按钮。
      var relDupes = useMemo(function () {
        var rows = snap.relations || [];
        var counts = Object.create(null);
        rows.forEach(function (rel) {
          var key = [rel.a, rel.b].sort().join("|") + "|" + (rel.type || "");
          if (!counts[key]) counts[key] = { key: key, a: rel.a, b: rel.b, type: rel.type || "", count: 0 };
          counts[key].count += 1;
        });
        return Object.keys(counts).map(function (k) { return counts[k]; }).filter(function (row) { return row.count > 1; });
      }, [snap]);
      var dupExtra = 0;
      relDupes.forEach(function (row) { dupExtra += row.count - 1; });
      function mergeDuplicates() {
        if (dedupeBusy || relDupes.length === 0) return;
        setDedupeBusy(true);
        apiPost("relations-dedupe", { path: props.wsPath }).then(function (d) {
          if (!d || !d.ok) throw new Error((d && d.error) || "dedupe failed");
          if (d.changed === false) { toast.ok(tt("relations.dedupeNone")); return; }
          toast.ok(tf("relations.dedupeDone", { from: d.before, to: d.after }));
          if (typeof props.reload === "function") props.reload();
        }).catch(function (err) { toast.err(tf("toast.prefix", { msg: err.message })); })
          .finally(function () { setDedupeBusy(false); });
      }
      // 画布上点中一条边：把清单里对应那行滚进视野（点边＝看这行的完整描述）。
      // 容器内查询，多实例并存（中栏 overlay + 右侧栏 tab）互不串。
      useEffect(function () {
        if (selIdx === null || !listRef.current) return;
        var el = listRef.current.querySelector('[data-idx="' + selIdx + '"]');
        if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }, [selIdx]);
      // 聚焦/选中变化只唤醒重绘，不重建力导向（换布局会丢用户拖好的位置）
      useEffect(function () {
        focusRef.current = graph.nodes.length && graph.nodes.some(function (n) { return n.id === focusName; }) ? focusName : null;
        selRef.current = selIdx;
        if (wakeRef.current) wakeRef.current();
      }, [focusName, selIdx, graph]);
      useEffect(function () {
        var wrap = wrapRef.current;
        var canvas = canvasRef.current;
        if (!wrap || !canvas || !graph.nodes.length) return undefined;
        var ctx = canvas.getContext("2d");
        if (!ctx) return undefined;
        var dpr = (window.devicePixelRatio || 1) > 0 ? window.devicePixelRatio || 1 : 1;
        // 收敛停机参数：能量（速度平方和）阈值 + 碰撞位移静阈 + 连续静止帧数
        // （~0.5s@60fps）；STILL_CAP 是一次唤醒的帧数上限（~15s）兜底——拖拽
        // 节点压着邻居时，弹簧+碰撞+限速会形成持续亚像素抖动的极限环，永远
        // 到不了静止判据，必须有硬上限。面板关闭仅 CSS 隐藏、组件不卸载，rAF
        // 不停就后台永久燃 CPU。
        var ENERGY_TAU = 0.5;
        var MOVE_EPS = 0.5;
        var STILL_FRAMES = 30;
        var STILL_CAP = 900;
        var sim = { zoom: 1, panX: 0, panY: 0, grab: null, pinch: null, tapPos: null, touchAt: 0, raf: 0, frame: 0, w: 0, h: 0, tokens: null, still: 0, frames: 0 };
        // 缩放/复位按钮桥（钳制与滚轮同口径 0.4-2.5）
        zoomApiRef.current = {
          zoomBy: function (k) { zoomAt(sim.w / 2, sim.h / 2, sim.zoom * k); },
          reset: function () {
            sim.zoom = 1; sim.panX = 0; sim.panY = 0;
            graph.nodes.forEach(function (nd) { nd.fixed = false; });
            setTip(null);
            wake();
          },
        };
        // 令牌缓存：每 30 帧重读 computed style，浅/深色切换约半秒内跟上。
        function readTokens() {
          var cs = getComputedStyle(document.body);
          function tok(name, fallback) { return String(cs.getPropertyValue(name) || "").trim() || fallback; }
          return {
            accent: tok("--dsw-alias-state-business-primary", "#4c7dff"),
            label: tok("--dsw-alias-label-primary", "#333"),
            faint: tok("--dsw-alias-label-tertiary", "#999"),
            line: tok("--dsw-alias-border-l4", tok("--dsw-alias-label-tertiary", "#bbb")),
            card: tok("--dsw-alias-bg-layer-2", "#fff"),
            warn: tok("--dsw-alias-state-warn-primary", "#ff7d00"),
          };
        }
        function resize() {
          sim.w = wrap.clientWidth || 640;
          sim.h = wrap.clientHeight || 480;
          canvas.width = Math.max(1, Math.round(sim.w * dpr));
          canvas.height = Math.max(1, Math.round(sim.h * dpr));
          wake(); // 改 width 即清空位图：停机后也要立刻重画（含全屏进出触发的 RO）
        }
        // 初始位置：优先沿用上一次的位置缓存（换筛选/换章不全图重排），
        // 新节点摆在同心圆上交给力导向收敛。
        var R = Math.max(90, Math.min(sim.w || 640, sim.h || 480) / 3);
        var keep = Object.create(null);
        graph.nodes.forEach(function (nd, i) {
          keep[nd.id] = 1;
          var cached = posRef.current[nd.id];
          if (cached) {
            nd.x = cached.x; nd.y = cached.y; nd.fixed = !!cached.fixed; nd.vx = 0; nd.vy = 0;
            return;
          }
          var ang = (i / graph.nodes.length) * Math.PI * 2;
          nd.x = Math.cos(ang) * R;
          nd.y = Math.sin(ang) * R;
          nd.vx = nd.vy = 0;
        });
        Object.keys(posRef.current).forEach(function (k) { if (!keep[k]) delete posRef.current[k]; });
        function toWorld(sx, sy) { return { x: (sx - sim.w / 2 - sim.panX) / sim.zoom, y: (sy - sim.h / 2 - sim.panY) / sim.zoom }; }
        // 缩放锚定在给定屏幕点（滚轮/双指都用）：该点下的世界坐标保持不动
        function zoomAt(sx, sy, next) {
          var z2 = Math.min(2.5, Math.max(0.4, next));
          if (!isFinite(z2) || z2 === sim.zoom) return;
          var wx = (sx - sim.w / 2 - sim.panX) / sim.zoom;
          var wy = (sy - sim.h / 2 - sim.panY) / sim.zoom;
          sim.zoom = z2;
          sim.panX = sx - sim.w / 2 - wx * z2;
          sim.panY = sy - sim.h / 2 - wy * z2;
          wake();
        }
        // 每条边的二次贝塞尔控制点：bow 大小随边长缩放、钳 [12,28] 世界像素；
        // side ∈ {-1,+1} 曲线朝向（挂边对象上帧间保留，做迟滞防抖）；同一对
        // 节点的重复边按 dup 序号放大偏移并交替朝向，互相分开不重合。
        function edgeCtrl(e) {
          var a = graph.nodes[e.a], b = graph.nodes[e.b];
          var dx = b.x - a.x, dy = b.y - a.y;
          var len = Math.sqrt(dx * dx + dy * dy) || 1;
          var ux = -dy / len, uy = dx / len; // 单位法向
          var mag = Math.min(28, Math.max(12, len * 0.1));
          var k = e.dup || 0;
          var m = mag * (1 + 0.6 * k);
          var side = (e.side || 1) * (k % 2 ? -1 : 1);
          return { cx: (a.x + b.x) / 2 + ux * m * side, cy: (a.y + b.y) / 2 + uy * m * side };
        }
        function bezPoint(a, c, b, t) {
          var it = 1 - t;
          return { x: it * it * a.x + 2 * it * t * c.cx + t * t * b.x, y: it * it * a.y + 2 * it * t * c.cy + t * t * b.y };
        }
        function bezAngle(a, c, b, t) {
          var dx = 2 * (1 - t) * (c.cx - a.x) + 2 * t * (b.x - c.cx);
          var dy = 2 * (1 - t) * (c.cy - a.y) + 2 * t * (b.y - c.cy);
          return Math.atan2(dy, dx);
        }
        // 方向箭头：沿曲线切线画小三角。单向关系才画，双向（缺省/旧数据）不画，
        // 免得分不清「哪头是哪头」——双向恰恰没有哪头。
        function arrowHead(p, ang, size, color, alpha) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(ang);
          ctx.globalAlpha = alpha;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(size, 0);
          ctx.lineTo(-size, size * 0.62);
          ctx.lineTo(-size, -size * 0.62);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        // 曲线（A、C、B 三点二次贝塞尔）采样 9 点到各无关节点（跳过两端）
        // 的最小距离：值越大说明这一侧越空旷。
        function clearance(e, cx, cy) {
          var a = graph.nodes[e.a], b = graph.nodes[e.b];
          var best = 999;
          for (var t = 1; t <= 9; t++) {
            var tt = t / 10, it = 1 - tt;
            var px = it * it * a.x + 2 * it * tt * cx + tt * tt * b.x;
            var py = it * it * a.y + 2 * it * tt * cy + tt * tt * b.y;
            for (var ni = 0; ni < graph.nodes.length; ni++) {
              if (ni === e.a || ni === e.b) continue;
              var nd = graph.nodes[ni];
              var ddx = px - nd.x, ddy = py - nd.y;
              var d = Math.sqrt(ddx * ddx + ddy * ddy);
              if (d < best) best = d;
            }
          }
          return best;
        }
        // 朝向迟滞更新：算当前侧与取反侧的 clearance，只有另一侧明显更空
        // （+12 世界像素）才翻转——力导向抖动时曲线不左右闪。
        function updateSide(e) {
          var side = e.side || 1;
          var c1 = edgeCtrl(e);
          var cur = clearance(e, c1.cx, c1.cy);
          e.side = -side;
          var c2 = edgeCtrl(e);
          var alt = clearance(e, c2.cx, c2.cy);
          if (alt <= cur + 12) e.side = side; // 另一侧不明显更空：保持原朝向
        }
        function hitNode(sx, sy) {
          var p = toWorld(sx, sy);
          for (var i = graph.nodes.length - 1; i >= 0; i--) {
            var nd = graph.nodes[i];
            var dx = p.x - nd.x, dy = p.y - nd.y;
            if (dx * dx + dy * dy <= 18 * 18) return nd;
          }
          return null;
        }
        function hitEdge(sx, sy) {
          var p = toWorld(sx, sy);
          // 命中阈值按屏幕像素折算到世界坐标：缩到 0.4 时仍留 12 屏幕像素的手感
          var best = null, bestD = 12 / sim.zoom;
          graph.edges.forEach(function (e) {
            // 命中跟曲线走：二次贝塞尔采样 9 段（10 点含两端），点到各线段
            // 距离取最小；edgeCtrl 与 draw 同源（side 存边对象上，天然一致）。
            var a = graph.nodes[e.a], b = graph.nodes[e.b];
            var c = edgeCtrl(e);
            var qx = a.x, qy = a.y; // 上一采样点，首点 = 端点 A
            for (var k = 1; k <= 9; k++) {
              var tt = k / 9, it = 1 - tt;
              var nx = it * it * a.x + 2 * it * tt * c.cx + tt * tt * b.x;
              var ny = it * it * a.y + 2 * it * tt * c.cy + tt * tt * b.y;
              var segx = nx - qx, segy = ny - qy;
              var len2 = segx * segx + segy * segy || 1;
              var u = Math.min(1, Math.max(0, ((p.x - qx) * segx + (p.y - qy) * segy) / len2));
              var dx = p.x - (qx + segx * u), dy = p.y - (qy + segy * u);
              var d = Math.sqrt(dx * dx + dy * dy);
              if (d < bestD) { bestD = d; best = e; }
              qx = nx; qy = ny;
            }
          });
          return best;
        }
        function step() {
          var nodes = graph.nodes, edges = graph.edges, n = nodes.length;
          var energy = 0; // 节点速度平方和：本帧系统总动能
          var movedPx = 0; // 硬碰撞分离的本帧位移量：纯位置修正能量看不见，按位移计静
          for (var i = 0; i < n; i++) {
            for (var j = i + 1; j < n; j++) {
              var a = nodes[i], b = nodes[j];
              var dx = a.x - b.x, dy = a.y - b.y;
              var d2 = dx * dx + dy * dy;
              if (d2 < 1) { dx = (i % 2 ? 1 : -1) * 0.5; dy = (j % 2 ? 1 : -1) * 0.5; d2 = 1; }
              var f = Math.min(2400 / d2, 4); // 斥力，封顶防炸
              var d = Math.sqrt(d2);
              var fx = (dx / d) * f, fy = (dy / d) * f;
              a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
            }
          }
          edges.forEach(function (e) {
            var a = nodes[e.a], b = nodes[e.b];
            var dx = b.x - a.x, dy = b.y - a.y;
            var d = Math.sqrt(dx * dx + dy * dy) || 1;
            var f = (d - 130) * 0.02; // 弹簧，rest 130（多留缝隙配合硬碰撞分离）
            var fx = (dx / d) * f, fy = (dy / d) * f;
            a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
          });
          nodes.forEach(function (nd) {
            nd.vx -= nd.x * 0.01; nd.vy -= nd.y * 0.01; // 中心引力
            if (nd === (sim.grab && sim.grab.node)) { nd.vx = nd.vy = 0; return; }
            if (nd.fixed) { nd.vx = nd.vy = 0; return; }
            nd.vx *= 0.85; nd.vy *= 0.85;
            nd.x += Math.max(-8, Math.min(8, nd.vx));
            nd.y += Math.max(-8, Math.min(8, nd.vy));
            energy += nd.vx * nd.vx + nd.vy * nd.vy; // 固定/拖拽节点速度已清零不计
          });
          // 硬碰撞分离：力式斥力有上限（f 封顶 4），拥挤时节点仍会压叠；这里在
          // 速度积分之后按最小间距 62（两节点半径 18×2 + 名字 label 纵向净空）
          // 做位置级互推，保证静止帧节点（含下方 label）不重叠。固定节点
          // （fixed 或正在拖拽）不动、推对方，双固定跳过；位移不写回速度——
          // 纯位置修正，靠阻尼自然收敛，不与力导向抢劲。两轮 pass 处理推挤
          // 连锁（A 推开 B 后 B 又压到 C）。
          var MIN_DIST = 62;
          for (var pass = 0; pass < 2; pass++) {
            for (var ci = 0; ci < n; ci++) {
              for (var cj = ci + 1; cj < n; cj++) {
                var na = nodes[ci], nb = nodes[cj];
                var cdx = nb.x - na.x, cdy = nb.y - na.y;
                var cd2 = cdx * cdx + cdy * cdy;
                if (cd2 >= MIN_DIST * MIN_DIST) continue;
                var cd = Math.sqrt(cd2);
                if (cd < 0.01) { cdx = 1; cdy = 0; cd = 1; } // 完全重合：任意方向分开
                var push = (MIN_DIST - cd) / cd; // 归一化差向量：差多少补多少
                var aFixed = na.fixed || na === (sim.grab && sim.grab.node);
                var bFixed = nb.fixed || nb === (sim.grab && sim.grab.node);
                if (aFixed && bFixed) continue;
                var mA = aFixed ? 0 : (bFixed ? 1 : 0.5); // 固定方不动，另一方全担
                var mB = bFixed ? 0 : (aFixed ? 1 : 0.5);
                movedPx += (MIN_DIST - cd) * (mA + mB); // 有实际位移才计（双固定跳过不计）
                na.x -= cdx * push * mA; na.y -= cdy * push * mA;
                nb.x += cdx * push * mB; nb.y += cdy * push * mB;
              }
            }
          }
          return { energy: energy, movedPx: movedPx };
        }
        function draw() {
          if (sim.frame % 30 === 0 || !sim.tokens) sim.tokens = readTokens();
          var tk = sim.tokens;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, sim.w, sim.h);
          ctx.save();
          ctx.translate(sim.w / 2 + sim.panX, sim.h / 2 + sim.panY);
          ctx.scale(sim.zoom, sim.zoom);
          var focusNow = focusRef.current;
          var selNow = selRef.current;
          // 聚焦邻接表：只高亮该角色与其一度关系，其余压暗（每帧 O(E)，边数十条）
          var near = null;
          if (focusNow && graph.nodes.some(function (n) { return n.id === focusNow; })) {
            near = Object.create(null);
            near[focusNow] = 1;
            graph.edges.forEach(function (e) {
              if (e.na === focusNow) near[e.nb] = 1;
              else if (e.nb === focusNow) near[e.na] = 1;
            });
          }
          // 选中的边最后画（压在其余边之上）
          var ordered = graph.edges.slice().sort(function (x, y) {
            return (x.rowIdx === selNow ? 1 : 0) - (y.rowIdx === selNow ? 1 : 0);
          });
          ordered.forEach(function (e) {
            var a = graph.nodes[e.a], b = graph.nodes[e.b];
            if (!a || !b) return;
            updateSide(e); // 朝向迟滞：另一侧明显更空才翻，防抖（详见 updateSide）
            var c = edgeCtrl(e);
            var hot = e.rowIdx === selNow;
            var dim = near !== null && e.na !== focusNow && e.nb !== focusNow;
            ctx.save();
            ctx.setLineDash(e.dash && e.dash.length ? e.dash : []);
            ctx.strokeStyle = hot ? tk.accent : e.color;
            ctx.lineWidth = hot ? e.w + 1.5 : e.w;
            ctx.globalAlpha = dim ? 0.07 : (hot ? 1 : e.alpha);
            if (hot) {
              // 选中：先描一层宽光晕再描本体，深浅色下都看得见
              ctx.save();
              ctx.globalAlpha = dim ? 0.07 : 0.26;
              ctx.lineWidth = e.w + 7;
              ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.cx, c.cy, b.x, b.y); ctx.stroke();
              ctx.restore();
              ctx.strokeStyle = tk.accent;
              ctx.lineWidth = e.w + 1.5;
            }
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.cx, c.cy, b.x, b.y); ctx.stroke();
            ctx.setLineDash([]);
            var ea = dim ? 0.07 : (hot ? 1 : Math.min(1, e.alpha + 0.15));
            if (e.dir === "a-to-b") arrowHead(bezPoint(a, c, b, 0.82), bezAngle(a, c, b, 0.82), 5, hot ? tk.accent : e.color, ea);
            else if (e.dir === "b-to-a") arrowHead(bezPoint(a, c, b, 0.18), bezAngle(a, c, b, 0.18) + Math.PI, 5, hot ? tk.accent : e.color, ea);
            if (e.type && sim.zoom >= 0.7) {
              ctx.font = "10px sans-serif";
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              // type 标在曲线 t=0.5 点（二次贝塞尔中点），与曲线本体一致；
              // 加一层卡面色底，压在别的边上也读得清
              var mx = 0.25 * a.x + 0.5 * c.cx + 0.25 * b.x;
              var my = 0.25 * a.y + 0.5 * c.cy + 0.25 * b.y;
              var tw = ctx.measureText(e.type).width;
              var bw = tw + 9, bh = 15;
              ctx.globalAlpha = dim ? 0.1 : (hot ? 1 : 0.95);
              ctx.fillStyle = tk.card;
              roundRectPath(ctx, mx - bw / 2, my - bh / 2, bw, bh, 7);
              ctx.fill();
              ctx.fillStyle = hot ? tk.accent : e.color;
              ctx.fillText(e.type, mx, my + 0.5);
            }
            ctx.restore();
          });
          ctx.setLineDash([]);
          graph.nodes.forEach(function (nd) {
            var r = 18; // 世界坐标画：半径随 zoom 缩放
            var isFocus = near !== null && focusNow === nd.id;
            var dim = near !== null && !near[nd.id];
            ctx.save();
            ctx.globalAlpha = dim ? 0.2 : 1;
            if (isFocus) { // 聚焦光环
              ctx.beginPath();
              ctx.arc(nd.x, nd.y, r + 6, 0, Math.PI * 2);
              ctx.fillStyle = tk.accent;
              ctx.globalAlpha = dim ? 0.2 : 0.18;
              ctx.fill();
              ctx.globalAlpha = 1;
            }
            ctx.beginPath();
            ctx.arc(nd.x, nd.y, r, 0, Math.PI * 2);
            ctx.fillStyle = NODE_ROLE_COLORS[nd.role] || NODE_ROLE_COLORS.minor;
            ctx.fill();
            ctx.lineWidth = isFocus ? 4 : (nd.fixed ? 3 : 1.5); // 固定/聚焦=加粗 accent 描边
            ctx.strokeStyle = tk.accent;
            ctx.stroke();
            var lines = splitLabel(nd.id);
            ctx.fillStyle = tk.label;
            ctx.font = "11px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            for (var li = 0; li < lines.length; li++) ctx.fillText(lines[li], nd.x, nd.y + r + 4 + li * 12);
            ctx.restore();
            // 位置缓存写回：换筛选/换章后新图沿用旧位置，用户拖好的布局不丢
            var pc = posRef.current[nd.id] || (posRef.current[nd.id] = { x: 0, y: 0, fixed: false });
            pc.x = nd.x; pc.y = nd.y; pc.fixed = nd.fixed;
          });
          ctx.restore();
        }
        function loop() {
          var m = step();
          draw();
          sim.frame++;
          // 收敛停机：能量与碰撞位移都低于静阈连续 STILL_FRAMES 帧即真停 rAF
          // （raf 归零），不再每帧 O(n²) + 全量重绘空转；交互经 wake() 重启。
          // STILL_CAP 兜底：拖拽压邻等病态抖动循环到不了静止判据，也必须停。
          if (m.energy < ENERGY_TAU && m.movedPx < MOVE_EPS) {
            if (++sim.still >= STILL_FRAMES) { sim.raf = 0; return; }
          } else {
            sim.still = 0;
          }
          if (++sim.frames >= STILL_CAP) { sim.raf = 0; return; }
          sim.raf = requestAnimationFrame(loop);
        }
        // 唤醒：静止停机后任何会改变画面/物理的交互都要重启循环（幂等，已跑不
        // 叠加），并重新给满静止计数与帧数预算。
        function wake() {
          if (sim.raf) return;
          sim.still = 0;
          sim.frames = 0;
          sim.raf = requestAnimationFrame(loop);
        }
        wakeRef.current = wake;
        resize();
        sim.raf = requestAnimationFrame(loop);
        var ro = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
        if (ro) ro.observe(wrap);
        function localXY(e) {
          var rect = canvas.getBoundingClientRect();
          return { x: (e.clientX || 0) - rect.left, y: (e.clientY || 0) - rect.top };
        }
        // hover 提示 rAF 节流：mousemove 高频触发，合帧后再命中检测 + setTip，
        // 避免逐事件整 tab 重渲染（建图已 useMemo，这里再省掉无效重绘）。
        function hoverAt(p) {
          if (tipRafRef.current) cancelAnimationFrame(tipRafRef.current);
          tipRafRef.current = requestAnimationFrame(function () {
            tipRafRef.current = 0;
            var e2 = hitEdge(p.x, p.y);
            if (e2) {
              setTip({ x: p.x, y: p.y, text: (e2.type ? e2.type + "：" : "") + (e2.desc || tt("relations.noDesc")) });
            } else {
              setTip(function (prev) { return prev ? null : prev; });
            }
          });
        }
        // 抓取：节点上按下＝拖节点（固定），空白处按下＝平移画布。两者都不动时
        // 松手才算「点」（聚焦节点 / 选中边），避免拖完误触发。
        function beginGrab(p) {
          var nd = hitNode(p.x, p.y);
          if (nd) {
            // 这里不置 fixed：单纯点一下是「聚焦」，动了才算拖拽固定。
            // 纯拖动路径也不依赖 fixed（moveGrab 直接改坐标），动了再补。
            sim.grab = { node: nd, start: p, moved: false };
            canvas.dataset.dragging = "true";
          } else {
            sim.grab = { node: null, start: p, moved: false, panX: sim.panX, panY: sim.panY };
          }
          wake();
        }
        function moveGrab(p) {
          var g = sim.grab;
          if (!g) return;
          var dx = p.x - g.start.x, dy = p.y - g.start.y;
          if (!g.moved && Math.abs(dx) + Math.abs(dy) > 5) g.moved = true;
          if (!g.moved) return;
          if (g.node) {
            g.node.fixed = true; // 真拖了才钉住（点按聚焦不留固定态）
            var w = toWorld(p.x, p.y);
            g.node.x = w.x;
            g.node.y = w.y;
          } else {
            sim.panX = g.panX + dx;
            sim.panY = g.panY + dy;
          }
          wake();
        }
        function endGrab(p, tap) {
          var g = sim.grab;
          sim.grab = null;
          canvas.dataset.dragging = "false";
          if (!g || g.moved || !tap || !p) return;
          if (g.node) { // 点节点：聚焦/取消聚焦
            setFocusName(function (prev) { return prev === g.node.id ? null : g.node.id; });
            return;
          }
          var e2 = hitEdge(p.x, p.y);
          setSelIdx(e2 ? e2.rowIdx : null); // 点边选中；点空白清空选中
        }
        // 触摸后短时间内忽略兼容鼠标事件：touchstart 的 preventDefault 在有的
        // 安卓壳里不生效，浏览器会补发 mousedown/mouseup——同一次点击被处理两遍，
        // 聚焦/选中刚亮就又被自己撤销（「闪一下恢复原状」）。800ms 窗口足够长。
        function mouseFromTouch() { return Date.now() - sim.touchAt < 800; }
        function onDown(e) {
          if (e.button !== undefined && e.button !== 0) return;
          if (mouseFromTouch()) return;
          var p = localXY(e);
          beginGrab(p);
          if (sim.grab) e.preventDefault();
        }
        function onMove(e) {
          if (mouseFromTouch()) return;
          var p = localXY(e);
          if (sim.grab) { moveGrab(p); return; }
          hoverAt(p);
        }
        function onUp(e) {
          if (mouseFromTouch()) return;
          if (!sim.grab) return;
          endGrab(localXY(e), true);
        }
        function onWheel(e) {
          e.preventDefault();
          var p = localXY(e);
          zoomAt(p.x, p.y, sim.zoom * Math.exp(-e.deltaY * 0.0012));
        }
        function onDbl() { if (mouseFromTouch()) return; if (zoomApiRef.current) zoomApiRef.current.reset(); }
        function touchDist(t) {
          var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
          return Math.sqrt(dx * dx + dy * dy) || 1;
        }
        function onTouchStart(e) {
          sim.touchAt = Date.now(); // 标记：随后的兼容鼠标事件一律忽略（见 mouseFromTouch）
          if (e.touches.length >= 2) { // 双指：缩放（记起点距离与当时的 zoom）
            sim.pinch = { d: touchDist(e.touches), zoom: sim.zoom };
            sim.grab = null;
            canvas.dataset.dragging = "false";
            e.preventDefault();
            return;
          }
          var p = localXY(e.touches[0]);
          sim.tapPos = p;
          sim.pinch = null;
          beginGrab(p);
          e.preventDefault();
        }
        function onTouchMove(e) {
          if (sim.pinch && e.touches.length >= 2) {
            var d = touchDist(e.touches);
            zoomAt(sim.w / 2, sim.h / 2, sim.pinch.zoom * (d / sim.pinch.d));
            e.preventDefault();
            return;
          }
          if (sim.grab && e.touches.length) {
            moveGrab(localXY(e.touches[0]));
            e.preventDefault();
          }
        }
        // 触摸被系统打断（来电、手势、滚动争抢）：只清状态，不当成点击
        function onTouchCancel() {
          sim.pinch = null;
          sim.grab = null;
          sim.tapPos = null;
          canvas.dataset.dragging = "false";
        }
        function onTouchEnd(e) {
          if (sim.pinch && e.touches.length < 2) {
            sim.pinch = null;
            if (e.touches.length === 1) { // 松掉一指：以剩下那指续拖/续平移
              var p1 = localXY(e.touches[0]);
              sim.tapPos = p1;
              beginGrab(p1);
            }
            return;
          }
          if (e.touches.length === 0) endGrab(sim.tapPos, true);
        }
        canvas.addEventListener("mousedown", onDown);
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        canvas.addEventListener("wheel", onWheel, { passive: false });
        canvas.addEventListener("dblclick", onDbl);
        canvas.addEventListener("touchstart", onTouchStart, { passive: false });
        canvas.addEventListener("touchmove", onTouchMove, { passive: false });
        canvas.addEventListener("touchend", onTouchEnd);
        canvas.addEventListener("touchcancel", onTouchCancel);
        return function () {
          zoomApiRef.current = null; // 桥随旧 sim 一起作废：换图间隙按钮点击不落到旧闭包
          wakeRef.current = null;
          cancelAnimationFrame(sim.raf);
          if (tipRafRef.current) { cancelAnimationFrame(tipRafRef.current); tipRafRef.current = 0; }
          if (ro) ro.disconnect();
          canvas.removeEventListener("mousedown", onDown);
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          canvas.removeEventListener("wheel", onWheel);
          canvas.removeEventListener("dblclick", onDbl);
          canvas.removeEventListener("touchstart", onTouchStart);
          canvas.removeEventListener("touchmove", onTouchMove);
          canvas.removeEventListener("touchend", onTouchEnd);
          canvas.removeEventListener("touchcancel", onTouchCancel);
        };
      }, [graph]);
      // 全屏能力检测：Fullscreen API 可用才渲染全屏按钮（不支持的宿主不渲染，按钮不占位）
      useEffect(function () {
        var el = wrapRef.current;
        if (!el) return undefined;
        var ok = !!(el.requestFullscreen || el.webkitRequestFullscreen) &&
          document.fullscreenEnabled !== false && document.webkitFullscreenEnabled !== false;
        if (ok) setCanFs(true);
        return undefined;
      }, []);
      // 全屏状态跟随：浏览器 ESC 退出等非按钮路径也要同步按钮文案
      useEffect(function () {
        function sync() { setFs(!!(document.fullscreenElement || document.webkitFullscreenElement)); }
        document.addEventListener("fullscreenchange", sync);
        document.addEventListener("webkitfullscreenchange", sync);
        return function () {
          document.removeEventListener("fullscreenchange", sync);
          document.removeEventListener("webkitfullscreenchange", sync);
        };
      }, []);
      // 进/出全屏：webkit 前缀兜底；promise 拒绝吞掉（用户 ESC / 策略性拒绝不打断使用）
      function toggleFs() {
        var el = wrapRef.current;
        try {
          if (document.fullscreenElement || document.webkitFullscreenElement) {
            var exit = document.exitFullscreen || document.webkitExitFullscreen;
            if (exit) {
              var p = exit.call(document);
              if (p && typeof p.catch === "function") p.catch(function () {});
            }
          } else if (el) {
            var req = el.requestFullscreen || el.webkitRequestFullscreen;
            if (req) {
              var p2 = req.call(el);
              if (p2 && typeof p2.catch === "function") p2.catch(function () {});
            }
          }
        } catch (e) { /* 全屏 API 个别浏览器仍有策略性拒绝，静默 */ }
      }
      function openChar(name) {
        if (!name) return;
        if (onOpenChar) { onOpenChar(name); return; }
        setFocusName(name);
      }
      // 导出 PNG：把当前画布按 2 倍分辨率重绘到离屏画布（先铺卡面色，透明底
      // PNG 贴到聊天/文档里会变成一片黑），再走 a[download]。
      function exportPng() {
        var c = canvasRef.current;
        if (!c || !c.width) { toast.err(tf("relations.pngFail", { msg: "canvas unavailable" })); return; }
        try {
          var out = document.createElement("canvas");
          var scale = 2;
          out.width = Math.round(c.width * scale);
          out.height = Math.round(c.height * scale);
          var octx = out.getContext("2d");
          if (!octx) throw new Error("2d context unavailable");
          var cs = getComputedStyle(document.body);
          octx.fillStyle = String(cs.getPropertyValue("--dsw-alias-bg-layer-3") || "").trim() || "#ffffff";
          octx.fillRect(0, 0, out.width, out.height);
          octx.imageSmoothingEnabled = true;
          octx.drawImage(c, 0, 0, out.width, out.height);
          var a = document.createElement("a");
          a.href = out.toDataURL("image/png");
          a.download = "relations-" + (effChap || "all") + ".png";
          a.rel = "noopener";
          document.body.appendChild(a);
          a.click();
          a.remove();
          toast.ok(tt("relations.pngSaved"));
        } catch (err) {
          toast.err(tf("relations.pngFail", { msg: String((err && err.message) || err) }));
        }
      }
      // 清单 markdown：当前筛选 + 当前章解析后的口径，给写手/审校直接贴进对话
      function listText() {
        var lines = ["# " + tt("relations.listTitle") + " · " + (effChap || tt("relations.allChapters")), ""];
        sorted.forEach(function (row) {
          var at = row.at, rel = row.rel;
          var span = [rel.started, rel.ended].filter(function (x) { return String(x === null || x === undefined ? "" : x).trim() !== ""; }).join(" → ");
          var seg = "- " + rel.a + " " + relDirGlyph(rel.direction) + " " + rel.b + "｜" + (at.type || "—");
          if (typeof at.intensity === "number") seg += "｜强度" + at.intensity;
          if (span) seg += "｜" + span;
          if (at.description) seg += "：" + at.description;
          lines.push(seg);
        });
        return lines.join("\n") + "\n";
      }
      function copyList() {
        var text = listText();
        function fallback() { setCopyText(text); }
        try {
          if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            navigator.clipboard.writeText(text).then(function () { toast.ok(tt("relations.copied")); }, fallback);
            return;
          }
        } catch (err) { /* 无剪贴板权限走弹层兜底 */ }
        fallback();
      }
      if (!graph.nodes.length) {
        return h("div", { className: "myt-stack" },
          h("div", { className: "myt-cardHead" },
            h("h3", { className: "myt-cardTitle" }, tt("relations.title")),
            srcEditBtn("relations.yml", function () { setSrcRel("relations.yml"); })),
          h(Empty, { text: tt("relations.noData") }),
          srcRel ? h(SourceEditorModal, { title: tt("src.editSource"), rel: srcRel, wsPath: wsPath, onClose: function () { setSrcRel(null); }, onSaved: reload }) : null);
      }
      var filters = h("div", { className: "myt-relFilters" },
        h("input", {
          className: "myt-setInput myt-relSearch", type: "search", value: q,
          placeholder: tt("relations.searchPh"), "aria-label": tt("relations.searchPh"),
          onChange: function (e) { setQ(e.target.value); },
        }),
        h("select", {
          className: "myt-setInput myt-setSelect myt-relChapSel", value: effChap,
          "aria-label": tt("relations.filterChapter"),
          onChange: function (e) { setChapSel(e.target.value); },
        },
          h("option", { value: "" }, tt("relations.allChapters")),
          chapters.map(function (c) { return h("option", { key: c.file, value: c.file }, truncate(chFullTitle(c), 20)); })),
        model.types.length ? h("div", { className: "myt-relChips" },
          model.types.map(function (t) {
            var st = relTypeStyle(t.type);
            var on = typeSel.indexOf(t.type) !== -1;
            return h("button", {
              key: t.type || "_blank", type: "button", className: "myt-chip",
              "data-on": on ? "1" : "0", style: { "--myt-chip-c": st.c },
              "aria-pressed": on ? "true" : "false",
              onClick: function () {
                setTypeSel(function (prev) {
                  var i = prev.indexOf(t.type);
                  if (i === -1) return prev.concat([t.type]);
                  var next = prev.slice();
                  next.splice(i, 1);
                  return next;
                });
              },
            }, h("span", { className: "myt-chipDot", style: { background: st.c } }), t.type || tt("relations.noType"), h("span", { className: "myt-chipCount" }, t.n));
          }),
          typeSel.length ? h("button", { key: "_clear", type: "button", className: "myt-chip myt-chipPlain", onClick: function () { setTypeSel([]); } }, tt("relations.chipClear")) : null) : null,
        h("button", {
          type: "button", className: "myt-chip myt-chipPlain", title: tt("relations.strongOnlyTip"),
          "data-on": strongOnly ? "1" : "0", "aria-pressed": strongOnly ? "true" : "false",
          onClick: function () { setStrongOnly(function (v) { return !v; }); },
        }, tt("relations.strongOnly")),
        focusName ? h("div", { className: "myt-relFocusBar" },
          h("span", { className: "myt-relFocusTag" }, tf("relations.focusOn", { name: focusName })),
          h("button", { type: "button", className: "myt-btn myt-btnSm", onClick: function () { setFocusName(null); } }, tt("relations.focusClear"))) : null);
      var legend = h("span", { className: "myt-graphLegend" },
        h("span", { className: "myt-legendGroup" },
          h("span", { className: "myt-legendItem" }, h("span", { className: "myt-legendDot", "data-role": "protagonist" }), tt("role.protagonist")),
          h("span", { className: "myt-legendItem" }, h("span", { className: "myt-legendDot", "data-role": "supporting" }), tt("role.supporting")),
          h("span", { className: "myt-legendItem" }, h("span", { className: "myt-legendDot", "data-role": "antagonist" }), tt("role.antagonist")),
          h("span", { className: "myt-legendItem" }, h("span", { className: "myt-legendDot", "data-role": "minor" }), tt("role.minor"))),
        h("span", { className: "myt-legendGroup" },
          model.types.map(function (t) {
            var st = relTypeStyle(t.type);
            return h("span", { key: "lg-" + t.type, className: "myt-legendItem" },
              h("span", { className: "myt-legendLine", style: { borderTopColor: st.c, borderTopStyle: st.dash && st.dash.length ? "dashed" : "solid" } }),
              t.type || tt("relations.noType"));
          })),
        // 线宽＝强度：不给图例的话 1-4px 的差别只能靠猜
        h("span", { className: "myt-legendGroup" },
          h("span", { className: "myt-legendItem" },
            h("span", { className: "myt-legendLine", style: { borderTopColor: "var(--dsw-alias-label-tertiary)", borderTopWidth: 1 } }),
            tt("relations.legendWeak"),
            h("span", { className: "myt-legendLine", style: { borderTopColor: "var(--dsw-alias-label-tertiary)", borderTopWidth: 4 } }),
            tt("relations.legendStrong"))));
      var relRow = function (row) {
        var at = row.at, rel = row.rel;
        var st = relTypeStyle(at.type);
        var isSel = selIdx === row.idx;
        var startedOrd = chapOrdinal(rel.started);
        var endedOrd = chapOrdinal(rel.ended);
        var endedNow = String(rel.ended === null || rel.ended === undefined ? "" : rel.ended).trim() !== "" &&
          (effOrd === null || (endedOrd !== null && endedOrd <= effOrd));
        var span = [rel.started, rel.ended].filter(function (x) { return String(x === null || x === undefined ? "" : x).trim() !== ""; }).join(" → ");
        return h("div", {
          key: row.idx, className: "myt-relRow", "data-sel": isSel ? "1" : "0", "data-idx": row.idx,
          onClick: function () { setSelIdx(isSel ? null : row.idx); },
        },
          h("div", { className: "myt-relRowHead" },
            h("span", { className: "myt-relType", style: { color: st.c, borderColor: st.c } }, at.type || tt("relations.noType")),
            h("span", { className: "myt-relPair" },
              h("button", { type: "button", className: "myt-relNameBtn", title: tt("relations.openChar"), onClick: function (ev) { ev.stopPropagation(); openChar(rel.a); } }, rel.a),
              h("span", { className: "myt-relArrow" }, relDirGlyph(rel.direction)),
              h("button", { type: "button", className: "myt-relNameBtn", title: tt("relations.openChar"), onClick: function (ev) { ev.stopPropagation(); openChar(rel.b); } }, rel.b)),
            h("span", { className: "myt-relMeta" },
              relIntensityDots(at.intensity, st.c),
              span ? h("span", { className: "myt-relRange" }, span) : null,
              startedOrd === null ? h("span", { className: "myt-relWarn" }, tt("relations.startedMissingOne")) : null,
              endedNow ? h("span", { className: "myt-relEndTag" }, tt("relations.endedTag")) : null,
              (rel.stages || []).length > 1 ? h("span", { className: "myt-relStageTag" }, tf("relations.stages", { n: rel.stages.length })) : null)),
          h("div", { className: "myt-relDesc" }, at.description || tt("relations.noDesc")));
      };
      return h("div", { className: "myt-stack" },
        h("div", { className: "myt-card" },
          h("div", { className: "myt-cardHead" },
            h("h3", { className: "myt-cardTitle" }, tt("relations.title")),
            h("span", { className: "myt-muted" }, tf("relations.counts", { n: graph.nodes.length, m: graph.edges.length })),
            cast && cast.length
              ? h("span", { className: "myt-castTag", title: tt("relations.castTip") }, tf("relations.castOn", { n: cast.length }))
              : null,
            h("div", { className: "myt-relActions" },
              relDupes.length ? h("button", {
                type: "button", className: "myt-btn myt-btnSm", title: tf("relations.dedupeTip", { n: relDupes.length, extra: dupExtra }),
                disabled: dedupeBusy,
                onClick: mergeDuplicates,
              }, dedupeBusy ? tt("relations.dedupeBusy") : tf("relations.dedupeBtn", { n: dupExtra })) : null,
              model.missing ? h("button", { type: "button", className: "myt-btn myt-btnSm", title: tt("rel.autofillTip"), onClick: function () { setAutofillOpen(true); } }, tf("rel.autofillBtn", { n: model.missing })) : null,
              h("button", { type: "button", className: "myt-btn myt-btnSm", title: tt("relations.exportPngTip"), onClick: exportPng }, tt("relations.exportPng")),
              h("button", { type: "button", className: "myt-btn myt-btnSm", title: tt("relations.copyListTip"), onClick: copyList }, tt("relations.copyList")),
              srcEditBtn("relations.yml", function () { setSrcRel("relations.yml"); }))),
          filters,
          h("div", { className: "myt-graphWrap", ref: wrapRef },
            h("canvas", { className: "myt-graphCanvas", ref: canvasRef, "data-dragging": "false" }),
            tip ? h("div", { className: "myt-graphTip", style: { left: Math.min(tip.x + 12, 320) + "px", top: Math.max(tip.y - 34, 4) + "px" } }, tip.text) : null,
            h("div", { className: "myt-graphTools" },
              h("button", { type: "button", className: "myt-graphTool", title: tt("relations.zoomOut"), "aria-label": tt("relations.zoomOut"), onClick: function () { if (zoomApiRef.current) zoomApiRef.current.zoomBy(1 / 1.25); } }, "－"),
              h("button", { type: "button", className: "myt-graphTool", title: tt("relations.zoomIn"), "aria-label": tt("relations.zoomIn"), onClick: function () { if (zoomApiRef.current) zoomApiRef.current.zoomBy(1.25); } }, "＋"),
              h("button", { type: "button", className: "myt-graphTool", title: tt("relations.reset"), "aria-label": tt("relations.reset"), onClick: function () { if (zoomApiRef.current) zoomApiRef.current.reset(); } }, "⟲"),
              canFs ? h("button", { type: "button", className: "myt-graphTool myt-graphToolText", title: isFs ? tt("relations.exitFs") : tt("relations.fs"), "aria-label": isFs ? tt("relations.exitFs") : tt("relations.fs"), onClick: toggleFs }, isFs ? tt("relations.exitFs") : tt("relations.fs")) : null)),
          h("div", { className: "myt-graphFoot" },
            h("span", { className: "myt-muted" }, tt("relations.help")),
            model.missing ? h("span", { className: "myt-relWarn" }, tf("relations.startedMissing", { n: model.missing })) : null,
            legend)),
        h("div", { className: "myt-card" },
          h("div", { className: "myt-cardHead" },
            h("h3", { className: "myt-cardTitle" }, tt("relations.listTitle")),
            h("span", { className: "myt-muted" }, tf("relations.listCount", { n: sorted.length })),
            h("select", {
              className: "myt-setInput myt-setSelect myt-relSort", value: sortBy,
              "aria-label": tt("relations.sortBy"),
              onChange: function (e) { setSortBy(e.target.value); },
            },
              h("option", { value: "intensity" }, tt("relations.sortIntensity")),
              h("option", { value: "chapter" }, tt("relations.sortChapter")),
              h("option", { value: "type" }, tt("relations.sortType")))),
          sorted.length ? h("div", { className: "myt-relList", ref: listRef }, sorted.map(relRow)) : h(Empty, { text: tt("relations.listEmpty") })),
        graph.unlinked.length ? h("div", { className: "myt-card" },
          h("div", { className: "myt-cardHead" }, h("h3", { className: "myt-cardTitle" }, tt("relations.unlinkedTitle"))),
          h("div", { className: "myt-unlinked" }, graph.unlinked.map(function (n, i) {
            return h("span", { key: n || i, className: "myt-unlinkedTag" }, n);
          }))) : null,
        autofillOpen ? h(RelationAutofill, { wsPath: wsPath, onClose: function () { setAutofillOpen(false); }, onDone: reload }) : null,
        srcRel ? h(SourceEditorModal, { title: tt("src.editSource"), rel: srcRel, wsPath: wsPath, onClose: function () { setSrcRel(null); }, onSaved: reload }) : null,
        copyText !== null ? h(MaskPortal, {
          className: "myt-modalMask",
          onMouseDown: function (e) { if (e.target === e.currentTarget) setCopyText(null); },
        },
          h("div", { className: "myt-modalCard", role: "dialog", "aria-modal": "true", "aria-label": tt("relations.copyTitle") },
            h("div", { className: "myt-modalHead" },
              h("h2", { className: "myt-modalTitle" }, tt("relations.copyTitle")),
              h("button", { type: "button", className: "myt-closeBtn", "aria-label": tt("relations.close"), onClick: function () { setCopyText(null); } }, h("span", { className: "myt-closeGlyph", "aria-hidden": "true" }, "×"))),
            h("div", { className: "myt-modalBody" },
              h("div", { className: "myt-muted" }, tt("relations.copyHint")),
              h("textarea", { className: "myt-setInput myt-copyBox", readOnly: true, ref: copyRef, value: copyText, onFocus: function (e) { e.target.select(); } }),
              h("div", { className: "myt-setActions" },
                h("button", { type: "button", className: "myt-btn myt-btnPrimary", onClick: function () {
                  var ta = copyRef.current;
                  if (!ta) return;
                  ta.focus();
                  ta.select();
                  try {
                    var ok = document.execCommand("copy");
                    if (ok) toast.ok(tt("relations.copied"));
                    else toast.warn(tt("relations.copyManual"));
                  } catch (err) { toast.warn(tt("relations.copyManual")); }
                } }, tt("relations.copySelect")),
                h("button", { type: "button", className: "myt-btn", onClick: function () { setCopyText(null); } }, tt("relations.close")))))) : null);
    }

    // ── 书稿版本安全网（0.10.0）──────────────────────────────────────────────
    // agent 直接 write/edit 的改动不进面板历史，git 是唯一的整书回滚网。
    // 卡只在概览出现：没建仓时给一键初始化；已建仓显示未提交数 + 最近提交
    // （每次改过哪些文件一并列出，可按文件回滚到那一次）。
    function VersionCard(props) {
      var wsPath = props.wsPath;
      var reload = props.reload;
      var _st = useState(null), state = _st[0], setState = _st[1];
      var _b = useState(""), busy = _b[0], setBusy = _b[1];
      var _o = useState(false), open = _o[0], setOpen = _o[1];
      function load() {
        apiGet("git-status", { path: wsPath }, { silent: true }).then(function (d) {
          if (!d || !d.ok) return;
          var base = { available: d.available !== false, repo: !!d.repo, changed: d.changed || 0, files: d.files || [], commits: [] };
          if (!base.repo) { setState(base); return; }
          apiGet("git-log", { path: wsPath, limit: 8 }, { silent: true }).then(function (g) {
            base.commits = (g && g.commits) || [];
            setState(base);
          }).catch(function () { setState(base); });
        }).catch(function () { /* 拉不到就整卡不显示 */ });
      }
      useEffect(load, [wsPath]);
      function doInit() {
        if (busy) return;
        setBusy("init");
        apiPost("git-init", { path: wsPath }).then(function (d) {
          toast.ok(d && d.created ? tt("version.initDone") : tt("version.initExists"));
          load();
        }).catch(function () {}).finally(function () { setBusy(""); });
      }
      function doCommit() {
        if (busy) return;
        setBusy("commit");
        apiPost("git-commit", { path: wsPath }).then(function (d) {
          if (d && d.commit) toast.ok(tf("version.commitDone", { n: fmtNum(d.changed || 0) }));
          else toast.warn(tt("version.nothing"));
          load();
        }).catch(function () {}).finally(function () { setBusy(""); });
      }
      function restore(rel, rev) {
        if (typeof window.confirm === "function" && !window.confirm(tf("version.restoreConfirm", { rel: rel, rev: rev }))) return;
        apiPost("git-restore", { path: wsPath, rel: rel, rev: rev }).then(function (d) {
          if (!d || !d.ok) throw new Error((d && d.error) || "restore failed");
          toast.ok(tf("version.restored", { rel: rel }));
          load();
          if (reload) reload();
        }).catch(function (err) { toast.err(tf("toast.prefix", { msg: err.message })); });
      }
      if (!state) return null;
      if (state.available === false) {
        return h("div", { className: "myt-card" },
          h("div", { className: "myt-cardHead" }, h("h3", { className: "myt-cardTitle" }, tt("version.title"))),
          h("div", { className: "myt-muted" }, tt("version.noGit")));
      }
      var head = h("div", { className: "myt-cardHead" },
        h("h3", { className: "myt-cardTitle" }, tt("version.title")),
        h("span", { className: "myt-muted" }, state.repo
          ? (state.changed > 0 ? tf("version.changed", { n: fmtNum(state.changed) }) : tt("version.clean"))
          : tt("version.repoOff")));
      if (!state.repo) {
        return h("div", { className: "myt-card" }, head,
          h("div", { className: "myt-muted" }, tt("version.hint")),
          h("div", { className: "myt-setActions" },
            h("button", { type: "button", className: "myt-btn myt-btnPrimary", disabled: busy !== "", onClick: doInit },
              busy === "init" ? tt("version.working") : tt("version.init"))));
      }
      return h("div", { className: "myt-card" }, head,
        h("div", { className: "myt-setActions" },
          h("button", { type: "button", className: "myt-btn myt-btnPrimary", disabled: busy !== "", onClick: doCommit },
            busy === "commit" ? tt("version.working") : tt("version.commit")),
          h("button", { type: "button", className: "myt-btn", onClick: function () { setOpen(function (v) { return !v; }); } },
            open ? tt("version.hideLog") : tt("version.showLog"))),
        open ? (state.commits.length
          ? h("div", { className: "myt-verList" }, state.commits.map(function (c) {
            return h("div", { key: c.hash, className: "myt-verRow" },
              h("div", { className: "myt-verHead" },
                h("span", { className: "myt-verHash" }, c.hash),
                h("span", { className: "myt-verSubject" }, truncate(c.subject, 40)),
                h("span", { className: "myt-muted" }, c.date)),
              h("div", { className: "myt-verFiles" }, (c.files || []).slice(0, 8).map(function (f) {
                return h("button", { key: f, type: "button", className: "myt-verFile", title: tf("version.restoreTip", { rel: f, rev: c.hash }), onClick: function () { restore(f, c.hash); } }, f);
              })));
          }))
          : h("div", { className: "myt-muted" }, tt("version.empty")) ) : null);
    }

    // ── 章节交接卡弹层（0.10.0）──────────────────────────────────────────────
    function HandoffModal(props) {
      var _d = useState(null), data = _d[0], setData = _d[1];
      var _e = useState(""), err = _e[0], setErr = _e[1];
      useEffect(function () {
        var alive = true;
        apiGet("handoff", { path: props.wsPath, file: props.file }, { silent: true }).then(function (d) {
          if (!alive) return;
          if (d && d.ok) setData(d); else setErr((d && d.error) || tt("handoff.fail"));
        }).catch(function (e) { if (alive) setErr(e.message); });
        return function () { alive = false; };
      }, [props.file, props.wsPath]);
      var text = data ? (data.markdown || "") : "";
      function copyIt() {
        copyText(text).then(function () { toast.ok(tt("handoff.copied")); }, function () { toast.err(tt("handoff.copyFail")); });
      }
      return h(MaskPortal, { className: "myt-modalMask", onMouseDown: function (e) { if (e.target === e.currentTarget) props.onClose(); } },
        h("div", { className: "myt-modalCard", role: "dialog", "aria-modal": "true", "aria-label": tt("handoff.title") },
          h("div", { className: "myt-modalHead" },
            h("h2", { className: "myt-modalTitle" }, tt("handoff.title")),
            h("button", { type: "button", className: "myt-closeBtn", "aria-label": tt("relations.close"), onClick: props.onClose }, h("span", { className: "myt-closeGlyph" }, "×"))),
          h("div", { className: "myt-modalBody" },
            h("div", { className: "myt-muted" }, tt("handoff.hint")),
            err ? h("div", { className: "myt-muted" }, err)
              : !data ? h("div", { className: "myt-muted" }, tt("common.loading"))
                : h("pre", { className: "myt-handoffText" }, text),
            data ? h("div", { className: "myt-setActions" },
              h("button", { type: "button", className: "myt-btn myt-btnPrimary", onClick: copyIt }, tt("handoff.copy")),
              h("button", { type: "button", className: "myt-btn", onClick: props.onClose }, tt("relations.close"))) : null)));
    }

    // ── 工具弹层（0.15.0）：回收站 / 整本导出 / 账本瘦身，手机端唯一入口 ────
    //
    // 这三件事以前只有 CLI 能跑（xiaoyu-novel slim / xiaoyu-novel export）或根本进不了
    // 面板（回收站）。手机优先的工作流里没有终端，所以统一收进一个弹层：
    // 页签切换、各自独立加载、失败只在自己那一格里报，不互相拖累。
    function ToolsModal(props) {
      var _t = useState(props.initialTab || "trash"), tab = _t[0], setTab = _t[1];
      var TABS_ = [["trash", "tools.tabTrash"], ["export", "tools.tabExport"], ["slim", "tools.tabSlim"]];
      return h(MaskPortal, { className: "myt-modalMask", onMouseDown: function (e) { if (e.target === e.currentTarget) props.onClose(); } },
        h("div", { className: "myt-modalCard myt-toolsCard", role: "dialog", "aria-modal": "true", "aria-label": tt("tools.title") },
          h("div", { className: "myt-modalHead" },
            h("h2", { className: "myt-modalTitle" }, tt("tools.title")),
            h("button", { type: "button", className: "myt-closeBtn", "aria-label": tt("relations.close"), onClick: props.onClose }, h("span", { className: "myt-closeGlyph" }, "×"))),
          h("div", { className: "myt-toolsTabs" }, TABS_.map(function (t) {
            return h("button", {
              key: t[0], type: "button", className: "myt-btn", "data-active": tab === t[0] ? "true" : undefined,
              onClick: function () { setTab(t[0]); },
            }, tt(t[1]));
          })),
          h("div", { className: "myt-modalBody" },
            tab === "trash" ? h(TrashPane, { wsPath: props.wsPath, onReload: props.onReload })
              : tab === "export" ? h(ExportPane, { wsPath: props.wsPath, chapters: props.chapters })
                : h(SlimPane, { wsPath: props.wsPath, onReload: props.onReload }))));
    }

    function TrashPane(props) {
      var _d = useState(null), data = _d[0], setData = _d[1];
      var _e = useState(""), err = _e[0], setErr = _e[1];
      var _b = useState(""), busy = _b[0], setBusy = _b[1];
      function load() {
        setErr("");
        apiGet("trash", { path: props.wsPath }, { silent: true }).then(function (d) {
          if (d && d.ok) setData(d); else setErr((d && d.error) || tt("tools.trashFail"));
        }).catch(function (e) { setErr(e.message); });
      }
      useEffect(function () { load(); }, [props.wsPath]);
      function restore(item) {
        setBusy(item.id);
        apiPost("trash-restore", { path: props.wsPath, id: item.id }).then(function (d) {
          if (!d || !d.ok) throw new Error((d && d.error) || tt("tools.trashFail"));
          toast.ok(tf("tools.restored", { rel: d.rel }));
          load();
          if (props.onReload) props.onReload();
        }).catch(function (e) { toast.err(e.message); }).finally(function () { setBusy(""); });
      }
      function purge(item) {
        if (typeof window.confirm === "function" && !window.confirm(tf("tools.trashPurgeConfirm", { rel: item.rel }))) return;
        setBusy(item.id);
        apiPost("trash-purge", { path: props.wsPath, id: item.id }).then(function (d) {
          if (!d || !d.ok) throw new Error((d && d.error) || tt("tools.trashFail"));
          toast.ok(tt("tools.purged"));
          load();
        }).catch(function (e) { toast.err(e.message); }).finally(function () { setBusy(""); });
      }
      var items = data && Array.isArray(data.items) ? data.items : [];
      return h("div", { className: "myt-toolsPane" },
        h("div", { className: "myt-muted" }, tt("tools.trashHint")),
        err ? h("div", { className: "myt-muted" }, err)
          : !data ? h("div", { className: "myt-muted" }, tt("common.loading"))
            : items.length === 0 ? h("div", { className: "myt-muted" }, tt("tools.trashEmpty"))
              : h("div", { className: "myt-toolList" }, items.map(function (it) {
                return h("div", { key: it.id, className: "myt-toolRow" },
                  h("div", { className: "myt-toolMeta" },
                    h("span", { className: "myt-toolRel" }, it.rel),
                    h("span", { className: "myt-muted" }, " · " + formatBytes(it.bytes) + " · " + String(it.at || "").replace("T", " ").slice(0, 16))),
                  h("div", { className: "myt-toolActs" },
                    h("button", { type: "button", className: "myt-btn myt-btnSm", disabled: busy === it.id, onClick: function () { restore(it); } }, tt("tools.restore")),
                    h("button", { type: "button", className: "myt-btn myt-btnSm myt-btnDanger", disabled: busy === it.id, onClick: function () { purge(it); } }, tt("tools.purge"))));
              })));
    }

    function ExportPane(props) {
      function grab(format) {
        var href = API_BASE + "export-book?path=" + encodeURIComponent(props.wsPath) + "&format=" + encodeURIComponent(format);
        var a = document.createElement("a");
        a.href = href;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast.ok(tf("tools.exporting", { fmt: format === "docx" ? "Word" : (format === "epub" ? "EPUB" : "TXT") }));
      }
      var n = Array.isArray(props.chapters) ? props.chapters.length : 0;
      return h("div", { className: "myt-toolsPane" },
        h("div", { className: "myt-muted" }, tf("tools.exportHint", { n: n })),
        h("div", { className: "myt-setActions" },
          h("button", { type: "button", className: "myt-btn myt-btnPrimary", disabled: n === 0, onClick: function () { grab("txt"); } }, "TXT"),
          h("button", { type: "button", className: "myt-btn", disabled: n === 0, onClick: function () { grab("docx"); } }, "Word"),
          h("button", { type: "button", className: "myt-btn", disabled: n === 0, onClick: function () { grab("epub"); } }, "EPUB")),
        h("div", { className: "myt-muted" }, tt("tools.exportNote")));
    }

    function SlimPane(props) {
      var _v = useState("v02"), before = _v[0], setBefore = _v[1];
      var _p = useState(null), plan = _p[0], setPlan = _p[1];
      var _e = useState(""), err = _e[0], setErr = _e[1];
      var _b = useState(""), busy = _b[0], setBusy = _b[1];
      function loadPlan() {
        setErr("");
        setPlan(null);
        var v = String(before || "").trim();
        if (v === "") { setErr(tt("tools.slimNeedVolume")); return; }
        apiGet("slim-plan", { path: props.wsPath, before: v }, { silent: true }).then(function (d) {
          if (d && d.ok) setPlan(d); else setErr((d && d.error) || tt("tools.slimFail"));
        }).catch(function (e) { setErr(e.message); });
      }
      function apply() {
        if (!plan || plan.moveTotal === 0) return;
        if (typeof window.confirm === "function" && !window.confirm(tf("tools.slimConfirm", { n: plan.moveTotal, vol: plan.before }))) return;
        setBusy("apply");
        apiPost("slim-apply", { path: props.wsPath, before: plan.before }).then(function (d) {
          if (!d || !d.ok) throw new Error((d && d.error) || tt("tools.slimFail"));
          toast.ok(tf("tools.slimDone", { n: d.moved }));
          setPlan(null);
          if (props.onReload) props.onReload();
        }).catch(function (e) { toast.err(e.message); }).finally(function () { setBusy(""); });
      }
      return h("div", { className: "myt-toolsPane" },
        h("div", { className: "myt-muted" }, tt("tools.slimHint")),
        h("div", { className: "myt-setActions" },
          h("input", {
            className: "myt-setInput myt-slimInput", value: before, spellCheck: false,
            placeholder: tt("tools.slimBeforePh"), "aria-label": tt("tools.slimBeforePh"),
            onChange: function (e) { setBefore(e.target.value); },
          }),
          h("button", { type: "button", className: "myt-btn", onClick: loadPlan }, tt("tools.slimPlan"))),
        err ? h("div", { className: "myt-muted" }, err)
          : !plan ? null
            : plan.moveTotal === 0 ? h("div", { className: "myt-muted" }, tt("tools.slimNothing"))
              : h("div", { className: "myt-toolList" },
                plan.plan.filter(function (p) { return p.move > 0; }).map(function (p) {
                  return h("div", { key: p.file, className: "myt-toolRow" },
                    h("div", { className: "myt-toolMeta" },
                      h("span", { className: "myt-toolRel" }, p.file),
                      h("span", { className: "myt-muted" }, " · " + tf("tools.slimRow", { move: p.move, keep: p.keep }) + " → " + p.archiveFile),
                      p.blocked ? h("span", { className: "myt-badge" }, tt("tools.slimBlocked")) : null));
                }),
                plan.blockedAny ? h("div", { className: "myt-muted" }, tt("tools.slimBlockedNote")) : null,
                h("div", { className: "myt-setActions" },
                  h("button", { type: "button", className: "myt-btn myt-btnPrimary myt-btnDanger", disabled: busy === "apply", onClick: apply },
                    busy === "apply" ? tt("common.loading") : tf("tools.slimApply", { n: plan.moveTotal })))));
    }

    function formatBytes(n) {
      var v = Number(n) || 0;
      if (v < 1024) return v + " B";
      if (v < 1024 * 1024) return (v / 1024).toFixed(1) + " KB";
      return (v / 1024 / 1024).toFixed(1) + " MB";
    }

    // ── 段落热度条（0.10.0）：门禁只给整章一个分，这条告诉你先改哪几段。 ─────
    function HeatStrip(props) {
      var heat = props.heat || [];
      if (!heat.length) return null;
      var hot = heat.filter(function (x) { return x.heat >= 30; }).slice(0, 3);
      return h("div", { className: "myt-heat" },
        h("div", { className: "myt-heatHead" },
          h("span", { className: "myt-heatTitle" }, tt("heat.title")),
          h("span", { className: "myt-muted" }, hot.length ? tf("heat.top", { list: hot.map(function (x) { return "第" + (x.index + 1) + "段"; }).join("、") }) : tt("heat.cool"))),
        h("div", { className: "myt-heatBar" }, heat.map(function (x) {
          return h("span", {
            key: x.index, className: "myt-heatCell", "data-level": x.heat >= 55 ? "3" : (x.heat >= 30 ? "2" : (x.heat > 0 ? "1" : "0")),
            title: tf("heat.cellTip", { i: x.index + 1, heat: x.heat, hits: (x.hits || []).join("、") || "—" }),
          });
        })));
    }

    // ── 派单指令菜单（0.10.0）：写手/去AI味/审校三份模板随手复制 ─────────────
    function BriefMenu(props) {
      var _o = useState(false), open = _o[0], setOpen = _o[1];
      function pick(kind) {
        setOpen(false);
        var brief = tf("brief.body." + kind, { file: props.file, title: props.title || props.file });
        copyText(brief).then(function () { toast.ok(tf("brief.copied", { kind: tt("brief." + kind) })); }, function () { toast.err(tt("gate.copyFailed")); });
      }
      return h("div", { className: "myt-briefMenu" },
        h("button", { type: "button", className: "myt-btn", title: tt("brief.tip"), "aria-label": tt("brief.tip"), onClick: function () { setOpen(function (v) { return !v; }); } },
          tt("brief.open")),
        open ? h("div", { className: "myt-briefPop" },
          [["write", tt("brief.write")], ["polish", tt("brief.polish")], ["review", tt("brief.review")]].map(function (row) {
            return h("button", { key: row[0], type: "button", className: "myt-briefItem", onClick: function () { pick(row[0]); } }, row[1]);
          })) : null);
    }
    // ── 关系起始章补全（0.10.0）：只提议，作者点确定才写回 ──────────────────
    function RelationAutofill(props) {
      var _d = useState(null), data = _d[0], setData = _d[1];
      var _b = useState(false), busy = _b[0], setBusy = _b[1];
      var _p = useState([]), picked = _p[0], setPicked = _p[1];
      useEffect(function () {
        var alive = true;
        apiGet("relations-autofill", { path: props.wsPath }, { silent: true }).then(function (d) {
          if (!alive || !d || !d.ok) return;
          setData(d);
          setPicked(d.proposals.filter(function (p) { return p.chapter !== null; }).map(function (p) { return p.index; }));
        }).catch(function () { if (alive) setData({ proposals: [], missing: 0 }); });
        return function () { alive = false; };
      }, [props.wsPath]);
      function toggle(index) {
        setPicked(function (prev) {
          var i = prev.indexOf(index);
          if (i === -1) return prev.concat([index]);
          var next = prev.slice(); next.splice(i, 1); return next;
        });
      }
      function apply() {
        if (!data || busy || picked.length === 0) return;
        setBusy(true);
        var patches = data.proposals.filter(function (p) { return picked.indexOf(p.index) !== -1; })
          .map(function (p) { return { index: p.index, chapter: p.chapter }; });
        apiPost("relations-autofill", { path: props.wsPath, patches: patches }).then(function (d) {
          if (!d || !d.ok) throw new Error((d && d.error) || "autofill failed");
          toast.ok(tf("rel.autofillDone", { n: d.applied }));
          props.onDone();
          props.onClose();
        }).catch(function (err) { toast.err(tf("toast.prefix", { msg: err.message })); })
          .finally(function () { setBusy(false); });
      }
      var proposals = (data && data.proposals) || [];
      return h(MaskPortal, { className: "myt-modalMask", onMouseDown: function (e) { if (e.target === e.currentTarget) props.onClose(); } },
        h("div", { className: "myt-modalCard", role: "dialog", "aria-modal": "true", "aria-label": tt("rel.autofillTitle") },
          h("div", { className: "myt-modalHead" },
            h("h2", { className: "myt-modalTitle" }, tt("rel.autofillTitle")),
            h("button", { type: "button", className: "myt-closeBtn", "aria-label": tt("relations.close"), onClick: props.onClose }, h("span", { className: "myt-closeGlyph" }, "×"))),
          h("div", { className: "myt-modalBody" },
            h("div", { className: "myt-muted" }, tt("rel.autofillHint")),
            !data ? h("div", { className: "myt-muted" }, tt("common.loading"))
              : proposals.length === 0 ? h("div", { className: "myt-muted" }, tt("rel.autofillEmpty"))
                : h("div", { className: "myt-relList" }, proposals.map(function (p) {
                  var fillable = p.chapter !== null;
                  var on = picked.indexOf(p.index) !== -1;
                  return h("div", { key: p.index, className: "myt-relRow", "data-sel": on ? "1" : "0", onClick: function () { if (fillable) toggle(p.index); } },
                    h("div", { className: "myt-relRowHead" },
                      h("span", { className: "myt-relPair" }, p.aName, h("span", { className: "myt-relArrow" }, "↔"), p.bName),
                      h("span", { className: "myt-relMeta" }, fillable
                        ? h("span", { className: "myt-relRange" }, p.chapter + (p.evidence === "co-appear" ? "" : "（推断）"))
                        : h("span", { className: "myt-relWarn" }, tt("rel.autofillManual")))),
                    !fillable && p.reason ? h("div", { className: "myt-relDesc" }, p.reason) : null);
                })),
            data && proposals.length ? h("div", { className: "myt-setActions" },
              h("button", { type: "button", className: "myt-btn myt-btnPrimary", disabled: busy || picked.length === 0, onClick: apply },
                busy ? tt("common.loading") : tf("rel.autofillApply", { n: picked.length })),
              h("button", { type: "button", className: "myt-btn", onClick: props.onClose }, tt("relations.close"))) : null)));
    }
    // ── cordis client 插件入口 ──────────────────────────────────────────────
    // 依赖声明：底部入口走宿主 slots 键控槽，须声明 slots 服务（护栏下未声明
    // 的 ctx.slots 取不到，槽口挂载会静默折返）。挂载内部自捕：单个失败只
    // warn，不拖垮其余（单步自捕）。
    var inject = ["slots"];

    function apply(ctx) {
      var controller = createPanelController();
      var manual = []; // ctx.effect 不可用时的保底清理函数
      function track(mount, label) {
        if (ctx && typeof ctx.effect === "function") {
          try { ctx.effect(mount, label); return; } catch (err) { /* 落入手动路径 */ }
        }
        try {
          var dispose = mount();
          if (typeof dispose === "function") manual.push(dispose);
        } catch (err) {
          if (ctx && ctx.logger && typeof ctx.logger.warn === "function") {
            ctx.logger.warn("dsh-xiaoyu-novel: " + label + " mount failed: " + String((err && err.message) || err));
          }
        }
      }
      // 右侧栏服务探测：ctx.get 是可选查找（无需 inject 声明），0.1.x 宿主
      // 返回 undefined → sbReady=false，设置里右栏形态置灰，一切塌缩 middle。
      // 0.2.x 宿主服务由 sidebar-right 经 ctx.reflect.provide 发布，而 cordis
      // 的 get(name) 默认 strict=true——提供者 fiber 非活跃态时静默 undefined
      //（0.1.27 实测踩坑：设置里除中间栏全置灰、点章回落中栏）。探测走双路：
      // 非严格 get 优先，属性直读兜底（files 插件实证可用的消费路径），两路
      // 都失败才认输并落日志。
      function probeSbService(name) {
        try {
          if (ctx && typeof ctx.get === "function") {
            var v = ctx.get(name, false);
            if (v) return v;
          }
        } catch (err) { /* get 抛错（context 未激活等）走属性直读 */ }
        try {
          if (ctx) {
            var p = ctx[name];
            if (p) return p;
          }
        } catch (err) { /* 属性直读被代理拦（required service in inactive context） */ }
        return null;
      }
      var sbTabs = probeSbService("sidebarRightTabs");
      var sbRight = probeSbService("sidebarRight");
      var sbReady = !!(sbTabs && sbRight && typeof sbTabs.register === "function" && typeof sbRight.openTab === "function");
      // 活探测：设置项与守卫不在 apply 时拍快照，用点现探——服务提供晚于本
      // 插件 apply（时序）也不误伤，用户下次交互即见正确解锁。
      function sbProbe() {
        var t = probeSbService("sidebarRightTabs");
        var r = probeSbService("sidebarRight");
        return !!(t && r && typeof t.register === "function" && typeof r.openTab === "function");
      }
      // 懒挂载：apply 时先试一把（常规路径，graph 顺序正确即成），此后入口点
      // 击/点章/overlay ensure 时兜底重试——双保险覆盖服务晚到与首试失败
      //（mountSidebarTab 失败自清理，重试安全；成功后 ref 挡住重复注册）。
      var sbHandleRef = { current: null };
      function ensureSbHandle() {
        if (sbHandleRef.current) return sbHandleRef.current;
        var t = probeSbService("sidebarRightTabs");
        var r = probeSbService("sidebarRight");
        if (!(t && r && typeof t.register === "function" && typeof r.openTab === "function")) return null;
        sbHandleRef.current = mountSidebarTab(ctx, { tabs: t, right: r });
        return sbHandleRef.current;
      }
      if (!sbReady && ctx && typeof ctx.logger === "object" && ctx.logger && typeof ctx.logger.warn === "function") {
        ctx.logger.warn("dsh-xiaoyu-novel: sidebar-right services not found at apply (host <0.2 or provided later), will retry on demand: tabs=" + (sbTabs ? "ok" : "missing") + " right=" + (sbRight ? "ok" : "missing"));
      }
      track(function () {
        ensureSbHandle();
        return sbHandleRef.current ? sbHandleRef.current.dispose : function () {};
      }, "dsh-xiaoyu-novel: sidebar tab");
      // 入口位置（0.14.0）：优先注册成顶部面板列表项（main + sidebar.panellist）；
      // 宿主没有 layout 服务（老版本）时才退回底部动作位 + 中栏 overlay。
      var panelHandle = null;
      try {
        panelHandle = mountSidebarPanel(ctx, controller, { sbReady: sbReady, sbProbe: sbProbe, ensureSb: ensureSbHandle });
      } catch (err) {
        if (ctx.logger && typeof ctx.logger.warn === "function") ctx.logger.warn("dsh-xiaoyu-novel: panel entry failed: " + String((err && err.message) || err));
      }
      if (panelHandle) {
        track(function () { return panelHandle.dispose; }, "dsh-xiaoyu-novel: panel entry");
      } else {
        track(function () { return mountFooterEntry(ctx, controller, sbHandleRef, ensureSbHandle); }, "dsh-xiaoyu-novel: footer entry");
        track(function () { return mountPanel(controller, { sbReady: sbReady, sbProbe: sbProbe, ensureSb: ensureSbHandle, sbHandleRef: sbHandleRef }); }, "dsh-xiaoyu-novel: panel overlay");
      }
      return function () {
        manual.forEach(function (dispose) {
          try { dispose(); } catch (err) { /* 单个清理失败不阻断其余 */ }
        });
      };
    }

    exports.inject = inject;
    exports.apply = apply;

    return module.exports;
  },
});
