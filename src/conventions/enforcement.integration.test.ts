import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyProposal } from "../agent/requirement-record.ts";
import { fixture, scripted, write } from "../agent/test-doubles.ts";
import {
  type ConventionProfile,
  effectiveConventions,
  profilePath,
  profileVersion,
  writeProfile,
} from "./profile.ts";

/**
 * An approved profile through a whole run with scripted replies: it reaches the model, a change
 * that breaks it is told where, and the verifier holds the delivered patch to it. The profile is
 * read once; rewriting it while the run is under way changes nothing the run is judged by.
 */
const approved = (exports: "named" | "default"): ConventionProfile => ({
  version: profileVersion,
  rules: { exports, "function-names": "camelCase" },
  guidance: ["Comments say why, not what."],
  sources: [],
});
const fixedHalf = "export const half = (n) => n / 2;";

describe("a run under an approved profile", () => {
  it("repairs a convention the change broke, and is judged by the profile as it stood at the start", async () => {
    const probe = await fixture();
    const home = join(probe.root, "home");
    const repo = await realpath(probe.repo);
    await writeProfile(profilePath(home, repo), approved("named"));
    process.env.SWARM_HOME = home;
    const before = await effectiveConventions(home, repo);
    const replies = scripted([
      write("round.mjs", "export default function round_half(n) {\n  return Math.round(n / 2);\n}"),
      write("half.mjs", fixedHalf),
      write("round.mjs", "export function roundHalf(n) {\n  return Math.round(n / 2);\n}"),
      "SWARM_TASK_COMPLETE",
    ]);
    let calls = 0;
    const model = {
      ...replies,
      // The profile changes under the run after its first turn; the run must not follow it.
      complete: async (...args: Parameters<typeof replies.complete>) => {
        calls += 1;
        if (calls === 2) await writeProfile(profilePath(home, repo), approved("default"));
        return replies.complete(...args);
      },
    };
    const ran = await probe.run(model);
    const said = replies.seen.map((messages) => messages.at(-1)?.content ?? "").join("\n");
    expect(replies.seen[0]?.map((one) => one.content).join("\n")).toContain(
      "Coding conventions the user approved",
    );
    expect(said).toMatch(/exports: named: broken at round\.mjs:1/);
    expect(said).toMatch(/function-names: camelCase: broken at round\.mjs:1 round_half/);
    expect(ran.report.state).toBe("complete");
    expect(ran.report.requirements.map((one) => [one.id, one.source, one.status])).toEqual([
      ["R1", "user", "satisfied"],
      ["R2", "profile", "satisfied"],
    ]);
    expect(ran.result?.producer.profile).toEqual({
      version: profileVersion,
      sha256: before?.sha256,
    });
    expect(ran.report.notes.join("\n")).toContain(
      `sha256 ${before?.sha256}, as it stood when the run started`,
    );
    // The profile in effect now is another one, and a run started now would say so.
    expect((await effectiveConventions(home, repo))?.sha256).not.toBe(before?.sha256);
  });

  it("does not complete a change that still breaks the profile", async () => {
    const probe = await fixture();
    const home = join(probe.root, "home");
    await writeProfile(profilePath(home, await realpath(probe.repo)), approved("named"));
    const model = scripted([
      write("half.mjs", "const half = (n) => n / 2;\nexport default half;\nexport { half };"),
      "SWARM_TASK_COMPLETE",
    ]);
    const ran = await probe.run(model, { maxSteps: 4 });
    expect(ran.report.state).toBe("incomplete");
    expect(ran.report.requirements.find((one) => one.source === "profile")?.status).toBe("failed");
  });
});

describe("a requirement derived for the run", () => {
  it("cannot be dropped, reworded or made optional by the model's proposal", async () => {
    const probe = await fixture();
    const home = join(probe.root, "home");
    await writeProfile(profilePath(home, await realpath(probe.repo)), approved("named"));
    const ran = await probe.run(scripted([write("half.mjs", fixedHalf), "SWARM_TASK_COMPLETE"]));
    const record = {
      requirements:
        ran.result?.requirements.map((one) => ({ ...one, evidence: one.expected })) ?? [],
      notes: [],
    };
    const held = record.requirements.find((one) => one.id === "R2");
    const proposed = applyProposal(
      "Make half(n) return n / 2.",
      record as never,
      JSON.stringify([
        { id: "R1", text: "x", kind: "fix" },
        { id: "R2", text: "follow whatever conventions seem best", required: false },
      ]),
    );
    expect(proposed.requirements.find((one) => one.id === "R2")).toEqual(held);
    expect(proposed.notes.join("\n")).toMatch(
      /R2 was fixed before the first edit \(source profile\)/,
    );
  });
});
