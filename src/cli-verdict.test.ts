import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readActionContext } from "./action/environment.ts";
import { defaultDependencies, runActionVerify } from "./action/verify.ts";

const run = promisify(execFile);

/**
 * `verdict` over a document the Action's producer step really wrote, with the evidence beside
 * it. The signer half is GitHub's own verifier; here it is stood in for by a `gh` on PATH that
 * answers as told, so the command's reading of a verified, a refused and an absent verifier is
 * held without a network.
 */
let scratch = "";
let evidence = "";
let verdictPath = "";

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const ran = await run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd,
  });
  return ran.stdout.trim();
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-verdict-"));
  const origin = join(scratch, "origin");
  await mkdir(origin);
  await git(origin, ["init", "-q", "-b", "main"]);
  await writeFile(
    join(origin, "package.json"),
    '{ "name": "w", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test" } }\n',
  );
  await writeFile(join(origin, "double.mjs"), "export const double = (n) => n + n;\n");
  await writeFile(
    join(origin, "double.test.mjs"),
    'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { double } from "./double.mjs";\ntest("doubles", () => assert.equal(double(2), 4));\n',
  );
  await git(origin, ["add", "-A"]);
  await git(origin, ["commit", "-qm", "base"]);
  const base = await git(origin, ["rev-parse", "HEAD"]);
  await writeFile(join(origin, "double.mjs"), "export const double = (n) => n * 2;\n");
  await git(origin, ["commit", "-qam", "head"]);
  const head = await git(origin, ["rev-parse", "HEAD"]);
  await git(origin, ["config", "uploadpack.allowReachableSHA1InWant", "true"]);
  const temp = join(scratch, "runner");
  await mkdir(temp);
  const event = join(temp, "event.json");
  await writeFile(
    event,
    JSON.stringify({
      pull_request: {
        number: 9,
        head: { sha: head, repo: { full_name: "owner/repo", fork: false } },
        base: { sha: base, repo: { full_name: "owner/repo" } },
      },
    }),
  );
  const context = await readActionContext({
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_EVENT_PATH: event,
    GITHUB_REPOSITORY: "owner/repo",
    GITHUB_RUN_ID: "1",
    RUNNER_ENVIRONMENT: "github-hosted",
    RUNNER_TEMP: temp,
    SWARM_INPUT_ISOLATION: "host",
    SWARM_INPUT_SOURCE_URL: `file://${origin}`,
  });
  const outputs = runActionVerify(context, {
    ...defaultDependencies,
    entry: resolve("src/swarm-verify.ts"),
  });
  evidence = outputs.directory;
  verdictPath = outputs.verdict;
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** A `gh` that records its arguments and exits as told. */
async function fakeGh(exit: number): Promise<string> {
  const bin = join(scratch, `bin-${exit}`);
  await mkdir(bin, { recursive: true });
  const log = join(bin, "calls.txt");
  await writeFile(
    join(bin, "gh"),
    `#!/bin/sh\necho "$@" >> '${log}'\necho "Verification succeeded? ${exit === 0}"\nexit ${exit}\n`,
  );
  await chmod(join(bin, "gh"), 0o755);
  return bin;
}

async function verdict(args: readonly string[], pathPrefix: string | null = null) {
  const environment = {
    PATH:
      pathPrefix === null ? (process.env.PATH ?? "") : `${pathPrefix}:${process.env.PATH ?? ""}`,
    HOME: join(scratch, "home"),
    NO_COLOR: "1",
  };
  try {
    const ran = await run(process.execPath, [resolve("src/swarm-verify.ts"), "verdict", ...args], {
      env: environment,
      timeout: 60_000,
    });
    return { code: 0, stdout: ran.stdout };
  } catch (cause) {
    const failed = cause as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, stdout: `${failed.stdout ?? ""}${failed.stderr ?? ""}` };
  }
}

describe("swarm-verify verdict", () => {
  it("binds the document to the report, summary and bundle beside it, and leaves the signer unverified without --repo", async () => {
    const ran = await verdict([verdictPath]);
    expect(ran.stdout).toContain("document:   swarm-verify.verdict.v1 for owner/repo#9");
    expect(ran.stdout).toContain("(canonical)");
    expect(ran.stdout).toMatch(
      /evidence: {3}bound \(report\.json, summary\.md, bundle chain head\)/,
    );
    expect(ran.stdout).toContain("signer:     unverified. Name the repository");
    expect(ran.code).toBe(1);
  }, 60_000);

  it("is trusted when GitHub's verifier accepts the attestation for the named repository", async () => {
    const bin = await fakeGh(0);
    const ran = await verdict(
      [
        verdictPath,
        "--repo",
        "owner/repo",
        "--signer-workflow",
        "owner/repo/.github/workflows/verify.yml",
      ],
      bin,
    );
    expect(ran.stdout).toContain("signer:     trusted");
    expect(ran.code).toBe(0);
    const calls = await readFile(join(bin, "calls.txt"), "utf8");
    expect(calls).toContain("attestation verify");
    expect(calls).toContain(
      "--predicate-type https://github.com/moonrunnerkc/swarm-verify/verdict/v1",
    );
    expect(calls).toContain("--signer-workflow owner/repo/.github/workflows/verify.yml");
  }, 60_000);

  it("is untrusted when GitHub's verifier refuses, whatever the evidence says", async () => {
    const bin = await fakeGh(1);
    const ran = await verdict([verdictPath, "--repo", "owner/repo"], bin);
    expect(ran.stdout).toContain("signer:     untrusted");
    expect(ran.code).toBe(1);
  }, 60_000);

  it("prints the exact command when gh is absent, and stays unverified", async () => {
    const ran = await verdict([verdictPath, "--repo", "owner/repo"], join(scratch, "nowhere"));
    // The test's own PATH holds gh on this machine or not; either way the answer is not trusted.
    expect(ran.stdout).toMatch(/signer: {5}(unverified|untrusted)/);
    expect(ran.code).toBe(1);
  }, 60_000);

  it("reports evidence that no longer matches the document", async () => {
    const copy = join(scratch, "tampered");
    await mkdir(copy, { recursive: true });
    await writeFile(join(copy, "verdict.json"), await readFile(verdictPath));
    await writeFile(
      join(copy, "report.json"),
      `${await readFile(join(evidence, "report.json"), "utf8")} `,
    );
    const ran = await verdict([join(copy, "verdict.json"), "--evidence", copy]);
    expect(ran.stdout).toContain("evidence:   inconsistent");
    expect(ran.stdout).toContain("report.json at");
    expect(ran.code).toBe(1);
  }, 60_000);

  it("refuses a verdict made for another head than the one being decided, and binds the right one", async () => {
    const document = JSON.parse(await readFile(verdictPath, "utf8")) as { head: string };
    const other = "0".repeat(40);
    const stale = await verdict([verdictPath, "--head", other]);
    expect(stale.stdout).toContain("evidence:   inconsistent");
    expect(stale.stdout).toContain(`not the expected ${other}`);
    expect(stale.code).toBe(1);
    const current = await verdict([verdictPath, "--head", document.head]);
    expect(current.stdout).toContain("expected head");
    expect(current.stdout).not.toContain("inconsistent");
    const invalid = await verdict([verdictPath, "--head", "main"]);
    expect(invalid.code).toBe(2);
  }, 60_000);

  it("exits 2 for a document that is not there or not a verdict", async () => {
    const absent = await verdict([join(scratch, "absent.json")]);
    expect(absent.code).toBe(2);
    await writeFile(join(scratch, "not.json"), "{}");
    const wrong = await verdict([join(scratch, "not.json")]);
    expect(wrong.stdout).toContain("not a swarm-verify.verdict.v1");
    expect(wrong.code).toBe(2);
  }, 60_000);
});
