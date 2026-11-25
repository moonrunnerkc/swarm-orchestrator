import { describe, expect, it } from "vitest";
import { completionMarker } from "./prompt.ts";
import { obligationsOf } from "./requirement-record.ts";
import {
  authorTest,
  fixture,
  noAuthoredCheck,
  recordAndComplete,
  scripted,
  write,
} from "./test-doubles.ts";

/**
 * A task that sets two parts apart. Each is a required requirement with a check of its own,
 * written apart from the change, and the run is complete only when every one is satisfied.
 */
const task = [
  "Rework half.mjs:",
  "- make half(n) return n / 2",
  "- add an exported double(n) returning n * 2",
].join("\n");
const obligations = obligationsOf(task).obligations;

const testOf = (title: string, body: string) =>
  `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport * as subject from "../half.mjs";\ntest("${title}", () => ${body});\n`;
const halves = "assert.equal(subject.half(4), 2)";
const doubles = "assert.equal(subject.double(4), 8)";
/** The author's replies in the order the gate asks: for R1, then R2, then R3. */
const author = [
  authorTest("feature", testOf("the whole task, written apart", `{ ${halves}; ${doubles}; }`)),
  authorTest("fix", testOf("half(4) is 2, written apart", halves)),
  authorTest("feature", testOf("double(4) is 8, written apart", doubles)),
];
const fixHalf = write("half.mjs", "export const half = (n) => n / 2;");
const fixBoth = write(
  "half.mjs",
  "export const half = (n) => n / 2;\nexport const double = (n) => n * 2;",
);
const statuses = (requirements: readonly { id: string; status: string; required: boolean }[]) =>
  requirements.filter((one) => one.required).map((one) => [one.id, one.status]);

describe("a task with several explicit requirements", () => {
  it("is complete when every one is satisfied by its own independent check", async () => {
    const probe = await fixture({}, task);
    const ran = await probe.run(scripted([fixBoth], { author }), { obligations });
    expect(ran.report.state).toBe("complete");
    expect(
      ran.report.requirements.map((one) => [one.id, one.text, one.status, one.witness]),
    ).toEqual([
      ["R1", task, "satisfied", "independent"],
      ["R2", "make half(n) return n / 2", "satisfied", "independent"],
      ["R3", "add an exported double(n) returning n * 2", "satisfied", "independent"],
    ]);
  });

  it("is not complete where only some are met, and says which, whatever the model marks", async () => {
    const probe = await fixture({}, task);
    const ran = await probe.run(scripted([fixHalf, completionMarker], { author }), { obligations });
    expect(ran.report.state).toBe("incomplete");
    expect(statuses(ran.report.requirements)).toEqual([
      ["R1", "failed"],
      ["R2", "satisfied"],
      ["R3", "failed"],
    ]);
    expect(ran.stop).toBe("no-progress");
    expect(ran.report.reason).toContain("still fails");
  });

  it("keeps a requirement the model leaves out of its record, or marks optional", async () => {
    const probe = await fixture({}, task);
    const omitting = recordAndComplete([
      { id: "R1", text: "Rework half.mjs", kind: "fix" },
      {
        id: "R3",
        text: "add an exported double(n) returning n * 2",
        kind: "feature",
        required: false,
      },
      { id: "R7", text: "tidy the module", kind: "other", required: true, source: "user" },
    ]);
    const ran = await probe.run(scripted([fixHalf, omitting], { author }), { obligations });
    expect(ran.report.state).toBe("incomplete");
    expect(statuses(ran.report.requirements)).toEqual([
      ["R1", "failed"],
      ["R2", "satisfied"],
      ["R3", "failed"],
    ]);
    // What the model added is its own suggestion: recorded, and deciding nothing.
    expect(ran.report.requirements.find((one) => one.id === "R7")).toMatchObject({
      required: false,
      source: "inferred",
    });
  });

  it("leaves an obligation unverified where nothing independent checks it, and says how to supply a check", async () => {
    const probe = await fixture({}, task);
    const ran = await probe.run(
      scripted([fixBoth, completionMarker], {
        author: [author[0] ?? "", author[1] ?? "", noAuthoredCheck],
      }),
      { obligations },
    );
    expect(ran.report.state).toBe("incomplete");
    expect(statuses(ran.report.requirements)).toEqual([
      ["R1", "satisfied"],
      ["R2", "satisfied"],
      ["R3", "unverified"],
    ]);
    expect(ran.report.notes.join("\n")).toContain(
      'R3 ("add an exported double(n) returning n * 2") has no independent check',
    );
    expect(ran.report.notes.join("\n")).toContain("--accept R3=<test file>");
  });

  it("refuses a check supplied for a requirement the task does not have", async () => {
    const probe = await fixture({}, task);
    const ran = await probe.run(scripted([fixBoth], { author }), {
      obligations,
      supplied: [{ kind: "command", requirement: "R5", command: "node --test" }],
    });
    expect(ran.stop).toBe("blocked");
    expect(ran.report.reason).toContain(
      "a check was supplied for R5, which this task does not have",
    );
    expect(ran.report.snapshot.patchSha256).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("carries the same required set through an escalation to another model", async () => {
    const probe = await fixture({}, task);
    const stalled = scripted([fixHalf, completionMarker], { author });
    const strong = scripted([fixBoth], { author });
    const ran = await probe.run(stalled, {
      obligations,
      escalation: () => ({ client: { ...strong, model: "strong" }, reason: "a better record" }),
    });
    expect(ran.report.resources.escalations).toBe(1);
    expect(ran.report.state).toBe("complete");
    expect(statuses(ran.report.requirements)).toEqual([
      ["R1", "satisfied"],
      ["R2", "satisfied"],
      ["R3", "satisfied"],
    ]);
  });
});
