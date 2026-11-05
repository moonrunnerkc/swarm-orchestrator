import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ModelClient } from "./model.ts";
import { completionMarker } from "./prompt.ts";
import { bash, fixture, recordAndComplete, scripted, write } from "./test-doubles.ts";

const fix = write("half.mjs", "export const half = (n) => n / 2;");
const mapped = recordAndComplete([
  { id: "R1", text: "x", kind: "fix", evidence: { tests: [{ name: "half" }] } },
]);

describe("the managed workspace", () => {
  it("starts from the user's edits, staged, unstaged and untracked, and leaves them as they were", async () => {
    const probe = await fixture({ "notes.md": "base\n", "other.md": "base\n" });
    await probe.put("notes.md", "staged edit\n");
    probe.git("add", "notes.md");
    await probe.put("other.md", "unstaged edit\n");
    await probe.put("scratch.txt", "untracked\n");
    const ran = await probe.run(
      scripted([bash("cat notes.md other.md scratch.txt"), fix, mapped]),
      { apply: true },
    );
    expect([...ran.report.startingState.edits].sort()).toEqual([
      "notes.md",
      "other.md",
      "scratch.txt",
    ]);
    expect(ran.report.state).toBe("complete");
    expect(ran.report.delivery).toEqual({ applied: true });
    expect(probe.git("diff", "--cached", "--name-only")).toBe("notes.md");
    expect(await readFile(join(probe.repo, "other.md"), "utf8")).toBe("unstaged edit\n");
    expect(await readFile(join(probe.repo, "scratch.txt"), "utf8")).toBe("untracked\n");
    expect(await readFile(join(probe.repo, "half.mjs"), "utf8")).toBe(
      "export const half = (n) => n / 2;\n",
    );
    // The patch holds only the run's own change, against the starting state.
    expect(await readFile(ran.report.snapshot.patch, "utf8")).not.toContain("notes.md");
  });

  it("keeps the patch and says why when the workspace changed during the run", async () => {
    const probe = await fixture();
    let turns = 0;
    const interfering: ModelClient = {
      model: "interfering",
      async complete() {
        turns += 1;
        // The user edits their own tree while the model's one turn is out.
        if (turns === 1)
          await writeFile(join(probe.repo, "half.mjs"), "export const half = (n) => n >> 1;\n");
        return {
          content: turns === 1 ? fix : mapped,
          inputTokens: 1,
          outputTokens: 1,
          inferenceMs: 1,
          retries: 0,
          truncated: false,
        };
      },
    };
    const ran = await probe.run(interfering, { apply: true });
    expect(ran.report.state).toBe("complete");
    expect(ran.report.delivery).toMatchObject({ applied: false });
    expect(ran.report.delivery.applied === false && ran.report.delivery.reason).toMatch(
      /^the workspace changed during the run; apply it yourself with `git apply /,
    );
    expect(await readFile(join(probe.repo, "half.mjs"), "utf8")).toBe(
      "export const half = (n) => n >> 1;\n",
    );
  });

  it("does nothing to the workspace when asked to keep the patch", async () => {
    const probe = await fixture();
    const ran = await probe.run(scripted([fix, mapped]), { apply: false });
    expect(ran.report.delivery).toEqual({ applied: false, reason: "kept as a patch, as asked" });
    expect(await readFile(join(probe.repo, "half.mjs"), "utf8")).toBe(
      "export const half = (n) => n;\n",
    );
  });
});

describe("escalating once to a stronger model", () => {
  it("hands the run over when the first model's replies are unusable, and counts it", async () => {
    const probe = await fixture();
    const weak = scripted(["I would fix half by dividing by two."]);
    const strong = scripted([fix, mapped]);
    const ran = await probe.run(
      { ...weak, model: "weak" },
      { escalation: { ...strong, model: "strong" } },
    );
    expect(ran.stop).toBe("complete");
    expect(ran.report.resources.escalations).toBe(1);
    expect(strong.seen[0]?.at(-1)?.content).toContain(
      "Another model worked on this task before you and stopped (unusable-replies",
    );
  });

  it("does not escalate when the stop says nothing about the model", async () => {
    const probe = await fixture();
    const strong = scripted([fix, mapped]);
    const ran = await probe.run(scripted([completionMarker]), { escalation: strong, maxSteps: 1 });
    expect(ran.stop).toBe("step-budget");
    expect(ran.report.resources.escalations).toBe(0);
    expect(strong.seen).toHaveLength(0);
  });
});
