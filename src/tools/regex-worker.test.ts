import { expect, it } from "vitest";
import { createRegexMatcher } from "./regex-worker.ts";

it("terminates an executing catastrophic match", async () => {
  const matcher = createRegexMatcher("^(a+)+$", 150);
  try {
    await expect(matcher.match([`${"a".repeat(10000)}!`])).rejects.toThrow(/deadline/);
  } finally {
    await matcher.close();
  }
}, 2000);
it("cancels in-flight matching and refuses already-cancelled dispatch", async () => {
  const cancellation = new AbortController();
  const matcher = createRegexMatcher("^(a+)+$", 1000, cancellation.signal);
  const pending = matcher.match([`${"a".repeat(10000)}!`]);
  cancellation.abort();
  try {
    await expect(pending).rejects.toThrow(/cancelled/);
  } finally {
    await matcher.close();
  }
  expect(() => createRegexMatcher("a", 1000, cancellation.signal)).toThrow();
});
