import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSystemClock } from "./cli-runtime-inputs.ts";
import { bundleSourceFromRecorder, exportBundle } from "./evidence/bundle.ts";
import type { LedgerRecord } from "./evidence/ledger-record.ts";
import { openEvidenceSession } from "./evidence/session.ts";
import { createEphemeralSigningKey } from "./evidence/signing.ts";
import { verifyBundle } from "./evidence/verifier/verify.mjs";
import {
  type ScriptedEndpoint,
  type ScriptedTurnSource,
  startScriptedEndpoint,
} from "./providers/scripted-endpoint.ts";

const run = promisify(execFile);

/**
 * The 2026-10-16 csstree refusal, through the ordinary command line from the original base:
 * the model edits, the gates run, an advisory size budget asks for a justification, and the
 * displayed outcome, the recorded verdict and the exit status have to agree on one rule. The
 * run is driven by a scripted model whose answers are read off the prompts the product sends.
 */
let scratch = "";
let home = "";
const endpoints: ScriptedEndpoint[] = [];

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-justification-"));
  home = join(scratch, "home");
  await mkdir(home, { recursive: true });
});

afterEach(async () => {
  for (const endpoint of endpoints.splice(0)) await endpoint.close();
  await rm(scratch, { recursive: true, force: true });
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const ran = await run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd,
  });
  return ran.stdout.trim();
}

async function commitAll(directory: string): Promise<string> {
  await git(directory, "init", "-q");
  await git(directory, "add", "-A");
  await git(directory, "commit", "-qm", "base");
  return git(directory, "rev-parse", "HEAD");
}

/** A workspace whose sealed check passes once value.mjs exports 2, under a three-line budget. */
async function sizedWorkspace(): Promise<{ directory: string; base: string; contract: string }> {
  const directory = join(scratch, "workspace");
  await mkdir(join(directory, "acceptance"), { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "sized",
      version: "1.0.0",
      type: "module",
      scripts: { test: "node --test" },
    }),
  );
  await writeFile(join(directory, "swarm.toml"), "[budgets]\nmax_added_lines = 3\n");
  await writeFile(join(directory, "value.mjs"), "export const value = 1;\n");
  await writeFile(
    join(directory, "value.test.mjs"),
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { value } from './value.mjs';\ntest('is a number', () => assert.equal(typeof value, 'number'));\n",
  );
  await writeFile(
    join(directory, "acceptance", "check.mjs"),
    "import { value } from '../value.mjs';\nif (value !== 2) { console.error('value is ' + value); process.exit(1); }\n",
  );
  const contract = join(scratch, "contract.json");
  await writeFile(
    contract,
    JSON.stringify({
      version: 1,
      goal: "make value equal 2",
      requirements: [{ id: "value", description: "value is 2", checks: ["check"] }],
      checks: [
        {
          id: "check",
          command: "node acceptance/check.mjs",
          author: "user",
          exposure: "shared",
          artifacts: [],
        },
      ],
      immutablePaths: ["acceptance"],
    }),
  );
  return { directory, base: await commitAll(directory), contract };
}

/** Six lines where three are budgeted: a change that is right and over its size budget. */
const sixLines = `${Array.from({ length: 5 }, (_, index) => `// note ${index}`).join("\n")}\nexport const value = 2;\n`;

const edits: ScriptedTurnSource[] = [
  {
    text: "Plan: set the value.",
    toolCalls: [{ name: "declare_file_set", input: { files: ["value.mjs"] } }],
  },
  { toolCalls: [{ name: "write", input: { path: "value.mjs", content: sixLines } }] },
  { text: "The value is 2." },
];

/** The record and kind the justification request names, read off the prompt as a model would. */
function demandedRecord(request: unknown): { record: string; kind: string } {
  const messages = (request as { messages?: { role: string; content: unknown }[] }).messages ?? [];
  const text = messages
    .filter((message) => message.role === "user")
    .map((message) =>
      typeof message.content === "string" ? message.content : JSON.stringify(message.content),
    )
    .join("\n");
  const found = /evidence record (sha256:[0-9a-f]{64}), kind (gate-run:[a-z-]+)/.exec(text);
  if (found === null) throw new Error(`the prompt names no demanded record:\n${text}`);
  return { record: found[1] ?? "", kind: found[2] ?? "" };
}

const justifies: ScriptedTurnSource = (request) => {
  const { record, kind } = demandedRecord(request);
  return {
    toolCalls: [
      {
        name: "claim",
        input: {
          predicate: 'status == "failed"',
          record,
          recordKind: kind,
          narrative: "value.mjs carries five lines of notes the reviewer asked to keep beside it",
        },
      },
    ],
  };
};

interface Ran {
  readonly runId: string;
  readonly code: number;
  readonly stdout: string;
  readonly result: {
    exitCode?: number;
    verdict?: { acceptable?: boolean; reasons?: Record<string, string> };
  };
  readonly assessments: {
    inputs: Record<string, unknown>;
    verdict: { acceptable: boolean; policy: string; reasons: Record<string, string> };
  }[];
  readonly requests: readonly unknown[];
}

async function swarm(
  workspace: { directory: string; base: string; contract: string },
  turns: readonly ScriptedTurnSource[],
  flags: readonly string[] = [],
): Promise<Ran> {
  const endpoint = await startScriptedEndpoint({ modelId: "stub", turns });
  endpoints.push(endpoint);
  const args = [
    resolve("src/cli.ts"),
    "make value equal 2",
    "--model",
    "local:stub",
    "--local-endpoint",
    endpoint.url,
    "--workspace",
    workspace.directory,
    "--base",
    workspace.base,
    "--goal-contract",
    workspace.contract,
    "--approve",
    "auto",
    "--no-tui",
    "--no-open-evidence",
    "--json",
    ...flags,
  ];
  const env = { PATH: process.env.PATH ?? "", HOME: home, NO_COLOR: "1" };
  let code = 0;
  let stdout = "";
  try {
    stdout = (
      await run(process.execPath, args, { cwd: workspace.directory, env, timeout: 180_000 })
    ).stdout;
  } catch (cause) {
    const failed = cause as { code?: number; stdout?: string; stderr?: string };
    code = failed.code ?? 1;
    stdout = `${failed.stdout ?? ""}\n${failed.stderr ?? ""}`;
  }
  const lines = stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as { schema: string; runId?: string });
  const result = lines.find((line) => line.schema === "swarm.result.v1") as
    | (Ran["result"] & { runId?: string })
    | undefined;
  if (result?.runId === undefined) throw new Error(`no result line:\n${stdout}`);
  return {
    runId: result.runId,
    code,
    stdout,
    result,
    assessments: assessmentsOf(result.runId),
    requests: endpoint.requests,
  };
}

function assessmentsOf(sessionId: string): Ran["assessments"] {
  const directory = join(home, ".swarm", "sessions", sessionId);
  return readFileSync(join(directory, "ledger.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; payloadDigest: string })
    .filter((record) => record.type === "run-assessment")
    .map(
      (record) =>
        JSON.parse(
          readFileSync(join(directory, "blobs", `${record.payloadDigest.slice(7)}.json`), "utf8"),
        ) as Ran["assessments"][number],
    );
}

/** A copy of a run's chain whose justification claim carries no narrative, exported and signed. */
async function forgedBundle(sessionId: string): Promise<string> {
  const directory = join(home, ".swarm", "sessions", sessionId);
  const forged = await openEvidenceSession({
    root: join(scratch, "forged-sessions"),
    sessionId: "forged",
    clock: createSystemClock(),
  });
  const renamed = new Map<string, string>();
  const entries = readFileSync(join(directory, "ledger.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as LedgerRecord);
  for (const entry of entries) {
    const payload = JSON.parse(
      readFileSync(join(directory, "blobs", `${entry.payloadDigest.slice(7)}.json`), "utf8"),
    );
    if (entry.type === "claim" && payload.recordKind === "gate-run:diff-budget")
      payload.narrative = "";
    if (entry.type === "run-assessment" && Array.isArray(payload.inputs?.justifications))
      for (const one of payload.inputs.justifications)
        one.claimRecord = renamed.get(one.claimRecord) ?? one.claimRecord;
    const written = await forged.record({
      type: entry.type,
      actor: entry.actor,
      provenance: entry.provenance,
      payload,
      ...(entry.promptDigest === undefined ? {} : { promptDigest: entry.promptDigest }),
      ...(entry.responseDigest === undefined ? {} : { responseDigest: entry.responseDigest }),
    });
    renamed.set(entry.payloadDigest, written.record.payloadDigest);
  }
  const destination = join(scratch, "forged-bundle");
  await exportBundle({
    source: bundleSourceFromRecorder(forged),
    destination,
    signingKey: createEphemeralSigningKey(),
    clock: createSystemClock(),
  });
  return destination;
}

/** The outcome block's two lines that a person reads first, as the run printed them. */
function outcomeLines(stdout: string): { outcome: string; blocked: string | null } {
  const lines = stdout.split("\n");
  return {
    outcome: lines.find((line) => line.startsWith("outcome: ")) ?? "",
    blocked: lines.find((line) => line.startsWith("  blocked by: ")) ?? null,
  };
}

describe("an advisory size budget through the ordinary command line", () => {
  it("asks for the justification, and accepts the work once a verified claim answers it", async () => {
    const ran = await swarm(await sizedWorkspace(), [...edits, justifies, { text: "Justified." }]);

    // The request reached the model as its own turn, with only the claim tool offered.
    const asked = ran.requests.at(-2) as { tools?: { function: { name: string } }[] };
    expect(asked.tools?.map((tool) => tool.function.name)).toEqual(["claim"]);
    expect(ran.code).toBe(0);
    expect(outcomeLines(ran.stdout)).toEqual({ outcome: "outcome: accepted", blocked: null });
    const worker = ran.assessments[0];
    expect(worker?.inputs.policy).toBe("run-acceptance-v4");
    expect(worker?.inputs.justifications).toHaveLength(1);
    expect(worker?.verdict.policy).toBe("pass");
    expect(ran.result.verdict?.acceptable).toBe(true);
    expect(ran.result.exitCode).toBe(0);
    // The bundle's own verifier re-derived the justified assessment and agreed.
    expect(ran.stdout).toContain("bundle verified in this run: verify.mjs exited 0");

    // The same chain with the justification's narrative emptied, the assessment re-pointed at
    // the altered claim, and the bundle re-signed: the verifier's own rule refuses it.
    const refusals: string[] = [];
    expect(
      verifyBundle(await forgedBundle(ran.runId), (line: string) => refusals.push(line)),
    ).not.toBe(0);
    expect(refusals.join("\n")).toMatch(
      /FAIL {2}run assessment \d+ re-derived: recorded true, evidence implies false/,
    );
  }, 200_000);

  it("refuses work whose demand went unanswered, and names that as the blocker", async () => {
    const ran = await swarm(await sizedWorkspace(), [...edits, { text: "No justification." }]);

    expect(ran.code).toBe(1);
    const shown = outcomeLines(ran.stdout);
    expect(shown.outcome).toBe("outcome: not accepted");
    expect(shown.blocked).toMatch(
      /^ {2}blocked by: diff-budget asked for a justification and no verified claim cites its record sha256:[0-9a-f]{64} \(over budget: 1 file\(s\) against 12 and 6 added line\(s\) against 3\./,
    );
    // The recorded reason and the displayed one are the same sentence, never "accepted".
    const worker = ran.assessments[0];
    expect(worker?.verdict.acceptable).toBe(false);
    expect(worker?.verdict.reasons.assessment).toContain("diff-budget asked for a justification");
    expect(ran.result.verdict?.acceptable).toBe(false);
    expect(ran.result.exitCode).toBe(1);
    expect(ran.result.verdict?.reasons?.assessment).toBe(worker?.verdict.reasons.assessment);
    expect(ran.stdout).toContain("bundle verified in this run: verify.mjs exited 0");
  }, 200_000);

  it("offers no justification turn where the blocking secret scan failed, and names it", async () => {
    const leaking = `// note\n// note\n// note\nconst github_token = "ghp_SwarmJustificationCase000000000000000";\nexport const value = 2;\n`;
    const turns: ScriptedTurnSource[] = [
      edits[0] as ScriptedTurnSource,
      { toolCalls: [{ name: "write", input: { path: "value.mjs", content: leaking } }] },
      { text: "The value is 2." },
      justifies,
    ];
    const ran = await swarm(await sizedWorkspace(), turns, ["--attempts", "0"]);

    expect(ran.code).toBe(1);
    // Three turns played: the scripted justification was never asked for.
    expect(ran.requests).toHaveLength(3);
    const worker = ran.assessments[0];
    expect(worker?.verdict.acceptable).toBe(false);
    expect(worker?.verdict.reasons.assessment).toContain("blocking gate(s) failed: secret-scan");
    expect(outcomeLines(ran.stdout).blocked).toContain("blocking gate(s) failed: secret-scan");
  }, 200_000);
});

describe("an authorized upgrade's regenerated lockfile", () => {
  /** A one-dependency npm project at 1.0.0 and the 2.0.0 manifest and lockfile, both installable offline. */
  async function upgradeWorkspace() {
    const directory = join(scratch, "upgrade");
    const vendor = join(directory, "vendor");
    const pack = join(scratch, "package");
    await mkdir(vendor, { recursive: true });
    await mkdir(pack, { recursive: true });
    const versions = new Map<string, { manifest: string; lock: string }>();
    for (const version of ["1.0.0", "2.0.0"]) {
      await writeFile(
        join(pack, "package.json"),
        JSON.stringify({ name: "fixture-lib", version, main: "index.cjs" }),
      );
      await writeFile(join(pack, "index.cjs"), "module.exports = n => n + 1;\n");
      await run("npm", ["pack", "--ignore-scripts", "--pack-destination", vendor], {
        cwd: pack,
        env: { PATH: process.env.PATH ?? "", HOME: home },
      });
      const archive = `fixture-lib-${version}.tgz`;
      const integrity = `sha512-${createHash("sha512")
        .update(await readFile(join(vendor, archive)))
        .digest("base64")}`;
      const dependencies = { "fixture-lib": version };
      const manifest = {
        name: "fixture",
        version: "1.0.0",
        scripts: { test: "node --test" },
        dependencies,
      };
      const lock = {
        name: "fixture",
        version: "1.0.0",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "fixture", version: "1.0.0", dependencies },
          "node_modules/fixture-lib": { version, resolved: `file:vendor/${archive}`, integrity },
        },
      };
      versions.set(version, {
        manifest: `${JSON.stringify(manifest, null, 2)}\n`,
        lock: `${JSON.stringify(lock, null, 2)}\n`,
      });
    }
    const initial = versions.get("1.0.0");
    const candidate = versions.get("2.0.0");
    if (initial === undefined || candidate === undefined)
      throw new Error("fixture versions missing");
    await writeFile(join(directory, "package.json"), initial.manifest);
    await writeFile(join(directory, "package-lock.json"), initial.lock);
    await writeFile(join(directory, ".gitignore"), "node_modules/\n");
    // A budget the regenerated lockfile alone exceeds, so counting it would demand a justification.
    await writeFile(join(directory, "swarm.toml"), "[budgets]\nmax_added_lines = 2\n");
    await writeFile(
      join(directory, "behavior.test.cjs"),
      "const{test}=require('node:test');const assert=require('node:assert/strict');test('increment',()=>assert.equal(require('fixture-lib')(2),3));\n",
    );
    const contract = join(scratch, "upgrade-contract.json");
    await writeFile(
      contract,
      JSON.stringify({
        version: 1,
        goal: "Upgrade fixture-lib to 2.0.0",
        preset: {
          kind: "upgrade",
          manager: "npm",
          manifest: "package.json",
          lockfile: "package-lock.json",
          dependencies: [{ name: "fixture-lib", section: "dependencies", version: "2.0.0" }],
          sourcePaths: [],
        },
        requirements: [
          { id: "increment", description: "Two increments to three", checks: ["increment"] },
        ],
        checks: [
          {
            id: "increment",
            command: "node -e \"process.exit(require('fixture-lib')(2) === 3 ? 0 : 1)\"",
            author: "user",
            exposure: "shared",
            artifacts: [],
          },
        ],
        immutablePaths: ["behavior.test.cjs"],
      }),
    );
    const base = await commitAll(directory);
    // Prepared as a launcher prepares a checkout before the run: installed at the base.
    await run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: directory,
      env: { PATH: process.env.PATH ?? "", HOME: home },
    });
    return { directory, base, contract, candidate };
  }

  it("is accepted without a justification when only the generated lockfile exceeds the budget", async () => {
    const workspace = await upgradeWorkspace();
    const turns: ScriptedTurnSource[] = [
      {
        text: "Plan: upgrade.",
        toolCalls: [
          { name: "declare_file_set", input: { files: ["package.json", "package-lock.json"] } },
        ],
      },
      {
        toolCalls: [
          { name: "write", input: { path: "package.json", content: workspace.candidate.manifest } },
          {
            name: "write",
            input: { path: "package-lock.json", content: workspace.candidate.lock },
          },
        ],
      },
      { text: "Upgraded." },
    ];
    const ran = await swarm(workspace, turns, [
      "--preset",
      "upgrade",
      "--install",
      "--lockfile",
      "package-lock.json",
    ]);

    expect(outcomeLines(ran.stdout)).toEqual({ outcome: "outcome: accepted", blocked: null });
    expect(ran.code).toBe(0);
    // No justification turn: the three scripted turns were all the model was asked for.
    expect(ran.requests).toHaveLength(3);
    expect(ran.stdout).toMatch(/generated line\(s\) in package-lock\.json counted apart/);
  }, 200_000);
});

describe("a project whose own tools skip hidden paths", () => {
  /**
   * css-select and domutils exclude every path with a dot-named component from Biome, so in a
   * final verification checkout under ~/.swarm their lint and npm test checked no files and
   * failed at the base; a correct change was refused. On the host that checkout is now outside
   * any hidden directory.
   */
  it("verifies the final tree in a checkout its tools can see", async () => {
    const workspace = await sizedWorkspace();
    const strict =
      "node -e \"process.exit(process.cwd().split('/').some((part) => part.startsWith('.')) ? 1 : 0)\" && node --test";
    const manifest = JSON.parse(readFileSync(join(workspace.directory, "package.json"), "utf8"));
    await writeFile(
      join(workspace.directory, "package.json"),
      JSON.stringify({ ...manifest, scripts: { test: strict } }),
    );
    await writeFile(join(workspace.directory, "swarm.toml"), "");
    await run(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qam", "strict tests"],
      {
        cwd: workspace.directory,
      },
    );
    const base = (
      await run("git", ["rev-parse", "HEAD"], { cwd: workspace.directory })
    ).stdout.trim();
    const small: ScriptedTurnSource[] = [
      edits[0] as ScriptedTurnSource,
      {
        toolCalls: [
          { name: "write", input: { path: "value.mjs", content: "export const value = 2;\n" } },
        ],
      },
      { text: "The value is 2." },
    ];
    const ran = await swarm({ ...workspace, base }, small);

    expect(ran.stdout).toContain(
      "final verification of the exact tree in a fresh checkout: regression pass",
    );
    expect(ran.code).toBe(0);
  }, 200_000);
});
