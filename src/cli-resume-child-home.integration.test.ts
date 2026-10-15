import { execFile, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import { type ScriptedEndpoint, startScriptedEndpoint } from "./providers/scripted-endpoint.ts";

const run = promisify(execFile);

/**
 * The ordinary interrupted-work path through the real command line: a run is interrupted while
 * the model is answering, `swarm resume` continues it, that continuation is interrupted too, and
 * a second `swarm resume` continues again. Every session in the chain executes under the
 * original run's private child HOME, so what the first run's child wrote there is still there
 * for the third, and nothing is allocated under an intermediate session's name. The call each
 * interruption cut off reported no usage; it is charged at its recorded bound rather than making
 * the run unresumable. When the chain finishes, the home is released once.
 */
let scratch = "";
let home = "";
let scratchTmp = "";
let endpoint: ScriptedEndpoint | null = null;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-resume-chain-"));
  home = join(scratch, "home");
  scratchTmp = join(scratch, "tmp");
  await mkdir(home, { recursive: true });
  await mkdir(scratchTmp, { recursive: true });
});

afterEach(async () => {
  await endpoint?.close();
  endpoint = null;
  await rm(scratch, { recursive: true, force: true });
});

async function git(cwd: string, ...args: string[]): Promise<void> {
  await run("git", args, { cwd });
}

async function workspace(): Promise<string> {
  const directory = join(scratch, "workspace");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "probe",
      version: "1.0.0",
      type: "module",
      scripts: { test: "node --test" },
    }),
  );
  await writeFile(
    join(directory, "a.test.mjs"),
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('holds', () => assert.equal(1, 1));\n",
  );
  await git(directory, "init", "-q");
  await git(directory, "add", "-A");
  await git(
    directory,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@localhost",
    "commit",
    "-qm",
    "base",
  );
  return directory;
}

const writeSentinel =
  "require('fs').writeFileSync(require('os').homedir()+'/sentinel','x');console.log('home='+require('os').homedir())";

/**
 * Six requests across three sessions: the first run declares, probes its home, and is
 * interrupted inside a slow third turn; the continuation is interrupted inside its first slow
 * turn; the second continuation writes the note and finishes. An interrupted request still
 * counts as played, which is why two slow turns stand in the script.
 */
const slowWrite = {
  delayMs: 20_000,
  toolCalls: [{ name: "write", input: { path: "notes.txt", content: "done\n" } }],
};
const script = [
  {
    text: "Plan: probe the home, then write the note.",
    toolCalls: [{ name: "declare_file_set", input: { files: ["notes.txt"] } }],
  },
  { toolCalls: [{ name: "shell", input: { command: `node -e "${writeSentinel}"` } }] },
  slowWrite,
  slowWrite,
  { toolCalls: [{ name: "write", input: { path: "notes.txt", content: "done\n" } }] },
  { text: "Wrote the note.", toolCalls: [] },
];

function swarm(
  args: readonly string[],
  cwd: string,
  options: { readonly interruptAfterMs: number | null },
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [resolve("src/cli.ts"), ...args], {
      cwd,
      env: { PATH: process.env.PATH ?? "", HOME: home, TMPDIR: scratchTmp, NO_COLOR: "1" },
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    if (options.interruptAfterMs !== null)
      setTimeout(() => child.kill("SIGINT"), options.interruptAfterMs);
    child.on("exit", (code) => resolveRun({ code, output }));
  });
}

/** The session a run named in its output: the last session path it printed. */
function sessionOf(output: string): string {
  const matches = [...output.matchAll(/sessions\/(\d{8}T\d{6}-[0-9a-f]{6})/g)];
  const last = matches.at(-1)?.[1];
  if (last === undefined) throw new Error(`no session named in:\n${output}`);
  return last;
}

function payloadOf(sessionId: string, type: string): Record<string, unknown> {
  const directory = join(home, ".swarm", "sessions", sessionId);
  const record = readFileSync(join(directory, "ledger.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; payloadDigest: string })
    .find((entry) => entry.type === type);
  if (record === undefined) throw new Error(`${sessionId} recorded no ${type}`);
  return JSON.parse(
    readFileSync(join(directory, "blobs", `${record.payloadDigest.slice(7)}.json`), "utf8"),
  ) as Record<string, unknown>;
}

it("continues under the original run's child HOME through two interruptions and two resumptions", async () => {
  endpoint = await startScriptedEndpoint({ modelId: "stub", turns: script });
  const directory = await workspace();
  const common = [
    "--model",
    "local:stub",
    "--local-endpoint",
    endpoint.url,
    "--approve",
    "auto",
    "--no-tui",
    "--no-open-evidence",
  ];

  const first = await swarm(
    ["--workspace", directory, "--max-steps", "8", "probe the home and write a note", ...common],
    directory,
    { interruptAfterMs: 6_000 },
  );
  expect(first.code).toBe(130);
  const firstId = sessionOf(first.output);
  const firstEnvelope = payloadOf(firstId, "execution-envelope") as {
    childHome: string;
    childHomeState: { origin: string; runId: string };
  };
  expect(firstEnvelope.childHomeState).toMatchObject({ origin: "created", runId: firstId });
  // Interrupted, so the home and what the run's child wrote there are kept for the resumption.
  expect(existsSync(join(firstEnvelope.childHome, "sentinel"))).toBe(true);

  const second = await swarm(["resume", firstId, ...common], directory, {
    interruptAfterMs: 6_000,
  });
  expect(second.code).toBe(130);
  const secondId = sessionOf(second.output);
  expect(secondId).not.toBe(firstId);
  const secondEnvelope = payloadOf(secondId, "execution-envelope") as {
    childHome: string;
    childHomeState: { origin: string; runId: string };
  };
  expect(secondEnvelope.childHome).toBe(firstEnvelope.childHome);
  expect(secondEnvelope.childHomeState).toMatchObject({ origin: "resumed", runId: firstId });
  // The cut-off call was charged, on the record, instead of refusing the continuation.
  expect(payloadOf(secondId, "session-started")).toMatchObject({
    childHomeOwner: firstId,
    chargedForCancelledCalls: { calls: 1 },
  });
  expect(existsSync(join(firstEnvelope.childHome, "sentinel"))).toBe(true);

  const third = await swarm(["resume", secondId, ...common], directory, { interruptAfterMs: null });
  expect(third.code).toBe(0);
  const thirdId = sessionOf(third.output);
  const thirdEnvelope = payloadOf(thirdId, "execution-envelope") as {
    childHome: string;
    childHomeState: { origin: string; runId: string };
  };
  // The second resumption names the original owner, read from the intermediate session's own
  // envelope, and finds the same home rather than recreating one under the intermediate id.
  expect(thirdEnvelope.childHome).toBe(firstEnvelope.childHome);
  expect(thirdEnvelope.childHomeState).toMatchObject({ origin: "resumed", runId: firstId });
  expect(payloadOf(thirdId, "session-started")).toMatchObject({ childHomeOwner: firstId });
  expect(readFileSync(join(directory, "notes.txt"), "utf8")).toBe("done\n");

  // The chain finished: the one home is released, and nothing was made under the other ids.
  const root = join(scratchTmp, "swarm-child-homes");
  expect(readdirSync(root).filter((entry) => entry !== "npm-cache")).toEqual([]);
  expect(endpoint.played()).toBe(6);
}, 240_000);
