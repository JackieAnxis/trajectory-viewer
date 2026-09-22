import "@testing-library/jest-dom/vitest";

// jsdom 没有 matchMedia；补一个最小 stub（antd 组件在 jsdom 下依赖它，默认不匹配）
if (!window.matchMedia) {
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// jsdom 没有 IntersectionObserver；给懒加载一个最小 stub
if (!window.IntersectionObserver) {
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof window.IntersectionObserver;
}

// jsdom 没有 scrollIntoView / scrollTo；stub 放 Element.prototype（与既有用例的
// spy 同层，放 HTMLElement.prototype 会挡住子类查找、令按层覆盖的用例 spy 失效）
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

// vitest + jsdom 下 globalThis.localStorage 原型链断裂（getItem/setItem/clear
// 均不可用）；按 test-setup 同款惯例补最小内存版，接口与标准 Storage 一致
(function ensureStorage() {
  const proto = Object.getPrototypeOf(globalThis.localStorage) as Record<string, unknown> | null;
  if (proto && typeof proto.getItem === "function" && typeof proto.setItem === "function") return;
  const mem = new Map<string, string>();
  const storage: Storage = {
    get length() { return mem.size; },
    clear: () => mem.clear(),
    getItem: (k) => (mem.has(k) ? mem.get(k)! : null),
    key: (i) => Array.from(mem.keys())[i] ?? null,
    removeItem: (k) => { mem.delete(k); },
    setItem: (k, v) => { mem.set(k, String(v)); },
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
})();
