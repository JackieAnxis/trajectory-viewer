import { useEffect, useRef, useState } from "react";
import type { TrajectoryDataSource } from "../types";

/**
 * 原数据懒加载：active（进入 raw 视图）且尚无数据时拉取，失败后重进自动重试；
 * dataSource identity 变化重置（rawReq 令牌使在途响应失效）。
 */
export function useRawData(
  dataSource: TrajectoryDataSource,
  active: boolean,
): { raw: unknown | null; rawError: string | null } {
  const [raw, setRaw] = useState<unknown | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
  const rawReq = useRef(0);
  const loadingRaw = useRef(false);

  // 换记录重置
  useEffect(() => {
    setRaw(null);
    setRawError(null);
    rawReq.current += 1;
    loadingRaw.current = false;
  }, [dataSource]);

  useEffect(() => {
    if (!active || raw != null) return;
    if (loadingRaw.current) return;
    const req = ++rawReq.current;
    loadingRaw.current = true;
    dataSource.fetchRaw()
      .then((r) => {
        if (rawReq.current === req) {
          setRaw(r);
          setRawError(null);
        }
      })
      .catch((e) => {
        // 非 Error 抛出时 (e as Error).message 为 undefined（K-4 M-6）：回落到 String(e)
        if (rawReq.current === req) setRawError(String((e as Error)?.message ?? e));
      })
      .finally(() => {
        if (rawReq.current === req) loadingRaw.current = false;
      });
  }, [active, dataSource, raw]);

  return { raw, rawError };
}
