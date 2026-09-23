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
/** 评论存储桩：默认实现全成功；over 覆盖单个方法（失败路径用例用） */
function storeOf(list: Annotation[] = [], over: Partial<AnnotationStore> = {}): AnnotationStore {
  const store: AnnotationStore = {
    list: vi.fn(async () => list),
    create: vi.fn(async () => ({})),
    reply: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => undefined),
    setResolved: vi.fn(async () => ({})),
    setLike: vi.fn(async () => ({ likeCount: 1, likedByMe: true })),
  };
  return Object.assign(store, over);
}

/** 批注楼桩：缺省字段与 store 形态对齐 */
function mkAnn(over: Partial<Annotation> = {}): Annotation {
  return {
    id: 7, msg_idx: 0, region: "content", sub: null, quote: "你好", prefix: "", suffix: "",
    author: "alice", body: "楼", resolved: 0, resolved_by: null, resolved_at: null,
    created_at: 1, updated_at: 1, like_count: 0, liked_by_me: false, replies: [], ...over,
  };
}

/** 取 mock 的调用次数：接口类型不暴露 vi.fn 的 mock 字段，断言时统一经此换算 */
function callsOf(fn: unknown): number {
  return (fn as { mock: { calls: unknown[] } }).mock.calls.length;
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
  render(<TrajectoryViewer dataSource={dsOf([])} annotationStore={storeOf([mkAnn()])}
                         currentUser={{ name: "bob", isAdmin: true }} />);
  await waitFor(() => expect(document.querySelector(".tv-badge-count")).toHaveTextContent("1"));
  fireEvent.click(screen.getByLabelText("批注与讨论"));
  await screen.findByText("楼");
  // Minor-1：可见提示文案（TvTooltip 的 data-tip，不参与 accessible name）也一并锁住
  expect(document.querySelector(".tv-anno-panel-trigger")!.closest(".tv-tip")!
    .getAttribute("data-tip")).toBe("批注与讨论");
});

test("toolbar=false 时不渲染工具栏", () => {
  render(<TrajectoryViewer dataSource={dsOf([])} toolbar={false} />);
  expect(screen.queryByRole("tablist")).toBeNull();
});

test("ref.scrollToAnnotation 透传视图跨页定位（命中 true / 无此消息 false）", async () => {
  const ref = createRef<TrajectoryViewerHandle>();
  const { rerender } = render(<TrajectoryViewer ref={ref} dataSource={dsOf([m(0, "user", "你好")])} />);
  await screen.findByText("你好");
  const handle = ref.current;                          // 捕获句柄：若透传被换成恒 false 的桩，下面必红
  await expect(handle!.scrollToAnnotation(0, 1)).resolves.toBe(true);   // 正向：msgIdx 0 已加载

  // 反向：dsOf 的 has_more 恒 false，续拉即止 → 全量加载后仍无此消息
  rerender(<TrajectoryViewer ref={ref} dataSource={dsOf([])} />);
  await expect(ref.current!.scrollToAnnotation(99, 1)).resolves.toBe(false);
  // 空依赖数组的 useImperativeHandle：句柄对象跨换记录保持同一 identity（附页 §4.3 第 2 条）
  expect(ref.current).toBe(handle);
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

// ---- 修复轮 R=1 补齐的覆盖缺口（评审 Major-1 ~ Major-4 / Minor-1 ~ Minor-2） ----

// Major-1：双面板互斥。DeliveryDrawer 与 AnnotationPanel 都是「常驻 DOM + open class」，
// 故以 open class 与触发按钮的 aria-expanded 双路断言（评审探针已实测二者可测）。
test("双面板互斥：开其一必收另一（正反各一次）", async () => {
  render(
    <TrajectoryViewer dataSource={dsOf([m(0, "user", "你好")])} delivery={["a.md"]}
                      annotationStore={storeOf([])} />,
  );
  await screen.findByText("你好");
  const drawerOpen = () => document.querySelector(".tv-delivery-drawer-open") !== null;
  const panelOpen = () => document.querySelector(".tv-anno-panel-open") !== null;
  const drawerTrigger = () => screen.getByLabelText("文件夹");
  const annoTrigger = () => screen.getByLabelText("批注与讨论");
  expect(drawerOpen()).toBe(false);
  expect(panelOpen()).toBe(false);

  // ① 先开交付物抽屉
  fireEvent.click(drawerTrigger());
  expect(drawerOpen()).toBe(true);
  expect(drawerTrigger().getAttribute("aria-expanded")).toBe("true");
  expect(panelOpen()).toBe(false);

  // ② 再开批注面板 → 抽屉必须被收起（toggleAnno 的 setDeliveryOpen(false) 承重）
  fireEvent.click(annoTrigger());
  expect(panelOpen()).toBe(true);
  expect(annoTrigger().getAttribute("aria-expanded")).toBe("true");
  expect(drawerOpen()).toBe(false);
  expect(drawerTrigger().getAttribute("aria-expanded")).toBe("false");

  // ③ 再开交付物抽屉 → 批注面板必须被收起（toggleDelivery 的 setAnnoOpen(false) 承重）
  fireEvent.click(drawerTrigger());
  expect(drawerOpen()).toBe(true);
  expect(drawerTrigger().getAttribute("aria-expanded")).toBe("true");
  expect(panelOpen()).toBe(false);
  expect(annoTrigger().getAttribute("aria-expanded")).toBe("false");
});

// Major-2：组合层对视图的回调接线。
// 注意与 MessageStreamView.test.tsx 的分工：那里覆盖视图层 onMarkClick 本身，
// 这里覆盖的是组合层把 handleMarkClick 接上去这一段（开面板 / 关抽屉 / 设 focusId 三件事）。
test("点高亮 mark：组合层接上 handleMarkClick —— 开批注面板、关交付物抽屉、设定位目标", async () => {
  const { container } = render(
    <TrajectoryViewer dataSource={dsOf([m(0, "user", "abcdefgh")])} delivery={["a.md"]}
                      annotationStore={storeOf([mkAnn({ quote: "cde", prefix: "ab", suffix: "fgh" })])} />,
  );
  // 不能 findByText("abcdefgh")：高亮把文本切成 ab / cde / fgh 三个节点，
  // RTL 只拼接直接文本子节点（得 "abfgh"），故直接等 mark 出现
  const mark = await waitFor(() => {
    const el = container.querySelector<HTMLElement>('mark.tv-anno-mark[data-anno-id="7"]');
    expect(el).not.toBeNull();
    return el!;
  });
  // 先开抽屉：点高亮应把它关掉（两面板互斥）
  fireEvent.click(screen.getByLabelText("文件夹"));
  expect(document.querySelector(".tv-delivery-drawer-open")).not.toBeNull();

  fireEvent.click(mark);
  // ① 面板被打开
  expect(document.querySelector(".tv-anno-panel-open")).not.toBeNull();
  // ② 抽屉被关掉
  expect(document.querySelector(".tv-delivery-drawer-open")).toBeNull();
  // ③ focusId 被设为目标楼（面板定位闪烁 effect 消费它）
  await waitFor(() => expect(
    document.querySelector('.tv-anno-card[data-tv-anno-card="7"]')!.classList.contains("tv-anno-card-flash"),
  ).toBe(true));
});

// Major-2：onChanged 接线（面板写操作成功后组合层重拉评论列表）
test("面板写操作成功后触发组合层重拉：onChanged → store.list 再次调用", async () => {
  const store = storeOf([mkAnn({ author: "alice" })]);
  render(<TrajectoryViewer dataSource={dsOf([])} annotationStore={store}
                           currentUser={{ name: "alice" }} />);
  await waitFor(() => expect(document.querySelector(".tv-badge-count")).not.toBeNull());
  fireEvent.click(screen.getByLabelText("批注与讨论"));
  await screen.findByText("楼");
  const before = callsOf(store.list);

  fireEvent.click(screen.getByRole("button", { name: "标记解决" }));
  await waitFor(() => expect(callsOf(store.list)).toBeGreaterThan(before));
  expect(callsOf(store.setResolved)).toBe(1);
});

// Major-2：onLike 接线（点赞后组合层本地增量，不重拉）
test("面板点赞触发组合层本地增量：onLike → applyLike 把 like_count 置为响应值", async () => {
  const store = storeOf([mkAnn({ author: "alice", like_count: 3, liked_by_me: false })]);
  render(<TrajectoryViewer dataSource={dsOf([])} annotationStore={store}
                           currentUser={{ name: "alice" }} />);
  await waitFor(() => expect(document.querySelector(".tv-badge-count")).not.toBeNull());
  fireEvent.click(screen.getByLabelText("批注与讨论"));
  const like = await screen.findByTitle("点赞");
  expect(like).toHaveTextContent("3");
  const before = callsOf(store.list);

  fireEvent.click(like);
  // storeOf 的 setLike 桩返回 { likeCount: 1, likedByMe: true }：UI 必须变成 1（applyLike 生效）
  await waitFor(() => expect(screen.getByTitle("点赞")).toHaveTextContent("1"));
  expect(callsOf(store.setLike)).toBe(1);
  expect(callsOf(store.list)).toBe(before);          // 点赞走本地增量，不重拉
});

// Major-3：handleCreateAnnotation 成功路径（store.create 被调用 + annos.reload() 触发重拉）
test("划线建楼成功：store.create 被调用，且组合层重拉评论列表", async () => {
  const store = storeOf([]);
  const { container } = render(<TrajectoryViewer dataSource={dsOf([m(0, "user", "abcdefgh")])}
                                                 annotationStore={store} />);
  await screen.findByText("abcdefgh");
  await waitFor(() => expect(callsOf(store.list)).toBeGreaterThan(0));   // 首拉完成
  const before = callsOf(store.list);

  const block = container.querySelector('[data-msg-idx="0"][data-region="content"]')!;
  selectRange(block, 2, 5);                          // 选中「cde」
  fireEvent.mouseUp(block);
  fireEvent.click(await screen.findByRole("button", { name: /评注/ }));
  fireEvent.change(screen.getByPlaceholderText("写下你的评注…"), { target: { value: "疑问" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));

  await waitFor(() => expect(callsOf(store.create)).toBe(1));
  expect(callsOf(store.list)).toBeGreaterThan(before);   // 证明 annos.reload() 被调用
  // 成功后浮层关闭（返回值 true 被视图消费）
  await waitFor(() => expect(screen.queryByRole("button", { name: /评注/ })).toBeNull());
});

// Major-3：handleCreateAnnotation 失败路径（返回 false → 视图保留草稿）
test("划线建楼失败：组合层返回 false（视图据此保留草稿）并提示错误", async () => {
  const onNotify = vi.fn();
  const store = storeOf([], { create: vi.fn(async () => { throw new Error("x"); }) });
  const { container } = render(<TrajectoryViewer dataSource={dsOf([m(0, "user", "abcdefgh")])}
                                                 annotationStore={store} onNotify={onNotify} />);
  await screen.findByText("abcdefgh");
  const block = container.querySelector('[data-msg-idx="0"][data-region="content"]')!;
  selectRange(block, 2, 5);
  fireEvent.mouseUp(block);
  fireEvent.click(await screen.findByRole("button", { name: /评注/ }));
  fireEvent.change(screen.getByPlaceholderText("写下你的评注…"), { target: { value: "疑问" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));

  await waitFor(() => expect(onNotify).toHaveBeenCalledWith("error", "评注发布失败: x"));
  // 返回 false：浮层仍在（草稿不丢）
  expect(screen.getByPlaceholderText("写下你的评注…")).toHaveValue("疑问");
});

// Minor-2：ref 正向透传（真的调到视图并返回 true）
test("ref.scrollToAnnotation 正向透传：目标消息已加载时返回 true", async () => {
  const ref = createRef<TrajectoryViewerHandle>();
  render(<TrajectoryViewer ref={ref} dataSource={dsOf([m(0, "user", "你好")])} />);
  await screen.findByText("你好");
  await expect(ref.current!.scrollToAnnotation(0, 1)).resolves.toBe(true);
});

// ---- 最终 ONE fix dispatch：H-2 theme 契约 + H-11 toast 锚点 ----

// H-2：theme prop 三态。③ 是这条用例的全部价值——守住「缺省不写属性」，
// 若有人把默认值改成 "light"，:not([data-theme="light"]) 永不命中、系统暗色被杀死，此条必红
test("theme prop：dark/light 落在根元素 data-theme；缺省时属性不存在（跟随系统）", () => {
  const { container, unmount } = render(<TrajectoryViewer dataSource={dsOf([])} theme="dark" />);
  expect(container.querySelector(".tv-root")!.getAttribute("data-theme")).toBe("dark");
  unmount();

  const r2 = render(<TrajectoryViewer dataSource={dsOf([])} theme="light" />);
  expect(r2.container.querySelector(".tv-root")!.getAttribute("data-theme")).toBe("light");
  r2.unmount();

  const r3 = render(<TrajectoryViewer dataSource={dsOf([])} />);
  const root3 = r3.container.querySelector(".tv-root")!;
  // 属性根本不存在，而非 "" 或 "undefined"
  expect(root3.hasAttribute("data-theme")).toBe(false);
});

// H-11a：内置 toast host 必须锚在 .tv-root 内部（NotifyProvider 移位承重）
// 堆叠上下文本身（isolation）jsdom 测不了——已知盲区，暗色目视归控制器点验
test("建楼失败（无 onNotify）：内置 toast host 渲染且位于 .tv-root 内部", async () => {
  const store = storeOf([], { create: vi.fn(async () => { throw new Error("x"); }) });
  const { container } = render(<TrajectoryViewer dataSource={dsOf([m(0, "user", "abcdefgh")])}
                                                  annotationStore={store} />);
  await screen.findByText("abcdefgh");
  const block = container.querySelector('[data-msg-idx="0"][data-region="content"]')!;
  selectRange(block, 2, 5);
  fireEvent.mouseUp(block);
  fireEvent.click(await screen.findByRole("button", { name: /评注/ }));
  fireEvent.change(screen.getByPlaceholderText("写下你的评注…"), { target: { value: "疑问" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));

  const root = container.querySelector(".tv-root")!;
  const host = await waitFor(() => {
    const el = root.querySelector(".tv-toast-host");
    expect(el).not.toBeNull();
    return el!;
  });
  // 承重断言：host 被 root 包含（Provider 挪回 ViewerInner 外层时 host 挂在 document 层，此条必红）
  expect(root.contains(host)).toBe(true);
});

// K-2 防双 host：主组件内已有外层 Provider（H-11a），面板 K-2 的自检须让位于它——
// 若「有 Provider 也自包一层」，一次失败会出现两个 host
test("K-2 主组件内面板失败：root 内 toast host 恰好一个（防双 host）", async () => {
  const store = storeOf([mkAnn({ author: "bob" })], {
    setLike: vi.fn(async () => { throw new Error("boom"); }),
  });
  render(<TrajectoryViewer dataSource={dsOf([])} annotationStore={store}
                           currentUser={{ name: "bob" }} />);
  await waitFor(() => expect(document.querySelector(".tv-badge-count")).not.toBeNull());
  fireEvent.click(screen.getByLabelText("批注与讨论"));
  await screen.findByText("楼");
  fireEvent.click(await screen.findByTitle("点赞"));
  await waitFor(() => expect(document.querySelector(".tv-toast-host")).not.toBeNull());
  expect(document.querySelectorAll(".tv-toast-host")).toHaveLength(1);
});
