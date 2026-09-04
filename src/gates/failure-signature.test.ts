import { describe, expect, it } from "vitest";
import { failureSignature } from "./failure-signature.ts";

describe("a failure's signature", () => {
  it("is the same for two runs that failed the same way at different speeds", () => {
    const first = failureSignature({
      detail: "2 of 3 failed",
      stdout: "not ok 1 - adds (12ms)\nok 2 - zero\nnot ok 3 - subtracts (3ms)\n",
      stderr: "",
    });
    const second = failureSignature({
      detail: "2 of 3 failed",
      stdout: "not ok 3 - subtracts (9ms)\nok 2 - zero\nnot ok 1 - adds (140ms)\n",
      stderr: "",
    });

    expect(first).toBe(second);
  });

  it("differs once a different test fails, or the detail says something else", () => {
    const base = { detail: "1 of 3 failed", stdout: "not ok 1 - adds\n", stderr: "" };
    expect(failureSignature(base)).not.toBe(
      failureSignature({ ...base, stdout: "not ok 2 - zero\n" }),
    );
    expect(failureSignature(base)).not.toBe(
      failureSignature({ ...base, detail: "the runner exited 1 and printed no TAP counters" }),
    );
  });

  it("reads every line, on either stream, because a linter marks nothing and names files", () => {
    const signature = failureSignature({
      detail: "the command exited 1",
      stdout: "",
      stderr: "src/a.ts:3:1 error no-var\nsrc/b.ts: unused import\n",
    });
    expect(signature).toContain("src/a.ts:#:# error no-var");
    expect(signature).toContain("src/b.ts: unused import");
  });
});
