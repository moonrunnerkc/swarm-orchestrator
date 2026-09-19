import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../core/clock.ts";
import { digestOfBytes } from "../evidence/canonical-json.ts";
import { openEvidenceSession } from "../evidence/session.ts";
import { blindingReferences, runIdOf, takeAgentSession } from "./agent-session.ts";

const clock: Clock = { now: () => 1_700_000_000_000, sleep: () => Promise.resolve() };
const cache = "/Users/someone/.cache/swarm-pr-tasks";
const workspace = `${cache}/feedback-study/g1/runs/local__qwen/a__b-7-p1/reach-a1`;
const home = `${cache}/feedback-study/g1/homes/inv-1`;

describe("where an invocation's session says it went", () => {
  const audit = (texts: string[]) =>
    blindingReferences({
      texts,
      forbiddenRoots: [cache, "~/.cache/swarm-pr-tasks"],
      ownPaths: [workspace, home],
    });

  it("says nothing of an invocation that stayed in its own workspace and home", () => {
    expect(audit([`{"command":"cat ${workspace}/lib/x.js"}`, `{"home":"${home}/.swarm"}`])).toEqual(
      [],
    );
  });

  it("names the mined checkout, whose history holds the pull request's test file", () => {
    expect(audit([`{"command":"git -C ${cache}/work/a__b show deadbeef:test/x.test.js"}`])).toEqual(
      [`${cache}/work/a__b`],
    );
  });

  it("names a sibling arm's workspace, a stored oracle and the tilde spelling", () => {
    const sibling = `${cache}/feedback-study/g1/runs/local__qwen/a__b-7-p1/neutral-a1/lib/x.js`;
    expect(
      audit([
        `{"output":"${sibling}\\n"}`,
        `{"command":"ls ${cache}/feedback-study/g1/oracles"}`,
        `{"command":"ls ~/.cache/swarm-pr-tasks/work"}`,
      ]),
    ).toEqual([`${cache}/feedback-study/g1/oracles`, sibling, "~/.cache/swarm-pr-tasks/work"]);
  });

  it("does not mistake a workspace whose name extends its own for its own", () => {
    expect(audit([`{"path":"${workspace}-other/x"}`])).toEqual([`${workspace}-other/x`]);
  });

  it("reads its own workspace as its own however a tool output ends the path", () => {
    // Measured on the feedback study's generation 2: a colourised test runner ended the agent's
    // own workspace path with an escape, and the audit read `…/prefix\u001b[39m` as elsewhere.
    const payloads = [
      { output: `\u001b[2m${workspace}\u001b[39m` },
      { output: `wrote ${workspace}.` },
      { output: `${workspace}/lib/x.js:12:3 error` },
      { output: `cwd ${workspace}\nnext line` },
    ].map((payload) => JSON.stringify(payload));
    expect(audit(payloads)).toEqual([]);
  });

  it("still names a foreign path a colourised output prints, without the escape", () => {
    const sibling = `${cache}/feedback-study/g1/runs/local__qwen/a__b-7-p1/neutral-a1`;
    expect(audit([JSON.stringify({ output: `\u001b[36m${sibling}\u001b[39m` })])).toEqual([
      sibling,
    ]);
  });

  it("reads the run id the CLI printed last", () => {
    expect(runIdOf('noise\n{"runId":"20260918T010203-abc123","ok":true}\n')).toBe(
      "20260918T010203-abc123",
    );
    expect(runIdOf("no json here\n")).toBeNull();
    expect(runIdOf('{"runId":"../escape"}')).toBeNull();
  });
});

describe("taking an invocation's session out of the home it ran under", () => {
  let scratch: string;
  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), "agent-session-"));
  });
  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it("keeps a copy, reads its usage and stop reason, audits it and removes the home", async () => {
    const invocationHome = join(scratch, "home");
    const session = await openEvidenceSession({
      root: join(invocationHome, ".swarm", "sessions"),
      sessionId: "20260918T000000-aaaaaa",
      clock,
    });
    await session.record({
      type: "model-call",
      actor: "harness",
      provenance: ["model"],
      promptDigest: digestOfBytes("prompt"),
      responseDigest: digestOfBytes("response"),
      payload: {
        usageStatus: "reported",
        inputTokens: 700,
        outputTokens: 40,
        content: { text: "ok" },
      },
    });
    await session.record({
      type: "tool-call",
      actor: "model",
      provenance: ["model"],
      payload: { tool: "shell", command: `cat ${cache}/work/a__b/test/x.test.js` },
    });
    await session.record({
      type: "session-stopped",
      actor: "harness",
      provenance: ["tool-output"],
      payload: { repair: true, stopReason: "max-tokens" },
    });
    await session.record({
      type: "session-stopped",
      actor: "harness",
      provenance: ["tool-output"],
      payload: { stopReason: "max-steps" },
    });
    const kept = join(scratch, "kept");
    await mkdir(kept);
    const taken = await takeAgentSession({
      stdout: '{"runId":"20260918T000000-aaaaaa"}\n',
      home: invocationHome,
      keptRoot: kept,
      forbiddenRoots: [cache],
      ownWorkspace: workspace,
    });
    expect(taken).toMatchObject({
      runId: "20260918T000000-aaaaaa",
      ledgerRecords: 4,
      stopReason: "max-steps",
      usage: {
        modelCalls: 1,
        failedCalls: 0,
        inputTokens: 700,
        outputTokens: 40,
        status: "reported",
      },
      blinding: { checked: true, references: [`${cache}/work/a__b/test/x.test.js`] },
    });
    expect(existsSync(join(kept, "20260918T000000-aaaaaa", "ledger.jsonl"))).toBe(true);
    expect(existsSync(invocationHome)).toBe(false);
  });

  it("allows the invocation's own scratch directory and removes it with the home", async () => {
    const invocationHome = join(scratch, "home");
    const invocationScratch = join(scratch, "scratch");
    await mkdir(join(invocationScratch, "swarm-child-home", ".npm", "_logs"), { recursive: true });
    const session = await openEvidenceSession({
      root: join(invocationHome, ".swarm", "sessions"),
      sessionId: "20260919T000000-cccccc",
      clock,
    });
    await session.record({
      type: "tool-call",
      actor: "harness",
      provenance: ["tool-output"],
      payload: {
        output: `npm error A complete log of this run can be found in: ${invocationScratch}/swarm-child-home/.npm/_logs/debug-0.log`,
      },
    });
    const kept = join(scratch, "kept");
    await mkdir(kept);
    const taken = await takeAgentSession({
      stdout: '{"runId":"20260919T000000-cccccc"}',
      home: invocationHome,
      scratch: invocationScratch,
      keptRoot: kept,
      forbiddenRoots: [scratch],
      ownWorkspace: workspace,
    });
    expect(taken.blinding).toEqual({ checked: true, references: [] });
    expect(existsSync(invocationHome)).toBe(false);
    expect(existsSync(invocationScratch)).toBe(false);
  });

  it("reads a session it cannot find as unknown and unchecked, and still removes the home", async () => {
    const invocationHome = join(scratch, "home");
    await mkdir(invocationHome);
    const taken = await takeAgentSession({
      stdout: '{"runId":"20260918T000000-bbbbbb"}',
      home: invocationHome,
      keptRoot: join(scratch, "kept"),
      forbiddenRoots: [cache],
      ownWorkspace: workspace,
    });
    expect(taken.runId).toBe("20260918T000000-bbbbbb");
    expect(taken.usage.status).toBe("unknown");
    expect(taken.blinding).toEqual({ checked: false, references: [] });
    expect(existsSync(invocationHome)).toBe(false);
  });
});
