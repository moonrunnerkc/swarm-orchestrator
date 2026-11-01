import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Message, ModelClient } from "./model.ts";
import { completionMarker } from "./prompt.ts";
import { type RunOptions, runAgent } from "./run.ts";

/** A reply the endpoint split: its content, and what a reasoning parser moved out of it. */
export interface SplitReply {
  readonly content: string;
  readonly reasoning: string;
}

/** A model that replies from a script, repeating its last reply, and keeps what it was shown. */
export function scripted(
  replies: readonly (string | SplitReply)[],
): ModelClient & { seen: Message[][] } {
  const seen: Message[][] = [];
  return {
    model: "scripted",
    seen,
    async complete(messages) {
      seen.push([...messages]);
      const next = replies[seen.length - 1] ?? replies.at(-1) ?? "";
      return {
        ...(typeof next === "string" ? { content: next } : next),
        inputTokens: 90,
        outputTokens: 10,
        inferenceMs: 1,
        retries: 0,
        truncated: false,
      };
    },
  };
}

export const bash = (command: string) => `\`\`\`bash\n${command}\n\`\`\``;
export const write = (path: string, body: string) => bash(`cat > ${path} <<'EOF'\n${body}\nEOF`);
/** A requirement record proposal followed by the completion marker. */
export const recordAndComplete = (requirements: readonly object[]) =>
  `\`\`\`requirements\n${JSON.stringify(requirements)}\n\`\`\`\n${completionMarker}`;

export const halfTest = (name = "half") =>
  `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { half } from "../half.mjs";\ntest("${name}", () => assert.equal(half(4), 2));\n`;

export interface Fixture {
  readonly root: string;
  readonly repo: string;
  git(...args: string[]): string;
  put(path: string, text: string): Promise<void>;
  run(model: ModelClient, extra?: Partial<RunOptions>): ReturnType<typeof runAgent>;
}

process.env.SWARM_SIGNING_KEY ??= generateKeyPairSync("ed25519")
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();

/** Where isolated runs keep their fixtures: under the user's home, which a docker VM shares. */
export const isolatedParent = join(homedir(), ".swarm", "test-work-agent");

/**
 * A repository with `half(n)` broken and one node:test test that says so, committed as the base.
 * An isolated fixture lives under the user's home so its verifier home can be mounted.
 */
export async function fixture(
  files: Readonly<Record<string, string>> = {},
  task = "Make half(n) return n / 2.",
  isolation: "isolated" | "host" = "host",
): Promise<Fixture> {
  const parent = isolation === "isolated" ? isolatedParent : tmpdir();
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "agent-run-"));
  const repo = join(root, "repo");
  await mkdir(repo, { recursive: true });
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  const put = async (path: string, text: string) => {
    await mkdir(join(repo, path, ".."), { recursive: true });
    await writeFile(join(repo, path), text);
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  const base = {
    "swarm.toml": '[checks]\ntest = "node --test"\n',
    "half.mjs": "export const half = (n) => n;\n",
    "test/half.test.mjs": halfTest(),
    ...files,
  };
  for (const [path, text] of Object.entries(base)) await put(path, text);
  git("add", "-A");
  git("commit", "-qm", "base");
  return {
    root,
    repo,
    git,
    put,
    run: (model, extra = {}) => {
      process.env.SWARM_HOME = join(root, "home");
      return runAgent({
        workspace: repo,
        task,
        model,
        modelReason: "scripted for the test",
        cost: "none (scripted)",
        maxSteps: 10,
        maxTokens: 100_000,
        turnTokens: 1000,
        maxWallMs: null,
        contextTokens: 32_768,
        apply: false,
        isolation,
        approval: "auto",
        confirm: null,
        version: "test",
        log: () => {},
        ...extra,
      });
    },
  };
}
