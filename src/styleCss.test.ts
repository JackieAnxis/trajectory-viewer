/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

// vitest 对 `.css?raw` 走 CSS 管道可能返回空串，直接读磁盘原文
const css = readFileSync(join(process.cwd(), "src", "style.css"), "utf8");

test("不得残留未前缀化的旧类名（chat-/anno-/delivery-/pair-/markdown/code-block/json-highlight）", () => {
  const bad = [...css.matchAll(/\.((?:chat|anno|delivery|pair|markdown|code-block|code-wrap|json-highlight|json-hl-line)-[\w-]*)/g)]
    .map((m) => m[1])
    .filter((c) => !c.startsWith("tv-"));
  expect(bad).toEqual([]);
});

test("暗色 data-theme 块与浅色根块变量集合一致", () => {
  const light = css.match(/\.tv-root\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  const dark = css.match(/\.tv-root\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  expect(dark).not.toBe("");
  const names = (s: string) => [...s.matchAll(/(--tv-[\w-]+)\s*:/g)].map((m) => m[1]).sort();
  expect(names(dark)).toEqual(names(light));
});

test("媒体查询暗色尊重宿主 data-theme=light 强制", () => {
  expect(css).toMatch(/@media \(prefers-color-scheme:\s*dark\)\s*\{\s*\.tv-root:not\(\[data-theme="light"\]\)/);
});

test("组件关键类名均有规则（抽样）", () => {
  for (const cls of [
    ".tv-chat-stream", ".tv-chat-bubble", ".tv-chat-pairrow", ".tv-anno-mark",
    ".tv-anno-popover", ".tv-anno-panel", ".tv-anno-card", ".tv-delivery-card",
    ".tv-delivery-drawer", ".tv-delivery-tree-row", ".tv-markdown", ".tv-code-block",
    ".tv-json-highlight", ".tv-toolbar", ".tv-flow", ".hljs-keyword",
  ]) {
    expect(css).toContain(cls);
  }
});

test("规则体内不得出现硬编码十六进制颜色（颜色一律 var(--tv-*)）", () => {
  // 摘除变量定义块（.tv-root 浅色块与两个暗色块）后，其余规则体不允许 #hex 色值
  const stripped = css
    .replace(/\.tv-root\s*\{[\s\S]*?\}/, "")
    .replace(/\.tv-root:not\(\[data-theme="light"\]\)\s*\{[\s\S]*?\}/, "")
    .replace(/\.tv-root\[data-theme="dark"\]\s*\{[\s\S]*?\}/, "");
  expect(stripped).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
});
