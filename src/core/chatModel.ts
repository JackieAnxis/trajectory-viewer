import type { Msg, ToolCall } from "../types";

/** 聊天视图渲染节点 */
export type ChatNode =
  | { kind: "system"; key: number; msg: Msg }
  | { kind: "user"; key: number; msg: Msg }
  /**
   * 一轮(turn)：一条 assistant 消息 + 其发起的工具调用/结果。
   * msg = 该轮 assistant 消息（有正文/推理）；仅工具调用的轮为 null（仍占一个机器人头像）。
   * 渲染为每轮一个机器人头像统领整轮，工具卡不再有独立头像（2026-09-16 轨迹呈现简化）。
   */
  | { kind: "turn"; key: number; msg: Msg | null; pairs: ToolPair[] };

/**
 * 工具调用配对单元：
 * - call：一次工具调用 + 配对到的结果（结果未到/无结果为 null），
 *   weight 继承发起调用的 assistant 消息（训练降权标记，无则为 null）；
 * - orphan：无调用可配的工具结果（孤立 tool 消息），无 weight。
 */
export type ToolPair =
  | { kind: "call"; name: string; args: string; result: string | null; weight: number | null;
      /** 锚点坐标(spec §3):发起调用的 assistant 消息 idx 与 tool_calls 下标;
          resultMsgIdx = 配对到的 tool 消息 idx(结果节定位用),未配对为 null */
      msgIdx: number; sub: number; resultMsgIdx: number | null }
  | { kind: "orphan"; result: string; weight: null;
      /** 孤立 tool 结果自身的消息 idx */ msgIdx: number };

/** 工具摘要截断长度 */
const SUMMARY_MAX = 80;

/** JSON 对象/数组判定（正文分流：高亮 or Markdown） */
export function looksLikeJson(text: string): boolean {
  try {
    const p = JSON.parse(text);
    return p !== null && typeof p === "object";
  } catch {
    return false;
  }
}

/** 取多行内容做单行摘要：合并换行为空格，超长截断加省略号 */
export function firstLine(text: string, max: number = SUMMARY_MAX): string {
  const line = text.trimStart().split(/\s*\n\s*/).filter(Boolean).join(" ");
  return line.length > max ? line.slice(0, max) + "…" : line;
}

/**
 * 调用摘要按工具参数提取关键信息：
 * - 有 command（exec/process 等）→ 命令本身；
 * - 有 path（write/edit/read 等）→ 路径末两段（截掉 /home/xxx/... 长前缀），
 *   read 类带 offset/limit 时附加班间信息；
 * - 有 url（browser 等）→ url；
 * - 都不是 / 非 JSON → 参数原文的 firstLine。
 */
export function callSummary(name: string, args: string): string {
  let parsed: Record<string, unknown> | null = null;
  try {
    const p: unknown = JSON.parse(args);
    if (p !== null && typeof p === "object" && !Array.isArray(p)) parsed = p as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  if (!parsed) return firstLine(args);
  if (typeof parsed.command === "string" && parsed.command) return firstLine(parsed.command);
  if (typeof parsed.path === "string" && parsed.path) {
    // 末两段足够定位文件（真实数据里是 /home/ma-user/.openclaw/workspace/<proj>/<file>）
    const tail = parsed.path.split("/").filter(Boolean).slice(-2).join("/");
    const offset = typeof parsed.offset === "number" ? ` · offset ${parsed.offset}` : "";
    const limit = typeof parsed.limit === "number" ? ` · ${parsed.limit} 行` : "";
    return tail + offset + limit;
  }
  if (typeof parsed.url === "string" && parsed.url) return firstLine(parsed.url);
  return firstLine(args);
}

/**
 * 工具结果失败判定（review 扫读时失败要出声）：
 * - JSON 结果 status === "error"（真实数据里 browser 错误即此形态）；
 * - 纯文本以 Error/error 或 Traceback 开头。
 */
export function isFailedResult(text: string): boolean {
  const t = text.trimStart();
  if (/^(error\b|traceback\b)/i.test(t)) return true;
  try {
    const p: unknown = JSON.parse(t);
    return p !== null && typeof p === "object" && (p as Record<string, unknown>).status === "error";
  } catch {
    return false;
  }
}

/**
 * 剥离 user 消息的 `Sender (untrusted metadata):` JSON 头与 `[时间戳 GMT+8] +` 前缀，
 * 只保留干净的问题文本；剥离后为空则回退原文（防御畸形数据）。
 */
export function stripUserMeta(content: string): string {
  const HEADER = "Sender (untrusted metadata):";
  if (!content.startsWith(HEADER)) return content;
  let s = content.slice(HEADER.length).replace(/^\s+/, "");
  if (s.startsWith("{")) {
    // 花括号配平找 JSON 头结束位置（容忍字符串内的花括号与转义）
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === '"') inStr = !inStr;
      if (inStr) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end >= 0) s = s.slice(end);
  }
  s = s.replace(/^\s*\[[^\]]*GMT\+8\]\s*\+?\s*/, "").trim();
  return s || content;
}

/** 轮节点类型（Extract 提取的简写，配对槽位里反复用到） */
type TurnNode = Extract<ChatNode, { kind: "turn" }>;

/** 配对槽位：指向某轮内的一个 pair */
interface Slot {
  node: TurnNode;
  index: number;
}

/** 配对状态：调用 id → 槽位（跨轮全局登记，结果可迟到甚至越过正文归队） */
interface Pairing {
  /** tool_call_id → 槽位（精确配对） */
  byId: Map<string, Slot>;
  /** 未配对槽位按调用先后排列（id 对不上时按顺序兜底） */
  unmatched: Slot[];
}

/** 取槽位上的 pair */
function pairAt(slot: Slot): ToolPair {
  return slot.node.pairs[slot.index];
}

/** assistant 的 tool_calls → 登记待配对调用，pair 先以 result=null 落卡 */
function registerCalls(node: TurnNode, m: Msg, pairing: Pairing): void {
  const calls = m.tool_calls;
  if (!calls?.length) return;
  // weight 仅存在于 assistant 消息（训练降权标记），数值型才透出，其余按无处理
  const weight = typeof m.weight === "number" ? m.weight : null;
  for (const [sub, tc] of calls.entries()) {
    const slot: Slot = { node, index: node.pairs.length };
    node.pairs.push({ kind: "call", name: tc.function?.name ?? "?",
                      args: tc.function?.arguments ?? "{}", result: null, weight,
                      msgIdx: m.idx, sub, resultMsgIdx: null });
    pairing.unmatched.push(slot);
    if (tc.id) pairing.byId.set(tc.id, slot);
  }
}

/** tool 结果 → 按 tool_call_id 精确配对，对不上按调用顺序兜底（跳过已配对的调用），再无则 orphan 归入最近一轮 */
function attachResult(nodes: ChatNode[], key: number, m: Msg, pairing: Pairing): void {
  let slot = m.tool_call_id ? pairing.byId.get(m.tool_call_id) : undefined;
  if (slot) {
    const p = pairAt(slot);
    // id 命中的调用已被配对（重复结果）也视为未命中，转入顺序兜底
    if (p.kind !== "call" || p.result !== null) slot = undefined;
  }
  while (!slot && pairing.unmatched.length) {
    const s = pairing.unmatched.shift()!;
    if (pairAt(s).kind === "call" && pairAt(s).result === null) slot = s;
  }
  if (slot) {
    const p = pairAt(slot);
    if (p.kind === "call") {
      p.result = m.content;
      p.resultMsgIdx = m.idx;   // 结果节锚点 = tool 消息自身 idx
      return;
    }
  }
  // orphan：归入最近一轮，没有则新开仅工具轮
  const last = nodes[nodes.length - 1];
  const node: TurnNode = last?.kind === "turn" ? last : { kind: "turn", key, msg: null, pairs: [] };
  if (node !== last) nodes.push(node);
  node.pairs.push({ kind: "orphan", result: m.content, weight: null, msgIdx: m.idx });
}

/**
 * 把 API 消息序列归并为聊天渲染节点（按 assistant 消息为轮界）：
 * - system / user 直通；
 * - 每条 assistant 消息（有正文/推理，或仅有 tool_calls）都开一个新轮（turn），
 *   仅工具调用的轮 msg 为 null；纯空占位跳过；
 * - assistant 的 tool_calls 与其后 tool 结果按 tool_call_id 配对（对不上按调用顺序兜底），
 *   一次调用 = 一个 pair；无调用可配的结果归为 orphan，归入最近一轮；
 * - 结果可越过正文归回原调用的轮（全局配对，轮不再按正文硬切）。
 */
export function groupMessages(msgs: Msg[]): ChatNode[] {
  const nodes: ChatNode[] = [];
  const pairing: Pairing = { byId: new Map(), unmatched: [] };
  for (const m of msgs) {
    if (m.role === "system") {
      nodes.push({ kind: "system", key: m.idx, msg: m });
      continue;
    }
    if (m.role === "user") {
      nodes.push({ kind: "user", key: m.idx, msg: m });
      continue;
    }
    if (m.role === "assistant") {
      const hasText = Boolean(m.content.trim()) || Boolean(m.reasoning_content?.trim());
      if (!hasText && !m.tool_calls?.length) continue;   // 纯空占位：跳过
      const node: TurnNode = { kind: "turn", key: m.idx, msg: hasText ? m : null, pairs: [] };
      nodes.push(node);
      if (m.tool_calls?.length) registerCalls(node, m, pairing);
      continue;
    }
    if (m.role === "tool") attachResult(nodes, m.idx, m, pairing);
  }
  return nodes;
}
