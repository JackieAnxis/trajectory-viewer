import { createRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Annotation, AnnotationStore, Msg, MsgPage, TrajectoryDataSource } from "../types";
import TrajectoryViewer, { type TrajectoryViewerHandle } from "./TrajectoryViewer";

class MockIO {
  static instances: MockIO[] = [];
  private cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) { this.cb = cb; MockIO.instances.push(this); }
  observe(): void {} unobserve(): void {} disconnect(): void {}
  show(): void { this.cb([{ isIntersecting: true } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
}
vi.stubGlobal("IntersectionObserver", MockIO);

// 本仓 vitest 未开 globals，RTL 的自动清理不会注册；显式注册避免用例间串台
afterEach(cleanup);

beforeEach(() => { MockIO.instances.length = 0; vi.clearAllMocks(); });

function m(idx: number, role: string, content: string, extra: Partial<Msg> = {}): Msg {
  return { idx, role, preview: "", content_len: content.length, content, reasoning_len: 0, ...extra };
}
function pageOf(messages: Msg[], from = 0, hasMore = false): MsgPage {
  return { messages, from, returned: messages.length, has_more: hasMore };
}
function dsOf(msgs: Msg[], raw: unknown = {}): TrajectoryDataSource {
  return {
    fetchMessages: vi.fn(async () => pageOf(msgs)),
    fetchRaw: vi.fn(async () => raw),
  };
}
function storeOf(list: Annotation[] = []): AnnotationStore {
  return {
    list: vi.fn(async () => list),
    create: vi.fn(async () => ({})),
    reply: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => undefined),
    setResolved: vi.fn(async () => ({})),
    setLike: vi.fn(async () => ({ likeCount: 1, likedByMe: true })),
  };
}

test("消息流渲染 + 工具栏切换 JSON 视图（默认 JsonHighlight）", async () => {
  const ds = dsOf([m(0, "user", "你好")], { a: 1 });
  render(<TrajectoryViewer dataSource={ds} />);
  await screen.findByText("你好");
  fireEvent.click(screen.getByRole("tab", { name: "JSON" }));
  await waitFor(() => expect(document.querySelector(".tv-json-highlight")).not.toBeNull());
  expect(ds.fetchRaw).toHaveBeenCalledTimes(1);
});

test("renderRaw 自定义渲染器接管 JSON 视图", async () => {
  const ds = dsOf([], { b: 2 });
  render(<TrajectoryViewer dataSource={ds} renderRaw={(r) => <div data-testid="myraw">{JSON.stringify(r)}</div>} />);
  fireEvent.click(screen.getByRole("tab", { name: "JSON" }));
  await screen.findByTestId("myraw");
});

test("dataSource identity 变化 = 换记录：重置并重新拉取", async () => {
  const ds1 = dsOf([m(0, "user", "记录一")]);
  const ds2 = dsOf([m(0, "user", "记录二")]);
  const { rerender } = render(<TrajectoryViewer dataSource={ds1} />);
  await screen.findByText("记录一");
  rerender(<TrajectoryViewer dataSource={ds2} />);
  await screen.findByText("记录二");
  expect(ds2.fetchMessages).toHaveBeenCalled();
});

test("annotationStore 缺省：评论区入口不出现", async () => {
  render(<TrajectoryViewer dataSource={dsOf([m(0, "user", "你好")])} />);
  await screen.findByText("你好");                       // 等到首屏就绪，排除「还没渲染」的假阴性
  expect(screen.queryByLabelText("批注与讨论")).toBeNull();
});

test("annotationStore 在：入口徽标显示未解决数，点击开面板", async () => {
  const a: Annotation = {
    id: 7, msg_idx: 0, region: "content", sub: null, quote: "q", prefix: "", suffix: "",
    author: "alice", body: "楼", resolved: 0, resolved_by: null, resolved_at: null,
    created_at: 1, updated_at: 1, like_count: 0, liked_by_me: false, replies: [],
  };
  render(<TrajectoryViewer dataSource={dsOf([])} annotationStore={storeOf([a])}
                         currentUser={{ name: "bob", isAdmin: true }} />);
  await waitFor(() => expect(document.querySelector(".tv-badge-count")).toHaveTextContent("1"));
  fireEvent.click(screen.getByLabelText("批注与讨论"));
  await screen.findByText("楼");
});

test("toolbar=false 时不渲染工具栏", () => {
  render(<TrajectoryViewer dataSource={dsOf([])} toolbar={false} />);
  expect(screen.queryByRole("tablist")).toBeNull();
});

test("ref.scrollToAnnotation 透传视图跨页定位（无此消息返回 false）", async () => {
  const ref = createRef<TrajectoryViewerHandle>();
  render(<TrajectoryViewer ref={ref} dataSource={dsOf([])} />);
  await waitFor(() => expect(ref.current).not.toBeNull());
  await expect(ref.current!.scrollToAnnotation(99, 1)).resolves.toBe(false);
});

// ---- 换记录复位本地态（承 Task 11 评审 Major-3） ----

// jsdom 24 的 Range 未实现 getBoundingClientRect：补零值实现，仅供浮层定位取值（坐标不进断言）
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = function (): DOMRect {
    return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0,
             toJSON: () => ({}) } as DOMRect;
  };
}

/** 在元素拼接文本的第 start/end 个字符处构造选区（jsdom 真实 Selection）。
    按 TreeWalker 逐节点换算全局偏移：区块含 mark 切分后的文本节点仍定位准确。 */
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

// 承 Task 11 评审 Major-3：MessageStreamView 的 props 无记录标识，无法自行感知换记录；
// 组合层经 recordKey 强制 remount，使未提交的划线浮层随旧实例一起销毁。
test("换记录（dataSource identity 变化）：消息视图 remount，未提交的划线浮层归零", async () => {
  const ds1 = dsOf([m(0, "user", "abcdefgh")]);
  const ds2 = dsOf([m(0, "user", "记录二")]);
  // annotationStore 必须传：否则视图 annotateOn 条件不成立，mouseup 不会浮出「评注」按钮
  const { container, rerender } = render(
    <TrajectoryViewer dataSource={ds1} annotationStore={storeOf([])} />,
  );
  await screen.findByText("abcdefgh");
  const block = container.querySelector('[data-msg-idx="0"][data-region="content"]')!;
  selectRange(block, 2, 5);                            // 选中「cde」
  // 组合层下 container.firstChild 是 tv-root（MessageStreamView 的祖先），
  // 须从区块内冒泡到视图根的 mouseUp 处理器
  fireEvent.mouseUp(block);
  await screen.findByRole("button", { name: /评注/ });  // 浮层已出现

  rerender(<TrajectoryViewer dataSource={ds2} annotationStore={storeOf([])} />);
  await screen.findByText("记录二");
  // 承重断言：没有 key={recordKey} 时，浮层会带着旧记录的锚点五元组存活下来
  expect(screen.queryByRole("button", { name: /评注/ })).toBeNull();
});
