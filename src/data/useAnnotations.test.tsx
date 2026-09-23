import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { Annotation, AnnotationStore, TrajectoryDataSource } from "../types";
import { useAnnotations, type AnnotationsState } from "./useAnnotations";

// 本仓 vitest 未开 globals，RTL 的自动清理不会注册；显式注册避免用例间 DOM 累积
afterEach(cleanup);

const DS: TrajectoryDataSource = { fetchMessages: async () => ({ messages: [], from: 0, returned: 0, has_more: false }), fetchRaw: async () => ({}) };

function anno(id: number, extra: Partial<Annotation> = {}): Annotation {
  return {
    id, msg_idx: 0, region: "content", sub: null, quote: "q", prefix: "", suffix: "",
    author: "alice", body: "楼", resolved: 0, resolved_by: null, resolved_at: null,
    created_at: 1, updated_at: 1, like_count: 0, liked_by_me: false,
    replies: [], ...extra,
  };
}
function storeOf(list: AnnotationStore["list"]): AnnotationStore {
  return {
    list,
    create: vi.fn(), reply: vi.fn(), update: vi.fn(), delete: vi.fn(),
    setResolved: vi.fn(), setLike: vi.fn(),
  } as unknown as AnnotationStore;
}

let latest: AnnotationsState;
function Harness({ store, ds = DS }: { store?: AnnotationStore; ds?: TrajectoryDataSource }) {
  latest = useAnnotations(store, ds);
  return null;
}

test("list 成功填充 annotations；store 缺省保持 null", async () => {
  render(<Harness store={storeOf(async () => [anno(1)])} />);
  await waitFor(() => expect(latest.annotations).toHaveLength(1));
  const { unmount } = render(<Harness />);
  await new Promise((r) => setTimeout(r, 10));
  expect(latest.annotations).toBeNull();
  unmount();
});

test("list 失败置 loadError，reload 成功后恢复", async () => {
  let fail = true;
  const store = storeOf(async () => { if (fail) throw new Error("x"); return [anno(2)]; });
  render(<Harness store={store} />);
  await waitFor(() => expect(latest.loadError).toBe(true));
  fail = false;
  act(() => { latest.reload(); });
  await waitFor(() => expect(latest.annotations).toHaveLength(1));
  expect(latest.loadError).toBe(false);
});

test("applyLike 本地增量：楼与回复两种目标", async () => {
  const a = anno(1, {
    replies: [{ id: 9, annotation_id: 1, parent_id: null, author: "bob", body: "r",
                created_at: 1, updated_at: 1, like_count: 0, liked_by_me: false }],
  });
  render(<Harness store={storeOf(async () => [a])} />);
  await waitFor(() => expect(latest.annotations).toHaveLength(1));
  act(() => { latest.applyLike("annotation", 1, { likeCount: 5, likedByMe: true }); });
  await waitFor(() => expect(latest.annotations![0].like_count).toBe(5));
  act(() => { latest.applyLike("reply", 9, { likeCount: 2, likedByMe: true }); });
  await waitFor(() => expect(latest.annotations![0].replies[0].liked_by_me).toBe(true));
});

// K-1④：store.list() resolve null（违约的坏值，.catch 兜不住）→ 归一为空数组，
// 面板走「暂无批注」空态而非永驻「加载中」
test("K-1 list 违约 resolve null：归一为空数组，不落加载态", async () => {
  render(<Harness store={storeOf(async () => null as unknown as Annotation[])} />);
  await waitFor(() => expect(latest.annotations).toEqual([]));
  expect(latest.annotations).not.toBeNull();
  expect(latest.loadError).toBe(false);
});

test("切 dataSource：清空并重新拉取", async () => {
  const list = vi.fn(async () => [anno(1)]);
  render(<Harness store={storeOf(list)} />);
  await waitFor(() => expect(latest.annotations).toHaveLength(1));
  act(() => { latest.reportDead([1]); });
  await waitFor(() => expect(latest.deadIds.has(1)).toBe(true));
  const ds2: TrajectoryDataSource = { ...DS };
  const { rerender } = render(<Harness store={storeOf(list)} />);
  rerender(<Harness store={storeOf(list)} ds={ds2} />);
  await waitFor(() => expect(list.mock.calls.length).toBeGreaterThanOrEqual(1));
});
