import { describe, expect, test } from "vitest";
import { callSummary, firstLine, groupMessages, isFailedResult, looksLikeJson, stripUserMeta } from "./chatModel";
import type { ChatNode } from "./chatModel";
import type { Msg } from "../types";

/** 构造测试消息：必填字段给默认值 */
function msg(partial: Partial<Msg> & { idx: number; role: string }): Msg {
  return { preview: "", content_len: 0, content: "", reasoning_len: 0, ...partial };
}

/** 断言节点类型并返回收窄后的类型（TS 按下标访问不收窄，用此辅助） */
function expectKind<K extends ChatNode["kind"]>(node: ChatNode, kind: K): Extract<ChatNode, { kind: K }> {
  expect(node.kind).toBe(kind);
  return node as Extract<ChatNode, { kind: K }>;
}

describe("stripUserMeta", () => {
  test("剥离 Sender JSON 头与 [时间戳 GMT+8] 前缀", () => {
    const raw = 'Sender (untrusted metadata):\n{"label":"cli","id":"cli"}\n\n[2026-08-24 15:04:05 GMT+8] + 帮我写一个贪吃蛇游戏';
    expect(stripUserMeta(raw)).toBe("帮我写一个贪吃蛇游戏");
  });

  test("JSON 头含嵌套花括号与字符串内花括号也能配平", () => {
    const raw = 'Sender (untrusted metadata): {"a":{"b":"}]"}}\n[2026-01-01 00:00:00 GMT+8] + 问题';
    expect(stripUserMeta(raw)).toBe("问题");
  });

  test("无 Sender 前缀原样返回", () => {
    expect(stripUserMeta("直接的问题")).toBe("直接的问题");
  });

  test("剥离后为空则回退原文", () => {
    const raw = 'Sender (untrusted metadata): {"label":"cli"}';
    expect(stripUserMeta(raw)).toBe(raw);
  });
});

describe("firstLine", () => {
  test("单行原样；超长截断加省略号", () => {
    expect(firstLine("abc")).toBe("abc");
    expect(firstLine("x".repeat(81))).toBe("x".repeat(80) + "…");
  });

  test("多行内容摘要合并后续行，不再只取首行丢信息", () => {
    // 真实数据里 tool 结果常为 "JS OK\n200" 等多行，摘要应保留可见信息
    expect(firstLine("JS OK\n200")).toBe("JS OK 200");
    expect(firstLine("first\nsecond\nthird")).toBe("first second third");
  });

  test("合并后超长仍按 max 截断", () => {
    const s = "a".repeat(100) + "\n" + "b".repeat(100);
    expect(firstLine(s)).toBe("a".repeat(80) + "…");
  });
});

describe("looksLikeJson", () => {
  test("对象/数组为 true，标量与普通文本为 false", () => {
    expect(looksLikeJson('{"ok":true}')).toBe(true);
    expect(looksLikeJson("[1,2]")).toBe(true);
    expect(looksLikeJson("plain text")).toBe(false);
    expect(looksLikeJson("123")).toBe(false);
    expect(looksLikeJson("null")).toBe(false);
  });
});

describe("groupMessages · 轮(turn)划分与工具调用配对", () => {
  test("tool_calls 与紧随的 tool 结果配对一个 pair，仅工具轮 msg 为 null", () => {
    const nodes = groupMessages([
      msg({
        idx: 0, role: "assistant",
        tool_calls: [{ id: "c1", type: "function", function: { name: "write", arguments: '{"path":"a.html"}' } }],
      }),
      msg({ idx: 1, role: "tool", content: "ok", tool_call_id: "c1" }),
    ]);
    expect(nodes).toHaveLength(1);
    const turn = expectKind(nodes[0], "turn");
    expect(turn.msg).toBeNull();   // 无正文仅工具调用：轮内消息为空
    expect(turn.pairs).toEqual([
      { kind: "call", name: "write", args: '{"path":"a.html"}', result: "ok", weight: null,
        msgIdx: 0, sub: 0, resultMsgIdx: 1 },
    ]);
  });

  test("有正文的轮：正文与工具归同一轮，msg 为 assistant 消息", () => {
    const nodes = groupMessages([
      msg({
        idx: 0, role: "assistant", content: "我来搭建",
        tool_calls: [{ id: "c1", type: "function", function: { name: "exec", arguments: '{"command":"ls"}' } }],
      }),
      msg({ idx: 1, role: "tool", content: "r1", tool_call_id: "c1" }),
    ]);
    expect(nodes).toHaveLength(1);
    const turn = expectKind(nodes[0], "turn");
    expect(turn.msg).not.toBeNull();
    expect(turn.msg!.idx).toBe(0);
    expect(turn.msg!.content).toBe("我来搭建");
    expect(turn.pairs).toHaveLength(1);
  });

  test("每条 assistant 消息独立成轮：连续仅工具轮各为一个 turn", () => {
    const nodes = groupMessages([
      msg({
        idx: 0, role: "assistant",
        tool_calls: [{ id: "c1", type: "function", function: { name: "exec", arguments: '{"command":"ls"}' } }],
      }),
      msg({ idx: 1, role: "tool", content: "r1", tool_call_id: "c1" }),
      msg({
        idx: 2, role: "assistant",
        tool_calls: [{ id: "c2", type: "function", function: { name: "exec", arguments: '{"command":"pwd"}' } }],
      }),
      msg({ idx: 3, role: "tool", content: "r2", tool_call_id: "c2" }),
    ]);
    expect(nodes.map((n) => n.kind)).toEqual(["turn", "turn"]);
    expect(expectKind(nodes[0], "turn").msg).toBeNull();
    expect(expectKind(nodes[1], "turn").msg).toBeNull();
    expect(expectKind(nodes[0], "turn").pairs[0]).toMatchObject({ result: "r1" });
    expect(expectKind(nodes[1], "turn").pairs[0]).toMatchObject({ result: "r2" });
  });

  test("pair 继承发起调用的 assistant 消息的 weight；无 weight 或 orphan 为 null", () => {
    const nodes = groupMessages([
      msg({
        idx: 0, role: "assistant", weight: 0,
        tool_calls: [{ id: "c1", type: "function", function: { name: "exec", arguments: '{"command":"ls"}' } }],
      }),
      msg({ idx: 1, role: "tool", content: "r1", tool_call_id: "c1" }),
      msg({
        idx: 2, role: "assistant", weight: 1,
        tool_calls: [{ id: "c2", type: "function", function: { name: "exec", arguments: '{"command":"pwd"}' } }],
      }),
      msg({ idx: 3, role: "tool", content: "r2", tool_call_id: "c2" }),
      msg({ idx: 4, role: "assistant" }),
      msg({ idx: 5, role: "tool", content: "orphan" }),
    ]);
    const t0 = expectKind(nodes[0], "turn");
    const t1 = expectKind(nodes[1], "turn");
    expect(t0.pairs[0]).toMatchObject({ kind: "call", weight: 0, result: "r1" });
    expect(t1.pairs[0]).toMatchObject({ kind: "call", weight: 1, result: "r2" });
    expect(t1.pairs[1]).toMatchObject({ kind: "orphan", weight: null });
  });

  test("tool_call_id 乱序结果也能精确配对（并行调用）", () => {
    const nodes = groupMessages([
      msg({
        idx: 0, role: "assistant",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "read", arguments: '{"path":"a"}' } },
          { id: "c2", type: "function", function: { name: "read", arguments: '{"path":"b"}' } },
        ],
      }),
      msg({ idx: 1, role: "tool", content: "r2", tool_call_id: "c2" }),
      msg({ idx: 2, role: "tool", content: "r1", tool_call_id: "c1" }),
    ]);
    const turn = expectKind(nodes[0], "turn");
    expect(turn.pairs[0]).toMatchObject({ kind: "call", name: "read", result: "r1" });
    expect(turn.pairs[1]).toMatchObject({ result: "r2" });
  });

  test("tool_call_id 对不上时按调用顺序兜底配对", () => {
    const nodes = groupMessages([
      msg({
        idx: 0, role: "assistant",
        tool_calls: [{ id: "c1", type: "function", function: { name: "exec", arguments: '{"command":"ls"}' } }],
      }),
      msg({ idx: 1, role: "tool", content: "ok", tool_call_id: "unknown" }),
    ]);
    expect(expectKind(nodes[0], "turn").pairs[0]).toMatchObject({ kind: "call", result: "ok" });
  });

  test("兜底配对跳过已被 id 精确配对占用的调用", () => {
    const nodes = groupMessages([
      msg({
        idx: 0, role: "assistant",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "read", arguments: '{"path":"a"}' } },
          { id: "c2", type: "function", function: { name: "read", arguments: '{"path":"b"}' } },
        ],
      }),
      // 第一个结果按 id 精确配对到 c1
      msg({ idx: 1, role: "tool", content: "r1", tool_call_id: "c1" }),
      // 第二个结果 id 对不上：应兜底配给尚未配对的 c2，而不是重复占用 c1
      msg({ idx: 2, role: "tool", content: "r2", tool_call_id: "unknown" }),
    ]);
    const turn = expectKind(nodes[0], "turn");
    expect(turn.pairs[0]).toMatchObject({ result: "r1" });
    expect(turn.pairs[1]).toMatchObject({ result: "r2" });
  });

  test("无待配对调用的 tool 结果归为 orphan，自成一轮", () => {
    const nodes = groupMessages([
      msg({ idx: 0, role: "assistant" }),
      msg({ idx: 1, role: "tool", content: "r1" }),
    ]);
    expect(nodes).toHaveLength(1);
    const turn = expectKind(nodes[0], "turn");
    expect(turn.msg).toBeNull();
    expect(turn.pairs).toEqual([{ kind: "orphan", result: "r1", weight: null, msgIdx: 1 }]);
  });

  test("结果跨过非空 assistant 正文归回原轮，正文轮不再新开工具", () => {
    const nodes = groupMessages([
      msg({
        idx: 0, role: "assistant",
        tool_calls: [{ id: "c1", type: "function", function: { name: "exec", arguments: '{"command":"ls"}' } }],
      }),
      msg({ idx: 1, role: "assistant", content: "正文" }),
      msg({ idx: 2, role: "tool", content: "r1", tool_call_id: "c1" }),
    ]);
    expect(nodes.map((n) => n.kind)).toEqual(["turn", "turn"]);
    expect(expectKind(nodes[0], "turn").pairs[0]).toMatchObject({ kind: "call", result: "r1" });
  });

  test("流末尾调用始终等不到结果时 result 为 null", () => {
    const nodes = groupMessages([
      msg({
        idx: 0, role: "assistant",
        tool_calls: [{ id: "c1", type: "function", function: { name: "write", arguments: "{}" } }],
      }),
    ]);
    expect(expectKind(nodes[0], "turn").pairs[0]).toMatchObject({ kind: "call", result: null });
  });

  test("连续「空 assistant + tool」跨占位合并为一轮多个 orphan", () => {
    const nodes = groupMessages([
      msg({ idx: 0, role: "assistant" }),
      msg({ idx: 1, role: "tool", content: "r1" }),
      msg({ idx: 2, role: "assistant" }),
      msg({ idx: 3, role: "tool", content: "r2" }),
    ]);
    expect(nodes).toHaveLength(1);
    const turn = expectKind(nodes[0], "turn");
    expect(turn.msg).toBeNull();
    expect(turn.pairs).toEqual([
      { kind: "orphan", result: "r1", weight: null, msgIdx: 1 },
      { kind: "orphan", result: "r2", weight: null, msgIdx: 3 },
    ]);
  });

  test("非空 assistant 正文打断归并：前后工具各归各轮", () => {
    const nodes = groupMessages([
      msg({ idx: 0, role: "assistant" }),
      msg({ idx: 1, role: "tool", content: "r1" }),
      msg({ idx: 2, role: "assistant", content: "正文" }),
      msg({ idx: 3, role: "tool", content: "r2" }),
    ]);
    expect(nodes.map((n) => n.kind)).toEqual(["turn", "turn"]);
    expect(expectKind(nodes[0], "turn").pairs[0]).toMatchObject({ kind: "orphan", result: "r1" });
    expect(expectKind(nodes[1], "turn").pairs[0]).toMatchObject({ kind: "orphan", result: "r2" });
  });

  test("尾部孤立空 assistant 跳过；system/user 直通", () => {
    const nodes = groupMessages([
      msg({ idx: 0, role: "system", content: "S" }),
      msg({ idx: 1, role: "user", content: "U" }),
      msg({ idx: 2, role: "assistant" }),
    ]);
    expect(nodes.map((n) => n.kind)).toEqual(["system", "user"]);
  });

  test("仅带推理无正文的 assistant 成轮且 msg 为消息", () => {
    const nodes = groupMessages([
      msg({ idx: 0, role: "assistant", reasoning_content: "想想" }),
    ]);
    expect(nodes.map((n) => n.kind)).toEqual(["turn"]);
    expect(expectKind(nodes[0], "turn").msg?.reasoning_content).toBe("想想");
  });
});

describe("callSummary", () => {
  test("exec 取 command 字段", () => {
    expect(callSummary("exec", '{"command":"ls -la && mkdir -p a"}')).toBe("ls -la && mkdir -p a");
  });

  test("write/edit/read 取路径末两段（截掉长前缀目录）", () => {
    expect(callSummary("write", '{"path":"/home/u/.openclaw/workspace/advocacy-console/index.html"}')).toBe(
      "advocacy-console/index.html",
    );
    expect(callSummary("edit", '{"path":"/x/y/app.js","edits":[]}')).toBe("y/app.js");
  });

  test("read 带 offset/limit 时附带区间信息", () => {
    expect(callSummary("read", '{"path":"/x/y/app.js","offset":352,"limit":12}')).toBe("y/app.js · offset 352 · 12 行");
  });

  test("browser 取 url 字段", () => {
    expect(callSummary("browser", '{"url":"https://example.com/a?b=1"}')).toBe("https://example.com/a?b=1");
  });

  test("非 JSON 或缺关键字段时回退为参数首行摘要", () => {
    expect(callSummary("exec", "not json at all")).toBe("not json at all");
    expect(callSummary("weird", '{"foo":1}')).toBe('{"foo":1}');
  });

  test("超长摘要按 firstLine 截断", () => {
    const long = "x".repeat(100);
    expect(callSummary("exec", `{"command":"${long}"}`)).toBe("x".repeat(80) + "…");
  });
});

describe("isFailedResult", () => {
  test("JSON 结果 status=error 判定失败", () => {
    expect(isFailedResult('{"status":"error","tool":"browser","error":"unavailable"}')).toBe(true);
    expect(isFailedResult('{"status":"ok"}')).toBe(false);
  });

  test("文本以 Error/error 或 Traceback 开头判定失败", () => {
    expect(isFailedResult("Error: command failed with exit code 1")).toBe(true);
    expect(isFailedResult("error: something broke")).toBe(true);
    expect(isFailedResult("Traceback (most recent call last):\n  File ...")).toBe(true);
  });

  test("正常输出与成功回执不判定失败", () => {
    expect(isFailedResult("Successfully wrote 2660 bytes to /tmp/a.html")).toBe(false);
    expect(isFailedResult("total 64\ndrwxr-xr-x 1 ma-user ma-group")).toBe(false);
    expect(isFailedResult('{"content":"...","truncated":false}')).toBe(false);
  });
});

test("ToolPair 透出锚点坐标:msgIdx/sub/resultMsgIdx(spec §3)", () => {
  const msgs = [
    { idx: 0, role: "assistant", content: "", reasoning_content: null,
      tool_calls: [{ id: "c1", type: "function",
                     function: { name: "write", arguments: "{\"path\":\"a\"}" } },
                   { id: "c2", type: "function",
                     function: { name: "read", arguments: "{\"path\":\"b\"}" } }],
      tool_call_id: null },
    { idx: 1, role: "tool", content: "r1", reasoning_content: null,
      tool_calls: null, tool_call_id: "c1" },
    // c2 也配上结果,使 idx=3 的 zzz 在顺序兜底无可配调用时落 orphan(若 c2 空悬,zzz 会被兜底配给 c2)
    { idx: 2, role: "tool", content: "r2", reasoning_content: null,
      tool_calls: null, tool_call_id: "c2" },
    { idx: 3, role: "tool", content: "孤儿", reasoning_content: null,
      tool_calls: null, tool_call_id: "zzz" },
    // 流末尾等不到结果的调用:resultMsgIdx 保持 null
    { idx: 4, role: "assistant", content: "", reasoning_content: null,
      tool_calls: [{ id: "c3", type: "function",
                     function: { name: "exec", arguments: "{\"command\":\"ls\"}" } }],
      tool_call_id: null },
  ] as unknown as Msg[];
  const nodes = groupMessages(msgs);
  // idx=0 的 assistant 开第一轮（c1/c2/孤儿归入），idx=4 的 assistant 独立成第二轮
  const turn = expectKind(nodes[0], "turn");
  expect(turn.pairs[0]).toMatchObject({ kind: "call", msgIdx: 0, sub: 0, resultMsgIdx: 1 });
  expect(turn.pairs[1]).toMatchObject({ kind: "call", msgIdx: 0, sub: 1, resultMsgIdx: 2 });
  expect(turn.pairs[2]).toMatchObject({ kind: "orphan", msgIdx: 3 });
  const turn2 = expectKind(nodes[1], "turn");
  expect(turn2.pairs[0]).toMatchObject({ kind: "call", msgIdx: 4, sub: 0, resultMsgIdx: null });
});
