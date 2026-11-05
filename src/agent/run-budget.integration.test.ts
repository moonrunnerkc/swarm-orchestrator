import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { authorPrompt } from "./author-prompt.ts";
import {
  bash,
  fixture,
  noAuthoredCheck,
  recordAndComplete,
  scripted,
  write,
} from "./test-doubles.ts";

const fix = write("half.mjs", "export const half = (n) => n / 2;");
const mapped = recordAndComplete([
  { id: "R1", text: "x", kind: "fix", evidence: { tests: [{ name: "half" }] } },
]);

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
        // The loop's turns are slow; the check author's call before them is not what this tests.
        if (args[0][0]?.content !== authorPrompt)
          await new Promise((wait) => setTimeout(wait, 1_500));
        return quick.complete(...args);
      },
    };
    // 120 s of the wall are the verification reserve; 3.5 s remain, after the authored check's
    // run at the base, for 1.5 s turns.
    const ran = await (await fixture()).run(slow, { maxSteps: 3, maxWallMs: 123_500 });
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
    // No authored check, so the model's completion reaches the verifier and its findings stay open.
    const model = scripted([fix, unmapped, bash("ls"), bash("ls"), bash("ls")], {
      author: [noAuthoredCheck],
    });
    await (await fixture()).run(model, { maxSteps: 6 });
    const said = model.seen.map((turn) => turn.at(-1)?.content ?? "");
    expect(said[3]).not.toContain("The verifier's findings are still open");
    expect(said[4]).toContain("This is the command you ran last turn");
    expect(said[4]).toContain("The verifier's findings are still open");
    expect(said[4]).toContain("R1 unverified");
  });
});

describe("a run's token accounting", () => {
  it("writes each turn's counts to report.json, saying which the runtime reported", async () => {
    const turnsOf = async (counts: "reported" | "unreported") => {
      const ran = await (await fixture()).run(scripted([fix, mapped], { counts }));
      const written = await readFile(join(dirname(ran.reportPath), "report.json"), "utf8");
      return { ran, turns: JSON.parse(written).resources.turns };
    };
    const reported = await turnsOf("reported");
    const counts = { inputTokens: 90, outputTokens: 10 };
    const both = { inputCount: "reported", outputCount: "reported" };
    // The fix is the loop's one turn: the harness's checks pass and it verifies.
    expect(reported.turns).toEqual([{ ...counts, ...both }]);
    const unreported = await turnsOf("unreported");
    expect(unreported.turns).toHaveLength(1);
    for (const turn of unreported.turns) {
      expect(turn).toMatchObject({ inputCount: "estimated", outputCount: "estimated" });
    }
    const sum = unreported.turns.reduce(
      (total: number, turn: { inputTokens: number }) => total + turn.inputTokens,
      0,
    );
    // The loop's turns, and the check author's call before them.
    const { author } = unreported.ran.report.resources;
    expect(unreported.ran.report.resources.inputTokens).toBe(sum + author.inputTokens);
  });
});
