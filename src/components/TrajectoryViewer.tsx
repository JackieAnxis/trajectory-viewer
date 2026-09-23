/** TrajectoryViewer 组合层（包公开主组件）：
 *  工具栏（视图切换/批量折叠/评论区开关/交付物开关）+ 消息流 + 评论区面板 + 交付物抽屉。
 *  dataSource identity 变化 = 换记录：消息视图经 recordKey 重挂载复位本地态，
 *  各 data hook 按 identity 自行重置重拉。两面板开合互斥。 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ReactNode } from "react";
import { faCommentDots, faCompress, faExpand, faFolderOpen } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type {
  AnchorInput, Annotation, AnnotationStore, NotifyKind, TrajectoryDataSource,
} from "../types";
import { useMessageStreamData } from "../data/useMessageStreamData";
import { useRawData } from "../data/useRawData";
import { useAnnotations } from "../data/useAnnotations";
import MessageStreamView, { type FoldAction, type MessageStreamViewHandle } from "./MessageStreamView";
import DeliveryDrawer from "./DeliveryDrawer";
import AnnotationPanel from "./AnnotationPanel";
import { NotifyProvider, useNotify } from "../ui/notify";
import { TvSegmented } from "../ui/TvSegmented";
import { TvBadge } from "../ui/TvBadge";
import { TvTooltip } from "../ui/TvTooltip";

export interface TrajectoryViewerHandle {
  /** 定位批注高亮（跨页自动续拉）；false=全量加载后仍无此消息 */
  scrollToAnnotation(msgIdx: number, annoId: number): Promise<boolean>;
}

export interface TrajectoryViewerProps {
  /** 数据源适配器；对象 identity 变化 = 换记录，组件自动重置重拉 */
  dataSource: TrajectoryDataSource;
  /** 交付物路径列表（底部入口卡 + 抽屉） */
  delivery?: string[];
  /** 文件点击打开链接；不传则文件行不可点 */
  resolveDeliveryUrl?: (path: string) => string;
  /** 评论存储适配器；不传 = 评论功能整体关闭（划线/面板入口不出现） */
  annotationStore?: AnnotationStore;
  /** 当前用户（评论编辑/删除/解决权限判定）；缺省评论区只读 */
  currentUser?: { name: string; isAdmin?: boolean };
  /** 原数据渲染 slot；不传用内置 JsonHighlight */
  renderRaw?: (raw: unknown) => ReactNode;
  /** 全局通知；不传用内置 toast 兜底 */
  onNotify?: (kind: NotifyKind, text: string) => void;
  /** false = 隐藏内置工具栏（配 ref 自建 chrome） */
  toolbar?: false;
  className?: string;
}

type Mode = "parsed" | "raw";

const TrajectoryViewer = forwardRef<TrajectoryViewerHandle, TrajectoryViewerProps>(
  function TrajectoryViewer(props, ref) {
    return (
      <NotifyProvider onNotify={props.onNotify}>
        <ViewerInner {...props} handleRef={ref} />
      </NotifyProvider>
    );
  },
);

function ViewerInner(props: TrajectoryViewerProps & {
  handleRef: React.ForwardedRef<TrajectoryViewerHandle>;
}) {
  const {
    dataSource, delivery, resolveDeliveryUrl, annotationStore, currentUser,
    renderRaw, toolbar, className, handleRef,
  } = props;
  const notify = useNotify();
  const [mode, setMode] = useState<Mode>("parsed");
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [annoOpen, setAnnoOpen] = useState(false);
  const [focusId, setFocusId] = useState<number | null>(null);
  // foldAction = 「下一次批量动作」：解析后视图卡片默认全收起 → 首次为展开
  const [foldAction, setFoldAction] = useState<FoldAction>("expand");

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<MessageStreamViewHandle | null>(null);

  const stream = useMessageStreamData(dataSource, sentinelRef, mode === "parsed");
  const { raw, rawError } = useRawData(dataSource, mode === "raw");
  const annos = useAnnotations(annotationStore, dataSource);

  // 换记录：mode/面板/定位复位 + recordKey 递增（消息视图重挂载复位划线浮层等本地态）
  const [recordKey, setRecordKey] = useState(0);
  const prevDs = useRef(dataSource);
  useEffect(() => {
    if (prevDs.current === dataSource) return;
    prevDs.current = dataSource;
    setMode("parsed");
    setDeliveryOpen(false);
    setAnnoOpen(false);
    setFocusId(null);
    setRecordKey((k) => k + 1);
  }, [dataSource]);

  // 两面板互斥（并排展开会挤压主区域）：开其一必收另一
  function toggleDelivery() {
    setDeliveryOpen((o) => !o);
    setAnnoOpen(false);
  }
  function toggleAnno() {
    setAnnoOpen((o) => !o);
    setDeliveryOpen(false);
  }

  /** 划线建楼：成功重拉（高亮 effect 自动包 mark），失败提示并保留草稿 */
  async function handleCreateAnnotation(anchor: AnchorInput, body: string): Promise<boolean> {
    if (!annotationStore) return false;
    try {
      await annotationStore.create({ ...anchor, body });
      annos.reload();
      return true;
    } catch (e) {
      notify("error", `评注发布失败: ${(e as Error).message}`);
      return false;
    }
  }

  /** 点高亮 → 开面板定位卡片（卡片闪烁）；与交付物抽屉互斥 */
  function handleMarkClick(annoId: number) {
    setAnnoOpen(true);
    setDeliveryOpen(false);
    setFocusId(annoId);
  }

  /** 卡片引用块点击 → 滚动定位高亮（跨页自动续拉）；失效楼直接提示 */
  function handleQuoteClick(a: Annotation) {
    if (annos.deadIds.has(a.id)) {
      notify("info", "原文已变更,无法定位");
      return;
    }
    void viewRef.current?.scrollToAnnotation(a.msg_idx, a.id).then((ok) => {
      if (!ok) notify("info", "无法定位原文(可能已变更或尚未加载)");
    });
  }

  /** 工具栏「展开/关闭所有消息」：按视图返回值翻转下一次动作 */
  function handleToggleFold() {
    const done = viewRef.current?.toggleAllCards();
    if (done === "expand") setFoldAction("collapse");
    else if (done === "collapse") setFoldAction("expand");
  }

  useImperativeHandle(handleRef, () => ({
    scrollToAnnotation: (msgIdx, annoId) =>
      viewRef.current?.scrollToAnnotation(msgIdx, annoId) ?? Promise.resolve(false),
  }), []);

  const unresolved = annos.annotations?.filter((a) => a.resolved === 0).length ?? 0;
  const foldLabel = foldAction === "collapse" ? "收起" : "展开";

  return (
    <div className={"tv-root" + (className ? " " + className : "")}>
      <div className="tv-main">
        {toolbar !== false && (
          <div className="tv-toolbar">
            <TvSegmented
              value={mode}
              onChange={(v) => setMode(v)}
              options={[
                { label: "轨迹", value: "parsed" },
                { label: "JSON", value: "raw" },
              ]}
            />
            <div className="tv-toolbar-actions">
              {delivery?.length ? (
                <TvTooltip title="文件夹">
                  <button type="button" className="tv-tool-btn tv-delivery-drawer-trigger"
                          aria-label="文件夹" aria-expanded={deliveryOpen}
                          onClick={toggleDelivery}>
                    <FontAwesomeIcon icon={faFolderOpen} />
                  </button>
                </TvTooltip>
              ) : null}
              {annotationStore ? (
                <TvBadge count={unresolved}>
                  <TvTooltip title="批注与讨论">
                    <button type="button" className="tv-tool-btn tv-anno-panel-trigger"
                            aria-label="批注与讨论" aria-expanded={annoOpen}
                            onClick={toggleAnno}>
                      <FontAwesomeIcon icon={faCommentDots} />
                    </button>
                  </TvTooltip>
                </TvBadge>
              ) : null}
              <TvTooltip title={foldLabel}>
                <button type="button" className="tv-tool-btn" aria-label={foldLabel}
                        disabled={mode === "raw"}
                        onClick={handleToggleFold}>
                  <FontAwesomeIcon icon={foldAction === "collapse" ? faCompress : faExpand} />
                </button>
              </TvTooltip>
            </div>
          </div>
        )}
        <div className="tv-flow">
          <MessageStreamView
            key={recordKey}
            ref={viewRef}
            mode={mode}
            msgs={stream.msgs}
            msgError={stream.msgError}
            onRetryMessages={stream.reload}
            loadMore={stream.loadMore}
            loadedRef={stream.loadedRef}
            sentinelRef={sentinelRef}
            raw={raw}
            rawError={rawError}
            renderRaw={renderRaw}
            delivery={delivery}
            deliveryOpen={deliveryOpen}
            onToggleDelivery={toggleDelivery}
            annotations={annos.annotations}
            onCreateAnnotation={annotationStore ? handleCreateAnnotation : undefined}
            onMarkClick={handleMarkClick}
            onAnchorsReconciled={annos.reportDead}
            onActionChange={setFoldAction}
          />
        </div>
      </div>
      {delivery?.length ? (
        <DeliveryDrawer
          delivery={delivery}
          open={deliveryOpen}
          onClose={() => setDeliveryOpen(false)}
          resolveDeliveryUrl={resolveDeliveryUrl}
        />
      ) : null}
      {annotationStore ? (
        <AnnotationPanel
          open={annoOpen}
          onClose={() => setAnnoOpen(false)}
          store={annotationStore}
          annotations={annos.annotations}
          loadError={annos.loadError}
          onRetry={annos.reload}
          me={currentUser?.name ?? ""}
          isAdmin={currentUser?.isAdmin ?? false}
          deadIds={annos.deadIds}
          focusId={focusId}
          onFocusConsumed={() => setFocusId(null)}
          onQuoteClick={handleQuoteClick}
          onChanged={annos.reload}
          onLike={annos.applyLike}
        />
      ) : null}
    </div>
  );
}

export default TrajectoryViewer;
