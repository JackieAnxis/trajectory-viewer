import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation, AnnotationStore, LikeResult, TrajectoryDataSource } from "../types";

export interface AnnotationsState {
  /** null=加载中/未启用 */
  annotations: Annotation[] | null;
  loadError: boolean;
  /** 锚点失效楼 id 集（高亮重锚定后由视图上报，面板据此置灰） */
  deadIds: Set<number>;
  reportDead(ids: number[]): void;
  /** 重拉（建/改/删/解决后；数据量小，重拉替代增量合并，规避聚合字段漂移） */
  reload(): void;
  /** 点赞本地增量（响应即现状，不重拉） */
  applyLike(kind: "annotation" | "reply", targetId: number, next: LikeResult): void;
}

/** 评论列表状态：store 缺省=评论关闭；dataSource identity 变化=换记录重拉（annoReq 令牌丢弃过期响应） */
export function useAnnotations(
  store: AnnotationStore | undefined,
  dataSource: TrajectoryDataSource,
): AnnotationsState {
  const [annotations, setAnnotations] = useState<Annotation[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [deadIds, setDeadIds] = useState<Set<number>>(new Set());
  const annoReq = useRef(0);

  const reload = useCallback(() => {
    if (!store) {
      setAnnotations(null);
      setLoadError(false);
      return;
    }
    const req = ++annoReq.current;
    store.list()
      .then((list) => {
        if (annoReq.current !== req) return;   // 切记录后旧响应晚到：丢弃
        // 违约防御（K-1）：resolve 坏值（如 null）归一为空数组，.catch 兜不住这种形态，
        // 直传会让面板永驻「加载中」
        setAnnotations(Array.isArray(list) ? list : []);
        setLoadError(false);
      })
      .catch(() => { if (annoReq.current === req) setLoadError(true); });
  }, [store]);

  // 换记录/换 store：清空（含失效楼集）并重新拉取
  useEffect(() => {
    setAnnotations(null);
    setLoadError(false);
    setDeadIds(new Set());
    annoReq.current += 1;
    reload();
  }, [reload, dataSource]);

  const reportDead = useCallback((ids: number[]) => setDeadIds(new Set(ids)), []);

  const applyLike = useCallback((kind: "annotation" | "reply", targetId: number, next: LikeResult) => {
    setAnnotations((prev) => prev?.map((a) => {
      if (kind === "annotation" && a.id === targetId) {
        return { ...a, like_count: next.likeCount, liked_by_me: next.likedByMe };
      }
      if (kind === "reply") {
        return { ...a, replies: a.replies.map((r) =>
          r.id === targetId ? { ...r, like_count: next.likeCount, liked_by_me: next.likedByMe } : r) };
      }
      return a;
    }) ?? prev);
  }, []);

  return { annotations, loadError, deadIds, reportDead, reload, applyLike };
}
