import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { mustBeShownToParse, nodeSyntaxCheck, readParseCheck } from "./mutant-parse.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";

describe("which mutants have to be shown to parse", () => {
  /**
   * Only the one that removes a line. Every other operator replaces a token with a token of the
   * same shape, wraps a balanced region or removes a balanced one, so none of them can turn a
   * file that parsed into one that does not.
   */
  it("asks for a check on a deleted statement", () => {
    expect(mustBeShownToParse("delete-statement")).toBe(true);
  });

  it("asks for no check on an operator that cannot break the parse", () => {
    for (const operator of [
      "invert-comparison",
      "negate-condition",
      "swap-arithmetic-operands",
      "return-sentinel",
      "replace-assigned-value",
      "swap-call-arguments",
      "drop-chained-call",
    ] as const) {
      expect(mustBeShownToParse(operator)).toBe(false);
    }
  });
});

describe("what a parse check reads", () => {
  it("uses a mutant that parses where the file it came from parsed", () => {
    expect(readParseCheck({ originalParses: true, mutantParses: true })).toBe("usable");
  });

  /**
   * The reason this check exists. A syntax error is refused by the oracle, and a bond that counted
   * that refusal would credit the oracle with a rejection it never made.
   */
  it("refuses a mutant that does not parse", () => {
    expect(readParseCheck({ originalParses: true, mutantParses: false })).toBe("syntax-error");
  });

  /**
   * Where the checker cannot read the file as the patch left it, it cannot tell a syntax error
   * from a mutant, so it says so rather than guessing in either direction.
   */
  it("abstains where the file it started from does not parse either", () => {
    expect(readParseCheck({ originalParses: false, mutantParses: false })).toBe(
      "dialect-unreadable",
    );
    expect(readParseCheck({ originalParses: false, mutantParses: true })).toBe(
      "dialect-unreadable",
    );
  });
});

/**
 * The dialects the check can and cannot read, run for real rather than asserted. The residual in
 * `docs/oracle-bond-operators.md` says statement deletion is unavailable in TypeScript and JSX,
 * and this is what that claim rests on.
 */
describe("the syntax check node itself performs", () => {
  let directory = "";
  const parses = nodeSyntaxCheck(
    createNodeCommandRunner(
      { now: () => 0, sleep: () => Promise.resolve() },
      harnessChildEnvironment(),
    ),
    { cwd: tmpdir(), timeoutMs: 30_000 },
  );

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "swarm-parse-"));
    await writeFile(join(directory, "module.js"), "export default 1\nconst at = 2\n");
    await writeFile(join(directory, "script.js"), "const fs = require('node:fs')\nfs.stat\n");
    await writeFile(join(directory, "broken.js"), "const at = 1 &&\n");
    await writeFile(join(directory, "typed.ts"), "const at: number = 1\nexport { at }\n");
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("reads module syntax in a .js file", async () => {
    expect(await parses(join(directory, "module.js"))).toBe(true);
  });

  it("reads script syntax in a .js file", async () => {
    expect(await parses(join(directory, "script.js"))).toBe(true);
  });

  it("refuses a file that does not parse", async () => {
    expect(await parses(join(directory, "broken.js"))).toBe(false);
  });

  it("cannot read TypeScript, which is the residual this leaves", async () => {
    expect(await parses(join(directory, "typed.ts"))).toBe(false);
  });

  it("refuses a file that is not there rather than reading absence as a pass", async () => {
    expect(await parses(join(directory, "absent.js"))).toBe(false);
  });
});
