// ── xiaoyu-novel-guard：先消除「不确定」，再谈刹车（0.13.0）────────────────────
//
// 0.12 的教训：把绕圈当「错误」去惩罚，会连带砍掉正在产出的工作——模型是
// 因为「不确定搜够了没有」才反复搜的，不是因为想绕。所以本版改成三层预防：
//
//   ① 结果自证（repeat）：同一工具同一参数再来一次，不重新报错，而是直接
//      回上一次的结果 + 一句「同参数，未变」——它拿不到新信息，绕圈没收益；
//   ② 同果提示（sameResult）：换参数但结果一模一样时，只加一句提示（不是
//      失败），告诉它「信息没变，够用就出结论」；
//   ③ 步骤台账（ledger）：每 N 步把「你已经做过什么」压成几行塞回上下文，
//      替它记住——重试导致的失忆是绕圈的第一大来源。
//
// 刹车保留两条，且都是「真没正当理由」的场景：
//   · blockAt：同参连续第 N 次（默认 4）——原样重发同一条命令；
//   · stopAt：绝对上限（默认 90 / 主编 180）——兜住失控花费，正常任务碰不到。
//   softAt（默认 25 / 主编 50）只提醒收口，不拦任何东西。
//
// 所有计数在用户发新消息时清零。

import { randomUUID } from "node:crypto"

export const name = "xiaoyu-novel-guard"

/** 参数规范化：键排序后稳定序列化（键序不同不算不同调用）。 */
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]"
  const keys = Object.keys(value).sort()
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}"
}

/** 结果文本：content 里的 text 块拼起来（拿不到就给空串）。 */
function resultText(result) {
  if (result === null || result === undefined) return ""
  const blocks = Array.isArray(result.content) ? result.content : []
  return blocks
    .filter((b) => b !== null && typeof b === "object" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
}

/** 结果指纹：文本优先，纯值结果退回 JSON；用于判断「换参数但结果没变」。 */
function fingerprint(result) {
  const text = resultText(result)
  let body = text
  if (body === "") {
    try { body = JSON.stringify(result && result.value !== undefined ? result.value : null) ?? "" } catch { body = "" }
  }
  let hash = 2166136261
  for (let i = 0; i < body.length; i++) {
    hash ^= body.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16) + ":" + body.length
}

function positiveInt(value, fallback) {
  return Number.isInteger(value) && value >= 1 ? value : fallback
}

/** 一条「系统提示」消息（additionalContexts 要的是消息，不是内容块）。 */
function notice(text, summary) {
  return {
    id: randomUUID(),
    role: "user",
    content: [{ type: "text", text }],
    source: { kind: "xiaoyu-novel-guard", form: "notice", summary: summary || "guard" },
  }
}

/** 参数摘要：argv 太长会糊屏，取前 3 个键值、截断到 40 字。 */
function argsBrief(args) {
  if (args === null || typeof args !== "object") return ""
  const parts = []
  for (const [k, v] of Object.entries(args)) {
    if (k === "path" || k === "workspace") continue
    const text = typeof v === "string" ? v : JSON.stringify(v)
    if (text === undefined) continue
    parts.push(k + "=" + String(text).replace(/\s+/g, " ").slice(0, 40))
    if (parts.length >= 2) break
  }
  return parts.join(" ")
}

export function apply(ctx, config = {}) {
  const blockAt = positiveInt(config.blockAt, 4)
  const softAt = positiveInt(config.softAt, 25)
  const stopAt = positiveInt(config.stopAt, 90)
  const ledgerEvery = positiveInt(config.ledgerEvery, 5)
  const sameResultBlockAt = positiveInt(config.sameResultBlockAt, 5)
  const ledgerSize = positiveInt(config.ledgerSize, 10)
  const state = new WeakMap()

  function stateOf(agent) {
    let s = state.get(agent)
    if (s === undefined) {
      s = { total: 0, key: "", count: 0, results: new Map(), cache: new Map(), recent: [], warned: false }
      state.set(agent, s)
    }
    return s
  }

  /** 把一条操作记进台账（滚动窗口）。 */
  function remember(s, toolName, args, size) {
    s.recent.push(toolName + (argsBrief(args) ? "(" + argsBrief(args) + ")" : "") + (size > 0 ? "→" + size + "字" : ""))
    if (s.recent.length > ledgerSize) s.recent.splice(0, s.recent.length - ledgerSize)
  }

  ctx.on("tools/post-execute", async (exec, result, next) => {
    const downstream = await next()
    if (!exec || !exec.agent) return downstream
    const s = stateOf(exec.agent)
    const toolName = String(exec.name ?? "")
    const args = exec.arguments ?? null
    const key = toolName + "\u0000" + canonical(args)
    const fp = toolName + "\u0000" + fingerprint(result)
    s.total += 1

    const contexts = []
    const push = (text, summary) => contexts.push(notice(text, summary))

    // ① 同参重复：不判失败，直接回上一次的结果 + 一句说明。
    if (s.key === key) s.count += 1
    else { s.key = key; s.count = 1 }
    if (s.count > 1) {
      const cached = s.cache.get(key)
      if (cached !== undefined && s.count < blockAt) {
        remember(s, toolName, args, 0)
        return {
          kind: "accept",
          content: [
            ...cached,
            { type: "text", text: "\n[xiaoyu-novel-guard] 同参数第 " + s.count + " 次调用：未重新执行，上面是上一次的结果（未变）。如果需要新信息请换参数。" },
          ],
        }
      }
      if (s.count >= blockAt) {
        s.count = 0
        s.cache.delete(key)
        return {
          kind: "block",
          feedback: [{ type: "text", text: [
            "[xiaoyu-novel-guard] 同一工具 + 同一参数已连续 " + blockAt + " 次，本次未执行。",
            "换一个真正不同的做法，或直接用已有结果给结论；未核实的写「未核实」。",
          ].join("\n") }],
          ...(contexts.length > 0 ? { additionalContexts: contexts } : {}),
        }
      }
    }

    // 记住第一次的结果，供同参重复时回放。
    if (s.count === 1) {
      const blocks = Array.isArray(result.content) ? result.content : []
      s.cache.set(key, blocks)
      if (s.cache.size > 50) s.cache.delete(s.cache.keys().next().value)
    }

    const text = resultText(result)
    remember(s, toolName, args, text.length)

    // ② 同果：换参数但结果一致。第 2 次只提醒（不拦），第 3 次起把结果换成
    // 「无新信息」短句——注意这不是惩罚：结果本来就一模一样，交不交出去都不丢信息。
    // 连续 sameResultBlockAt 次仍不停才终止（那时已证明「怎么搜都没有新东西」）。
    const seen = (s.results.get(fp) ?? 0) + 1
    s.results.set(fp, seen)
    if (seen === 2) {
      push("[xiaoyu-novel-guard] 这次的结果与上一次完全相同（虽然参数不同）——信息没有增加，够用就可以出结论了。", toolName + " 同果")
    }
    if (seen >= 3 && seen < sameResultBlockAt) {
      return {
        kind: "accept",
        content: [{ type: "text", text: "[xiaoyu-novel-guard] 本次结果与前面第 " + (seen - 1) + " 次完全相同，不再重复输出（无新信息）。需要更多内容请换检索范围（如 xiaoyu-novel find），或直接出结论。" }],
        ...(contexts.length > 0 ? { additionalContexts: [...contexts] } : {}),
      }
    }
    if (seen >= sameResultBlockAt) {
      s.results.set(fp, 0)
      return {
        kind: "block",
        feedback: [{ type: "text", text: [
          "[xiaoyu-novel-guard] 连续 " + sameResultBlockAt + " 次拿回完全相同的结果，本次未执行。",
          "这批信息已经在你手里了：用已有结果给结论，未核实的写「未核实」。要覆盖更大范围请换做法（如 xiaoyu-novel find <关键词>）。",
        ].join("\n") }],
        ...(contexts.length > 0 ? { additionalContexts: [...contexts] } : {}),
      }
    }

    // ③ 步骤台账：每 N 步回放「你已经做过什么」，替它记住。
    if (s.total % ledgerEvery === 0) {
      push("[xiaoyu-novel-guard] 你已经做过（最近 " + s.recent.length + " 步，勿重复）：\n" + s.recent.map((x) => "· " + x).join("\n"), "步骤台账")
    }

    // ④ 预算：只提醒，不拦；到绝对上限才终止（兜住失控花费）。
    if (s.total >= softAt && !s.warned) {
      s.warned = true
      push("[xiaoyu-novel-guard] 本轮已 " + s.total + " 步。开始收口：能交付的先交付，没核实的写「未核实」。", "预算提醒")
    }
    if (s.total >= stopAt) {
      return {
        kind: "block",
        feedback: [{ type: "text", text: [
          "[xiaoyu-novel-guard] 本轮工具调用已达绝对上限 " + stopAt + " 步，本次未执行。",
          "请立即用已有信息输出结果（结论 / 已核实 / 未核实）。继续需要用户发新消息。",
        ].join("\n") }],
        ...(contexts.length > 0 ? { additionalContexts: contexts } : {}),
      }
    }

    if (contexts.length > 0) {
      const merge = (d) => ({
        ...d,
        additionalContexts: [...contexts, ...(d && Array.isArray(d.additionalContexts) ? d.additionalContexts : [])],
      })
      return merge(downstream)
    }
    return downstream
  })

  // 用户发话＝重新开局：预算、台账、缓存全部清零。
  ctx.on("agent/pre-step", ({ agent, messages }, next) => {
    if (agent && Array.isArray(messages) && messages.some((m) => m && m.source && m.source.kind === "user")) state.delete(agent)
    return next()
  })
}
