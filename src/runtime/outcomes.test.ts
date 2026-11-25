import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  attribute,
  describeRecord,
  type FinishedRun,
  recordNotes,
  recordOutcome,
} from "./outcomes.ts";
import { modelRecord, profilePath } from "./profile.ts";

/** A run that was verified and published its evidence, incomplete unless said otherwise. */
const report = (over: Partial<FinishedRun> = {}): FinishedRun => ({
  state: "incomplete",
  verification: "fresh",
  evidenceDelivery: "signed",
  requirements: [{ status: "unverified" }],
  regression: "none",
  resources: { escalations: 0 },
  ...over,
});

describe("what a finished run says about its model", () => {
  it("counts a verified complete run as complete, signed or not, fresh or reused", () => {
    expect(attribute("complete", report({ state: "complete" }))).toBe("complete");
    expect(attribute("complete", report({ state: "complete", evidenceDelivery: "unsigned" }))).toBe(
      "complete",
    );
    expect(attribute("complete", report({ state: "complete", verification: "reused" }))).toBe(
      "complete",
    );
  });

  it("counts against the model a run it stopped short of on its own", () => {
    for (const stop of ["no-progress", "unusable-replies", "step-budget", "token-budget"]) {
      expect(attribute(stop, report())).toBe("model");
    }
  });

  it("counts against the model a completion mark the verifier measured as failed or regressed", () => {
    expect(attribute("complete", report({ requirements: [{ status: "failed" }] }))).toBe("model");
    expect(attribute("complete", report({ regression: "found" }))).toBe("model");
    expect(attribute("complete", report({ regression: "found (1 inherited failure(s))" }))).toBe(
      "model",
    );
  });

  it("leaves unattributed a run the user, the endpoint, the clock or the environment ended", () => {
    for (const stop of ["cancelled", "interrupted", "model-error", "time-budget", "blocked"]) {
      expect(attribute(stop, report())).toBe("unattributed");
    }
    expect(attribute("complete", report({ state: "blocked" }))).toBe("unattributed");
    expect(attribute("step-budget", report({ state: "blocked" }))).toBe("unattributed");
  });

  it("leaves unattributed a run whose only gap is independent evidence", () => {
    // Stop `incomplete` is the loop's word for exactly that: no edit of the model's can write it.
    expect(attribute("incomplete", report())).toBe("unattributed");
    // Even with a failed requirement beside it: that stop is never read as the model's.
    expect(attribute("incomplete", report({ requirements: [{ status: "failed" }] }))).toBe(
      "unattributed",
    );
  });

  it("leaves unattributed a run that was not verified or whose evidence was not published", () => {
    for (const stop of ["complete", "step-budget", "no-progress"]) {
      expect(attribute(stop, report({ verification: "not run", evidenceDelivery: null }))).toBe(
        "unattributed",
      );
      expect(attribute(stop, report({ evidenceDelivery: "failed" }))).toBe("unattributed");
      expect(attribute(stop, report({ evidenceDelivery: null }))).toBe("unattributed");
    }
    expect(attribute("complete", report({ state: "complete", evidenceDelivery: "failed" }))).toBe(
      "unattributed",
    );
  });

  it("leaves unattributed an escalated run, however it ended", () => {
    const escalated = { resources: { escalations: 1 } };
    expect(attribute("complete", report({ state: "complete", ...escalated }))).toBe("unattributed");
    expect(attribute("no-progress", report(escalated))).toBe("unattributed");
  });

  it("leaves unattributed whatever it cannot place", () => {
    // Marked complete, incomplete, and nothing measured against the change.
    expect(attribute("complete", report())).toBe("unattributed");
    expect(
      attribute("complete", report({ regression: "unresolved (1 inherited failure(s))" })),
    ).toBe("unattributed");
    expect(attribute("a-stop-added-later", report())).toBe("unattributed");
    expect(attribute("complete", report({ state: "a-state-added-later" }))).toBe("unattributed");
  });
});

describe("the record a model builds on this machine", () => {
  it("writes each run under the model's digest, the unattributed ones apart", async () => {
    const home = await mkdtemp(join(tmpdir(), "outcomes-"));
    const record = modelRecord(home);
    await recordOutcome(record, "sha256:abc", "complete", "feature");
    await recordOutcome(record, "sha256:abc", "model", "refactor");
    await recordOutcome(record, "sha256:abc", "model");
    await recordOutcome(record, "sha256:abc", "unattributed", "feature");
    await recordOutcome(record, "sha256:abc", "unattributed");
    const written = JSON.parse(await readFile(profilePath(home), "utf8"));
    expect(written.version).toBe(2);
    // And by the kind of task R1 was, where the run says, which escalation reads.
    expect(written.outcomes["sha256:abc"]).toEqual({
      complete: 1,
      other: 2,
      legacyOther: 0,
      unattributed: 2,
      kinds: {
        feature: { complete: 1, other: 0, unattributed: 1 },
        refactor: { complete: 0, other: 1, unattributed: 0 },
      },
    });
  });

  it("says what a record holds beside the counts it is ranked by", () => {
    expect(describeRecord(undefined)).toBe("no finished tasks recorded here yet");
    expect(describeRecord({ complete: 12, other: 2 })).toBe("12 of 14 finished tasks complete");
    expect(recordNotes({ complete: 12, other: 2, legacyOther: 0, unattributed: 0 })).toEqual([]);
    expect(describeRecord({ complete: 12, other: 2, legacyOther: 2, unattributed: 1 })).toBe(
      "12 of 14 finished tasks complete; 1 run here ended for reasons not attributed to the model and is not counted; 2 of its unfinished tasks were recorded before runs were attributed and still count",
    );
  });
});
