import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { finishedOutcome, modelRecord, profilePath, recordOutcome } from "./profile.ts";

describe("the record a model builds on this machine", () => {
  it("counts a run the model finished, and not one the environment or the user ended", () => {
    expect(finishedOutcome({ stop: "complete", state: "complete", escalated: false })).toBe(true);
    expect(finishedOutcome({ stop: "step-budget", state: "incomplete", escalated: false })).toBe(
      false,
    );
    expect(finishedOutcome({ stop: "no-progress", state: "incomplete", escalated: false })).toBe(
      false,
    );
    for (const stop of ["cancelled", "interrupted", "model-error"]) {
      expect(finishedOutcome({ stop, state: "incomplete", escalated: false })).toBeNull();
    }
    expect(finishedOutcome({ stop: "complete", state: "blocked", escalated: false })).toBeNull();
    expect(finishedOutcome({ stop: "complete", state: "complete", escalated: true })).toBeNull();
  });

  it("writes each finished run to the profile under the model's digest", async () => {
    const home = await mkdtemp(join(tmpdir(), "profile-"));
    const record = modelRecord(home);
    await recordOutcome(record, "sha256:abc", true, "feature");
    await recordOutcome(record, "sha256:abc", false, "refactor");
    await recordOutcome(record, "sha256:abc", false);
    const written = JSON.parse(await readFile(profilePath(home), "utf8"));
    // And by the kind of task R1 was, where the run says, which escalation reads.
    expect(written.outcomes["sha256:abc"]).toEqual({
      complete: 1,
      other: 2,
      kinds: { feature: { complete: 1, other: 0 }, refactor: { complete: 0, other: 1 } },
    });
  });
});
