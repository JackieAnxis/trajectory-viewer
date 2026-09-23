import { useRef } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Msg, MsgPage, TrajectoryDataSource } from "../types";
import { useMessageStreamData, type MessageStreamData } from "./useMessageStreamData";
import { useRawData } from "./useRawData";

// 本仓 vitest 未开 globals，RTL 的自动清理不会注册；显式注册避免用例间 DOM 累积
afterEach(cleanup);

// jsdom 无 IntersectionObserver：可手动触发的替身（与源项目 MessageStream 测试同模式）
class MockIO {
  static instances: MockIO[] = [];
  private cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) { this.cb = cb; MockIO.instances.push(this); }
  observe(): void {} unobserve(): void {} disconnect(): void {}
  show(): void { this.cb([{ isIntersecting: true } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
}
vi.stubGlobal("IntersectionObserver", MockIO);
function showSentinel() {
  const io = MockIO.instances[MockIO.instances.length - 1];
  if (!io) throw new Error("尚未创建哨兵观察器");
  io.show();
}
beforeEach(() => { MockIO.instances.length = 0; });

function m(idx: number, role: string, content: string): Msg {
  return { idx, role, preview: "", content_len: content.length, content, reasoning_len: 0 };
}
function pageOf(messages: Msg[], from = 0, hasMore = false): MsgPage {
  return { messages, from, returned: messages.length, has_more: hasMore };
}
function dsOf(fetchMessages: TrajectoryDataSource["fetchMessages"],
              fetchRaw: TrajectoryDataSource["fetchRaw"] = async () => ({})): TrajectoryDataSource {
  return { fetchMessages, fetchRaw };
}

let latest: MessageStreamData;
function StreamHarness({ ds, active = true }: { ds: TrajectoryDataSource; active?: boolean }) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  latest = useMessageStreamData(ds, sentinelRef, active);
  return <div ref={sentinelRef} />;
}

test("首页加载：拉取 from=0 并填充 msgs/hasMore", async () => {
  const ds = dsOf(async () => pageOf([m(0, "user", "问")], 0, true));
  render(<StreamHarness ds={ds} />);
  await waitFor(() => expect(latest.msgs).toHaveLength(1));
  expect(latest.hasMore).toBe(true);
  expect(latest.loadedRef.current).toBe(1);
});

test("哨兵进入视口自动续拉并追加", async () => {
  const fetchMessages = vi.fn(async (q: { from: number; limit: number }) =>
    q.from === 0 ? pageOf([m(0, "user", "问")], 0, true) : pageOf([m(1, "assistant", "答")], 1, false));
  render(<StreamHarness ds={dsOf(fetchMessages)} />);
  await waitFor(() => expect(latest.msgs).toHaveLength(1));
  showSentinel();
  await waitFor(() => expect(latest.msgs).toHaveLength(2));
  expect(fetchMessages).toHaveBeenLastCalledWith({ from: 1, limit: 300 });
  expect(latest.hasMore).toBe(false);
});

test("active=false 不挂哨兵", async () => {
  render(<StreamHarness ds={dsOf(async () => pageOf([m(0, "user", "问")]))} active={false} />);
  await waitFor(() => expect(latest.msgs).toHaveLength(1));
  expect(MockIO.instances).toHaveLength(0);
});

test("切 dataSource：重置并重新拉取，旧响应晚到不串台", async () => {
  let resolveOld: (p: MsgPage) => void = () => {};
  const dsOld = dsOf(() => new Promise<MsgPage>((r) => { resolveOld = r; }));
  const dsNew = dsOf(async () => pageOf([m(0, "user", "新记录")]));
  const { rerender } = render(<StreamHarness ds={dsOld} />);
  rerender(<StreamHarness ds={dsNew} />);
  await waitFor(() => expect(latest.msgs[0]?.content).toBe("新记录"));
  resolveOld(pageOf([m(0, "user", "旧记录残留")]));   // 旧响应晚到：不得覆盖
  await new Promise((r) => setTimeout(r, 10));
  expect(latest.msgs[0]?.content).toBe("新记录");
});

test("首页失败给 msgError，reload() 后恢复", async () => {
  let fail = true;
  const ds = dsOf(async () => {
    if (fail) throw new Error("网络错误");
    return pageOf([m(0, "user", "问")]);
  });
  render(<StreamHarness ds={ds} />);
  await waitFor(() => expect(latest.msgError).toContain("消息加载失败"));
  fail = false;
  act(() => { latest.reload(); });
  await waitFor(() => expect(latest.msgs).toHaveLength(1));
  expect(latest.msgError).toBeNull();
});

let rawLatest: { raw: unknown | null; rawError: string | null };
function RawHarness({ ds, active }: { ds: TrajectoryDataSource; active: boolean }) {
  rawLatest = useRawData(ds, active);
  return null;
}

test("raw：active 才懒拉取；切 dataSource 重置", async () => {
  const fetchRaw = vi.fn(async () => ({ ok: 1 }));
  const ds = dsOf(async () => pageOf([]), fetchRaw);
  const { rerender } = render(<RawHarness ds={ds} active={false} />);
  expect(fetchRaw).not.toHaveBeenCalled();
  rerender(<RawHarness ds={ds} active={true} />);
  await waitFor(() => expect(rawLatest.raw).toEqual({ ok: 1 }));
  const ds2 = dsOf(async () => pageOf([]), async () => ({ ok: 2 }));
  rerender(<RawHarness ds={ds2} active={true} />);
  await waitFor(() => expect(rawLatest.raw).toEqual({ ok: 2 }));
});

test("raw：失败给 rawError", async () => {
  const ds = dsOf(async () => pageOf([]), async () => { throw new Error("读取失败"); });
  render(<RawHarness ds={ds} active={true} />);
  await waitFor(() => expect(rawLatest.rawError).toBe("读取失败"));
});

// ---- 最终 ONE fix dispatch：K-1 适配器违约防御 / K-4 M-6 非 Error 抛出 ----

// K-1①：游标只信实收条数——returned 造假（返回 3 条却报 returned:1）时，
// 旧实现 loaded = from + returned 会漂到 1，下一页 from 必错
test("K-1 returned 造假：下一页 from 按实收条数推进而非 returned", async () => {
  const three = [m(0, "user", "一"), m(1, "user", "二"), m(2, "user", "三")];
  const fetchMessages = vi.fn(async (q: { from: number; limit: number }) =>
    q.from === 0
      ? ({ messages: three, from: 0, returned: 1, has_more: true } as MsgPage)
      : pageOf([m(3, "assistant", "四")], 3, false));
  render(<StreamHarness ds={dsOf(fetchMessages)} />);
  await waitFor(() => expect(latest.msgs).toHaveLength(3));
  showSentinel();
  await waitFor(() => expect(fetchMessages).toHaveBeenCalledTimes(2));
  expect(fetchMessages).toHaveBeenLastCalledWith({ from: 3, limit: 300 });
});

// K-1②：has_more:true 但某页实收 0 条 → 立即止损 hasMore=false，
// 掐死「哨兵每次可见都再发一页空请求」的串行重试风暴（超时/调用暴涨都算红）
test("K-1 空页止损：第二页 0 条后 fetchMessages 恰好 2 次不再发", async () => {
  const fetchMessages = vi.fn(async (q: { from: number; limit: number }) =>
    q.from === 0
      ? pageOf([m(0, "user", "问")], 0, true)
      : ({ messages: [], from: 1, returned: 0, has_more: true } as MsgPage));
  render(<StreamHarness ds={dsOf(fetchMessages)} />);
  await waitFor(() => expect(latest.msgs).toHaveLength(1));
  showSentinel();
  await waitFor(() => expect(fetchMessages).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(latest.hasMore).toBe(false));   // 空页即止损，不信 has_more
  showSentinel();                                            // 再滚一次：不得发第 3 页
  expect(await latest.loadMore()).toBe(false);               // 手动调也门控拒绝
  await new Promise((r) => setTimeout(r, 20));               // 有限等待观察无自动重发
  expect(fetchMessages).toHaveBeenCalledTimes(2);
});

// K-1③：首页 messages 非数组（违约返回 undefined）→ 静默归一为空态，
// 不崩、不进错误态（无 msgError——变异防线：摘 Array.isArray 会让 TypeError 进 catch 置错）、不再自动发请求
test("K-1 messages 非数组：归一空态，不崩且无自动重发", async () => {
  const fetchMessages = vi.fn(async () =>
    ({ messages: undefined, from: 0, returned: 3, has_more: true } as unknown as MsgPage));
  render(<StreamHarness ds={dsOf(fetchMessages)} />);
  await waitFor(() => expect(fetchMessages).toHaveBeenCalledTimes(1));
  expect(latest.msgs).toEqual([]);
  expect(latest.msgError).toBeNull();
  expect(latest.hasMore).toBe(false);                        // 空页止损对非数组同样生效
  await new Promise((r) => setTimeout(r, 20));
  expect(fetchMessages).toHaveBeenCalledTimes(1);
});

// K-1③b：续拉页 messages 非数组 → 与首页同一归一：不混入坏页、不进错误态、随即止损
test("K-1 续拉页非数组：归一空追加，不进错误态", async () => {
  const fetchMessages = vi.fn(async (q: { from: number; limit: number }) =>
    q.from === 0
      ? pageOf([m(0, "user", "问")], 0, true)
      : ({ messages: undefined, from: 1, returned: 9, has_more: true } as unknown as MsgPage));
  render(<StreamHarness ds={dsOf(fetchMessages)} />);
  await waitFor(() => expect(latest.msgs).toHaveLength(1));
  showSentinel();
  await waitFor(() => expect(fetchMessages).toHaveBeenCalledTimes(2));
  expect(latest.msgs).toHaveLength(1);                       // 坏页不混入
  expect(latest.msgError).toBeNull();                        // 归一不抛，不进错误态
  expect(latest.hasMore).toBe(false);                        // 非数组视作空页 → 止损
  await new Promise((r) => setTimeout(r, 20));
  expect(fetchMessages).toHaveBeenCalledTimes(2);            // 止损后不再自动拉
});

// K-4 M-6：reject 一个字符串（非 Error）→ 错误文本含原串，不显示 "undefined"
test("K-4 非 Error 抛出：加载更多失败文本含原串且不含 undefined", async () => {
  const fetchMessages = vi.fn(async (q: { from: number; limit: number }) =>
    q.from === 0 ? pageOf([m(0, "user", "问")], 0, true) : Promise.reject("boom"));
  render(<StreamHarness ds={dsOf(fetchMessages)} />);
  await waitFor(() => expect(latest.msgs).toHaveLength(1));
  showSentinel();
  await waitFor(() => expect(latest.msgError).toContain("加载更多失败"));
  expect(latest.msgError).toContain("boom");
  expect(latest.msgError).not.toContain("undefined");
});
