import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { completionMarker } from "./prompt.ts";
import { fixture, scripted, write } from "./test-doubles.ts";

/**
 * The agent-side probes of the 2026-10-31 review (docs/plans/2026-10-31-product-recovery.md,
 * section 3 and Appendix A), held to the behavior it requires: a run whose model claims
 * completion without the change is not complete, a correct edit on the last step is judged,
 * and the report never carries a verdict on a tree other than the one delivered.
 */
const statementOf = async (attestation: string | null) =>
  JSON.parse(await readFile(join(attestation ?? "", "..", "statement.json"), "utf8"));

describe("the review's agent probes", () => {
  it("does not complete a task whose model declares completion without making the change", async () => {
    const probe = await fixture({}, "Add an exported double(n) function returning n * 2.");
    const ran = await probe.run(scripted([completionMarker]));
    expect(ran.report.state).toBe("incomplete");
    expect(ran.report.requirements).toMatchObject([
      { id: "R1", status: "unverified", limitation: "no change observed" },
    ]);
    expect(ran.stop).toBe("no-progress");
  });

  it("judges a correct edit made on the last allowed step", async () => {
    const probe = await fixture();
    const ran = await probe.run(
      scripted([write("half.mjs", "export const half = (n) => n / 2;")]),
      { maxSteps: 1 },
    );
    expect(ran.stop).toBe("step-budget");
    expect(ran.report.verification).toBe("fresh");
    expect(ran.result?.regression.status).toBe("none");
    expect(ran.result?.checks[0]?.tests?.fixed).toEqual(["test/half.test.mjs::half"]);
    const statement = await statementOf(ran.report.attestation);
    const patch = statement.subject.find((one: { name: string }) => one.name === "change.patch");
    expect(patch.digest.sha256).toBe(ran.report.snapshot.patchSha256);
  });

  it("verifies the delivered tree again when an edit followed the last verification", async () => {
    const probe = await fixture();
    const ran = await probe.run(
      scripted([completionMarker, write("half.mjs", "export const half = (n) => n / 2;")]),
      { maxSteps: 2 },
    );
    expect(ran.stop).toBe("step-budget");
    expect(ran.report.resources.verifications).toBe(1);
    expect(ran.report.verification).toBe("fresh");
    expect(ran.report.notes).toContain(
      "the last verification described an earlier tree or record, so the delivered one was verified again",
    );
    const statement = await statementOf(ran.report.attestation);
    const patch = statement.subject.find((one: { name: string }) => one.name === "change.patch");
    expect(patch.digest.sha256).toBe(ran.report.snapshot.patchSha256);
    expect(statement.predicate.producer.reportSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
