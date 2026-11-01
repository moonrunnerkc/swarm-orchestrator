import { describe, expect, it } from "vitest";
import { bash, fixture, scripted } from "./test-doubles.ts";

describe("a run's turn budget", () => {
  it("tells the model once, near the end, that its turns are running out", async () => {
    const model = scripted(["ls", "pwd", "ls -a", "git status", "git log -1"].map(bash));
    await (await fixture()).run(model, { maxSteps: 5 });
    const said = model.seen.map((turn) => turn.at(-1)?.content ?? "");
    expect(said.filter((one) => one.includes("turn remains"))).toHaveLength(1);
    expect(said[4]).toContain("1 turn remains of 5");
  });

  it("tells it once when the time runs short first, as it does on a slow model", async () => {
    const model = scripted(["ls", "pwd", "ls -a"].map(bash));
    // 120 s of the 140 are reserved for final verification, so 20 s remain for turns.
    await (await fixture()).run(model, { maxSteps: 3, maxWallMs: 140_000 });
    const said = model.seen.map((turn) => turn.at(-1)?.content ?? "");
    expect(said[0]).toMatch(/About \d+ minutes? remains? for turns/);
    expect(said.filter((one) => one.includes("for turns, with final verification"))).toHaveLength(
      1,
    );
  });
});
