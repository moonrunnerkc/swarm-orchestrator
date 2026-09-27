import { expect, it } from "vitest";
import { reviewerText } from "./ci-summary.ts";

it("renders untrusted presentation as literal bounded text", () => {
  const text = reviewerText("<img src=x> [click](https://evil.test)\n::error::forged");
  expect(text).not.toContain("<img");
  expect(text).not.toContain("\n");
  expect(text).not.toContain("::error::");
  expect(text).toContain("\\[click\\]");
  expect(reviewerText("x".repeat(10000)).length).toBe(2000);
});
it("uses the shared known-pattern scrubber", () => {
  expect(reviewerText('password="sensitive-value"')).not.toContain("sensitive-value");
});
