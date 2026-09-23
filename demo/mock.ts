import type {
  Annotation, AnnotationReply, AnnotationStore, Msg, MsgPage, TrajectoryDataSource,
} from "../src/types";

/** 生成 340 条演示消息：system + user + 多轮 assistant（推理/正文/工具调用）+ tool 结果，
 *  覆盖失败结果、weight=0、孤立 tool 等渲染分支（翻页由 limit 切片触发） */
function buildMessages(): Msg[] {
  const msgs: Msg[] = [
    { idx: 0, role: "system", preview: "", content_len: 20, reasoning_len: 0,
      content: "你是演示助手。系统提示卡片默认收起。" },
    { idx: 1, role: "user", preview: "", content_len: 12, reasoning_len: 0,
      content: "帮我检查一下这个项目的构建脚本。" },
  ];
  let idx = 2;
  for (let round = 0; round < 40; round++) {
    msgs.push({
      idx: idx++, role: "assistant", preview: "", content_len: 60, reasoning_len: 30,
      reasoning_content: `第 ${round + 1} 轮：先想想该怎么查。\n\n- 看 package.json\n- 看构建产物`,
      content: `我来查看构建配置（第 ${round + 1} 轮）。`,
      weight: round === 3 ? 0 : undefined,   // 第 4 轮演示 weight=0 遮眼徽标
      tool_calls: [{
        id: `call_${round}`, type: "function",
        function: { name: "exec", arguments: JSON.stringify({ command: `cat package.json | jq .scripts # round ${round}` }) },
      }],
    });
    msgs.push({
      idx: idx++, role: "tool", preview: "", content_len: 40, reasoning_len: 0,
      tool_call_id: `call_${round}`,
      content: round === 5
        ? "Error: command not found"          // 演示失败结果红色标记
        : JSON.stringify({ status: "ok", round, scripts: { build: "tsup", test: "vitest run" } }),
    });
    if (round % 7 === 6) {
      msgs.push({
        idx: idx++, role: "assistant", preview: "", content_len: 30, reasoning_len: 0,
        content: `阶段性小结：前 ${round + 1} 轮检查完成，构建脚本正常。\n\n\`\`\`json\n{"done": ${round + 1}}\n\`\`\``,
      });
    }
  }
  return msgs;
}

const ALL = buildMessages();
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createMockDataSource(): TrajectoryDataSource {
  return {
    async fetchMessages({ from, limit }): Promise<MsgPage> {
      await delay(150);
      const slice = ALL.slice(from, from + limit);
      return { messages: slice, from, returned: slice.length, has_more: from + slice.length < ALL.length };
    },
    async fetchRaw() {
      await delay(150);
      return { demo: true, total: ALL.length, sample: ALL[0] };
    },
  };
}

/** 内存评论存储：id 自增，回复两级压平 */
export function createMockStore(): AnnotationStore {
  let seq = 1;
  let replySeq = 100;
  const annotations: Annotation[] = [];
  const clone = () => JSON.parse(JSON.stringify(annotations)) as Annotation[];
  return {
    async list() { await delay(80); return clone(); },
    async create(input) {
      await delay(80);
      annotations.push({
        ...input, id: seq++, author: "demo", resolved: 0, resolved_by: null, resolved_at: null,
        created_at: Date.now() / 1000, updated_at: Date.now() / 1000,
        like_count: 0, liked_by_me: false, replies: [],
      });
      return {};
    },
    async reply(annotationId, body, parentId) {
      await delay(80);
      const a = annotations.find((x) => x.id === annotationId);
      if (!a) throw new Error("楼不存在");
      const r: AnnotationReply = {
        id: replySeq++, annotation_id: annotationId, parent_id: parentId ?? null,
        author: "demo", body, created_at: Date.now() / 1000, updated_at: Date.now() / 1000,
        like_count: 0, liked_by_me: false,
      };
      a.replies.push(r);
      return r;
    },
    async update(id, body, kind) {
      await delay(80);
      const now = Date.now() / 1000;
      for (const a of annotations) {
        if (kind === "annotation" && a.id === id) { a.body = body; a.updated_at = now; return a; }
        const r = a.replies.find((x) => x.id === id);
        if (kind === "reply" && r) { r.body = body; r.updated_at = now; return r; }
      }
      throw new Error("目标不存在");
    },
    async delete(id, kind) {
      await delay(80);
      if (kind === "annotation") {
        const i = annotations.findIndex((x) => x.id === id);
        if (i >= 0) annotations.splice(i, 1);
        return;
      }
      for (const a of annotations) {
        const i = a.replies.findIndex((x) => x.id === id);
        if (i >= 0) { a.replies.splice(i, 1); return; }
      }
    },
    async setResolved(id, resolved) {
      await delay(80);
      const a = annotations.find((x) => x.id === id);
      if (!a) throw new Error("楼不存在");
      a.resolved = resolved ? 1 : 0;
      a.resolved_by = resolved ? "demo" : null;
      a.resolved_at = resolved ? Date.now() / 1000 : null;
      return a;
    },
    async setLike(targetId, kind, liked) {
      await delay(60);
      let cur: { like_count: number; liked_by_me: boolean } | undefined;
      for (const a of annotations) {
        if (kind === "annotation" && a.id === targetId) cur = a;
        const r = a.replies.find((x) => x.id === targetId);
        if (kind === "reply" && r) cur = r;
      }
      if (!cur) throw new Error("目标不存在");
      cur.like_count += liked ? 1 : -1;
      cur.liked_by_me = liked;
      return { likeCount: cur.like_count, likedByMe: cur.liked_by_me };
    },
  };
}

export const MOCK_DELIVERY = [
  "./d/demo-001/report/index.html",
  "./d/demo-001/report/assets/app.js",
  "./d/demo-001/notes/summary.md",
];
