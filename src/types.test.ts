import { expect, test } from "vitest";
import type { MsgPage } from "./types";

test("脚手架自检：MsgPage 可构造", () => {
  const page: MsgPage = { messages: [], from: 0, returned: 0, has_more: false };
  expect(page.has_more).toBe(false);
});
