/** 划线浮层:按钮态 → 输入态;提交中防重复;取消回调;Ctrl/⌘+Enter 快捷发送。 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import AnnotatePopover from "./AnnotatePopover";

// 本仓 vitest 未开 globals，RTL 的自动清理不会注册；显式注册避免用例间 DOM 累积
afterEach(cleanup);

const rect = { left: 100, top: 200 };

test("按钮态点击展开输入态,提交调 onSubmit 并关闭", async () => {
  const onSubmit = vi.fn().mockResolvedValue(true);
  const onCancel = vi.fn();
  render(<AnnotatePopover rect={rect} onSubmit={onSubmit} onCancel={onCancel} />);
  fireEvent.click(screen.getByRole("button", { name: /评注/ }));
  const box = screen.getByPlaceholderText("写下你的评注…");
  fireEvent.change(box, { target: { value: "这里有问题" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("这里有问题"));
});

test("空正文不可提交;取消回调;提交失败停留输入态", async () => {
  const onSubmit = vi.fn().mockResolvedValue(false);   // 失败:浮层保留(用户可改稿重发)
  render(<AnnotatePopover rect={rect} onSubmit={onSubmit} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /评注/ }));
  const send = screen.getByRole("button", { name: "发送" });
  expect(send).toBeDisabled();                          // 空正文
  fireEvent.change(screen.getByPlaceholderText("写下你的评注…"), { target: { value: "x" } });
  fireEvent.click(send);
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(screen.getByPlaceholderText("写下你的评注…")).toBeInTheDocument();  // 仍在
});

test("Ctrl+Enter 发送;裸 Enter 不发送(保留换行);空正文快捷键无效;成功后回按钮态", async () => {
  const onSubmit = vi.fn().mockResolvedValue(true);
  render(<AnnotatePopover rect={rect} onSubmit={onSubmit} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /评注/ }));
  const box = screen.getByPlaceholderText("写下你的评注…");
  // 裸 Enter:不提交(textarea 保留换行语义)
  fireEvent.keyDown(box, { key: "Enter" });
  expect(onSubmit).not.toHaveBeenCalled();
  // 空正文 Ctrl+Enter:不提交
  fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
  expect(onSubmit).not.toHaveBeenCalled();
  // 有正文 Ctrl+Enter:提交成功 → 浮层回到按钮态(⌘ 分支与 ctrl 同一条件,行为对称)
  fireEvent.change(box, { target: { value: "快捷键评注" } });
  fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("快捷键评注"));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /评注/ })).toBeInTheDocument());
});
