import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import { runBonds } from "./bond-runner.ts";
import { defaultDiffBudget } from "./engine.ts";
import type { FileSetState } from "./file-set.ts";
import type { GateContext, GateDefinition } from "./gate-definition.ts";
import type { GateCycle } from "./gate-runner.ts";
import { createGitWorkspaceProbe } from "./git-workspace.ts";
import { placeholderGate } from "./inspection-gates.ts";
import { exitCodeParser, testOutputParser } from "./parsers.ts";
import { createMemoryWorkspace, createStubCommandRunner } from "./test-doubles.ts";

const run = promisify(execFile);

let root: string;
let evidence: EvidenceRecorder;
let sessionRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "bond-runner-"));
  sessionRoot = await mkdtemp(join(tmpdir(), "bond-runner-session-"));
  evidence = await openEvidenceSession({
    root: sessionRoot,
    sessionId: "bonds",
    clock: { now: () => 1, sleep: async () => {} },
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(sessionRoot, { recursive: true, force: true });
});

const bondFile = "swarm-falsification-bond.test.js";

function testsGate(): GateDefinition {
  return {
    id: "tests",
    title: "tests (npm run test)",
    severity: "blocking",
    source: { kind: "command", command: "npm run --silent test" },
    parse: testOutputParser,
    parserName: "test-output",
  };
}

function cycleWhere(
  statuses: Record<string, "passed" | "failed" | "not-applicable">,
  measures = {},
): GateCycle {
  return {
    attempt: 0,
    runs: [],
    statuses,
    blockingFailures: [],
    advisoryFailures: [],
    measures,
    coverageReports: [],
    testReports: [],
  };
}

function declaredFor(paths: readonly string[]): FileSetState {
  return {
    declared: [...paths],
    amendments: [],
    allowed: new Set(paths),
    wasDeclared: true,
    editedBeforeAuthorized: [],
  };
}

async function memoryContext(): Promise<GateContext> {
  const probe = createMemoryWorkspace();
  return {
    workspaceRoot: root,
    changes: await probe.changes(),
    fileSet: declaredFor([]),
    budgets: defaultDiffBudget,
    probe,
  };
}

async function recordedBonds(): Promise<readonly Record<string, unknown>[]> {
  const lines = (await readFile(evidence.ledgerPath, "utf8")).split("\n").filter(Boolean);
  const records = lines.map((line) => JSON.parse(line) as { type: string; payloadDigest: string });
  const bonds = [];
  for (const record of records.filter((entry) => entry.type === "gate-bond")) {
    bonds.push((await evidence.blobs.get(record.payloadDigest)) as Record<string, unknown>);
  }
  return bonds;
}

describe("bonding a command gate", () => {
  it("holds where the runner refuses the bond, and leaves the tree as it found it", async () => {
    const commands = createStubCommandRunner(() =>
      existsSync(join(root, bondFile))
        ? { exitCode: 1, stdout: "# tests 4\n# pass 3\n# fail 1\n" }
        : { exitCode: 0, stdout: "# tests 3\n# pass 3\n# fail 0\n" },
    );

    const outcomes = await runBonds({
      gates: [testsGate()],
      finalCycle: cycleWhere({ tests: "passed" }, { testsCollected: 3 }),
      context: memoryContext,
      deps: { commands, evidence, emit: () => {} },
      evidence,
      workspaceRoot: root,
      detectedTypes: ["node"],
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.verdict).toBe("held");
    expect(commands.commands).toEqual(["npm run --silent test"]);
    expect(existsSync(join(root, bondFile))).toBe(false);
    const [recorded] = await recordedBonds();
    expect(recorded).toMatchObject({
      gateId: "tests",
      verdict: "held",
      observed: "failed",
      collectedBefore: 3,
    });
    expect((recorded?.bond as { files: string[] } | undefined)?.files).toEqual([bondFile]);
  });

  it("is vacuous where the runner collected the bond and passed anyway", async () => {
    const commands = createStubCommandRunner(() => ({
      exitCode: 0,
      stdout: "# tests 4\n# pass 4\n# fail 0\n",
    }));

    const [outcome] = await runBonds({
      gates: [testsGate()],
      finalCycle: cycleWhere({ tests: "passed" }, { testsCollected: 3 }),
      context: memoryContext,
      deps: { commands, evidence, emit: () => {} },
      evidence,
      workspaceRoot: root,
      detectedTypes: ["node"],
    });

    expect(outcome?.verdict).toBe("vacuous");
    expect(outcome?.detail).toContain("cannot fail");
  });

  it("is unshown where the runner passed and its count does not say it saw the bond", async () => {
    const commands = createStubCommandRunner(() => ({ exitCode: 0, stdout: "ok\n" }));

    const [outcome] = await runBonds({
      gates: [testsGate()],
      finalCycle: cycleWhere({ tests: "passed" }),
      context: memoryContext,
      deps: { commands, evidence, emit: () => {} },
      evidence,
      workspaceRoot: root,
      detectedTypes: ["node"],
    });

    expect(outcome?.verdict).toBe("unshown");
  });

  it("bonds only gates that passed, and records a gate with no bond as not bonded", async () => {
    const commands = createStubCommandRunner(() => ({ exitCode: 0 }));
    const probe: GateDefinition = {
      id: "behaviour-probe",
      title: "behaviour probe",
      severity: "blocking",
      source: { kind: "command", command: "probe" },
      parse: exitCodeParser,
    };

    const outcomes = await runBonds({
      gates: [testsGate(), probe],
      finalCycle: cycleWhere({ tests: "failed", "behaviour-probe": "passed" }),
      context: memoryContext,
      deps: { commands, evidence, emit: () => {} },
      evidence,
      workspaceRoot: root,
      detectedTypes: ["node"],
    });

    expect(outcomes.map((outcome) => [outcome.gateId, outcome.verdict])).toEqual([
      ["behaviour-probe", "not-bonded"],
    ]);
    expect(commands.commands).toEqual([]);
  });

  it("never overwrites a file the project already has, and says so", async () => {
    await writeFile(join(root, bondFile), "the project's own file\n");
    const commands = createStubCommandRunner(() => ({ exitCode: 1 }));

    const [outcome] = await runBonds({
      gates: [testsGate()],
      finalCycle: cycleWhere({ tests: "passed" }),
      context: memoryContext,
      deps: { commands, evidence, emit: () => {} },
      evidence,
      workspaceRoot: root,
      detectedTypes: ["node"],
    });

    expect(outcome?.verdict).toBe("not-bonded");
    expect(outcome?.detail).toContain("already exists");
    expect(await readFile(join(root, bondFile), "utf8")).toBe("the project's own file\n");
  });
});

describe("bonding an inspection over a real workspace", () => {
  it("holds: the placeholder gate reads the change set and refuses the TODO the bond added", async () => {
    await run("git", ["init", "-q"], { cwd: root });
    await writeFile(join(root, "README.md"), "hello\n");
    await run("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "add", "-A"], {
      cwd: root,
    });
    await run(
      "git",
      [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-q",
        "-m",
        "base",
      ],
      { cwd: root },
    );
    const probe = createGitWorkspaceProbe({ workspaceRoot: root, baseRef: "HEAD" });
    const context = async (): Promise<GateContext> => ({
      workspaceRoot: root,
      changes: await probe.changes(),
      fileSet: declaredFor(["README.md"]),
      budgets: defaultDiffBudget,
      probe,
    });
    const commands = createStubCommandRunner(() => ({ exitCode: 0 }));

    const [outcome] = await runBonds({
      gates: [placeholderGate],
      finalCycle: cycleWhere({ placeholder: "passed" }),
      context,
      deps: { commands, evidence, emit: () => {} },
      evidence,
      workspaceRoot: root,
      detectedTypes: ["node"],
    });

    expect(outcome?.verdict).toBe("held");
    expect(outcome?.detail).toContain("placeholder marker");
    expect((await probe.changes()).files.map((file) => file.path)).toEqual([]);
  });
});
