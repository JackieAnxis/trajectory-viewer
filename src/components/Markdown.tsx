import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import WrapToggleButton from "./WrapToggleButton";

interface MarkdownProps {
  children: string;
}

/** 代码块容器：右上角悬浮图标按钮切换换行模式，默认自动换行，关闭后横向滚动 */
function CodeBlock({ children }: { children?: React.ReactNode }) {
  const [wrapped, setWrapped] = useState(true);
  return (
    <div className={wrapped ? "tv-code-block tv-code-wrap" : "tv-code-block tv-code-nowrap"}>
      <WrapToggleButton wrapped={wrapped} onToggle={() => setWrapped((w) => !w)} />
      <pre>{children}</pre>
    </div>
  );
}

/** 表格卡片头部：仅「表格」标题（复制按钮为无行为死控件，v1 删除——K-3） */
function TableCard({ children }: { children?: React.ReactNode }) {
  return (
    <div className="tv-chat-table-card">
      <div className="tv-chat-table-head">
        <span className="tv-chat-table-title">表格</span>
      </div>
      <div className="tv-chat-table-body">{children}</div>
    </div>
  );
}

/** 渲染纯文本为 Markdown（非 JSON 的 content / 推理 用此）；不渲染原始 HTML。 */
export default function Markdown({ children }: MarkdownProps) {
  return (
    <div className="tv-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // 代码块语法高亮：按围栏标注语言 tokenize（默认 common 语言集），未标注语言不处理
        rehypePlugins={[rehypeHighlight]}
        components={{
          // Kimi 式表格卡片：灰底圆角容器 + 顶部工具条 + 白底表格
          table: ({ node: _node, ...props }) => <TableCard><table {...props} /></TableCard>,
          // 代码块：默认自动换行，右上角可切换不换行（横向滚动）
          pre: ({ node: _node, ...props }) => <CodeBlock {...props} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
