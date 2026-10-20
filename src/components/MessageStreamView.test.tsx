import { createRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import MessageStreamView from "./MessageStreamView";
import type {
  FoldAction, MessageStreamViewHandle, MessageStreamViewProps,
} from "./MessageStreamView";
import { NotifyProvider } from "../ui/notify";
import type { Annotation, Msg } from "../types";

// 本仓 vitest 未开 globals，RTL 的自动清理不会注册；本文件 render 次数全库最多，显式注册避免串台
afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
});

/** 构造测试消息：必填字段给默认值 */
function m(idx: number, role: string, content: string, extra: Partial<Msg> = {}): Msg {
  return { idx, role, preview: "", content_len: content.length, content, reasoning_len: 0, ...extra };
}

/** 视图默认 props：纯渲染核心不取数，msgs/raw/分页游标一律由组合层注入 */
function viewProps(over: Partial<MessageStreamViewProps> = {}): MessageStreamViewProps {
  return {
    mode: "parsed",
    msgs: [],
    msgError: null,
    onRetryMessages: () => {},
    loadMore: async () => false,
    loadedRef: { current: 0 },
    sentinelRef: { current: null },
    raw: null,
    rawError: null,
    deliveryOpen: false,
    onToggleDelivery: () => {},
    annotations: null,
    onMarkClick: () => {},
    onAnchorsReconciled: () => {},
    ...over,
  };
}

function renderView(over: Partial<MessageStreamViewProps> = {}) {
  return render(<MessageStreamView {...viewProps(over)} />);
}

/** 渲染并返回 handle：供「一键展开/关闭」与跨页定位命令用例调用 */
function renderViewWithHandle(
  over: Partial<MessageStreamViewProps> = {},
  onActionChange?: (a: FoldAction) => void,
) {
  const ref = createRef<MessageStreamViewHandle>();
  const utils = render(
    <MessageStreamView {...viewProps(over)} ref={ref} onActionChange={onActionChange} />,
  );
  return { ref, ...utils };
}

test("user 气泡展示剥离 Sender 头与时间戳后的干净文本", () => {
  const { container } = renderView({
    msgs: [m(0, "user", 'Sender (untrusted metadata):\n{"label":"cli","id":"cli"}\n\n[2026-08-24 15:04:05 GMT+8] + 帮我写一个贪吃蛇游戏')],
  });
  expect(container.querySelector(".tv-chat-bubble")).not.toBeNull();
  expect(container.querySelector(".tv-chat-bubble")?.textContent).toBe("帮我写一个贪吃蛇游戏");
  expect(container.querySelector(".tv-chat-user")).not.toBeNull();
});

test("system 渲染为默认收起的「系统提示」卡片，点击展开", () => {
  const { container } = renderView({ msgs: [m(0, "system", "长系统提示")] });
  const card = container.querySelector(".tv-chat-syscard") as HTMLDetailsElement;
  expect(card).not.toBeNull();
  expect(card).not.toHaveAttribute("open");
  fireEvent.click(card.querySelector("summary")!);
  expect(card).toHaveAttribute("open");
});

test("system 卡片带 label 时 summary 展示自定义标签替换默认文案", () => {
  const { container } = renderView({
    msgs: [m(0, "system", "思考文本", { label: "模型思考（166 字）" })],
  });
  const card = container.querySelector(".tv-chat-syscard") as HTMLDetailsElement;
  expect(card).not.toBeNull();
  expect(card.querySelector("summary")?.textContent).toContain("模型思考（166 字）");
  expect(card.querySelector("summary")?.textContent).not.toContain("系统提示");
});

test("user 气泡按 Markdown 渲染", () => {
  const { container } = renderView({
    msgs: [m(0, "user", "帮我做一个**贪吃蛇**\n\n- 计分板\n- 加速键")],
  });
  expect(container.querySelector(".tv-chat-bubble .tv-markdown")).not.toBeNull();
  expect(container.querySelector(".tv-chat-bubble strong")?.textContent).toBe("贪吃蛇");
  expect(container.querySelectorAll(".tv-chat-bubble li")).toHaveLength(2);
});

test("tool 结果渲染为 orphan 配对卡，摘要合并多行为单行", () => {
  const { container } = renderView({
    msgs: [m(0, "assistant", ""), m(1, "tool", "Successfully wrote 12939 bytes to /tmp/t.html\nsecond line")],
  });
  expect(container.querySelector(".tv-chat-pairrow")).not.toBeNull();
  // 空占位不产生正文节点
  expect(container.querySelector(".tv-chat-content")).toBeNull();
  const row = container.querySelector(".tv-chat-pairrow") as HTMLDetailsElement;
  expect(row).not.toHaveAttribute("open");
  expect(row.classList.contains("is-orphan")).toBe(true);
  // 摘要合并多行为单行（firstLine 新语义）
  expect(row.querySelector(".tv-pair-result-sum")?.textContent).toBe("Successfully wrote 12939 bytes to /tmp/t.html second line");
  fireEvent.click(row.querySelector("summary")!);
  expect(row).toHaveAttribute("open");
});

test("tool_calls 与结果配对渲染：summary 一行讲完调用与结果，展开为参数/结果两节", () => {
  const { container } = renderView({
    msgs: [
      m(0, "assistant", "", {
        tool_calls: [{ id: "c1", type: "function", function: { name: "write", arguments: '{"path":"/home/u/proj/index.html"}' } }],
      }),
      m(1, "tool", "ok", { tool_call_id: "c1" }),
    ],
  });
  const row = container.querySelector(".tv-chat-pairrow") as HTMLDetailsElement;
  expect(row).not.toBeNull();
  expect(row.classList.contains("is-orphan")).toBe(false);
  // summary：工具名 chip + 调用摘要（路径末两段）+ 结果摘要
  expect(row.querySelector(".tv-pair-name")?.textContent).toBe("write");
  expect(row.querySelector(".tv-pair-args")?.textContent).toBe("proj/index.html");
  expect(row.querySelector(".tv-pair-result-sum")?.textContent).toBe("ok");
  // 展开：调用参数 / 返回结果 两节
  fireEvent.click(row.querySelector("summary")!);
  const labels = [...row.querySelectorAll(".tv-pair-sec-label")].map((el) => el.textContent);
  expect(labels).toEqual(["调用参数", "返回结果"]);
});

test("摘要字段 title 悬浮展示完整文本（ellipsis 可全文查看）", () => {
  const { container } = renderView({
    msgs: [
      m(0, "assistant", "", {
        tool_calls: [{ id: "c1", type: "function", function: { name: "write", arguments: '{"path":"/home/u/proj/index.html"}' } }],
      }),
      m(1, "tool", "ok", { tool_call_id: "c1" }),
    ],
  });
  // 调用摘要 / 结果摘要按宽度截断时，悬浮 title 可见完整摘要文本
  expect(container.querySelector(".tv-pair-args")?.getAttribute("title")).toBe("proj/index.html");
  expect(container.querySelector(".tv-pair-result-sum")?.getAttribute("title")).toBe("ok");
});

test("失败结果渲染红色徽标与失败节标记", () => {
  const { container } = renderView({
    msgs: [
      m(0, "assistant", "", {
        tool_calls: [{ id: "c1", type: "function", function: { name: "exec", arguments: '{"command":"node -v"}' } }],
      }),
      m(1, "tool", "Error: command failed", { tool_call_id: "c1" }),
    ],
  });
  const row = container.querySelector(".tv-chat-pairrow") as HTMLDetailsElement;
  expect(row).not.toBeNull();
  expect(row.classList.contains("is-fail")).toBe(true);
  expect(row.querySelector(".tv-pair-fail")?.textContent).toContain("失败");
  fireEvent.click(row.querySelector("summary")!);
  expect(row.querySelector(".tv-pair-sec.sec-fail .tv-pair-sec-label")?.textContent).toContain("失败");
});

test("tool 结果纯文本正文保留换行渲染为 pre，JSON 走高亮", () => {
  const { container } = renderView({
    msgs: [m(0, "tool", "JS OK\n200"), m(1, "tool", '{"ok":true}')],
  });
  const rows = container.querySelectorAll(".tv-chat-pairrow");
  expect(rows.length).toBe(2);
  // 展开两条
  rows.forEach((r) => fireEvent.click(r.querySelector("summary")!));
  // 纯文本 tool 结果：pre 保留换行（含 \n），不用 Markdown
  const pre = rows[0].querySelector(".tv-pair-body pre");
  expect(pre).not.toBeNull();
  expect(pre?.textContent).toBe("JS OK\n200");
  expect(rows[0].querySelector(".tv-pair-body .tv-markdown")).toBeNull();
  // JSON 结果：语法高亮
  expect(rows[1].querySelector(".tv-pair-body pre.tv-json-highlight")).not.toBeNull();
});

test("JSON 工具结果展开后语法高亮", () => {
  const { container } = renderView({ msgs: [m(0, "tool", '{"ok":true}')] });
  fireEvent.click(container.querySelector(".tv-chat-pairrow summary")!);
  expect(container.querySelector(".tv-chat-pairrow pre span")).not.toBeNull();
  expect(screen.getByText('"ok"')).toBeInTheDocument();
  expect(screen.getByText("true")).toBeInTheDocument();
});

test("连续 tool 合并为一轮多卡；非空 assistant 正文打断成新轮", () => {
  const { container } = renderView({
    msgs: [
      m(0, "assistant", ""),
      m(1, "tool", "r1"),
      m(2, "assistant", ""),
      m(3, "tool", "r2"),
      m(4, "assistant", "正文"),
      m(5, "tool", "r3"),
    ],
  });
  expect(container.querySelectorAll(".tv-chat-toolgroup").length).toBe(2);
  expect(container.querySelectorAll(".tv-chat-pairrow").length).toBe(3);
  // 两个机器人轮（工具轮 + 正文轮），每轮一个头像
  expect(container.querySelectorAll(".tv-chat-turn").length).toBe(2);
});

test("每轮一个机器人头像：工具卡不再有独立工具头像", () => {
  const { container } = renderView({
    msgs: [
      m(0, "assistant", "", {
        tool_calls: [
          { id: "c1", type: "function", function: { name: "exec", arguments: '{"command":"ls"}' } },
          { id: "c2", type: "function", function: { name: "write", arguments: '{"path":"/a/b.html"}' } },
        ],
      }),
      m(1, "tool", "r1", { tool_call_id: "c1" }),
      m(2, "tool", "r2", { tool_call_id: "c2" }),
    ],
  });
  expect(container.querySelectorAll(".tv-chat-pairrow").length).toBe(2);
  // 一轮一个机器人头像：仅工具轮也只有一个 robot 头像，两张工具卡共用
  expect(container.querySelectorAll(".tv-chat-turn").length).toBe(1);
  expect(container.querySelectorAll(".tv-chat-avatar").length).toBe(1);
  expect(container.querySelector(".tv-chat-avatar svg")?.getAttribute("data-icon")).toBe("robot");
  // 工具卡所在行不再包裹独立头像行
  expect(container.querySelector(".tv-chat-pairrow")?.closest(".tv-chat-assistant")).toBeNull();
  // summary 行不再重复小图标
  expect(container.querySelector(".tv-chat-pairrow")?.querySelector(".tv-pair-icon")).toBeNull();
});

test("weight 置零标记：仅 weight=0 显示 icon 徽标，悬浮提示文案", () => {
  const { container } = renderView({
    msgs: [
      m(0, "assistant", "正文", { weight: 0 }),
      m(1, "assistant", "", {
        weight: 1,
        tool_calls: [{ id: "c1", type: "function", function: { name: "exec", arguments: '{"command":"ls"}' } }],
      }),
      m(2, "tool", "r1", { tool_call_id: "c1" }),
      m(3, "assistant", "无weight"),
    ],
  });
  expect(container.querySelectorAll(".tv-chat-pairrow").length).toBe(1);
  // weight=0：正文头像显示置零 icon 徽标（eye-slash 遮眼）
  const zero = container.querySelector(".tv-avatar-zero");
  expect(zero?.querySelector("svg")?.getAttribute("data-icon")).toBe("eye-slash");
  // 徽标悬浮提示「此处权重已置零」经 CSS-only 的 data-tip 承载
  expect(container.querySelector(".tv-avatar-zero")).not.toBeNull();
  expect(container.querySelector(".tv-avatar-zero")?.closest(".tv-tip")?.getAttribute("data-tip")).toBe("此处权重已置零");
  // weight=1：工具轮所在行不渲染任何 weight 标记
  const pairRow = container.querySelector(".tv-chat-pairrow")?.closest(".tv-chat-turn");
  expect(pairRow?.querySelector(".tv-avatar-zero")).toBeNull();
  // 无 weight 的消息也不渲染
  const rows = [...container.querySelectorAll(".tv-chat-turn")];
  const last = rows[rows.length - 1];
  expect(last.querySelector(".tv-avatar-zero")).toBeNull();
});

test("assistant 推理渲染为默认收起的「思考过程」卡片，正文带头像无气泡", () => {
  const { container } = renderView({
    msgs: [m(0, "assistant", "好的", { reasoning_content: "我先想想逻辑", reasoning_len: 6 })],
  });
  const think = container.querySelector(".tv-chat-thinkcard") as HTMLDetailsElement;
  expect(think).not.toBeNull();
  expect(think).not.toHaveAttribute("open");
  expect(screen.getByText("思考过程")).toBeInTheDocument();
  expect(container.querySelector(".tv-chat-avatar")).not.toBeNull();
  expect(container.querySelector(".tv-chat-content")?.textContent).toContain("好的");
});

test("尾部孤立空 assistant 不渲染任何节点", () => {
  const { container } = renderView({ msgs: [m(0, "user", "hi"), m(1, "assistant", "   ")] });
  expect(container.querySelector(".tv-chat-bubble")).not.toBeNull();
  expect(container.querySelector(".tv-chat-turn")).toBeNull();
});

test("原数据默认渲染为内置 JSON 高亮", () => {
  const { container } = renderView({ mode: "raw", raw: { a: 1 } });
  const hl = container.querySelector(".tv-json-highlight");
  expect(hl).not.toBeNull();
  expect(hl?.textContent).toContain('"a"');
});

test("renderRaw 插槽接管原数据渲染", () => {
  renderView({
    mode: "raw",
    raw: { a: 1 },
    renderRaw: (r) => <div data-testid="myraw">{JSON.stringify(r)}</div>,
  });
  expect(screen.getByTestId("myraw").textContent).toBe('{"a":1}');
});

test("delivery 非空时消息流末尾渲染产物卡片区（单文件也显示「全部文件」卡片）", () => {
  const { container } = renderView({ msgs: [m(0, "user", "hi")], delivery: ["./d/a.html"] });
  expect(container.querySelector(".tv-delivery-cards")).not.toBeNull();
  expect(screen.getByText("全部文件")).toBeInTheDocument();
  expect(screen.getByText(/1 个文件/)).toBeInTheDocument();
});

test("delivery 为空时不渲染产物区", () => {
  const { container } = renderView({ msgs: [m(0, "user", "hi")] });
  expect(container.querySelector(".tv-chat-bubble")).not.toBeNull();
  expect(container.querySelector(".tv-delivery-cards")).toBeNull();
});

// ---- 一键展开/关闭所有消息块（header 批量命令，经 ref 调用） ----

test("toggleAllCards 首击全展开、再击全收起，返回「下次点击动作」", () => {
  const { ref, container } = renderViewWithHandle({
    msgs: [
      m(0, "system", "SYS"),
      m(1, "user", "hi"),
      m(2, "assistant", "好", { reasoning_content: "想想", reasoning_len: 2 }),
    ],
  });
  const cards = container.querySelectorAll(".tv-chat-stream details");
  expect(cards.length).toBe(2);
  cards.forEach((c) => expect(c).not.toHaveAttribute("open"));

  // 还有收起的 → 执行全展开并返回本次动作
  expect(ref.current?.toggleAllCards()).toBe("expand");
  cards.forEach((c) => expect(c).toHaveAttribute("open"));

  // 已全开 → 执行全收起并返回本次动作
  expect(ref.current?.toggleAllCards()).toBe("collapse");
  cards.forEach((c) => expect(c).not.toHaveAttribute("open"));
});

test("单卡手动展开后，批量命令按实际 DOM 状态推导：仍有收起则先全展开", () => {
  const { ref, container } = renderViewWithHandle({
    msgs: [m(0, "system", "SYS"), m(1, "tool", "t1"), m(2, "user", "hi")],
  });
  const [sys, tool] = container.querySelectorAll(".tv-chat-stream details");
  // 手动展开系统卡
  fireEvent.click(sys.querySelector("summary")!);
  expect(sys).toHaveAttribute("open");
  expect(tool).not.toHaveAttribute("open");

  // 推导方向：仍有收起卡（tool）→ 执行全展开
  expect(ref.current?.toggleAllCards()).toBe("expand");
  expect(sys).toHaveAttribute("open");
  expect(tool).toHaveAttribute("open");
  // 再击全收起（手动状态也被批量覆盖）
  expect(ref.current?.toggleAllCards()).toBe("collapse");
  expect(sys).not.toHaveAttribute("open");
});

test("加载完成后上报当前动作：全收起流报展开、追加含折叠卡的消息后再次上报", async () => {
  const onActionChange = vi.fn();
  const first = [m(0, "system", "S"), m(1, "user", "hi")];
  const { ref, rerender } = renderViewWithHandle({ msgs: first }, onActionChange);
  // 初始全收起 → 上报 expand（可能多次，末次须为 expand）
  expect(onActionChange).toHaveBeenLastCalledWith("expand");
  const before = onActionChange.mock.calls.length;

  // 先批量全展开（直改 DOM 的 <details open>），再追加含思考卡的消息：
  // 新卡默认收起 → scanAction 重新扫描得到 expand，末次上报是「变化后」的结果而非与之前同值
  expect(ref.current?.toggleAllCards()).toBe("expand");
  rerender(
    <MessageStreamView
      {...viewProps({ msgs: [...first, m(2, "assistant", "好", { reasoning_content: "想想", reasoning_len: 2 })] })}
      ref={ref}
      onActionChange={onActionChange}
    />,
  );
  await waitFor(() => expect(onActionChange.mock.calls.length).toBeGreaterThan(before));
  expect(onActionChange).toHaveBeenLastCalledWith("expand");
});

test("raw 视图无内置折叠块：toggleAllCards 返回 null 且不上报动作", () => {
  const onActionChange = vi.fn();
  const msgs = [m(0, "system", "S"), m(1, "user", "hi")];
  const { ref, rerender } = renderViewWithHandle({ msgs }, onActionChange);
  expect(onActionChange).toHaveBeenLastCalledWith("expand");
  const before = onActionChange.mock.calls.length;

  rerender(
    <MessageStreamView
      {...viewProps({ mode: "raw", msgs, raw: { a: 1 } })}
      ref={ref}
      onActionChange={onActionChange}
    />,
  );
  // raw 视图的折叠命令由自定义渲染器自理，视图不返回方向也不上报
  expect(ref.current?.toggleAllCards()).toBeNull();
  expect(onActionChange.mock.calls.length).toBe(before);
});

test("六类区块带批注定位属性 data-msg-idx/data-region(/data-sub)", () => {
  const { container } = renderView({
    msgs: [
      m(0, "system", "系统提示文本"),
      m(1, "user", "用户问题文本"),
      m(2, "assistant", "助手正文文本", {
        reasoning_content: "思考过程文本",
        tool_calls: [
          { id: "c1", type: "function",
            function: { name: "write", arguments: "{\"path\":\"a.html\"}" } },
          { id: "c2", type: "function",
            function: { name: "read", arguments: "{\"path\":\"b.html\"}" } },
        ],
      }),
      m(3, "tool", "结果文本一", { tool_call_id: "c1" }),
      m(4, "tool", "结果文本二", { tool_call_id: "c2" }),
    ],
  });
  const q = (sel: string) => container.querySelector(sel);
  expect(q('[data-msg-idx="0"][data-region="content"]')).not.toBeNull();   // 系统卡 body
  expect(q('[data-msg-idx="1"][data-region="content"]')).not.toBeNull();   // user 气泡
  expect(q('[data-msg-idx="2"][data-region="reasoning"]')).not.toBeNull(); // 思考卡 body
  expect(q('[data-msg-idx="2"][data-region="content"]')).not.toBeNull();   // 助手正文
  expect(q('[data-msg-idx="2"][data-region="args"][data-sub="0"]')).not.toBeNull();
  expect(q('[data-msg-idx="2"][data-region="args"][data-sub="1"]')).not.toBeNull();
  expect(q('[data-msg-idx="3"][data-region="content"]')).not.toBeNull();   // 工具结果一
  expect(q('[data-msg-idx="4"][data-region="content"]')).not.toBeNull();   // 工具结果二
});

// ---- 批注划线与高亮(spec §6.2/§3) ----

// jsdom 24 的 Range 未实现 getBoundingClientRect:补零值实现,仅供浮层定位取值(坐标不进断言)
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = function (): DOMRect {
    return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0,
             toJSON: () => ({}) } as DOMRect;
  };
}

/** 批注测试楼构造(缺省字段与 store view 形态对齐) */
function mkAnn(over: Partial<Annotation>): Annotation {
  return { id: 9, msg_idx: 1, region: "content", sub: null, quote: "cde", prefix: "ab", suffix: "fgh",
           author: "bob", body: "问", resolved: 0, resolved_by: null, resolved_at: null,
           created_at: 1, updated_at: 1, like_count: 0, liked_by_me: false,
           replies: [], ...over };
}

/** 在元素拼接文本的第 start/end 个字符处构造选区(jsdom 真实 Selection)。
    按 TreeWalker 逐节点换算全局偏移:区块含 mark 切分后的文本节点仍定位准确
    (单节点场景与「首个文本节点 setStart/setEnd」等价)。 */
function selectRange(block: Element, start: number, end: number) {
  const locate = (global: number): { node: Text; offset: number } => {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let base = 0;
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const t = n as Text;
      if (global <= base + t.data.length) return { node: t, offset: global - base };
      base += t.data.length;
    }
    throw new Error(`选区偏移 ${global} 超出区块文本长度 ${base}`);
  };
  const s = locate(start);
  const e = locate(end);
  const range = document.createRange();
  range.setStart(s.node, s.offset);
  range.setEnd(e.node, e.offset);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

test("划线:mouseup 提取选区浮出「评注」,建楼回调携带五元组", async () => {
  const onCreate = vi.fn().mockResolvedValue(true);
  const { container } = renderView({
    msgs: [m(1, "user", "abcdefgh")], annotations: [], onCreateAnnotation: onCreate,
  });
  const block = container.querySelector('[data-msg-idx="1"][data-region="content"]')!;
  selectRange(block, 2, 5);                          // 选中「cde」
  fireEvent.mouseUp(container.firstChild as Element);
  fireEvent.click(await screen.findByRole("button", { name: /评注/ }));
  fireEvent.change(screen.getByPlaceholderText("写下你的评注…"), { target: { value: "疑问" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledWith(
    { msg_idx: 1, region: "content", sub: null, quote: "cde", prefix: "ab", suffix: "fgh" },
    "疑问",
  ));
});

test("与既有高亮相交的选区提示「该段已有评注」,不浮建楼按钮", async () => {
  const onNotify = vi.fn();
  const { container } = render(
    <NotifyProvider onNotify={onNotify}>
      {/* 划线激活前提是 onCreateAnnotation 非空(视图 annotateOn 条件),须传入才会走到重叠检测 */}
      <MessageStreamView {...viewProps({
        msgs: [m(1, "user", "abcdefgh")],
        annotations: [mkAnn({})],
        onCreateAnnotation: vi.fn().mockResolvedValue(true),
      })} />
    </NotifyProvider>,
  );
  expect(container.querySelector('mark.tv-anno-mark[data-anno-id="9"]')).not.toBeNull();
  const block = container.querySelector('[data-msg-idx="1"][data-region="content"]')!;
  selectRange(block, 1, 6);                          // 「bcdef」与 mark「cde」相交
  fireEvent.mouseUp(container.firstChild as Element);
  await waitFor(() => expect(onNotify).toHaveBeenCalledWith("warning", "该段已有评注"));
  expect(screen.queryByRole("button", { name: /评注/ })).not.toBeInTheDocument();
});

test("连续划线换锚点:浮层按锚点 key remount,编辑态与旧草稿归零", async () => {
  const { container } = renderView({
    msgs: [m(1, "user", "abcdefgh")],
    annotations: [],
    onCreateAnnotation: vi.fn().mockResolvedValue(true),
  });
  const block = container.querySelector('[data-msg-idx="1"][data-region="content"]')!;
  // 第一段划线:展开输入态并写草稿(不发送)
  selectRange(block, 2, 5);
  fireEvent.mouseUp(container.firstChild as Element);
  fireEvent.click(await screen.findByRole("button", { name: /评注/ }));
  fireEvent.change(screen.getByPlaceholderText("写下你的评注…"), { target: { value: "旧草稿" } });
  expect((screen.getByPlaceholderText("写下你的评注…") as HTMLTextAreaElement).value).toBe("旧草稿");
  // 换一段重新划线:锚点五元组变化 → key 变化强制 remount,编辑态与草稿归零(浮层仍在)
  selectRange(block, 4, 7);
  fireEvent.mouseUp(container.firstChild as Element);
  await waitFor(() => expect(screen.getByRole("button", { name: /评注/ })).toBeInTheDocument());
  expect(screen.queryByPlaceholderText("写下你的评注…")).toBeNull();
});

test("高亮落 DOM;quote 找不到 → onAnchorsReconciled 上报失效楼", () => {
  const onReconciled = vi.fn();
  const msgs = [m(1, "user", "abcdefgh")];
  const { container, rerender } = renderView({
    msgs, annotations: [mkAnn({})], onAnchorsReconciled: onReconciled,
  });
  expect(container.querySelector('mark.tv-anno-mark[data-anno-id="9"]')).not.toBeNull();
  expect(onReconciled).toHaveBeenCalledWith([]);
  // 同实例换 annotations:quote 失效 → mark 消失 + 上报
  rerender(
    <MessageStreamView {...viewProps({
      msgs, annotations: [mkAnn({ quote: "不存在" })], onAnchorsReconciled: onReconciled,
    })} />,
  );
  expect(onReconciled).toHaveBeenCalledWith([9]);
  expect(container.querySelector('mark.tv-anno-mark[data-anno-id="9"]')).toBeNull();
});

test("点击高亮 mark 触发 onMarkClick 代理：annoId 由 data-anno-id 转为数字", () => {
  const onMarkClick = vi.fn();
  const { container } = renderView({
    msgs: [m(1, "user", "abcdefgh")], annotations: [mkAnn({})], onMarkClick,
  });
  const mark = container.querySelector('mark.tv-anno-mark[data-anno-id="9"]');
  expect(mark).not.toBeNull();
  fireEvent.click(mark!);
  // dataset 取到的是字符串，代理须转成数字再交组合层（Number() 转换的承重点）
  expect(onMarkClick).toHaveBeenCalledWith(9);

  // 点击同一容器内的非 mark 元素（区块本身）不应触发代理
  const calls = onMarkClick.mock.calls.length;
  fireEvent.click(container.querySelector('[data-msg-idx="1"][data-region="content"]')!);
  expect(onMarkClick.mock.calls.length).toBe(calls);
});

test("scrollToAnnotation 跨页续拉并定位闪烁", async () => {
  Element.prototype.scrollIntoView = vi.fn();        // jsdom 未实现
  const ann = mkAnn({ id: 7, msg_idx: 1, quote: "xyz", prefix: "目标段落 ", suffix: "" });
  const loadedRef = { current: 1 };
  const loadMore = vi.fn(async () => true);
  const ref = createRef<MessageStreamViewHandle>();
  const { container, rerender } = render(
    <MessageStreamView {...viewProps({ msgs: [m(0, "user", "第一页")], annotations: [ann], loadedRef, loadMore })} ref={ref} />,
  );
  expect(screen.getByText("第一页")).toBeInTheDocument();
  // 续拉成功：推进游标并追加第二页（真实场景由数据 hook 完成，视图只消费注入的 props）
  loadMore.mockImplementation(async () => {
    loadedRef.current = 2;
    rerender(
      <MessageStreamView
        {...viewProps({ msgs: [m(0, "user", "第一页"), m(1, "user", "目标段落 xyz")], annotations: [ann], loadedRef, loadMore })}
        ref={ref}
      />,
    );
    return true;
  });

  const ok = await ref.current!.scrollToAnnotation(1, 7);
  expect(ok).toBe(true);
  expect(loadMore).toHaveBeenCalledTimes(1);        // 自动续拉第二页
  await waitFor(() => {
    const el = container.querySelector('mark.tv-anno-mark[data-anno-id="7"]');
    expect(el).not.toBeNull();
    expect(el!.classList.contains("tv-anno-flash")).toBe(true);
  });
});

test("切 raw 再切回 parsed:子树重建后高亮经 effect 重跑恢复", () => {
  const anns = [mkAnn({})];                          // 稳定引用:父级真实场景为 state,不随渲染重建
  const msgs = [m(1, "user", "abcdefgh")];
  const { container, rerender } = renderView({ msgs, annotations: anns });
  expect(container.querySelector('mark.tv-anno-mark[data-anno-id="9"]')).not.toBeNull();
  // 切 raw:parsed 子树卸载,命令式插入的 mark 随之消失
  rerender(
    <MessageStreamView {...viewProps({ msgs, annotations: anns, mode: "raw", raw: { v: 1 } })} />,
  );
  expect(container.querySelector("mark.tv-anno-mark")).toBeNull();
  // 切回 parsed:子树重建而 msgs/annotations 未变,高亮 effect 须因 mode 变化重跑
  rerender(<MessageStreamView {...viewProps({ msgs, annotations: anns })} />);
  expect(container.querySelector('mark.tv-anno-mark[data-anno-id="9"]')).not.toBeNull();
});

test("定位闪烁不被 effect 重跑打断:200ms 后 flash 仍在,动画完整播放", async () => {
  Element.prototype.scrollIntoView = vi.fn();
  const ann = mkAnn({ id: 7, msg_idx: 0 });
  // 目标消息已在已加载页内（游标 1 > msg_idx 0），无需续拉
  const { ref, container } = renderViewWithHandle({
    msgs: [m(0, "user", "abcdefgh")], annotations: [ann], loadedRef: { current: 1 },
  });
  expect(container.querySelector('mark.tv-anno-mark[data-anno-id="7"]')).not.toBeNull();
  await ref.current!.scrollToAnnotation(0, 7);
  // 采样点 1:定位后 flash 出现
  await waitFor(() =>
    expect(container.querySelector('mark.tv-anno-mark[data-anno-id="7"]')!
      .classList.contains("tv-anno-flash")).toBe(true));
  // 采样点 2:200ms 后同一 flash 仍在(pendingLocate 清空只重触发定位 effect 随即早退,
  // 不会重跑高亮重包、不会替换带 flash 的 mark,动画得以完整播放 1.6s)
  await new Promise((r) => setTimeout(r, 200));
  expect(container.querySelector('mark.tv-anno-mark[data-anno-id="7"]')!
    .classList.contains("tv-anno-flash")).toBe(true);
});

// ---- 错误分支（数据 hook 只覆盖取数，DOM 呈现是视图职责） ----

test("消息加载失败显示错误提示，点击重试回调宿主", () => {
  const onRetryMessages = vi.fn();
  const { container } = renderView({ msgError: "消息加载失败: boom", onRetryMessages });
  expect(container.querySelector(".tv-msg-error")).not.toBeNull();
  expect(screen.getByText(/消息加载失败/)).toBeInTheDocument();
  expect(screen.getByText(/boom/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "点击重试" }));
  expect(onRetryMessages).toHaveBeenCalledTimes(1);
});

test("续拉失败时错误块与已加载消息共存，点击重试回调宿主", () => {
  // 与首屏失败的区别：续拉失败时首页消息已在流内，错误块须与之共存而非替换整屏
  const onRetryMessages = vi.fn();
  const { container } = renderView({
    msgs: [m(0, "user", "第一页消息")],
    msgError: "加载更多失败: 网络错误",
    onRetryMessages,
  });
  expect(container.querySelector(".tv-msg-error")).not.toBeNull();
  expect(screen.getByText(/加载更多失败/)).toBeInTheDocument();
  expect(screen.getByText(/网络错误/)).toBeInTheDocument();
  expect(screen.getByText("第一页消息")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "点击重试" }));
  expect(onRetryMessages).toHaveBeenCalledTimes(1);
});

test("原数据加载失败显示错误文案", () => {
  renderView({ mode: "raw", rawError: "boom" });
  expect(screen.getByText("原数据加载失败: boom")).toBeInTheDocument();
});
