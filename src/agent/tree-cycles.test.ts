import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openEvidenceSession } from "../evidence/session.ts";
import type { Chokepoint } from "../tools/chokepoint.ts";
import { applyReplacements } from "../tools/file-edit.ts";
import { runLoop } from "./loop.ts";
import { initialRecord } from "./requirement-record.ts";
import { bash, scripted } from "./test-doubles.ts";
import { treeCycles } from "./tree-cycles.ts";

const one = 'import { runVitest, type VitestRunOptions } from "./vitest-run.js";';
const two =
  'import { runVitest } from "./vitest-run.js";\nimport type { VitestRunOptions } from "./vitest-run.js";';
const edit = (from: string, to: string) =>
  `\`\`\`edit src/adapters/vitest-run.test.ts\n<<<<<<< SEARCH\n${from}\n=======\n${to}\n>>>>>>> REPLACE\n\`\`\``;

/** claimcheck, session 20261103T222355-8f8758, steps 38 to 41 and on: one import split and joined. */
const split = edit(one, two);
const joined = edit(two, one);

/** A one-file tree the edits apply to, its diff the file's text, so a state is its content. */
function oneFile(): { readonly chokepoint: Chokepoint; readonly diff: () => Promise<string> } {
  let text = `${one}\n\ndescribe("runVitest", () => {});\n`;
  let calls = 0;
  return {
    diff: async () => text,
    chokepoint: {
      async run() {
        calls += 1;
        return { decision: "allowed", output: "", exitCode: 0, record: `sha256:${calls}` };
      },
      async edit(change) {
        calls += 1;
        if (change.mode !== "edit") throw new Error("the recorded run sent edit blocks only");
        const next = applyReplacements(text, change.pairs);
        if ("refused" in next) {
          return {
            decision: "failed",
            output: next.refused,
            exitCode: null,
            record: `sha256:${calls}`,
          };
        }
        text = next.text;
        return { decision: "allowed", output: "edited", exitCode: 0, record: `sha256:${calls}` };
      },
    },
  };
}

async function loopOver(model: ReturnType<typeof scripted>, tree: ReturnType<typeof oneFile>) {
  const root = await mkdtemp(join(tmpdir(), "tree-cycles-"));
  const task = "runVitest should report a suite that fails to load as failedToRun; add a test.";
  return runLoop({
    task,
    model,
    chokepoint: tree.chokepoint,
    evidence: await openEvidenceSession({
      root: join(root, "sessions"),
      sessionId: "s",
      now: Date.now,
    }),
    environment: "",
    instructions: "",
    record: initialRecord(task),
    status: async () => "",
    diff: tree.diff,
    verify: async () => {
      throw new Error("the recorded run did not mark the task complete in these turns");
    },
    maxSteps: 60,
    maxTokens: 100_000_000,
    turnTokens: 1000,
    turnTime: () => ({ leftMs: Number.POSITIVE_INFINITY, wallMs: Number.POSITIVE_INFINITY }),
    contextTokens: 32_768,
    outputs: { directory: join(root, ".swarm", "outputs"), root },
    log: () => {},
  });
}

describe("a working tree that keeps going back to where it was", () => {
  it("stops the recorded split-and-join cycle as no progress instead of running to the budget", async () => {
    const model = scripted(Array.from({ length: 60 }, (_, at) => (at % 2 === 0 ? split : joined)));
    const ran = await loopOver(model, oneFile());
    expect(ran).toMatchObject({
      stop: "no-progress",
      reason: "the working tree went back to a state it had already been in, 3 changes running",
    });
    expect(ran.steps).toBeLessThan(6);
    const warned = model.seen.at(-1)?.at(-1)?.content ?? "";
    expect(warned).toContain("put the working tree back the way it already was");
  });

  it("lets a change be undone once and a new one made", async () => {
    const model = scripted([split, joined, edit(one, `${one}\n// a new line`), bash("ls")]);
    const ran = await loopOver(model, oneFile());
    expect(ran.steps).toBeGreaterThan(4);
    expect(ran.reason).not.toContain("working tree went back");
  });
});

describe("counting returns", () => {
  it("counts only changes, and resets on a state not seen before", () => {
    const read = treeCycles(3);
    expect(
      ["a", "b", "b", "a", "c", "a", "c", "a"].map((diff) => read(diff, null).returns),
    ).toEqual([0, 0, 0, 1, 0, 1, 2, 3]);
  });

  it("joins its warning with another notice", () => {
    const read = treeCycles(3);
    for (const diff of ["a", "b", "a"]) read(diff, null);
    expect(read("b", "10 turns remain").notice).toMatch(/already was[\s\S]*\n\n10 turns remain$/);
  });
});
