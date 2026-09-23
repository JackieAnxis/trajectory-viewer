import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useState } from "react";
import { TvBadge } from "./TvBadge";
import { TvAvatar } from "./TvAvatar";
import { TvSegmented } from "./TvSegmented";
import { TvTooltip } from "./TvTooltip";
import { ConfirmButton } from "./ConfirmButton";
import { NotifyProvider, useNotify } from "./notify";

// 本仓 vitest 未开 globals，@testing-library/react 内部的 afterEach 自动清理不会注册；
// 显式注册，避免用例间 DOM 累积导致 getByRole/getByText 命中上一用例的残留节点
afterEach(cleanup);

test("TvTooltip 以 data-tip 承载文本供 CSS ::after 展示", () => {
  render(<TvTooltip title="提示文本"><button>悬停我</button></TvTooltip>);
  expect(screen.getByText("悬停我").closest(".tv-tip")).toHaveAttribute("data-tip", "提示文本");
});

test("TvSegmented 渲染选项并回调选中值", () => {
  function Demo() {
    const [v, setV] = useState<"a" | "b">("a");
    return <TvSegmented value={v} onChange={setV} options={[{ label: "甲", value: "a" }, { label: "乙", value: "b" }]} />;
  }
  render(<Demo />);
  const b = screen.getByRole("tab", { name: "乙" });
  expect(screen.getByRole("tab", { name: "甲" })).toHaveAttribute("aria-selected", "true");
  // 用 fireEvent.click 而非原生 el.click()：本仓 IS_REACT_ACT_ENVIRONMENT 恒为 undefined，
  // React 的 act 告警首道门直接 return；裸 click 的真问题是在 React 18 并发根下，
  // 未包 act 的更新不会同步冲刷 DOM，断言读不到新状态
  fireEvent.click(b);
  expect(b).toHaveAttribute("aria-selected", "true");
});

test("TvBadge 仅 count>0 显示圆点", () => {
  const { rerender } = render(<TvBadge count={0}><span>铃</span></TvBadge>);
  expect(document.querySelector(".tv-badge-count")).toBeNull();
  rerender(<TvBadge count={3}><span>铃</span></TvBadge>);
  expect(document.querySelector(".tv-badge-count")).toHaveTextContent("3");
});

test("TvAvatar 取名字首字母大写", () => {
  render(<TvAvatar name="jackie" />);
  expect(screen.getByText("J")).toHaveClass("tv-avatar");
});

test("ConfirmButton 二次点击才执行，超时复原", () => {
  vi.useFakeTimers();
  const onConfirm = vi.fn();
  render(<ConfirmButton label="删除" confirmLabel="确认删除？" onConfirm={onConfirm} />);
  const btn = screen.getByRole("button");
  fireEvent.click(btn);                          // 第一次：进入确认态
  expect(btn).toHaveTextContent("确认删除？");
  expect(onConfirm).not.toHaveBeenCalled();
  // 定时器回调里的 setState 在 act 外不会同步落到 DOM，推进后需 act 包一层再断言
  act(() => { vi.advanceTimersByTime(2100); });  // 超时复原
  expect(btn).toHaveTextContent("删除");
  fireEvent.click(btn);
  fireEvent.click(btn);                          // 确认态内第二次：执行
  expect(onConfirm).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});

test("notify：传了 onNotify 直接转发，不渲染内置 toast", () => {
  const spy = vi.fn();
  function Demo() {
    const notify = useNotify();
    return <button onClick={() => notify("error", "出错了")}>发</button>;
  }
  render(<NotifyProvider onNotify={spy}><Demo /></NotifyProvider>);
  fireEvent.click(screen.getByText("发"));
  expect(spy).toHaveBeenCalledWith("error", "出错了");
  expect(document.querySelector(".tv-toast")).toBeNull();
});

test("notify：未传 onNotify 时内置 toast 兜底并可读", async () => {
  function Demo() {
    const notify = useNotify();
    return <button onClick={() => notify("warning", "该段已有评注")}>发</button>;
  }
  render(<NotifyProvider><Demo /></NotifyProvider>);
  fireEvent.click(screen.getByText("发"));
  await waitFor(() => expect(document.querySelector(".tv-toast-warning")).toHaveTextContent("该段已有评注"));
});

// ---- 最终 ONE fix dispatch：A 组对外契约缺口 9 条（Ruling 17）----

// (a) TvBadge 上限：count>99 折叠为 "99+"
test("TvBadge count>99 折叠为 99+", () => {
  render(<TvBadge count={150}><span>铃</span></TvBadge>);
  expect(document.querySelector(".tv-badge-count")).toHaveTextContent("99+");
});

// (b) toast 3s 自动消失（notify.tsx:27 的 setTimeout）
test("toast 3s 自动消失", () => {
  vi.useFakeTimers();
  function Demo() {
    const notify = useNotify();
    return <button onClick={() => notify("info", "知道了")}>发</button>;
  }
  render(<NotifyProvider><Demo /></NotifyProvider>);
  fireEvent.click(screen.getByText("发"));
  expect(document.querySelector(".tv-toast")).not.toBeNull();
  act(() => { vi.advanceTimersByTime(3000); });   // 定时器回调的 setState 需 act 包裹才落 DOM
  expect(document.querySelector(".tv-toast")).toBeNull();
  vi.useRealTimers();
});

// (c) ConfirmButton 2s 复原的边界：<2s 不误复原
test("ConfirmButton 复原在 2s 边界：1.9s 仍确认态，2.1s 才复原", () => {
  vi.useFakeTimers();
  render(<ConfirmButton label="删" confirmLabel="确认？" onConfirm={vi.fn()} />);
  const btn = screen.getByRole("button");
  fireEvent.click(btn);
  act(() => { vi.advanceTimersByTime(1900); });
  expect(btn).toHaveTextContent("确认？");
  act(() => { vi.advanceTimersByTime(200); });
  expect(btn).toHaveTextContent("删");
  vi.useRealTimers();
});

// (d) 确认态类名 tv-confirming（style.css 依赖它做视觉）
test("ConfirmButton 点击后进入 tv-confirming 态", () => {
  render(<ConfirmButton label="删" confirmLabel="确认？" onConfirm={vi.fn()} />);
  const btn = screen.getByRole("button");
  expect(btn).not.toHaveClass("tv-confirming");
  fireEvent.click(btn);
  expect(btn).toHaveClass("tv-confirming");
});

// (e) className 透传与 tv-confirming 并存（类名拼接不互相吞掉）
test("ConfirmButton className 透传：确认态同时含 tv-x 与 tv-confirming", () => {
  render(<ConfirmButton className="tv-x" label="删" confirmLabel="确认？" onConfirm={vi.fn()} />);
  const btn = screen.getByRole("button");
  expect(btn).toHaveClass("tv-x");
  fireEvent.click(btn);
  expect(btn).toHaveClass("tv-confirming");
  expect(btn).toHaveClass("tv-x");
});

// (f) TvSegmented className 透传 + 选中项 active 类
test("TvSegmented className 透传与选中项 active 类", () => {
  render(
    <TvSegmented className="tv-seg-x" value="b" onChange={() => {}}
                 options={[{ label: "甲", value: "a" }, { label: "乙", value: "b" }]} />,
  );
  expect(document.querySelector(".tv-segmented")).toHaveClass("tv-seg-x");
  expect(screen.getByRole("tab", { name: "乙" })).toHaveClass("active");
  expect(screen.getByRole("tab", { name: "甲" })).not.toHaveClass("active");
});

// (g) TvAvatar size → 行内 width/height=size、fontSize=size/2
test("TvAvatar size 映射行内样式：宽高=size、字号=size/2", () => {
  render(<TvAvatar name="jackie" size={40} />);
  const el = screen.getByText("J");
  expect(el.style.width).toBe("40px");
  expect(el.style.height).toBe("40px");
  expect(el.style.fontSize).toBe("20px");
});

// (h) notify("info") → tv-toast-info 类名（现有只测了 warning）
test("notify info 种类渲染 tv-toast-info", () => {
  function Demo() {
    const notify = useNotify();
    return <button onClick={() => notify("info", "提示")}>发</button>;
  }
  render(<NotifyProvider><Demo /></NotifyProvider>);
  fireEvent.click(screen.getByText("发"));
  expect(document.querySelector(".tv-toast-info")).toHaveTextContent("提示");
});

// (i) tv-toast-host 的 aria role：status（读屏播报通道）
test("toast host 暴露 status 角色", () => {
  function Demo() {
    const notify = useNotify();
    return <button onClick={() => notify("error", "炸了")}>发</button>;
  }
  render(<NotifyProvider><Demo /></NotifyProvider>);
  fireEvent.click(screen.getByText("发"));
  expect(screen.getByRole("status").querySelector(".tv-toast")).not.toBeNull();
});
