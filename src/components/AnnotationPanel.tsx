/** 「批注与讨论」右栏面板：常驻 DOM + open class 宽度过渡。
 *  页签：全部/我的（我发的楼 ∪ 我参与回复的楼）/已解决；楼中楼两层（更深层由持久层压平）。
 *  写操作经 annotationStore 持久化；删除为行内二次确认（替代 Popconfirm）。
 *  无外点关闭（用户实测反馈移除）：仅经触发按钮 toggle 与 header ✕ 关闭。 */
import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faCommentDots, faThumbsUp } from "@fortawesome/free-solid-svg-icons";
import type { Annotation, AnnotationReply, AnnotationStore, LikeResult } from "../types";
import { TvAvatar } from "../ui/TvAvatar";
import { TvSegmented } from "../ui/TvSegmented";
import { TvTooltip } from "../ui/TvTooltip";
import { ConfirmButton } from "../ui/ConfirmButton";
import { useNotify } from "../ui/notify";

export interface AnnotationPanelProps {
  open: boolean;
  onClose: () => void;
  store: AnnotationStore;
  annotations: Annotation[] | null;   // null=加载中
  loadError: boolean;                 // true → 「加载失败 点击重试」
  onRetry: () => void;
  me: string;                         // 当前用户名
  isAdmin: boolean;
  deadIds: Set<number>;               // 锚点失效楼（「原文已变更」）
  focusId: number | null;             // 定位闪烁目标（点高亮联动）
  onFocusConsumed: () => void;
  onQuoteClick: (a: Annotation) => void;   // 引用块点击 → 滚动定位高亮
  onChanged: () => void;              // 建/改/删/解决成功后回调（组合层重拉）
  onLike: (kind: "annotation" | "reply", targetId: number, next: LikeResult) => void;
}

/** HH:MM 短格式；完整时间走 title 悬浮 */
function fmtShort(ts: number): string {
  const d = new Date(ts * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtFull(ts: number): string {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 面板→卡片/回复行共享的权限与回调上下文 */
interface PanelCtx {
  me: string;
  isAdmin: boolean;
  deadIds: Set<number>;
  onQuoteClick: (a: Annotation) => void;
  onChanged: () => void;
  onLike: (kind: "annotation" | "reply", targetId: number, next: LikeResult) => void;
}

/** 删除确认文案：有下级（回复）时级联提示条数，无下级为普通确认 */
function deleteTitle(childCount: number): string {
  return childCount > 0 ? `删除后将同时删除 ${childCount} 条回复` : "确认删除？";
}

export default function AnnotationPanel(props: AnnotationPanelProps) {
  const { open, annotations, me, isAdmin, onClose } = props;
  const [tab, setTab] = useState<"all" | "mine" | "resolved">("all");

  const filtered = useMemo(() => {
    const list = annotations ?? [];
    if (tab === "mine") {
      return list.filter((a) =>
        a.author === me || a.replies.some((r) => r.author === me));
    }
    if (tab === "resolved") return list.filter((a) => a.resolved === 1);
    return list;
  }, [annotations, tab, me]);

  // 定位闪烁：高亮/卡片联动；定位后消费 focusId 防重复
  useEffect(() => {
    if (props.focusId == null || !open) return;
    const el = document.querySelector<HTMLElement>(`.tv-anno-card[data-tv-anno-card="${props.focusId}"]`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.classList.add("tv-anno-card-flash");
      window.setTimeout(() => el.classList.remove("tv-anno-card-flash"), 1600);
      props.onFocusConsumed();
    }
  }, [props.focusId, open]); // eslint-disable-line react-hooks/exhaustive-deps

  // 卡片/回复行共享上下文
  const ctx: PanelCtx = {
    me, isAdmin,
    deadIds: props.deadIds,
    onQuoteClick: props.onQuoteClick,
    onChanged: props.onChanged,
    onLike: props.onLike,
  };

  return (
    <div className={open ? "tv-anno-panel tv-anno-panel-open" : "tv-anno-panel"} aria-hidden={!open}>
      <div className="tv-anno-panel-head">
        <span><FontAwesomeIcon icon={faCommentDots} /> 批注与讨论</span>
        <button type="button" className="tv-anno-panel-close" onClick={onClose} aria-label="关闭">
          ✕
        </button>
      </div>
      <div className="tv-anno-panel-body">
        <TvSegmented
          className="tv-anno-tabs"
          value={tab}
          onChange={(v) => setTab(v)}
          options={[
            { label: "全部", value: "all" },
            { label: "我的", value: "mine" },
            { label: "已解决", value: "resolved" },
          ]}
        />
        {props.loadError ? (
          <div className="tv-anno-panel-empty">
            <span>加载失败</span>
            <button type="button" className="tv-anno-reply-toggle" style={{ marginLeft: 8 }}
                    onClick={props.onRetry}>
              点击重试
            </button>
          </div>
        ) : annotations === null ? (
          <div className="tv-anno-panel-empty">加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="tv-anno-panel-empty">暂无批注</div>
        ) : (
          filtered.map((a) => <AnnotationCard key={a.id} a={a} store={props.store} {...ctx} />)
        )}
      </div>
    </div>
  );
}

/** 单楼卡片：头像（哈希取色）/用户名/时间/引用块/正文/操作行/回复区/楼底输入框 */
function AnnotationCard({ a, store, ...ctx }: { a: Annotation; store: AnnotationStore } & PanelCtx) {
  const notify = useNotify();
  const canEdit = a.author === ctx.me;                        // 编辑仅作者
  const canDelete = a.author === ctx.me || ctx.isAdmin;       // 删除：作者或 admin
  const canResolve = a.author === ctx.me || ctx.isAdmin;      // 解决：作者或 admin
  const dead = ctx.deadIds.has(a.id);
  const topLevel = useMemo(() => a.replies.filter((r) => r.parent_id === null), [a.replies]);
  const [expanded, setExpanded] = useState(false);      // 回复区默认收起
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyingTo, setReplyingTo] = useState<AnnotationReply | null>(null);
  const [sending, setSending] = useState(false);

  async function saveEdit() {
    const text = draft.trim();
    if (!text || editSaving) return;
    setEditSaving(true);
    try {
      await store.update(a.id, text, "annotation");
      setEditing(false);
      ctx.onChanged();                                  // 组合层重拉
    } catch {
      notify("error", "保存失败");
    } finally {
      setEditSaving(false);
    }
  }

  // 一级回复（楼底输入框）不传 parent；「回复 @xxx」态传该回复 id
  async function sendReply() {
    const text = replyText.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await store.reply(a.id, text, replyingTo ? replyingTo.id : undefined);
      setReplyText("");
      setReplyingTo(null);
      ctx.onChanged();
    } catch {
      notify("error", "发送失败,请重试");
    } finally {
      setSending(false);
    }
  }

  async function toggleLike() {
    const liked = !a.liked_by_me;
    try {
      const next = await store.setLike(a.id, "annotation", liked);
      ctx.onLike("annotation", a.id, next);             // 组合层本地增量
    } catch {
      notify("error", "操作失败,请重试");
    }
  }

  async function toggleResolved() {
    try {
      await store.setResolved(a.id, a.resolved !== 1);
      ctx.onChanged();
    } catch {
      notify("error", "操作失败,请重试");
    }
  }

  async function doDelete() {
    try {
      await store.delete(a.id, "annotation");           // 持久层级联删回复
      ctx.onChanged();
    } catch {
      notify("error", "操作失败,请重试");
    }
  }

  return (
    <div className="tv-anno-card" data-tv-anno-card={a.id}>
      <div className="tv-anno-card-head">
        <TvAvatar name={a.author} size={24} />
        <span className="tv-anno-card-author">{a.author}</span>
        <span className="tv-anno-card-time" title={fmtFull(a.created_at)}>{fmtShort(a.created_at)}</span>
        {a.updated_at > a.created_at && <span className="tv-anno-card-edited">已编辑</span>}
      </div>
      <blockquote className="tv-anno-quote" title={a.quote} onClick={() => ctx.onQuoteClick(a)}>{a.quote}</blockquote>
      {dead && <span className="tv-anno-dead">原文已变更</span>}
      {editing ? (
        <div className="tv-anno-card-editor">
          <textarea autoFocus rows={3} value={draft}
                    onChange={(e) => setDraft(e.target.value)} />
          <div className="tv-anno-card-editor-actions">
            <button type="button" onClick={() => { setEditing(false); setDraft(""); }}>取消</button>
            <button type="button" disabled={!draft.trim() || editSaving}
                    onClick={() => void saveEdit()}>保存</button>
          </div>
        </div>
      ) : (
        <div className="tv-anno-card-body">{a.body}</div>
      )}
      <div className="tv-anno-actions">
        <button type="button" className={"tv-anno-like" + (a.liked_by_me ? " liked" : "")}
                title="点赞" onClick={() => void toggleLike()}>
          <FontAwesomeIcon icon={faThumbsUp} /> {a.like_count}
        </button>
        <span><FontAwesomeIcon icon={faCommentDots} /> {a.replies.length}</span>
        {a.resolved === 1 && (
          <span className="tv-anno-resolved-badge"><FontAwesomeIcon icon={faCheck} /> 已解决</span>
        )}
        {canResolve && (
          <button type="button" onClick={() => void toggleResolved()}>
            {a.resolved === 1 ? "重新打开" : "标记解决"}
          </button>
        )}
        {canEdit && (
          <button type="button" className="tv-anno-hover-only"
                  onClick={() => { setDraft(a.body); setEditing(true); }}>
            编辑
          </button>
        )}
        {canDelete && (
          <ConfirmButton className="tv-anno-hover-only" label="删除"
                         confirmLabel={deleteTitle(a.replies.length)}
                         onConfirm={() => void doDelete()} />
        )}
      </div>
      {a.replies.length > 0 && (
        <div className="tv-anno-replies">
          {expanded ? (
            <>
              <button type="button" className="tv-anno-reply-toggle"
                      onClick={() => setExpanded(false)}>收起回复</button>
              {/* 树组装：一级=parent_id 为 null；二级=parent_id 指向该一级 */}
              {topLevel.map((r) => (
                <ReplyItem key={r.id} r={r} store={store} ctx={ctx} onReply={setReplyingTo}
                           childReplies={a.replies.filter((c) => c.parent_id === r.id)} />
              ))}
            </>
          ) : (
            <button type="button" className="tv-anno-reply-toggle"
                    onClick={() => setExpanded(true)}>
              {/* 计数=总回复数（含二级），与操作行 💬 计数一致；一级条数会低估用户感知 */}
              查看 {a.replies.length} 条回复
            </button>
          )}
        </div>
      )}
      {replyingTo && (
        <div className="tv-anno-replying-to">
          <span>回复 @{replyingTo.author}</span>
          <button type="button" onClick={() => setReplyingTo(null)}>取消</button>
        </div>
      )}
      <div className="tv-anno-reply-input">
        <input
          value={replyText}
          placeholder={replyingTo ? `回复 @${replyingTo.author}` : "写下回复…"}
          onChange={(e) => setReplyText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void sendReply(); }}
        />
        <TvTooltip title="Ctrl / ⌘ + Enter 发送">
          <button type="button" disabled={!replyText.trim() || sending}
                  onClick={() => void sendReply()}>
            发送
          </button>
        </TvTooltip>
      </div>
    </div>
  );
}

/** 回复行：作者/时间/正文/操作行（点赞/回复/编辑/删除）；childReplies 渲染为二级缩进 */
function ReplyItem({ r, childReplies, store, ctx, onReply }: {
  r: AnnotationReply;
  childReplies: AnnotationReply[];
  store: AnnotationStore;
  ctx: PanelCtx;
  onReply: (reply: AnnotationReply) => void;
}) {
  const notify = useNotify();
  const canEdit = r.author === ctx.me;                        // 编辑仅作者
  const canDelete = r.author === ctx.me || ctx.isAdmin;       // 删除：作者或 admin
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  async function saveEdit() {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      await store.update(r.id, text, "reply");
      setEditing(false);
      ctx.onChanged();
    } catch {
      notify("error", "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function toggleLike() {
    const liked = !r.liked_by_me;
    try {
      const next = await store.setLike(r.id, "reply", liked);
      ctx.onLike("reply", r.id, next);
    } catch {
      notify("error", "操作失败,请重试");
    }
  }

  async function doDelete() {
    try {
      await store.delete(r.id, "reply");                  // 持久层级联删其子回复
      ctx.onChanged();
    } catch {
      notify("error", "操作失败,请重试");
    }
  }

  return (
    // 二级缩进（更深层持久层已压平）；一级回复正常缩进
    <div className={"tv-anno-reply" + (r.parent_id !== null ? " tv-anno-reply-l2" : "")}>
      <div className="tv-anno-card-head">
        <span className="tv-anno-card-author">{r.author}</span>
        <span className="tv-anno-card-time" title={fmtFull(r.created_at)}>{fmtShort(r.created_at)}</span>
        {r.updated_at > r.created_at && <span className="tv-anno-card-edited">已编辑</span>}
      </div>
      {editing ? (
        <div className="tv-anno-card-editor">
          <textarea autoFocus rows={2} value={draft}
                    onChange={(e) => setDraft(e.target.value)} />
          <div className="tv-anno-card-editor-actions">
            <button type="button" onClick={() => setEditing(false)}>取消</button>
            <button type="button" disabled={!draft.trim() || saving}
                    onClick={() => void saveEdit()}>保存</button>
          </div>
        </div>
      ) : (
        <div className="tv-anno-card-body">{r.body}</div>
      )}
      <div className="tv-anno-actions">
        <button type="button" className={"tv-anno-like" + (r.liked_by_me ? " liked" : "")}
                title="点赞" onClick={() => void toggleLike()}>
          <FontAwesomeIcon icon={faThumbsUp} /> {r.like_count}
        </button>
        <button type="button" onClick={() => onReply(r)}>回复</button>
        {canEdit && (
          <button type="button" className="tv-anno-hover-only"
                  onClick={() => { setDraft(r.body); setEditing(true); }}>
            编辑
          </button>
        )}
        {canDelete && (
          <ConfirmButton className="tv-anno-hover-only" label="删除"
                         confirmLabel={deleteTitle(childReplies.length)}
                         onConfirm={() => void doDelete()} />
        )}
      </div>
      {/* 二级回复紧随其一级；不再更深（持久层已压平） */}
      {childReplies.map((c) => (
        <ReplyItem key={c.id} r={c} childReplies={[]} store={store} ctx={ctx} onReply={onReply} />
      ))}
    </div>
  );
}
