import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const script = join(import.meta.dirname, "check-invariant-drift.mjs");
let directory;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "invariant-drift-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function write(name, invariants) {
  const path = join(directory, name);
  await writeFile(
    path,
    ["# Title", "", "## Invariants (violating any of these fails review)", "", ...invariants, "", "## Code Style", "", "- something"].join("\n"),
  );
  return path;
}

/** Exit code and stderr, without throwing on the nonzero the failing case is about. */
async function check(left, right) {
  try {
    const { stdout } = await run("node", [script, left, right]);
    return { code: 0, stdout, stderr: "" };
  } catch (cause) {
    return { code: cause.code, stdout: cause.stdout, stderr: cause.stderr };
  }
}

describe("the invariant drift check", () => {
  it("passes when both files carry the same block", async () => {
    const left = await write("CLAUDE.md", ["1. First.", "2. Second."]);
    const right = await write("AGENTS.md", ["1. First.", "2. Second."]);

    const outcome = await check(left, right);

    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toContain("2 invariants");
  });

  /**
   * The case this exists for. Invariant 9 said one thing in one file and another in the
   * other, so which file an agent read decided what guarantee it held itself to.
   */
  it("fails and names the invariant that differs", async () => {
    const left = await write("CLAUDE.md", ["1. First.", "2. Second, amended."]);
    const right = await write("AGENTS.md", ["1. First.", "2. Second."]);

    const outcome = await check(left, right);

    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain("invariant 2 differs");
  });

  it("fails when one file lists more invariants than the other", async () => {
    const left = await write("CLAUDE.md", ["1. First.", "2. Second."]);
    const right = await write("AGENTS.md", ["1. First."]);

    const outcome = await check(left, right);

    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain("lists 2 invariants");
  });

  it("refuses a file with no invariants heading rather than passing it", async () => {
    const left = await write("CLAUDE.md", ["1. First."]);
    const right = join(directory, "EMPTY.md");
    await writeFile(right, "# Nothing here\n");

    const outcome = await check(left, right);

    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain("no \"## Invariants\" heading");
  });

  it("agrees with the two files in this repository, which is what CI runs", async () => {
    const outcome = await check(
      join(import.meta.dirname, "..", "CLAUDE.md"),
      join(import.meta.dirname, "..", "AGENTS.md"),
    );

    expect({ code: outcome.code, stderr: outcome.stderr }).toEqual({ code: 0, stderr: "" });
    expect(outcome.stdout).toContain("14 invariants");
  });
});
