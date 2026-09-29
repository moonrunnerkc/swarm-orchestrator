import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { additionsOfDiff, classifySide, decideCheck, headAdds } from "./side-outcome.mjs";

const failed = (stdout, stderr = "", exitCode = 1) => ({
  ran: true,
  exitCode,
  timedOut: false,
  stdout,
  stderr,
});
const noAdditions = { text: "", paths: [] };

describe("classifySide", () => {
  it("names a pass, a timeout, a side never run and an install failure", () => {
    expect(classifySide(failed("ok", "", 0), {}).outcome).toBe("passed");
    expect(classifySide({ ran: true, timedOut: true, exitCode: null }, {}).outcome).toBe("timeout");
    expect(classifySide({ ran: false, notRunReason: "checkout failed" }, {}).outcome).toBe(
      "not-run",
    );
    expect(classifySide(undefined, {}).outcome).toBe("not-run");
    const setup = classifySide({ setupFailed: true, notRunReason: "npm ci exited 1" }, {});
    expect(setup).toEqual({ outcome: "startup-or-setup-failure", reason: "npm ci exited 1" });
  });

  it("does not count a run whose every test was skipped as a pass", () => {
    const skipped = failed("===== 3 skipped in 0.01s =====", "", 0);
    expect(classifySide(skipped, {}).outcome).toBe("check-invalid");
  });

  it("reads a missing runner or command as setup, never as the check's verdict", () => {
    expect(classifySide(failed("", "sh: 1: pytest: not found", 127), {}).outcome).toBe(
      "startup-or-setup-failure",
    );
    expect(classifySide(failed("", "/usr/bin/python: No module named pytest"), {}).outcome).toBe(
      "startup-or-setup-failure",
    );
    expect(classifySide(failed("", "check file missing", 125), {}).outcome).toBe("check-invalid");
  });

  it("calls a missing name a missing feature only when the pull request adds it", () => {
    const added = additionsOfDiff(
      [
        "diff --git a/src/safety/advisor.py b/src/safety/advisor.py",
        "--- /dev/null",
        "+++ b/src/safety/advisor.py",
        "+class ArityAdvisor:",
        "+    pass",
      ].join("\n"),
    );
    const moduleMissing = failed("", "ModuleNotFoundError: No module named 'safety.advisor'");
    expect(classifySide(moduleMissing, { added })).toMatchObject({
      outcome: "missing-feature",
      name: "safety.advisor",
    });
    const symbolMissing = failed(
      "",
      "ImportError: cannot import name 'ArityAdvisor' from 'safety'",
    );
    expect(classifySide(symbolMissing, { added }).outcome).toBe("missing-feature");
    // The same failures when the pull request adds neither: the environment or the check.
    expect(classifySide(moduleMissing, { added: noAdditions }).outcome).toBe(
      "startup-or-setup-failure",
    );
    expect(classifySide(symbolMissing, { added: noAdditions }).outcome).toBe("check-invalid");
  });

  it("separates a syntax error in the check from one in the project", () => {
    const inCheck = failed(
      "",
      'File "tests/check_x.py", line 3\n    def (:\nSyntaxError: invalid syntax',
    );
    expect(classifySide(inCheck, { checkPaths: ["tests/check_x.py"] }).outcome).toBe(
      "check-invalid",
    );
    const inProject = failed("", 'File "src/app.py", line 9\nSyntaxError: invalid syntax');
    expect(classifySide(inProject, { checkPaths: ["tests/check_x.py"] }).outcome).toBe(
      "startup-or-setup-failure",
    );
  });

  it("treats a missing fixture as a broken check unless the head adds the file", () => {
    const missing = failed("", "grep: docs/guide.md: No such file or directory");
    expect(classifySide(missing, { added: noAdditions }).outcome).toBe("check-invalid");
    expect(classifySide(missing, { added: { text: "", paths: ["docs/guide.md"] } }).outcome).toBe(
      "missing-feature",
    );
  });

  it("recognises an assertion and refuses an uncaught error as one", () => {
    expect(classifySide(failed("E   assert 3 == 4\nFAILED test_x"), {}).outcome).toBe(
      "assertion-failure",
    );
    expect(classifySide(failed("FAIL: README lacks the link"), {}).outcome).toBe(
      "assertion-failure",
    );
    expect(classifySide(failed("", "AssertionError [ERR_ASSERTION]: 3 !== 4"), {}).outcome).toBe(
      "assertion-failure",
    );
    expect(classifySide(failed("", "Traceback\nKeyError: 'total'"), {}).outcome).toBe(
      "check-invalid",
    );
    expect(classifySide(failed("", ""), {}).outcome).toBe("check-invalid");
  });

  it("names a network or browser need", () => {
    expect(
      classifySide(failed("", "Error: getaddrinfo ENOTFOUND api.example.com"), {}),
    ).toMatchObject({
      outcome: "startup-or-setup-failure",
      needs: "network",
    });
    expect(
      classifySide(failed("", "browserType.launch: Executable doesn't exist"), {}),
    ).toMatchObject({
      needs: "browser",
    });
  });

  it("finds added names as whole words and added modules by file", () => {
    const added = { text: "export function totalOf(items) {}", paths: ["src/lib/total.ts"] };
    expect(headAdds("totalOf", added)).toBe(true);
    expect(headAdds("total", added)).toBe(true);
    expect(headAdds("../src/lib/total", added)).toBe(true);
    expect(headAdds("tot", added)).toBe(false);
  });
});

const outcome = (name, extra = {}) => ({ outcome: name, reason: name, ...extra });

describe("decideCheck", () => {
  it("counts only an assertion failure or missing feature on the base, with a head pass, as met", () => {
    for (const base of ["assertion-failure", "missing-feature"])
      expect(
        decideCheck({ taskType: "feature", base: outcome(base), head: outcome("passed") }).decision,
      ).toBe("met");
    for (const base of [
      "startup-or-setup-failure",
      "check-invalid",
      "timeout",
      "not-run",
      "passed",
    ])
      expect(
        decideCheck({ taskType: "bugfix", base: outcome(base), head: outcome("passed") }).decision,
      ).toBe("unjudged");
  });

  it("reads the same unmet requirement on both sides as a violation candidate", () => {
    const decided = decideCheck({
      taskType: "bugfix",
      base: outcome("assertion-failure"),
      head: outcome("assertion-failure"),
    });
    expect(decided.decision).toBe("violated-candidate");
  });

  it("accepts a head still missing a feature as a violation only when the text names it", () => {
    const base = outcome("missing-feature", { name: "ArityAdvisor" });
    const head = outcome("missing-feature", { name: "ArityAdvisor" });
    expect(
      decideCheck({ taskType: "feature", base, head, requirementText: "Adds ArityAdvisor." })
        .decision,
    ).toBe("violated-candidate");
    expect(
      decideCheck({ taskType: "feature", base, head, requirementText: "Adds an advisor." })
        .decision,
    ).toBe("unjudged");
  });

  it("judges a refactor by equivalence", () => {
    expect(
      decideCheck({ taskType: "refactor", base: outcome("passed"), head: outcome("passed") })
        .decision,
    ).toBe("met");
    expect(
      decideCheck({
        taskType: "refactor",
        base: outcome("passed"),
        head: outcome("assertion-failure"),
      }).decision,
    ).toBe("violated-candidate");
    expect(
      decideCheck({
        taskType: "refactor",
        base: outcome("assertion-failure"),
        head: outcome("passed"),
      }).decision,
    ).toBe("unjudged");
  });

  it("leaves a check that needs a network or browser unjudged with the reason", () => {
    const decided = decideCheck({
      taskType: "api",
      base: outcome("not-run"),
      head: outcome("not-run"),
      needs: "network",
    });
    expect(decided).toMatchObject({ decision: "unjudged" });
    expect(decided.reason).toMatch(/network/);
    const observed = decideCheck({
      taskType: "browser",
      base: outcome("startup-or-setup-failure", { needs: "browser" }),
      head: outcome("startup-or-setup-failure", { needs: "browser" }),
    });
    expect(observed.reason).toMatch(/browser/);
  });
});

/**
 * Controls over a real repository and real executions: a base commit and a head commit, a check
 * run with node at each, and the corrected evaluator deciding from what actually printed.
 */
describe("evaluator controls on a synthetic repository", () => {
  let repo = "";
  const git = (...args) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  const commit = (files, message) => {
    for (const [name, contents] of Object.entries(files)) writeFileSync(join(repo, name), contents);
    git("add", "-A");
    git(
      "-c",
      "user.name=control",
      "-c",
      "user.email=control@example.invalid",
      "commit",
      "-qm",
      message,
    );
    return git("rev-parse", "HEAD").stdout.trim();
  };
  const runCheck = (sha, checkName, contents) => {
    git("checkout", "-q", "--detach", sha);
    writeFileSync(join(repo, checkName), contents);
    const ran = spawnSync(process.execPath, [checkName], {
      cwd: repo,
      encoding: "utf8",
      timeout: 30_000,
    });
    rmSync(join(repo, checkName));
    return {
      ran: true,
      exitCode: ran.status,
      timedOut: ran.signal === "SIGTERM",
      stdout: ran.stdout,
      stderr: ran.stderr,
    };
  };
  const evaluate = (base, head, checkName, contents, diff) => {
    const added = additionsOfDiff(git("diff", `${base}..${head}`).stdout + (diff ?? ""));
    const context = { checkPaths: [checkName], added };
    const baseSide = classifySide(runCheck(base, checkName, contents), context);
    const headSide = classifySide(runCheck(head, checkName, contents), context);
    return {
      base: baseSide,
      head: headSide,
      ...decideCheck({ taskType: "bugfix", base: baseSide, head: headSide, requirementText: "" }),
    };
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "adjudication-control-"));
    git("init", "-q");
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("negative: a check that crashes on its own syntax error at the base is not detection", () => {
    const base = commit({ "lib.mjs": "export const add = (a, b) => a - b;\n" }, "base");
    const head = commit({ "lib.mjs": "export const add = (a, b) => a + b;\n" }, "head");
    const decided = evaluate(
      base,
      head,
      "check.mjs",
      'import { add } from "./lib.mjs";\nconst = add(1, 2);\n',
    );
    expect(decided.base.outcome).toBe("check-invalid");
    expect(decided.decision).toBe("unjudged");
  });

  it("negative: a project that does not load at the base is not detection", () => {
    const base = commit({ "lib.mjs": "export const add = (a, b) => { a + ;\n" }, "base");
    const head = commit({ "lib.mjs": "export const add = (a, b) => a + b;\n" }, "head");
    const check =
      'import assert from "node:assert";\nimport { add } from "./lib.mjs";\nassert.strictEqual(add(1, 2), 3);\n';
    const decided = evaluate(base, head, "check.mjs", check);
    expect(decided.base.outcome).toBe("startup-or-setup-failure");
    expect(decided.head.outcome).toBe("passed");
    expect(decided.decision).toBe("unjudged");
  });

  it("positive: a genuine assertion failure at the base and a pass at the head is met", () => {
    const base = commit({ "lib.mjs": "export const add = (a, b) => a - b;\n" }, "base");
    const head = commit({ "lib.mjs": "export const add = (a, b) => a + b;\n" }, "head");
    const check =
      'import assert from "node:assert";\nimport { add } from "./lib.mjs";\nassert.strictEqual(add(1, 2), 3);\n';
    const decided = evaluate(base, head, "check.mjs", check);
    expect(decided.base.outcome).toBe("assertion-failure");
    expect(decided.head.outcome).toBe("passed");
    expect(decided.decision).toBe("met");
  });

  it("positive: a feature the head adds, missing at the base, is met", () => {
    const base = commit({ "lib.mjs": "export const add = (a, b) => a + b;\n" }, "base");
    const head = commit(
      {
        "lib.mjs":
          "export const add = (a, b) => a + b;\nexport const subtract = (a, b) => a - b;\n",
      },
      "head",
    );
    const check =
      'import assert from "node:assert";\nimport { subtract } from "./lib.mjs";\nassert.strictEqual(subtract(3, 1), 2);\n';
    const decided = evaluate(base, head, "check.mjs", check);
    expect(decided.base.outcome).toBe("missing-feature");
    expect(decided.decision).toBe("met");
  });

  it("the same genuine failure on base and head is a violation candidate, not detection alone", () => {
    const base = commit({ "lib.mjs": "export const add = (a, b) => a - b;\n" }, "base");
    const head = commit(
      { "lib.mjs": "export const add = (a, b) => a - b; // unchanged\n" },
      "head",
    );
    const check =
      'import assert from "node:assert";\nimport { add } from "./lib.mjs";\nassert.strictEqual(add(1, 2), 3);\n';
    const decided = evaluate(base, head, "check.mjs", check);
    expect(decided.decision).toBe("violated-candidate");
  });
});
