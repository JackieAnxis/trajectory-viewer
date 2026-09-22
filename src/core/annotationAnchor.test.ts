/** 锚点纯逻辑测试(spec §3):选区提取/重锚定消歧/mark 包裹与复原/重叠检测。 */
import { afterEach, expect, test } from "vitest";
import {
  applyMarks, blockSelector, clearMarks, overlapsMark, reanchor, selectionToAnchor,
  textMap,
} from "./annotationAnchor";

/** 构造带定位属性的区块:<div data-msg-idx data-region [data-sub]>innerHTML</div> */
function mkBlock(html: string, msgIdx = 2, region = "content", sub?: number): HTMLElement {
  const div = document.createElement("div");
  div.dataset.msgIdx = String(msgIdx);
  div.dataset.region = region;
  if (sub !== undefined) div.dataset.sub = String(sub);
  div.innerHTML = html;
  document.body.appendChild(div);
  return div;
}

function selectIn(block: HTMLElement, startNodeIdx: [number, number], end: [number, number]) {
  // 简化:测试区块文本节点按 TreeWalker 序编号;[n, off] = 第 n 个文本节点的 off 偏移
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let n = walker.nextNode();
  while (n) { nodes.push(n as Text); n = walker.nextNode(); }
  const range = document.createRange();
  range.setStart(nodes[startNodeIdx[0]], startNodeIdx[1]);
  range.setEnd(nodes[end[0]], end[1]);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  return sel;
}

afterEach(() => { document.body.innerHTML = ""; window.getSelection()?.removeAllRanges(); });

test("textMap 拼接纯文本并记录节点偏移", () => {
  const b = mkBlock("你好<b>世界</b>尾");
  const m = textMap(b);
  expect(m.text).toBe("你好世界尾");
  expect(m.nodes.map((x) => x.start)).toEqual([0, 2, 4]);
});

test("selectionToAnchor:单节点选区提取五元组与语境", () => {
  const b = mkBlock("abcdefgh");
  const sel = selectIn(b, [0, 2], [0, 5]);
  const a = selectionToAnchor(sel)!;
  expect(a).not.toBeNull();
  expect(a.msg_idx).toBe(2);
  expect(a.region).toBe("content");
  expect(a.sub).toBeNull();
  expect(a.quote).toBe("cde");
  expect(a.prefix).toBe("ab");
  expect(a.suffix).toBe("fgh");
});

test("selectionToAnchor:跨文本节点选区(含 <b> 标签)", () => {
  const b = mkBlock("你好<b>世界</b>尾", 7, "reasoning");
  const sel = selectIn(b, [0, 1], [2, 1]);     // 「好世界尾」
  const a = selectionToAnchor(sel)!;
  expect(a.quote).toBe("好世界尾");
  expect(a.msg_idx).toBe(7);
  expect(a.region).toBe("reasoning");
});

test("selectionToAnchor:args 区块带 sub;跨区块与塌陷选区返回 null", () => {
  const b = mkBlock("参数文本", 3, "args", 1);
  const sel = selectIn(b, [0, 0], [0, 2]);
  const a = selectionToAnchor(sel)!;
  expect(a.sub).toBe(1);
  const c = mkBlock("另一区块");
  const range = document.createRange();
  range.setStart(b.firstChild!, 0);
  range.setEnd(c.firstChild!, 1);
  const cross = window.getSelection()!;
  cross.removeAllRanges();
  cross.addRange(range);
  expect(selectionToAnchor(cross)).toBeNull();  // 跨区块不支持(v1)
  cross.collapseToStart();
  expect(selectionToAnchor(cross)).toBeNull();  // 塌陷
});

test("reanchor:唯一命中与失效", () => {
  const b = mkBlock("前文目标文本后文");
  const hit = reanchor(b, { msg_idx: 2, region: "content", sub: null,
                            quote: "目标文本", prefix: "前文", suffix: "后文" });
  expect(hit).toEqual({ start: 2, end: 6 });
  expect(reanchor(b, { msg_idx: 2, region: "content", sub: null,
                       quote: "不存在", prefix: "", suffix: "" })).toBeNull();
});

test("reanchor:重复 quote 按 prefix/suffix 匹配度消歧", () => {
  const b = mkBlock("苹果重复香蕉重复橘子");
  // quote「重复」命中两处;prefix「苹果」指向第一处
  const hit = reanchor(b, { msg_idx: 2, region: "content", sub: null,
                            quote: "重复", prefix: "苹果", suffix: "香蕉" });
  expect(hit).toEqual({ start: 2, end: 4 });
  const hit2 = reanchor(b, { msg_idx: 2, region: "content", sub: null,
                             quote: "重复", prefix: "香蕉", suffix: "橘子" });
  expect(hit2).toEqual({ start: 6, end: 8 });
});

test("applyMarks 跨节点包裹 + clearMarks 复原", () => {
  const b = mkBlock("你好<b>世界</b>尾");
  applyMarks(b, [{ id: 11, start: 1, end: 5 }]);           // 「好世界尾」
  const marks = b.querySelectorAll("mark.tv-anno-mark");
  expect(marks.length).toBe(2);                            // 跨 <b> 边界 → 两段
  expect(marks[0].textContent).toBe("好");
  expect(marks[1].textContent).toBe("世界尾");
  expect(b.textContent).toBe("你好世界尾");                // 文本不变
  expect(marks[0].getAttribute("data-anno-id")).toBe("11");
  clearMarks(b);
  expect(b.querySelectorAll("mark").length).toBe(0);
  expect(b.textContent).toBe("你好世界尾");
});

test("applyMarks 同区块多楼按 start 降序包裹互不错位", () => {
  const b = mkBlock("abcdefgh");
  applyMarks(b, [{ id: 1, start: 0, end: 2 }, { id: 2, start: 4, end: 6 }]);
  const marks = b.querySelectorAll("mark.tv-anno-mark");
  expect(marks.length).toBe(2);
  expect(marks[0].textContent).toBe("ab");
  expect(marks[1].textContent).toBe("ef");
  expect(b.textContent).toBe("abcdefgh");
});

test("overlapsMark:选区与既有高亮相交检测", () => {
  const b = mkBlock("abcdefgh");
  applyMarks(b, [{ id: 1, start: 2, end: 4 }]);           // 「cd」已划
  const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let n = walker.nextNode();
  while (n) { nodes.push(n as Text); n = walker.nextNode(); }
  // 与 mark 相交:「bc」(含 c 在 mark 内)
  const range = document.createRange();
  range.setStart(nodes[0], 1);
  range.setEnd(nodes[1], 1);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  expect(overlapsMark(sel)).toBe(true);
  // 不相交:「gh」
  const range2 = document.createRange();
  range2.setStart(nodes[2], 2);
  range2.setEnd(nodes[2], 4);
  const sel2 = window.getSelection()!;
  sel2.removeAllRanges();
  sel2.addRange(range2);
  expect(overlapsMark(sel2)).toBe(false);
});

test("blockSelector:按五元组拼区块选择器", () => {
  expect(blockSelector({ msg_idx: 2, region: "content", sub: null,
                         quote: "", prefix: "", suffix: "" }))
    .toBe('[data-msg-idx="2"][data-region="content"]');
  expect(blockSelector({ msg_idx: 3, region: "args", sub: 1,
                         quote: "", prefix: "", suffix: "" }))
    .toBe('[data-msg-idx="3"][data-region="args"][data-sub="1"]');
});

test("applyMarks 嵌套内联元素:整段包半选 <b> 时不抛错、回退逐节点包", () => {
  // 回归(R1):起点在 <b> 内索引>0 处、终点越出 <b> → surroundContents 半选抛 InvalidStateError
  const b = mkBlock("<b><i>X</i>AB</b>C");
  expect(() => applyMarks(b, [{ id: 5, start: 1, end: 4 }])).not.toThrow();  // 「ABC」
  const marks = b.querySelectorAll("mark.tv-anno-mark");
  expect(marks.length).toBe(2);                            // 回退:中段逐文本节点
  expect(marks[0].textContent).toBe("AB");
  expect(marks[1].textContent).toBe("C");
  expect(b.textContent).toBe("XABC");                      // 文本不变
});

test("applyMarks 嵌套内联元素:尾片已包后中段抛错不留半包裹状态", () => {
  // 回归(R1):尾片先被单独包成 mark,中段 surroundContents 再抛错 → 异常路径也须产出完整高亮
  const b = mkBlock("A<b><i>D</i>BC</b>");
  expect(() => applyMarks(b, [{ id: 6, start: 0, end: 3 }])).not.toThrow();  // 「ADB」
  const marks = b.querySelectorAll("mark.tv-anno-mark");
  expect(marks.length).toBe(3);                            // 头 A + 中段 D + 尾片 B
  expect([...marks].map((m) => m.textContent)).toEqual(["A", "D", "B"]);
  expect(b.textContent).toBe("ADBC");                      // 文本不变
  expect(marks[0].getAttribute("data-anno-id")).toBe("6");
});
