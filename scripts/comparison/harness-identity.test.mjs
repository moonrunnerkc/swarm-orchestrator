import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { harnessDigest } from "./harness-identity.mjs";

describe("the harness digest", () => {
  it("covers every non-test module by name and content, and moves when one changes", () => {
    const directory = mkdtempSync(join(tmpdir(), "harness-identity-"));
    writeFileSync(join(directory, "b.mjs"), "export const b = 1;\n");
    writeFileSync(join(directory, "a.mjs"), "export const a = 1;\n");
    writeFileSync(join(directory, "a.test.mjs"), "test\n");
    const first = harnessDigest(directory);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    writeFileSync(join(directory, "a.test.mjs"), "a changed test\n");
    expect(harnessDigest(directory)).toBe(first);
    writeFileSync(join(directory, "a.mjs"), "export const a = 2;\n");
    expect(harnessDigest(directory)).not.toBe(first);
  });

  it("digests this directory to a stable value across two calls", () => {
    expect(harnessDigest()).toBe(harnessDigest());
  });
});
