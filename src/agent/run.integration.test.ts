import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ModelClient } from "./model.ts";
import { completionMarker, systemPrompt } from "./prompt.ts";
import {
  bash,
  fixture,
  noAuthoredCheck,
  recordAndComplete,
  scripted,
  write,
} from "./test-doubles.ts";

const fix = write("half.mjs", "export const half = (n) => n / 2;");
/** A change that is not the fix: the run goes on past it. */
const _wip = write("NOTES.md", "half: work in progress");
const mapped = recordAndComplete([
  { id: "R1", text: "x", kind: "fix", evidence: { tests: [{ name: "half" }] } },
]);

async function ledger(
  session: string,
): Promise<{ type: string; payload: Record<string, unknown> }[]> {
  const lines = (await readFile(join(session, "ledger.jsonl"), "utf8")).trim().split("\n");
  return Promise.all(
    lines.map(async (line) => {
      const record = JSON.parse(line);
      const digest = record.payloadDigest.replace("sha256:", "");
      const payload = JSON.parse(await readFile(join(session, "blobs", `${digest}.json`), "utf8"));
      return { type: record.type, payload };
    }),
  );
}

describe("swarm run", () => {
  it("verifies as soon as the harness's checks pass, without waiting for the model to ask", async () => {
    const probe = await fixture();
    const ran = await probe.run(scripted([fix, bash("echo never sent")]));
    expect(ran).toMatchObject({
      stop: "complete",
      report: { state: "complete", verification: "reused" },
    });
    // The check author's one turn is in the totals, apart from the loop's steps.
    expect(ran.report.resources).toMatchObject({
      steps: 1,
      author: { turns: 1, inputTokens: 90, outputTokens: 10 },
      verifications: 1,
      inputTokens: 180,
      outputTokens: 20,
      estimatedTurns: 0,
      escalations: 0,
    });
  });

  it("hands the failing checks back after a change, and answers a completion over them with them", async () => {
    const probe = await fixture();
    const model = scripted([write("half.mjs", "export const half = (n) => n * 2;"), mapped, fix]);
    const ran = await probe.run(model);
    expect(ran).toMatchObject({
      stop: "complete",
      report: { resources: { steps: 3, verifications: 1 } },
    });
    const afterChange = model.seen[1]?.at(-1)?.content ?? "";
    expect(afterChange).toContain("Checks the harness ran on the tree after your last change:");
    expect(afterChange).toMatch(/- R1: failing \[evidence [0-9a-f]{16}\]/);
    expect(afterChange).toContain("AssertionError");
    // What the authored test printed, never its source.
    expect(afterChange).not.toContain('import { half } from "../half.mjs"');
    const answered = model.seen[2]?.at(-1)?.content ?? "";
    expect(answered).toContain("Not verified: the harness's checks of this tree still fail.");
  });

  it("acts on a reply form a server's reasoning parser moved out of the content", async () => {
    // Rapid-MLX with thinking off moves everything before a stray </think> into
    // reasoning_content (seen on dossier, 2026-11-01).
    const probe = await fixture();
    const model = scripted([{ content: "I'll look.", reasoning: bash("cat half.mjs") }, fix]);
    const ran = await probe.run(model);
    expect(ran.stop).toBe("complete");
    expect(model.seen[1]?.find((message) => message.role === "assistant")?.content).toContain(
      "cat half.mjs",
    );
    const call = (await ledger(ran.sessionDirectory)).find(
      (record) => record.type === "model-call" && !("author" in record.payload),
    );
    expect(call?.payload).toMatchObject({
      reasoning: bash("cat half.mjs"),
      replyFromReasoning: true,
    });
  });

  it("lets an existing expectation change only when the user authorized a behavior change", async () => {
    const roundsDown = (name: string) =>
      `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { half } from "../half.mjs";\ntest("${name}", () => assert.equal(half(5), ${name === "half" ? "2.5" : "2"}));\n`;
    const files = {
      "half.mjs": "export const half = (n) => n / 2;\n",
      "test/half.test.mjs": roundsDown("half"),
    };
    const task = "Make half(n) round down, so half(5) is 2.";
    const replies = [
      write("half.mjs", "export const half = (n) => Math.floor(n / 2);"),
      write("test/half.test.mjs", roundsDown("half").replace("2.5", "2")),
      mapped,
    ];
    const refused = await (await fixture(files, task)).run(scripted(replies), { maxSteps: 3 });
    expect(refused.report.state).not.toBe("complete");
    const allowed = await (await fixture(files, task)).run(scripted(replies), {
      maxSteps: 3,
      behaviorChange: "authorized",
    });
    expect(allowed.report.state).toBe("complete");
    expect(allowed.result?.checks[0]?.tests?.superseded).toEqual(["test/half.test.mjs::half"]);
    expect(allowed.report.notes).toContain(
      "The user authorized a change of tested behavior (--authorize-behavior-change); expectations it superseded: test/half.test.mjs::half.",
    );
  });

  it("keeps scratch files under .swarm/scratch out of the delivered patch, as the prompt says", async () => {
    const scratch = bash("mkdir -p .swarm/scratch && echo 'print(1)' > .swarm/scratch/patch.py");
    const ran = await (await fixture()).run(scripted([scratch, fix, mapped]));
    expect(ran.report.state).toBe("complete");
    const delivered = await readFile(ran.report.snapshot.patch, "utf8");
    expect(delivered).toContain("half.mjs");
    expect(delivered).not.toContain("patch.py");
    expect(systemPrompt).toContain(".swarm/scratch/");
  });

  it("answers a completion repeated on an unchanged tree with the findings, once, without verifying again", async () => {
    const unmapped = recordAndComplete([
      { id: "R1", text: "x", kind: "fix", evidence: { tests: [{ name: "no such test" }] } },
    ]);
    // No authored check: completion is the model's to ask for, and the verifier answers it.
    const model = scripted([fix, unmapped, completionMarker, mapped], {
      author: [noAuthoredCheck],
    });
    const ran = await (await fixture()).run(model);
    expect(ran.stop).toBe("complete");
    // The repeat on the same tree and record reused the held result rather than verifying again.
    expect(ran.report.resources.verifications).toBe(2);
    const nudge = model.seen[3]?.at(-1)?.content ?? "";
    expect(nudge).toContain("Marking the task complete again changes nothing");
    expect(nudge).toContain("R1 unverified");
  });

  it("stops a blocked run with the verifier's reason, not just its state", async () => {
    const ran = await (await fixture({ "swarm.toml": "[checks]\n" })).run(scripted([fix, mapped]));
    expect(ran.stop).toBe("blocked");
    expect(ran.report.reason).toBe(
      "no checks are declared in swarm.toml or the project's manifests",
    );
  });

  it("lists the files the delivered patch changes, naming any it deletes", async () => {
    const probe = await fixture({ "NOTES.md": "release notes\n" });
    const ran = await probe.run(scripted([bash("rm NOTES.md"), fix, mapped]));
    expect(ran.report.changed).toEqual([
      { path: "NOTES.md", status: "deleted" },
      { path: "half.mjs", status: "modified" },
    ]);
    const markdown = await readFile(join(ran.sessionDirectory, "final", "report.md"), "utf8");
    expect(markdown).toContain("- Changed: half.mjs (modified); NOTES.md (deleted).");
  });

  it("never renders a pass from the model's own say-so", async () => {
    const probe = await fixture();
    const ran = await probe.run(scripted([`It is fixed and all tests pass.\n${completionMarker}`]));
    expect(ran.report.state).not.toBe("complete");
  });

  it("finalizes on the step and token budgets", async () => {
    // Distinct commands, so neither run reads as a cycle of the same command.
    const exploring = Array.from({ length: 30 }, (_, at) => `\`\`\`bash\necho ${at}\n\`\`\``);
    const steps = await (await fixture()).run(scripted(exploring), { maxSteps: 3 });
    expect(steps).toMatchObject({
      stop: "step-budget",
      report: { verification: "fresh", resources: { steps: 3 } },
    });
    const tokens = await (await fixture()).run(scripted(exploring), {
      maxSteps: 30,
      maxTokens: 3000,
      turnTokens: 1000,
    });
    expect(tokens).toMatchObject({ stop: "token-budget", report: { verification: "fresh" } });
    // No turn began that the allowance could not pay for, the check author's call included.
    const spent = tokens.report.resources.inputTokens + tokens.report.resources.outputTokens;
    expect(spent).toBeLessThanOrEqual(3000);
    expect(tokens.report.resources.steps).toBeGreaterThan(0);
  });

  it("stops before a turn that would eat the time reserved for final verification, then verifies", async () => {
    const probe = await fixture();
    const ran = await probe.run(scripted([fix]), { maxWallMs: 60_000 });
    expect(ran.stop).toBe("time-budget");
    expect(ran.report.resources.steps).toBe(0);
    expect(ran.report.verification).toBe("fresh");
  });

  it("says inference time was not reported where the endpoint reported none, never zero", async () => {
    const probe = await fixture();
    const replies = [fix, mapped];
    let turn = 0;
    const silent: ModelClient = {
      model: "silent",
      async complete() {
        turn += 1;
        return {
          content: replies[turn - 1] ?? mapped,
          inputTokens: 9,
          outputTokens: 1,
          inferenceMs: null,
          retries: 0,
          truncated: false,
        };
      },
    };
    const ran = await probe.run(silent);
    expect(ran.report.resources).toMatchObject({ steps: 1, inferenceMs: 0, inferenceTurns: 0 });
    const markdown = await readFile(join(ran.sessionDirectory, "final", "report.md"), "utf8");
    expect(markdown).toContain("inference time not reported by the runtime");
    expect(markdown).not.toContain("0 s of inference");
  });

  it("loads repository instructions into the prompt and digests them into the evidence", async () => {
    const probe = await fixture({ "AGENTS.md": "Write tests with node:test.\n" });
    const model = scripted([fix, mapped]);
    const ran = await probe.run(model);
    expect(model.seen[0]?.[0]?.content).toContain(
      "--- AGENTS.md (applies to the whole repository) ---",
    );
    expect(ran.report.instructions).toEqual([
      { path: "AGENTS.md", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ]);
    const started = (await ledger(ran.sessionDirectory)).find(
      (one) => one.type === "session-started",
    );
    expect(started?.payload.instructions).toEqual(ran.report.instructions);
  });

  it("says so when a command and its output repeat the last turn's", async () => {
    const model = scripted(["```bash\nls\n```"]);
    await (await fixture()).run(model, { maxSteps: 3 });
    expect(model.seen[1]?.at(-1)?.content).not.toContain("command you ran last turn");
    expect(model.seen[2]?.at(-1)?.content).toContain("This is the command you ran last turn");
  });

  it("keeps the token count in the evidence instead of redacting it", async () => {
    const ran = await (await fixture()).run(scripted(["```bash\nls\n```"]), { maxSteps: 2 });
    const stopped = (await ledger(ran.sessionDirectory)).find(
      (one) => one.type === "model-call" && !("author" in one.payload),
    );
    expect(stopped?.payload).toMatchObject({ inputTokens: 90, outputTokens: 10, estimated: false });
  });
});
