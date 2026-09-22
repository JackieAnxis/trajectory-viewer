/**
 * 批注锚点纯逻辑(spec §3):选区 → 五元组提取;TreeWalker 纯文本重锚定 + <mark> 包裹。
 *
 * 设计要点:
 * - 锚定对象是「渲染后 DOM 的纯文本」(TreeWalker SHOW_TEXT 拼接),与 Markdown/代码高亮
 *   的内部标签结构解耦;quote/prefix/suffix 全部取自同一拼接文本,提取与重锚定天然对称。
 * - mark 包裹不增删文本,重锚定对已有高亮的区块幂等;clearMarks 负责复原。
 * - 同区块多楼按 start 降序包裹:后方的 splitText 不影响前方尚未处理的偏移。
 */
import type { AnchorInput } from "../types";

/** 区块纯文本 + 文本节点偏移映射 */
export interface TextMap {
  text: string;
  nodes: { node: Text; start: number }[];
}

/** TreeWalker 遍历区块文本节点,拼接纯文本并记录各节点起始偏移 */
export function textMap(block: HTMLElement): TextMap {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number }[] = [];
  let text = "";
  let n = walker.nextNode();
  while (n) {
    const t = n as Text;
    nodes.push({ node: t, start: text.length });
    text += t.data;
    n = walker.nextNode();
  }
  return { text, nodes };
}

/** 向上找最近的定位区块(MessageStream 六类区块标 data-msg-idx + data-region[/data-sub]) */
function closestBlock(n: Node): HTMLElement | null {
  const el = n.nodeType === Node.ELEMENT_NODE
    ? (n as HTMLElement)
    : n.parentElement;
  return el?.closest<HTMLElement>("[data-msg-idx][data-region]") ?? null;
}

/** Range 边界(container,offset) → 区块纯文本偏移;元素边界取其第 offset 子节点处 */
function offsetOf(map: TextMap, container: Node, offset: number): number {
  if (container.nodeType === Node.TEXT_NODE) {
    const hit = map.nodes.find((x) => x.node === container);
    return hit ? hit.start + offset : -1;
  }
  const kids = container.childNodes;
  if (offset >= kids.length) {
    // 元素末尾:其内部最后一个文本节点的终点
    const inside = map.nodes.filter((x) => container.contains(x.node));
    const last = inside[inside.length - 1];
    return last ? last.start + last.node.data.length : -1;
  }
  const probe = kids[offset];
  const hit = map.nodes.find((x) => probe === x.node || probe.contains(x.node));
  return hit ? hit.start : -1;
}

/** 选区 → 锚点五元组;跨区块/不在区块内/塌陷 → null(不支持跨区块划线,v1) */
export function selectionToAnchor(
  sel: Selection,
): (AnchorInput & { block: HTMLElement }) | null {
  if (sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const sb = closestBlock(range.startContainer);
  const eb = closestBlock(range.endContainer);
  if (!sb || sb !== eb) return null;
  const map = textMap(sb);
  const start = offsetOf(map, range.startContainer, range.startOffset);
  const end = offsetOf(map, range.endContainer, range.endOffset);
  if (start < 0 || end <= start) return null;
  return {
    block: sb,
    msg_idx: Number(sb.dataset.msgIdx),
    region: sb.dataset.region as AnchorInput["region"],
    sub: sb.dataset.sub === undefined ? null : Number(sb.dataset.sub),
    quote: map.text.slice(start, end),
    prefix: map.text.slice(Math.max(0, start - 32), start),   // 语境各截 32(spec §3)
    suffix: map.text.slice(end, end + 32),
  };
}

/** 按五元组定位区块的 CSS 选择器(高亮 effect 与测试共用) */
export function blockSelector(a: AnchorInput): string {
  let s = `[data-msg-idx="${a.msg_idx}"][data-region="${a.region}"]`;
  if (a.sub != null) s += `[data-sub="${a.sub}"]`;
  return s;
}

/**
 * 重锚定:区块纯文本搜 quote;多处命中按 prefix/suffix 语境一致度取最高分(并列取首个);
 * 找不到返回 null(原文已变更失效态,spec §7)。
 */
export function reanchor(
  block: HTMLElement, a: AnchorInput,
): { start: number; end: number } | null {
  const { text } = textMap(block);
  if (!a.quote) return null;
  const hits: number[] = [];
  let i = text.indexOf(a.quote);
  while (i >= 0) {
    hits.push(i);
    i = text.indexOf(a.quote, i + 1);
  }
  if (hits.length === 0) return null;
  if (hits.length === 1) return { start: hits[0], end: hits[0] + a.quote.length };
  let best = -1;
  let bestScore = -1;
  for (const h of hits) {
    // 前缀从后往前逐字比对(贴邻的语境权重最高),后缀从前往后;失配即止
    let score = 0;
    for (let k = 0; k < a.prefix.length; k++) {
      if (text[h - 1 - k] === a.prefix[a.prefix.length - 1 - k]) score++;
      else break;
    }
    for (let k = 0; k < a.suffix.length; k++) {
      if (text[h + a.quote.length + k] === a.suffix[k]) score++;
      else break;
    }
    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return { start: best, end: best + a.quote.length };
}

/** 单个文本节点整体包一层 <mark class="tv-anno-mark" data-anno-id>(边界分片用) */
function wrapSingle(node: Text, id: number): void {
  const mark = document.createElement("mark");
  mark.className = "tv-anno-mark";
  mark.dataset.annoId = String(id);
  node.parentNode!.replaceChild(mark, node);
  mark.appendChild(node);
}

/**
 * 把纯文本区间 [start,end) 包成 tv-anno-mark(可跨文本节点/元素)。
 * 分段规则:被切开的边界分片各包一层;中间完整内容把 Range 边界外提到 block
 * 子级后 surroundContents 一次包——跨元素选区因此得到「边界碎片 + 整段」结构
 * (如 好|<b>世界</b>尾 → mark「好」+ mark「<b>世界</b>尾」两段)。
 * 嵌套内联元素导致整段包不可行(半选非 Text 节点)时,中段退化为逐文本节点包,
 * 分段变多但文本序列不变、高亮完整(不抛错、不留半包裹)。
 */
function wrapRange(
  block: HTMLElement, map: TextMap, start: number, end: number, id: number,
): void {
  const segs = map.nodes.filter(({ node, start: ns }) => {
    const ne = ns + node.data.length;
    return ne > start && ns < end;                       // 与区间相交
  });
  if (segs.length === 0) return;
  // 先切尾再切头(splitText 只切节点不改文本序列,其余节点偏移不受影响)
  const last = segs[segs.length - 1];
  const tailPartial = last.start + last.node.data.length > end;
  if (tailPartial) last.node.splitText(end - last.start);
  const first = segs[0];
  const headPartial = first.start < start;
  const head = headPartial ? first.node.splitText(start - first.start) : first.node;
  if (segs.length === 1) {                               // 单节点:切齐后整片包
    wrapSingle(head, id);
    return;
  }
  // 区间内文本节点 = 头片 + 中间原节点 + 尾片
  const inRange: Text[] = [head, ...segs.slice(1, -1).map((s) => s.node), last.node];
  let lo = 0;
  let hi = inRange.length - 1;
  if (headPartial) { wrapSingle(inRange[lo], id); lo++; }    // 头部分片单独包
  if (tailPartial) { wrapSingle(inRange[hi], id); hi--; }    // 尾部分片单独包
  if (lo > hi) return;
  // 中间整段:边界外提(起点在元素开头/终点在元素末尾则上提一级,避免半选元素)
  const range = document.createRange();
  range.setStartBefore(inRange[lo]);
  range.setEndAfter(inRange[hi]);
  while (range.startContainer !== block && range.startOffset === 0) {
    range.setStartBefore(range.startContainer);
  }
  while (range.endContainer !== block &&
         range.endOffset === range.endContainer.childNodes.length) {
    range.setEndAfter(range.endContainer);
  }
  const mark = document.createElement("mark");
  mark.className = "tv-anno-mark";
  mark.dataset.annoId = String(id);
  try {
    range.surroundContents(mark);
  } catch {
    // 嵌套内联元素仍可能半选非 Text 节点(外提只覆盖边界对齐元素口的情形,
    // 边界落在元素内索引>0 处且另一端越出该元素时无解)——surroundContents 的
    // 半选校验先于任何 DOM 变更,抛错时区间内容原样;逐文本节点回退,保证
    // 异常路径也产出完整高亮(已包的边界碎片不受影响),绝不留半包裹状态。
    for (let k = lo; k <= hi; k++) wrapSingle(inRange[k], id);
  }
}

/**
 * 同区块多楼统一包裹:按 start 降序,后方切分不影响前方偏移。
 * 前提:区块当前无 tv-anno-mark(非幂等,二次调用会产出嵌套 mark)——
 * 调用方(MessageStream 高亮 effect)须先 clearMarks 再批量包裹。
 */
export function applyMarks(
  block: HTMLElement, hits: { id: number; start: number; end: number }[],
): void {
  const sorted = [...hits].sort((x, y) => y.start - x.start);
  for (const h of sorted) {
    wrapRange(block, textMap(block), h.start, h.end, h.id);  // 每次重取映射(前次包裹已切分节点)
  }
}

/** 清掉 root 内全部 tv-anno-mark 并合并相邻文本节点(复原切分) */
export function clearMarks(root: HTMLElement): void {
  for (const m of [...root.querySelectorAll("mark.tv-anno-mark")]) {
    const parent = m.parentNode!;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  }
}

/** 选区与既有高亮相交检测(spec §6.2:不支持重叠划线) */
export function overlapsMark(sel: Selection): boolean {
  if (sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  const block = closestBlock(range.startContainer);
  if (!block) return false;
  return [...block.querySelectorAll("mark.tv-anno-mark")]
    .some((m) => range.intersectsNode(m));
}
