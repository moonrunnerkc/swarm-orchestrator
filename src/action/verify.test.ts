import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readActionContext } from "./environment.ts";
import { defaultDependencies, publishOutputs, runActionVerify } from "./verify.ts";
import { verdictSchema } from "./verdict.ts";

const run = promisify(execFile);

/**
 * The Action's producer step, run for real: a pull request event over a local repository, the
 * objects fetched by commit id into an owned checkout, the verifier run over them with host
 * isolation named explicitly, and the report, summary and verdict written and bound. No
 * GitHub is involved; the event payload and the runner environment are what GitHub would
 * have written, and the source URL points at the local repository.
 */
let scratch = "";
let origin = "";
let baseSha = "";
let goodHead = "";
let badHead = "";

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const ran = await run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd,
  });
  return ran.stdout.trim();
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-action-"));
  origin = join(scratch, "origin");
  await mkdir(origin);
  await git(origin, ["init", "-q", "-b", "main"]);
  await writeFile(
    join(origin, "package.json"),
    '{ "name": "w", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test" } }\n',
  );
  await writeFile(join(origin, "double.mjs"), "export const double = (n) => n + n;\n");
  await writeFile(
    join(origin, "double.test.mjs"),
    [
      'import test from "node:test";',
      'import assert from "node:assert/strict";',
      'import { double } from "./double.mjs";',
      'test("doubles", () => assert.equal(double(2), 4));',
      "",
    ].join("\n"),
  );
  await git(origin, ["add", "-A"]);
  await git(origin, ["commit", "-qm", "base"]);
  baseSha = await git(origin, ["rev-parse", "HEAD"]);
  await git(origin, ["checkout", "-q", "-b", "good"]);
  await writeFile(join(origin, "double.mjs"), "export const double = (n) => n * 2;\n");
  await git(origin, ["commit", "-qam", "good"]);
  goodHead = await git(origin, ["rev-parse", "HEAD"]);
  await git(origin, ["checkout", "-q", "main"]);
  await git(origin, ["checkout", "-q", "-b", "bad"]);
  await writeFile(join(origin, "double.mjs"), "export const double = (n) => n * 3;\n");
  await git(origin, ["commit", "-qam", "bad"]);
  badHead = await git(origin, ["rev-parse", "HEAD"]);
  await git(origin, ["checkout", "-q", "main"]);
  // Fetching by commit id from a local repository needs the same allowance GitHub grants.
  await git(origin, ["config", "uploadpack.allowReachableSHA1InWant", "true"]);
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function environment(head: string, number: number, extra: Record<string, string> = {}) {
  const temp = await mkdtemp(join(scratch, "runner-"));
  const event = join(temp, "event.json");
  await writeFile(
    event,
    JSON.stringify({
      pull_request: {
        number,
        head: { sha: head, repo: { full_name: "owner/repo", fork: false } },
        base: { sha: baseSha, repo: { full_name: "owner/repo" } },
      },
    }),
  );
  const outputs = join(temp, "output.txt");
  const summary = join(temp, "summary.md");
  await writeFile(outputs, "");
  await writeFile(summary, "");
  return {
    env: {
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: event,
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_RUN_ID: "42",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_WORKFLOW_REF: "owner/repo/.github/workflows/verify.yml@refs/pull/1/merge",
      RUNNER_ENVIRONMENT: "github-hosted",
      RUNNER_TEMP: temp,
      GITHUB_OUTPUT: outputs,
      GITHUB_STEP_SUMMARY: summary,
      SWARM_INPUT_ISOLATION: "host",
      SWARM_INPUT_SOURCE_URL: `file://${origin}`,
      SWARM_INPUT_TOKEN: "",
      ...extra,
    },
    outputs,
    summary,
  };
}

const deps = { ...defaultDependencies, entry: resolve("src/swarm-verify.ts") };

describe("the Action's verify step", () => {
  it("fetches the pull request's objects, verifies the head, and writes a bound verdict", async () => {
    const runner = await environment(goodHead, 1);
    const context = await readActionContext(runner.env);
    const outputs = runActionVerify(context, deps);
    publishOutputs(context, outputs);

    expect(outputs.head).toBe(goodHead);
    expect(outputs.base).toBe(baseSha);
    const verdict = verdictSchema.parse(JSON.parse(await readFile(outputs.verdict, "utf8")));
    expect(verdict.decision.regression).toBe("pass");
    expect(verdict.decision.task).toBe("unjudged");
    expect(verdict.decision.result).toBe("regression-only");
    expect(verdict.decision.status).toBe(0);
    expect(verdict.decision.verifierStatus).toBe(1);
    expect(verdict.decision.unmeasured).toContain("task");
    expect(verdict.tree).toMatch(/^[0-9a-f]{40}$/);
    expect(verdict.policy.isolation).toBe("host");
    expect(verdict.execution.executionTrust).toBe("restricted");
    expect(verdict.evidence.bundleChainHead).toMatch(/^sha256:/);
    const report = await readFile(outputs.report, "utf8");
    expect(verdict.evidence.reportDigest).toBe(
      `sha256:${(await import("node:crypto")).createHash("sha256").update(report).digest("hex")}`,
    );
    const written = await readFile(runner.outputs, "utf8");
    expect(written).toContain(`head=${goodHead}`);
    expect(written).toContain("result=regression-only");
    expect(await readFile(runner.summary, "utf8")).toContain("Swarm verification");
    // The candidate's objects live in a checkout the Action made, never in the runner's own tree.
    expect(outputs.directory.startsWith(runner.env.RUNNER_TEMP)).toBe(true);
  }, 120_000);

  it("exits 1 on a regression-only pass when the consumer requires a task judgement", async () => {
    const runner = await environment(goodHead, 6, { SWARM_INPUT_REQUIRE_TASK: "true" });
    const outputs = runActionVerify(await readActionContext(runner.env), deps);
    expect(outputs.result).toBe("regression-only");
    expect(outputs.status).toBe(1);
  }, 120_000);

  it("reports a failing head as not verified with the failed check named", async () => {
    const runner = await environment(badHead, 2);
    const outputs = runActionVerify(await readActionContext(runner.env), deps);
    const verdict = verdictSchema.parse(JSON.parse(await readFile(outputs.verdict, "utf8")));
    expect(verdict.decision.result).toBe("not-verified");
    expect(verdict.decision.regression).toBe("fail");
    expect(outputs.status).toBe(1);
  }, 120_000);

  it("refuses a head it cannot fetch, with the reason in the verdict and nothing run", async () => {
    const runner = await environment("9".repeat(40), 3);
    const outputs = runActionVerify(await readActionContext(runner.env), deps);
    const verdict = verdictSchema.parse(JSON.parse(await readFile(outputs.verdict, "utf8")));
    expect(verdict.decision.result).toBe("refused");
    expect(verdict.decision.reason).toContain("could not be fetched");
    expect(verdict.evidence.reportDigest).toBeNull();
    expect(outputs.status).toBe(4);
  }, 60_000);

  it("refuses a runner that is not GitHub-hosted unless told so knowingly", async () => {
    const runner = await environment(goodHead, 4, { RUNNER_ENVIRONMENT: "self-hosted" });
    expect(() => runActionVerify(runner.env as never, deps)).toThrow();
    await expect(
      readActionContext(runner.env).then((context) => runActionVerify(context, deps)),
    ).rejects.toThrow(/GitHub-hosted/);
  });

  it("refuses to run candidate code on the host under pull_request_target", async () => {
    const runner = await environment(goodHead, 5, { GITHUB_EVENT_NAME: "pull_request_target" });
    await expect(
      readActionContext(runner.env).then((context) => runActionVerify(context, deps)),
    ).rejects.toThrow(/docker isolation/);
  });
});
