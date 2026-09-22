import { useEffect, useState } from "react";
import { faChevronDown, faChevronRight, faFile, faFolder } from "@fortawesome/free-solid-svg-icons";
import { faHtml5, faJs, faMarkdown } from "@fortawesome/free-brands-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { buildTree } from "../core/deliveryTree";
import type { TreeDir, TreeFile } from "../core/deliveryTree";

export interface DeliveryDrawerProps {
  /** 由调用方保证长度 >= 1（单文件渲染为顶层单个文件行） */
  delivery: string[];
  open: boolean;
  onClose: () => void;
  /** 文件点击打开链接；不传则文件行不可点 */
  resolveDeliveryUrl?: (path: string) => string;
}

/** 按扩展名给文件一个图标（FA 品牌图标还原语义，通用文件用 solid） */
function fileIcon(path: string) {
  if (path.endsWith(".html") || path.endsWith(".htm")) return <FontAwesomeIcon icon={faHtml5} />;
  if (path.endsWith(".js") || path.endsWith(".ts") || path.endsWith(".jsx") || path.endsWith(".tsx")) return <FontAwesomeIcon icon={faJs} />;
  if (path.endsWith(".md")) return <FontAwesomeIcon icon={faMarkdown} />;
  return <FontAwesomeIcon icon={faFile} />;
}

/** 目录行：chevron + 文件夹 + 合并段名 + 文件数；点击展开/折叠 */
function DirRow({ dir, depth, open, onToggle }: {
  dir: TreeDir; depth: number; open: boolean; onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="tv-delivery-tree-row tv-delivery-tree-dir"
      style={{ paddingLeft: 10 + depth * 18 }}
      onClick={onToggle}
    >
      <span className="tv-delivery-tree-chevron">{open ? <FontAwesomeIcon icon={faChevronDown} /> : <FontAwesomeIcon icon={faChevronRight} />}</span>
      <span className="tv-delivery-icon"><FontAwesomeIcon icon={faFolder} /></span>
      <span className="tv-delivery-name" title={dir.name}>{dir.name}</span>
      <span className="tv-delivery-tree-count">{dir.fileCount} 个文件</span>
    </button>
  );
}

/** 文件行：有 resolveDeliveryUrl 时整行可点击新标签打开（浏览器自行渲染 HTML/展示文本） */
function FileRow({ file, depth, resolveUrl }: {
  file: TreeFile; depth: number; resolveUrl?: (path: string) => string;
}) {
  return (
    <button
      type="button"
      className="tv-delivery-tree-row"
      style={{ paddingLeft: 10 + depth * 18 + 14 }}
      title={resolveUrl ? `打开 ${file.path}` : file.path}
      onClick={resolveUrl ? () => window.open(resolveUrl(file.path), "_blank") : undefined}
    >
      <span className="tv-delivery-icon">{fileIcon(file.path)}</span>
      <span className="tv-delivery-name" title={file.name}>{file.name}</span>
    </button>
  );
}

/** 递归渲染一层；顶层（depth 0）默认展开，子级默认折叠 */
function TreeLevel({ dirs, files, depth, resolveUrl, defaultOpen }: {
  dirs: TreeDir[]; files: TreeFile[]; depth: number;
  resolveUrl?: (path: string) => string; defaultOpen: boolean;
}) {
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  return (
    <>
      {dirs.map((d) => {
        const open = d.name in openMap ? openMap[d.name] : defaultOpen;
        return (
          <div key={d.name}>
            <DirRow dir={d} depth={depth} open={open}
              onToggle={() => setOpenMap((m) => ({ ...m, [d.name]: !(d.name in m ? m[d.name] : defaultOpen) }))} />
            {open && (
              <TreeLevel dirs={d.dirs} files={d.files} depth={depth + 1} resolveUrl={resolveUrl} defaultOpen={false} />
            )}
          </div>
        );
      })}
      {files.map((f) => <FileRow key={f.path} file={f} depth={depth} resolveUrl={resolveUrl} />)}
    </>
  );
}

/**
 * 交付物右侧抽屉（与消息区并排压缩主区域）：
 * 常驻 DOM + open class 宽度过渡；点击抽屉外部（触发卡片/工具栏触发器除外）即关闭。
 */
export default function DeliveryDrawer({ delivery, open, onClose, resolveDeliveryUrl }: DeliveryDrawerProps) {
  // 点击抽屉外任意处关闭；点触发器时不拦截（由其自身 onClick toggle，
  // 否则 pointerdown 先关、click 再开会表现为关不上）
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest(".tv-delivery-drawer") || t?.closest(".tv-delivery-card") || t?.closest(".tv-delivery-drawer-trigger")) return;
      onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onClose]);

  const root = buildTree(delivery);
  return (
    <div className={open ? "tv-delivery-drawer tv-delivery-drawer-open" : "tv-delivery-drawer"} aria-hidden={!open}>
      <div className="tv-delivery-drawer-head">
        <span>全部文件</span>
        <button type="button" className="tv-delivery-drawer-close" onClick={onClose} aria-label="关闭">
          ✕
        </button>
      </div>
      <div className="tv-delivery-modal-list">
        <TreeLevel dirs={root.dirs} files={root.files} depth={0} resolveUrl={resolveDeliveryUrl} defaultOpen />
      </div>
    </div>
  );
}
