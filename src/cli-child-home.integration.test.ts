import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ScriptedEndpoint, startScriptedEndpoint } from "./providers/scripted-endpoint.ts";

const run = promisify(execFile);

/**
 * Through the ordinary command line, with no supervisor override: every run gets a child HOME
 * of its own, carries it through its children, and leaves nothing of it for the next run.
 * What a run's child writes under its HOME is read back by the same run's later child and is
 * absent for another run; two runs at once never meet; a finished run's home is gone and an
 * explicit override that cannot be used is refused before anything runs.
 */
let scratch = "";
let home = "";
let scratchTmp = "";
const endpoints: ScriptedEndpoint[] = [];

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-child-home-cli-"));
  home = join(scratch, "home");
  scratchTmp = join(scratch, "tmp");
  await mkdir(home, { recursive: true });
  await mkdir(scratchTmp, { recursive: true });
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

async function workspace(name: string): Promise<string> {
  const directory = join(scratch, name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name, version: "1.0.0", type: "module", scripts: { test: "node --test" } }),
  );
  await writeFile(
    join(directory, "value.test.mjs"),
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('holds', () => assert.equal(1, 1));\n",
  );
  await git(directory, "init", "-q");
  await git(directory, "add", "-A");
  await git(directory, "commit", "-qm", "base");
  return directory;
}

/** The scripted model: declare, run one shell probe about its HOME, write a note, finish. */
function script(probe: string) {
  return [
    {
      text: "Plan: probe the home, then write the note.",
      toolCalls: [{ name: "declare_file_set", input: { files: ["notes.txt"] } }],
    },
    { toolCalls: [{ name: "shell", input: { command: `node -e "${probe}"` } }] },
    { toolCalls: [{ name: "write", input: { path: "notes.txt", content: "done\n" } }] },
    { text: "Wrote the note.", toolCalls: [] },
  ];
}

const writeSentinel =
  "require('fs').writeFileSync(require('os').homedir()+'/sentinel','x');console.log('home='+require('os').homedir())";
const readSentinel =
  "console.log('home='+require('os').homedir()+' sentinel='+require('fs').existsSync(require('os').homedir()+'/sentinel'))";

async function swarm(
  directory: string,
  endpoint: ScriptedEndpoint,
  extraEnv: Record<string, string> = {},
): Promise<{ code: number; output: string }> {
  const args = [
    resolve("src/cli.ts"),
    "--workspace",
    directory,
    "--model",
    `local:${endpoint.modelId}`,
    "--local-endpoint",
    endpoint.url,
    "--approve",
    "auto",
    "--no-tui",
    "--no-open-evidence",
    "--json",
    "--max-steps",
    "8",
    "probe the home and write a note",
  ];
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    TMPDIR: scratchTmp,
    NO_COLOR: "1",
    ...extraEnv,
  };
  try {
    const ran = await run(process.execPath, args, { cwd: directory, env, timeout: 180_000 });
    return { code: 0, output: `${ran.stdout}${ran.stderr}` };
  } catch (cause) {
    const failed = cause as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, output: `${failed.stdout ?? ""}${failed.stderr ?? ""}` };
  }
}

interface SessionReading {
  readonly sessionId: string;
  readonly envelope: {
    childHome: string;
    childHomeState?: { mode: string; origin: string; runId: string; npmCache: string | null };
  };
  readonly shellOutputs: readonly string[];
}

/** The run's own record of its envelope and what its shell children printed, off the ledger. */
function readSession(sessionId: string, operatorHome = home): SessionReading {
  const directory = join(operatorHome, ".swarm", "sessions", sessionId);
  const records = readFileSync(join(directory, "ledger.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; payloadDigest: string });
  const payload = (digest: string) =>
    JSON.parse(readFileSync(join(directory, "blobs", `${digest.slice(7)}.json`), "utf8"));
  const envelope = records.find((record) => record.type === "execution-envelope");
  if (envelope === undefined) throw new Error(`${sessionId} recorded no execution envelope`);
  const shellOutputs = records
    .filter((record) => record.type === "tool-call")
    .map((record) => payload(record.payloadDigest) as { toolName: string; output: string })
    .filter((call) => call.toolName === "shell" && call.output.length > 0)
    .map((call) => call.output);
  return { sessionId, envelope: payload(envelope.payloadDigest), shellOutputs };
}

function sessionOf(output: string): string {
  const result = output
    .split("\n")
    .reverse()
    .map((line) => {
      try {
        return JSON.parse(line) as { schema?: string; runId?: string };
      } catch {
        return null;
      }
    })
    .find((parsed) => parsed?.schema === "swarm.result.v1");
  if (result?.runId === undefined) throw new Error(`no result line in:\n${output}`);
  return result.runId;
}

describe("the child HOME of an ordinary run", () => {
  it("is private to the run, carried to its children, absent for the next run, and gone when the run ends", async () => {
    const first = await startScriptedEndpoint({ modelId: "stub", turns: script(writeSentinel) });
    endpoints.push(first);
    const one = await swarm(await workspace("one"), first);
    expect(one.output).not.toContain("not an absolute path");
    const firstReading = readSession(sessionOf(one.output));
    expect(firstReading.envelope.childHomeState).toMatchObject({
      mode: "private",
      origin: "created",
      runId: firstReading.sessionId,
    });
    expect(firstReading.envelope.childHome).toBe(
      join(scratchTmp, "swarm-child-homes", firstReading.sessionId),
    );
    // The child saw the run's own HOME, not the operator's and not a shared default.
    expect(firstReading.shellOutputs.join("\n")).toContain(
      `home=${firstReading.envelope.childHome}`,
    );
    // The run ended, so the home it allocated is released.
    expect(existsSync(firstReading.envelope.childHome)).toBe(false);

    const second = await startScriptedEndpoint({ modelId: "stub", turns: script(readSentinel) });
    endpoints.push(second);
    const two = await swarm(await workspace("two"), second);
    const secondReading = readSession(sessionOf(two.output));
    expect(secondReading.envelope.childHome).not.toBe(firstReading.envelope.childHome);
    expect(secondReading.shellOutputs.join("\n")).toContain("sentinel=false");
    expect(existsSync(secondReading.envelope.childHome)).toBe(false);
    // The content-addressed npm store is the one thing the two homes shared.
    expect(secondReading.envelope.childHomeState?.npmCache).toBe(
      firstReading.envelope.childHomeState?.npmCache,
    );
  }, 240_000);

  it("keeps two concurrent runs apart and lets each remove only its own home", async () => {
    const a = await startScriptedEndpoint({ modelId: "stub", turns: script(writeSentinel) });
    const b = await startScriptedEndpoint({ modelId: "stub", turns: script(writeSentinel) });
    endpoints.push(a, b);
    // Two operators' runs at once: the run store under one operator home serializes its
    // writers, which is that store's rule and not the question here. The child homes share
    // one root under the same scratch, which is where two runs could meet.
    const homeLeft = join(scratch, "home-left");
    const homeRight = join(scratch, "home-right");
    await mkdir(homeLeft, { recursive: true });
    await mkdir(homeRight, { recursive: true });
    const [one, two] = await Promise.all([
      swarm(await workspace("left"), a, { HOME: homeLeft }),
      swarm(await workspace("right"), b, { HOME: homeRight }),
    ]);
    const left = readSession(sessionOf(one.output), homeLeft);
    const right = readSession(sessionOf(two.output), homeRight);
    expect(left.envelope.childHome).not.toBe(right.envelope.childHome);
    expect(left.shellOutputs.join("\n")).toContain(`home=${left.envelope.childHome}`);
    expect(right.shellOutputs.join("\n")).toContain(`home=${right.envelope.childHome}`);
    expect(existsSync(left.envelope.childHome)).toBe(false);
    expect(existsSync(right.envelope.childHome)).toBe(false);
    // Nothing else under the root was touched by either run's release.
    const root = join(scratchTmp, "swarm-child-homes");
    expect(readdirSync(root).filter((entry) => entry !== "npm-cache")).toEqual([]);
  }, 240_000);

  it("uses an explicit SWARM_CHILD_HOME as a caller-selected home, recorded as such and never removed", async () => {
    const named = join(scratch, "named-home");
    const endpoint = await startScriptedEndpoint({ modelId: "stub", turns: script(writeSentinel) });
    endpoints.push(endpoint);
    const ran = await swarm(await workspace("explicit"), endpoint, { SWARM_CHILD_HOME: named });
    const reading = readSession(sessionOf(ran.output));
    expect(reading.envelope.childHome).toBe(named);
    expect(reading.envelope.childHomeState).toMatchObject({ mode: "explicit", origin: "named" });
    expect(existsSync(join(named, "sentinel"))).toBe(true);
  }, 240_000);

  it("refuses a relative SWARM_CHILD_HOME before any model or child runs", async () => {
    const endpoint = await startScriptedEndpoint({ modelId: "stub", turns: script(writeSentinel) });
    endpoints.push(endpoint);
    const ran = await swarm(await workspace("relative"), endpoint, {
      SWARM_CHILD_HOME: "relative/home",
    });
    expect(ran.code).not.toBe(0);
    expect(ran.output).toContain("not an absolute path");
    expect(endpoint.played()).toBe(0);
  }, 120_000);
});
