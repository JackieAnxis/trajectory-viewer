import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import DeliveryDrawer from "./DeliveryDrawer";

// 本仓 vitest 未开 globals，RTL 的自动清理不会注册；显式注册避免用例间 DOM 累积
afterEach(cleanup);

// jsdom 无弹窗能力，stub window.open 验证新标签页跳转
const mockOpen = vi.fn();
vi.stubGlobal("open", mockOpen);

const FILES = [
  "./d/001/proj/index.html",
  "./d/001/proj/assets/app.js",
  "./d/001/tmp/x.js",
];

// resolveUrl 可选注入：不注入时文件行不可点（旧实现的写死后端前缀已由调用方注入取代）
function renderDrawer(open = true, onClose = vi.fn(), resolveUrl?: (p: string) => string) {
  return render(<DeliveryDrawer delivery={FILES} open={open} onClose={onClose} resolveDeliveryUrl={resolveUrl} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

test("open=false：抽屉收起（无 open 类、不可交互），open 切换后展开", () => {
  const { container, rerender } = renderDrawer(false);
  const drawer = container.querySelector(".tv-delivery-drawer")!;
  expect(drawer).not.toBeNull();
  expect(drawer.classList.contains("tv-delivery-drawer-open")).toBe(false);
  expect(drawer.getAttribute("aria-hidden")).toBe("true");
  // 切换 open 后带展开类
  rerender(<DeliveryDrawer delivery={FILES} open onClose={vi.fn()} />);
  expect(container.querySelector(".tv-delivery-drawer")!.classList.contains("tv-delivery-drawer-open")).toBe(true);
});

test("抽屉树：顶层目录可见、子级默认折叠、目录可展开、文件行预览新标签页", async () => {
  renderDrawer(true, vi.fn(), (p) => "/files/" + p);
  // 顶层目录行可见（公共前缀 ./d/001 已折叠）
  await waitFor(() => expect(screen.getByText("proj")).toBeInTheDocument());
  expect(screen.getByText("tmp")).toBeInTheDocument();
  expect(screen.getByText(/2 个文件/)).toBeInTheDocument();
  // 顶层展开：proj 的直接文件可见
  expect(screen.getByText("index.html")).toBeInTheDocument();
  // 子级默认折叠：assets 下 app.js 不可见
  expect(screen.queryByText("app.js")).toBeNull();

  // 展开 assets
  fireEvent.click(screen.getByText("assets"));
  await waitFor(() => expect(screen.getByText("app.js")).toBeInTheDocument());

  // 整行点击直接打开（无独立预览按钮）→ window.open 注入后的完整 URL
  expect(screen.queryByText("预览")).toBeNull();
  fireEvent.click(screen.getByText("app.js").closest(".tv-delivery-tree-row")!);
  expect(mockOpen).toHaveBeenCalledWith("/files/./d/001/proj/assets/app.js", "_blank");
});

test("目录/文件名 title 悬浮显示完整名（ellipsis 可全文查看）", async () => {
  renderDrawer();
  await waitFor(() => expect(screen.getByText("proj")).toBeInTheDocument());
  expect(screen.getByText("proj").closest(".tv-delivery-name")?.getAttribute("title")).toBe("proj");
  expect(screen.getByText("index.html").closest(".tv-delivery-name")?.getAttribute("title")).toBe("index.html");
});

test("点击抽屉外区域与关闭按钮均触发 onClose；抽屉内与触发卡片不误关", () => {
  const onClose = vi.fn();
  const { container } = render(
    <div>
      <button type="button" className="tv-delivery-card">全部文件</button>
      <DeliveryDrawer delivery={FILES} open onClose={onClose} />
    </div>,
  );

  // 点击触发卡片：不关闭（由卡片自身 toggle）
  fireEvent.pointerDown(container.querySelector(".tv-delivery-card")!);
  expect(onClose).not.toHaveBeenCalled();
  // 点击抽屉内部：不关闭
  fireEvent.pointerDown(screen.getByText("proj").closest(".tv-delivery-tree-row")!);
  expect(onClose).not.toHaveBeenCalled();
  // 点击抽屉外空白处：关闭
  fireEvent.pointerDown(container);
  expect(onClose).toHaveBeenCalledTimes(1);
  // ✕ 关闭按钮：关闭
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  expect(onClose).toHaveBeenCalledTimes(2);
});

test("单链目录合并显示为一段，点击展开", async () => {
  render(<DeliveryDrawer open delivery={[
    "./d/001/proj/a/shared/rules.js",
    "./d/001/proj/other/x.js",
  ]} onClose={vi.fn()} />);
  // 顶层 proj 默认展开；其子级 a 为单链目录（仅含 shared 子目录、无直接文件），合并显示为一段
  await waitFor(() => expect(screen.getByText("a/shared")).toBeInTheDocument());
  // 子级默认折叠：点击合并段展开后可见内部文件
  fireEvent.click(screen.getByText("a/shared"));
  await waitFor(() => expect(screen.getByText("rules.js")).toBeInTheDocument());
});

test("单文件交付物：抽屉渲染目录行（默认展开）+ 文件行，可点击预览", async () => {
  render(<DeliveryDrawer open delivery={["./d/001/proj/index.html"]} onClose={vi.fn()}
    resolveDeliveryUrl={(p) => "/files/" + p} />);
  // 顶层目录默认展开 → 文件行直接可见
  await waitFor(() => expect(screen.getByText("proj")).toBeInTheDocument());
  expect(screen.getByText("index.html")).toBeInTheDocument();
  // 文件行点击新标签页打开（URL 由注入的 resolveDeliveryUrl 决定）
  fireEvent.click(screen.getByText("index.html").closest(".tv-delivery-tree-row")!);
  expect(mockOpen).toHaveBeenCalledWith("/files/./d/001/proj/index.html", "_blank");
});

test("无 resolveDeliveryUrl 时文件行不可点（点击不打开新标签）", async () => {
  renderDrawer(true, vi.fn(), undefined);   // 不注入
  await waitFor(() => expect(screen.getByText("index.html")).toBeInTheDocument());
  fireEvent.click(screen.getByText("index.html").closest(".tv-delivery-tree-row")!);
  expect(mockOpen).not.toHaveBeenCalled();
});
