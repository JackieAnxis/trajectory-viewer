import type { ReactNode } from "react";

/** CSS-only 悬浮提示：data-tip 文本经 ::after 呈现；inline-flex 包裹使 focus-within 可达 */
export function TvTooltip({ title, children }: { title: string; children: ReactNode }) {
  return <span className="tv-tip" data-tip={title}>{children}</span>;
}
