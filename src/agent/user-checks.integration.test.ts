import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CheckReviewer } from "./check-gate.ts";
import { readSupplied } from "./supplied.ts";
import { authoredHalf, bash, fixture, scripted, write } from "./test-doubles.ts";

const fix = write("half.mjs", "export const half = (n) => n / 2;");
const acceptance = (expected: string) =>
  `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { half } from "../half.mjs";\ntest("the user's case", () => assert.equal(${expected}));\n`;
// A base whose own test already passes: no failing test a change could make pass.
const passingBase = {
  "test/half.test.mjs": acceptance("half(0), 0").replace("the user's case", "zero"),
};

describe("the user supplies the oracle", () => {
  it("seals a supplied check outside the candidate, where the model reads only its results", async () => {
    const probe = await fixture(passingBase);
    await probe.put("test/half.accept.test.mjs", acceptance("half(10), 5"));
    const supplied = await readSupplied({
      repository: probe.repo,
      cwd: probe.repo,
      files: ["test/half.accept.test.mjs"],
      commands: [],
    });
    const model = scripted([bash("cat test/half.accept.test.mjs"), fix]);
    const ran = await probe.run(model, { supplied });

    expect(ran.report.state).toBe("complete");
    // The author never ran: the user's check is R1's witness.
    expect(model.authorSeen).toHaveLength(0);
    const r1 = ran.result?.requirements.find((one) => one.id === "R1");
    expect(r1).toMatchObject({ status: "satisfied", witness: "independent" });
    expect(r1?.evidence.some((one) => one.authority === "user-acceptance")).toBe(true);
    // Its source never reached the model; its path is answered with what it is.
    const shown = model.seen
      .flat()
      .map((message) => message.content)
      .join("\n");
    expect(shown).not.toContain("the user's case");
    expect(shown).toContain("is the independent check written apart from your change");
    expect(ran.report.accepted).toEqual([
      { name: "accept-R1-1", requirement: "R1", runs: "test/half.accept.test.mjs" },
    ]);
    // The user's own file is left where they had it.
    expect(await readFile(join(probe.repo, "test/half.accept.test.mjs"), "utf8")).toContain(
      "the user's case",
    );
  });

  it("refuses a supplied check that passes at the base, saying why and how to keep it", async () => {
    const probe = await fixture(passingBase);
    const supplied = [
      {
        kind: "file" as const,
        requirement: "R1",
        path: "test/half.accept.test.mjs",
        content: acceptance("half(0), 0"),
      },
    ];
    const model = scripted([fix]);
    const ran = await probe.run(model, { supplied });
    expect(ran.report.state).toBe("blocked");
    expect(ran.report.resources.steps).toBe(0);
    expect(ran.report.reason).toBe(
      "your checks were refused: R1=test/half.accept.test.mjs: it passes at the base, so it cannot show the change; a check that should keep passing is --accept keep=test/half.accept.test.mjs",
    );
  });

  it("runs a command the user supplies, and a kept check as a regression witness", async () => {
    const probe = await fixture(passingBase);
    const supplied = [
      {
        kind: "command" as const,
        requirement: "R1",
        command:
          "node -e \"import('./half.mjs').then((m) => process.exit(m.half(8) === 4 ? 0 : 1))\"",
      },
      { kind: "command" as const, requirement: null, command: "node --test test/half.test.mjs" },
    ];
    const ran = await probe.run(scripted([fix]), { supplied });
    expect(ran.report.state).toBe("complete");
    expect(ran.report.accepted?.map((one) => one.requirement)).toEqual(["R1", null]);
    const r1 = ran.result?.requirements.find((one) => one.id === "R1");
    expect(r1?.evidence).toContainEqual(
      expect.objectContaining({ kind: "check", ref: "accept-R1-1", authority: "user-acceptance" }),
    );
  });
});

describe("authored checks are shown, written out, or used as written", () => {
  it("makes an approved authored check the user's own", async () => {
    const probe = await fixture(passingBase);
    const shown: string[] = [];
    const reviewer: CheckReviewer = async (one) => {
      shown.push(one.content);
      return "approve";
    };
    const ran = await probe.run(scripted([fix], { author: [authoredHalf] }), {
      checksMode: { kind: "review", reviewer },
    });
    expect(shown[0]).toContain("half(4) is 2, written apart");
    expect(ran.report.state).toBe("complete");
    expect(ran.report.accepted?.[0]).toMatchObject({ name: "reviewed-R1-1", requirement: "R1" });
  });

  it("runs an edited check at the base again, and shows it again where the edit is refused", async () => {
    const probe = await fixture(passingBase);
    const problems: (string | null)[] = [];
    const reviewer: CheckReviewer = async (one) => {
      problems.push(one.problem);
      if (problems.length > 1) return "reject";
      await writeFile(one.file, acceptance("half(0), 0"));
      return "edit";
    };
    const ran = await probe.run(scripted([fix], { author: [authoredHalf] }), {
      checksMode: { kind: "review", reviewer },
    });
    expect(problems[0]).toBeNull();
    expect(problems[1]).toMatch(/it passes at the base, so it cannot show the change/);
    expect(ran.report.accepted).toEqual([]);
  });

  it("writes the authored checks out and stops, naming the command that supplies them back", async () => {
    const probe = await fixture(passingBase);
    const directory = join(probe.root, "checks");
    const ran = await probe.run(scripted([fix], { author: [authoredHalf] }), {
      checksMode: { kind: "write", directory },
    });
    expect(ran.report.state).toBe("blocked");
    expect(ran.report.resources.steps).toBe(0);
    expect(ran.report.reason).toContain(`--accept ${directory}`);
    const written = await readFile(join(directory, "test/half.swarm-r1.test.mjs"), "utf8");
    expect(written).toContain("half(4) is 2, written apart");
    // Supplied back, it is the user's: laid at its path under the directory.
    const back = await readSupplied({
      repository: probe.repo,
      cwd: probe.root,
      files: [directory],
      commands: [],
    });
    expect(back).toEqual([
      { kind: "file", requirement: "R1", path: "test/half.swarm-r1.test.mjs", content: written },
    ]);
  });
});
