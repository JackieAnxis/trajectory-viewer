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

// ---- 最终 ONE fix dispatch：D 组组合层残余覆盖缺口（Ruling 96，控制器 14 次定点变异 ★存活项）----

// M15：className 透传不得吞掉 tv-root（样式作用域的根载体）
test("D-M15 className 透传：根节点同时含 tv-x 与 tv-root", () => {
  const { container } = render(<TrajectoryViewer dataSource={dsOf([])} className="tv-x" />);
  const root = container.firstElementChild as HTMLElement;
  expect(root.classList.contains("tv-x")).toBe(true);
  expect(root.classList.contains("tv-root")).toBe(true);
});

// M32：raw 视图无内置折叠块 → 工具栏折叠按钮必须禁用；切回恢复
test("D-M32 折叠按钮 disabled 门控：JSON 视图禁用，切回轨迹恢复", async () => {
  render(<TrajectoryViewer dataSource={dsOf([m(0, "user", "你好")], { a: 1 })} />);
  const fold = await screen.findByLabelText("展开");
  expect(fold).not.toBeDisabled();
  fireEvent.click(screen.getByRole("tab", { name: "JSON" }));
  expect(fold).toBeDisabled();
  fireEvent.click(screen.getByRole("tab", { name: "轨迹" }));
  expect(fold).not.toBeDisabled();
});

// M33：foldLabel 语义翻转 + aria-label 与 data-tip 同步（两变异：反转 / 恒定均杀）。
// 消息用 system 角色：普通 user/assistant 气泡不是 <details>，scanAction 恒 null 无从翻转
test("D-M33 折叠动作翻转后 aria-label 与 data-tip 同步变化", async () => {
  render(<TrajectoryViewer dataSource={dsOf([m(0, "system", "你好")])} />);
  // 初始：卡片全收起 → 下一次动作是「展开」
  const fold = await screen.findByLabelText("展开");
  expect(fold.closest(".tv-tip")).toHaveAttribute("data-tip", "展开");
  fireEvent.click(fold);                                  // 全部展开 → 下一次动作翻转为「收起」
  await waitFor(() => expect(screen.getByLabelText("收起")).toBeTruthy());
  expect(screen.getByLabelText("收起").closest(".tv-tip"))
    .toHaveAttribute("data-tip", "收起");
});

// M31：抽屉内部收到真实路径列表（此前只断言抽屉存在，delivery 被换成 [] 无人红）
test("D-M31 交付物抽屉列出传入路径的文件名", async () => {
  render(<TrajectoryViewer dataSource={dsOf([])} delivery={["a.md", "sub/b.html"]} />);
  fireEvent.click(await screen.findByLabelText("文件夹"));
  await waitFor(() => {
    const names = [...document.querySelectorAll(".tv-delivery-drawer-open .tv-delivery-name")]
      .map((el) => el.textContent);
    // 顶层文件行 + 顶层目录名（子级默认折叠）；delivery=[] 变异会使抽屉整体不渲染 → 必红
    expect(names).toContain("a.md");
    expect(names).toContain("sub");
  });
});

// M36：视图重锚失败 → onAnchorsReconciled → reportDead → 面板卡片置灰（接线断线此前零暴露）
test("D-M36 锚点失效上报链：重锚未命中的楼在面板显示「原文已变更」", async () => {
  render(
    <TrajectoryViewer dataSource={dsOf([m(0, "user", "abcdefgh")])}
                      annotationStore={storeOf([mkAnn({ quote: "不存在" })])} />,
  );
  // 区块在但 quote 找不到 → dead 上报；断言落在面板卡片的失效标记上
  await waitFor(() => expect(
    document.querySelector('.tv-anno-card[data-tv-anno-card="7"] .tv-anno-dead'),
  ).not.toBeNull());
  // 引用块本身仍渲染（失效楼不吞文本）
  expect(document.querySelector('.tv-anno-card[data-tv-anno-card="7"] .tv-anno-quote'))
    .toHaveTextContent("不存在");
});

// M22：失效楼点引用块 → 直接提示「原文已变更」，不得走视图定位（早返回）
test("D-M22 失效楼点引用块：notify 原文已变更且不走 scrollToAnnotation", async () => {
  const onNotify = vi.fn();
  render(
    <TrajectoryViewer dataSource={dsOf([m(0, "user", "abcdefgh")])}
                      annotationStore={storeOf([mkAnn({ quote: "不存在" })])}
                      onNotify={onNotify} />,
  );
  const card = await waitFor(() => {
    const el = document.querySelector<HTMLElement>('.tv-anno-card[data-tv-anno-card="7"] .tv-anno-dead');
    expect(el).not.toBeNull();
    return el!.closest<HTMLElement>(".tv-anno-card")!;
  });
  fireEvent.click(card.querySelector(".tv-anno-quote")!);
  expect(onNotify).toHaveBeenCalledWith("info", "原文已变更,无法定位");
  // 恰一次：若失效楼仍走了 scrollToAnnotation，msg 无 mark 会以 false 结束，
  // 再补一条「无法定位原文(可能已变更或尚未加载)」——第二次调用即早返回被摘的证据
  expect(onNotify).toHaveBeenCalledTimes(1);
});

// M12：换记录复位的三个独立后果逐条断言（同一 effect 三行，删任一行必红；③见注释的防御性说明）
test("D-M12 换记录：开着的批注面板与交付物抽屉复位关闭，面板无闪烁残留", async () => {
  Element.prototype.scrollIntoView = vi.fn();   // jsdom 未实现；面板定位 effect 与视图定位共用
  const store = storeOf([mkAnn({ quote: "cde", prefix: "ab", suffix: "fgh" })]);
  const mk = () => dsOf([m(0, "user", "abcdefgh")]);   // 三份同文本记录，只差 identity
  const ds1 = mk(); const ds2 = mk(); const ds3 = mk();
  const { rerender } = render(
    <TrajectoryViewer dataSource={ds1} delivery={["a.md"]} annotationStore={store} />,
  );
  const mark1 = await waitFor(() => {
    const el = document.querySelector("mark.tv-anno-mark[data-anno-id='7']");
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });
  // 点高亮：面板开 + focusId 定位闪烁（为 ③ 制造闪烁窗口）
  fireEvent.click(mark1);
  expect(document.querySelector(".tv-anno-panel-open")).not.toBeNull();
  await waitFor(() => expect(document.querySelector(".tv-anno-card-flash")).not.toBeNull());

  // ② 换记录：批注面板由开到关（删 setAnnoOpen(false) → 此条红）
  rerender(<TrajectoryViewer dataSource={ds2} delivery={["a.md"]} annotationStore={store} />);
  await waitFor(() => expect(document.querySelector("mark.tv-anno-mark[data-anno-id='7']")).not.toBeNull());
  expect(document.querySelector(".tv-anno-panel-open")).toBeNull();
  expect(screen.getByLabelText("批注与讨论").getAttribute("aria-expanded")).toBe("false");
  // ③ focusId 复位：换记录后面板不再有闪烁卡片。
  // 注：focusId 在面板定位成功时会被 onFocusConsumed 即时消费，「不置 null」无法经公开
  // API 路径观测——此断言为防御性固化（控制器 M12c 变异不可杀，已在 dispatch 报告记录），
  // 锁定的是「闪烁卡片不跨记录存活」这一用户可见行为。
  expect(document.querySelector(".tv-anno-card-flash")).toBeNull();

  // ① 换记录：开着的交付物抽屉由开到关（删 setDeliveryOpen(false) → 此条红）
  fireEvent.click(screen.getByLabelText("文件夹"));
  expect(document.querySelector(".tv-delivery-drawer-open")).not.toBeNull();
  rerender(<TrajectoryViewer dataSource={ds3} delivery={["a.md"]} annotationStore={store} />);
  await waitFor(() => expect(document.querySelector("mark.tv-anno-mark[data-anno-id='7']")).not.toBeNull());
  expect(document.querySelector(".tv-delivery-drawer-open")).toBeNull();
  expect(screen.getByLabelText("文件夹").getAttribute("aria-expanded")).toBe("false");
});

// M35：视图向组合层上报「下一次批量动作」的链路（onActionChange 断线此前全绿）
test("D-M35 视图上报折叠动作：定位展开卡片后换页触发重扫，工具栏翻转「收起」", async () => {
  Element.prototype.scrollIntoView = vi.fn();   // 视图定位 effect 需要
  const ref = createRef<TrajectoryViewerHandle>();
  const fetchMessages = vi.fn(async (q: { from: number; limit: number }) =>
    q.from === 0
      // system 角色 → syscard <details>（默认收起），mark 落在卡体内，定位 effect 会把它打开
      ? pageOf([m(0, "system", "abcdefgh")], 0, true)
      : pageOf([], 1, false));                  // 空页仅作 msgs 引用变化的扳机（K-1 止损随后掐 hasMore）
  const ds: TrajectoryDataSource = { fetchMessages, fetchRaw: async () => ({}) };
  render(
    <TrajectoryViewer ref={ref} dataSource={ds}
                      annotationStore={storeOf([mkAnn({ quote: "cde", prefix: "ab", suffix: "fgh" })])} />,
  );
  await waitFor(() => expect(document.querySelector("mark.tv-anno-mark[data-anno-id='7']")).not.toBeNull());
  // 跨页定位会把目标卡片的 <details> 自动展开（视图定位 effect）
  await expect(ref.current!.scrollToAnnotation(0, 7)).resolves.toBe(true);
  await waitFor(() => expect(document.querySelector("mark.tv-anno-flash")).not.toBeNull());
  expect(screen.getByLabelText("展开")).toBeTruthy();       // 展开前：下一次动作是「展开」
  // 哨兵续拉（成功但空页）→ msgs 引用变化 → 视图重扫：唯一的卡已展开 → 上报「collapse」
  const io = MockIO.instances[MockIO.instances.length - 1];
  io.show();
  await waitFor(() => expect(screen.getByLabelText("收起")).toBeTruthy());
  // onActionChange 断线（换 undefined）时 foldAction 停在初值 → 此步超时红
});
