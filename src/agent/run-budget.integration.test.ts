import { describe, expect, it } from "vitest";
import { bash, fixture, recordAndComplete, scripted, write } from "./test-doubles.ts";

const fix = write("half.mjs", "export const half = (n) => n / 2;");

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

  // A slow model's turn outlasted the time reserved for final verification, which then never ran.
  it("starts no turn that would run into the time reserved for final verification", async () => {
    const quick = scripted(["ls", "pwd", "ls -a"].map(bash));
    const slow = {
      ...quick,
      async complete(...args: Parameters<typeof quick.complete>) {
        await new Promise((wait) => setTimeout(wait, 1_500));
        return quick.complete(...args);
      },
    };
    // 120 s of the wall are the verification reserve; 2.5 s remain for 1.5 s turns.
    const ran = await (await fixture()).run(slow, { maxSteps: 3, maxWallMs: 122_500 });
    expect(ran.stop).toBe("time-budget");
    expect(ran.report.resources.steps).toBe(1);
    expect(ran.report.verification).toBe("fresh");
  });

  // claimcheck on Rapid-MLX: after one verification left R1 open, the model repeated a status
  // command until the run stopped for no progress, its record never corrected.
  it("points a repeated command back at the verifier's open findings", async () => {
    const unmapped = recordAndComplete([
      { id: "R1", text: "x", kind: "fix", evidence: { tests: [{ name: "no such test" }] } },
    ]);
    const model = scripted([fix, unmapped, bash("ls"), bash("ls"), bash("ls")]);
    await (await fixture()).run(model, { maxSteps: 6 });
    const said = model.seen.map((turn) => turn.at(-1)?.content ?? "");
    expect(said[3]).not.toContain("The verifier's findings are still open");
    expect(said[4]).toContain("This is the command you ran last turn");
    expect(said[4]).toContain("The verifier's findings are still open");
    expect(said[4]).toContain("R1 unverified");
  });

  // At temperature 0 a model that repeats a command gets nearly the same prompt and repeats it
  // again: claimcheck on Rapid-MLX stopped this way after 6 turns.
  it("samples the one turn that would otherwise end the run for no progress", async () => {
    const quick = scripted(["ls", "ls", "pwd"].map(bash));
    const temperatures: (number | undefined)[] = [];
    const model = {
      ...quick,
      async complete(...args: Parameters<typeof quick.complete>) {
        temperatures.push(args[1].temperature);
        return quick.complete(...args);
      },
    };
    const ran = await (await fixture()).run(model, { maxSteps: 3 });
    expect(temperatures).toEqual([undefined, undefined, 0.7]);
    expect(ran.stop).not.toBe("no-progress");
  });
});
