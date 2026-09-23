/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

// vitest 对 `.css?raw` 走 CSS 管道可能返回空串，直接读磁盘原文
const css = readFileSync(join(process.cwd(), "src", "style.css"), "utf8");

// 从 CSS 文本剥离注释：类名/hljs 守卫须只看选择器与声明，注释里的字面类名不算命中
const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

// 三个主题变量块的捕获正则（选择器列表形态，.tv-root 恒为首项）：
// [^{]* 吃逗号列表与属性选择器，[^}]* 吃变量体（三块体内均无嵌套花括号）
const LIGHT_RE = /\.tv-root[^{]*\{([^}]*)\}/;
const MEDIA_RE = /\.tv-root:not\(\[data-theme="light"\]\)[^{]*\{([^}]*)\}/;
const DARK_RE = /\.tv-root\[data-theme="dark"\][^{]*\{([^}]*)\}/;
// 剥离用同形态（不带捕获组要求）；★ 剥离顺序不可调换：泛用形态也命中前两者，必须最后剥
const LIGHT_STRIP = /\.tv-root[^{]*\{[^}]*\}/;
const MEDIA_STRIP = /\.tv-root:not\(\[data-theme="light"\]\)[^{]*\{[^}]*\}/;
const DARK_STRIP = /\.tv-root\[data-theme="dark"\][^{]*\{[^}]*\}/;
const names = (s: string) => [...s.matchAll(/(--tv-[\w-]+)\s*:/g)].map((m) => m[1]).sort();

test("不得残留未前缀化的旧类名（chat-/anno-/delivery-/pair-/markdown/code-block/json-highlight）", () => {
  // (?:-[\w-]*)? 允许裸名：单处 .tv-markdown→.markdown 这类「漏网改名」也必须被抓到
  // （旧形态要求 markdown- 前缀的连字符，裸 .markdown 会静默放行）
  const bad = [...noComments.matchAll(/\.((?:chat|anno|delivery|pair|markdown|code-block|code-wrap|json-highlight|json-hl-line)(?:-[\w-]*)?)(?![\w-])/g)]
    .map((m) => m[1])
    .filter((c) => !c.startsWith("tv-"));
  expect(bad).toEqual([]);
});

test("三个主题变量块（浅色/媒体暗/显式暗）变量集合两两一致", () => {
  const light = css.match(LIGHT_RE)?.[1] ?? "";
  const media = css.match(MEDIA_RE)?.[1] ?? "";
  const dark = css.match(DARK_RE)?.[1] ?? "";
  // 防空命中静默退化的闸门：三块都必须真的被提取到
  for (const [name, body] of [["light", light], ["media", media], ["dark", dark]] as const) {
    expect(body, `${name} 块未命中`).not.toBe("");
  }
  expect(names(media)).toEqual(names(light));
  expect(names(dark)).toEqual(names(light));
  // 且提取的是对的块（H-1 自证）：若只捕到几十字符/0 变量，说明抓到的是布局规则而非变量块
  expect(names(light).length).toBeGreaterThanOrEqual(45);
});

test("媒体查询暗色尊重宿主 data-theme=light 强制", () => {
  expect(css).toMatch(/@media \(prefers-color-scheme:\s*dark\)\s*\{\s*\.tv-root:not\(\[data-theme="light"\]\)/);
});

test("H-1：二级导出组件类名出现在全部三个变量块的选择器列表中", () => {
  const hosts = [".tv-root", ".tv-anno-panel", ".tv-delivery-drawer"];
  for (const re of [LIGHT_RE, MEDIA_RE, DARK_RE]) {
    // ★ 必须跑 noComments：文件头注释里的字面 `.tv-root` 会让 light 块从注释起切片，
    // 「首位」与「成员」断言被注释恒真化（R-1：复审换位变异存活所致的守卫完整性缺陷）
    const m = noComments.match(re);
    expect(m, `变量块正则未命中：${re.source}`).not.toBeNull();
    // 取「块体 { 之前的选择器列表」，断言三个宿主类名都在
    const selectorList = noComments.slice(m?.index ?? 0, noComments.indexOf("{", m?.index ?? 0));
    for (const h of hosts) expect(selectorList, `选择器列表缺 ${h}`).toContain(h);
    // .tv-root 必须保持列表首项（媒体块正则与上一条断言的前提）
    expect(selectorList.trimStart().startsWith(".tv-root")).toBe(true);
  }
});

// 组件产出类名全量清单 —— task-14-annex.md §9 的 98 个缺口类名 + §9 叙述段点名的
// tv-confirming / tv-toast / tv-root / tv-json-hl-line 等，共 102 个 token，内联常量化（不运行时读 annex）。
// 评审者基线：102 个零命中集合为空；H-6 删掉 .tv-delivery-tree-dir 唯一规则后，该 token 须豁免存在性检查
// （组件仍产出该类名，但源项目本就无 dir 专用规则，目录/文件同为常规字重）。
const ANNEX_CLASSES: string[] = [
  "tv-anno-actions", "tv-anno-card", "tv-anno-card-author", "tv-anno-card-body", "tv-anno-card-edited",
  "tv-anno-card-editor", "tv-anno-card-editor-actions", "tv-anno-card-flash", "tv-anno-card-head",
  "tv-anno-card-time", "tv-anno-dead", "tv-anno-flash", "tv-anno-hover-only", "tv-anno-like", "tv-anno-mark",
  "tv-anno-panel", "tv-anno-panel-body", "tv-anno-panel-close", "tv-anno-panel-empty", "tv-anno-panel-head",
  "tv-anno-panel-open", "tv-anno-panel-trigger", "tv-anno-popover", "tv-anno-popover-actions",
  "tv-anno-popover-btn", "tv-anno-popover-editor", "tv-anno-quote", "tv-anno-replies", "tv-anno-reply",
  "tv-anno-reply-input", "tv-anno-reply-l2", "tv-anno-reply-toggle", "tv-anno-replying-to",
  "tv-anno-resolved-badge", "tv-anno-tabs", "tv-avatar-zero", "tv-chat-avatar", "tv-chat-body", "tv-chat-bubble",
  "tv-chat-card", "tv-chat-card-body", "tv-chat-card-text", "tv-chat-chevron", "tv-chat-content",
  "tv-chat-icon", "tv-chat-pairrow", "tv-chat-stream", "tv-chat-syscard", "tv-chat-table-actions",
  "tv-chat-table-body", "tv-chat-table-card", "tv-chat-table-copy", "tv-chat-table-head",
  "tv-chat-table-title", "tv-chat-thinkcard", "tv-chat-toolgroup", "tv-chat-toolresult", "tv-chat-turn",
  "tv-chat-user", "tv-code-block", "tv-code-nowrap", "tv-code-wrap", "tv-code-wrap-toggle",
  "tv-confirming", "tv-delivery-card", "tv-delivery-card-click", "tv-delivery-cards",
  "tv-delivery-drawer", "tv-delivery-drawer-close", "tv-delivery-drawer-head", "tv-delivery-drawer-open",
  "tv-delivery-drawer-trigger", "tv-delivery-icon", "tv-delivery-modal-list", "tv-delivery-name",
  "tv-delivery-sub", "tv-delivery-text", "tv-delivery-tree-chevron", "tv-delivery-tree-count",
  "tv-delivery-tree-dir", "tv-delivery-tree-row", "tv-dim", "tv-error-text", "tv-flow", "tv-json-hl-line",
  "tv-link-btn", "tv-main", "tv-markdown", "tv-msg-error", "tv-pair-args", "tv-pair-arrow", "tv-pair-body",
  "tv-pair-fail", "tv-pair-name", "tv-pair-result-sum", "tv-pair-sec", "tv-pair-sec-label", "tv-root",
  "tv-toast", "tv-tool-btn", "tv-toolbar", "tv-toolbar-actions",
];

// 边界正则：全文非锚定 + 「后随字符不得是类名字符」——
// 不用行锚定 ^\.tv-（会漏逗号列表第 2+ 个选择器），也不做裸 toContain（子串匹配，删规则块其子串仍在列表存活）
const classRe = (cls: string) => new RegExp("\\." + cls + "([^a-zA-Z0-9_-]|$)");

test("组件关键类名均有规则（task-14-annex §9 全量清单，带边界正则）", () => {
  for (const cls of ANNEX_CLASSES) {
    if (cls === "tv-delivery-tree-dir") {
      // H-6 授权删除其唯一规则：类名仍由 DeliveryDrawer.tsx 产出，但不应再有 dir 专用规则
      expect(noComments).not.toMatch(classRe(cls));
      continue;
    }
    expect(noComments, `类名 ${cls} 无规则`).toMatch(classRe(cls));
  }
});

test("规则体内不得出现硬编码十六进制颜色（颜色一律 var(--tv-*)）", () => {
  // 摘除三个变量定义块；剥离顺序不可调换（泛用形态也命中暗块，若先行会剥错块致暗色 hex 残留）
  const stripped = css
    .replace(MEDIA_STRIP, "")
    .replace(DARK_STRIP, "")
    .replace(LIGHT_STRIP, "");
  expect(stripped).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
});

test("H-4：--tv-danger-weak 必须至少被 var() 引用一次（防再退化为死变量）", () => {
  expect(css).toMatch(/var\(\s*--tv-danger-weak\s*[,)]/);
});

test("H-9：.hljs 选择器只允许以 .tv-root 后代形式出现", () => {
  // 剥注释后，把合法的「.tv-root .hljs…（含 .hljs-x .hljs-y 后代链）」整体移除，
  // 剩余文本不得再含裸 .hljs。
  // （dispatch 原形以 css.replace(/\.tv-root\s+/g,"") 剥前缀——剥后合法链仍以 .hljs 开头，
  //  且 :768 注释含字面 ".hljs"，两重恒红误报；此处按其语义意图实现）
  const scoped = noComments.replace(/\.tv-root\s+\.hljs[\w-]*(\s+\.hljs[\w-]*)*/g, "");
  expect(scoped).not.toMatch(/\.hljs/);
});

test("H-10：三个变量块之外的 rgba() 仅允许 3 处 box-shadow 豁免", () => {
  const stripped = css
    .replace(MEDIA_STRIP, "")
    .replace(DARK_STRIP, "")
    .replace(LIGHT_STRIP, "");
  // 三处豁免：.tv-segmented-item.active / 弹层与抽屉投影——黑透明阴影在暗色下仍成立（评审点名）
  expect([...stripped.matchAll(/rgba\(/g)].length).toBeLessThanOrEqual(3);
});

test("H-7：除豁免清单外不得存在零引用变量（逐行区分定义与引用）", () => {
  // 统计口径：定义行 `--tv-xxx:` 与引用 `var(--tv-xxx)` 分开匹配；
  // 不可「剥掉变量块再全文找 var()」——--tv-canvas 的唯一引用在变量块体内，会被连引用一起剥掉误杀（控制器实测踩过）
  const defined = new Set([...css.matchAll(/^\s*(--tv-[\w-]+)\s*:/gm)].map((m) => m[1]));
  const referenced = new Set([...css.matchAll(/var\(\s*(--tv-[\w-]+)\s*[,)]/g)].map((m) => m[1]));
  // 豁免：与 --tv-hljs-name 同值的冗余别名（浅暗两档逐值相等，零视觉偏差——H-8 判定不修）
  const EXEMPT = new Set(["--tv-hljs-addition"]);
  const dead = [...defined].filter((d) => !referenced.has(d) && !EXEMPT.has(d));
  expect(dead).toEqual([]);
});
