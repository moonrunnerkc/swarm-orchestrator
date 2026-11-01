import { describe, expect, it } from "vitest";
import { type RunReportFile, renderMarkdown, reportVersion, summaryLines } from "./report.ts";

const report: RunReportFile = {
  version: reportVersion,
  task: "Move the history modules into a package",
  model: { name: "m", reason: "r" },
  stop: "step-budget",
  reason: null,
  state: "incomplete",
  snapshot: { base: "b", patchSha256: "p", patch: "/x/delivered.patch", treeSha256: null },
  verification: "fresh",
  blocked: null,
  unchecked: "the change does not apply: error: uv.lock: already exists in working directory",
  changed: [],
  requirements: [],
  regression: "unresolved",
  execution: null,
  attestation: null,
  startingState: { head: "h", base: "b", edits: [], python: null },
  delivery: { applied: true },
  instructions: [],
  notes: [],
  review: null,
  resources: {
    steps: 1,
    inputTokens: 1,
    outputTokens: 1,
    estimatedTurns: 0,
    inferenceMs: 1,
    inferenceTurns: 1,
    wallMs: 1,
    retries: 0,
    escalations: 0,
    verifications: 0,
    cost: "none (local runtime)",
    turns: [],
  },
};

describe("the run's report", () => {
  // tracemantle (session 20261101T125501-97efc9): the change did not apply, no check ran, and
  // neither the summary nor the report said why.
  it("says why no check ran against the delivered change, in the verifier's words", () => {
    expect(summaryLines(report, { markdown: "/x/report.md" })).toContain(
      "not checked  the change does not apply: error: uv.lock: already exists in working directory",
    );
    expect(renderMarkdown(report)).toContain(
      "- Not checked: the change does not apply: error: uv.lock: already exists in working directory.",
    );
  });
});

describe("the worktree's Python environment in the report", () => {
  const python = {
    state: "prepared" as const,
    command: "uv sync --frozen",
    interpreter: "/w/.venv/bin/python",
    version: "3.14.7",
    lockfile: { path: "uv.lock" as const, sha256: "abc" },
    limitation: null,
  };

  it("names the interpreter and the lockfile it was built from", () => {
    const prepared = { ...report, startingState: { ...report.startingState, python } };
    expect(renderMarkdown(prepared)).toContain(
      "- Python environment: built in the worktree by `uv sync --frozen` from uv.lock (sha256 abc); interpreter /w/.venv/bin/python, Python 3.14.7.",
    );
    expect(summaryLines(prepared, { markdown: "/x/report.md" }).join("\n")).not.toContain(
      "python env",
    );
  });

  it("says plainly when there was none, and why", () => {
    const missing = {
      ...python,
      state: "not-prepared" as const,
      interpreter: null,
      version: null,
      limitation: "uv is not on PATH",
    };
    const unprepared = { ...report, startingState: { ...report.startingState, python: missing } };
    expect(renderMarkdown(unprepared)).toContain(
      "- Python environment: not prepared, uv is not on PATH.",
    );
    expect(summaryLines(unprepared, { markdown: "/x/report.md" })).toContain(
      "python env   not prepared: uv is not on PATH",
    );
  });
});

describe("each requirement as asked, as read, and as judged", () => {
  // claimcheck (session 20261101T064120-2e5241): the summary printed "R1 satisfied" and nothing
  // else, so Stryker 10.1.1 against "the latest 9.x" could only be seen in the session directory.
  const task =
    "Bump vitest from 4.1.8 to 4.1.10 (or both Stryker packages to the latest 9.x if one exists).";
  const outcome: RunReportFile["requirements"][number] = {
    id: "R1",
    text: task,
    source: "user",
    kind: "upgrade",
    required: true,
    assumptions: ["npm can resolve a newer Stryker 9.x release"],
    expected: {
      tests: [{ name: "strykerVersionFor > returns the Stryker version for vitest major 4" }],
      checks: ["test"],
      structure: [{ path: "src/adapters/worktree-toolchain.ts", contains: "strykerVersionFor" }],
      packages: [{ name: "@stryker-mutator/core", ecosystem: "npm", version: "10.1.1" }],
    },
    versions: [
      {
        name: "@stryker-mutator/core",
        ecosystem: "npm",
        range: "9.x",
        latest: true,
        wording: "Stryker packages to the latest 9.x",
      },
    ],
    status: "failed",
    evidence: [],
    limitation: "failing: npm:@stryker-mutator/core within the latest 9.x",
    nextAction: "repair the failing evidence",
  };
  const judged = { ...report, task, requirements: [outcome] };

  it("prints the wording, then the model's reading, then the status, in the summary", () => {
    const lines = summaryLines(judged, { markdown: "/x/report.md" });
    const at = lines.findIndex((line) => line.startsWith("R1 "));
    expect(lines.slice(at, at + 4)).toEqual([
      `R1           asked    ${task}`,
      '             read as  upgrade: npm:@stryker-mutator/core 10.1.1; tests strykerVersionFor > returns the Stryker version for vitest major 4; checks test; src/adapters/worktree-toolchain.ts contains "strykerVersionFor"; assumes npm can resolve a newer Stryker 9.x release',
      '             held to  npm:@stryker-mutator/core within the latest 9.x (from "Stryker packages to the latest 9.x")',
      "             status   failed: failing: npm:@stryker-mutator/core within the latest 9.x",
    ]);
  });

  it("puts the reading beside the wording in the report's table", () => {
    const markdown = renderMarkdown(judged);
    expect(markdown).toContain(
      "| Requirement | Source | Read as | Held to | Status | Evidence | Limitation |",
    );
    expect(markdown).toContain(
      `| R1: ${task} | user | upgrade: npm:@stryker-mutator/core 10.1.1; tests strykerVersionFor > returns the Stryker version for vitest major 4; checks test; src/adapters/worktree-toolchain.ts contains "strykerVersionFor"; assumes npm can resolve a newer Stryker 9.x release | npm:@stryker-mutator/core within the latest 9.x (from "Stryker packages to the latest 9.x") | failed |`,
    );
  });
});
