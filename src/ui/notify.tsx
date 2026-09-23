import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { NotifyKind } from "../types";

export type NotifyFn = (kind: NotifyKind, text: string) => void;

// sentinel（K-2）：区分「外层真有 Provider」与「无 Provider 的默认值」——
// 用 noop 函数当默认值会让 useHasNotifyProvider 无从判别，故默认值是 Symbol 而非函数
const NOT_PROVIDED = Symbol("no-notify-provider");
const NotifyCtx = createContext<NotifyFn | typeof NOT_PROVIDED>(NOT_PROVIDED);

/** 组件内取通知函数；默认（无 Provider）为静默空实现，便于测试与拆用 */
export function useNotify(): NotifyFn {
  const v = useContext(NotifyCtx);
  return v === NOT_PROVIDED ? () => {} : v;
}

/** 作用域内是否存在 NotifyProvider（内部实现细节，不从包根 index.ts 导出——K-2） */
export function useHasNotifyProvider(): boolean {
  return useContext(NotifyCtx) !== NOT_PROVIDED;
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
