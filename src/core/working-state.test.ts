import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "./model-client.ts";
import {
  chooseDecision,
  decisionSignals,
  deriveWorkingState,
  describeWorkingState,
  exitCodeOf,
  predictionHolds,
} from "./working-state.ts";

const record = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`;
const trailer = (n: number) => `\n[evidence record ${record(n)} kind tool-call:x]`;

let counter = 0;
/** One assistant turn with one call, answered by one tool message. */
function exchange(
  toolName: string,
  input: unknown,
  output: string,
  failed = false,
): ConversationMessage[] {
  counter += 1;
  const callId = `c${counter}`;
  return [
    { role: "assistant", text: "", toolCalls: [{ callId, toolName, input }] },
    {
      role: "tool",
      outcomes: [{ callId, toolName, output: `${output}${trailer(counter)}`, failed }],
    },
  ];
}

/** The acorn control's shape: reproduce, declare, an edit refused, then reads of one file. */
const acornLike: ConversationMessage[] = [
  { role: "user", text: "make the parser throw" },
  ...exchange("read", { path: "src/expression.js" }, "pp.parseObj = ..."),
  ...exchange(
    "shell",
    { command: "node repro.js" },
    "exit code: 0\nstdout:\nFAILED - no error thrown",
  ),
  ...exchange(
    "declare_file_set",
    { files: ["src/expression.js", "test/tests.js"] },
    "declared 2 file(s)",
  ),
  ...exchange(
    "edit",
    { path: "src/expression.js", find: "nope", replace: "x" },
    "find text not found in src/expression.js",
    true,
  ),
  ...exchange("read", { path: "src/expression.js", startLine: 130, endLine: 180 }, "..."),
  ...exchange("read", { path: "src/expression.js", startLine: 779, endLine: 870 }, "..."),
  ...exchange(
    "search",
    { pattern: "function testFail", path: "test" },
    "no match for /function testFail/",
  ),
];

describe("deriveWorkingState", () => {
  it("keeps executions with their record, exit status and generation, and names refused edits", () => {
    const state = deriveWorkingState(acornLike);
    expect(state.steps).toBe(7);
    expect(state.generation).toBe(0);
    expect(state.edits).toEqual([]);
    expect(state.failedEdits).toEqual([
      { step: 4, path: "src/expression.js", reason: "find text not found in src/expression.js" },
    ]);
    expect(state.executions).toEqual([
      expect.objectContaining({
        step: 2,
        call: "node repro.js",
        exitCode: 0,
        generation: 0,
        record: expect.stringMatching(/^sha256:/),
      }),
    ]);
    expect(state.executions[0]?.excerpt).toContain("FAILED - no error thrown");
    expect(state.reads).toEqual([
      { path: "src/expression.js", ranges: [null, [130, 180], [779, 870]] },
    ]);
    expect(state.declaredUnedited).toEqual(["src/expression.js", "test/tests.js"]);
  });

  it("qualifies an observation made before a later edit and keeps the current one current", () => {
    const messages = [
      ...acornLike,
      ...exchange(
        "edit",
        { path: "src/expression.js", find: "a", replace: "b" },
        "replaced 1 occurrence(s)",
      ),
      ...exchange("shell", { command: "npm test" }, "exit code: 1\nstdout:\n1 failing"),
    ];
    const state = deriveWorkingState(messages);
    expect(state.generation).toBe(1);
    expect(state.declaredUnedited).toEqual(["test/tests.js"]);
    const text = describeWorkingState(state, {
      candidate: { digest: record(99), changedFiles: ["src/expression.js"] },
    });
    expect(text).toMatch(
      /step 2: shell node repro\.js; exit 0; before the edit of src\/expression\.js at step 8, so it predates the current tree/,
    );
    expect(text).toMatch(/step 9: shell npm test; exit 1; current tree/);
  });

  it("reads the bounded view's recorded status as well as the shell tool's own line", () => {
    expect(exitCodeOf("exit code: 2\nstderr:\nboom")).toBe(2);
    expect(
      exitCodeOf(
        "[output view: the full output is 9 characters; recorded status: exit code 7, not timed out]",
      ),
    ).toBe(7);
    expect(exitCodeOf("no status here")).toBeNull();
  });
});

describe("the registered decision policy", () => {
  it("continues without a model call once edits have landed and nothing at the current tree fails", () => {
    const messages = [
      ...acornLike,
      ...exchange(
        "write",
        { path: "src/expression.js", content: "x" },
        "wrote 1 bytes to src/expression.js",
      ),
    ];
    expect(chooseDecision(decisionSignals(deriveWorkingState(messages)))).toEqual({
      kind: "continue",
      rule: "edits-landed-no-failing-check",
      alternativePermitted: false,
    });
  });

  it("diagnoses a failing check at the current tree, and admits an alternative after two failing edited trees", () => {
    const once = [
      ...acornLike,
      ...exchange("write", { path: "a.js", content: "1" }, "wrote 1 bytes to a.js"),
      ...exchange("shell", { command: "npm test" }, "exit code: 1\nstdout:\nfail"),
    ];
    expect(chooseDecision(decisionSignals(deriveWorkingState(once)))).toMatchObject({
      kind: "diagnose",
      rule: "failing-check-at-current-tree",
      alternativePermitted: false,
    });
    const twice = [
      ...once,
      ...exchange("write", { path: "a.js", content: "2" }, "wrote 1 bytes to a.js"),
      ...exchange("shell", { command: "npm test" }, "exit code: 1\nstdout:\nfail again"),
    ];
    expect(chooseDecision(decisionSignals(deriveWorkingState(twice)))).toMatchObject({
      kind: "diagnose",
      alternativePermitted: true,
    });
  });

  it("retrieves code-like names that searches did not find, and diagnoses otherwise", () => {
    const signals = decisionSignals(deriveWorkingState(acornLike));
    expect(signals.missingNames).toEqual(["testFail"]);
    expect(chooseDecision(signals).kind).toBe("retrieve");
    const prose = [
      { role: "user", text: "t" } as ConversationMessage,
      ...exchange("search", { pattern: "Shorthand property" }, "no match for /Shorthand property/"),
    ];
    expect(chooseDecision(decisionSignals(deriveWorkingState(prose)))).toMatchObject({
      kind: "diagnose",
      rule: "no-edit-at-decision-point",
    });
  });
});

describe("predictions", () => {
  it("holds only when every stated part matches, and says nothing where nothing was predicted", () => {
    const observed = { exitCode: 1, output: "exit code: 1\nstdout:\nTypeError: x" };
    expect(predictionHolds({ exitCode: 1, outputIncludes: "TypeError" }, observed)).toBe(true);
    expect(predictionHolds({ exitCode: 0 }, observed)).toBe(false);
    expect(predictionHolds({ outputIncludes: "RangeError" }, observed)).toBe(false);
    expect(predictionHolds({}, observed)).toBeNull();
  });
});

describe("describeWorkingState", () => {
  it("labels explanations by what execution showed and keeps them apart from observations", () => {
    const text = describeWorkingState(deriveWorkingState(acornLike), {
      task: "make the parser throw",
      requiredChecks: ["visible-check"],
      candidate: { digest: record(5), changedFiles: [] },
      hypotheses: [
        {
          id: "H1",
          statement: "the error is lost in parseSubscripts",
          status: "contradicted",
          evidence: { call: "node probe.js", exitCode: 0, record: record(7), tree: record(5) },
        },
        { id: "H2", statement: "toAssignable drops it", status: "untested", evidence: null },
      ],
      openQuestion: "where are deferred errors checked for member targets?",
      remaining: { steps: 24, tokens: 5000, wallMs: 120_000 },
    });
    expect(text.split("\n")[0]).toContain("derived by the harness");
    expect(text).toContain("- original task: make the parser throw");
    expect(text).toContain("required checks still to pass on the delivered tree: visible-check");
    expect(text).toContain("no change against the base yet");
    expect(text).toContain("contradicted by execution H1 (model-proposed)");
    expect(text).toContain("hypothesis, no distinguishing execution ran H2 (model-proposed)");
    expect(text).toContain("next unresolved question (model-proposed)");
    expect(text).toContain("remaining in this loop: 24 steps, 5000 tokens, 120 s");
    expect(text).toContain(
      "searches that matched nothing: /function testFail/ under test (step 7)",
    );
  });

  it("calls another loop's last tree by the name the caller gives it", () => {
    const text = describeWorkingState(deriveWorkingState(acornLike), {
      candidate: null,
      lastTree: "the previous loop's last tree",
    });
    expect(text).toContain("exit 0; the previous loop's last tree");
    expect(text).not.toContain("current tree");
  });
});
