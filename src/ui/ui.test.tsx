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
  // 用 fireEvent.click 而非原生 el.click()：RTL 只对 fireEvent 套 act()，
  // 原生 click 在 React 18 并发根下不会同步刷新 DOM，断言读不到新状态
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
