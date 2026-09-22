import { expect, test } from "vitest";
import { buildTree } from "./deliveryTree";

test("按路径建树：目录分层、文件挂在对应目录", () => {
  const root = buildTree([
    "./d/001/proj/index.html",
    "./d/001/proj/assets/app.js",
    "./d/001/tmp/x.js",
  ]);
  // 公共前缀 ./d/001 折叠，顶层应直接是 proj 与 tmp 两个目录
  expect(root.dirs.map((d) => d.name).sort()).toEqual(["proj", "tmp"]);
  expect(root.files).toEqual([]);
  const proj = root.dirs.find((d) => d.name === "proj")!;
  expect(proj.files.map((f) => f.name)).toEqual(["index.html"]);
  expect(proj.dirs.map((d) => d.name)).toEqual(["assets"]);
  expect(proj.fileCount).toBe(2);
});

test("单链目录合并成一段", () => {
  const root = buildTree(["./d/001/a/b/c/file.txt", "./d/001/other.txt"]);
  // 公共前缀 ./d/001 折叠后，a/b/c 是单链，合并显示
  expect(root.dirs.map((d) => d.name)).toEqual(["a/b/c"]);
  const chain = root.dirs.find((d) => d.name === "a/b/c")!;
  expect(chain.files.map((f) => f.name)).toEqual(["file.txt"]);
});

test("全部文件在同一目录下时保留该目录作为顶层", () => {
  const root = buildTree(["./d/001/proj/a.js", "./d/001/proj/b.js"]);
  expect(root.dirs.map((d) => d.name)).toEqual(["proj"]);
  expect(root.dirs[0].fileCount).toBe(2);
  expect(root.files).toEqual([]);
});

test("纯平铺（无目录）直接挂根 files", () => {
  const root = buildTree(["./d/001/a.js", "./d/001/b.js"]);
  // 公共前缀折叠后无目录层
  expect(root.dirs).toEqual([]);
  expect(root.files.map((f) => f.name).sort()).toEqual(["a.js", "b.js"]);
});

test("目录在前文件在后，各自按名排序", () => {
  const root = buildTree(["./d/001/z.js", "./d/001/m/index.js", "./d/001/a.js"]);
  expect(root.files.map((f) => f.name)).toEqual(["a.js", "z.js"]);
  expect(root.dirs.map((d) => d.name)).toEqual(["m"]);
});

test("fileCount 统计含后代文件", () => {
  const root = buildTree([
    "./d/001/p/a.js",
    "./d/001/p/sub/b.js",
    "./d/001/p/sub/deep/c.js",
  ]);
  const p = root.dirs.find((d) => d.name === "p")!;
  expect(p.fileCount).toBe(3);
});

test("重名文件按完整路径区分", () => {
  const root = buildTree(["./d/001/x/util.js", "./d/001/y/util.js"]);
  expect(root.dirs.map((d) => d.name).sort()).toEqual(["x", "y"]);
});
