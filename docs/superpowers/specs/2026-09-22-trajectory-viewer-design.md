# Trajectory Viewer 独立组件包设计

日期：2026-09-22
状态：已评审（brainstorming 六节逐节确认）

## 1. 背景与目标

将 `trajectory-data-reviewer/frontend/src/components/MessageStream.tsx` 及其依赖链抽取为独立发布的 React 组件包（仓库 `trajectory-viewer`，包名暂定 `trajectory-viewer`），面向未来的接入开发者，包含：

- 聊天式轨迹消息流（用户气泡 / 系统提示卡 / 思考过程卡 / 工具调用配对卡，无限滚动分页）；
- **评论功能**：划线建楼 + 高亮渲染 + 评论区面板（回复、点赞、解决、编辑、删除）；
- **查看交付物功能**：底部入口卡 + 右侧文件抽屉；
- 原数据（raw JSON）视图，渲染器可插拔。

设计三标准：接入学习门槛低、可维护性好、可适配性强。

## 2. 已确认的关键决策

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 数据获取 | **注入数据源适配器**（方案 A）：组件定义 `dataSource` 接口，宿主注入实现；内部按「纯渲染核心 + 状态 hook」分层，未来可无损暴露受控核心（方案 C 的门保持敞开，v1 不暴露） |
| 2 | 评论范围 | 划线评注 + 高亮 + **评论区面板**（AnnotationPanel）全部进包 |
| 3 | raw 视图 | **可插拔 slot**：`renderRaw` prop，默认内置 `JsonHighlight` 渲染；Monaco 由接入方自装，文档给 Vite / CDN 两份 snippet |
| 4 | antd | **完全去除**：7 种小件全部自绘或 CSS 化，包零 UI 框架依赖，自带中性皮肤 |
| 5 | 样式主题 | 颜色全部 CSS 变量化（`.tv-root` 作用域），默认浅色，支持 `prefers-color-scheme` 暗色 + `data-theme` 手动强制 |

## 3. 包定位与构建形态

### 3.1 仓库布局

```
trajectory-viewer/
├── package.json          # name/version/exports/peerDeps
├── tsup.config.ts
├── tsconfig.json
├── src/
│   ├── index.ts          # 公开出口：组件 + 类型
│   ├── components/       # TrajectoryViewer、MessageStreamView、AnnotationPanel、DeliveryDrawer…
│   ├── core/             # chatModel、annotationAnchor、deliveryTree 纯逻辑
│   ├── data/             # useMessageStreamData / useRawData / useAnnotations 状态 hook
│   ├── styles.css        # 全部样式（CSS 变量，tv- 前缀类名）
│   └── types.ts
├── demo/                 # Vite 演示页（mock 数据源，手测场 + 最小接入示例出处）
```

测试文件沿用源项目惯例：与源码同目录就近放置（`components/MessageStreamView.test.tsx` 等）。

### 3.2 构建与分发

- 构建工具 **tsup**（对比 Vite lib mode：对纯 React 库配置更直接，一条配置出 ESM + CJS + d.ts，CSS 抽独立文件）；Vite 仅用于 `demo/` 与 vitest，不进库构建链。
- 产物：`dist/index.js`(ESM) + `index.cjs` + `index.d.ts` + `style.css`。
- `package.json` `exports` 暴露 `"."` 与 `"./style.css"`。
- `peerDependencies`：`react` / `react-dom`（^18 || ^19）。
- `dependencies`：`react-markdown`、`remark-gfm`、`rehype-highlight`、`@fortawesome/*`（具体图标按需引用，可 tree-shake，体积小）。

## 4. 公开 API

### 4.1 主组件

```tsx
interface TrajectoryViewerProps {
  /** 数据源适配器（必传）；对象 identity 变化 = 换记录，组件自动重置重拉 */
  dataSource: TrajectoryDataSource;
  /** 交付物路径列表（底部入口卡 + 抽屉） */
  delivery?: string[];
  /** 文件点击打开链接；不传则文件行不可点 */
  resolveDeliveryUrl?: (path: string) => string;
  /** 评论存储适配器；不传 = 评论功能整体关闭（划线/面板入口不出现） */
  annotationStore?: AnnotationStore;
  /** 当前用户（评论编辑/删除/解决权限判定） */
  currentUser?: { name: string; isAdmin?: boolean };
  /** 原数据渲染 slot；不传用内置 JsonHighlight */
  renderRaw?: (raw: unknown) => ReactNode;
  /** 全局通知（替代 antd message）；不传用内置 toast 兜底 */
  onNotify?: (kind: "error" | "warning" | "info", text: string) => void;
  /** false = 隐藏内置工具栏（配 ref 自建 chrome） */
  toolbar?: false;
  className?: string;
}
```

- `item`/`line` 等寻址参数**不出现在 props**：寻址封装在宿主适配器闭包内（`createDataSource(item, line)`），组件只认 `dataSource` 对象。
- `ref` 收窄为只暴露 `scrollToAnnotation(msgIdx: number, annoId: number): Promise<boolean>`（面板内部用，同时供宿主）；`toggleAllCards` 由内置工具栏消化，不暴露。
- 内置工具栏：视图切换（轨迹 / JSON）+ 全部展开收起 + 评论区开关（未解决数徽标）+ 交付物开关；两个面板开合互斥内化；点高亮自动开评论区并定位闪烁。
- 二级导出：`AnnotationPanel`、`DeliveryDrawer` 单独导出，供想拆开摆布的宿主使用（文档从简）。

### 4.2 数据源适配器

```ts
interface TrajectoryDataSource {
  /** 分页拉消息 */
  fetchMessages(query: { from: number; limit: number }): Promise<MsgPage>;
  /** 拉原数据（进入 raw 视图时懒调用） */
  fetchRaw(): Promise<unknown>;
}

interface MsgPage {
  messages: Msg[];
  from: number;
  returned: number;
  has_more: boolean;
}
```

### 4.3 评论存储适配器

```ts
interface AnnotationStore {
  list(): Promise<Annotation[]>;
  create(input: AnchorInput & { body: string }): Promise<unknown>;
  reply(annotationId: number, body: string, parentId?: number | null): Promise<unknown>;
  update(id: number, body: string, kind: "annotation" | "reply"): Promise<unknown>;
  delete(id: number, kind: "annotation" | "reply"): Promise<void>;
  setResolved(id: number, resolved: boolean): Promise<unknown>;
  /** 唯一用响应做本地增量、不重拉的写操作 */
  setLike(targetId: number, kind: "annotation" | "reply", liked: boolean)
    : Promise<{ likeCount: number; likedByMe: boolean }>;
}
```

写操作（除 `setLike`）成功后组件自动重拉 `list`（沿用源项目「重拉替代增量合并」策略，规避聚合字段漂移）。

### 4.4 类型瘦身

- `Annotation` 去掉 `item_owner` / `item_name` / `line` 等后端寻址残留字段，只保留锚点五元组 + 楼数据（id、author、body、resolved、resolved_by、时间戳、like_count、liked_by_me、replies）。
- `Msg` 保留源项目全部字段（idx/role/preview/content_len/content/reasoning_len/reasoning_content/tool_calls/weight/tool_call_id）——列表场景可能用到 preview/计数，不瘦身；`MsgPage`、`AnchorInput`（msg_idx/region/sub/quote/prefix/suffix）、`AnnotationRegion` 照搬源项目定义。

## 5. 内部架构分层与数据流

### 5.1 三层结构

```
core/         纯逻辑，零 React 依赖，可单测
  ├─ chatModel.ts        groupMessages / looksLikeJson / callSummary / firstLine /
  │                      isFailedResult / stripUserMeta（照搬）
  ├─ annotationAnchor.ts textMap / selectionToAnchor / blockSelector / reanchor /
  │                      applyMarks / clearMarks / overlapsMark（照搬）
  └─ deliveryTree.ts     路径列表 → 目录树（照搬）

data/         状态层，三个独立 hook
  ├─ useMessageStreamData(dataSource)  分页状态机：首页加载、哨兵续拉、
  │                                     loadReq 竞态令牌、错误重试（现有逻辑迁移）
  ├─ useRawData(dataSource, active)    raw 懒加载 + rawReq 令牌
  └─ useAnnotations(store)             评论列表拉取、写后重拉、点赞本地增量、失效楼 deadIds

components/   渲染层，全部受控（数据全部来自 props）
  ├─ TrajectoryViewer    组合层：工具栏 + 消息流 + 评论区面板 + 交付物抽屉，面板互斥/联动内化
  ├─ MessageStreamView   NodeView / ToolPairView / 卡片（纯渲染核心，未来可单独导出）
  └─ AnnotationPanel / DeliveryDrawer / DeliveryCards / AnnotatePopover /
     Markdown / JsonHighlight / 自绘小件
```

### 5.2 关键数据流

1. `dataSource` identity 变化 → 全部状态（msgs/raw/annotations/pending 浮层）重置 → 拉首页（300 条/页）；
2. 哨兵进视口（rootMargin 200px）→ `loadMore` 追加；过期响应按 `loadReq` 令牌丢弃；jsdom 无 `IntersectionObserver` 时静默跳过；
3. 划线 mouseup → `selectionToAnchor`（跨区块/塌陷不打扰；与既有高亮相交提示）→ 浮层 → `store.create` → 重拉 `list` → 高亮 effect 全量清 + 按区块分组重锚定包 `mark`；区块在但 quote 找不到 → 失效楼（面板置灰）；区块未加载 → 跳过；
4. 点高亮 → 组件内开评论区 + 卡片闪烁（1.6s `anno-flash`）；面板引用块点击 → `scrollToAnnotation`（目标消息未加载则连续续拉至覆盖，200 页上限 → 定位 → 闪烁）；
5. 面板写操作（建楼/回复/编辑/删除/解决）→ store → 重拉；**点赞例外**：响应本地增量；
6. 交付物：`delivery` prop → 底部「全部文件」入口卡 → 抽屉文件树（顶层展开、子级折叠）→ 点击经 `resolveDeliveryUrl` 新标签打开；抽屉常驻 DOM + open class 宽度过渡；外点关闭（豁免入口卡与工具栏触发器）；两面板互斥。

### 5.3 raw 视图

- `mode` 为组件内部状态（工具栏切换），进入 raw 懒调用 `fetchRaw`，失败重进自动重试；
- `renderRaw` 在则用之，否则内置 `JsonHighlight` 渲染 `JSON.stringify(raw, null, 2)`；
- raw 下批量折叠命令对自定义渲染器返回 `null`（文档说明；后续可给 `renderRaw` 加命令注册参数，非破坏式扩展，v1 不做）；
- Monaco 接入由宿主完成，文档给两份 snippet：Vite（`?worker` 导入 + `loader.config({ monaco })`）与 CDN loader（零配置、牺牲离线可用）。

## 6. 样式系统

### 6.1 抽取范围

从源项目 `global.css`（1394 行）只带消息流相关规则：`chat-*`、`pair-*`、`anno-*`、`delivery-*`、`markdown`、`code-block`、`json-highlight`、`hljs` token 配色（现状已是手写 GitHub 亮色、无白底副作用，直接变量化）。布局壳、登录、列表页等规则不带走。

### 6.2 作用域与分发

- 所有类名加 `tv-` 前缀（`.tv-chat-stream`…），组件根元素统一 `.tv-root`，与宿主样式零冲突；
- `data-msg-idx` / `data-region` / `data-sub` 锚点属性不变（划线功能依赖）；
- 样式不做 JS 注入，产物 `dist/style.css`，接入方显式 `import "trajectory-viewer/style.css"`（SSR 友好，宿主可完全自换皮肤）。

### 6.3 CSS 变量与暗色

```css
.tv-root {
  --tv-bg: …; --tv-text: …; --tv-text-dim: …; --tv-border: …;
  --tv-accent: …; --tv-danger: …; --tv-mark-bg: …; --tv-code-bg: …;
  --tv-hljs-keyword: …; /* hljs token 一组 */
  /* 浅色为默认值 */
}
@media (prefers-color-scheme: dark) {
  .tv-root:not([data-theme="light"]) { /* 暗色一组 */ }
}
.tv-root[data-theme="dark"] { /* 暗色一组，手动强制优先级最高 */ }
```

- 宿主换肤 = 覆写 `.tv-root` 变量（文档给品牌色示例）；
- `JsonHighlight` 内联硬编码颜色（`C` 对象）改为 CSS 类 + 变量；
- 面板/抽屉/浮层 z-index 收敛到 `.tv-root` 内 stacking context。

## 7. 去 antd 替代清单与错误处理

### 7.1 替代清单

原则：交互极简、无定位依赖的先 CSS 化；有状态的做最小自绘。

| antd | 替代 | 说明 |
|---|---|---|
| `Tooltip` | CSS-only tooltip | 现有用法全是纯文本 title → `data-tip` + `::after`，零 JS、无定位计算 |
| `message` | `onNotify` prop + 内置 toast 兜底 | 传了走宿主通知体系；不传则组件内顶部浮条自动消失 |
| `Button` / `Typography` | 原生元素 + `tv-` 类 | 仅错误条、「点击重试」两处 |
| `Avatar` | 自绘圆形首字母 | `avatarColor.ts` 名字哈希配色照搬 |
| `Popconfirm` | 行内二次确认 | 删除按钮点击变「确认删除？」态（2 秒超时复原），再点执行 |
| `Segmented` | 自绘 `tv-segmented` | 评论区「全部 / 我的」页签，按钮组 + 滑块 |
| `Badge` | 自绘 `tv-badge` | 工具栏评论区入口未解决数圆点 |

工作量集中在 `AnnotationPanel`（407 行，五处依赖）：结构、交互、样式照搬，只换小件。其余组件零星替换。

### 7.2 错误处理

- 消息首页失败 → 流内错误条 + 「点击重试」；
- 续拉失败 → 通知（toast / onNotify），哨兵再次进视口自动重试；
- raw 失败 → 面板内提示，重新进入 raw 自动重试；
- 评论 `list` 失败 → 面板内错误条 + 重试按钮；
- 评论写操作失败 → 通知 + 草稿 / 编辑态停留可改稿重发；
- 适配器抛错统一捕获，文案为 `中文前缀 + error.message`。

## 8. 测试策略

vitest + jsdom + Testing Library（沿用源项目基建与密度，每组件一个 `*.test.tsx`）。

1. **纯逻辑（core/）**：`chatModel`、`annotationAnchor`、`deliveryTree` 测试几乎零改动搬迁——包内最有价值的回归资产；
2. **组件测试**：`vi.mock("../api")` 拦截改为直接传内存版 `dataSource` / `annotationStore`（可控 promise、可断言参数）；antd `message` 断言改为断言 `onNotify` 参数或 toast DOM；`AnnotationPanel` 测试随自绘小件重写（antd 类名断言 → `tv-` 类名 / role）；
3. **新增测试**：`renderRaw` slot（默认渲染 / 自定义接管 / raw 下批量折叠返回 null）；`dataSource` identity 变化重置重拉；`annotationStore` 缺省时划线与面板入口不出现；
4. **手测场**：`demo/` Vite 页内置 mock 数据源（假轨迹 + 内存评论存储），`npm run dev` 全功能点验，同时是文档「最小接入示例」出处；
5. CI 可选：接 GitHub Actions 时一条 `vitest run` 即可。

## 9. 范围外（YAGNI，本版不做）

- 纯受控核心组件的公开导出（内部分层预留，未来非破坏式扩展）；
- Monaco 打包进库 / 其 worker 构建配置；
- `renderRaw` 的折叠命令注册参数；
- Storybook（demo/ 页先承担）；
- 源项目（trajectory-data-reviewer）回迁适配——包稳定后另行评估，可写一个薄适配器把现有 `api.ts` 包成 `TrajectoryDataSource` / `AnnotationStore`。
