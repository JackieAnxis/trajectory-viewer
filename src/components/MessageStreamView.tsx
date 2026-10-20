import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { MutableRefObject, ReactNode, RefObject } from "react";
import {
  faArrowRight,
  faChevronRight,
  faCircleExclamation,
  faEyeSlash,
  faGear,
  faLightbulb,
  faRobot,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { AnchorInput, Annotation, Msg } from "../types";
import {
  callSummary, firstLine, groupMessages, isFailedResult, looksLikeJson, stripUserMeta,
} from "../core/chatModel";
import type { ChatNode, ToolPair } from "../core/chatModel";
import {
  applyMarks, blockSelector, clearMarks, overlapsMark, reanchor, selectionToAnchor,
} from "../core/annotationAnchor";
import DeliveryCards from "./DeliveryCards";
import JsonHighlight from "./JsonHighlight";
import Markdown from "./Markdown";
import AnnotatePopover from "./AnnotatePopover";
import { useNotify } from "../ui/notify";
import { TvTooltip } from "../ui/TvTooltip";

/** content / 推理：若是 JSON 对象/数组则语法高亮，否则按 Markdown 渲染。 */
function smartContent(text: string) {
  if (looksLikeJson(text)) return <JsonHighlight text={text} />;
  return <Markdown>{text}</Markdown>;
}

/** 工具结果正文：JSON 走语法高亮，纯文本用 pre 保留换行与原始格式（tool 输出本就是命令/日志流）。 */
function toolResultContent(text: string) {
  if (looksLikeJson(text)) return <JsonHighlight text={text} />;
  return <pre className="tv-chat-toolresult">{text}</pre>;
}

/** 折叠卡片 summary 行：图标 + 文本 + chevron（系统提示 / 思考过程卡） */
function CardSummary({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <summary>
      <span className="tv-chat-icon">{icon}</span>
      <span className="tv-chat-card-text">{text}</span>
      <FontAwesomeIcon className="tv-chat-chevron" icon={faChevronRight} />
    </summary>
  );
}

/**
 * 消息头像：圆形机器人图标；weight=0 时右下角叠加 eye-slash 遮眼徽标（悬浮提示）。
 * weight 取值仅 0/1，1 不标记——异常出声，正常安静。
 */
function MsgAvatar({ weight }: { weight?: number | null }) {
  return (
    <div className="tv-chat-avatar">
      <FontAwesomeIcon icon={faRobot} />
      {weight === 0 && (
        <TvTooltip title="此处权重已置零">
          <span className="tv-avatar-zero">
            <FontAwesomeIcon icon={faEyeSlash} />
          </span>
        </TvTooltip>
      )}
    </div>
  );
}

/** 工具配对卡：summary 一行讲完「调用了什么 → 得到什么」，展开为参数/结果两节 */
function ToolPairView({ pair }: { pair: ToolPair }) {
  const fail = pair.result != null && isFailedResult(pair.result);
  const cls = "tv-chat-card tv-chat-pairrow" + (fail ? " is-fail" : "") + (pair.kind === "orphan" ? " is-orphan" : "");
  // 摘要按宽度截断（ellipsis）：title 悬浮可见完整摘要
  const argsSum = pair.kind === "call" ? callSummary(pair.name, pair.args) : null;
  const resultSum = pair.result != null ? firstLine(pair.result) : null;
  return (
    <details className={cls}>
      <summary>
        <span className="tv-pair-name">{pair.kind === "call" ? pair.name : "tool 结果"}</span>
        {argsSum !== null && <span className="tv-pair-args" title={argsSum}>{argsSum}</span>}
        {resultSum !== null && (
          <>
            <span className="tv-pair-arrow">
              <FontAwesomeIcon icon={faArrowRight} />
            </span>
            <span className="tv-pair-result-sum" title={resultSum}>{resultSum}</span>
          </>
        )}
        {fail && (
          <span className="tv-pair-fail">
            <FontAwesomeIcon icon={faCircleExclamation} /> 失败
          </span>
        )}
        <FontAwesomeIcon className="tv-chat-chevron" icon={faChevronRight} />
      </summary>
      <div className="tv-pair-body">
        {pair.kind === "call" && (
          <div className="tv-pair-sec sec-args" data-msg-idx={pair.msgIdx} data-region="args" data-sub={pair.sub}>
            <div className="tv-pair-sec-label">调用参数</div>
            {smartContent(pair.args)}
          </div>
        )}
        {pair.result != null && (
          <div className={"tv-pair-sec" + (fail ? " sec-fail" : "")} data-msg-idx={pair.kind === "call" ? pair.resultMsgIdx ?? undefined : pair.msgIdx} data-region="content">
            <div className="tv-pair-sec-label">{fail ? "返回结果 · 失败" : "返回结果"}</div>
            {toolResultContent(pair.result)}
          </div>
        )}
      </div>
    </details>
  );
}

/** 单个聊天节点的渲染 */
function NodeView({ node }: { node: ChatNode }) {
  if (node.kind === "user") {
    return (
      <div className="tv-chat-user">
        <div className="tv-chat-bubble" data-msg-idx={node.msg.idx} data-region="content">
          <Markdown>{stripUserMeta(node.msg.content)}</Markdown>
        </div>
      </div>
    );
  }
  if (node.kind === "system") {
    return (
      <details className="tv-chat-card tv-chat-syscard">
        <CardSummary icon={<FontAwesomeIcon icon={faGear} />} text={node.msg.label || "系统提示"} />
        <div className="tv-chat-card-body" data-msg-idx={node.msg.idx} data-region="content">{smartContent(node.msg.content)}</div>
      </details>
    );
  }
  if (node.kind === "turn") {
    const m = node.msg;
    // 轮头像权重：正文轮取消息 weight；仅工具轮取首 pair（call 继承发起消息的 weight）
    const turnWeight = m ? m.weight : node.pairs[0]?.weight ?? null;
    return (
      <div className="tv-chat-turn">
        <MsgAvatar weight={turnWeight} />
        <div className="tv-chat-body">
          {m && m.reasoning_content?.trim() && (
            <details className="tv-chat-card tv-chat-thinkcard">
              <CardSummary icon={<FontAwesomeIcon icon={faLightbulb} />} text="思考过程" />
              <div className="tv-chat-card-body" data-msg-idx={m.idx} data-region="reasoning">{smartContent(m.reasoning_content)}</div>
            </details>
          )}
          {m && m.content.trim() && (
            <div className="tv-chat-content" data-msg-idx={m.idx} data-region="content">{smartContent(m.content)}</div>
          )}
          {node.pairs.length > 0 && (
            <div className="tv-chat-toolgroup">
              {node.pairs.map((p, i) => <ToolPairView key={i} pair={p} />)}
            </div>
          )}
        </div>
      </div>
    );
  }
}


/** 批量开合动作方向：下一次点击「一键展开/关闭」将执行的动作 */
export type FoldAction = "expand" | "collapse";

/** 暴露给组合层的批量命令 */
export interface MessageStreamViewHandle {
  /** 批量开合当前视图所有折叠块；raw 视图（无内置折叠块）返回 null */
  toggleAllCards(): FoldAction | null;
  /** 定位批注高亮：目标消息未加载则连续续拉至覆盖；false=全量加载后仍无此消息 */
  scrollToAnnotation(msgIdx: number, annoId: number): Promise<boolean>;
}

export interface MessageStreamViewProps {
  mode: "parsed" | "raw";
  msgs: Msg[];
  msgError: string | null;
  onRetryMessages: () => void;
  loadMore: () => Promise<boolean>;
  loadedRef: MutableRefObject<number>;
  sentinelRef: RefObject<HTMLDivElement>;
  raw: unknown | null;
  rawError: string | null;
  /** 原数据渲染 slot；不传用内置 JsonHighlight */
  renderRaw?: (raw: unknown) => ReactNode;
  delivery?: string[];
  deliveryOpen: boolean;
  onToggleDelivery: () => void;
  annotations: Annotation[] | null;
  /** 建楼回调：返回 true=成功（组合层负责重拉，高亮 effect 自动包 mark） */
  onCreateAnnotation?: (anchor: AnchorInput, body: string) => Promise<boolean>;
  onMarkClick: (annoId: number) => void;
  onAnchorsReconciled: (deadIds: number[]) => void;
  onActionChange?: (action: FoldAction) => void;
}

const MessageStreamView = forwardRef<MessageStreamViewHandle, MessageStreamViewProps>(
  function MessageStreamView(props, ref) {
    const {
      mode, msgs, msgError, onRetryMessages, loadMore, loadedRef, sentinelRef,
      raw, rawError, renderRaw,
      delivery, deliveryOpen, onToggleDelivery,
      annotations, onCreateAnnotation, onMarkClick, onAnchorsReconciled, onActionChange,
    } = props;
    const notify = useNotify();
    const rootRef = useRef<HTMLDivElement | null>(null);

    // --- 批注划线与高亮 ---
    const annotateOn = mode === "parsed" && onCreateAnnotation != null;
    // 待建楼选区：锚点 + 浮层定位（选区矩形下缘）
    const [pendingAnno, setPendingAnno] = useState<
      { anchor: AnchorInput; rect: { left: number; top: number } } | null>(null);
    // 待定位高亮 id：loadMore 后经高亮 effect 完成定位
    const [pendingLocate, setPendingLocate] = useState<number | null>(null);

    /** mouseup 划线：选区落在定位区块内 → 浮出「评注」按钮；与既有高亮相交则提示 */
    function onStreamMouseUp() {
      if (!annotateOn) return;
      const sel = window.getSelection();
      if (!sel) return;
      const hit = selectionToAnchor(sel);
      if (!hit) return;                       // 塌陷/跨区块/不在区块内：不打扰
      if (overlapsMark(sel)) {
        notify("warning", "该段已有评注");     // 不支持重叠划线
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setPendingAnno({
        anchor: { msg_idx: hit.msg_idx, region: hit.region, sub: hit.sub,
                  quote: hit.quote, prefix: hit.prefix, suffix: hit.suffix },
        rect: { left: rect.left, top: rect.bottom + 6 },
      });
    }

    /** 高亮点击代理：mark 上 click → 组合层开面板定位卡片 */
    function onStreamClick(e: React.MouseEvent) {
      const m = (e.target as HTMLElement).closest("mark.tv-anno-mark");
      if (m) onMarkClick(Number((m as HTMLElement).dataset.annoId));
    }

    /** 高亮重锚定：annotations/分页变化后全量清 + 按区块分组重包；
        区块在但 quote 找不到 → 失效楼上报；区块不在已加载页 → 跳过（非失效）。 */
    useEffect(() => {
      const box = rootRef.current;
      if (!box) return;
      clearMarks(box);
      const dead: number[] = [];
      if (annotations?.length) {
        const byBlock = new Map<HTMLElement, { id: number; start: number; end: number }[]>();
        for (const a of annotations) {
          const block = box.querySelector<HTMLElement>(blockSelector(a));
          if (!block) continue;               // 所在消息页未加载：跳过
          const hit = reanchor(block, a);
          if (!hit) { dead.push(a.id); continue; }
          const arr = byBlock.get(block) ?? [];
          arr.push({ id: a.id, ...hit });
          byBlock.set(block, arr);
        }
        for (const [block, hits] of byBlock) applyMarks(block, hits);
      }
      onAnchorsReconciled(dead);
    }, [msgs, annotations, mode]); // eslint-disable-line react-hooks/exhaustive-deps

    /** 跨页定位：高亮就位后完成滚动与闪烁（折叠卡先自动展开）。
        mark 暂不在（如 raw 视图下预定位）时不消费 pending，留待变化后重试。 */
    useEffect(() => {
      const box = rootRef.current;
      if (pendingLocate == null || !box) return;
      const el = box.querySelector<HTMLElement>(
        `mark.tv-anno-mark[data-anno-id="${pendingLocate}"]`);
      if (!el) return;
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (p.tagName === "DETAILS") (p as HTMLDetailsElement).open = true;
      }
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("tv-anno-flash");
      window.setTimeout(() => el.classList.remove("tv-anno-flash"), 1600);
      setPendingLocate(null);
    }, [msgs, annotations, mode, pendingLocate]); // eslint-disable-line react-hooks/exhaustive-deps

    /** 扫描解析后视图：还有收起卡 → expand，全开 → collapse；无折叠块返回 null */
    function scanAction(): FoldAction | null {
      const root = rootRef.current;
      if (!root) return null;
      const cards = root.querySelectorAll(".tv-chat-stream details");
      if (!cards.length) return null;
      for (const c of cards) {
        if (!(c as HTMLDetailsElement).open) return "expand";
      }
      return "collapse";
    }

    // 流内容变化后向组合层同步「下一次批量动作」；raw 无内置折叠块，不上报（工具栏按钮禁用）
    useEffect(() => {
      if (mode === "raw") return;
      const a = scanAction();
      if (a) onActionChange?.(a);
    }, [mode, msgs, raw]); // eslint-disable-line react-hooks/exhaustive-deps

    useImperativeHandle(ref, () => ({
      toggleAllCards() {
        // raw：无内置折叠块（自定义渲染器的折叠命令由宿主自理），返回 null
        if (mode === "raw") return null;
        // parsed：卡片是非受控 <details>，直接改 DOM open 即可
        const a = scanAction();
        if (!a) return null;
        const root = rootRef.current;
        if (!root) return null;
        const cards = root.querySelectorAll(".tv-chat-stream details");
        cards.forEach((c) => { (c as HTMLDetailsElement).open = a === "expand"; });
        return a;
      },
      async scrollToAnnotation(msgIdx: number, annoId: number) {
        // 目标消息未加载则连续续拉（loadMore false=在途/失败/无更多即止），200 页上限防御
        let guard = 0;
        while (loadedRef.current <= msgIdx && guard++ < 200) {
          if (!(await loadMore())) break;
        }
        if (loadedRef.current <= msgIdx) return false;   // 全量加载后仍无此消息
        setPendingLocate(annoId);                        // 定位与闪烁交高亮 effect 完成
        return true;
      },
    }));

    return (
      <div ref={rootRef} onMouseUp={onStreamMouseUp} onClick={onStreamClick}>
        {mode === "raw" ? (
          rawError ? (
            <span className="tv-dim">原数据加载失败: {rawError}</span>
          ) : raw != null ? (
            renderRaw ? renderRaw(raw) : <JsonHighlight text={JSON.stringify(raw, null, 2)} />
          ) : (
            <span className="tv-dim">原数据加载中…</span>
          )
        ) : (
          <>
            {msgError && (
              <div className="tv-msg-error">
                <span className="tv-error-text">{msgError}</span>
                <button type="button" className="tv-link-btn" onClick={onRetryMessages}>
                  点击重试
                </button>
              </div>
            )}
            <div className="tv-chat-stream">
              {groupMessages(msgs).map((n) => <NodeView key={n.key} node={n} />)}
              {delivery?.length ? (
                <DeliveryCards
                  delivery={delivery}
                  panelOpen={deliveryOpen}
                  onTogglePanel={onToggleDelivery}
                />
              ) : null}
              {/* 无限滚动哨兵：进入视口自动续拉下一页（观察器由数据 hook 持有） */}
              <div ref={sentinelRef} aria-hidden="true" />
            </div>
            {pendingAnno && (
              <AnnotatePopover
                // key=锚点五元组：换段重划时强制 remount，编辑态与旧草稿不错发到新锚点
                key={JSON.stringify(pendingAnno.anchor)}
                rect={pendingAnno.rect}
                onSubmit={async (body) => {
                  const ok = await onCreateAnnotation!(pendingAnno.anchor, body);
                  if (ok) {
                    setPendingAnno(null);
                    window.getSelection()?.removeAllRanges();
                  }
                  return ok;
                }}
                onCancel={() => setPendingAnno(null)}
              />
            )}
          </>
        )}
      </div>
    );
  },
);

export default MessageStreamView;
