/** 消息中的工具调用 */
export interface ToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

/** 单条消息（保留源项目全部字段：列表场景可能用到 preview/计数，不瘦身） */
export interface Msg {
  idx: number;
  role: string;
  preview: string;
  content_len: number;
  content: string;
  reasoning_len: number;
  reasoning_content?: string | null;
  tool_calls?: ToolCall[] | null;
  weight?: number | null;
  tool_call_id?: string | null;
}

/** 消息分页响应 */
export interface MsgPage {
  messages: Msg[];
  from: number;
  returned: number;
  has_more: boolean;
}

/** 批注锚点区块 */
export type AnnotationRegion = "content" | "reasoning" | "args";

/** 划线建楼输入：锚点五元组（prefix/suffix 客户端截 32 字符） */
export interface AnchorInput {
  msg_idx: number;
  region: AnnotationRegion;
  sub: number | null;          // region='args' 时 tool_calls 下标，其余 null
  quote: string;
  prefix: string;
  suffix: string;
}

/** 批注回复（平铺；组件按 parent_id 组两层树） */
export interface AnnotationReply {
  id: number;
  annotation_id: number;
  parent_id: number | null;    // null=一级；二级指向一级（更深层由持久层压平）
  author: string;
  body: string;
  created_at: number;
  updated_at: number;          // > created_at 时显示「已编辑」
  like_count: number;
  liked_by_me: boolean;
}

/** 批注楼：锚点五元组 + 首评 + 解决态 + 回复平铺（已去后端寻址字段 item_owner/item_name/line） */
export interface Annotation {
  id: number;
  msg_idx: number;
  region: AnnotationRegion;
  sub: number | null;
  quote: string;
  prefix: string;
  suffix: string;
  author: string;
  body: string;
  resolved: number;            // 0/1 布尔
  resolved_by: string | null;
  resolved_at: number | null;
  created_at: number;
  updated_at: number;
  like_count: number;
  liked_by_me: boolean;
  replies: AnnotationReply[];
}

/** 点赞结果（setLike 响应即现状，用于本地增量不重拉） */
export interface LikeResult {
  likeCount: number;
  likedByMe: boolean;
}

/** 数据源适配器：宿主注入；寻址（item/line 等）封装在适配器闭包内，组件不感知 */
export interface TrajectoryDataSource {
  /** 分页拉消息 */
  fetchMessages(query: { from: number; limit: number }): Promise<MsgPage>;
  /** 拉原数据（进入 raw 视图时懒调用） */
  fetchRaw(): Promise<unknown>;
}

/** 评论存储适配器；写操作（除 setLike）成功后组件自动重拉 list */
export interface AnnotationStore {
  list(): Promise<Annotation[]>;
  create(input: AnchorInput & { body: string }): Promise<unknown>;
  reply(annotationId: number, body: string, parentId?: number | null): Promise<unknown>;
  update(id: number, body: string, kind: "annotation" | "reply"): Promise<unknown>;
  delete(id: number, kind: "annotation" | "reply"): Promise<void>;
  setResolved(id: number, resolved: boolean): Promise<unknown>;
  setLike(targetId: number, kind: "annotation" | "reply", liked: boolean): Promise<LikeResult>;
}

/** 全局通知级别（替代 antd message） */
export type NotifyKind = "error" | "warning" | "info";
