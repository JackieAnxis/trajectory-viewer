# Trajectory Viewer 独立组件包实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 trajectory-data-reviewer 的 MessageStream 及其依赖链抽取为零 UI 框架依赖的独立 React 组件包 `trajectory-viewer`（消息流 + 划线评论/评论面板 + 交付物抽屉 + 可插拔原数据视图）。

**Architecture:** 三层结构——`core/` 纯逻辑（照搬）、`data/` 状态 hook（分页/原数据/评论，适配器驱动）、`components/` 受控渲染层；对外只暴露 `<TrajectoryViewer>` 组合组件与两个适配器接口（`TrajectoryDataSource`/`AnnotationStore`）。antd 全部去除（7 种小件自绘），样式为 CSS 变量 + tv- 前缀 + 暗色支持，tsup 出 ESM/CJS/d.ts/style.css。

**Tech Stack:** React 18（peer ^18||^19）、TypeScript strict、tsup、vitest + jsdom + Testing Library、react-markdown + remark-gfm + rehype-highlight、FontAwesome、Vite（demo 与测试）。

**Spec:** `docs/superpowers/specs/2026-09-22-trajectory-viewer-design.md`

## Global Constraints

每个任务的要求都隐含包含本节。

- **源文件路径前缀**（搬迁用，下称 `SRC`）：`/Users/jackie/Repositories/trajectory-data-reviewer/frontend/src`
- 目标仓库：`/Users/jackie/Repositories/trajectory-viewer`（当前空仓库，main 分支，直接提交）
- 代码注释与 UI 文案一律中文；commit 信息格式 `type: 中文描述`（type ∈ feat/test/docs/chore/refactor），末尾带 `Co-Authored-By: Claude Code <noreply@anthropic.com>`
- **禁止** import `antd`、`monaco-editor`、`@monaco-editor/react`、`react-router-dom`
- 类名一律 `tv-` 前缀；`data-msg-idx`/`data-region`/`data-sub`/`data-anno-id` 锚点属性名不变（划线功能依赖）
- 状态修饰类（`is-fail`/`is-orphan`/`liked`/`active`/`open`/`sec-args`/`sec-fail`）保持原名，但 CSS 选择器必须始终与某个 `tv-` 前缀类复合出现（如 `.tv-anno-like.liked`）
- 颜色一律经 `var(--tv-*)` 引用，禁止在组件内联硬编码色值
- 分页常量 `PAGE = 300`；哨兵 `rootMargin: "200px"`；跨页定位上限 200 页；闪烁动画 1600ms
- 每任务结束：`npx tsc --noEmit` 与 `npx vitest run` 全绿后 commit
- **测试环境不开启 vitest globals**（`expect`/`test`/`afterEach` 一律显式 import）。**连带后果**：RTL 的自动清理靠探测全局 `afterEach` 才注册（`node_modules/@testing-library/react/dist/index.js`），globals 关闭时完全不注册，用例间 DOM 会累积、后续用例报 `Found multiple elements with role`。因此**凡含交互或多次 `render` 的测试文件，必须显式 `afterEach(cleanup)`**；源项目（`SRC/../vite.config.ts` 设 `globals: true`）无此负担，搬迁时不得省略该 import。
- **测试交互一律用 `fireEvent`，禁止裸 `el.click()`**：React 18 并发根下，裸 `.click()` 走 React 自己的事件委托、不经 RTL 的 `act()` 包装，而 React 18 并发根对非 `act` 来源的离散事件不保证同步 flush（实测：即便手动置 `IS_REACT_ACT_ENVIRONMENT = true` 仍不同步），`setState` 的更新不会同步落到 DOM，紧随其后的断言必失败；同理 `vi.advanceTimersByTime()` 推进的定时器回调须包在 `act(() => { … })` 内。`fireEvent` / `userEvent` 由 RTL 的 `eventWrapper` 自动套 `act()`，是唯一可靠写法。（源项目因开了 globals 且多数用例只用 `fireEvent` 而未暴露此问题；本仓 Task 5 实现者已实测并逐条修正。）

### 全局类名重命名表（搬迁代码统一适用）

| 旧 | 新 |
|---|---|
| `chat-*`（全部，如 chat-stream/chat-card/chat-pairrow/chat-table-card…） | `tv-chat-*` |
| `pair-*`（pair-name/pair-args/pair-arrow/pair-result-sum/pair-fail/pair-body/pair-sec/pair-sec-label） | `tv-pair-*` |
| `anno-*`（anno-mark/anno-flash/anno-popover*/anno-panel*/anno-card*/anno-actions/anno-like/anno-resolved-badge/anno-hover-only/anno-replies/anno-reply*/anno-quote/anno-dead/anno-replying-to/anno-reply-input/anno-reply-toggle） | `tv-anno-*` |
| `delivery-*`（delivery-cards/delivery-card*/delivery-icon/delivery-text/delivery-name/delivery-sub/delivery-drawer*/delivery-tree-*/delivery-modal-list） | `tv-delivery-*` |
| `markdown` | `tv-markdown` |
| `code-block` / `code-wrap` / `code-nowrap` / `code-wrap-toggle` | `tv-code-block` / `tv-code-wrap` / `tv-code-nowrap` / `tv-code-wrap-toggle` |
| `json-highlight` / `json-hl-line` | `tv-json-highlight` / `tv-json-hl-line` |
| `avatar-zero` | `tv-avatar-zero` |
| `hljs` / `hljs-*`（第三方 token 类） | **不变** |
| `data-anno-card` 属性 | `data-tv-anno-card` |
| `@keyframes anno-flash` / `anno-card-flash` | `@keyframes tv-anno-flash` / `tv-anno-card-flash` |

等价 sed（macOS 自带 BSD sed；**每个文件只执行一次**，重复执行会产生 `tv-tv-` 双前缀；**BSD sed 的 `\b` 不匹配任何内容（替换零发生、会静默假绿），一律改用 `[[:<:]]`（词首）/`[[:>:]]`（词尾）**；`[[:<:]]code-wrap[[:>:]]` 单规则即可同时正确重命名 `code-wrap` 与 `code-wrap-toggle`，不得再为其单独立规则——串联会产生 `tv-tv-code-wrap-toggle`；`markdown` 只匹配类名字符串与选择器两种形态，防止腐蚀 `react-markdown` 包名导入；凡含 `anno-` 的规则行必须紧随一条 `s/data-tv-anno-id/data-anno-id/g` 纠正规则——`data-anno-id` 是划线定位契约属性，只改类名、不改属性名；`[[:<:]]`/`[[:>:]]` 是 BSD 扩展，**本搬迁脚本仅在 macOS 自带 BSD sed 下执行**，若将来需在 GNU sed / Linux CI 上重放，须改用可移植写法 `s/(^|[^A-Za-z0-9_-])anno-/\1tv-anno-/g` 这一形态，否则 GNU sed 会把 `[[:<:]]` 当字面量匹配、重演「静默零替换」）：

```bash
sed -i '' -E \
  -e 's/[[:<:]]code-nowrap[[:>:]]/tv-code-nowrap/g' \
  -e 's/[[:<:]]code-block[[:>:]]/tv-code-block/g' \
  -e 's/[[:<:]]code-wrap[[:>:]]/tv-code-wrap/g' \
  -e 's/[[:<:]]json-highlight[[:>:]]/tv-json-highlight/g' \
  -e 's/[[:<:]]json-hl-line[[:>:]]/tv-json-hl-line/g' \
  -e 's/[[:<:]]avatar-zero[[:>:]]/tv-avatar-zero/g' \
  -e 's/[[:<:]]chat-/tv-chat-/g' \
  -e 's/[[:<:]]anno-/tv-anno-/g' -e 's/data-tv-anno-id/data-anno-id/g' \
  -e 's/[[:<:]]delivery-/tv-delivery-/g' \
  -e 's/[[:<:]]pair-/tv-pair-/g' \
  -e 's/"markdown"/"tv-markdown"/g' \
  -e 's/\.markdown[[:>:]]/.tv-markdown/g' \
  -e 's/[[:<:]]data-anno-card[[:>:]]/data-tv-anno-card/g' \
  <file>
```

---

### Task 1: 工程脚手架 + 公共类型

**Files:**
- Create: `package.json`、`tsconfig.json`、`tsup.config.ts`、`vite.config.ts`、`.gitignore`、`src/test-setup.ts`、`src/types.ts`
- Test: `src/types.test.ts`

**Interfaces:**
- Consumes: 无
- Produces（后续所有任务依赖，签名见 `src/types.ts` 全文）: `Msg`、`ToolCall`、`MsgPage`、`AnnotationRegion`、`AnchorInput`、`AnnotationReply`、`Annotation`、`LikeResult`、`TrajectoryDataSource`、`AnnotationStore`、`NotifyKind`

- [ ] **Step 1: 写入脚手架文件**

`package.json`：

```json
{
  "name": "trajectory-viewer",
  "version": "0.1.0",
  "description": "聊天式轨迹查看 React 组件：消息流、划线评论、交付物抽屉、可插拔原数据视图",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs" },
    "./style.css": "./dist/style.css"
  },
  "files": ["dist"],
  "sideEffects": ["*.css"],
  "scripts": {
    "build": "tsup",
    "dev": "vite demo",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "npm run build && npm run test"
  },
  "peerDependencies": {
    "react": "^18.3.1 || ^19.0.0",
    "react-dom": "^18.3.1 || ^19.0.0"
  },
  "dependencies": {
    "@fortawesome/fontawesome-svg-core": "^7.3.1",
    "@fortawesome/free-brands-svg-icons": "^7.3.1",
    "@fortawesome/free-solid-svg-icons": "^7.3.1",
    "@fortawesome/react-fontawesome": "^3.5.0",
    "react-markdown": "^10.1.0",
    "rehype-highlight": "^7.0.2",
    "remark-gfm": "^4.0.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^14.2.0",
    "@types/node": "^22.20.2",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^24.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "tsup": "^8.0.0",
    "typescript": "^5.4.5",
    "vite": "^5.3.1",
    "vitest": "^1.6.0"
  }
}
```

`tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src", "demo", "vite.config.ts"]
}
```

`tsup.config.ts`（样式不经打包器：构建完成后原样拷贝，接入方显式 `import "trajectory-viewer/style.css"`）：

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["react", "react-dom", "react/jsx-runtime"],
  onSuccess: "cp src/style.css dist/style.css",
});
```

`vite.config.ts`（vitest 与 demo dev 共用）：

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", setupFiles: ["src/test-setup.ts"] },
});
```

`.gitignore`：

```
node_modules/
dist/
```

`src/test-setup.ts`：整文件照搬 `SRC/test-setup.ts`（jest-dom 引入 + matchMedia/IntersectionObserver/scrollIntoView stub，原样拷贝无需修改）。

- [ ] **Step 2: 写 `src/types.ts`（完整内容）**

```ts
/** 消息中的工具调用 */
export interface ToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

/** 单条消息（保留源项目全部字段：列表场景可能用到 preview/计数，不瘦身） */
export interface Msg {
  idx: number;
  role: string;
  preview: string;
  content_len: number;
  content: string;
  reasoning_len: number;
  reasoning_content?: string | null;
  tool_calls?: ToolCall[] | null;
  weight?: number | null;
  tool_call_id?: string | null;
}

/** 消息分页响应 */
export interface MsgPage {
  messages: Msg[];
  from: number;
  returned: number;
  has_more: boolean;
}

/** 批注锚点区块 */
export type AnnotationRegion = "content" | "reasoning" | "args";

/** 划线建楼输入：锚点五元组（prefix/suffix 客户端截 32 字符） */
export interface AnchorInput {
  msg_idx: number;
  region: AnnotationRegion;
  sub: number | null;          // region='args' 时 tool_calls 下标，其余 null
  quote: string;
  prefix: string;
  suffix: string;
}

/** 批注回复（平铺；组件按 parent_id 组两层树） */
export interface AnnotationReply {
  id: number;
  annotation_id: number;
  parent_id: number | null;    // null=一级；二级指向一级（更深层由持久层压平）
  author: string;
  body: string;
  created_at: number;
  updated_at: number;          // > created_at 时显示「已编辑」
  like_count: number;
  liked_by_me: boolean;
}

/** 批注楼：锚点五元组 + 首评 + 解决态 + 回复平铺（已去后端寻址字段 item_owner/item_name/line） */
export interface Annotation {
  id: number;
  msg_idx: number;
  region: AnnotationRegion;
  sub: number | null;
  quote: string;
  prefix: string;
  suffix: string;
  author: string;
  body: string;
  resolved: number;            // 0/1 布尔
  resolved_by: string | null;
  resolved_at: number | null;
  created_at: number;
  updated_at: number;
  like_count: number;
  liked_by_me: boolean;
  replies: AnnotationReply[];
}

/** 点赞结果（setLike 响应即现状，用于本地增量不重拉） */
export interface LikeResult {
  likeCount: number;
  likedByMe: boolean;
}

/** 数据源适配器：宿主注入；寻址（item/line 等）封装在适配器闭包内，组件不感知 */
export interface TrajectoryDataSource {
  /** 分页拉消息 */
  fetchMessages(query: { from: number; limit: number }): Promise<MsgPage>;
  /** 拉原数据（进入 raw 视图时懒调用） */
  fetchRaw(): Promise<unknown>;
}

/** 评论存储适配器；写操作（除 setLike）成功后组件自动重拉 list */
export interface AnnotationStore {
  list(): Promise<Annotation[]>;
  create(input: AnchorInput & { body: string }): Promise<unknown>;
  reply(annotationId: number, body: string, parentId?: number | null): Promise<unknown>;
  update(id: number, body: string, kind: "annotation" | "reply"): Promise<unknown>;
  delete(id: number, kind: "annotation" | "reply"): Promise<void>;
  setResolved(id: number, resolved: boolean): Promise<unknown>;
  setLike(targetId: number, kind: "annotation" | "reply", liked: boolean): Promise<LikeResult>;
}

/** 全局通知级别（替代 antd message） */
export type NotifyKind = "error" | "warning" | "info";
```

- [ ] **Step 3: 写冒烟测试 `src/types.test.ts`**

```ts
import { expect, test } from "vitest";
import type { MsgPage } from "./types";

test("脚手架自检：MsgPage 可构造", () => {
  const page: MsgPage = { messages: [], from: 0, returned: 0, has_more: false };
  expect(page.has_more).toBe(false);
});
```

- [ ] **Step 4: 安装依赖并验证**

Run: `npm install && npx tsc --noEmit && npx vitest run`
Expected: 依赖安装成功；tsc 无错误；vitest 1 passed

- [ ] **Step 5: 验证构建**

Run: `npx tsup`（此时 `src/index.ts` 尚不存在，预期失败）
改为先建占位：`echo "export {};" > src/index.ts`，再 Run: `npx tsup`
Expected: 产出 `dist/index.js`、`dist/index.cjs`、`dist/index.d.ts`（onSuccess 的 cp 因 `src/style.css` 不存在会报错——临时 `touch src/style.css`；Task 5 填充其内容）

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: 工程脚手架与公共类型定义

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: core/chatModel.ts 纯逻辑搬迁

**Files:**
- Create: `src/core/chatModel.ts`
- Test: `src/core/chatModel.test.ts`

**Interfaces:**
- Consumes: `Msg`、`ToolCall`（`../types`）
- Produces: `ChatNode`、`ToolPair`、`looksLikeJson(text)`、`firstLine(text, max?)`、`callSummary(name, args)`、`isFailedResult(text)`、`stripUserMeta(content)`、`groupMessages(msgs)`

- [ ] **Step 1: 拷贝测试（先失败）**

```bash
cp SRC/components/chatModel.test.ts src/core/chatModel.test.ts
```

将测试内 `from "./chatModel"` 保持不变（同名同目录）；类型导入若有 `../types` 保持不变。Run: `npx vitest run src/core/chatModel.test.ts`
Expected: FAIL（`Cannot find module './chatModel'`）

- [ ] **Step 2: 拷贝实现并验证**

```bash
cp SRC/components/chatModel.ts src/core/chatModel.ts
```

该文件只 import `../types`（路径已正确），无类名引用，**无需 sed**。Run: `npx vitest run src/core/chatModel.test.ts && npx tsc --noEmit`
Expected: 全绿

- [ ] **Step 3: Commit**

```bash
git add src/core/
git commit -m "feat: 搬迁 chatModel 消息分组纯逻辑

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---
### Task 3: core/annotationAnchor.ts 锚定纯逻辑搬迁

**Files:**
- Create: `src/core/annotationAnchor.ts`
- Test: `src/core/annotationAnchor.test.ts`

**Interfaces:**
- Consumes: `AnchorInput`（`../types`）
- Produces: `TextMap`、`textMap(block)`、`selectionToAnchor(sel)`、`blockSelector(a)`、`reanchor(block, a)`、`applyMarks(block, hits)`、`clearMarks(root)`、`overlapsMark(sel)`

- [ ] **Step 1: 拷贝测试并应用类名重命名（先失败）**

```bash
cp SRC/components/annotationAnchor.test.ts src/core/annotationAnchor.test.ts
sed -i '' -E -e 's/[[:<:]]anno-/tv-anno-/g' -e 's/data-tv-anno-id/data-anno-id/g' -e 's/[[:<:]]chat-/tv-chat-/g' src/core/annotationAnchor.test.ts
```

（测试里构造的 DOM fixture 与选择器字符串含 `anno-mark` 等类名，一并重命名。）Run: `npx vitest run src/core/annotationAnchor.test.ts`
Expected: FAIL（`Cannot find module './annotationAnchor'`）

- [ ] **Step 2: 拷贝实现 + 重命名并验证**

```bash
cp SRC/components/annotationAnchor.ts src/core/annotationAnchor.ts
sed -i '' -E -e 's/[[:<:]]anno-/tv-anno-/g' -e 's/data-tv-anno-id/data-anno-id/g' src/core/annotationAnchor.ts
```

该文件只 import `../types`；`closestBlock`/`blockSelector` 走 `data-msg-idx`/`data-region` 属性（不变）；`clearMarks`/`overlapsMark` 内的 `mark.anno-mark` 选择器经 sed 变为 `mark.tv-anno-mark`。Run: `npx vitest run src/core/annotationAnchor.test.ts && npx tsc --noEmit`
Expected: 全绿

- [ ] **Step 3: Commit**

```bash
git add src/core/
git commit -m "feat: 搬迁 annotationAnchor 划线锚定纯逻辑（mark 类名 tv- 前缀化）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: core/deliveryTree.ts + ui/avatarColor.ts 搬迁

**Files:**
- Create: `src/core/deliveryTree.ts`、`src/ui/avatarColor.ts`
- Test: `src/core/deliveryTree.test.ts`、`src/ui/avatarColor.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `TreeDir`、`TreeFile`、`TreeNode`、`TreeRoot`、`buildTree(paths)`；`avatarColor(username): string`

- [ ] **Step 1: 拷贝 deliveryTree 测试（先失败）**

```bash
cp SRC/components/deliveryTree.test.ts src/core/deliveryTree.test.ts
```

Run: `npx vitest run src/core/deliveryTree.test.ts`
Expected: FAIL（`Cannot find module './deliveryTree'`）

- [ ] **Step 2: 拷贝 deliveryTree 实现并验证**

```bash
cp SRC/components/deliveryTree.ts src/core/deliveryTree.ts
```

零依赖零类名，无需改动。Run: `npx vitest run src/core/deliveryTree.test.ts`
Expected: PASS

- [ ] **Step 3: 写 `src/ui/avatarColor.test.ts`（先失败）**

```ts
import { expect, test } from "vitest";
import { avatarColor } from "./avatarColor";

test("同名同哈希取色稳定，且为合法 HSL", () => {
  const c1 = avatarColor("jackie");
  expect(c1).toBe(avatarColor("jackie"));
  expect(c1).toMatch(/^hsl\(\d+, 65%, 45%\)$/);
});

test("不同名一般取不同 hue", () => {
  expect(avatarColor("alice")).not.toBe(avatarColor("bob"));
});
```

Run: `npx vitest run src/ui/avatarColor.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 拷贝 avatarColor 实现并验证**

```bash
cp SRC/components/avatarColor.ts src/ui/avatarColor.ts
```

Run: `npx vitest run src/ui/avatarColor.test.ts && npx tsc --noEmit`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "feat: 搬迁 deliveryTree 目录树与 avatarColor 头像取色

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: ui/ 去 antd 基础小件 + style.css 基建段

**Files:**
- Create: `src/ui/TvTooltip.tsx`、`src/ui/TvSegmented.tsx`、`src/ui/TvBadge.tsx`、`src/ui/TvAvatar.tsx`、`src/ui/ConfirmButton.tsx`、`src/ui/notify.tsx`、`src/style.css`（替换 Task 1 的空占位）
- Test: `src/ui/ui.test.tsx`

**Interfaces:**
- Consumes: `avatarColor`（`./avatarColor`）、`NotifyKind`（`../types`）
- Produces（Task 6/9/10/11/12/13 依赖）:
  - `TvTooltip({ title: string; children: ReactNode })` —— CSS-only 悬浮提示（`data-tip` + `::after`）
  - `TvSegmented<T extends string>({ value: T; onChange: (v: T) => void; options: { label: string; value: T }[]; className?: string })`
  - `TvBadge({ count: number; children: ReactNode })` —— count>0 显示圆点
  - `TvAvatar({ name: string; size?: number })` —— 哈希取色圆形首字母
  - `ConfirmButton({ label: string; confirmLabel: string; onConfirm: () => void; className?: string })` —— 行内二次确认（2s 超时复原）
  - `NotifyProvider({ onNotify?: (kind: NotifyKind, text: string) => void; children: ReactNode })`、`useNotify(): (kind: NotifyKind, text: string) => void` —— 传了 onNotify 直接转发，否则内置 toast 浮条（3s 自动消失）

- [ ] **Step 1: 写失败测试 `src/ui/ui.test.tsx`**

```tsx
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
```

Run: `npx vitest run src/ui/ui.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 2: 实现五个小件 + notify**

`src/ui/TvTooltip.tsx`：

```tsx
import type { ReactNode } from "react";

/** CSS-only 悬浮提示：data-tip 文本经 ::after 呈现；inline-flex 包裹使 focus-within 可达 */
export function TvTooltip({ title, children }: { title: string; children: ReactNode }) {
  return <span className="tv-tip" data-tip={title}>{children}</span>;
}
```

`src/ui/TvSegmented.tsx`：

```tsx
/** 分段选择器（替代 antd Segmented）：页签/视图切换两用 */
export function TvSegmented<T extends string>({ value, onChange, options, className }: {
  value: T;
  onChange: (v: T) => void;
  options: { label: string; value: T }[];
  className?: string;
}) {
  return (
    <div className={"tv-segmented" + (className ? " " + className : "")} role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value}
                className={"tv-segmented-item" + (value === o.value ? " active" : "")}
                onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}
```

`src/ui/TvBadge.tsx`：

```tsx
import type { ReactNode } from "react";

/** 数字徽标（替代 antd Badge）：count>0 时右上角红底圆点 */
export function TvBadge({ count, children }: { count: number; children: ReactNode }) {
  return (
    <span className="tv-badge">
      {children}
      {count > 0 && <span className="tv-badge-count">{count > 99 ? "99+" : count}</span>}
    </span>
  );
}
```

`src/ui/TvAvatar.tsx`：

```tsx
import { avatarColor } from "./avatarColor";

/** 圆形首字母头像（替代 antd Avatar）：用户名哈希取色，白字可读 */
export function TvAvatar({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <span className="tv-avatar"
          style={{ width: size, height: size, background: avatarColor(name), fontSize: size / 2 }}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
```

`src/ui/ConfirmButton.tsx`：

```tsx
import { useEffect, useRef, useState } from "react";

/** 行内二次确认按钮（替代 antd Popconfirm）：点击进入确认态（2s 超时复原），再点执行 */
export function ConfirmButton({ label, confirmLabel, onConfirm, className }: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current != null) window.clearTimeout(timer.current); }, []);
  function handleClick() {
    if (!confirming) {
      setConfirming(true);
      timer.current = window.setTimeout(() => setConfirming(false), 2000);
      return;
    }
    if (timer.current != null) window.clearTimeout(timer.current);
    setConfirming(false);
    onConfirm();
  }
  return (
    <button type="button" onClick={handleClick}
            className={(className ?? "") + (confirming ? " tv-confirming" : "")}>
      {confirming ? confirmLabel : label}
    </button>
  );
}
```

`src/ui/notify.tsx`：

```tsx
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
```

Run: `npx vitest run src/ui/ui.test.tsx`
Expected: PASS

- [ ] **Step 3: 写 `src/style.css` 基建段（根变量 + 小件样式；流/批注/交付物段落由 Task 14 追加）**

```css
/* trajectory-viewer 全部样式：tv- 前缀类名，颜色经 var(--tv-*) 引用。
   接入：import "trajectory-viewer/style.css"；宿主可覆写 .tv-root 变量换肤。 */

.tv-root {
  /* —— 浅色（默认）—— */
  --tv-primary: #020202;
  --tv-secondary: #666666;
  --tv-ink: #020202;
  --tv-ink-secondary: #666666;
  --tv-ink-tertiary: #999999;
  --tv-dim: rgba(0, 0, 0, 0.45);
  --tv-canvas: #f6f6f6;
  --tv-surface: #ffffff;
  --tv-surface-hover: #f9f9f9;
  --tv-border: #e8e8e8;
  --tv-border-strong: #d0d0d0;
  --tv-accent: #2563eb;                /* 链接/头像/工具名/主按钮 */
  --tv-accent-weak: rgba(37, 99, 235, 0.08);
  --tv-danger: #dc2626;                /* 失败标记 */
  --tv-danger-weak: rgba(229, 115, 115, 0.12);
  --tv-success: #7cb342;
  --tv-dead: #b26a00;                  /* 失效楼「原文已变更」 */
  --tv-mark-bg: #ffe58f;               /* 划线高亮底色 */
  --tv-mark-peak: #ffb020;             /* 闪烁峰值 */
  --tv-flash-ring: rgba(255, 176, 32, 0.55);
  --tv-code-bg: #f6f6f6;
  --tv-tip-bg: rgba(0, 0, 0, 0.85);
  --tv-tip-text: #ffffff;
  --tv-toast-bg: rgba(0, 0, 0, 0.75);
  --tv-toast-text: #ffffff;
  --tv-on-accent: #ffffff;             /* 彩底上的文字/图标（头像、badge、主按钮） */
  /* hljs token（源为手写 GitHub 亮色系） */
  --tv-hljs-base: #24292e;
  --tv-hljs-keyword: #d73a49;
  --tv-hljs-title: #6f42c1;
  --tv-hljs-attr: #005cc5;
  --tv-hljs-string: #032f62;
  --tv-hljs-builtin: #e36209;
  --tv-hljs-comment: #6a737d;
  --tv-hljs-name: #22863a;
  --tv-hljs-addition: #22863a;
  --tv-hljs-addition-bg: #f0fff4;
  --tv-hljs-deletion: #b31d28;
  --tv-hljs-deletion-bg: #ffeef0;
  /* JSON 高亮（JsonHighlight） */
  --tv-json-key: #0b5394;
  --tv-json-string: #137333;
  --tv-json-number: #b06000;
  --tv-json-boolean: #a50e0e;
  --tv-json-null: #999999;
  --tv-json-punct: #1d1d1f;

  color: var(--tv-ink);
  background: var(--tv-canvas);
  height: 100%;
  min-height: 0;
  display: flex;
  min-width: 0;
}

/* 暗色：跟随系统（宿主未显式指定时） */
@media (prefers-color-scheme: dark) {
  .tv-root:not([data-theme="light"]) {
    --tv-primary: #e6e6e6;
    --tv-secondary: #a0a0a0;
    --tv-ink: #e6e6e6;
    --tv-ink-secondary: #a0a0a0;
    --tv-ink-tertiary: #777777;
    --tv-dim: rgba(255, 255, 255, 0.5);
    --tv-canvas: #141414;
    --tv-surface: #1e1e1e;
    --tv-surface-hover: #262626;
    --tv-border: #333333;
    --tv-border-strong: #4a4a4a;
    --tv-accent: #3b6fd4;
    --tv-accent-weak: rgba(59, 111, 212, 0.18);
    --tv-danger: #f87171;
    --tv-danger-weak: rgba(248, 113, 113, 0.16);
    --tv-success: #9ccc65;
    --tv-dead: #d9a04a;
    --tv-mark-bg: #8a6d1f;
    --tv-mark-peak: #d9a02a;
    --tv-flash-ring: rgba(217, 160, 42, 0.5);
    --tv-code-bg: #1b1b1b;
    --tv-tip-bg: rgba(255, 255, 255, 0.92);
    --tv-tip-text: #111111;
    --tv-toast-bg: rgba(255, 255, 255, 0.88);
    --tv-toast-text: #111111;
    --tv-on-accent: #ffffff;
    --tv-hljs-base: #c9d1d9;
    --tv-hljs-keyword: #ff7b72;
    --tv-hljs-title: #d2a8ff;
    --tv-hljs-attr: #79c0ff;
    --tv-hljs-string: #a5d6ff;
    --tv-hljs-builtin: #ffa657;
    --tv-hljs-comment: #8b949e;
    --tv-hljs-name: #7ee787;
    --tv-hljs-addition: #7ee787;
    --tv-hljs-addition-bg: rgba(46, 160, 67, 0.18);
    --tv-hljs-deletion: #f85149;
    --tv-hljs-deletion-bg: rgba(248, 81, 73, 0.18);
    --tv-json-key: #79a8ff;
    --tv-json-string: #7ee787;
    --tv-json-number: #ffab70;
    --tv-json-boolean: #ff9b9b;
    --tv-json-null: #8b949e;
    --tv-json-punct: #c9d1d9;
  }
}

/* 暗色：宿主手动强制（优先级最高）——与媒体查询块保持同一组变量声明 */
.tv-root[data-theme="dark"] {
  /* 与上方 @media 块完全相同的变量声明（两处同步维护） */
  --tv-primary: #e6e6e6; --tv-secondary: #a0a0a0; --tv-ink: #e6e6e6;
  --tv-ink-secondary: #a0a0a0; --tv-ink-tertiary: #777777; --tv-dim: rgba(255, 255, 255, 0.5);
  --tv-canvas: #141414; --tv-surface: #1e1e1e; --tv-surface-hover: #262626;
  --tv-border: #333333; --tv-border-strong: #4a4a4a;
  --tv-accent: #3b6fd4; --tv-accent-weak: rgba(59, 111, 212, 0.18);
  --tv-danger: #f87171; --tv-danger-weak: rgba(248, 113, 113, 0.16);
  --tv-success: #9ccc65; --tv-dead: #d9a04a;
  --tv-mark-bg: #8a6d1f; --tv-mark-peak: #d9a02a; --tv-flash-ring: rgba(217, 160, 42, 0.5);
  --tv-code-bg: #1b1b1b;
  --tv-tip-bg: rgba(255, 255, 255, 0.92); --tv-tip-text: #111111;
  --tv-toast-bg: rgba(255, 255, 255, 0.88); --tv-toast-text: #111111;
  --tv-on-accent: #ffffff;
  --tv-hljs-base: #c9d1d9; --tv-hljs-keyword: #ff7b72; --tv-hljs-title: #d2a8ff;
  --tv-hljs-attr: #79c0ff; --tv-hljs-string: #a5d6ff; --tv-hljs-builtin: #ffa657;
  --tv-hljs-comment: #8b949e; --tv-hljs-name: #7ee787;
  --tv-hljs-addition: #7ee787; --tv-hljs-addition-bg: rgba(46, 160, 67, 0.18);
  --tv-hljs-deletion: #f85149; --tv-hljs-deletion-bg: rgba(248, 81, 73, 0.18);
  --tv-json-key: #79a8ff; --tv-json-string: #7ee787; --tv-json-number: #ffab70;
  --tv-json-boolean: #ff9b9b; --tv-json-null: #8b949e; --tv-json-punct: #c9d1d9;
}

/* —— 小件 —— */

.tv-tip { position: relative; display: inline-flex; }
.tv-tip::after {
  content: attr(data-tip);
  position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%);
  background: var(--tv-tip-bg); color: var(--tv-tip-text);
  padding: 4px 8px; border-radius: 6px; font-size: 12px; white-space: nowrap;
  opacity: 0; pointer-events: none; transition: opacity 0.12s;
  z-index: 10;
}
.tv-tip:hover::after, .tv-tip:focus-within::after { opacity: 1; }

.tv-segmented {
  display: inline-flex; gap: 2px; padding: 2px;
  background: var(--tv-accent-weak); border-radius: 8px;
}
.tv-segmented-item {
  border: none; background: transparent; color: var(--tv-secondary);
  padding: 3px 12px; border-radius: 6px; font-size: 13px; cursor: pointer;
}
.tv-segmented-item.active { background: var(--tv-surface); color: var(--tv-ink); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }

.tv-badge { position: relative; display: inline-flex; }
.tv-badge-count {
  position: absolute; top: -6px; right: -10px;
  min-width: 16px; height: 16px; padding: 0 4px;
  background: var(--tv-danger); color: var(--tv-on-accent);
  border-radius: 8px; font-size: 11px; line-height: 16px; text-align: center;
}

.tv-avatar {
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%; color: var(--tv-on-accent); flex-shrink: 0; user-select: none;
}

.tv-confirming { color: var(--tv-danger) !important; }

.tv-toast-host {
  position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column; gap: 6px; z-index: 1001;
}
.tv-toast {
  background: var(--tv-toast-bg); color: var(--tv-toast-text);
  padding: 6px 14px; border-radius: 8px; font-size: 13px;
}
```

Run: `npx tsup` —— Expected: 构建成功且 `dist/style.css` 含上述内容（onSuccess cp 生效）

- [ ] **Step 4: 全量验证 + Commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 全绿

```bash
git add -A
git commit -m "feat: 去 antd 基础小件（Tooltip/Segmented/Badge/Avatar/ConfirmButton/notify）与样式基建

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---
### Task 6: JsonHighlight + Markdown + WrapToggleButton（去 antd、JSON 颜色类化）

**Files:**
- Create: `src/components/JsonHighlight.tsx`、`src/components/Markdown.tsx`、`src/components/WrapToggleButton.tsx`
- Test: `src/components/JsonHighlight.test.tsx`、`src/components/Markdown.test.tsx`

**Interfaces:**
- Consumes: `TvTooltip`（`../ui/TvTooltip`）
- Produces: `JsonHighlight({ text: string })`（默认导出）、`Markdown({ children: string })`（默认导出）、`WrapToggleButton({ wrapped, onToggle })`（默认导出）

- [ ] **Step 1: 拷贝测试并改造（先失败）**

```bash
cp SRC/components/JsonHighlight.test.tsx src/components/JsonHighlight.test.tsx
cp SRC/components/Markdown.test.tsx src/components/Markdown.test.tsx
sed -i '' -E \
  -e 's/[[:<:]]code-nowrap[[:>:]]/tv-code-nowrap/g' \
  -e 's/[[:<:]]code-block[[:>:]]/tv-code-block/g' \
  -e 's/[[:<:]]code-wrap[[:>:]]/tv-code-wrap/g' \
  -e 's/[[:<:]]json-highlight[[:>:]]/tv-json-highlight/g' \
  -e 's/[[:<:]]json-hl-line[[:>:]]/tv-json-hl-line/g' \
  -e 's/[[:<:]]chat-/tv-chat-/g' \
  -e 's/"markdown"/"tv-markdown"/g' \
  -e 's/\.markdown[[:>:]]/.tv-markdown/g' \
  src/components/JsonHighlight.test.tsx src/components/Markdown.test.tsx
```

再编辑 `JsonHighlight.test.tsx`：原断言内联 `style.color` 的用例改为断言类名——把形如 `expect(el).toHaveStyle({ color: ... })` 的 JSON 值颜色断言替换为 `expect(el).toHaveClass("tv-js")` / `"tv-jk"` / `"tv-jn"` / `"tv-jb"` / `"tv-jl"`（对应 string/key/number/boolean/null；测试里每个值类型一处断言即可）。

再编辑 `Markdown.test.tsx`：用例「hover 按钮显示 Tooltip（自动换行）」（源文件 44-48 行）断言的是 antd Tooltip 的行为（`fireEvent.mouseEnter` + `findByRole("tooltip")`），CSS-only tooltip 没有 `role="tooltip"`、也不靠 hover 挂载 DOM，必然失败。改为断言承载属性与承载元素：

```tsx
test("按钮提示经 data-tip 承载（自动换行）", () => {
  const { container } = render(<Markdown>{CODE_MD}</Markdown>);
  const tip = container.querySelector(".tv-code-wrap-toggle")?.closest(".tv-tip");
  expect(tip).toHaveAttribute("data-tip", "自动换行");
});
```

（`WrapToggleButton` 的 Tooltip 换成 `TvTooltip` 后，`.tv-tip` 是 `.tv-code-wrap-toggle` 的包裹元素，故用 `closest(".tv-tip")` 取到它。本文件其余用例不受影响。）

Run: `npx vitest run src/components/JsonHighlight.test.tsx src/components/Markdown.test.tsx`
Expected: FAIL（组件不存在）

- [ ] **Step 2: 拷贝组件 + 去 antd + 类化改造**

```bash
cp SRC/components/JsonHighlight.tsx src/components/JsonHighlight.tsx
cp SRC/components/Markdown.tsx src/components/Markdown.tsx
cp SRC/components/WrapToggleButton.tsx src/components/WrapToggleButton.tsx
sed -i '' -E \
  -e 's/[[:<:]]code-nowrap[[:>:]]/tv-code-nowrap/g' \
  -e 's/[[:<:]]code-block[[:>:]]/tv-code-block/g' \
  -e 's/[[:<:]]code-wrap[[:>:]]/tv-code-wrap/g' \
  -e 's/[[:<:]]json-highlight[[:>:]]/tv-json-highlight/g' \
  -e 's/[[:<:]]json-hl-line[[:>:]]/tv-json-hl-line/g' \
  -e 's/[[:<:]]chat-/tv-chat-/g' \
  -e 's/"markdown"/"tv-markdown"/g' \
  -e 's/\.markdown[[:>:]]/.tv-markdown/g' \
  src/components/JsonHighlight.tsx src/components/Markdown.tsx src/components/WrapToggleButton.tsx
```

`WrapToggleButton.tsx` 去 antd：删 `import { Tooltip } from "antd";`，改为 `import { TvTooltip } from "../ui/TvTooltip";`，`<Tooltip title={label}>` → `<TvTooltip title={label}>`（闭合标签同步）。

`Markdown.tsx` 无 antd 引用，sed 后无需改动。

`JsonHighlight.tsx` 类化改造（删内联色值，改 CSS 类——这是本任务的核心编辑）：

```tsx
// 删除整个 C 颜色常量对象；Leaf 改为：
function Leaf({ v }: { v: unknown }): ReactNode {
  if (v === null) return <span className="tv-jl">null</span>;
  if (typeof v === "string") return <span className="tv-js">{JSON.stringify(v)}</span>;
  if (typeof v === "boolean") return <span className="tv-jb">{String(v)}</span>;
  if (typeof v === "number") return <span className="tv-jn">{String(v)}</span>;
  return <span>{String(v)}</span>;
}

// withComma 中 <span style={{ color: C.punct }}>,</span> → <span className="tv-jp">,</span>
// flatten 内所有 style={{ color: C.* }} 的 span 改为对应类名：
//   C.punct → tv-jp；C.key → tv-jk（其余同上 Leaf 映射）
// 文件尾部追加导出默认类名容器无需改动（.tv-json-highlight/.tv-json-hl-line 已由 sed 处理）
```

并在 `src/style.css` 末尾追加：

```css
/* —— JSON 高亮（JsonHighlight） —— */
.tv-json-highlight { margin: 0; font-size: 13px; line-height: 1.6; }
.tv-json-highlight .tv-json-hl-line { white-space: pre-wrap; word-break: break-all; }
.tv-jk { color: var(--tv-json-key); }
.tv-js { color: var(--tv-json-string); }
.tv-jn { color: var(--tv-json-number); }
.tv-jb { color: var(--tv-json-boolean); }
.tv-jl { color: var(--tv-json-null); }
.tv-jp { color: var(--tv-json-punct); }
```

Run: `npx vitest run src/components/ && npx tsc --noEmit`
Expected: 全绿

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: JsonHighlight/Markdown/WrapToggleButton 去 antd 与颜色 CSS 变量化

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: data/useMessageStreamData + useRawData 状态 hook

**Files:**
- Create: `src/data/useMessageStreamData.ts`、`src/data/useRawData.ts`
- Test: `src/data/hooks.test.tsx`

**Interfaces:**
- Consumes: `TrajectoryDataSource`、`Msg`、`MsgPage`（`../types`）
- Produces:
  - `useMessageStreamData(dataSource, sentinelRef: RefObject<HTMLElement>, active: boolean): MessageStreamData`，`MessageStreamData = { msgs: Msg[]; hasMore: boolean; msgError: string | null; loadedRef: MutableRefObject<number>; loadMore(): Promise<boolean>; reload(): void }`
  - `useRawData(dataSource, active: boolean): { raw: unknown | null; rawError: string | null }`

- [ ] **Step 1: 写失败测试 `src/data/hooks.test.tsx`**

```tsx
import { useRef } from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { Msg, MsgPage, TrajectoryDataSource } from "../types";
import { useMessageStreamData, type MessageStreamData } from "./useMessageStreamData";
import { useRawData } from "./useRawData";

// jsdom 无 IntersectionObserver：可手动触发的替身（与源项目 MessageStream 测试同模式）
class MockIO {
  static instances: MockIO[] = [];
  private cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) { this.cb = cb; MockIO.instances.push(this); }
  observe(): void {} unobserve(): void {} disconnect(): void {}
  show(): void { this.cb([{ isIntersecting: true } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
}
vi.stubGlobal("IntersectionObserver", MockIO);
function showSentinel() {
  const io = MockIO.instances[MockIO.instances.length - 1];
  if (!io) throw new Error("尚未创建哨兵观察器");
  io.show();
}
beforeEach(() => { MockIO.instances.length = 0; });

function m(idx: number, role: string, content: string): Msg {
  return { idx, role, preview: "", content_len: content.length, content, reasoning_len: 0 };
}
function pageOf(messages: Msg[], from = 0, hasMore = false): MsgPage {
  return { messages, from, returned: messages.length, has_more: hasMore };
}
function dsOf(fetchMessages: TrajectoryDataSource["fetchMessages"],
              fetchRaw: TrajectoryDataSource["fetchRaw"] = async () => ({})): TrajectoryDataSource {
  return { fetchMessages, fetchRaw };
}

let latest: MessageStreamData;
function StreamHarness({ ds, active = true }: { ds: TrajectoryDataSource; active?: boolean }) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  latest = useMessageStreamData(ds, sentinelRef, active);
  return <div ref={sentinelRef} />;
}

test("首页加载：拉取 from=0 并填充 msgs/hasMore", async () => {
  const ds = dsOf(async () => pageOf([m(0, "user", "问")], 0, true));
  render(<StreamHarness ds={ds} />);
  await waitFor(() => expect(latest.msgs).toHaveLength(1));
  expect(latest.hasMore).toBe(true);
  expect(latest.loadedRef.current).toBe(1);
});

test("哨兵进入视口自动续拉并追加", async () => {
  const fetchMessages = vi.fn(async (q: { from: number; limit: number }) =>
    q.from === 0 ? pageOf([m(0, "user", "问")], 0, true) : pageOf([m(1, "assistant", "答")], 1, false));
  render(<StreamHarness ds={dsOf(fetchMessages)} />);
  await waitFor(() => expect(latest.msgs).toHaveLength(1));
  showSentinel();
  await waitFor(() => expect(latest.msgs).toHaveLength(2));
  expect(fetchMessages).toHaveBeenLastCalledWith({ from: 1, limit: 300 });
  expect(latest.hasMore).toBe(false);
});

test("active=false 不挂哨兵", async () => {
  render(<StreamHarness ds={dsOf(async () => pageOf([m(0, "user", "问")]))} active={false} />);
  await waitFor(() => expect(latest.msgs).toHaveLength(1));
  expect(MockIO.instances).toHaveLength(0);
});

test("切 dataSource：重置并重新拉取，旧响应晚到不串台", async () => {
  let resolveOld: (p: MsgPage) => void = () => {};
  const dsOld = dsOf(() => new Promise<MsgPage>((r) => { resolveOld = r; }));
  const dsNew = dsOf(async () => pageOf([m(0, "user", "新记录")]));
  const { rerender } = render(<StreamHarness ds={dsOld} />);
  rerender(<StreamHarness ds={dsNew} />);
  await waitFor(() => expect(latest.msgs[0]?.content).toBe("新记录"));
  resolveOld(pageOf([m(0, "user", "旧记录残留")]));   // 旧响应晚到：不得覆盖
  await new Promise((r) => setTimeout(r, 10));
  expect(latest.msgs[0]?.content).toBe("新记录");
});

test("首页失败给 msgError，reload() 后恢复", async () => {
  let fail = true;
  const ds = dsOf(async () => {
    if (fail) throw new Error("网络错误");
    return pageOf([m(0, "user", "问")]);
  });
  render(<StreamHarness ds={ds} />);
  await waitFor(() => expect(latest.msgError).toContain("消息加载失败"));
  fail = false;
  latest.reload();
  await waitFor(() => expect(latest.msgs).toHaveLength(1));
  expect(latest.msgError).toBeNull();
});

let rawLatest: { raw: unknown | null; rawError: string | null };
function RawHarness({ ds, active }: { ds: TrajectoryDataSource; active: boolean }) {
  rawLatest = useRawData(ds, active);
  return null;
}

test("raw：active 才懒拉取；切 dataSource 重置", async () => {
  const fetchRaw = vi.fn(async () => ({ ok: 1 }));
  const ds = dsOf(async () => pageOf([]), fetchRaw);
  const { rerender } = render(<RawHarness ds={ds} active={false} />);
  expect(fetchRaw).not.toHaveBeenCalled();
  rerender(<RawHarness ds={ds} active={true} />);
  await waitFor(() => expect(rawLatest.raw).toEqual({ ok: 1 }));
  const ds2 = dsOf(async () => pageOf([]), async () => ({ ok: 2 }));
  rerender(<RawHarness ds={ds2} active={true} />);
  await waitFor(() => expect(rawLatest.raw).toEqual({ ok: 2 }));
});

test("raw：失败给 rawError", async () => {
  const ds = dsOf(async () => pageOf([]), async () => { throw new Error("读取失败"); });
  render(<RawHarness ds={ds} active={true} />);
  await waitFor(() => expect(rawLatest.rawError).toBe("读取失败"));
});
```

Run: `npx vitest run src/data/hooks.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 2: 实现 `src/data/useMessageStreamData.ts`**

```ts
import { useEffect, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";
import type { Msg, TrajectoryDataSource } from "../types";

/** 单页拉取量：≤300 条一次取全；更长记录由流末尾哨兵进入视口时自动续拉 */
const PAGE = 300;

export interface MessageStreamData {
  msgs: Msg[];
  hasMore: boolean;
  msgError: string | null;
  /** 已加载条数游标（跨页定位判断是否覆盖目标 msgIdx） */
  loadedRef: MutableRefObject<number>;
  /** 续拉下一页；true=成功取回一页（跨页定位循环用） */
  loadMore(): Promise<boolean>;
  /** 重新拉取首页（错误条「点击重试」） */
  reload(): void;
}

/**
 * 消息流分页状态机（数据源适配器驱动）：
 * - dataSource identity 变化 = 换记录：全量重置并拉首页；
 * - 哨兵进入视口（rootMargin 200px）自动续拉；loadReq 令牌丢弃过期响应防串台；
 * - active=false（raw 视图）时不挂哨兵；jsdom 无 IntersectionObserver 时静默跳过。
 */
export function useMessageStreamData(
  dataSource: TrajectoryDataSource,
  sentinelRef: RefObject<HTMLElement>,
  active: boolean,
): MessageStreamData {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [msgError, setMsgError] = useState<string | null>(null);
  const loaded = useRef(0);
  // 「加载更多」请求序号：切记录时自增使在途请求失效
  const loadReq = useRef(0);
  // 「加载更多」在途标志：连滚/哨兵反复可见时直接忽略
  const loadingMore = useRef(false);
  // 递增以重新触发首页加载（「点击重试」入口）
  const [reloadKey, setReloadKey] = useState(0);

  // 换记录/重试：重置分页门闩并拉首页
  useEffect(() => {
    loaded.current = 0;
    setMsgs([]);
    setHasMore(false);
    setMsgError(null);
    loadReq.current += 1;
    loadingMore.current = false;
    let live = true;
    dataSource.fetchMessages({ from: 0, limit: PAGE })
      .then((m) => {
        if (!live) return;
        setMsgs(m.messages);
        loaded.current = m.from + m.returned;
        setHasMore(m.has_more);
      })
      .catch((e) => {
        if (live) setMsgError(`消息加载失败: ${(e as Error).message}`);
      });
    return () => { live = false; };
  }, [dataSource, reloadKey]);

  async function loadMore(): Promise<boolean> {
    if (loadingMore.current || !hasMore) return false;
    const req = ++loadReq.current;
    loadingMore.current = true;
    try {
      const m = await dataSource.fetchMessages({ from: loaded.current, limit: PAGE });
      // stale 防护：已切记录或已有更新请求时丢弃过期响应
      if (loadReq.current !== req) return false;
      setMsgs((prev) => [...prev, ...m.messages]);
      loaded.current = m.from + m.returned;
      setHasMore(m.has_more);
      setMsgError(null);
      return true;
    } catch (e) {
      if (loadReq.current === req) setMsgError(`加载更多失败: ${(e as Error).message}`);
      return false;
    } finally {
      if (loadReq.current === req) loadingMore.current = false;
    }
  }

  // 无限滚动：哨兵进入视口自动续拉下一页；active/hasMore/dataSource 变化重建观察器
  useEffect(() => {
    if (!active) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [active, dataSource, hasMore, sentinelRef]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    msgs, hasMore, msgError,
    loadedRef: loaded,
    loadMore,
    reload: () => setReloadKey((k) => k + 1),
  };
}
```

- [ ] **Step 3: 实现 `src/data/useRawData.ts`**

```ts
import { useEffect, useRef, useState } from "react";
import type { TrajectoryDataSource } from "../types";

/**
 * 原数据懒加载：active（进入 raw 视图）且尚无数据时拉取，失败后重进自动重试；
 * dataSource identity 变化重置（rawReq 令牌使在途响应失效）。
 */
export function useRawData(
  dataSource: TrajectoryDataSource,
  active: boolean,
): { raw: unknown | null; rawError: string | null } {
  const [raw, setRaw] = useState<unknown | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
  const rawReq = useRef(0);
  const loadingRaw = useRef(false);

  // 换记录重置
  useEffect(() => {
    setRaw(null);
    setRawError(null);
    rawReq.current += 1;
    loadingRaw.current = false;
  }, [dataSource]);

  useEffect(() => {
    if (!active || raw != null) return;
    if (loadingRaw.current) return;
    const req = ++rawReq.current;
    loadingRaw.current = true;
    dataSource.fetchRaw()
      .then((r) => {
        if (rawReq.current === req) {
          setRaw(r);
          setRawError(null);
        }
      })
      .catch((e) => {
        if (rawReq.current === req) setRawError((e as Error).message);
      })
      .finally(() => {
        if (rawReq.current === req) loadingRaw.current = false;
      });
  }, [active, dataSource, raw]);

  return { raw, rawError };
}
```

Run: `npx vitest run src/data/hooks.test.tsx && npx tsc --noEmit`
Expected: 全绿

- [ ] **Step 4: Commit**

```bash
git add src/data/
git commit -m "feat: 消息分页与原数据状态 hook（适配器驱动，竞态令牌防串台）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: data/useAnnotations 评论状态 hook

**Files:**
- Create: `src/data/useAnnotations.ts`
- Test: `src/data/useAnnotations.test.tsx`

**Interfaces:**
- Consumes: `AnnotationStore`、`Annotation`、`LikeResult`、`TrajectoryDataSource`（`../types`）
- Produces: `useAnnotations(store: AnnotationStore | undefined, dataSource: TrajectoryDataSource): AnnotationsState`，`AnnotationsState = { annotations: Annotation[] | null; loadError: boolean; deadIds: Set<number>; reportDead(ids: number[]): void; reload(): void; applyLike(kind: "annotation" | "reply", targetId: number, next: LikeResult): void }`

- [ ] **Step 1: 写失败测试 `src/data/useAnnotations.test.tsx`**

```tsx
import { render, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { Annotation, AnnotationStore, TrajectoryDataSource } from "../types";
import { useAnnotations, type AnnotationsState } from "./useAnnotations";

const DS: TrajectoryDataSource = { fetchMessages: async () => ({ messages: [], from: 0, returned: 0, has_more: false }), fetchRaw: async () => ({}) };

function anno(id: number, extra: Partial<Annotation> = {}): Annotation {
  return {
    id, msg_idx: 0, region: "content", sub: null, quote: "q", prefix: "", suffix: "",
    author: "alice", body: "楼", resolved: 0, resolved_by: null, resolved_at: null,
    created_at: 1, updated_at: 1, like_count: 0, liked_by_me: false,
    replies: [], ...extra,
  };
}
function storeOf(list: AnnotationStore["list"]): AnnotationStore {
  return {
    list,
    create: vi.fn(), reply: vi.fn(), update: vi.fn(), delete: vi.fn(),
    setResolved: vi.fn(), setLike: vi.fn(),
  } as unknown as AnnotationStore;
}

let latest: AnnotationsState;
function Harness({ store, ds = DS }: { store?: AnnotationStore; ds?: TrajectoryDataSource }) {
  latest = useAnnotations(store, ds);
  return null;
}

test("list 成功填充 annotations；store 缺省保持 null", async () => {
  render(<Harness store={storeOf(async () => [anno(1)])} />);
  await waitFor(() => expect(latest.annotations).toHaveLength(1));
  const { unmount } = render(<Harness />);
  await new Promise((r) => setTimeout(r, 10));
  expect(latest.annotations).toBeNull();
  unmount();
});

test("list 失败置 loadError，reload 成功后恢复", async () => {
  let fail = true;
  const store = storeOf(async () => { if (fail) throw new Error("x"); return [anno(2)]; });
  render(<Harness store={store} />);
  await waitFor(() => expect(latest.loadError).toBe(true));
  fail = false;
  latest.reload();
  await waitFor(() => expect(latest.annotations).toHaveLength(1));
  expect(latest.loadError).toBe(false);
});

test("applyLike 本地增量：楼与回复两种目标", async () => {
  const a = anno(1, {
    replies: [{ id: 9, annotation_id: 1, parent_id: null, author: "bob", body: "r",
                created_at: 1, updated_at: 1, like_count: 0, liked_by_me: false }],
  });
  render(<Harness store={storeOf(async () => [a])} />);
  await waitFor(() => expect(latest.annotations).toHaveLength(1));
  latest.applyLike("annotation", 1, { likeCount: 5, likedByMe: true });
  await waitFor(() => expect(latest.annotations![0].like_count).toBe(5));
  latest.applyLike("reply", 9, { likeCount: 2, likedByMe: true });
  await waitFor(() => expect(latest.annotations![0].replies[0].liked_by_me).toBe(true));
});

test("切 dataSource：清空并重新拉取", async () => {
  const list = vi.fn(async () => [anno(1)]);
  render(<Harness store={storeOf(list)} />);
  await waitFor(() => expect(latest.annotations).toHaveLength(1));
  latest.reportDead([1]);
  await waitFor(() => expect(latest.deadIds.has(1)).toBe(true));
  const ds2: TrajectoryDataSource = { ...DS };
  const { rerender } = render(<Harness store={storeOf(list)} />);
  rerender(<Harness store={storeOf(list)} ds={ds2} />);
  await waitFor(() => expect(list.mock.calls.length).toBeGreaterThanOrEqual(1));
});
```

Run: `npx vitest run src/data/useAnnotations.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 2: 实现 `src/data/useAnnotations.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation, AnnotationStore, LikeResult, TrajectoryDataSource } from "../types";

export interface AnnotationsState {
  /** null=加载中/未启用 */
  annotations: Annotation[] | null;
  loadError: boolean;
  /** 锚点失效楼 id 集（高亮重锚定后由视图上报，面板据此置灰） */
  deadIds: Set<number>;
  reportDead(ids: number[]): void;
  /** 重拉（建/改/删/解决后；数据量小，重拉替代增量合并，规避聚合字段漂移） */
  reload(): void;
  /** 点赞本地增量（响应即现状，不重拉） */
  applyLike(kind: "annotation" | "reply", targetId: number, next: LikeResult): void;
}

/** 评论列表状态：store 缺省=评论关闭；dataSource identity 变化=换记录重拉（annoReq 令牌丢弃过期响应） */
export function useAnnotations(
  store: AnnotationStore | undefined,
  dataSource: TrajectoryDataSource,
): AnnotationsState {
  const [annotations, setAnnotations] = useState<Annotation[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [deadIds, setDeadIds] = useState<Set<number>>(new Set());
  const annoReq = useRef(0);

  const reload = useCallback(() => {
    if (!store) {
      setAnnotations(null);
      setLoadError(false);
      return;
    }
    const req = ++annoReq.current;
    store.list()
      .then((list) => {
        if (annoReq.current !== req) return;   // 切记录后旧响应晚到：丢弃
        setAnnotations(list);
        setLoadError(false);
      })
      .catch(() => { if (annoReq.current === req) setLoadError(true); });
  }, [store]);

  // 换记录/换 store：清空（含失效楼集）并重新拉取
  useEffect(() => {
    setAnnotations(null);
    setLoadError(false);
    setDeadIds(new Set());
    annoReq.current += 1;
    reload();
  }, [reload, dataSource]);

  const reportDead = useCallback((ids: number[]) => setDeadIds(new Set(ids)), []);

  const applyLike = useCallback((kind: "annotation" | "reply", targetId: number, next: LikeResult) => {
    setAnnotations((prev) => prev?.map((a) => {
      if (kind === "annotation" && a.id === targetId) {
        return { ...a, like_count: next.likeCount, liked_by_me: next.likedByMe };
      }
      if (kind === "reply") {
        return { ...a, replies: a.replies.map((r) =>
          r.id === targetId ? { ...r, like_count: next.likeCount, liked_by_me: next.likedByMe } : r) };
      }
      return a;
    }) ?? prev);
  }, []);

  return { annotations, loadError, deadIds, reportDead, reload, applyLike };
}
```

Run: `npx vitest run src/data/ && npx tsc --noEmit`
Expected: 全绿

- [ ] **Step 3: Commit**

```bash
git add src/data/
git commit -m "feat: 评论状态 hook（重拉策略 + 点赞本地增量 + 失效楼上报）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---
### Task 9: AnnotatePopover 划线浮层（去 antd）

**Files:**
- Create: `src/components/AnnotatePopover.tsx`
- Test: `src/components/AnnotatePopover.test.tsx`

**Interfaces:**
- Consumes: `TvTooltip`（`../ui/TvTooltip`）
- Produces: `AnnotatePopover({ rect: { left: number; top: number }; onSubmit: (body: string) => Promise<boolean>; onCancel: () => void })`（默认导出）

> **本任务无 Tooltip 断言改造**：源 `AnnotatePopover.test.tsx` 全文不含任何 Tooltip / `role="tooltip"` 断言，源组件里唯一的 `<Tooltip title="Ctrl / ⌘ + Enter 发送">` 无测试覆盖。因此本任务只需把该 Tooltip 换成 `TvTooltip`（承载属性 `data-tip`），**不得**新增测试用例去断言它（新增断言属超出简报范围）。

- [ ] **Step 1: 拷贝测试并改造（先失败）**

```bash
cp SRC/components/AnnotatePopover.test.tsx src/components/AnnotatePopover.test.tsx
sed -i '' -E -e 's/[[:<:]]anno-/tv-anno-/g' -e 's/data-tv-anno-id/data-anno-id/g' src/components/AnnotatePopover.test.tsx
```

Run: `npx vitest run src/components/AnnotatePopover.test.tsx`
Expected: FAIL（组件不存在）

- [ ] **Step 2: 拷贝实现 + 去 antd + 重命名**

```bash
cp SRC/components/AnnotatePopover.tsx src/components/AnnotatePopover.tsx
sed -i '' -E -e 's/[[:<:]]anno-/tv-anno-/g' -e 's/data-tv-anno-id/data-anno-id/g' src/components/AnnotatePopover.tsx
```

然后手动编辑：删 `import { Tooltip } from "antd";`，改为 `import { TvTooltip } from "../ui/TvTooltip";`；`<Tooltip title="Ctrl / ⌘ + Enter 发送">` → `<TvTooltip title="Ctrl / ⌘ + Enter 发送">`（闭合标签同步）。

Run: `npx vitest run src/components/AnnotatePopover.test.tsx && npx tsc --noEmit`
Expected: 全绿

- [ ] **Step 3: Commit**

```bash
git add src/components/AnnotatePopover.*
git commit -m "feat: AnnotatePopover 划线建楼浮层去 antd

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 10: DeliveryCards + DeliveryDrawer（resolveDeliveryUrl 注入）

**Files:**
- Create: `src/components/DeliveryCards.tsx`、`src/components/DeliveryDrawer.tsx`
- Test: `src/components/DeliveryCards.test.tsx`、`src/components/DeliveryDrawer.test.tsx`

**Interfaces:**
- Consumes: `buildTree`/`TreeDir`/`TreeFile`（`../core/deliveryTree`）
- Produces:
  - `DeliveryCards({ delivery: string[]; panelOpen: boolean; onTogglePanel: () => void })`（默认导出）
  - `DeliveryDrawer({ delivery: string[]; open: boolean; onClose: () => void; resolveDeliveryUrl?: (path: string) => string })`（默认导出），同时导出 `DeliveryDrawerProps`

- [ ] **Step 1: 拷贝测试并改造（先失败）**

```bash
cp SRC/components/DeliveryCards.test.tsx src/components/DeliveryCards.test.tsx
cp SRC/components/DeliveryDrawer.test.tsx src/components/DeliveryDrawer.test.tsx
sed -i '' -E -e 's/[[:<:]]delivery-/tv-delivery-/g' src/components/DeliveryCards.test.tsx src/components/DeliveryDrawer.test.tsx
```

编辑 `DeliveryDrawer.test.tsx` 适配新 props：原 `item="demo"` prop 删除；`openInNewTab`/`workLink` 相关断言改为注入 `resolveDeliveryUrl={(p) => "/files/" + p}` 并 stub `window.open`（`vi.stubGlobal("open", vi.fn())`），断言以新 URL 打开；无 `resolveDeliveryUrl` 时文件行点击不调用 `window.open`。

Run: `npx vitest run src/components/DeliveryCards.test.tsx src/components/DeliveryDrawer.test.tsx`
Expected: FAIL（组件不存在）

- [ ] **Step 2: DeliveryCards 拷贝 + 重命名**

```bash
cp SRC/components/DeliveryCards.tsx src/components/DeliveryCards.tsx
sed -i '' -E -e 's/[[:<:]]delivery-/tv-delivery-/g' src/components/DeliveryCards.tsx
```

无需其他改动（props 不变）。

- [ ] **Step 3: DeliveryDrawer 完整重写为 `src/components/DeliveryDrawer.tsx`**

要点：`item` prop 删除；`deliveryShared.tsx` 不搬迁——`fileIcon`/`fileName` 内联进本文件；`openInNewTab(item, path)`（写死后端 `/work/` 前缀）由注入的 `resolveDeliveryUrl` 取代；外点关闭豁免类名全部 tv- 化。

```tsx
import { useEffect, useState } from "react";
import { faChevronDown, faChevronRight, faFile, faFolder } from "@fortawesome/free-solid-svg-icons";
import { faHtml5, faJs, faMarkdown } from "@fortawesome/free-brands-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { buildTree } from "../core/deliveryTree";
import type { TreeDir, TreeFile } from "../core/deliveryTree";

export interface DeliveryDrawerProps {
  /** 由调用方保证长度 >= 1（单文件渲染为顶层单个文件行） */
  delivery: string[];
  open: boolean;
  onClose: () => void;
  /** 文件点击打开链接；不传则文件行不可点 */
  resolveDeliveryUrl?: (path: string) => string;
}

/** 按扩展名给文件一个图标（FA 品牌图标还原语义，通用文件用 solid） */
function fileIcon(path: string) {
  if (path.endsWith(".html") || path.endsWith(".htm")) return <FontAwesomeIcon icon={faHtml5} />;
  if (path.endsWith(".js") || path.endsWith(".ts") || path.endsWith(".jsx") || path.endsWith(".tsx")) return <FontAwesomeIcon icon={faJs} />;
  if (path.endsWith(".md")) return <FontAwesomeIcon icon={faMarkdown} />;
  return <FontAwesomeIcon icon={faFile} />;
}

/** 目录行：chevron + 文件夹 + 合并段名 + 文件数；点击展开/折叠 */
function DirRow({ dir, depth, open, onToggle }: {
  dir: TreeDir; depth: number; open: boolean; onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="tv-delivery-tree-row tv-delivery-tree-dir"
      style={{ paddingLeft: 10 + depth * 18 }}
      onClick={onToggle}
    >
      <span className="tv-delivery-tree-chevron">{open ? <FontAwesomeIcon icon={faChevronDown} /> : <FontAwesomeIcon icon={faChevronRight} />}</span>
      <span className="tv-delivery-icon"><FontAwesomeIcon icon={faFolder} /></span>
      <span className="tv-delivery-name" title={dir.name}>{dir.name}</span>
      <span className="tv-delivery-tree-count">{dir.fileCount} 个文件</span>
    </button>
  );
}

/** 文件行：有 resolveDeliveryUrl 时整行可点击新标签打开（浏览器自行渲染 HTML/展示文本） */
function FileRow({ file, depth, resolveUrl }: {
  file: TreeFile; depth: number; resolveUrl?: (path: string) => string;
}) {
  return (
    <button
      type="button"
      className="tv-delivery-tree-row"
      style={{ paddingLeft: 10 + depth * 18 + 14 }}
      title={resolveUrl ? `打开 ${file.path}` : file.path}
      onClick={resolveUrl ? () => window.open(resolveUrl(file.path), "_blank") : undefined}
    >
      <span className="tv-delivery-icon">{fileIcon(file.path)}</span>
      <span className="tv-delivery-name" title={file.name}>{file.name}</span>
    </button>
  );
}

/** 递归渲染一层；顶层（depth 0）默认展开，子级默认折叠 */
function TreeLevel({ dirs, files, depth, resolveUrl, defaultOpen }: {
  dirs: TreeDir[]; files: TreeFile[]; depth: number;
  resolveUrl?: (path: string) => string; defaultOpen: boolean;
}) {
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  return (
    <>
      {dirs.map((d) => {
        const open = d.name in openMap ? openMap[d.name] : defaultOpen;
        return (
          <div key={d.name}>
            <DirRow dir={d} depth={depth} open={open}
              onToggle={() => setOpenMap((m) => ({ ...m, [d.name]: !(d.name in m ? m[d.name] : defaultOpen) }))} />
            {open && (
              <TreeLevel dirs={d.dirs} files={d.files} depth={depth + 1} resolveUrl={resolveUrl} defaultOpen={false} />
            )}
          </div>
        );
      })}
      {files.map((f) => <FileRow key={f.path} file={f} depth={depth} resolveUrl={resolveUrl} />)}
    </>
  );
}

/**
 * 交付物右侧抽屉（与消息区并排压缩主区域）：
 * 常驻 DOM + open class 宽度过渡；点击抽屉外部（触发卡片/工具栏触发器除外）即关闭。
 */
export default function DeliveryDrawer({ delivery, open, onClose, resolveDeliveryUrl }: DeliveryDrawerProps) {
  // 点击抽屉外任意处关闭；点触发器时不拦截（由其自身 onClick toggle，
  // 否则 pointerdown 先关、click 再开会表现为关不上）
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest(".tv-delivery-drawer") || t?.closest(".tv-delivery-card") || t?.closest(".tv-delivery-drawer-trigger")) return;
      onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onClose]);

  const root = buildTree(delivery);
  return (
    <div className={open ? "tv-delivery-drawer tv-delivery-drawer-open" : "tv-delivery-drawer"} aria-hidden={!open}>
      <div className="tv-delivery-drawer-head">
        <span>全部文件</span>
        <button type="button" className="tv-delivery-drawer-close" onClick={onClose} aria-label="关闭">
          ✕
        </button>
      </div>
      <div className="tv-delivery-modal-list">
        <TreeLevel dirs={root.dirs} files={root.files} depth={0} resolveUrl={resolveDeliveryUrl} defaultOpen />
      </div>
    </div>
  );
}
```

注意：`SRC` 里 DirRow 用 `delivery-icon`/`delivery-name`，本实现统一为 `tv-delivery-icon`/`tv-delivery-name`（与 DeliveryCards 的类名一致，样式可共用）。

Run: `npx vitest run src/components/Delivery*.test.tsx && npx tsc --noEmit`
Expected: 全绿

- [ ] **Step 4: Commit**

```bash
git add src/components/Delivery*
git commit -m "feat: 交付物入口卡与文件抽屉（resolveDeliveryUrl 注入替代写死后端前缀）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 11: MessageStreamView 纯渲染核心（划线/高亮/跨页定位 + renderRaw slot）

**Files:**
- Modify: 新建 `src/components/MessageStreamView.tsx`（由 `SRC/components/MessageStream.tsx` 重构而来）
- Test: `src/components/MessageStreamView.test.tsx`

**Interfaces:**
- Consumes: `groupMessages` 等（`../core/chatModel`）、`applyMarks`/`blockSelector`/`clearMarks`/`overlapsMark`/`reanchor`/`selectionToAnchor`（`../core/annotationAnchor`）、`DeliveryCards`、`JsonHighlight`、`Markdown`、`AnnotatePopover`、`useNotify`（`../ui/notify`）、`Msg`/`AnchorInput`/`Annotation`（`../types`）
- Produces（Task 13 依赖）:
  - `FoldAction = "expand" | "collapse"`
  - `MessageStreamViewHandle { toggleAllCards(): FoldAction | null; scrollToAnnotation(msgIdx: number, annoId: number): Promise<boolean> }`
  - `MessageStreamViewProps { mode: "parsed" | "raw"; msgs: Msg[]; msgError: string | null; onRetryMessages: () => void; loadMore: () => Promise<boolean>; loadedRef: MutableRefObject<number>; sentinelRef: RefObject<HTMLDivElement>; raw: unknown | null; rawError: string | null; renderRaw?: (raw: unknown) => ReactNode; delivery?: string[]; deliveryOpen: boolean; onToggleDelivery: () => void; annotations: Annotation[] | null; onCreateAnnotation?: (anchor: AnchorInput, body: string) => Promise<boolean>; onMarkClick: (annoId: number) => void; onAnchorsReconciled: (deadIds: number[]) => void; onActionChange?: (action: FoldAction) => void }`（默认导出 forwardRef 组件）

> **源测试中的 weight 徽标提示无断言负担**：`MessageStream.test.tsx` 中 weight=0 徽标用例（源 289-296 行附近）的 Tooltip 注释下一行只断言 `.avatar-zero` 存在，**不查询 `role="tooltip"`**，因此 CSS-only 后仅需保证 `.tv-avatar-zero` 仍渲染即可，测试无需改造。

- [ ] **Step 1: 拷贝源测试并改造为视图测试（先失败）**

```bash
cp SRC/components/MessageStream.test.tsx src/components/MessageStreamView.test.tsx
sed -i '' -E \
  -e 's/[[:<:]]chat-/tv-chat-/g' -e 's/[[:<:]]anno-/tv-anno-/g' -e 's/data-tv-anno-id/data-anno-id/g' \
  -e 's/[[:<:]]delivery-/tv-delivery-/g' -e 's/[[:<:]]pair-/tv-pair-/g' \
  -e 's/[[:<:]]json-highlight[[:>:]]/tv-json-highlight/g' \
  -e 's/[[:<:]]avatar-zero[[:>:]]/tv-avatar-zero/g' \
  src/components/MessageStreamView.test.tsx
```

然后按下列清单改造测试文件（每条对应源测试的明确差异）：

1. **删 api mock**：移除 `vi.mock("../api", ...)` 与 `import * as api`；`fetchMessages`/`fetchRaw` 的 mock 调用改为构造内存 `MsgPage` 序列直接作为 props（`msgs` 直接传入渲染用例）。
2. **删 MonacoView mock**：raw 用例改为两条——(a) 默认渲染：传 `raw={{ a: 1 }}`，断言 `.tv-json-highlight` 出现；(b) 自定义渲染器：传 `renderRaw={(r) => <div data-testid="myraw">{JSON.stringify(r)}</div>}`，断言 testid 出现。
3. **渲染助手重写**：`renderStream()` 改为

```tsx
function renderView(over: Partial<MessageStreamViewProps> = {}) {
  const props: MessageStreamViewProps = {
    mode: "parsed",
    msgs: [],
    msgError: null,
    onRetryMessages: () => {},
    loadMore: async () => false,
    loadedRef: { current: 0 },
    sentinelRef: { current: null },
    raw: null,
    rawError: null,
    deliveryOpen: false,
    onToggleDelivery: () => {},
    annotations: null,
    onMarkClick: () => {},
    onAnchorsReconciled: () => {},
    ...over,
  };
  return render(<MessageStreamView {...props} />);
}
```

4. **message 断言改 notify**：`import { message } from "antd"` 删除；重叠划线提示用例改为包一层 `NotifyProvider onNotify={spy}` 渲染，断言 `spy` 收到 `("warning", "该段已有评注")`。
5. **分页/哨兵用例迁移说明**：源测试里「首页加载/哨兵续拉/竞态丢弃」已由 Task 7 的 hook 测试覆盖，视图测试中这些用例**删除**；保留并适配：节点渲染（user/system/思考卡/工具配对/失败标记/weight=0 遮眼徽标）、`toggleAllCards` 批量开合与 `onActionChange` 上报、`scrollToAnnotation` 跨页续拉（mock `loadMore` 逐次推进 `loadedRef` 并追加 `msgs` 重渲染，最后断言高亮闪烁类 `tv-anno-flash`）、划线建楼（`window.getSelection` mock 走源测试既有模式）、高亮点击回调 `onMarkClick`、重锚定失效上报 `onAnchorsReconciled`。
6. **新增 raw 折叠断言**：`mode="raw"` 下 `ref.current.toggleAllCards()` 返回 `null`。

Run: `npx vitest run src/components/MessageStreamView.test.tsx`
Expected: FAIL（组件不存在）

- [ ] **Step 2: 创建 `src/components/MessageStreamView.tsx`**

先拷贝再改：

```bash
cp SRC/components/MessageStream.tsx src/components/MessageStreamView.tsx
sed -i '' -E \
  -e 's/[[:<:]]chat-/tv-chat-/g' -e 's/[[:<:]]anno-/tv-anno-/g' -e 's/data-tv-anno-id/data-anno-id/g' \
  -e 's/[[:<:]]delivery-/tv-delivery-/g' -e 's/[[:<:]]pair-/tv-pair-/g' \
  -e 's/[[:<:]]json-highlight[[:>:]]/tv-json-highlight/g' \
  -e 's/[[:<:]]avatar-zero[[:>:]]/tv-avatar-zero/g' \
  src/components/MessageStreamView.tsx
```

`smartContent`/`toolResultContent`/`CardSummary`/`MsgAvatar`/`ToolPairView`/`NodeView` 六个纯展示子组件（源文件 67-198 行）保持不动（sed 已完成重命名）。文件其余部分按以下完整内容替换（自 `// ----` 起的导入区与主组件）：

```tsx
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { MutableRefObject, ReactNode, RefObject } from "react";
import {
  faArrowRight, faChevronRight, faCircleExclamation, faEyeSlash, faGear, faLightbulb, faRobot,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { AnchorInput, Annotation, Msg } from "../types";
import {
  callSummary, firstLine, groupMessages, isFailedResult, looksLikeJson, stripUserMeta,
} from "../core/chatModel";
import type { ChatNode, ToolPair } from "../core/chatModel";
import {
  applyMarks, blockSelector, clearMarks, overlapsMark, reanchor, selectionToAnchor,
} from "../core/annotationAnchor";
import DeliveryCards from "./DeliveryCards";
import JsonHighlight from "./JsonHighlight";
import Markdown from "./Markdown";
import AnnotatePopover from "./AnnotatePopover";
import { useNotify } from "../ui/notify";

// …（六个纯展示子组件原样保留，此处不重印：smartContent / toolResultContent /
//    CardSummary / MsgAvatar / ToolPairView / NodeView）

/** 批量开合动作方向：下一次点击「一键展开/关闭」将执行的动作 */
export type FoldAction = "expand" | "collapse";

/** 暴露给组合层的批量命令 */
export interface MessageStreamViewHandle {
  /** 批量开合当前视图所有折叠块；raw 视图（无内置折叠块）返回 null */
  toggleAllCards(): FoldAction | null;
  /** 定位批注高亮：目标消息未加载则连续续拉至覆盖；false=全量加载后仍无此消息 */
  scrollToAnnotation(msgIdx: number, annoId: number): Promise<boolean>;
}

export interface MessageStreamViewProps {
  mode: "parsed" | "raw";
  msgs: Msg[];
  msgError: string | null;
  onRetryMessages: () => void;
  loadMore: () => Promise<boolean>;
  loadedRef: MutableRefObject<number>;
  sentinelRef: RefObject<HTMLDivElement>;
  raw: unknown | null;
  rawError: string | null;
  /** 原数据渲染 slot；不传用内置 JsonHighlight */
  renderRaw?: (raw: unknown) => ReactNode;
  delivery?: string[];
  deliveryOpen: boolean;
  onToggleDelivery: () => void;
  annotations: Annotation[] | null;
  /** 建楼回调：返回 true=成功（组合层负责重拉，高亮 effect 自动包 mark） */
  onCreateAnnotation?: (anchor: AnchorInput, body: string) => Promise<boolean>;
  onMarkClick: (annoId: number) => void;
  onAnchorsReconciled: (deadIds: number[]) => void;
  onActionChange?: (action: FoldAction) => void;
}

const MessageStreamView = forwardRef<MessageStreamViewHandle, MessageStreamViewProps>(
  function MessageStreamView(props, ref) {
    const {
      mode, msgs, msgError, onRetryMessages, loadMore, loadedRef, sentinelRef,
      raw, rawError, renderRaw,
      delivery, deliveryOpen, onToggleDelivery,
      annotations, onCreateAnnotation, onMarkClick, onAnchorsReconciled, onActionChange,
    } = props;
    const notify = useNotify();
    const rootRef = useRef<HTMLDivElement | null>(null);

    // --- 批注划线与高亮 ---
    const annotateOn = mode === "parsed" && onCreateAnnotation != null;
    // 待建楼选区：锚点 + 浮层定位（选区矩形下缘）
    const [pendingAnno, setPendingAnno] = useState<
      { anchor: AnchorInput; rect: { left: number; top: number } } | null>(null);
    // 待定位高亮 id：loadMore 后经高亮 effect 完成定位
    const [pendingLocate, setPendingLocate] = useState<number | null>(null);

    /** mouseup 划线：选区落在定位区块内 → 浮出「评注」按钮；与既有高亮相交则提示 */
    function onStreamMouseUp() {
      if (!annotateOn) return;
      const sel = window.getSelection();
      if (!sel) return;
      const hit = selectionToAnchor(sel);
      if (!hit) return;                       // 塌陷/跨区块/不在区块内：不打扰
      if (overlapsMark(sel)) {
        notify("warning", "该段已有评注");     // 不支持重叠划线
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setPendingAnno({
        anchor: { msg_idx: hit.msg_idx, region: hit.region, sub: hit.sub,
                  quote: hit.quote, prefix: hit.prefix, suffix: hit.suffix },
        rect: { left: rect.left, top: rect.bottom + 6 },
      });
    }

    /** 高亮点击代理：mark 上 click → 组合层开面板定位卡片 */
    function onStreamClick(e: React.MouseEvent) {
      const m = (e.target as HTMLElement).closest("mark.tv-anno-mark");
      if (m) onMarkClick(Number((m as HTMLElement).dataset.annoId));
    }

    /** 高亮重锚定：annotations/分页变化后全量清 + 按区块分组重包；
        区块在但 quote 找不到 → 失效楼上报；区块不在已加载页 → 跳过（非失效）。 */
    useEffect(() => {
      const box = rootRef.current;
      if (!box) return;
      clearMarks(box);
      const dead: number[] = [];
      if (annotations?.length) {
        const byBlock = new Map<HTMLElement, { id: number; start: number; end: number }[]>();
        for (const a of annotations) {
          const block = box.querySelector<HTMLElement>(blockSelector(a));
          if (!block) continue;               // 所在消息页未加载：跳过
          const hit = reanchor(block, a);
          if (!hit) { dead.push(a.id); continue; }
          const arr = byBlock.get(block) ?? [];
          arr.push({ id: a.id, ...hit });
          byBlock.set(block, arr);
        }
        for (const [block, hits] of byBlock) applyMarks(block, hits);
      }
      onAnchorsReconciled(dead);
    }, [msgs, annotations, mode]); // eslint-disable-line react-hooks/exhaustive-deps

    /** 跨页定位：高亮就位后完成滚动与闪烁（折叠卡先自动展开）。
        mark 暂不在（如 raw 视图下预定位）时不消费 pending，留待变化后重试。 */
    useEffect(() => {
      const box = rootRef.current;
      if (pendingLocate == null || !box) return;
      const el = box.querySelector<HTMLElement>(
        `mark.tv-anno-mark[data-anno-id="${pendingLocate}"]`);
      if (!el) return;
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (p.tagName === "DETAILS") (p as HTMLDetailsElement).open = true;
      }
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("tv-anno-flash");
      window.setTimeout(() => el.classList.remove("tv-anno-flash"), 1600);
      setPendingLocate(null);
    }, [msgs, annotations, mode, pendingLocate]); // eslint-disable-line react-hooks/exhaustive-deps

    /** 扫描解析后视图：还有收起卡 → expand，全开 → collapse；无折叠块返回 null */
    function scanAction(): FoldAction | null {
      const root = rootRef.current;
      if (!root) return null;
      const cards = root.querySelectorAll(".tv-chat-stream details");
      if (!cards.length) return null;
      for (const c of cards) {
        if (!(c as HTMLDetailsElement).open) return "expand";
      }
      return "collapse";
    }

    // 流内容变化后向组合层同步「下一次批量动作」；raw 无内置折叠块，不上报（工具栏按钮禁用）
    useEffect(() => {
      if (mode === "raw") return;
      const a = scanAction();
      if (a) onActionChange?.(a);
    }, [mode, msgs, raw]); // eslint-disable-line react-hooks/exhaustive-deps

    useImperativeHandle(ref, () => ({
      toggleAllCards() {
        // raw：无内置折叠块（自定义渲染器的折叠命令由宿主自理），返回 null
        if (mode === "raw") return null;
        // parsed：卡片是非受控 <details>，直接改 DOM open 即可
        const a = scanAction();
        if (!a) return null;
        const root = rootRef.current;
        if (!root) return null;
        const cards = root.querySelectorAll(".tv-chat-stream details");
        cards.forEach((c) => { (c as HTMLDetailsElement).open = a === "expand"; });
        return a;
      },
      async scrollToAnnotation(msgIdx: number, annoId: number) {
        // 目标消息未加载则连续续拉（loadMore false=在途/失败/无更多即止），200 页上限防御
        let guard = 0;
        while (loadedRef.current <= msgIdx && guard++ < 200) {
          if (!(await loadMore())) break;
        }
        if (loadedRef.current <= msgIdx) return false;   // 全量加载后仍无此消息
        setPendingLocate(annoId);                        // 定位与闪烁交高亮 effect 完成
        return true;
      },
    }));

    return (
      <div ref={rootRef} onMouseUp={onStreamMouseUp} onClick={onStreamClick}>
        {mode === "raw" ? (
          rawError ? (
            <span className="tv-dim">原数据加载失败: {rawError}</span>
          ) : raw != null ? (
            renderRaw ? renderRaw(raw) : <JsonHighlight text={JSON.stringify(raw, null, 2)} />
          ) : (
            <span className="tv-dim">原数据加载中…</span>
          )
        ) : (
          <>
            {msgError && (
              <div className="tv-msg-error">
                <span className="tv-error-text">{msgError}</span>
                <button type="button" className="tv-link-btn" onClick={onRetryMessages}>
                  点击重试
                </button>
              </div>
            )}
            <div className="tv-chat-stream">
              {groupMessages(msgs).map((n) => <NodeView key={n.key} node={n} />)}
              {delivery?.length ? (
                <DeliveryCards
                  delivery={delivery}
                  panelOpen={deliveryOpen}
                  onTogglePanel={onToggleDelivery}
                />
              ) : null}
              {/* 无限滚动哨兵：进入视口自动续拉下一页（观察器由数据 hook 持有） */}
              <div ref={sentinelRef} aria-hidden="true" />
            </div>
            {pendingAnno && (
              <AnnotatePopover
                // key=锚点五元组：换段重划时强制 remount，编辑态与旧草稿不错发到新锚点
                key={JSON.stringify(pendingAnno.anchor)}
                rect={pendingAnno.rect}
                onSubmit={async (body) => {
                  const ok = await onCreateAnnotation!(pendingAnno.anchor, body);
                  if (ok) {
                    setPendingAnno(null);
                    window.getSelection()?.removeAllRanges();
                  }
                  return ok;
                }}
                onCancel={() => setPendingAnno(null)}
              />
            )}
          </>
        )}
      </div>
    );
  },
);

export default MessageStreamView;
```

注意删除源文件中不再需要的部分：`PAGE` 常量、`MonacoView`/`monacoSetup` 引入、antd 引入、fetchMessages/fetchRaw 引入、所有数据获取 effect（已迁入 hook）。

- [ ] **Step 3: 验证**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全绿

- [ ] **Step 4: Commit**

```bash
git add src/components/MessageStreamView.*
git commit -m "feat: MessageStreamView 纯渲染核心（划线/高亮/跨页定位 + renderRaw 插槽）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---
### Task 12: AnnotationPanel 评论区面板（去 antd、store 驱动重写）

**Files:**
- Create: `src/components/AnnotationPanel.tsx`
- Test: `src/components/AnnotationPanel.test.tsx`

**Interfaces:**
- Consumes: `Annotation`/`AnnotationReply`/`AnnotationStore`/`LikeResult`（`../types`）、`TvAvatar`/`TvSegmented`/`TvTooltip`/`ConfirmButton`/`useNotify`（`../ui/*`）
- Produces:
  - `AnnotationPanelProps { open: boolean; onClose: () => void; store: AnnotationStore; annotations: Annotation[] | null; loadError: boolean; onRetry: () => void; me: string; isAdmin: boolean; deadIds: Set<number>; focusId: number | null; onFocusConsumed: () => void; onQuoteClick: (a: Annotation) => void; onChanged: () => void; onLike: (kind: "annotation" | "reply", targetId: number, next: LikeResult) => void }`
  - `AnnotationPanel`（默认导出）。权限规则：编辑=仅作者；删除=作者或 admin；解决=作者或 admin（独立包无 itemOwner 角色）

- [ ] **Step 1: 拷贝源测试并改造（先失败）**

```bash
cp SRC/components/AnnotationPanel.test.tsx src/components/AnnotationPanel.test.tsx
sed -i '' -E -e 's/[[:<:]]anno-/tv-anno-/g' -e 's/data-tv-anno-id/data-anno-id/g' -e 's/[[:<:]]data-anno-card[[:>:]]/data-tv-anno-card/g' \
  src/components/AnnotationPanel.test.tsx
```

按下列清单改造：

1. **api mock 改 store**：删 `vi.mock("../api", ...)`；新增助手

```tsx
function mockStore(over: Partial<AnnotationStore> = {}): AnnotationStore {
  return {
    list: vi.fn(async () => []),
    create: vi.fn(async () => ({})),
    reply: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => undefined),
    setResolved: vi.fn(async () => ({})),
    setLike: vi.fn(async () => ({ likeCount: 3, likedByMe: true })),
    ...over,
  };
}
```

原断言 `createReply` 被调用 → `store.reply`；`updateAnnotationBody`/`updateReplyBody` → `store.update(id, body, "annotation"|"reply")`；`deleteAnnotation`/`deleteReply` → `store.delete(id, kind)`；`setAnnotationResolved` → `store.setResolved`；`setLike` → `store.setLike`（参数顺序变为 `(id, kind, liked)`）。
2. **渲染助手**：加必填 props `store={mockStore()}`；`itemOwner` prop 删除（权限改为「作者或 admin」——源测试中依赖 `itemOwner === me` 获得解决按钮的用例，把该用例的 `me` 改为楼主作者或 `isAdmin`）。
3. **Popconfirm 改行内二次确认**：原「悬浮确认框点确定」改为「点删除 → 按钮变『确认删除？』→ 再点一次」；级联文案断言（`删除后将同时删除 N 条回复`）保留（作为确认态按钮文本）。
4. **message 断言改 notify**：包 `NotifyProvider onNotify={spy}`，断言 spy 收到对应 `(kind, text)`。
5. **Avatar 断言**：antd Avatar 类名断言 → `.tv-avatar`。

Run: `npx vitest run src/components/AnnotationPanel.test.tsx`
Expected: FAIL（组件不存在）

- [ ] **Step 2: 完整写入 `src/components/AnnotationPanel.tsx`**

```tsx
/** 「批注与讨论」右栏面板：常驻 DOM + open class 宽度过渡。
 *  页签：全部/我的（我发的楼 ∪ 我参与回复的楼）/已解决；楼中楼两层（更深层由持久层压平）。
 *  写操作经 annotationStore 持久化；删除为行内二次确认（替代 Popconfirm）。
 *  无外点关闭（用户实测反馈移除）：仅经触发按钮 toggle 与 header ✕ 关闭。 */
import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faCommentDots, faThumbsUp } from "@fortawesome/free-solid-svg-icons";
import type { Annotation, AnnotationReply, AnnotationStore, LikeResult } from "../types";
import { TvAvatar } from "../ui/TvAvatar";
import { TvSegmented } from "../ui/TvSegmented";
import { TvTooltip } from "../ui/TvTooltip";
import { ConfirmButton } from "../ui/ConfirmButton";
import { useNotify } from "../ui/notify";

export interface AnnotationPanelProps {
  open: boolean;
  onClose: () => void;
  store: AnnotationStore;
  annotations: Annotation[] | null;   // null=加载中
  loadError: boolean;                 // true → 「加载失败 点击重试」
  onRetry: () => void;
  me: string;                         // 当前用户名
  isAdmin: boolean;
  deadIds: Set<number>;               // 锚点失效楼（「原文已变更」）
  focusId: number | null;             // 定位闪烁目标（点高亮联动）
  onFocusConsumed: () => void;
  onQuoteClick: (a: Annotation) => void;   // 引用块点击 → 滚动定位高亮
  onChanged: () => void;              // 建/改/删/解决成功后回调（组合层重拉）
  onLike: (kind: "annotation" | "reply", targetId: number, next: LikeResult) => void;
}

/** HH:MM 短格式；完整时间走 title 悬浮 */
function fmtShort(ts: number): string {
  const d = new Date(ts * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtFull(ts: number): string {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 面板→卡片/回复行共享的权限与回调上下文 */
interface PanelCtx {
  me: string;
  isAdmin: boolean;
  deadIds: Set<number>;
  onQuoteClick: (a: Annotation) => void;
  onChanged: () => void;
  onLike: (kind: "annotation" | "reply", targetId: number, next: LikeResult) => void;
}

/** 删除确认文案：有下级（回复）时级联提示条数，无下级为普通确认 */
function deleteTitle(childCount: number): string {
  return childCount > 0 ? `删除后将同时删除 ${childCount} 条回复` : "确认删除？";
}

export default function AnnotationPanel(props: AnnotationPanelProps) {
  const { open, annotations, me, isAdmin, onClose } = props;
  const [tab, setTab] = useState<"all" | "mine" | "resolved">("all");

  const filtered = useMemo(() => {
    const list = annotations ?? [];
    if (tab === "mine") {
      return list.filter((a) =>
        a.author === me || a.replies.some((r) => r.author === me));
    }
    if (tab === "resolved") return list.filter((a) => a.resolved === 1);
    return list;
  }, [annotations, tab, me]);

  // 定位闪烁：高亮/卡片联动；定位后消费 focusId 防重复
  useEffect(() => {
    if (props.focusId == null || !open) return;
    const el = document.querySelector<HTMLElement>(`.tv-anno-card[data-tv-anno-card="${props.focusId}"]`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.classList.add("tv-anno-card-flash");
      window.setTimeout(() => el.classList.remove("tv-anno-card-flash"), 1600);
      props.onFocusConsumed();
    }
  }, [props.focusId, open]); // eslint-disable-line react-hooks/exhaustive-deps

  // 卡片/回复行共享上下文
  const ctx: PanelCtx = {
    me, isAdmin,
    deadIds: props.deadIds,
    onQuoteClick: props.onQuoteClick,
    onChanged: props.onChanged,
    onLike: props.onLike,
  };

  return (
    <div className={open ? "tv-anno-panel tv-anno-panel-open" : "tv-anno-panel"} aria-hidden={!open}>
      <div className="tv-anno-panel-head">
        <span><FontAwesomeIcon icon={faCommentDots} /> 批注与讨论</span>
        <button type="button" className="tv-anno-panel-close" onClick={onClose} aria-label="关闭">
          ✕
        </button>
      </div>
      <div className="tv-anno-panel-body">
        <TvSegmented
          className="tv-anno-tabs"
          value={tab}
          onChange={(v) => setTab(v)}
          options={[
            { label: "全部", value: "all" },
            { label: "我的", value: "mine" },
            { label: "已解决", value: "resolved" },
          ]}
        />
        {props.loadError ? (
          <div className="tv-anno-panel-empty">
            <span>加载失败</span>
            <button type="button" className="tv-anno-reply-toggle" style={{ marginLeft: 8 }}
                    onClick={props.onRetry}>
              点击重试
            </button>
          </div>
        ) : annotations === null ? (
          <div className="tv-anno-panel-empty">加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="tv-anno-panel-empty">暂无批注</div>
        ) : (
          filtered.map((a) => <AnnotationCard key={a.id} a={a} store={props.store} {...ctx} />)
        )}
      </div>
    </div>
  );
}

/** 单楼卡片：头像（哈希取色）/用户名/时间/引用块/正文/操作行/回复区/楼底输入框 */
function AnnotationCard({ a, store, ...ctx }: { a: Annotation; store: AnnotationStore } & PanelCtx) {
  const notify = useNotify();
  const canEdit = a.author === ctx.me;                        // 编辑仅作者
  const canDelete = a.author === ctx.me || ctx.isAdmin;       // 删除：作者或 admin
  const canResolve = a.author === ctx.me || ctx.isAdmin;      // 解决：作者或 admin
  const dead = ctx.deadIds.has(a.id);
  const topLevel = useMemo(() => a.replies.filter((r) => r.parent_id === null), [a.replies]);
  const [expanded, setExpanded] = useState(false);      // 回复区默认收起
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyingTo, setReplyingTo] = useState<AnnotationReply | null>(null);
  const [sending, setSending] = useState(false);

  async function saveEdit() {
    const text = draft.trim();
    if (!text || editSaving) return;
    setEditSaving(true);
    try {
      await store.update(a.id, text, "annotation");
      setEditing(false);
      ctx.onChanged();                                  // 组合层重拉
    } catch {
      notify("error", "保存失败");
    } finally {
      setEditSaving(false);
    }
  }

  // 一级回复（楼底输入框）不传 parent；「回复 @xxx」态传该回复 id
  async function sendReply() {
    const text = replyText.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await store.reply(a.id, text, replyingTo ? replyingTo.id : undefined);
      setReplyText("");
      setReplyingTo(null);
      ctx.onChanged();
    } catch {
      notify("error", "发送失败,请重试");
    } finally {
      setSending(false);
    }
  }

  async function toggleLike() {
    const liked = !a.liked_by_me;
    try {
      const next = await store.setLike(a.id, "annotation", liked);
      ctx.onLike("annotation", a.id, next);             // 组合层本地增量
    } catch {
      notify("error", "操作失败,请重试");
    }
  }

  async function toggleResolved() {
    try {
      await store.setResolved(a.id, a.resolved !== 1);
      ctx.onChanged();
    } catch {
      notify("error", "操作失败,请重试");
    }
  }

  async function doDelete() {
    try {
      await store.delete(a.id, "annotation");           // 持久层级联删回复
      ctx.onChanged();
    } catch {
      notify("error", "操作失败,请重试");
    }
  }

  return (
    <div className="tv-anno-card" data-tv-anno-card={a.id}>
      <div className="tv-anno-card-head">
        <TvAvatar name={a.author} size={24} />
        <span className="tv-anno-card-author">{a.author}</span>
        <span className="tv-anno-card-time" title={fmtFull(a.created_at)}>{fmtShort(a.created_at)}</span>
        {a.updated_at > a.created_at && <span className="tv-anno-card-edited">已编辑</span>}
      </div>
      <blockquote className="tv-anno-quote" title={a.quote} onClick={() => ctx.onQuoteClick(a)}>{a.quote}</blockquote>
      {dead && <span className="tv-anno-dead">原文已变更</span>}
      {editing ? (
        <div className="tv-anno-card-editor">
          <textarea autoFocus rows={3} value={draft}
                    onChange={(e) => setDraft(e.target.value)} />
          <div className="tv-anno-card-editor-actions">
            <button type="button" onClick={() => { setEditing(false); setDraft(""); }}>取消</button>
            <button type="button" disabled={!draft.trim() || editSaving}
                    onClick={() => void saveEdit()}>保存</button>
          </div>
        </div>
      ) : (
        <div className="tv-anno-card-body">{a.body}</div>
      )}
      <div className="tv-anno-actions">
        <button type="button" className={"tv-anno-like" + (a.liked_by_me ? " liked" : "")}
                title="点赞" onClick={() => void toggleLike()}>
          <FontAwesomeIcon icon={faThumbsUp} /> {a.like_count}
        </button>
        <span><FontAwesomeIcon icon={faCommentDots} /> {a.replies.length}</span>
        {a.resolved === 1 && (
          <span className="tv-anno-resolved-badge"><FontAwesomeIcon icon={faCheck} /> 已解决</span>
        )}
        {canResolve && (
          <button type="button" onClick={() => void toggleResolved()}>
            {a.resolved === 1 ? "重新打开" : "标记解决"}
          </button>
        )}
        {canEdit && (
          <button type="button" className="tv-anno-hover-only"
                  onClick={() => { setDraft(a.body); setEditing(true); }}>
            编辑
          </button>
        )}
        {canDelete && (
          <ConfirmButton className="tv-anno-hover-only" label="删除"
                         confirmLabel={deleteTitle(a.replies.length)}
                         onConfirm={() => void doDelete()} />
        )}
      </div>
      {a.replies.length > 0 && (
        <div className="tv-anno-replies">
          {expanded ? (
            <>
              <button type="button" className="tv-anno-reply-toggle"
                      onClick={() => setExpanded(false)}>收起回复</button>
              {/* 树组装：一级=parent_id 为 null；二级=parent_id 指向该一级 */}
              {topLevel.map((r) => (
                <ReplyItem key={r.id} r={r} store={store} ctx={ctx} onReply={setReplyingTo}
                           childReplies={a.replies.filter((c) => c.parent_id === r.id)} />
              ))}
            </>
          ) : (
            <button type="button" className="tv-anno-reply-toggle"
                    onClick={() => setExpanded(true)}>
              {/* 计数=总回复数（含二级），与操作行 💬 计数一致；一级条数会低估用户感知 */}
              查看 {a.replies.length} 条回复
            </button>
          )}
        </div>
      )}
      {replyingTo && (
        <div className="tv-anno-replying-to">
          <span>回复 @{replyingTo.author}</span>
          <button type="button" onClick={() => setReplyingTo(null)}>取消</button>
        </div>
      )}
      <div className="tv-anno-reply-input">
        <input
          value={replyText}
          placeholder={replyingTo ? `回复 @${replyingTo.author}` : "写下回复…"}
          onChange={(e) => setReplyText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void sendReply(); }}
        />
        <TvTooltip title="Ctrl / ⌘ + Enter 发送">
          <button type="button" disabled={!replyText.trim() || sending}
                  onClick={() => void sendReply()}>
            发送
          </button>
        </TvTooltip>
      </div>
    </div>
  );
}

/** 回复行：作者/时间/正文/操作行（点赞/回复/编辑/删除）；childReplies 渲染为二级缩进 */
function ReplyItem({ r, childReplies, store, ctx, onReply }: {
  r: AnnotationReply;
  childReplies: AnnotationReply[];
  store: AnnotationStore;
  ctx: PanelCtx;
  onReply: (reply: AnnotationReply) => void;
}) {
  const notify = useNotify();
  const canEdit = r.author === ctx.me;                        // 编辑仅作者
  const canDelete = r.author === ctx.me || ctx.isAdmin;       // 删除：作者或 admin
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  async function saveEdit() {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      await store.update(r.id, text, "reply");
      setEditing(false);
      ctx.onChanged();
    } catch {
      notify("error", "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function toggleLike() {
    const liked = !r.liked_by_me;
    try {
      const next = await store.setLike(r.id, "reply", liked);
      ctx.onLike("reply", r.id, next);
    } catch {
      notify("error", "操作失败,请重试");
    }
  }

  async function doDelete() {
    try {
      await store.delete(r.id, "reply");                  // 持久层级联删其子回复
      ctx.onChanged();
    } catch {
      notify("error", "操作失败,请重试");
    }
  }

  return (
    // 二级缩进（更深层持久层已压平）；一级回复正常缩进
    <div className={"tv-anno-reply" + (r.parent_id !== null ? " tv-anno-reply-l2" : "")}>
      <div className="tv-anno-card-head">
        <span className="tv-anno-card-author">{r.author}</span>
        <span className="tv-anno-card-time" title={fmtFull(r.created_at)}>{fmtShort(r.created_at)}</span>
        {r.updated_at > r.created_at && <span className="tv-anno-card-edited">已编辑</span>}
      </div>
      {editing ? (
        <div className="tv-anno-card-editor">
          <textarea autoFocus rows={2} value={draft}
                    onChange={(e) => setDraft(e.target.value)} />
          <div className="tv-anno-card-editor-actions">
            <button type="button" onClick={() => setEditing(false)}>取消</button>
            <button type="button" disabled={!draft.trim() || saving}
                    onClick={() => void saveEdit()}>保存</button>
          </div>
        </div>
      ) : (
        <div className="tv-anno-card-body">{r.body}</div>
      )}
      <div className="tv-anno-actions">
        <button type="button" className={"tv-anno-like" + (r.liked_by_me ? " liked" : "")}
                title="点赞" onClick={() => void toggleLike()}>
          <FontAwesomeIcon icon={faThumbsUp} /> {r.like_count}
        </button>
        <button type="button" onClick={() => onReply(r)}>回复</button>
        {canEdit && (
          <button type="button" className="tv-anno-hover-only"
                  onClick={() => { setDraft(r.body); setEditing(true); }}>
            编辑
          </button>
        )}
        {canDelete && (
          <ConfirmButton className="tv-anno-hover-only" label="删除"
                         confirmLabel={deleteTitle(childReplies.length)}
                         onConfirm={() => void doDelete()} />
        )}
      </div>
      {/* 二级回复紧随其一级；不再更深（持久层已压平） */}
      {childReplies.map((c) => (
        <ReplyItem key={c.id} r={c} childReplies={[]} store={store} ctx={ctx} onReply={onReply} />
      ))}
    </div>
  );
}
```

Run: `npx vitest run src/components/AnnotationPanel.test.tsx && npx tsc --noEmit`
Expected: 全绿

- [ ] **Step 3: Commit**

```bash
git add src/components/AnnotationPanel.*
git commit -m "feat: AnnotationPanel 评论区面板去 antd 重写（store 驱动 + 行内二次确认）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---
### Task 13: TrajectoryViewer 组合层 + 包出口

**Files:**
- Create: `src/components/TrajectoryViewer.tsx`
- Modify: `src/index.ts`（替换占位 `export {};`）
- Test: `src/components/TrajectoryViewer.test.tsx`

**Interfaces:**
- Consumes: 三个 data hook、`MessageStreamView`（+`MessageStreamViewHandle`/`FoldAction`）、`DeliveryDrawer`、`AnnotationPanel`、`NotifyProvider`/`useNotify`、`TvSegmented`/`TvBadge`/`TvTooltip`、全部公共类型
- Produces（包的公开 API，Task 16 文档与此一致）:
  - `TrajectoryViewerProps { dataSource: TrajectoryDataSource; delivery?: string[]; resolveDeliveryUrl?: (path: string) => string; annotationStore?: AnnotationStore; currentUser?: { name: string; isAdmin?: boolean }; renderRaw?: (raw: unknown) => ReactNode; onNotify?: (kind: NotifyKind, text: string) => void; toolbar?: false; className?: string }`
  - `TrajectoryViewerHandle { scrollToAnnotation(msgIdx: number, annoId: number): Promise<boolean> }`
  - `src/index.ts` 再导出上述组件/类型 + `AnnotationPanel`/`DeliveryDrawer` 二级组件 + 全部公共类型

- [ ] **Step 1: 写失败测试 `src/components/TrajectoryViewer.test.tsx`**

```tsx
import { createRef } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { Annotation, AnnotationStore, Msg, MsgPage, TrajectoryDataSource } from "../types";
import TrajectoryViewer, { type TrajectoryViewerHandle } from "./TrajectoryViewer";

class MockIO {
  static instances: MockIO[] = [];
  private cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) { this.cb = cb; MockIO.instances.push(this); }
  observe(): void {} unobserve(): void {} disconnect(): void {}
  show(): void { this.cb([{ isIntersecting: true } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
}
vi.stubGlobal("IntersectionObserver", MockIO);
beforeEach(() => { MockIO.instances.length = 0; vi.clearAllMocks(); });

function m(idx: number, role: string, content: string, extra: Partial<Msg> = {}): Msg {
  return { idx, role, preview: "", content_len: content.length, content, reasoning_len: 0, ...extra };
}
function pageOf(messages: Msg[], from = 0, hasMore = false): MsgPage {
  return { messages, from, returned: messages.length, has_more: hasMore };
}
function dsOf(msgs: Msg[], raw: unknown = {}): TrajectoryDataSource {
  return {
    fetchMessages: vi.fn(async () => pageOf(msgs)),
    fetchRaw: vi.fn(async () => raw),
  };
}
function storeOf(list: Annotation[] = []): AnnotationStore {
  return {
    list: vi.fn(async () => list),
    create: vi.fn(async () => ({})),
    reply: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => undefined),
    setResolved: vi.fn(async () => ({})),
    setLike: vi.fn(async () => ({ likeCount: 1, likedByMe: true })),
  };
}

test("消息流渲染 + 工具栏切换 JSON 视图（默认 JsonHighlight）", async () => {
  const ds = dsOf([m(0, "user", "你好")], { a: 1 });
  render(<TrajectoryViewer dataSource={ds} />);
  await screen.findByText("你好");
  screen.getByRole("tab", { name: "JSON" }).click();
  await waitFor(() => expect(document.querySelector(".tv-json-highlight")).not.toBeNull());
  expect(ds.fetchRaw).toHaveBeenCalledTimes(1);
});

test("renderRaw 自定义渲染器接管 JSON 视图", async () => {
  const ds = dsOf([], { b: 2 });
  render(<TrajectoryViewer dataSource={ds} renderRaw={(r) => <div data-testid="myraw">{JSON.stringify(r)}</div>} />);
  screen.getByRole("tab", { name: "JSON" }).click();
  await screen.findByTestId("myraw");
});

test("dataSource identity 变化 = 换记录：重置并重新拉取", async () => {
  const ds1 = dsOf([m(0, "user", "记录一")]);
  const ds2 = dsOf([m(0, "user", "记录二")]);
  const { rerender } = render(<TrajectoryViewer dataSource={ds1} />);
  await screen.findByText("记录一");
  rerender(<TrajectoryViewer dataSource={ds2} />);
  await screen.findByText("记录二");
  expect(ds2.fetchMessages).toHaveBeenCalled();
});

test("annotationStore 缺省：评论区入口不出现", async () => {
  render(<TrajectoryViewer dataSource={dsOf([])} />);
  await waitFor(() => expect(MockIO.instances.length).toBeGreaterThanOrEqual(0));
  expect(screen.queryByLabelText("批注与讨论")).toBeNull();
});

test("annotationStore 在：入口徽标显示未解决数，点击开面板", async () => {
  const a: Annotation = {
    id: 7, msg_idx: 0, region: "content", sub: null, quote: "q", prefix: "", suffix: "",
    author: "alice", body: "楼", resolved: 0, resolved_by: null, resolved_at: null,
    created_at: 1, updated_at: 1, like_count: 0, liked_by_me: false, replies: [],
  };
  render(<TrajectoryViewer dataSource={dsOf([])} annotationStore={storeOf([a])}
                         currentUser={{ name: "bob", isAdmin: true }} />);
  await waitFor(() => expect(document.querySelector(".tv-badge-count")).toHaveTextContent("1"));
  screen.getByLabelText("批注与讨论").click();
  await screen.findByText("楼");
});

test("toolbar=false 时不渲染工具栏", () => {
  render(<TrajectoryViewer dataSource={dsOf([])} toolbar={false} />);
  expect(screen.queryByRole("tablist")).toBeNull();
});

test("ref.scrollToAnnotation 透传视图跨页定位（无此消息返回 false）", async () => {
  const ref = createRef<TrajectoryViewerHandle>();
  render(<TrajectoryViewer ref={ref} dataSource={dsOf([])} />);
  await waitFor(() => expect(ref.current).not.toBeNull());
  await expect(ref.current!.scrollToAnnotation(99, 1)).resolves.toBe(false);
});
```

Run: `npx vitest run src/components/TrajectoryViewer.test.tsx`
Expected: FAIL（组件不存在）

- [ ] **Step 2: 完整写入 `src/components/TrajectoryViewer.tsx`**

```tsx
/** TrajectoryViewer 组合层（包公开主组件）：
 *  工具栏（视图切换/批量折叠/评论区开关/交付物开关）+ 消息流 + 评论区面板 + 交付物抽屉。
 *  dataSource identity 变化 = 换记录：消息视图经 recordKey 重挂载复位本地态，
 *  各 data hook 按 identity 自行重置重拉。两面板开合互斥。 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { faCommentDots, faCompress, faExpand, faFolderOpen } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type {
  AnchorInput, Annotation, AnnotationStore, NotifyKind, TrajectoryDataSource,
} from "../types";
import { useMessageStreamData } from "../data/useMessageStreamData";
import { useRawData } from "../data/useRawData";
import { useAnnotations } from "../data/useAnnotations";
import MessageStreamView, { type FoldAction, type MessageStreamViewHandle } from "./MessageStreamView";
import DeliveryDrawer from "./DeliveryDrawer";
import AnnotationPanel from "./AnnotationPanel";
import { NotifyProvider, useNotify } from "../ui/notify";
import { TvSegmented } from "../ui/TvSegmented";
import { TvBadge } from "../ui/TvBadge";
import { TvTooltip } from "../ui/TvTooltip";

export interface TrajectoryViewerHandle {
  /** 定位批注高亮（跨页自动续拉）；false=全量加载后仍无此消息 */
  scrollToAnnotation(msgIdx: number, annoId: number): Promise<boolean>;
}

export interface TrajectoryViewerProps {
  /** 数据源适配器；对象 identity 变化 = 换记录，组件自动重置重拉 */
  dataSource: TrajectoryDataSource;
  /** 交付物路径列表（底部入口卡 + 抽屉） */
  delivery?: string[];
  /** 文件点击打开链接；不传则文件行不可点 */
  resolveDeliveryUrl?: (path: string) => string;
  /** 评论存储适配器；不传 = 评论功能整体关闭（划线/面板入口不出现） */
  annotationStore?: AnnotationStore;
  /** 当前用户（评论编辑/删除/解决权限判定）；缺省评论区只读 */
  currentUser?: { name: string; isAdmin?: boolean };
  /** 原数据渲染 slot；不传用内置 JsonHighlight */
  renderRaw?: (raw: unknown) => ReactNode;
  /** 全局通知；不传用内置 toast 兜底 */
  onNotify?: (kind: NotifyKind, text: string) => void;
  /** false = 隐藏内置工具栏（配 ref 自建 chrome） */
  toolbar?: false;
  className?: string;
}

type Mode = "parsed" | "raw";

const TrajectoryViewer = forwardRef<TrajectoryViewerHandle, TrajectoryViewerProps>(
  function TrajectoryViewer(props, ref) {
    return (
      <NotifyProvider onNotify={props.onNotify}>
        <ViewerInner {...props} handleRef={ref} />
      </NotifyProvider>
    );
  },
);

function ViewerInner(props: TrajectoryViewerProps & {
  handleRef: React.ForwardedRef<TrajectoryViewerHandle>;
}) {
  const {
    dataSource, delivery, resolveDeliveryUrl, annotationStore, currentUser,
    renderRaw, toolbar, className, handleRef,
  } = props;
  const notify = useNotify();
  const [mode, setMode] = useState<Mode>("parsed");
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [annoOpen, setAnnoOpen] = useState(false);
  const [focusId, setFocusId] = useState<number | null>(null);
  // foldAction = 「下一次批量动作」：解析后视图卡片默认全收起 → 首次为展开
  const [foldAction, setFoldAction] = useState<FoldAction>("expand");

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<MessageStreamViewHandle | null>(null);

  const stream = useMessageStreamData(dataSource, sentinelRef, mode === "parsed");
  const { raw, rawError } = useRawData(dataSource, mode === "raw");
  const annos = useAnnotations(annotationStore, dataSource);

  // 换记录：mode/面板/定位复位 + recordKey 递增（消息视图重挂载复位划线浮层等本地态）
  const [recordKey, setRecordKey] = useState(0);
  const prevDs = useRef(dataSource);
  useEffect(() => {
    if (prevDs.current === dataSource) return;
    prevDs.current = dataSource;
    setMode("parsed");
    setDeliveryOpen(false);
    setAnnoOpen(false);
    setFocusId(null);
    setRecordKey((k) => k + 1);
  }, [dataSource]);

  // 两面板互斥（并排展开会挤压主区域）：开其一必收另一
  function toggleDelivery() {
    setDeliveryOpen((o) => !o);
    setAnnoOpen(false);
  }
  function toggleAnno() {
    setAnnoOpen((o) => !o);
    setDeliveryOpen(false);
  }

  /** 划线建楼：成功重拉（高亮 effect 自动包 mark），失败提示并保留草稿 */
  async function handleCreateAnnotation(anchor: AnchorInput, body: string): Promise<boolean> {
    if (!annotationStore) return false;
    try {
      await annotationStore.create({ ...anchor, body });
      annos.reload();
      return true;
    } catch (e) {
      notify("error", `评注发布失败: ${(e as Error).message}`);
      return false;
    }
  }

  /** 点高亮 → 开面板定位卡片（卡片闪烁）；与交付物抽屉互斥 */
  function handleMarkClick(annoId: number) {
    setAnnoOpen(true);
    setDeliveryOpen(false);
    setFocusId(annoId);
  }

  /** 卡片引用块点击 → 滚动定位高亮（跨页自动续拉）；失效楼直接提示 */
  function handleQuoteClick(a: Annotation) {
    if (annos.deadIds.has(a.id)) {
      notify("info", "原文已变更,无法定位");
      return;
    }
    void viewRef.current?.scrollToAnnotation(a.msg_idx, a.id).then((ok) => {
      if (!ok) notify("info", "无法定位原文(可能已变更或尚未加载)");
    });
  }

  /** 工具栏「展开/关闭所有消息」：按视图返回值翻转下一次动作 */
  function handleToggleFold() {
    const done = viewRef.current?.toggleAllCards();
    if (done === "expand") setFoldAction("collapse");
    else if (done === "collapse") setFoldAction("expand");
  }

  useImperativeHandle(handleRef, () => ({
    scrollToAnnotation: (msgIdx, annoId) =>
      viewRef.current?.scrollToAnnotation(msgIdx, annoId) ?? Promise.resolve(false),
  }), []);

  const unresolved = annos.annotations?.filter((a) => a.resolved === 0).length ?? 0;
  const foldLabel = foldAction === "collapse" ? "收起" : "展开";

  return (
    <div className={"tv-root" + (className ? " " + className : "")}>
      <div className="tv-main">
        {toolbar !== false && (
          <div className="tv-toolbar">
            <TvSegmented
              value={mode}
              onChange={(v) => setMode(v)}
              options={[
                { label: "轨迹", value: "parsed" },
                { label: "JSON", value: "raw" },
              ]}
            />
            <div className="tv-toolbar-actions">
              {delivery?.length ? (
                <TvTooltip title="文件夹">
                  <button type="button" className="tv-tool-btn tv-delivery-drawer-trigger"
                          aria-label="文件夹" aria-expanded={deliveryOpen}
                          onClick={toggleDelivery}>
                    <FontAwesomeIcon icon={faFolderOpen} />
                  </button>
                </TvTooltip>
              ) : null}
              {annotationStore ? (
                <TvBadge count={unresolved}>
                  <TvTooltip title="批注与讨论">
                    <button type="button" className="tv-tool-btn tv-anno-panel-trigger"
                            aria-label="批注与讨论" aria-expanded={annoOpen}
                            onClick={toggleAnno}>
                      <FontAwesomeIcon icon={faCommentDots} />
                    </button>
                  </TvTooltip>
                </TvBadge>
              ) : null}
              <TvTooltip title={foldLabel}>
                <button type="button" className="tv-tool-btn" aria-label={foldLabel}
                        disabled={mode === "raw"}
                        onClick={handleToggleFold}>
                  <FontAwesomeIcon icon={foldAction === "collapse" ? faCompress : faExpand} />
                </button>
              </TvTooltip>
            </div>
          </div>
        )}
        <div className="tv-flow">
          <MessageStreamView
            key={recordKey}
            ref={viewRef}
            mode={mode}
            msgs={stream.msgs}
            msgError={stream.msgError}
            onRetryMessages={stream.reload}
            loadMore={stream.loadMore}
            loadedRef={stream.loadedRef}
            sentinelRef={sentinelRef}
            raw={raw}
            rawError={rawError}
            renderRaw={renderRaw}
            delivery={delivery}
            deliveryOpen={deliveryOpen}
            onToggleDelivery={toggleDelivery}
            annotations={annos.annotations}
            onCreateAnnotation={annotationStore ? handleCreateAnnotation : undefined}
            onMarkClick={handleMarkClick}
            onAnchorsReconciled={annos.reportDead}
            onActionChange={setFoldAction}
          />
        </div>
      </div>
      {delivery?.length ? (
        <DeliveryDrawer
          delivery={delivery}
          open={deliveryOpen}
          onClose={() => setDeliveryOpen(false)}
          resolveDeliveryUrl={resolveDeliveryUrl}
        />
      ) : null}
      {annotationStore ? (
        <AnnotationPanel
          open={annoOpen}
          onClose={() => setAnnoOpen(false)}
          store={annotationStore}
          annotations={annos.annotations}
          loadError={annos.loadError}
          onRetry={annos.reload}
          me={currentUser?.name ?? ""}
          isAdmin={currentUser?.isAdmin ?? false}
          deadIds={annos.deadIds}
          focusId={focusId}
          onFocusConsumed={() => setFocusId(null)}
          onQuoteClick={handleQuoteClick}
          onChanged={annos.reload}
          onLike={annos.applyLike}
        />
      ) : null}
    </div>
  );
}

export default TrajectoryViewer;
```

- [ ] **Step 3: 写包出口 `src/index.ts`（替换占位）**

```ts
/** trajectory-viewer 公开出口 */
export { default as TrajectoryViewer } from "./components/TrajectoryViewer";
export type { TrajectoryViewerProps, TrajectoryViewerHandle } from "./components/TrajectoryViewer";
export { default as AnnotationPanel } from "./components/AnnotationPanel";
export type { AnnotationPanelProps } from "./components/AnnotationPanel";
export { default as DeliveryDrawer } from "./components/DeliveryDrawer";
export type { DeliveryDrawerProps } from "./components/DeliveryDrawer";
export type {
  AnchorInput,
  Annotation,
  AnnotationRegion,
  AnnotationReply,
  AnnotationStore,
  LikeResult,
  Msg,
  MsgPage,
  NotifyKind,
  ToolCall,
  TrajectoryDataSource,
} from "./types";
```

Run: `npx vitest run && npx tsc --noEmit && npx tsup`
Expected: 测试全绿；构建产出 `dist/index.js`/`index.cjs`/`index.d.ts`/`style.css`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: TrajectoryViewer 组合层（内置工具栏与双面板互斥）与包出口

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---
### Task 14: style.css 全量样式抽取（消息流/批注/交付物/hljs）+ 样式自检测试

**Files:**
- Modify: `src/style.css`（在 Task 5 基建段后追加）
- Test: `src/styleCss.test.ts`

**Interfaces:**
- Consumes: `SRC/global.css`（只读）
- Produces: 完整 `src/style.css`（组件全部类名均有对应规则）

- [ ] **Step 1: 写失败测试 `src/styleCss.test.ts`**

```ts
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
```

Run: `npx vitest run src/styleCss.test.ts`
Expected: FAIL（缺流/批注/交付物段落；可能残留 hex）

- [ ] **Step 2: 抽取样式规则到 `src/style.css` 末尾**

从 `SRC/global.css` 抽取以下选择器前缀的全部规则块（用 `grep -n "^\.chat-\|^\.pair-\|^\.anno-\|^\.delivery-\|^\.markdown\|^\.code-\|^\.json-\|^\.hljs\|^@keyframes"` 定位区段），按下面四步转换后追加到 `src/style.css`：

1. **应用全局重命名表**（`chat-*`→`tv-chat-*` 等；`@keyframes anno-flash`→`tv-anno-flash`；`hljs` 系不变）。不抽取：`detail-*`、`rec-*`、`app-*`、`ws-*`、`topbar`、`login`、布局壳与 `monaco-container`。
2. **源 `--color-*` 变量改名映射**（值已在 Task 5 根块定义，引用处改名即可）：`--color-primary`→`--tv-primary`、`--color-secondary`→`--tv-secondary`、`--color-ink`→`--tv-ink`、`--color-ink-secondary`→`--tv-ink-secondary`、`--color-ink-tertiary`→`--tv-ink-tertiary`、`--color-canvas`→`--tv-canvas`、`--color-surface`→`--tv-surface`、`--color-surface-hover`→`--tv-surface-hover`、`--color-border`→`--tv-border`、`--color-border-strong`→`--tv-border-strong`、`--color-link`→`--tv-accent`、`--color-link-weak`→`--tv-accent-weak`。源 `:root` 里 `--sys`/`--user` 等 legacy tokens 与 `--shadow-*`/`--radius-*`/`--duration-*`：被抽取规则若引用，`--shadow-sm`→`--tv-shadow-sm`（补进根块，浅色 `0 2px 4px rgba(0,0,0,0.03)`，暗色 `0 2px 4px rgba(0,0,0,0.3)`），radius/duration 直接保留字面值（不进变量表，避免破坏「暗色变量集合一致」测试——若加入则两处暗色块同步加同名同值即可）。
3. **硬编码颜色字面值 → 变量引用**：`#dc2626`/`#c62828`→`var(--tv-danger)`；`rgba(229,115,115,0.12)`/`#fef2f2`→`var(--tv-danger-weak)`；`#ffe58f`→`var(--tv-mark-bg)`；`#ffb020`→`var(--tv-mark-peak)`；`rgba(255,176,32,0.55)`→`var(--tv-flash-ring)`；`#b26a00`→`var(--tv-dead)`；`#2563eb`→`var(--tv-accent)`；`rgba(37,99,235,0.08)`→`var(--tv-accent-weak)`；`#fff`/`#ffffff`（作为面板/卡片背景时）→`var(--tv-surface)`、`#f6f6f6`（灰底代码块/气泡底）→`var(--tv-code-bg)`；`rgba(0,0,0,0.45)`→`var(--tv-dim)`；hljs token 各色（#24292e/#d73a49/#6f42c1/#005cc5/#032f62/#e36209/#6a737d/#22863a/#f0fff4/#ffeef0/#b31d28）→对应 `--tv-hljs-*`。**文字色 `#fff`（主按钮白字、badge/avatar 文字）一律 `var(--tv-on-accent)`**——Task 5 根块已定义（三处变量块同步、恒为 `#ffffff`；暗色 `--tv-accent` 取深蓝 `#3b6fd4` 保证白字对比度）。
4. **新增组合层样式**（源项目不存在，按设计补齐，追加到文件末尾）：

```css
/* —— 组合层骨架 —— */
.tv-root { position: relative; }
.tv-main { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.tv-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 12px; border-bottom: 1px solid var(--tv-border);
  background: var(--tv-surface); flex-shrink: 0;
}
.tv-toolbar-actions { display: flex; align-items: center; gap: 4px; }
.tv-tool-btn {
  border: none; background: transparent; color: var(--tv-secondary);
  width: 28px; height: 28px; border-radius: 6px; cursor: pointer; font-size: 14px;
}
.tv-tool-btn:hover:not(:disabled) { background: var(--tv-accent-weak); color: var(--tv-ink); }
.tv-tool-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.tv-flow { flex: 1; min-height: 0; overflow: auto; padding: 12px 16px; }

.tv-dim { color: var(--tv-dim); }
.tv-msg-error { margin-bottom: 8px; }
.tv-error-text { color: var(--tv-danger); }
.tv-link-btn {
  border: none; background: transparent; color: var(--tv-accent);
  cursor: pointer; font-size: 13px; padding: 0 4px;
}
```

完成后 Run: `npx vitest run src/styleCss.test.ts`
Expected: PASS（若「硬编码 hex」测试失败，按第 3 步映射补漏；暗色块变量集合不一致则补齐同名变量）

- [ ] **Step 3: 全量验证 + Commit**

Run: `npx vitest run && npx tsc --noEmit && npx tsup`
Expected: 全绿；`dist/style.css` 完整

```bash
git add -A
git commit -m "feat: 样式全量抽取（tv- 前缀 + CSS 变量 + 暗色）与样式自检测试

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 15: demo 演示页（mock 数据源 + 内存评论存储）

**Files:**
- Create: `demo/index.html`、`demo/main.tsx`、`demo/mock.ts`

**Interfaces:**
- Consumes: 包公开 API（`../src/index`）
- Produces: `npm run dev` 可全功能点验的演示页（也是 README 最小示例出处）

- [ ] **Step 1: 写 `demo/mock.ts`**

```ts
import type {
  Annotation, AnnotationReply, AnnotationStore, Msg, MsgPage, TrajectoryDataSource,
} from "../src/types";

/** 生成 340 条演示消息：system + user + 多轮 assistant（推理/正文/工具调用）+ tool 结果，
 *  覆盖失败结果、weight=0、孤立 tool 等渲染分支（翻页由 limit 切片触发） */
function buildMessages(): Msg[] {
  const msgs: Msg[] = [
    { idx: 0, role: "system", preview: "", content_len: 20, reasoning_len: 0,
      content: "你是演示助手。系统提示卡片默认收起。" },
    { idx: 1, role: "user", preview: "", content_len: 12, reasoning_len: 0,
      content: "帮我检查一下这个项目的构建脚本。" },
  ];
  let idx = 2;
  for (let round = 0; round < 40; round++) {
    msgs.push({
      idx: idx++, role: "assistant", preview: "", content_len: 60, reasoning_len: 30,
      reasoning_content: `第 ${round + 1} 轮：先想想该怎么查。\n\n- 看 package.json\n- 看构建产物`,
      content: `我来查看构建配置（第 ${round + 1} 轮）。`,
      weight: round === 3 ? 0 : undefined,   // 第 4 轮演示 weight=0 遮眼徽标
      tool_calls: [{
        id: `call_${round}`, type: "function",
        function: { name: "exec", arguments: JSON.stringify({ command: `cat package.json | jq .scripts # round ${round}` }) },
      }],
    });
    msgs.push({
      idx: idx++, role: "tool", preview: "", content_len: 40, reasoning_len: 0,
      tool_call_id: `call_${round}`,
      content: round === 5
        ? "Error: command not found"          // 演示失败结果红色标记
        : JSON.stringify({ status: "ok", round, scripts: { build: "tsup", test: "vitest run" } }),
    });
    if (round % 7 === 6) {
      msgs.push({
        idx: idx++, role: "assistant", preview: "", content_len: 30, reasoning_len: 0,
        content: `阶段性小结：前 ${round + 1} 轮检查完成，构建脚本正常。\n\n\`\`\`json\n{"done": ${round + 1}}\n\`\`\``,
      });
    }
  }
  return msgs;
}

const ALL = buildMessages();
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createMockDataSource(): TrajectoryDataSource {
  return {
    async fetchMessages({ from, limit }): Promise<MsgPage> {
      await delay(150);
      const slice = ALL.slice(from, from + limit);
      return { messages: slice, from, returned: slice.length, has_more: from + slice.length < ALL.length };
    },
    async fetchRaw() {
      await delay(150);
      return { demo: true, total: ALL.length, sample: ALL[0] };
    },
  };
}

/** 内存评论存储：id 自增，回复两级压平 */
export function createMockStore(): AnnotationStore {
  let seq = 1;
  let replySeq = 100;
  const annotations: Annotation[] = [];
  const clone = () => JSON.parse(JSON.stringify(annotations)) as Annotation[];
  return {
    async list() { await delay(80); return clone(); },
    async create(input) {
      await delay(80);
      annotations.push({
        ...input, id: seq++, author: "demo", resolved: 0, resolved_by: null, resolved_at: null,
        created_at: Date.now() / 1000, updated_at: Date.now() / 1000,
        like_count: 0, liked_by_me: false, replies: [],
      });
      return {};
    },
    async reply(annotationId, body, parentId) {
      await delay(80);
      const a = annotations.find((x) => x.id === annotationId);
      if (!a) throw new Error("楼不存在");
      const r: AnnotationReply = {
        id: replySeq++, annotation_id: annotationId, parent_id: parentId ?? null,
        author: "demo", body, created_at: Date.now() / 1000, updated_at: Date.now() / 1000,
        like_count: 0, liked_by_me: false,
      };
      a.replies.push(r);
      return r;
    },
    async update(id, body, kind) {
      await delay(80);
      const now = Date.now() / 1000;
      for (const a of annotations) {
        if (kind === "annotation" && a.id === id) { a.body = body; a.updated_at = now; return a; }
        const r = a.replies.find((x) => x.id === id);
        if (kind === "reply" && r) { r.body = body; r.updated_at = now; return r; }
      }
      throw new Error("目标不存在");
    },
    async delete(id, kind) {
      await delay(80);
      if (kind === "annotation") {
        const i = annotations.findIndex((x) => x.id === id);
        if (i >= 0) annotations.splice(i, 1);
        return;
      }
      for (const a of annotations) {
        const i = a.replies.findIndex((x) => x.id === id);
        if (i >= 0) { a.replies.splice(i, 1); return; }
      }
    },
    async setResolved(id, resolved) {
      await delay(80);
      const a = annotations.find((x) => x.id === id);
      if (!a) throw new Error("楼不存在");
      a.resolved = resolved ? 1 : 0;
      a.resolved_by = resolved ? "demo" : null;
      a.resolved_at = resolved ? Date.now() / 1000 : null;
      return a;
    },
    async setLike(targetId, kind, liked) {
      await delay(60);
      let cur: { like_count: number; liked_by_me: boolean } | undefined;
      for (const a of annotations) {
        if (kind === "annotation" && a.id === targetId) cur = a;
        const r = a.replies.find((x) => x.id === targetId);
        if (kind === "reply" && r) cur = r;
      }
      if (!cur) throw new Error("目标不存在");
      cur.like_count += liked ? 1 : -1;
      cur.liked_by_me = liked;
      return { likeCount: cur.like_count, likedByMe: cur.liked_by_me };
    },
  };
}

export const MOCK_DELIVERY = [
  "./d/demo-001/report/index.html",
  "./d/demo-001/report/assets/app.js",
  "./d/demo-001/notes/summary.md",
];
```

- [ ] **Step 2: 写 `demo/index.html` 与 `demo/main.tsx`**

`demo/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>trajectory-viewer 演示</title>
    <style>
      html, body, #app { height: 100%; margin: 0; }
      body { font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`demo/main.tsx`：

```tsx
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { TrajectoryViewer } from "../src/index";
import { createMockDataSource, createMockStore, MOCK_DELIVERY } from "./mock";
import "../src/style.css";

function App() {
  // 两个记录 id 演示「dataSource identity 变化 = 换记录」
  const [record, setRecord] = useState(0);
  const dataSource = useMemo(() => createMockDataSource(), [record]);
  const store = useMemo(() => createMockStore(), [record]);
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: 8, borderBottom: "1px solid #ddd", flexShrink: 0 }}>
        <button onClick={() => setRecord((r) => r + 1)}>切换记录（当前 #{record + 1}）</button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <TrajectoryViewer
          dataSource={dataSource}
          delivery={MOCK_DELIVERY}
          resolveDeliveryUrl={(p) => `https://example.com/files/${encodeURIComponent(p)}`}
          annotationStore={store}
          currentUser={{ name: "demo", isAdmin: true }}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("app")!).render(<App />);
```

- [ ] **Step 3: 验证构建与类型**

Run: `npx tsc --noEmit && npx vite build demo --outDir demo-dist --emptyOutDir`
Expected: 构建成功（demo 产物输出到 `demo/demo-dist/`，验证后删除）
再 Run: `rm -rf demo/demo-dist && npx vitest run`
Expected: 全绿

- [ ] **Step 4: Commit**

```bash
git add demo/
git commit -m "feat: demo 演示页（mock 数据源 + 内存评论存储）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 16: 打包验证 + README 使用文档

**Files:**
- Create: `README.md`
- Verify: `npm pack --dry-run` 文件清单

**Interfaces:**
- Consumes: 全部已产出公开 API
- Produces: 可发布包（`npm publish` 前的最终检查单）

- [ ] **Step 1: 全量验证**

Run: `npm run build && npm test && npm pack --dry-run`
Expected: `dist/index.js`、`dist/index.cjs`、`dist/index.d.ts`、`dist/style.css`、`README.md`、`package.json` 出现在包清单；无 `src/`、`demo/`、`node_modules`

- [ ] **Step 2: 写 `README.md`**

````markdown
# trajectory-viewer

聊天式轨迹查看 React 组件：消息流（无限滚动分页）+ 划线评论/评论区面板 + 交付物文件抽屉 + 可插拔原数据视图。零 UI 框架依赖（不绑定 antd/Monaco），CSS 变量皮肤，支持暗色。

## 安装

```bash
npm i trajectory-viewer react react-dom   # react ^18 || ^19 为 peer
```

```tsx
import { TrajectoryViewer } from "trajectory-viewer";
import "trajectory-viewer/style.css";
```

## 最小接入

组件不内置任何后端协议——注入两个适配器即可工作（寻址封装在适配器闭包内）：

```tsx
import { useMemo } from "react";
import { TrajectoryViewer } from "trajectory-viewer";
import type { TrajectoryDataSource, AnnotationStore } from "trajectory-viewer";
import "trajectory-viewer/style.css";

function RecordView({ item, line }: { item: string; line: number }) {
  // 换记录 = 传新对象：组件按 identity 变化自动重置重拉
  const dataSource = useMemo<TrajectoryDataSource>(() => ({
    fetchMessages: ({ from, limit }) =>
      fetch(`/api/messages?item=${item}&line=${line}&from=${from}&limit=${limit}`).then((r) => r.json()),
    fetchRaw: () =>
      fetch(`/api/raw?item=${item}&line=${line}`).then((r) => r.json()),
  }), [item, line]);

  const annotationStore = useMemo<AnnotationStore>(() => ({
    list: () => fetch(`/api/annotations?item=${item}&line=${line}`).then((r) => r.json()),
    create: ({ body, ...anchor }) =>
      fetch("/api/annotations", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...anchor, body }) }).then((r) => r.json()),
    reply: (annotationId, body, parentId) =>
      fetch("/api/replies", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annotation_id: annotationId, body, parent_id: parentId ?? null }) }),
    update: (id, body, kind) =>
      fetch(`/api/${kind === "annotation" ? "annotations" : "replies"}/${id}`,
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) }),
    delete: (id, kind) =>
      fetch(`/api/${kind === "annotation" ? "annotations" : "replies"}/${id}`, { method: "DELETE" }).then(() => {}),
    setResolved: (id, resolved) =>
      fetch(`/api/annotations/${id}/resolve`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved }) }),
    setLike: (targetId, kind, liked) =>
      fetch("/api/likes", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_id: targetId, target_type: kind, liked }) }).then((r) => r.json()),
  }), [item, line]);

  return (
    <TrajectoryViewer
      dataSource={dataSource}
      delivery={["./d/001/index.html"]}
      resolveDeliveryUrl={(p) => `/work/${item}/${p.replace(/^\.\//, "")}`}
      annotationStore={annotationStore}
      currentUser={{ name: "jackie", isAdmin: false }}
    />
  );
}
```

## Props 一览

| prop | 类型 | 说明 |
|---|---|---|
| `dataSource`（必填） | `TrajectoryDataSource` | `{ fetchMessages({from,limit}): Promise<MsgPage>; fetchRaw(): Promise<unknown> }`；identity 变化=换记录 |
| `delivery` | `string[]` | 交付物路径列表（底部入口卡 + 抽屉）；缺省无入口 |
| `resolveDeliveryUrl` | `(path) => string` | 文件点击打开链接；不传则文件行不可点 |
| `annotationStore` | `AnnotationStore` | 评论存储；**不传 = 评论功能整体关闭** |
| `currentUser` | `{ name: string; isAdmin?: boolean }` | 评论权限（编辑=作者，删除/解决=作者或 admin）；缺省评论区只读 |
| `renderRaw` | `(raw: unknown) => ReactNode` | 原数据渲染 slot（见下「Monaco 接入」）；默认内置 JSON 高亮 |
| `onNotify` | `(kind: "error"\|"warning"\|"info", text) => void` | 全局通知；不传用内置 toast |
| `toolbar` | `false` | 隐藏内置工具栏（配 ref 自建） |
| `className` | `string` | 追加到根元素 |

`ref`（`TrajectoryViewerHandle`）：`scrollToAnnotation(msgIdx, annoId): Promise<boolean>`——跨页自动续拉定位批注高亮。

## Monaco 接入（可选）

默认原数据视图为内置 JSON 高亮（无代码折叠）。需要 Monaco 时自装依赖并经 `renderRaw` 注入：

```bash
npm i @monaco-editor/react monaco-editor
```

```tsx
import Editor from "@monaco-editor/react";

// Vite：配置 worker（webpack/Rsbuild 请按其 monaco 插件文档）
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import editorWorker from "monaco-editor/editor/editor.worker.js?worker";
import jsonWorker from "monaco-editor/language/json/json.worker.js?worker";
self.MonacoEnvironment = { getWorker: (_id, label) => label === "json" ? new jsonWorker() : new editorWorker() };
loader.config({ monaco });

<TrajectoryViewer
  renderRaw={(raw) => (
    <Editor language="json" value={JSON.stringify(raw, null, 2)} height="100%"
            options={{ readOnly: true, minimap: { enabled: false }, automaticLayout: true }} />
  )}
  {...rest}
/>
```

零配置替代：删掉上面的 worker 代码与 `loader.config`，`@monaco-editor/react` 默认从 CDN 加载（牺牲离线可用）。raw 视图下组件的「全部展开/收起」按钮自动禁用——自定义渲染器的折叠命令由宿主自行暴露。

## 主题与换肤

默认浅色，跟随系统暗色；宿主可在任意祖先元素放 `data-theme="dark" | "light"` 手动强制（组件根元素上设置亦可）。换肤 = 覆写根元素 CSS 变量：

```css
.my-app .tv-root { --tv-accent: #d97706; --tv-accent-weak: rgba(217, 119, 6, 0.1); }
```

## 二级导出

`AnnotationPanel`、`DeliveryDrawer` 可单独导入摆布（props 见 `.d.ts`）；主组件 `<TrajectoryViewer>` 之外的所有公共类型（`Msg`、`MsgPage`、`Annotation`、`AnchorInput`、`TrajectoryDataSource`、`AnnotationStore` 等）均从包根导出。

## 本地开发

```bash
npm install
npm run dev     # demo 演示页（mock 数据源 + 内存评论存储）
npm test        # vitest
npm run build   # tsup → dist/
```
````

- [ ] **Step 3: 最终检查 + Commit**

Run: `npm run build && npm test && npx tsc --noEmit`
Expected: 全绿

```bash
git add -A
git commit -m "docs: README 使用文档（最小接入/Monaco/主题）与打包验证

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## 收尾检查单（全部任务完成后）

- [ ] `npm pack --dry-run` 仅含 `dist/` + `README.md` + `package.json`
- [ ] `grep -rn "from \"antd\"\|monaco-editor" src/` 无输出
- [ ] `grep -rn "style={{[^}]*color" src/components/` 无内联硬编码色值
- [ ] demo 页手动点验：翻页续拉、划线建楼、高亮定位、评论回复/点赞/解决/删除、交付物抽屉、JSON 视图、切换记录
