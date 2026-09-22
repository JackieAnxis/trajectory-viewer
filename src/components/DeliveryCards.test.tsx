import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import DeliveryCards from "./DeliveryCards";

// 本仓 vitest 未开 globals，RTL 的自动清理不会注册；显式注册避免用例间 DOM 累积
afterEach(cleanup);

// jsdom 无弹窗能力，stub window.open 验证新标签页跳转
const mockOpen = vi.fn();
vi.stubGlobal("open", mockOpen);

const noop = () => {};

beforeEach(() => {
  vi.clearAllMocks();
});

test("单文件：同样渲染「全部文件」卡片，点击触发面板开合回调（不再直接新标签页打开）", () => {
  const onToggle = vi.fn();
  render(<DeliveryCards delivery={["./d/a.html"]} panelOpen={false} onTogglePanel={onToggle} />);
  const card = screen.getByRole("button", { name: /全部文件/ });
  expect(screen.getByText(/1 个文件/)).toBeInTheDocument();

  fireEvent.click(card);
  expect(onToggle).toHaveBeenCalledTimes(1);
  expect(mockOpen).not.toHaveBeenCalled();
});

test("多文件：底部「全部文件」卡片，点击触发面板开合回调", () => {
  const onToggle = vi.fn();
  const { rerender } = render(
    <DeliveryCards
      delivery={["./d/001/proj/a.html", "./d/001/proj/b.js"]}
      panelOpen={false}
      onTogglePanel={onToggle}
    />,
  );
  const card = screen.getByRole("button", { name: /全部文件/ });
  expect(screen.getByText(/2 个文件/)).toBeInTheDocument();
  expect(card.getAttribute("aria-expanded")).toBe("false");
  // 点击整卡不直接开文件，而是请求开合右侧抽屉（由 RecordDetail 并排渲染）
  fireEvent.click(card);
  expect(onToggle).toHaveBeenCalledTimes(1);
  expect(mockOpen).not.toHaveBeenCalled();
  // 展开态反映到 aria
  rerender(
    <DeliveryCards
      delivery={["./d/001/proj/a.html", "./d/001/proj/b.js"]}
      panelOpen
      onTogglePanel={onToggle}
    />,
  );
  expect(screen.getByRole("button", { name: /全部文件/ }).getAttribute("aria-expanded")).toBe("true");
});

test("无 delivery 不渲染任何卡片", () => {
  const { container } = render(<DeliveryCards delivery={[]} panelOpen={false} onTogglePanel={noop} />);
  expect(container.querySelector(".tv-delivery-card")).toBeNull();
});
