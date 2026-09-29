import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { strengthenAndRepair, strengtheningState, unansweredAdmissions } from "./cli-strengthen.ts";
import { freezeGoalContract } from "./evidence/goal-contract.ts";
import { openEvidenceSession } from "./evidence/session.ts";

/**
 * Attack family 11 with a real process: a strengthening run is killed with SIGKILL while an
 * admission is in flight, and the same session is resumed. The cut-off admission is named once and
 * never repeated or admitted, the round it spent stays spent, and a resumed run cannot get fresh
 * rounds by starting again.
 */
let root = "";
let repository = "";
const clock = { now: () => Date.now(), sleep: () => Promise.resolve() };

const contract = freezeGoalContract({
  version: 1,
  goal: "g",
  requirements: [{ id: "r", description: "d", checks: ["c"] }],
  checks: [{ id: "c", command: "true", author: "user", exposure: "shared", artifacts: [] }],
  immutablePaths: [],
  challenges: {
    version: 1,
    mutations: "none",
    fixtures: [],
    references: [{ id: "ref", requirement: "r", description: "x", patch: "diff --git a/a b/a\n" }],
  },
}).contract;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-killed-strengthening-"));
  repository = join(root, "repo");
  execFileSync("mkdir", ["-p", repository]);
  const git = (...words: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...words], {
      cwd: repository,
    });
  git("init", "-q");
  await writeFile(join(repository, "a.mjs"), "export const a = 1;\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  await writeFile(join(repository, "a.mjs"), "export const a = 2;\n");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** The child: one strengthening run whose probe never returns, so it is killed mid-admission. */
function childSource(): string {
  const src = (path: string) => JSON.stringify(resolve("src", path));
  return `
import { strengthenAndRepair, strengtheningLimits } from ${src("cli-strengthen.ts")};
import { declareGoalContract } from ${src("evidence/goal-contract.ts")};
import { openEvidenceSession } from ${src("evidence/session.ts")};
const [root, repository, base, contractJson] = process.argv.slice(2);
const contract = JSON.parse(contractJson);
const clock = { now: () => Date.now(), sleep: () => Promise.resolve() };
const evidence = await openEvidenceSession({ root, sessionId: "killed", clock });
await declareGoalContract(evidence, contract);
const report = { policy: "required", contractDigest: "x", seed: "s", operators: "o", baseTree: "b", alternatives: [], requirements: [{ id: "r", baseControl: "vacuous", caught: [], gaps: [], unwitnessed: [], invalid: [], outcome: "gap", detail: "" }], satisfied: false, record: "x" };
const proposal = { id: "added", command: "true", artifacts: [{ path: "acceptance/strengthened/a.txt", content: "a" }], rationale: "r" };
await strengthenAndRepair({
  evidence, workspace: repository, baseCommit: base, root: contract, policy: "required",
  limits: strengtheningLimits({ rounds: 1 }), clock, signal: new AbortController().signal,
  model: { modelId: "scripted", async generate() { return { text: JSON.stringify(proposal), toolCalls: [], inputTokens: 1, outputTokens: 1, finishReason: "stop" }; } },
  deadline: null, reserveMs: 0, remainingTokens: () => 1000,
  verifyCandidate: async () => ({ challenges: report, verified: false }),
  verifyProbe: () => new Promise(() => {}),
  repair: async () => {},
});
`;
}

it("names an admission cut off by SIGKILL once, never repeats it, and gives a resumed run no new rounds", async () => {
  const base = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf8",
  }).trim();
  const child = join(root, "child.mts");
  await writeFile(child, childSource());
  const running = spawn(
    process.execPath,
    [child, join(root, "sessions"), repository, base, JSON.stringify(contract)],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  running.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  let exited = false;
  const exit = new Promise<void>((settle) =>
    running.once("exit", () => {
      exited = true;
      settle();
    }),
  );
  // Watched through the blobs the child writes, never by opening its live session.
  const blobs = join(root, "sessions", "killed", "blobs");
  const deadline = Date.now() + 60_000;
  for (;;) {
    const names = await readdir(blobs).catch(() => [] as string[]);
    let reached = false;
    for (const name of names) {
      const text = await readFile(join(blobs, name), "utf8").catch(() => "");
      if (text.includes("check-admission-v1") && text.includes('"intent"')) reached = true;
    }
    if (reached) break;
    if (exited || Date.now() > deadline)
      throw new Error(`the child never reached its admission: ${stderr.slice(-2000)}`);
    await new Promise((settle) => setTimeout(settle, 100));
  }
  running.kill("SIGKILL");
  await exit;

  const evidence = await openEvidenceSession({
    root: join(root, "sessions"),
    sessionId: "killed",
    clock,
  });
  expect(unansweredAdmissions(evidence)).toHaveLength(1);
  expect(strengtheningState(evidence, contract).rounds).toBe(1);
  const resumed = await strengthenAndRepair({
    evidence,
    workspace: repository,
    baseCommit: base,
    root: contract,
    policy: "required",
    limits: { rounds: 2, perRequirement: 1 },
    model: {
      modelId: "never",
      generate: () =>
        Promise.reject(new Error("a resumed run past its limit must not call the model")),
    },
    clock,
    signal: new AbortController().signal,
    deadline: null,
    reserveMs: 0,
    remainingTokens: () => 1000,
    verifyCandidate: () => Promise.reject(new Error("no round is left to verify in")),
    verifyProbe: () => Promise.reject(new Error("the cut-off admission must not run again")),
    repair: () => Promise.reject(new Error("nothing was admitted")),
  });
  // The plan the killed run recorded (one round) governs, not the two the resume asked for.
  expect(resumed.rounds).toBe(1);
  expect(resumed.admitted).toEqual([]);
  expect(unansweredAdmissions(evidence)).toEqual([]);
  const reconciliations = [...evidence.payloads().values()].filter(
    (payload) => (payload as { rule?: string }).rule === "strengthening-reconciliation-v1",
  );
  expect(reconciliations).toHaveLength(1);
}, 120_000);
