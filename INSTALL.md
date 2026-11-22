# 离线安装（DSHA / DSH）

## 方式一：压缩包导入（推荐，离线可用）

1. 把 `dsh-xiaoyu-novel-<版本>.zip` 拷到设备（Download 即可）。
2. 终端执行：

       dsha-plugin import /sdcard/Download/dsh-xiaoyu-novel-3.0.0.zip

3. 重启 DSHA Web。
4. 侧栏底部出现「小鱼创作台」；新建会话的预设选择器出现「小鱼创作 (Xiaoyu)」。

装完想确认没缺件，跑一条：

       xiaoyu-novel doctor

七项全 ✓ 就是完整的（预设源文件 / 两层 patch 托管块 / 默认预设 / 预设切换器 / 方法论技能 / 工作区）。

## 方式二：源码目录 link（开发机）

    dsh plugin --profile web add link:/path/to/dsh-xiaoyu-novel

## 方式三：自己打包（改完源码重新分发）

    npm run pack              # 出 dist/dsh-xiaoyu-novel-<版本>.zip 与 .tar.gz + .sha256
    npm run pack:list         # 只列会打进去的文件，不写盘

打包清单写死在 `scripts/pack.mjs` 的 `MUST_INCLUDE` 里，缺一项直接报错不打包——
技能包、预设源文件、模板、CLI、文档、CI 配置、图标、LICENSE 一个都不会漏。
包内顶层是 `dsh-xiaoyu-novel/`，`dsha-plugin import` 直接认。

## 首次启动会自动做什么

- 把 `presets/xiaoyu-novel/` 落盘到 `~/.dsh/.agent-presets/xiaoyu-novel/`；
- 把 `skills/` 里的 `xiaoyu-*` 技能落盘（内容一致不覆写）；
- 在 `~/.dsh/cordis.patch.yml` 写入自己的托管块（起止标记 `# --- dsh-xiaoyu-novel preset managed ---`）；
- 接入项目只读 `XIAOYU_EXTRA_WORKSPACES` 环境变量或 `~/.dsh/xiaoyu-workspaces.json`，
  **内置清单为空**——发行包不带任何作者本机路径，你的书由你自己在面板「接入项目」里登记。

## 与其它创作台共存

不同 preset id、不同路由前缀（`/api/xiaoyu-novel`）、不同托管块标记的插件可同时安装；
数据都在各自工作区的 `novel/` 目录里，互不写入对方文件。
但**同名技能会撞**（CSS / localStorage / skill 同名），两套都带 `xiaoyu-*` 技能时只装一套。

## 卸载

    dsha-plugin delete dsh-xiaoyu-novel

卸载会移除插件与 profile 里的 bundle；`~/.dsh/.agent-presets/xiaoyu-novel/` 与已落盘技能需手动删除，`novel/` 数据不受影响。
