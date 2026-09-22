/** 划线建楼浮层(spec §6.2):选区旁「评注」小按钮 → 点击展开输入弹层(textarea + 发送/取消)。
 *  fixed 定位脱离文档流;onMouseDown preventDefault 防点击浮层时选区塌陷;Ctrl/⌘+Enter 快捷发送。 */
import { useState } from "react";
import { TvTooltip } from "../ui/TvTooltip";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCommentDots } from "@fortawesome/free-solid-svg-icons";

interface AnnotatePopoverProps {
  /** 定位锚点(fixed):选区矩形下缘 left/top */
  rect: { left: number; top: number };
  /** 提交正文;返回 true=建楼成功(浮层关闭),false=失败(停留输入态可改稿重发) */
  onSubmit: (body: string) => Promise<boolean>;
  onCancel: () => void;
}

export default function AnnotatePopover({ rect, onSubmit, onCancel }: AnnotatePopoverProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  async function submit() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    const ok = await onSubmit(text);
    setSending(false);
    if (!ok) return;                 // 失败停留,草稿保留
    setDraft("");
    setEditing(false);               // 成功后由父级清 pending 卸载本浮层
  }

  return (
    <div className="tv-anno-popover" style={{ left: rect.left, top: rect.top }}
         onMouseDown={(e) => e.preventDefault()}>
      {editing ? (
        <div className="tv-anno-popover-editor">
          <textarea
            autoFocus
            rows={3}
            placeholder="写下你的评注…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();          // 防 textarea 内换行
                void submit();
              }
            }}
          />
          <div className="tv-anno-popover-actions">
            <button type="button" onClick={() => { setEditing(false); onCancel(); }}>
              取消
            </button>
            <TvTooltip title="Ctrl / ⌘ + Enter 发送">
              <button type="button" disabled={!draft.trim() || sending} onClick={() => void submit()}>
                发送
              </button>
            </TvTooltip>
          </div>
        </div>
      ) : (
        <button type="button" className="tv-anno-popover-btn" onClick={() => setEditing(true)}>
          <FontAwesomeIcon icon={faCommentDots} /> 评注
        </button>
      )}
    </div>
  );
}
