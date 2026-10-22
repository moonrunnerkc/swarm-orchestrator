import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { commandLog } from "../campaign/exec.mjs";
import { hiddenVerdict, structuredRewriteOf } from "./checks.mjs";
import { validateTask } from "./validate.mjs";
import { cloneAtBase, mirrorOf } from "./workspace.mjs";

/**
 * The scorer and the validator against a tiny task repository, in process. The mirror has to be
 * where the harness looks (`mirrorOf`, under the comparison root in the real home), so each case
 * mirrors under a repository name of its own and removes it after.
 */
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd, ...args) {
  const ran = spawnSync(
    "git",
    ["-c", "user.name=fixture", "-c", "user.email=fixture@localhost", ...args],
    { cwd, encoding: "utf8" },
  );
  if (ran.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${ran.stderr}`);
  return ran.stdout.trim();
}

/** A base that fails the hidden oracle and an upstream child that passes it, mirrored bare. */
function mirrorTask(repository, { upstreamExtra = () => {} } = {}) {
  const source = mkdtempSync(join(tmpdir(), "checks-source-"));
  roots.push(source);
  writeFileSync(
    join(source, "package.json"),
    `${JSON.stringify({ name: "calc", type: "module", version: "1.0.0", scripts: { test: "node test/run.mjs" } })}\n`,
  );
  writeFileSync(
    join(source, "calc.mjs"),
    "export const add = (a, b) => a - b;\nexport const mul = (a, b) => a * b;\n",
  );
  mkdirSync(join(source, "test"));
  writeFileSync(
    join(source, "test/run.mjs"),
    'import { mul } from "../calc.mjs";\nif (mul(2, 3) !== 6) { console.error("mul"); process.exit(1); }\n',
  );
  git(source, "init", "-q");
  git(source, "add", "--all");
  git(source, "commit", "-qm", "base");
  const base = git(source, "rev-parse", "HEAD");
  writeFileSync(
    join(source, "calc.mjs"),
    "export const add = (a, b) => a + b;\nexport const mul = (a, b) => a * b;\n",
  );
  writeFileSync(
    join(source, "test/add.test.mjs"),
    'import { add } from "../calc.mjs";\nif (add(2, 3) !== 5 || add(1, 1) !== 2) { console.error("add"); process.exit(1); }\n',
  );
  upstreamExtra(source);
  git(source, "add", "--all");
  git(source, "commit", "-qm", "fix add");
  const upstream = git(source, "rev-parse", "HEAD");
  const mirror = mirrorOf(repository);
  mkdirSync(dirname(mirror), { recursive: true });
  git(source, "clone", "--quiet", "--bare", source, mirror);
  roots.push(mirror);
  return { base, upstream };
}

function task(id, repository, commits) {
  return {
    id,
    repository,
    workType: "bugfix",
    baseCommit: commits.base,
    upstreamCommit: commits.upstream,
    install: [["true"]],
    build: [],
    projectTest: ["node", "test/run.mjs"],
    visiblePrefix: "",
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "node acceptance/visible/check.mjs",
      source:
        'import { add } from "../../calc.mjs";\nif (add(2, 3) !== 5) { console.error("add(2, 3) is " + add(2, 3)); process.exit(1); }\n',
    },
    hidden: { testFiles: ["test/add.test.mjs"], argv: ["node", "test/add.test.mjs"] },
    immutable: [],
    taskText:
      "add(a, b) in calc.mjs subtracts instead of adding; make it add and keep mul as it is.",
  };
}

const unique = () =>
  `fixture/checks-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const log = () => {
  const blobs = mkdtempSync(join(tmpdir(), "checks-blobs-"));
  roots.push(blobs);
  return commandLog(blobs);
};

const fix =
  "diff --git a/calc.mjs b/calc.mjs\n--- a/calc.mjs\n+++ b/calc.mjs\n@@ -1,2 +1,2 @@\n-export const add = (a, b) => a - b;\n+export const add = (a, b) => a + b;\n export const mul = (a, b) => a * b;\n";

const newFile = (path, content) =>
  `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${content.split("\n").length - 1} @@\n${content
    .split("\n")
    .slice(0, -1)
    .map((line) => `+${line}`)
    .join("\n")}\n`;

describe("hidden evaluation material", () => {
  it("is not in an arm's workspace: neither the sealed test file nor the upstream commit", async () => {
    const repository = unique();
    const commits = mirrorTask(repository);
    const one = task("calc-add", repository, commits);
    const scratch = mkdtempSync(join(tmpdir(), "checks-workspace-"));
    roots.push(scratch);
    const workspace = join(scratch, "workspace");
    await cloneAtBase(log(), one, commits.base, workspace);
    expect(existsSync(join(workspace, "test/add.test.mjs"))).toBe(false);
    expect(existsSync(join(workspace, "calc.mjs"))).toBe(true);
    const upstream = spawnSync("git", ["cat-file", "-e", commits.upstream], { cwd: workspace });
    expect(upstream.status).not.toBe(0);
  });

  it("displaces, and says so, a file the patch wrote at a hidden test file's path", async () => {
    const repository = unique();
    const commits = mirrorTask(repository);
    const one = task("calc-add", repository, commits);
    const own = newFile(
      "test/add.test.mjs",
      'import { add } from "../calc.mjs";\nif (add(2, 2) !== 4) { process.exit(1); }\n',
    );
    const verdict = await hiddenVerdict(log(), one, commits.base, commits.upstream, fix + own);
    expect(verdict.verdict).toBe("pass");
    expect(verdict.displaced).toEqual(["test/add.test.mjs"]);
    expect(verdict.detail).toContain("the sealed overlay displaced it");
    expect(verdict.policy.ok).toBe(true);
  });

  it("carries the policy verdict and the displaced files on a failing reading too", async () => {
    const repository = unique();
    const commits = mirrorTask(repository);
    const one = task("calc-add", repository, commits);
    // A change that leaves the defect: the hidden tests fail, and the record still says what
    // the policy made of the patch (the dotenv records of 2026-10-21 lacked it).
    const cosmetic =
      "diff --git a/calc.mjs b/calc.mjs\n--- a/calc.mjs\n+++ b/calc.mjs\n@@ -1,2 +1,3 @@\n+// not yet\n export const add = (a, b) => a - b;\n export const mul = (a, b) => a * b;\n";
    const verdict = await hiddenVerdict(log(), one, commits.base, commits.upstream, cosmetic);
    expect(verdict.verdict).toBe("fail");
    expect(verdict.basis).toContain("hidden tests (node test/add.test.mjs) exited 1");
    expect(verdict.policy).toMatchObject({ ok: true, addedAssertions: 0 });
    expect(verdict.displaced).toEqual([]);
  });

  it("rejects a patch under the allowed-change policy before any test runs, naming the rule", async () => {
    const repository = unique();
    const commits = mirrorTask(repository);
    const one = task("calc-add", repository, commits);
    const loosened =
      'diff --git a/acceptance/visible/check.mjs b/acceptance/visible/check.mjs\n--- a/acceptance/visible/check.mjs\n+++ b/acceptance/visible/check.mjs\n@@ -1,2 +1,2 @@\n import { add } from "../../calc.mjs";\n-if (add(2, 3) !== 5) { console.error("add(2, 3) is " + add(2, 3)); process.exit(1); }\n+process.exit(0);\n';
    const verdict = await hiddenVerdict(log(), one, commits.base, commits.upstream, fix + loosened);
    expect(verdict.verdict).toBe("fail");
    expect(verdict.basis).toContain("protected-path (acceptance/visible/check.mjs)");
    expect(verdict.policy.violations).toHaveLength(1);
  });
});

describe("validating a task's reference", () => {
  it("executes the base's checks and holds the reference to the same policy as the arms", async () => {
    const repository = unique();
    const commits = mirrorTask(repository);
    const row = await validateTask(log(), task("calc-add", repository, commits));
    expect(row.error).toBeUndefined();
    expect(row.base).toMatchObject({ visible: false, hidden: "fail", executed: true });
    expect(row.base.hiddenBasis).toContain("hidden tests (node test/add.test.mjs) exited 1");
    expect(row.reference).toMatchObject({ visible: true, hidden: "pass" });
    expect(row.reference.policy.ok).toBe(true);
    expect(row.valid).toBe(true);
  });

  it("is not valid where the reference passes only by a change the arms may not make", async () => {
    const repository = unique();
    const commits = mirrorTask(repository, {
      upstreamExtra: (source) =>
        writeFileSync(join(source, ".taprc"), "allow-incomplete-coverage: true\n"),
    });
    const row = await validateTask(log(), task("calc-add", repository, commits));
    expect(row.error).toBeUndefined();
    expect(row.reference.hidden).toBe("fail");
    expect(row.reference.policy.ok).toBe(false);
    expect(row.reference.policy.violations[0]).toMatchObject({
      rule: "protected-path",
      path: ".taprc",
    });
    expect(row.reference.hiddenBasis).toContain("protected-path (.taprc)");
    expect(row.valid).toBe(false);
  });
});

describe("the product's structured form of a task's test script", () => {
  // A stand-in for the pinned build's gates/structured-runner.js, with its rule: a script body of
  // `vitest run` runs the same suite through a reporter the product reads.
  const build = mkdtempSync(join(tmpdir(), "swarm-pinned-"));
  const checkout = mkdtempSync(join(tmpdir(), "swarm-gate-plan-"));
  mkdirSync(join(build, "gates"), { recursive: true });
  writeFileSync(
    join(build, "gates", "structured-runner.js"),
    "export const structuredRunner = (body) => (body === 'vitest run' ? ['node', '-e', 'VITEST'] : null);\n" +
      "export const renderRunnerArgv = (argv) => argv.map((word) => \"'\" + word + \"'\").join(' ');\n",
  );
  const pins = { swarmCli: join(build, "cli.js") };

  it("is accepted only where it is exactly what the pinned build renders for the script's body", async () => {
    writeFileSync(
      join(checkout, "package.json"),
      JSON.stringify({ scripts: { "test:vi": "vitest run" } }),
    );
    expect(
      await structuredRewriteOf(pins, checkout, "npm run test:vi", "'node' '-e' 'VITEST'"),
    ).toBe(true);
    // Any other command, or a body the build does not rewrite, is not the task's gate.
    expect(
      await structuredRewriteOf(pins, checkout, "npm run test:vi", "'node' '-e' 'OTHER'"),
    ).toBe(false);
    writeFileSync(
      join(checkout, "package.json"),
      JSON.stringify({ scripts: { "test:vi": "vitest run --project unit" } }),
    );
    expect(
      await structuredRewriteOf(pins, checkout, "npm run test:vi", "'node' '-e' 'VITEST'"),
    ).toBe(false);
    expect(await structuredRewriteOf(pins, checkout, "npm test", "'node' '-e' 'VITEST'")).toBe(
      false,
    );
  });
});
