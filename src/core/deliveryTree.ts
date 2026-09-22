export interface TreeDir {
  kind: "dir";
  /** 合并后的段名，如 "shared" 或 "a/b/c"（单链目录折叠） */
  name: string;
  dirs: TreeDir[]; // 按名排序
  files: TreeFile[]; // 按名排序
  fileCount: number; // 含所有后代文件
}
export interface TreeFile {
  kind: "file";
  name: string; // 文件名（最后一段）
  path: string; // 完整原路径（用于 workLink）
}
export type TreeNode = TreeDir | TreeFile;
/** 根：dirs/files 直接在顶层 */
export type TreeRoot = { dirs: TreeDir[]; files: TreeFile[] };

/** 路径段拆分：去掉开头的 "." 段 */
function segments(path: string): string[] {
  return path.split("/").filter((s) => s && s !== ".");
}

/** 所有路径的公共前缀段数 */
function commonPrefixLen(all: string[][]): number {
  if (!all.length) return 0;
  let n = 0;
  for (;;) {
    const seg = all[0][n];
    if (seg === undefined) return n;
    if (!all.every((segs) => segs[n] === seg)) return n;
    n += 1;
  }
}

/** 可变构建节点 */
interface RawDir {
  dirs: Map<string, RawDir>;
  files: { name: string; path: string }[];
}

/** 交付物根目录的段数：约定路径形如 "./d/<id>/..."，过滤 "." 后根为 "d/<id>" 两段 */
const ROOT_SEGMENTS = 2;

/** 构建交付物文件夹树：公共前缀折叠 + 单链目录合并 */
export function buildTree(paths: string[]): TreeRoot {
  const segLists = paths.map(segments);
  // 只折叠交付物根目录这一段公共前缀（"./d/<id>"），根内目录结构完整保留；
  // 若路径在根之前就已分叉（段数不足），则按实际公共前缀折叠。
  // 这样「全部文件在同一目录下」时该目录自然保留为顶层，
  // 「纯平铺（文件直接在根下）」时也不会凭空多出目录层，直接挂根 files。
  const drop = Math.min(commonPrefixLen(segLists), ROOT_SEGMENTS);

  const root: RawDir = { dirs: new Map(), files: [] };
  segLists.forEach((segs, i) => {
    let node = root;
    let rest = segs.slice(drop);
    // 单条路径时公共前缀可能是整条路径，rest 为空，兜底取最后一段作为文件名
    if (rest.length === 0) rest = [segs[segs.length - 1]];
    for (const seg of rest.slice(0, -1)) {
      if (!node.dirs.has(seg)) node.dirs.set(seg, { dirs: new Map(), files: [] });
      node = node.dirs.get(seg)!;
    }
    node.files.push({ name: rest[rest.length - 1], path: paths[i] });
  });

  // 折叠单链目录：目录只有一个子目录且无直接文件时合并段名
  function collapse(dir: RawDir, name: string): { name: string; dir: RawDir } {
    let cur = dir;
    let curName = name;
    while (cur.files.length === 0 && cur.dirs.size === 1) {
      const [childName, child] = [...cur.dirs.entries()][0];
      cur = child;
      curName = `${curName}/${childName}`;
    }
    return { name: curName, dir: cur };
  }

  function toDir(name: string, raw: RawDir): TreeDir {
    const dirs = [...raw.dirs.entries()]
      .map(([n, d]) => {
        const c = collapse(d, n);
        return toDir(c.name, c.dir);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    const files = raw.files
      .map((f) => ({ kind: "file" as const, name: f.name, path: f.path }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const fileCount = files.length + dirs.reduce((s, d) => s + d.fileCount, 0);
    return { kind: "dir", name, dirs, files, fileCount };
  }

  const dirs = [...root.dirs.entries()]
    .map(([n, d]) => {
      const c = collapse(d, n);
      return toDir(c.name, c.dir);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = root.files
    .map((f) => ({ kind: "file" as const, name: f.name, path: f.path }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { dirs, files };
}
