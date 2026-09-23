import { useEffect, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";
import type { Msg, TrajectoryDataSource } from "../types";

/** 单页拉取量：≤300 条一次取全；更长记录由流末尾哨兵进入视口时自动续拉 */
const PAGE = 300;

export interface MessageStreamData {
  msgs: Msg[];
  hasMore: boolean;
  msgError: string | null;
  /** 已加载条数游标（跨页定位判断是否覆盖目标 msgIdx） */
  loadedRef: MutableRefObject<number>;
  /** 续拉下一页；true=成功取回一页（跨页定位循环用） */
  loadMore(): Promise<boolean>;
  /** 重新拉取首页（错误条「点击重试」） */
  reload(): void;
}

/**
 * 消息流分页状态机（数据源适配器驱动）：
 * - dataSource identity 变化 = 换记录：全量重置并拉首页；
 * - 哨兵进入视口（rootMargin 200px）自动续拉；loadReq 令牌丢弃过期响应防串台；
 * - active=false（raw 视图）时不挂哨兵；jsdom 无 IntersectionObserver 时静默跳过。
 */
export function useMessageStreamData(
  dataSource: TrajectoryDataSource,
  sentinelRef: RefObject<HTMLElement>,
  active: boolean,
): MessageStreamData {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [msgError, setMsgError] = useState<string | null>(null);
  const loaded = useRef(0);
  // 「加载更多」请求序号：切记录时自增使在途请求失效
  const loadReq = useRef(0);
  // 「加载更多」在途标志：连滚/哨兵反复可见时直接忽略
  const loadingMore = useRef(false);
  // 递增以重新触发首页加载（「点击重试」入口）
  const [reloadKey, setReloadKey] = useState(0);

  // 换记录/重试：重置分页门闩并拉首页
  useEffect(() => {
    loaded.current = 0;
    setMsgs([]);
    setHasMore(false);
    setMsgError(null);
    loadReq.current += 1;
    loadingMore.current = false;
    let live = true;
    dataSource.fetchMessages({ from: 0, limit: PAGE })
      .then((m) => {
        if (!live) return;
        // 违约防御（K-1）：只信实收数组，不信 from/returned；空页立即止损防重试风暴
        const got = Array.isArray(m.messages) ? m.messages : [];
        loaded.current = got.length;
        setHasMore(got.length > 0 && m.has_more === true);
        setMsgs(got);
      })
      .catch((e) => {
        if (live) setMsgError(`消息加载失败: ${String((e as Error)?.message ?? e)}`);
      });
    return () => { live = false; };
  }, [dataSource, reloadKey]);

  async function loadMore(): Promise<boolean> {
    if (loadingMore.current || !hasMore) return false;
    const req = ++loadReq.current;
    loadingMore.current = true;
    try {
      const m = await dataSource.fetchMessages({ from: loaded.current, limit: PAGE });
      // stale 防护：已切记录或已有更新请求时丢弃过期响应
      if (loadReq.current !== req) return false;
      // 与首页同一归一：游标按实收累加，空页/非数组即止损（K-1）
      const got = Array.isArray(m.messages) ? m.messages : [];
      loaded.current += got.length;
      setMsgs((prev) => [...prev, ...got]);
      setHasMore(got.length > 0 && m.has_more === true);
      setMsgError(null);
      return true;
    } catch (e) {
      if (loadReq.current === req) setMsgError(`加载更多失败: ${String((e as Error)?.message ?? e)}`);
      return false;
    } finally {
      if (loadReq.current === req) loadingMore.current = false;
    }
  }

  // 无限滚动：哨兵进入视口自动续拉下一页；active/hasMore/dataSource 变化重建观察器
  useEffect(() => {
    if (!active) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [active, dataSource, hasMore, sentinelRef]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    msgs, hasMore, msgError,
    loadedRef: loaded,
    loadMore,
    reload: () => setReloadKey((k) => k + 1),
  };
}
