import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixture, recordAndComplete, scripted, write } from "./test-doubles.ts";

const mapped = recordAndComplete([
  { id: "R1", text: "x", kind: "fix", evidence: { tests: [{ name: "half" }] } },
]);

describe("swarm run with one fresh-context review", () => {
  const task = "Make half(n) return n / 2, rounded down.";
  const exact = write("half.mjs", "export const half = (n) => n / 2;");
  const floor = write("half.mjs", "export const half = (n) => Math.floor(n / 2);");
  const challenge =
    "half(5) should be 2.\n```bash\nnode -e \"import('./half.mjs').then((m) => process.exit(m.half(5) === 2 ? 0 : 1))\"\n```";

  it("is not asked for unless the run asks for it", async () => {
    // The harness verifies once its checks pass, so the fix is the run's only turn.
    const model = scripted([exact, mapped]);
    const ran = await (await fixture({}, task)).run(model);
    expect(ran.report.review).toBeNull();
    expect(model.seen).toHaveLength(1);
  });

  it("counts a review that finds nothing and changes nothing", async () => {
    const ran = await (await fixture({}, task)).run(scripted([exact, "NO_FINDING"]), {
      review: true,
    });
    expect(ran.report).toMatchObject({
      state: "complete",
      review: { outcome: "no-finding" },
      resources: { steps: 2 },
    });
  });

  it("reopens the work on a finding its own check confirms, and the verifier still decides", async () => {
    const model = scripted([exact, challenge, floor]);
    const ran = await (await fixture({}, task)).run(model, { review: true });
    expect(ran.report.review).toMatchObject({ outcome: "confirmed", exitCode: 1 });
    expect(model.seen[2]?.[1]?.content).toContain("half(5) should be 2.");
    expect(ran.report.state).toBe("complete");
    expect(ran.report.resources.escalations).toBe(0);
    const markdown = await readFile(join(ran.sessionDirectory, "final", "report.md"), "utf8");
    expect(markdown).toContain(
      "- Review: a finding its own check confirmed, which reopened the work",
    );
  });

  it("tells the reviewer the machine its check runs on, without the advice on editing files", async () => {
    const model = scripted([exact, "NO_FINDING"]);
    await (await fixture({}, task)).run(model, { review: true });
    const coding = model.seen[0]?.[0]?.content ?? "";
    const reviewer = model.seen[1]?.[0]?.content ?? "";
    const sed = coding.split("\n").find((line) => line.startsWith("- sed: "));
    expect(sed).toBeDefined();
    expect(reviewer).toContain("This machine, probed when the run started.");
    expect(reviewer).toContain(sed);
    expect(reviewer).not.toContain("edit or write block");
  });

  it("puts the tree back when a review's command writes to it", async () => {
    const writes =
      "It breaks.\n```bash\necho 'export const half = () => 0;' > half.mjs; exit 1\n```";
    const probe = await fixture({}, task);
    // After the review reopens the work the model marks the unchanged tree complete again.
    const ran = await probe.run(scripted([floor, writes, mapped]), { review: true });
    expect(ran.report.review).toMatchObject({ outcome: "confirmed", restored: true });
    expect(ran.report.state).toBe("complete");
    const delivered = await readFile(ran.report.snapshot.patch, "utf8");
    expect(delivered).toContain("Math.floor(n / 2)");
    expect(delivered).not.toContain("() => 0");
  });
});
