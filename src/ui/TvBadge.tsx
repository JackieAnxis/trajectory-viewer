import type { ReactNode } from "react";

/** 数字徽标（替代 antd Badge）：count>0 时右上角红底圆点 */
export function TvBadge({ count, children }: { count: number; children: ReactNode }) {
  return (
    <span className="tv-badge">
      {children}
      {count > 0 && <span className="tv-badge-count">{count > 99 ? "99+" : count}</span>}
    </span>
  );
}
