import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { NotifyKind } from "../types";

export type NotifyFn = (kind: NotifyKind, text: string) => void;

const NotifyCtx = createContext<NotifyFn>(() => {});

/** 组件内取通知函数；默认（无 Provider）为静默空实现，便于测试与拆用 */
export function useNotify(): NotifyFn {
  return useContext(NotifyCtx);
}

interface ToastItem { id: number; kind: NotifyKind; text: string; }

/** 通知提供者（替代 antd message）：传了 onNotify 直接转发宿主体系；否则内置 toast 浮条兜底（3s 自动消失） */
export function NotifyProvider({ onNotify, children }: {
  onNotify?: NotifyFn;
  children: ReactNode;
}) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const push = useCallback<NotifyFn>((kind, text) => {
    if (onNotify) { onNotify(kind, text); return; }
    const id = ++seq.current;
    setToasts((t) => [...t, { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, [onNotify]);
  return (
    <NotifyCtx.Provider value={push}>
      {children}
      {toasts.length > 0 && (
        <div className="tv-toast-host" role="status">
          {toasts.map((t) => (
            <div key={t.id} className={"tv-toast tv-toast-" + t.kind}>{t.text}</div>
          ))}
        </div>
      )}
    </NotifyCtx.Provider>
  );
}
