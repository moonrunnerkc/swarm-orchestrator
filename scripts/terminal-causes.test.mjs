import { describe, expect, it } from "vitest";
import { causes, classify, renderTable, signalsOf } from "./terminal-causes.mjs";

let sequence = 0;
function record(type, payload) {
  sequence += 1;
  return { sequence, type, payload };
}
const tool = (toolName, input, decision = "allowed") => record("tool-call", { toolName, input, decision, kind: toolName === "edit" || toolName === "write" ? "write" : "read" });
const gate = (gateId, status, attempt, stdout = "", detail = `${gateId} ${status}`) => record("gate-run", { gateId, status, attempt, blocking: true, stdout, stderr: "", detail });
const stopped = (stopReason) => record("session-stopped", { stopReason, steps: 5 });
const escalation = (gateId, attemptsUsed, cap) => record("escalation", { gateId, attemptsUsed, cap });
const diff = (paths) => record("workspace-diff", { patch: paths.map((path) => `diff --git a/${path} b/${path}\n`).join("") });

describe("classifying a run's terminal cause", () => {
  it("reads a format gate failing only on the dependency directory as environment", () => {
    const records = [
      record("file-set-declared", { files: ["main.go"] }),
      tool("edit", { path: "main.go" }),
      stopped("completed"),
      gate("format", "failed", 0, ".campaign/gomod/x.go\n.campaign/gomod/y.go\n"),
      gate("format", "failed", 1, ".campaign/gomod/x.go\n.campaign/gomod/y.go\n"),
      escalation("format", 2, 2),
      diff(["main.go"]),
    ];
    expect(classify(signalsOf(records))).toMatchObject({ cause: "environment" });
  });

  it("reads a file-set escalation after an edit that preceded every declaration as planner", () => {
    const records = [tool("edit", { path: "src/a.ts" }), record("file-set-declared", { files: ["src/a.ts"] }), stopped("completed"), gate("file-set", "failed", 0), escalation("file-set", 2, 2), diff(["src/a.ts"])];
    expect(classify(signalsOf(records))).toEqual({ cause: "planner", why: "the first edit preceded any declaration naming its file" });
  });

  it("reads one empty response ending the loop as a retry-policy cause", () => {
    const records = [record("file-set-declared", { files: [] }), stopped("empty-response"), gate("tests", "failed", 0), escalation("tests", 2, 2)];
    expect(classify(signalsOf(records))).toMatchObject({ cause: "retry" });
  });

  it("reads every attempt leaving the same tests failing as a retry-policy cause", () => {
    const failing = "not ok 1 - adds (12ms)\nnot ok 2 - subtracts (3ms)\n";
    const records = [record("file-set-declared", { files: [] }), stopped("completed"), gate("tests", "failed", 0, failing, "2 of 3 failed"), gate("tests", "failed", 1, failing.replace("12ms", "9ms"), "2 of 3 failed"), gate("tests", "failed", 2, failing, "2 of 3 failed"), escalation("tests", 2, 2)];
    expect(classify(signalsOf(records))).toEqual({ cause: "retry", why: "every attempt left the tests gate failing the same way" });
  });

  it("does not read a run whose failing tests changed between attempts as a retry-policy cause", () => {
    const records = [record("file-set-declared", { files: [] }), stopped("completed"), gate("tests", "failed", 0, "not ok 1 - adds\nnot ok 2 - subtracts\n", "2 of 3 failed"), gate("tests", "failed", 1, "not ok 2 - subtracts\n", "1 of 3 failed"), escalation("tests", 1, 1)];
    expect(classify(signalsOf(records))).toMatchObject({ cause: "model" });
  });

  it("reads refused edits and repeated calls as an editor cause", () => {
    const records = [
      record("file-set-declared", { files: ["a.ts"] }),
      tool("edit", { path: "a.ts", find: "x" }, "denied"),
      tool("edit", { path: "a.ts", find: "y" }, "denied"),
      stopped("max-steps"),
      gate("tests", "failed", 0, "", "one"),
      gate("tests", "failed", 1, "", "two"),
      escalation("tests", 1, 1),
    ];
    expect(classify(signalsOf(records))).toMatchObject({ cause: "editor" });
    const repeated = [record("file-set-declared", { files: [] }), tool("read", { path: "a" }), tool("read", { path: "a" }), tool("read", { path: "a" }), tool("read", { path: "a" }), stopped("max-steps"), gate("tests", "failed", 0)];
    expect(classify(signalsOf(repeated))).toMatchObject({ cause: "editor" });
  });

  it("leaves the rest to the model, naming how it stopped", () => {
    const records = [record("file-set-declared", { files: [] }), stopped("max-tokens"), gate("tests", "failed", 0, "not ok 1\n", "one"), gate("tests", "failed", 1, "not ok 2\n", "two"), escalation("tests", 1, 1)];
    expect(classify(signalsOf(records))).toEqual({ cause: "model", why: "stopped as max-tokens and escalated at tests" });
  });

  it("does not call a run green while a blocking gate failed in its last cycle", () => {
    expect(signalsOf([stopped("completed"), gate("tests", "failed", 0)]).green).toBe(false);
    expect(signalsOf([stopped("completed"), gate("tests", "passed", 0)]).green).toBe(true);
  });

  it("renders a table with a tally over the five causes", () => {
    const table = renderTable([{ run: "a", cause: "planner", why: "w", signals: signalsOf([stopped("completed"), gate("file-set", "failed", 0), escalation("file-set", 2, 2)]) }]);
    expect(table).toContain("| a | planner | w | completed | file-set | 2 of 2 | 0 | 0 |");
    expect(table).toContain("Tally: environment 0, planner 1, retry 0, editor 0, model 0 over 1 non-green run(s).");
    expect(causes).toHaveLength(5);
  });
});
