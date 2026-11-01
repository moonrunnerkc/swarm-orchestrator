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
