import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import JsonHighlight from "./JsonHighlight";

// 本仓 vitest 未开启 globals，RTL 自动清理不会注册；本文件多次 render，需显式清理
afterEach(cleanup);

test("highlights an object JSON with key/string/number/boolean spans", () => {
  render(<JsonHighlight text='{"tokens":1234,"ok":true,"name":"x"}' />);
  expect(screen.getByText('"tokens"')).toBeInTheDocument();
  expect(screen.getByText("1234")).toBeInTheDocument();
  expect(screen.getByText("true")).toBeInTheDocument();
  expect(screen.getByText('"x"')).toBeInTheDocument();
});

test("highlights arrays", () => {
  render(<JsonHighlight text='[1,"a",false]' />);
  expect(screen.getByText("1")).toBeInTheDocument();
  expect(screen.getByText('"a"')).toBeInTheDocument();
  expect(screen.getByText("false")).toBeInTheDocument();
});

test("falls back to plain pre for non-JSON text (no spans)", () => {
  const { container } = render(<JsonHighlight text="plain text" />);
  expect(container.querySelector("pre")).toHaveTextContent("plain text");
  expect(container.querySelectorAll("span")).toHaveLength(0);
});

test("does not highlight a bare JSON string or number", () => {
  const { container } = render(<JsonHighlight text='"just a string"' />);
  expect(container.querySelector("pre")).toHaveTextContent('"just a string"');
  expect(container.querySelectorAll("span")).toHaveLength(0);
});

test("empty object and array render braces without crashing", () => {
  const { container } = render(<JsonHighlight text="{}" />);
  expect(container.querySelector("pre")).toBeInTheDocument();
  const { container: c2 } = render(<JsonHighlight text="[]" />);
  expect(c2.querySelector("pre")).toBeInTheDocument();
});

test("超长字符串值不换行溢出：行容器启用软换行且结构缩进保留", () => {
  const longCmd = "cd /home/ma-user/.openclaw/workspace && " + "ls -la && ".repeat(20);
  const text = JSON.stringify({ command: longCmd }, null, 2);
  const { container } = render(<JsonHighlight text={text} />);
  // 行容器（tv-json-highlight 的每个 div）须允许软换行，超长 token 不撑破容器
  const rows = container.querySelectorAll(".tv-json-highlight > div");
  expect(rows.length).toBeGreaterThan(1);
  for (const row of rows) {
    expect(row.className).toContain("tv-json-hl-line");
  }
  // 缩进仍以 paddingLeft 表达（>1 层嵌套时非 0）
  const indented = [...rows].find((r) => (r as HTMLElement).style.paddingLeft !== "0px" && (r as HTMLElement).style.paddingLeft !== "");
  expect(indented).toBeDefined();
});

test("颜色经 CSS 类名承载：键/字符串/数字/布尔/null 各归其类", () => {
  // 顶层键值对使键 span 与值 span 落在同一行节点上；值类型各异以覆盖全部叶子分支
  const { container } = render(<JsonHighlight text='{"k":"s","n":1,"b":true,"z":null}' />);
  expect(container.querySelector(".tv-jk")).toHaveTextContent('"k"');
  expect(container.querySelector(".tv-js")).toHaveTextContent('"s"');
  expect(container.querySelector(".tv-jn")).toHaveTextContent("1");
  expect(container.querySelector(".tv-jb")).toHaveTextContent("true");
  expect(container.querySelector(".tv-jl")).toHaveTextContent("null");
});

// E-M1（Ruling 22）：标点必须由 .tv-jp 包裹是样式契约——arrayContaining 锁语义
// （标点被包裹）而非具体序列，出现顺序/数量允许实现微调
test("tv-jp 标点包裹：花括号与键值分隔符各归其 span", () => {
  const { container } = render(<JsonHighlight text='{"k":1}' />);
  const toks = [...container.querySelectorAll(".tv-jp")].map((el) => el.textContent);
  expect(toks).toEqual(expect.arrayContaining(["{", "}", ": "]));
});
