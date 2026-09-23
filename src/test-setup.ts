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
