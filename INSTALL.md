# 离线安装（DSHA / DSH）

## 方式一：压缩包导入（推荐，离线可用）

1. 把 `dsh-xiaoyu-novel-<版本>.zip` 拷到设备（Download 即可）。
2. 终端执行：

       dsha-plugin import /sdcard/Download/dsh-xiaoyu-novel-2.0.0.zip

3. 重启 DSHA Web。
4. 侧栏底部出现「小鱼创作台」；新建会话的预设选择器出现「小鱼创作 (Xiaoyu)」。

## 方式二：源码目录 link（开发机）

    dsh plugin --profile web add link:/path/to/dsh-xiaoyu-novel

## 首次启动会自动做什么

- 把 `presets/xiaoyu-novel/` 落盘到 `~/.dsh/.agent-presets/xiaoyu-novel/`；
- 把 `skills/` 里的 `xiaoyu-*` 与 `xiaoyu-*` 技能落盘（内容一致不覆写）；
- 在 `~/.dsh/cordis.patch.yml` 写入自己的托管块（起止标记 `# --- dsh-xiaoyu-novel preset managed ---`）；
- 幂等注册 `EXTRA_WORKSPACES` 里的存量项目目录；目录不存在则跳过，不影响启动。

## 与毛颖创作台共存

两套插件使用不同的 preset id、路由前缀（`/api/xiaoyu-novel`）、托管块标记，可同时安装；数据都在工作区的 `novel/` 目录里，互不写入对方文件。

## 卸载

    dsha-plugin delete dsh-xiaoyu-novel

卸载会移除插件与 profile 里的 bundle；`~/.dsh/.agent-presets/xiaoyu-novel/` 与已落盘技能需手动删除，`novel/` 数据不受影响。
