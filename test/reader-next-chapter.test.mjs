import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ── 「下一章」契约（0.4.6）───────────────────────────────────────────────
// 阅读页顶栏加「下一章」，读完一章一步跳到下一章。守住四件事：
//   ① 顺序口径：按章节号升序（同号按文件名），不看 index.yml 的写入顺序；
//   ② 末章/找不到当前章 → null，按钮禁用并说明「已是最后一章」；
//   ③ 换章前走与「返回」同一条脏退出确认（草稿不静默丢）；
//   ④ 两种形态都有人接：overlay 换 file 重挂，右栏 tab 走本地 override 重挂。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const js = readFileSync(path.join(root, 'lib/client.js'), 'utf8')

// 从源码里切出 nextChapterOf 的完整函数体（括号配对），new Function 求值直测
function sliceFunction(name) {
  const start = js.indexOf('function ' + name + '(')
  assert.ok(start >= 0, '找不到函数 ' + name)
  let depth = 0
  for (let i = js.indexOf('{', start); i < js.length; i++) {
    if (js[i] === '{') depth++
    else if (js[i] === '}') {
      depth--
      if (depth === 0) return js.slice(start, i + 1)
    }
  }
  throw new Error('函数未闭合：' + name)
}

const nextChapterOf = new Function('return ' + sliceFunction('nextChapterOf'))()

test('下一章：按章节号升序取当前章的下一条', () => {
  const chapters = [
    { file: '003.md', num: 3 },
    { file: '001.md', num: 1 },
    { file: '002.md', num: 2 },
    { file: '004.md', num: 4 },
  ]
  assert.equal(nextChapterOf(chapters, '001.md').file, '002.md')
  assert.equal(nextChapterOf(chapters, '002.md').file, '003.md')
  assert.equal(nextChapterOf(chapters, '003.md').file, '004.md')
})

test('下一章：末章为 null，找不到当前章也为 null（按钮禁用，不瞎跳）', () => {
  const chapters = [{ file: '001.md', num: 1 }, { file: '002.md', num: 2 }]
  assert.equal(nextChapterOf(chapters, '002.md'), null)
  assert.equal(nextChapterOf(chapters, 'nope.md'), null)
  assert.equal(nextChapterOf([], '001.md'), null)
  assert.equal(nextChapterOf(null, '001.md'), null)
})

test('下一章：同号按文件名定序，缺 num 视为 0（不抛、不跳错）', () => {
  const chapters = [{ file: 'b.md' }, { file: 'a.md' }, { file: 'c.md', num: 1 }]
  assert.equal(nextChapterOf(chapters, 'a.md').file, 'b.md')
  assert.equal(nextChapterOf(chapters, 'b.md').file, 'c.md')
  assert.equal(nextChapterOf(chapters, 'c.md'), null)
})

test('下一章按钮：顶栏渲染 + 末章禁用 + 脏退出确认', () => {
  assert.ok(js.includes('tt("reader.nextChapter")'), '顶栏没渲染「下一章」')
  const idx = js.indexOf('function goNextChapter()')
  assert.ok(idx > 0, '找不到 goNextChapter')
  const chunk = js.slice(idx, idx + 700)
  assert.ok(/disabled|!nextCh/.test(js), '按钮缺末章禁用')
  assert.ok(chunk.includes('common.dirtyExit'), '换章前没做脏退出确认（草稿会静默丢）')
  assert.ok(chunk.includes('props.onOpenChapter(nextCh.file)'), '没把下一章交给宿主换章')
  assert.ok(js.includes('reader.lastChapter'), '末章没有说明文案')
})

test('下一章：右栏 tab 接了 onOpenChapter（唯一活形态）', () => {
  // 3.26.0：PageShell overlay 自 3.2.1 起不再渲染（真机黑屏，正文改 iframe），
  // 它那处 onOpenChapter 接的是死代码里的死接线。右栏 tab 是唯一活形态，
  // 契约改为「至少 1 处」，并单独断言它走 setOverrideFile（本地 override 换章）。
  const occurrences = js.split('onOpenChapter: function (nextFile)').length - 1
  assert.ok(occurrences >= 1, '右栏 tab 没接 onOpenChapter（点下一章没反应）')
  assert.ok(js.includes('setOverrideFile(nextFile)'), '右栏 tab 没走本地 override 换章')
  assert.ok(js.includes('key: shownFile + ":" + revision'), '右栏 tab 换章不会重挂（草稿与编辑态串章）')
})

test('下一章：i18n 中英双全', () => {
  const zh = js.indexOf('"reader.nextChapter": "下一章"')
  assert.ok(zh > 0, '缺中文键 reader.nextChapter')
  assert.ok(js.includes('"reader.nextTip": "跳到「{name}」"'), '缺中文 reader.nextTip')
  assert.ok(js.includes('"reader.lastChapter": "已是最后一章"'), '缺中文 reader.lastChapter')
  assert.ok(js.includes('"reader.nextChapter": "Next chapter"'), '缺英文键 reader.nextChapter')
  assert.ok(js.includes('"reader.lastChapter": "This is the last chapter"'), '缺英文 reader.lastChapter')
})
