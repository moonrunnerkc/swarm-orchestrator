import { describe, expect, it } from "vitest";
import denials from "./fixtures/quoted-path-denials-2026-11-01.json" with { type: "json" };
import { createPolicyGuard } from "./policy-guard.ts";
import { readShellCommand, readShellPipeline } from "./shell-command.ts";

/**
 * Path refusals from the acceptance sessions of 2026-11-01, verbatim from their ledgers. Of the
 * 46 path refusals across the 46 sessions, 9 named text inside a quoted argument: a sed `a`
 * command's inserted test source (`/--max-budget-usd`, `/requires`) and sed addresses
 * (`/function reproCommand/,/}/p`). The `outside-path` records are a sample of the 33 that named
 * a path outside the workspace the command really opens, and stay refused.
 */
type Denial = (typeof denials)[number];

function guardFor(denial: Denial) {
  return createPolicyGuard({
    workspaceRoot: denial.workspace,
    homeDir: "/Users/brad",
    childHomeDir: "/tmp/swarm-test-child-home",
    shellAllowlist: [],
    deniedRoots: [],
    realpath: (path) => path,
  });
}

/** The chokepoint's path check: every offered operand through the guard, first refusal wins. */
function firstDenial(denial: Denial): string | null {
  const read = readShellCommand(denial.command);
  if (read === null) return "unreadable";
  const guard = guardFor(denial);
  for (const operand of read.operands) {
    const verdict = guard.checkPath(operand);
    if (!verdict.allowed) return verdict.reason;
  }
  return null;
}

/** The recorded reason with the host's symlinked prefixes taken off, as the injected realpath sees it. */
const unlinked = (detail: string) =>
  detail.replace(/^\/private(?=\/tmp\/)/, "").replace(/^\/System\/Volumes\/Data(?=\/)/, "");

const named = (detail: string) => detail.split(" resolves outside the workspace ")[0] ?? "";

const quoted = denials.filter((denial) => denial.kind === "quoted-text");
const outside = denials.filter((denial) => denial.kind === "outside-path");

describe("the path refusals of 2026-11-01 on text inside a quoted argument", () => {
  it("each named text from sed's script argument, which sed reads as a program", () => {
    expect(quoted).toHaveLength(9);
    for (const denial of quoted) {
      const scripts = (readShellPipeline(denial.command) ?? [])
        .filter((one) => one.executable === "sed")
        .map((one) => one.arguments.find((word) => !word.startsWith("-")) ?? "");
      expect(
        scripts.some((script) => script.includes(named(denial.detail))),
        `${denial.session}:${denial.sequence}`,
      ).toBe(true);
    }
  });

  it("are allowed now, and a path the command really writes is still refused", () => {
    for (const denial of quoted) {
      const label = `${denial.session}:${denial.sequence}`;
      if (denial.command.includes("> /tmp/cli_test_new.ts")) {
        // The same sed insertion, written to /tmp first: the refusal now names that file.
        expect(firstDenial(denial), label).toBe(
          `/tmp/cli_test_new.ts resolves outside the workspace ${denial.workspace}`,
        );
      } else {
        expect(firstDenial(denial), label).toBeNull();
      }
    }
  });
});

describe("the path refusals of 2026-11-01 on a path outside the workspace", () => {
  it("are still refused, on the same path", () => {
    expect(outside.length).toBeGreaterThan(0);
    for (const denial of outside) {
      expect(firstDenial(denial), `${denial.session}:${denial.sequence}`).toBe(
        unlinked(denial.detail),
      );
    }
  });
});
