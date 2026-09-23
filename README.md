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
| `theme` | `"dark" \| "light"` | 手动强制主题；缺省跟随系统 `prefers-color-scheme`（落在根元素 `data-theme` 上） |

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

默认浅色，跟随系统暗色；宿主用 `theme="dark" | "light"` prop 手动强制（它落在组件根元素 `.tv-root` 的 `data-theme` 上；**设在祖先元素上无效**）。`AnnotationPanel` / `DeliveryDrawer` 单独使用时暗色自动跟随系统，但不支持手动强制。换肤 = 覆写根元素 CSS 变量：

```css
.my-app .tv-root { --tv-accent: #d97706; --tv-accent-weak: rgba(217, 119, 6, 0.1); }
```

## 二级导出

`AnnotationPanel`、`DeliveryDrawer` 可单独导入摆布（props 见 `.d.ts`）；`AnnotationPanel` 独立使用时可经 `notify` prop 收口失败通知，缺省走内置浮条。主组件 `<TrajectoryViewer>` 之外的所有公共类型（`Msg`、`MsgPage`、`Annotation`、`AnchorInput`、`TrajectoryDataSource`、`AnnotationStore` 等）均从包根导出。

## 本地开发

```bash
npm install
npm run dev     # demo 演示页（mock 数据源 + 内存评论存储）
npm test        # vitest
npm run build   # tsup → dist/
```
