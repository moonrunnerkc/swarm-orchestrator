import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bash, fixture, scripted, write } from "./test-doubles.ts";

/** The purposes of the harness's own check runs, in order, read from the session's ledger. */
async function harnessCheckPurposes(session: string): Promise<string[]> {
  const lines = (await readFile(join(session, "ledger.jsonl"), "utf8")).split("\n");
  const purposes: string[] = [];
  for (const line of lines.filter((one) => one.length > 0)) {
    const entry = JSON.parse(line) as { type: string; payloadDigest: string };
    if (entry.type !== "tool-call") continue;
    const blob = join(session, "blobs", `${entry.payloadDigest.split(":")[1]}.json`);
    const payload = JSON.parse(await readFile(blob, "utf8")) as Record<string, unknown>;
    if (payload.tool === "harness-check" && payload.decision === "requested")
      purposes.push(String(payload.purpose));
  }
  return purposes;
}

const moduleTest = (name: string, call: string, value: number) =>
  `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { ${name} } from "../${name}.mjs";\ntest("${name} holds", () => assert.equal(${call}, ${value}));\n`;

// A repository shaped like tracemantle's: several modules, each with its own test file.
const modules = {
  "twice.mjs": "export const twice = (n) => n * 2;\n",
  "test/twice.test.mjs": moduleTest("twice", "twice(3)", 6),
  "third.mjs": "export const third = (n) => n / 3;\n",
  "test/third.test.mjs": moduleTest("third", "third(9)", 3),
  "square.mjs": "export const square = (n) => n * n;\n",
  "test/square.test.mjs": moduleTest("square", "square(3)", 9),
};

describe("the declared suite runs whole only where a completion is at stake", () => {
  // t6 and depose (17.0.0 sealed set): once R1's checks held, the whole suite ran after every
  // turn that changed the tree, and their wall time rose most. Here the per-turn regression is
  // the tests the change reaches; the whole suite runs at the base and at the first completion.
  it("runs the whole suite at most twice over a 20-turn run", async () => {
    const breakTwice = bash(
      [
        "cat > half.mjs <<'EOF'\nexport const half = (n) => n / 2;\nEOF",
        "cat > twice.mjs <<'EOF'\nexport const twice = (n) => n * 3;\nEOF",
      ].join("\n"),
    );
    const notes = Array.from({ length: 18 }, (_, at) => bash(`echo '// note ${at}' >> third.mjs`));
    const mendTwice = write("twice.mjs", "export const twice = (n) => n * 2;");
    const model = scripted([breakTwice, ...notes, mendTwice]);
    const ran = await (await fixture(modules)).run(model, { maxSteps: 25 });

    expect(ran.report.state).toBe("complete");
    expect(ran.report.resources.steps).toBe(20);
    const purposes = await harnessCheckPurposes(ran.sessionDirectory);
    const whole = purposes.filter((one) => /^(base|suite): /.test(one));
    expect(whole.length).toBeLessThanOrEqual(2);
    // The regression the first change made is still read the next turn, from the tests it reaches.
    expect(model.seen[1]?.at(-1)?.content).toMatch(/newly failing: test\/twice\.test\.mjs/);
    expect(ran.report.resources.suiteRuns).toBe(whole.length);
  });

  // t6 (Arm B, 2026-11-06), and the 17.0.0 report's open item 8: R1's claims held, the change broke
  // tests that passed at the base, and the stop said only that 3 turns changed nothing.
  it("names the regression where a stop leaves every requirement passing", async () => {
    const breakTwice = bash(
      [
        "cat > half.mjs <<'EOF'\nexport const half = (n) => n / 2;\nEOF",
        "cat > twice.mjs <<'EOF'\nexport const twice = (n) => n * 3;\nEOF",
      ].join("\n"),
    );
    const model = scripted([breakTwice, bash("cat twice.mjs"), bash("ls"), bash("pwd")]);
    const ran = await (await fixture(modules)).run(model, { maxSteps: 25 });
    expect(ran.stop).toBe("no-progress");
    expect(ran.report.reason).toBe(
      "3 turns changed neither the tree nor any check's result; every requirement's checks pass, and the change breaks tests that passed at the base: test/twice.test.mjs::twice holds",
    );
    // The nudge before it says the same.
    expect(model.seen[3]?.at(-1)?.content).toContain(
      "The change breaks tests that passed at the base: test/twice.test.mjs::twice holds.",
    );
  });
});
