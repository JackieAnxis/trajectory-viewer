import type { ReactNode } from "react";

interface Line {
  indent: number;
  node: ReactNode;
}

// 颜色一律由 CSS 类承载（.tv-j* 映射到 --tv-json-* 变量），不在 JS 内保留色值
function Leaf({ v }: { v: unknown }): ReactNode {
  if (v === null) return <span className="tv-jl">null</span>;
  if (typeof v === "string") return <span className="tv-js">{JSON.stringify(v)}</span>;
  if (typeof v === "boolean") return <span className="tv-jb">{String(v)}</span>;
  if (typeof v === "number") return <span className="tv-jn">{String(v)}</span>;
  return <span>{String(v)}</span>;
}

function withComma(node: ReactNode, comma: boolean): ReactNode {
  return comma ? <>{node}<span className="tv-jp">,</span></> : node;
}

function flatten(v: unknown, depth: number, lines: Line[]): void {
  if (v === null || typeof v !== "object") {
    lines.push({ indent: depth, node: <Leaf v={v} /> });
    return;
  }
  if (Array.isArray(v)) {
    if (!v.length) {
      lines.push({ indent: depth, node: <span className="tv-jp">[]</span> });
      return;
    }
    lines.push({ indent: depth, node: <span className="tv-jp">[</span> });
    v.forEach((item, i) => {
      flatten(item, depth + 1, lines);
      if (i < v.length - 1) {
        const last = lines[lines.length - 1];
        lines[lines.length - 1] = { ...last, node: withComma(last.node, true) };
      }
    });
    lines.push({ indent: depth, node: <span className="tv-jp">]</span> });
    return;
  }
  const entries = Object.entries(v as Record<string, unknown>);
  if (!entries.length) {
    lines.push({ indent: depth, node: <span className="tv-jp">{"{}"}</span> });
    return;
  }
  lines.push({ indent: depth, node: <span className="tv-jp">{"{"}</span> });
  entries.forEach(([k, val], i) => {
    if (val === null || typeof val !== "object") {
      lines.push({
        indent: depth + 1,
        node: withComma(
          <>
            <span className="tv-jk">{JSON.stringify(k)}</span>
            <span className="tv-jp">: </span>
            <Leaf v={val} />
          </>,
          i < entries.length - 1,
        ),
      });
    } else {
      lines.push({
        indent: depth + 1,
        node: (
          <>
            <span className="tv-jk">{JSON.stringify(k)}</span>
            <span className="tv-jp">: </span>
          </>
        ),
      });
      flatten(val, depth + 1, lines);
      if (i < entries.length - 1) {
        const last = lines[lines.length - 1];
        lines[lines.length - 1] = { ...last, node: withComma(last.node, true) };
      }
    }
  });
  lines.push({ indent: depth, node: <span className="tv-jp">{"}"}</span> });
}

export default function JsonHighlight({ text }: { text: string }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return <pre>{text}</pre>;
  }
  if (parsed === null || typeof parsed !== "object") {
    return <pre>{text}</pre>;
  }
  const lines: Line[] = [];
  flatten(parsed, 0, lines);
  return (
    <pre className="tv-json-highlight">
      {lines.map((l, i) => (
        <div key={i} className="tv-json-hl-line" style={{ paddingLeft: l.indent * 14 }}>
          {l.node}
        </div>
      ))}
    </pre>
  );
}
