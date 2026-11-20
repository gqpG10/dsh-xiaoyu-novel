import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ── 写作流手感契约（0.5.1）───────────────────────────────────────────────
// 这一层守的是「写的时候别丢稿、别被打断」：
//   ① 自动保存不是纯防抖：停手约 1.5s 落盘，连续打字最迟 6s 也强制落一次；
//   ② 失败退避，网络断了不能每 1.5s 刷接口；
//   ③ 换章/返回先落盘再走，不再拿「确认丢弃」当常态；
//   ④ Ctrl/⌘+S 立即保存、切后台/失焦立即保存、卸载急救保存；
//   ⑤ 回车段首缩进走 execCommand，保住浏览器 undo 栈；
//   ⑥ 行号测量等高不换数组，长章打字不因整卡重渲掉帧。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const js = readFileSync(path.join(root, 'lib/client.js'), 'utf8')

function chunk(startMarker, len) {
  const i = js.indexOf(startMarker)
  assert.ok(i >= 0, '找不到锚点：' + startMarker)
  return js.slice(i, i + len)
}

test('自动保存：停手 1.5s / 连续 6s 强制，不再是 30s 纯防抖', () => {
  assert.ok(!js.includes('}, 30000);'), '还留着 30s 防抖定时器（连续打字永远不落盘）')
  assert.ok(js.includes('Math.min(1500, 6000 - (now - dirtySinceRef.current))'), '缺「1.5s 停顿 + 6s 强制」调度')
  assert.ok(js.includes('if (!dirtySinceRef.current) dirtySinceRef.current = now;'), '没有脏起点计时')
  assert.ok(js.includes('dirtySinceRef.current = 0;'), '保存成功后没有重置脏起点')
})

test('自动保存失败：指数退避，不刷接口', () => {
  assert.ok(js.includes('failCountRef.current += 1'), '失败没有累计退避次数')
  assert.ok(js.includes('1500 * Math.pow(2, failCountRef.current)'), '退避时长没按次数放大')
  assert.ok(js.includes('Math.min(30000, 1500 * Math.pow(2, failCountRef.current))'), '退避没有 30s 封顶')
  assert.ok(js.includes('failCountRef.current = 0; // 成功即清退避'), '成功后没有清零退避')
})

test('换章/返回：先落盘再走（saveThenGo）', () => {
  const next = chunk('function goNextChapter()', 500)
  assert.ok(next.includes('saveThenGo(function ()'), '下一章没先保存')
  assert.ok(next.includes('common.dirtyExit'), '章纲草稿丢了确认')
  assert.ok(next.includes('props.onOpenChapter(nextCh.file)'), '没把下一章交给宿主')
  const back = chunk('function leaveReader()', 500)
  assert.ok(back.includes('saveThenGo(function ()'), '返回没先保存正文')
  assert.ok(back.includes('onBack();'), '返回链路断了')
  assert.ok(js.includes('saveBody().then(function (ok) { if (ok) go(); })'), '保存失败时仍然会切走')
})

test('Ctrl/⌘+S 与切后台/失焦立即保存', () => {
  assert.ok(js.includes('e.ctrlKey || e.metaKey'), '没有 Ctrl/⌘ 判定')
  assert.ok(js.includes('String(e.key).toLowerCase() !== "s"'), '没有 S 键判定')
  assert.ok(js.includes('e.preventDefault()'), '没拦截浏览器保存网页')
  assert.ok(js.includes('saveRef.current()'), '快捷键没有触发保存')
  assert.ok(js.includes('window.addEventListener("blur", flush)'), '失焦不落盘')
  assert.ok(js.includes('document.visibilityState === "hidden"'), '切后台不落盘')
})

test('卸载急救：右栏换章/关 tab 也不静默丢稿', () => {
  const c = chunk('// 卸载急救', 900)
  assert.ok(c.includes('apiPost("chapter-save"'), '卸载时没有补一次保存')
  assert.ok(c.includes('fileRef.current'), '卸载保存没用当前章（可能写错章）')
  assert.ok(c.includes('base_hash: dd ? dd.hash : undefined'), '卸载保存没带基线指纹（可能覆盖外部改动）')
})

test('回车段首缩进：execCommand 优先，回落手动插值', () => {
  const hits = js.split('document.execCommand("insertText", false, "\\n　　")').length - 1
  assert.equal(hits, 2, '两处编辑框（卡内/全屏）都要走 undo 安全的插入')
  assert.ok(js.includes('pendingCaretRef.current = s + 3;'), '退化路径丢了光标恢复')
})

test('保存后整份快照重拉合并到 1.2s（连续自动保存不重扫全书）', () => {
  assert.ok(js.includes('clearTimeout(reloadTimerRef.current)'), '没有合并器')
  assert.ok(js.includes('}, 1200);'), '合并窗口不是 1.2s')
  assert.ok(!js.includes('return reload().then(function () { return true; })'), '保存还在同步整份 reload')
})

test('行号测量：等高不换数组（长章不每键整卡重渲）', () => {
  assert.ok(js.includes('prev.length === tops.length'), '没有做行号数组等值判断')
  assert.ok(js.includes('if (prev[ti] !== tops[ti]) return tops;'), '值不同时没更新')
  assert.ok(js.includes('return prev;'), '等高时没有复用旧数组')
})

test('i18n：编辑提示讲清新保存策略（中英同改）', () => {
  assert.ok(js.includes('停手约 1.5 秒自动保存'), '中文提示还是旧口径')
  assert.ok(js.includes('Ctrl/⌘+S 立即保存'), '中文提示没提快捷键')
  assert.ok(js.includes('auto-save ~1.5s after you pause'), '英文提示还是旧口径')
  assert.ok(!js.includes('改动约 30 秒自动保存'), '旧 30 秒文案残留')
})
