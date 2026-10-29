import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Message, ModelClient } from "./model.ts";
import { completionMarker } from "./prompt.ts";
import { runAgent } from "./run.ts";

let root = "";
let repo = "";
const saved = { home: process.env.SWARM_HOME, key: process.env.SWARM_SIGNING_KEY };

beforeAll(() => {
  process.env.SWARM_SIGNING_KEY = generateKeyPairSync("ed25519")
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
});
afterAll(() => {
  for (const [name, value] of [
    ["SWARM_HOME", saved.home],
    ["SWARM_SIGNING_KEY", saved.key],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "agent-run-"));
  repo = join(root, "repo");
  process.env.SWARM_HOME = join(root, "home");
  await mkdir(join(repo, "test"), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  await writeFile(join(repo, "swarm.toml"), '[checks]\ntest = "node --test"\n');
  await writeFile(join(repo, "half.mjs"), "export const half = (n) => n;\n");
  await writeFile(
    join(repo, "test", "half.test.mjs"),
    'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { half } from "../half.mjs";\ntest("half", () => assert.equal(half(4), 2));\n',
  );
  git("add", "-A");
  git("commit", "-qm", "base");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A model that replies from a script and keeps every conversation it was shown. */
function scripted(replies: readonly string[]): ModelClient & { seen: Message[][] } {
  const seen: Message[][] = [];
  return {
    model: "scripted",
    seen,
    async complete(messages) {
      seen.push([...messages]);
      return {
        content: replies[seen.length - 1] ?? replies.at(-1) ?? "",
        tokens: 100,
        truncated: false,
      };
    },
  };
}

const write = (body: string) => `\`\`\`bash\ncat > half.mjs <<'EOF'\n${body}\nEOF\n\`\`\``;
const run = (model: ModelClient, maxSteps = 10, maxTokens = 100_000) =>
  runAgent({
    workspace: repo,
    task: "Make half(n) return n / 2.",
    model,
    maxSteps,
    maxTokens,
    turnTokens: 1000,
    approval: "ask",
    confirm: null,
    version: "test",
    log: () => {},
  });

describe("swarm run", () => {
  it("stops verified once the verifier passes the working tree", async () => {
    const model = scripted([write("export const half = (n) => n / 2;"), completionMarker]);
    const report = await run(model);
    expect(report).toMatchObject({ stop: "verified", steps: 2, verifications: 1, tokens: 200 });
    expect(await readFile(join(repo, "half.mjs"), "utf8")).toContain("n / 2");
    expect(report.attestation).not.toBeNull();
  });

  it("hands a refusal back verbatim and continues from the same budgets", async () => {
    const model = scripted([
      write("export const half = (n) => n * 2;"),
      completionMarker,
      write("export const half = (n) => n / 2;"),
      completionMarker,
    ]);
    const report = await run(model);
    expect(report).toMatchObject({ stop: "verified", steps: 4, verifications: 2 });
    const afterRefusal = model.seen[2]?.at(-1)?.content ?? "";
    expect(afterRefusal).toContain("Most recent verifier failure:");
    expect(afterRefusal).toContain("check test failed");
  });

  it("reports the step budget when it runs out", async () => {
    const report = await run(scripted(["```bash\nls\n```"]), 3);
    expect(report).toMatchObject({ stop: "step-budget", steps: 3, verifications: 0 });
  });

  it("reports the token budget when it runs out", async () => {
    const report = await run(scripted(["```bash\nls\n```"]), 50, 250);
    expect(report).toMatchObject({ stop: "token-budget", steps: 3 });
  });

  it("never renders a pass from the model's own say-so", async () => {
    const report = await run(scripted([`It is fixed and all tests pass.\n${completionMarker}`]));
    expect(report.stop).not.toBe("verified");
  });

  it("names the changed line whose mutant the checks did not kill", async () => {
    const both = "export const half = (n) => (n >= 0 ? n / 2 : n / 2);";
    const report = await run(scripted([write(both), completionMarker]));
    expect(report).toMatchObject({ stop: "verified" });
    expect(report.verification?.survivedMutant).toBe("half.mjs:1");
  });
});
