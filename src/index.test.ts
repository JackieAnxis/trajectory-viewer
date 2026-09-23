/** 包出口守卫（Task 13 评审 Major-4）：
 *  Task 16 的 README 二级导出清单直接以 src/index.ts 为准，而删掉值导出后
 *  全量测试与 tsc 都不会有任何反应（评审变异 M2 实证），故在此显式钉住值导出集合。
 *  类型导出由 tsc 守一部分（下文 typeof import 的引用会在类型缺失时编译失败）。 */
import { expect, test } from "vitest";
import * as pkg from "./index";
import type {
  AnchorInput, Annotation, AnnotationPanelProps, AnnotationRegion, AnnotationReply,
  AnnotationStore, DeliveryDrawerProps, LikeResult, Msg, MsgPage, NotifyKind, ToolCall,
  TrajectoryDataSource, TrajectoryViewerHandle, TrajectoryViewerProps,
} from "./index";

/** 类型存在性守卫：类型导出缺失时本文件无法通过 tsc（这些别名必须可解析） */
type ExportedTypes = [
  AnchorInput, Annotation, AnnotationPanelProps, AnnotationRegion, AnnotationReply,
  AnnotationStore, DeliveryDrawerProps, LikeResult, Msg, MsgPage, NotifyKind, ToolCall,
  TrajectoryDataSource, TrajectoryViewerHandle, TrajectoryViewerProps,
];

test("包出口：值导出恰为三个组件（多一个或少一个都红）", () => {
  expect(Object.keys(pkg).sort()).toEqual(["AnnotationPanel", "DeliveryDrawer", "TrajectoryViewer"]);
});

test("包出口：三个值导出都是可渲染的组件", () => {
  expect(typeof pkg.TrajectoryViewer).toBe("object");   // forwardRef 组件是对象
  expect(typeof pkg.AnnotationPanel).toBe("function");
  expect(typeof pkg.DeliveryDrawer).toBe("function");
  expect((pkg.TrajectoryViewer as { render?: unknown }).render).toBeTypeOf("function");
});

// 类型守卫：仅编译期有意义，运行时断言恒真，用于避免 ExportedTypes 被 lint 判为未使用
test("包出口：类型导出清单可解析（编译期守卫）", () => {
  const _types: ExportedTypes | null = null;
  expect(_types).toBeNull();
});
