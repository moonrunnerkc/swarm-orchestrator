import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { authorPrompt } from "./author-prompt.ts";
import type { Message, ModelClient } from "./model.ts";
import { completionMarker } from "./prompt.ts";
import { type RunOptions, runAgent } from "./run.ts";

/** A reply the endpoint split: its content, and what a reasoning parser moved out of it. */
export interface SplitReply {
  readonly content: string;
  readonly reasoning: string;
}

/**
 * A model that replies from a script, repeating its last reply, and keeps what it was shown. It
 * reports 90 input and 10 output tokens a turn, or no counts at all, as some runtimes do. The
 * check author's calls are answered from their own script, apart from the loop's, and kept apart:
 * by default it writes the check an author would for the fixture's task, `authoredHalf`.
 */
export function scripted(
  replies: readonly (string | SplitReply)[],
  options: {
    readonly counts?: "reported" | "unreported";
    readonly author?: readonly string[];
  } = {},
): ModelClient & { seen: Message[][]; authorSeen: Message[][] } {
  const seen: Message[][] = [];
  const authorSeen: Message[][] = [];
  const reported = (options.counts ?? "reported") === "reported";
  const authorReplies = options.author ?? [authoredHalf];
  return {
    model: "scripted",
    seen,
    authorSeen,
    async complete(messages) {
      const authoring = messages[0]?.content === authorPrompt;
      const log = authoring ? authorSeen : seen;
      log.push([...messages]);
      const script = authoring ? authorReplies : replies;
      const next = script[log.length - 1] ?? script.at(-1) ?? "";
      return {
        ...(typeof next === "string" ? { content: next } : next),
        inputTokens: reported ? 90 : null,
        outputTokens: reported ? 10 : null,
        inferenceMs: 1,
        retries: 0,
        truncated: false,
      };
    },
  };
}

/**
 * A model a test wrote by hand, with the check author's call answered for it by `authoredHalf`,
 * since what the test exercises is the loop and not the author.
 */
export function answeringAuthor(model: ModelClient): ModelClient {
  return {
    model: model.model,
    complete: (messages, options) =>
      messages[0]?.content === authorPrompt
        ? Promise.resolve({
            content: authoredHalf,
            inputTokens: 90,
            outputTokens: 10,
            inferenceMs: null,
            retries: 0,
            truncated: false,
          })
        : model.complete(messages, options),
  };
}

/** An author's reply that names a kind and writes nothing: no independent check results. */
export const noAuthoredCheck = "kind: other";

/** An author's reply that writes one test file, run beside the fixture's own test. */
export const authorTest = (kind: string, test: string) =>
  `kind: ${kind}\n\n\`\`\`test\n${test}\`\`\`\n`;

/** The check an author would write for the fixture's task, apart from any change. */
export const authoredHalf = authorTest("fix", halfTestText("half(4) is 2, written apart"));

export const bash = (command: string) => `\`\`\`bash\n${command}\n\`\`\``;
export const write = (path: string, body: string) => bash(`cat > ${path} <<'EOF'\n${body}\nEOF`);
/** A requirement record proposal followed by the completion marker. */
export const recordAndComplete = (requirements: readonly object[]) =>
  `\`\`\`requirements\n${JSON.stringify(requirements)}\n\`\`\`\n${completionMarker}`;

export const halfTest = (name = "half") => halfTestText(name);

function halfTestText(name: string): string {
  return `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { half } from "../half.mjs";\ntest("${name}", () => assert.equal(half(4), 2));\n`;
}

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

/**
 * Where isolated runs keep their fixtures: under the user's home, which a docker VM shares, and
 * apart for each test process, since the suite removes it and other checkouts run at once.
 */
export const isolatedParent = join(homedir(), ".swarm", "test-work-agent", `${process.pid}`);

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
        model: "authorSeen" in model ? model : answeringAuthor(model),
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

/** For a fake chokepoint whose test's model sends no edit block: one arriving is the test's error. */
export const noEdits = {
  async edit(): Promise<never> {
    throw new Error("this test's model sends no edit block");
  },
  ...noChecks(),
};

/** A harness check that passes, for doubles whose tests do not exercise the harness's checks. */
export function noChecks() {
  let calls = 0;
  return {
    async check() {
      calls += 1;
      return {
        decision: "allowed" as const,
        output: "",
        exitCode: 0,
        record: `sha256:check-${calls}`,
      };
    },
  };
}
