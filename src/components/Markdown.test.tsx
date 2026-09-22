import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import Markdown from "./Markdown";

// 本仓 vitest 未开启 globals，RTL 自动清理不会注册；本文件多次 render，需显式清理
afterEach(cleanup);

const TABLE_MD = `| 维度 | 说明 |
|---|---|
| 渲染 | canvas 2d |`;

test("表格被 .tv-chat-table-card 卡片容器包裹", () => {
  const { container } = render(<Markdown>{TABLE_MD}</Markdown>);
  const card = container.querySelector(".tv-chat-table-card");
  expect(card).not.toBeNull();
  expect(card?.querySelector("table")).not.toBeNull();
});

test("卡片头部含「表格」标题与复制按钮", () => {
  const { container } = render(<Markdown>{TABLE_MD}</Markdown>);
  const head = container.querySelector(".tv-chat-table-head");
  expect(head?.textContent).toContain("表格");
  expect(container.querySelector(".tv-chat-table-copy")).not.toBeNull();
});

test("非表格内容不产生卡片容器", () => {
  const { container } = render(<Markdown>普通段落文本</Markdown>);
  expect(container.querySelector(".tv-chat-table-card")).toBeNull();
});

const CODE_MD = "```js\nconst a = 1;\n```";

test("代码块默认自动换行（tv-code-wrap），按钮为图标且提示「自动换行」", () => {
  const { container } = render(<Markdown>{CODE_MD}</Markdown>);
  const block = container.querySelector(".tv-code-block");
  expect(block).toBeInTheDocument();
  expect(block).toHaveClass("tv-code-wrap");
  expect(block?.querySelector("pre code")).toBeInTheDocument();
  const btn = container.querySelector(".tv-code-wrap-toggle");
  // 图标按钮：FA svg（当前状态图标），无文字
  expect(btn?.querySelector("svg[data-icon='bars']")).not.toBeNull();
  expect(btn?.textContent).toBe("");
  // aria 提示 = 当前换行状态
  expect(btn?.getAttribute("aria-label")).toBe("自动换行");
});

test("按钮提示经 data-tip 承载（自动换行）", () => {
  const { container } = render(<Markdown>{CODE_MD}</Markdown>);
  const tip = container.querySelector(".tv-code-wrap-toggle")?.closest(".tv-tip");
  expect(tip).toHaveAttribute("data-tip", "自动换行");
});

test("点击按钮切换为不换行（tv-code-nowrap），图标与提示同步切换，再点切回", () => {
  const { container } = render(<Markdown>{CODE_MD}</Markdown>);
  const block = container.querySelector(".tv-code-block")!;
  const btn = container.querySelector(".tv-code-wrap-toggle")!;
  fireEvent.click(btn);
  expect(block).toHaveClass("tv-code-nowrap");
  expect(btn.getAttribute("aria-label")).toBe("不自动换行");
  expect(btn.querySelector("svg")?.getAttribute("data-icon")).toBe("minus");
  fireEvent.click(btn);
  expect(block).toHaveClass("tv-code-wrap");
  expect(btn.getAttribute("aria-label")).toBe("自动换行");
  expect(btn.querySelector("svg")?.getAttribute("data-icon")).toBe("bars");
});

test("多个代码块各自独立切换", () => {
  const { container } = render(<Markdown>{CODE_MD + "\n" + CODE_MD}</Markdown>);
  const blocks = container.querySelectorAll(".tv-code-block");
  expect(blocks.length).toBe(2);
  fireEvent.click(blocks[1].querySelector(".tv-code-wrap-toggle")!);
  expect(blocks[0]).toHaveClass("tv-code-wrap");
  expect(blocks[1]).toHaveClass("tv-code-nowrap");
  expect(blocks[0].querySelector(".tv-code-wrap-toggle")?.getAttribute("aria-label")).toBe("自动换行");
  expect(blocks[1].querySelector(".tv-code-wrap-toggle")?.getAttribute("aria-label")).toBe("不自动换行");
});

test("普通段落不产生代码块容器", () => {
  const { container } = render(<Markdown>普通段落文本</Markdown>);
  expect(container.querySelector(".tv-code-block")).toBeNull();
});

test("标注语言的代码块应用语法高亮（.hljs 类与 token span）", () => {
  const { container } = render(<Markdown>{CODE_MD}</Markdown>);
  const code = container.querySelector(".tv-code-block pre code");
  expect(code).toHaveClass("hljs");
  // `const` 应被识别为关键字 token
  expect(container.querySelector(".tv-code-block .hljs-keyword")).not.toBeNull();
});

test("未标注语言的代码块不高亮且不报错", () => {
  const { container } = render(<Markdown>{"```\nplain text\n```"}</Markdown>);
  const block = container.querySelector(".tv-code-block");
  expect(block).toBeInTheDocument();
  expect(block?.querySelector("code")).not.toBeNull();
  // 未指定语言时 rehype-highlight 不做高亮（detect 关闭）
  expect(block?.querySelector("code.hljs")).toBeNull();
});
