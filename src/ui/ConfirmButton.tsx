import { useEffect, useRef, useState } from "react";

/** 行内二次确认按钮（替代 antd Popconfirm）：点击进入确认态（2s 超时复原），再点执行 */
export function ConfirmButton({ label, confirmLabel, onConfirm, className }: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current != null) window.clearTimeout(timer.current); }, []);
  function handleClick() {
    if (!confirming) {
      setConfirming(true);
      timer.current = window.setTimeout(() => setConfirming(false), 2000);
      return;
    }
    if (timer.current != null) window.clearTimeout(timer.current);
    setConfirming(false);
    onConfirm();
  }
  return (
    <button type="button" onClick={handleClick}
            className={(className ?? "") + (confirming ? " tv-confirming" : "")}>
      {confirming ? confirmLabel : label}
    </button>
  );
}
