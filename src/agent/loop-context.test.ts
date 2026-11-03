import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openEvidenceSession } from "../evidence/session.ts";
import type { Chokepoint } from "../tools/chokepoint.ts";
import { estimateTokens } from "./context.ts";
import { type LoopOptions, runLoop } from "./loop.ts";
import { initialRecord } from "./requirement-record.ts";
import { bash, scripted } from "./test-doubles.ts";

/** Some 7 KB a command, different every turn, as a file read or a test run prints. */
const printed = (command: string) =>
  Array.from({ length: 120 }, (_, line) => `${command} line ${line}: ${"x".repeat(40)}`).join("\n");

/** Every command prints its 7 KB; `npm test` fails, saying which module, as a test run would. */
const sizeable: Chokepoint = {
  async run(command) {
    const failing = command.startsWith("npm test");
    const output = failing ? `${printed(command)}\nFAIL src/module-3.ts` : printed(command);
    const digest = createHash("sha256").update(command).update(output).digest("hex");
    return {
      decision: "allowed",
      output,
      exitCode: failing ? 1 : 0,
      record: `sha256:${digest}`,
    };
  },
};

/** The least-squares slope of a series against its index: tokens added per turn. */
function slopeOf(series: readonly number[]): number {
  const n = series.length;
  const meanX = (n - 1) / 2;
  const meanY = series.reduce((sum, y) => sum + y, 0) / n;
  let covariance = 0;
  let variance = 0;
  series.forEach((y, x) => {
    covariance += (x - meanX) * (y - meanY);
    variance += (x - meanX) ** 2;
  });
  return covariance / variance;
}

async function loopOptions(model: LoopOptions["model"], contextTokens: number) {
  const root = await mkdtemp(join(tmpdir(), "loop-context-"));
  await mkdir(join(root, "src"));
  for (const at of [0, 1, 2, 3]) await writeFile(join(root, "src", `module-${at}.ts`), "");
  const task = "Move the history modules into a package and keep every caller working.";
  return {
    task,
    model,
    chokepoint: sizeable,
    evidence: await openEvidenceSession({
      root: join(root, "sessions"),
      sessionId: "s",
      now: Date.now,
    }),
    instructions: "",
    record: initialRecord(task),
    status: async () => "",
    diff: async () => "",
    verify: async () => {
      throw new Error("no completion is scripted, so nothing is verified");
    },
    maxSteps: 40,
    maxTokens: 100_000_000,
    turnTokens: 1000,
    turnTime: () => ({ leftMs: Number.POSITIVE_INFINITY, wallMs: Number.POSITIVE_INFINITY }),
    contextTokens,
    outputs: { directory: join(root, ".swarm", "outputs"), root },
    log: () => {},
  };
}

const textOf = (turn: readonly { readonly content: string }[]) =>
  turn.map((one) => one.content).join("");

describe("the prompt over a long run", () => {
  // tracemantle sent 1,075,815 input tokens over 60 turns, depose 844,628 over 46: every turn
  // resent the whole history, so each prompt was larger than the one before. The bound is the
  // same whatever the context: a larger window is no reason to send more.
  it.each([65_536, 262_144])(
    "stays bounded over 40 turns of sizeable output at a %i-token context",
    async (context) => {
      const replies = Array.from({ length: 40 }, (_, at) => bash(`cat src/module-${at}.ts`));
      const model = scripted(replies, { counts: "unreported" });
      const ran = await runLoop(await loopOptions(model, context));
      expect(ran.steps).toBe(40);
      // The counts recorded per turn are the prompts sent, estimated where the runtime gave none.
      const sent = ran.usage.perTurn.map((turn) => turn.inputTokens);
      expect(sent).toEqual(model.seen.map((turn) => estimateTokens(textOf(turn))));
      expect(ran.usage.perTurn.every((turn) => turn.inputCount === "estimated")).toBe(true);
      expect(Math.max(...sent)).toBeLessThanOrEqual(16_000);
      expect(slopeOf(sent.slice(19))).toBeLessThanOrEqual(200);
      // Nothing pressed on the context, so nothing was compacted.
      expect(model.seen.some((turn) => textOf(turn).includes("were compacted"))).toBe(false);
    },
  );

  it("keeps the instructions, the task and the record byte for byte at the front", async () => {
    const replies = Array.from({ length: 12 }, (_, at) => bash(`cat src/module-${at}.ts`));
    const model = scripted(replies, { counts: "unreported" });
    await runLoop({ ...(await loopOptions(model, 65_536)), maxSteps: 12 });
    const [first, second, last] = [model.seen[0], model.seen[1], model.seen[11]];
    expect(last?.[0]).toEqual(first?.[0]);
    expect(last?.[1]).toEqual(second?.[1]);
    expect(first?.[1]?.content.startsWith(second?.[1]?.content ?? "-")).toBe(true);
    expect(second?.[1]?.content).toMatch(/^Task:\nMove the history modules/);
    expect(second?.[1]?.content).toContain('"id":"R1"');
  });

  it("keeps the latest turns whole and older outputs as an excerpt naming the evidence and a readable copy", async () => {
    const replies = Array.from({ length: 10 }, (_, at) => bash(`cat src/module-${at}.ts`));
    const model = scripted(replies, { counts: "unreported" });
    const options = await loopOptions(model, 65_536);
    await runLoop({ ...options, maxSteps: 10 });
    const last = model.seen[9] ?? [];
    const whole = last.filter((one) => one.role === "user" && one.content.includes("line 60:"));
    expect(whole.map((one) => one.content.split("\n")[1]?.split(" line")[0])).toEqual([
      "cat src/module-5.ts",
      "cat src/module-6.ts",
      "cat src/module-7.ts",
      "cat src/module-8.ts",
    ]);
    const oldest = last[3]?.content ?? "";
    expect(oldest).toContain("lines omitted");
    const named = /\[evidence ([0-9a-f]{16}); whole output: (\.swarm\/outputs\/\1\.txt)\]/.exec(
      oldest,
    );
    expect(named).not.toBeNull();
    expect(await readFile(join(options.outputs.root, named?.[2] ?? "-"), "utf8")).toBe(
      printed("cat src/module-0.ts"),
    );
  });

  it("compacts old exploration only under pressure, keeping facts, files, failures and open requirements with their evidence", async () => {
    const replies = Array.from({ length: 40 }, (_, at) =>
      bash(at % 5 === 4 ? `npm test -- --run ${at}` : `cat src/module-${at % 4}.ts`),
    );
    const model = scripted(replies, { counts: "unreported" });
    const changed = "diff --git a/src/module-1.ts b/src/module-1.ts\n+export {};";
    const logged: string[] = [];
    const contextTokens = 20_000;
    const ran = await runLoop({
      ...(await loopOptions(model, contextTokens)),
      // The tree changes after the third command, so that turn edited the file.
      diff: async () => (model.seen.length >= 3 ? changed : ""),
      log: (line: string) => logged.push(line),
    });
    expect(ran.steps).toBe(40);
    expect(logged.some((line) => line.startsWith("compacted earlier turns"))).toBe(true);
    const sent = ran.usage.perTurn.map((turn) => turn.inputTokens);
    expect(Math.max(...sent)).toBeLessThanOrEqual(contextTokens * 0.6);
    const digest = model.seen[39]?.[1]?.content ?? "";
    expect(digest).toMatch(/Turns 1 to \d+ were compacted to fit the context/);
    expect(digest).toMatch(
      /- step 1: `cat src\/module-0.ts` exited 0 \[evidence [0-9a-f]{16}; whole output: \.swarm\/outputs\/[0-9a-f]{16}\.txt\]/,
    );
    expect(digest).toContain("Files read or named, by step: src/module-0.ts (1, ");
    expect(digest).toContain(
      "Files edited, by the step after which they changed: src/module-1.ts (3).",
    );
    expect(digest).toMatch(
      /- step 5: `npm test -- --run 4` exited 1: FAIL src\/module-3.ts \[evidence [0-9a-f]{16}\]/,
    );
    expect(digest).toContain("Ran more than once: `cat src/module-0.ts`");
    expect(digest).toContain("Unresolved requirements:\n- R1 not verified yet");
    expect(digest).toContain("Read only the lines you need (grep -n, sed -n 'a,bp')");
  });
});

describe("an unchanged command and output", () => {
  it("stops the cycle as no progress on its third turn running, after saying so on the second", async () => {
    const model = scripted([bash("git status")], { counts: "unreported" });
    const ran = await runLoop({ ...(await loopOptions(model, 65_536)), maxSteps: 10 });
    expect(ran).toMatchObject({
      stop: "no-progress",
      reason: "the same command printed the same result 3 turns running",
      steps: 3,
    });
    expect(model.seen[1]?.at(-1)?.content).not.toContain("command you ran last turn");
    expect(model.seen[2]?.at(-1)?.content).toContain("This is the command you ran last turn");
  });

  it("does not stop a command whose output changes", async () => {
    let calls = 0;
    const changing: Chokepoint = {
      async run() {
        calls += 1;
        return { decision: "allowed", output: `${calls}`, exitCode: 0, record: `sha256:${calls}` };
      },
    };
    const model = scripted([bash("date")], { counts: "unreported" });
    const options = await loopOptions(model, 65_536);
    const ran = await runLoop({ ...options, chokepoint: changing, maxSteps: 5 });
    expect(ran).toMatchObject({ stop: "step-budget", steps: 5 });
  });
});
