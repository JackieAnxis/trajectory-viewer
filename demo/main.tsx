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
  // 暗色三态开关（G-2）：经 theme prop 强制 dark / light；回到缺省 = 跟随系统偏好
  const [theme, setTheme] = useState<"dark" | "light" | undefined>(undefined);
  // 按钮文案是「点击后切换到的下一态」：缺省→暗→浅→缺省 循环
  const nextTheme = () => setTheme((t) => (t === undefined ? "dark" : t === "dark" ? "light" : undefined));
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: 8, borderBottom: "1px solid #ddd", flexShrink: 0, display: "flex", gap: 8 }}>
        <button onClick={() => setRecord((r) => r + 1)}>切换记录（当前 #{record + 1}）</button>
        <button onClick={nextTheme}>
          {theme === "dark" ? "☀️ 浅色" : theme === "light" ? "💻 跟随系统" : "🌙 暗色"}
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <TrajectoryViewer
          dataSource={dataSource}
          delivery={MOCK_DELIVERY}
          resolveDeliveryUrl={(p) => `https://example.com/files/${encodeURIComponent(p)}`}
          annotationStore={store}
          currentUser={{ name: "demo", isAdmin: true }}
          theme={theme}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("app")!).render(<App />);
