import { expect, test } from "vitest";
import { avatarColor } from "./avatarColor";

test("同名同哈希取色稳定，且为合法 HSL", () => {
  const c1 = avatarColor("jackie");
  expect(c1).toBe(avatarColor("jackie"));
  expect(c1).toMatch(/^hsl\(\d+, 65%, 45%\)$/);
});

test("不同名一般取不同 hue", () => {
  expect(avatarColor("alice")).not.toBe(avatarColor("bob"));
});
