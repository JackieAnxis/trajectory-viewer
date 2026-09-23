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
