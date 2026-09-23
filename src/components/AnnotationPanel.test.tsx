/** 批注面板:页签过滤/权限显隐/楼中楼两层/点赞/编辑/删除/解决/失效态。 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import AnnotationPanel from "./AnnotationPanel";
import { NotifyProvider } from "../ui/notify";
import type { Annotation, AnnotationReply, AnnotationStore } from "../types";

// 本仓 vitest 未开 globals，RTL 的自动清理不会注册；显式注册避免用例间 DOM 累积
afterEach(cleanup);

/** 评论存储 mock：各方法均为 vi.fn，用例按需 mockRejectedValueOnce 或查调用参数 */
function mockStore(over: Partial<AnnotationStore> = {}): AnnotationStore {
  return {
    list: vi.fn(async () => []),
    create: vi.fn(async () => ({})),
    reply: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => undefined),
    setResolved: vi.fn(async () => ({})),
    setLike: vi.fn(async () => ({ likeCount: 3, likedByMe: true })),
    ...over,
  };
}

function mkAnno(over: Partial<Annotation> = {}): Annotation {
  return {
    id: 1, msg_idx: 2,
    region: "content", sub: null, quote: "原文片段", prefix: "", suffix: "",
    author: "bob", body: "这里有问题", resolved: 0, resolved_by: null,
    resolved_at: null, created_at: 1757308800, updated_at: 1757308800,
    like_count: 0, liked_by_me: false, replies: [], ...over,
  };
}

function mkReply(over: Partial<AnnotationReply> = {}): AnnotationReply {
  return {
    id: 11, annotation_id: 1, parent_id: null, author: "carol", body: "回复",
    created_at: 1757308800, updated_at: 1757308800,
    like_count: 0, liked_by_me: false, ...over,
  };
}

function renderPanel(annotations: Annotation[] | null, over: Partial<Parameters<typeof AnnotationPanel>[0]> = {}) {
  const notify = vi.fn();
  const props = {
    open: true, onClose: vi.fn(), annotations, loadError: false, onRetry: vi.fn(),
    me: "bob", isAdmin: false, store: mockStore(), deadIds: new Set<number>(),
    focusId: null, onFocusConsumed: vi.fn(), onQuoteClick: vi.fn(),
    onChanged: vi.fn(), onLike: vi.fn(), ...over,
  };
  const utils = render(
    <NotifyProvider onNotify={notify}>
      <AnnotationPanel {...props} />
    </NotifyProvider>,
  );
  return { notify, ...utils, props };
}

beforeEach(() => {
  vi.clearAllMocks();
});

test("引用片段 title 悬浮显示完整原文（ellipsis 可全文查看）", () => {
  const { container } = renderPanel([mkAnno({ quote: "很长的原文片段内容" })]);
  const quote = container.querySelector(".tv-anno-quote")!;
  expect(quote.getAttribute("title")).toBe("很长的原文片段内容");
});

test("页签过滤:全部 3 楼、我的 2 楼(我发的 ∪ 我参与回复的)、已解决 1 楼", () => {
  const annos = [
    mkAnno({ id: 1, author: "bob", body: "bob 的楼" }),
    mkAnno({
      id: 2, author: "carol", body: "carol 的楼",
      replies: [mkReply({ id: 11, annotation_id: 2, parent_id: null, author: "bob", body: "bob 参与的回复" })],
    }),
    mkAnno({ id: 3, author: "dave", body: "dave 的已解决楼", resolved: 1 }),
  ];
  const { container } = renderPanel(annos);
  // 「全部」:3 楼全见
  expect(container.querySelectorAll(".tv-anno-card")).toHaveLength(3);
  // 「我的」:bob 发的楼 1 + bob 参与回复的楼 2;不含 dave 的楼
  fireEvent.click(screen.getByText("我的"));
  expect(container.querySelectorAll(".tv-anno-card")).toHaveLength(2);
  expect(screen.getByText("bob 的楼")).toBeTruthy();
  expect(screen.getByText("carol 的楼")).toBeTruthy();
  expect(screen.queryByText("dave 的已解决楼")).toBeNull();
  // 「已解决」:仅 resolved=1 的楼
  fireEvent.click(screen.getByText("已解决"));
  expect(container.querySelectorAll(".tv-anno-card")).toHaveLength(1);
  expect(screen.getByText("dave 的已解决楼")).toBeTruthy();
  // 切回「全部」
  fireEvent.click(screen.getByText("全部"));
  expect(container.querySelectorAll(".tv-anno-card")).toHaveLength(3);
});

test("卡片渲染:头像首字母大写、正文、引用块、时间短格式且 title 为完整时间", () => {
  const { container } = renderPanel([mkAnno({ author: "bob" })]);
  expect(screen.getByText("B")).toHaveClass("tv-avatar");   // 首字母大写,落在 tv-avatar 上
  expect(screen.getByText("这里有问题")).toBeTruthy();    // 正文
  expect(screen.getByText("原文片段")).toBeTruthy();      // 引用块
  // 时间:HH:MM 短格式,title 属性为完整时间(按本地时区动态计算期望值)
  const d = new Date(1757308800 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const timeEl = container.querySelector(".tv-anno-card-time")!;
  expect(timeEl.textContent).toBe(`${p(d.getHours())}:${p(d.getMinutes())}`);
  expect(timeEl.getAttribute("title")).toBe(
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`);
});

test("权限显隐:编辑仅作者、删除作者或 admin、解决切换三角色可见", () => {
  // 组1:楼主作者 bob → 见「编辑」「删除」「标记解决」
  const g1 = renderPanel([mkAnno({ id: 1, author: "bob" })], { me: "bob" });
  expect(screen.getByText("编辑")).toBeTruthy();
  expect(screen.getByText("删除")).toBeTruthy();
  expect(screen.getByText("标记解决")).toBeTruthy();
  g1.unmount();
  // 组2:普通用户 carol → 均不见
  const g2 = renderPanel([mkAnno({ id: 1, author: "bob" })], { me: "carol" });
  expect(screen.queryByText("编辑")).toBeNull();
  expect(screen.queryByText("删除")).toBeNull();
  expect(screen.queryByText("标记解决")).toBeNull();
  g2.unmount();
  // 组3:admin root → 见「删除」不见「编辑」(编辑仅作者),resolve 可见
  const g3 = renderPanel([mkAnno({ id: 1, author: "bob" })], { me: "root", isAdmin: true });
  expect(screen.queryByText("编辑")).toBeNull();
  expect(screen.getByText("删除")).toBeTruthy();
  expect(screen.getByText("标记解决")).toBeTruthy();
  g3.unmount();
});

test("点赞:点按钮调 setLike 并经 onLike 回传响应;liked_by_me 的楼按钮带实色态", async () => {
  const annos = [
    mkAnno({ id: 1, like_count: 0, liked_by_me: false }),
    mkAnno({ id: 2, author: "carol", body: "carol 的楼", like_count: 2, liked_by_me: true }),
  ];
  const { container, props } = renderPanel(annos);
  // 未点赞楼:按钮无 liked 态
  const card1 = container.querySelector<HTMLElement>('.tv-anno-card[data-tv-anno-card="1"]')!;
  const likeBtn1 = card1.querySelector("button.tv-anno-like")!;
  expect(likeBtn1.classList.contains("liked")).toBe(false);
  // 已点赞楼:按钮带 liked class
  const card2 = container.querySelector<HTMLElement>('.tv-anno-card[data-tv-anno-card="2"]')!;
  expect(card2.querySelector("button.tv-anno-like")!.classList.contains("liked")).toBe(true);
  // 点未点赞楼 → store.setLike(1, "annotation", true) → onLike 回传 LikeResult
  fireEvent.click(likeBtn1);
  await waitFor(() => expect(props.store.setLike).toHaveBeenCalledWith(1, "annotation", true));
  await waitFor(() => expect(props.onLike).toHaveBeenCalledWith("annotation", 1, {
    likeCount: 3, likedByMe: true,
  }));
});

test("回复收起与展开:默认「查看 3 条回复」,展开后一级+二级两层缩进、可再收起", () => {
  const anno = mkAnno({
    id: 1,
    replies: [
      mkReply({ id: 11, parent_id: null, author: "carol", body: "一级回复一" }),
      mkReply({ id: 12, parent_id: null, author: "dave", body: "一级回复二" }),
      mkReply({ id: 13, parent_id: 11, author: "erin", body: "@dana 收到" }),
    ],
  });
  const { container } = renderPanel([anno]);
  // 默认收起:N=总回复数(3=2 一级+1 二级,与操作行 💬 计数一致),回复体不可见
  expect(screen.getByText("查看 3 条回复")).toBeTruthy();
  expect(screen.queryByText("一级回复一")).toBeNull();
  expect(screen.queryByText("一级回复二")).toBeNull();
  expect(screen.queryByText("@dana 收到")).toBeNull();
  // 展开:一级 + 二级(parent_id 指向一级)两层;二级带缩进 class
  fireEvent.click(screen.getByText("查看 3 条回复"));
  expect(screen.getByText("一级回复一")).toBeTruthy();
  expect(screen.getByText("一级回复二")).toBeTruthy();
  const l2Body = screen.getByText("@dana 收到");
  expect(l2Body).toBeTruthy();                          // @dana 前缀原样显示
  const l2Row = l2Body.closest<HTMLElement>(".tv-anno-reply")!;
  expect(l2Row.classList.contains("tv-anno-reply-l2")).toBe(true);
  // 收起:回复体重新隐藏
  fireEvent.click(screen.getByText("收起回复"));
  expect(screen.queryByText("一级回复一")).toBeNull();
  expect(screen.getByText("查看 3 条回复")).toBeTruthy();
  expect(container.querySelector(".tv-anno-reply-l2")).toBeNull();
});

test("写回复:楼底输入发送 parentId 为空;点回复的「回复」发送带其 id(二级也传自身 id)", async () => {
  const anno = mkAnno({
    id: 1,
    replies: [
      mkReply({ id: 11, parent_id: null, author: "carol", body: "一级回复一" }),
      mkReply({ id: 12, parent_id: null, author: "dave", body: "一级回复二" }),
      mkReply({ id: 13, parent_id: 11, author: "erin", body: "@dana 二级回复" }),
    ],
  });
  const { props } = renderPanel([anno]);
  // 楼底输入框一级发送
  fireEvent.change(screen.getByPlaceholderText("写下回复…"), { target: { value: "顶" } });
  fireEvent.click(screen.getByText("发送"));
  await waitFor(() => expect(props.store.reply).toHaveBeenCalledTimes(1));
  expect(vi.mocked(props.store.reply).mock.calls[0][0]).toBe(1);
  expect(vi.mocked(props.store.reply).mock.calls[0][1]).toBe("顶");
  expect(vi.mocked(props.store.reply).mock.calls[0][2]).toBeUndefined();   // 一级:无 parent
  await waitFor(() => expect(props.onChanged).toHaveBeenCalled());

  // 展开回复区
  fireEvent.click(screen.getByText("查看 3 条回复"));
  // 「回复 @xxx」提示条出现,可取消
  fireEvent.click(screen.getAllByText("回复")[0]);         // carol(id 11)的「回复」按钮
  expect(screen.getByText("回复 @carol")).toBeTruthy();
  fireEvent.click(screen.getByText("取消"));
  expect(screen.queryByText("回复 @carol")).toBeNull();
  // 再进回复态发送 → parentId = 该回复 id
  fireEvent.click(screen.getAllByText("回复")[0]);
  fireEvent.change(screen.getByPlaceholderText("回复 @carol"), { target: { value: "同感" } });
  fireEvent.click(screen.getByText("发送"));
  await waitFor(() => expect(props.store.reply).toHaveBeenCalledTimes(2));
  expect(vi.mocked(props.store.reply).mock.calls[1][2]).toBe(11);

  // 对二级回复(erin, id 13)点回复 → 也传其自身 id(服务端压平)
  fireEvent.click(screen.getAllByText("回复")[1]);
  fireEvent.change(screen.getByPlaceholderText("回复 @erin"), { target: { value: "好" } });
  fireEvent.click(screen.getByText("发送"));
  await waitFor(() => expect(props.store.reply).toHaveBeenCalledTimes(3));
  expect(vi.mocked(props.store.reply).mock.calls[2][2]).toBe(13);
  expect(props.onChanged).toHaveBeenCalledTimes(3);
});

test("编辑就地:textarea 值为原 body,保存调 store.update + onChanged;已编辑标记", async () => {
  const { props } = renderPanel([
    mkAnno({ id: 1, body: "原有正文" }),
    mkAnno({ id: 2, author: "carol", body: "carol 的楼", updated_at: 1757308800 + 60 }),
  ]);
  // updated_at > created_at 的楼显示「已编辑」,另一楼不显示
  expect(screen.getByText("已编辑")).toBeTruthy();
  // 点「编辑」→ textarea 出现且值为原 body
  fireEvent.click(screen.getByText("编辑"));
  const ta = screen.getByDisplayValue("原有正文") as HTMLTextAreaElement;
  expect(ta.tagName).toBe("TEXTAREA");
  // 改字保存
  fireEvent.change(ta, { target: { value: "新" } });
  fireEvent.click(screen.getByText("保存"));
  await waitFor(() => expect(props.store.update).toHaveBeenCalledWith(1, "新", "annotation"));
  await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
});

test("删除确认级联文案:含回复的楼提示同时删除条数,无回复为普通确认文案", async () => {
  const { container, props } = renderPanel([
    mkAnno({
      id: 1, author: "bob",
      replies: [
        mkReply({ id: 11, parent_id: null, author: "carol", body: "r1" }),
        mkReply({ id: 12, parent_id: null, author: "dave", body: "r2" }),
      ],
    }),
    mkAnno({ id: 2, author: "carol", body: "carol 的楼" }),
  ], { me: "root", isAdmin: true });   // admin 对两楼均有删除权
  // 楼 1(含 2 条回复):确认态把按钮自身文本换成级联文案
  const card1 = container.querySelector<HTMLElement>('.tv-anno-card[data-tv-anno-card="1"]')!;
  fireEvent.click(within(card1).getByText("删除"));
  const cascadeBtn = await waitFor(() =>
    screen.getByText("删除后将同时删除 2 条回复"));       // 确认态按钮文本即级联文案
  fireEvent.click(cascadeBtn);
  await waitFor(() => expect(props.store.delete).toHaveBeenCalledWith(1, "annotation"));
  await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
  // 楼 2(无回复):普通确认文案
  const card2 = container.querySelector<HTMLElement>('.tv-anno-card[data-tv-anno-card="2"]')!;
  fireEvent.click(within(card2).getByText("删除"));
  const plainBtn = await waitFor(() => screen.getByText("确认删除？"));
  fireEvent.click(plainBtn);
  await waitFor(() => expect(props.store.delete).toHaveBeenCalledWith(2, "annotation"));
});

test("失效态:deadIds 命中的楼显示「原文已变更」,引用块仍渲染", () => {
  renderPanel([mkAnno({ id: 1 })], { deadIds: new Set([1]) });
  expect(screen.getByText("原文已变更")).toBeTruthy();
  expect(screen.getByText("原文片段")).toBeTruthy();
});

test("focusId 闪烁:目标卡片 scrollIntoView + flash class + onFocusConsumed", async () => {
  // jsdom 未实现 scrollIntoView
  Element.prototype.scrollIntoView = vi.fn();
  const { container, props } = renderPanel([mkAnno({ id: 1 })], { focusId: 1 });
  await waitFor(() =>
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "center" }));
  const card = container.querySelector<HTMLElement>('.tv-anno-card[data-tv-anno-card="1"]')!;
  expect(card.classList.contains("tv-anno-card-flash")).toBe(true);
  expect(props.onFocusConsumed).toHaveBeenCalled();
});

test("加载态:annotations=null 显示加载中;loadError 显示加载失败且可重试;空列表显示空态", () => {
  // 加载中
  const g1 = renderPanel(null);
  expect(screen.getByText(/加载中/)).toBeTruthy();
  g1.unmount();
  // 加载失败 → 点击重试
  const onRetry = vi.fn();
  const g2 = renderPanel(null, { loadError: true, onRetry });
  expect(screen.getByText("加载失败")).toBeTruthy();
  fireEvent.click(screen.getByText("点击重试"));
  expect(onRetry).toHaveBeenCalledTimes(1);
  g2.unmount();
  // 空列表
  const g3 = renderPanel([]);
  expect(screen.getByText(/暂无批注/)).toBeTruthy();
  g3.unmount();
});

test("回复删除:一级回复含子回复时级联文案按其二级计数,确认调 store.delete(11,'reply')", async () => {
  const anno = mkAnno({
    id: 1, author: "bob",
    replies: [
      mkReply({ id: 11, parent_id: null, author: "bob", body: "bob 的一级回复" }),
      mkReply({ id: 13, parent_id: 11, author: "erin", body: "子回复" }),
      mkReply({ id: 12, parent_id: null, author: "carol", body: "carol 的一级回复" }),
    ],
  });
  const { props } = renderPanel([anno]);
  fireEvent.click(screen.getByText("查看 3 条回复"));
  // bob 的一级回复含 1 条子回复 → 行级确认文案计数为 1;卡片级为 3 条,二者可区分
  const r11 = screen.getByText("bob 的一级回复").closest<HTMLElement>(".tv-anno-reply")!;
  fireEvent.click(within(r11).getByText("删除"));
  const cascadeBtn = await waitFor(() =>
    screen.getByText("删除后将同时删除 1 条回复"));       // 行级级联文案,非卡片级的「3 条」
  fireEvent.click(cascadeBtn);
  await waitFor(() => expect(props.store.delete).toHaveBeenCalledWith(11, "reply"));
  expect(props.store.delete).toHaveBeenCalledTimes(1);    // 卡片级删除未触发(否则会连楼层一并删)
  expect(props.onChanged).toHaveBeenCalled();
});

test("解决切换:标记解决与重新打开分别传 true/false,成功后 onChanged", async () => {
  // 楼主作者 bob 可标记解决(新权限模型:作者或 admin,itemOwner 角色已移除)
  const g1 = renderPanel([mkAnno({ id: 1, author: "bob", resolved: 0 })], { me: "bob" });
  fireEvent.click(screen.getByText("标记解决"));
  await waitFor(() => expect(g1.props.store.setResolved).toHaveBeenCalledWith(1, true));
  expect(g1.props.onChanged).toHaveBeenCalled();
  g1.unmount();
  // 楼主作者 bob 可重新打开;已解决楼带 badge
  const g2 = renderPanel(
    [mkAnno({ id: 1, author: "bob", resolved: 1, resolved_by: "alice", resolved_at: 1757308801 })],
    { me: "bob" });
  const card = g2.container.querySelector<HTMLElement>(".tv-anno-card")!;
  expect(within(card).getByText("已解决")).toBeTruthy();
  fireEvent.click(within(card).getByText("重新打开"));
  await waitFor(() => expect(g2.props.store.setResolved).toHaveBeenCalledWith(1, false));
  expect(g2.props.onChanged).toHaveBeenCalled();
});

test("写操作失败:notify 中文提示,成功回调不触发", async () => {
  const { container, props, notify } = renderPanel([mkAnno({ id: 1, body: "原有正文" })]);
  // 点赞失败
  vi.mocked(props.store.setLike).mockRejectedValueOnce(new Error("boom"));
  fireEvent.click(container.querySelector("button.tv-anno-like")!);
  await waitFor(() => expect(notify).toHaveBeenCalledWith("error", "操作失败,请重试"));
  expect(props.onLike).not.toHaveBeenCalled();
  // 编辑保存失败
  vi.mocked(props.store.update).mockRejectedValueOnce(new Error("boom"));
  fireEvent.click(screen.getByText("编辑"));
  fireEvent.change(screen.getByDisplayValue("原有正文"), { target: { value: "新" } });
  fireEvent.click(screen.getByText("保存"));
  await waitFor(() => expect(notify).toHaveBeenCalledWith("error", "保存失败"));
  expect(props.onChanged).not.toHaveBeenCalled();
  // 删除失败(经行内二次确认)
  vi.mocked(props.store.delete).mockRejectedValueOnce(new Error("boom"));
  fireEvent.click(screen.getByText("删除"));
  const confirmBtn = await waitFor(() => screen.getByText("确认删除？"));
  fireEvent.click(confirmBtn);
  await waitFor(() => expect(notify).toHaveBeenCalledWith("error", "操作失败,请重试"));
  expect(props.onChanged).not.toHaveBeenCalled();
  // 解决切换失败(文案与删除失败相同,改为验证请求已发起且不走成功回调)
  vi.mocked(props.store.setResolved).mockRejectedValueOnce(new Error("boom"));
  fireEvent.click(screen.getByText("标记解决"));
  await waitFor(() => expect(props.store.setResolved).toHaveBeenCalledWith(1, true));
  expect(props.onChanged).not.toHaveBeenCalled();
  // 回复发送失败
  vi.mocked(props.store.reply).mockRejectedValueOnce(new Error("boom"));
  fireEvent.change(screen.getByPlaceholderText("写下回复…"), { target: { value: "顶" } });
  fireEvent.click(screen.getByText("发送"));
  await waitFor(() => expect(notify).toHaveBeenCalledWith("error", "发送失败,请重试"));
  expect(props.onChanged).not.toHaveBeenCalled();
  // 五条失败路径各恰好通知一次(杀掉「某条失败路径漏通知」的变异)
  expect(notify).toHaveBeenCalledTimes(5);
});

// ---- 最终 ONE fix dispatch：K-2 独立使用的通知注入 / 锚点作用域 / 文案 ----

/** 独立渲染（不包 NotifyProvider）：宿主单独摆面板的真实形态 */
function renderStandalone(over: Partial<Parameters<typeof AnnotationPanel>[0]> = {}) {
  const store = mockStore(over.store ? { ...over.store } : {});
  const props = {
    open: true, onClose: vi.fn(), annotations: [mkAnno({ id: 1 })] as Annotation[] | null,
    loadError: false, onRetry: vi.fn(), me: "bob", isAdmin: false, store,
    deadIds: new Set<number>(), focusId: null, onFocusConsumed: vi.fn(),
    onQuoteClick: vi.fn(), onChanged: vi.fn(), onLike: vi.fn(), ...over,
  };
  const utils = render(<AnnotationPanel {...props} />);
  return { store, props, ...utils };
}

// K-2①：独立渲染 + 写操作失败 → 内置 toast 兜底（不再永久静默），host 锚在面板内（H-11d 的 relative）
test("K-2 独立使用：无外层 Provider 时点赞失败自渲染 toast host 于面板内", async () => {
  const store = mockStore({ setLike: vi.fn(async () => { throw new Error("boom"); }) });
  const { container } = renderStandalone({ store });
  fireEvent.click(container.querySelector("button.tv-anno-like")!);
  const host = await waitFor(() => {
    const el = container.querySelector(".tv-toast-host");
    expect(el).not.toBeNull();
    return el;
  });
  const panel = container.querySelector(".tv-anno-panel")!;
  expect(panel.contains(host)).toBe(true);                   // 锚点在面板内，不挂死
  expect(host!.textContent).toContain("操作失败,请重试");
});

// K-2②：独立渲染 + 传 notify → 转发宿主体系，且不再自渲染 toast host（防双通知）
test("K-2 独立使用：传 notify 时失败转发宿主、不渲染内置 toast", async () => {
  const notify = vi.fn();
  const store = mockStore({ setLike: vi.fn(async () => { throw new Error("boom"); }) });
  const { container } = renderStandalone({ store, notify });
  fireEvent.click(container.querySelector("button.tv-anno-like")!);
  await waitFor(() => expect(notify).toHaveBeenCalledWith("error", "操作失败,请重试"));
  expect(container.querySelector(".tv-toast-host")).toBeNull();
});

// K-2③（M-2 锚点作用域）：两个独立面板同 focusId 只属 A → document.querySelector 会打到
// DOM 序更靠前的 B（先渲染的 B 是受害者）；改 rootRef 内查询后 flash 只落 A 的卡片
test("K-2 多实例互不串：focus 只闪自己面板里的卡片", async () => {
  Element.prototype.scrollIntoView = vi.fn();
  const anno = mkAnno({ id: 1 });
  const b = renderStandalone({ annotations: [anno] });    // B 先渲染：全局查询会命中它的卡片
  const a = renderStandalone({ annotations: [anno], focusId: 1, onFocusConsumed: vi.fn() });
  const cardA = a.container.querySelector<HTMLElement>('.tv-anno-card[data-tv-anno-card="1"]')!;
  const cardB = b.container.querySelector<HTMLElement>('.tv-anno-card[data-tv-anno-card="1"]')!;
  await waitFor(() => expect(cardA.classList.contains("tv-anno-card-flash")).toBe(true));
  expect(cardB.classList.contains("tv-anno-card-flash")).toBe(false);
});

// K-2④（M-1 文案）：单行 input 裸 Enter 即发送（行为正确），tooltip 文案须与之一致
test("K-2 发送按钮 tooltip 与裸 Enter 行为一致：Enter 发送", () => {
  const { container } = renderStandalone();
  expect(container.querySelector('[data-tip="Enter 发送"]')).not.toBeNull();
});

test("无外点关闭(面板仅经触发按钮/✕ 关闭);open=false 时无展开类", () => {
  const onClose = vi.fn();
  const { container } = render(
    <div>
      <button type="button" className="tv-anno-panel-trigger">批注与讨论</button>
      <AnnotationPanel
        open onClose={onClose} annotations={[mkAnno({})]} loadError={false}
        onRetry={vi.fn()} me="bob" isAdmin={false} store={mockStore()}
        deadIds={new Set<number>()} focusId={null} onFocusConsumed={vi.fn()}
        onQuoteClick={vi.fn()} onChanged={vi.fn()} onLike={vi.fn()} />
    </div>,
  );
  // 划线/点击面板外任意区域:一律不关闭(用户实测反馈移除外点关闭)
  fireEvent.pointerDown(container.querySelector(".tv-anno-panel-trigger")!);
  fireEvent.pointerDown(screen.getByText("这里有问题"));
  fireEvent.pointerDown(container);
  expect(onClose).not.toHaveBeenCalled();
  // open=false:根元素无展开类
  const g2 = renderPanel([mkAnno({})], { open: false });
  expect(g2.container.querySelector(".tv-anno-panel")!.classList.contains("tv-anno-panel-open")).toBe(false);
});
