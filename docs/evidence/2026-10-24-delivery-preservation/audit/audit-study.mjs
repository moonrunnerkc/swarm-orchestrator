// An appended audit of a finished study (October 23 studies), under a stricter reading applied to
// every arm alike. It never edits a study's frozen scores; it writes its own file beside them.
//
// It imports nothing from the product it evaluates. Every reading below is this script's own:
//
// - requested and preserved behaviour: the study's hidden evaluator files, run separately where
//   the task has both (behaviour-check.mjs is what the task asked for, kept-check.mjs what it must
//   keep); where a task has only one, preserved behaviour is named "not separately measured";
// - requested tests: the patch's test files run on the delivered tree, and on the base source (or,
//   for an API the base does not have, on the base source with a deliberately wrong
//   implementation added), each run read for whether assertions executed and failed, the suite
//   failed to load, or nothing ran; only executed assertion failures count as sensitivity;
// - new static and test failures: each static tool run on its own on the base and the delivered
//   tree, and the project's tests run with a structured reporter, compared failure identity by
//   failure identity (file and rule or message; test file and name), counted, even where the base
//   already fails; a fixed failure never offsets a new one;
// - artifact correctness, product verdict accuracy and total cost, read from the record.
//
// usage: node audit-study.mjs --study <stage directory with manifest.json and runs/> \
//          --out <file.json> [--mirrors <dir>] [--only <task id>]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    study: { type: "string" },
    out: { type: "string" },
    mirrors: { type: "string", default: join(homedir(), ".cache/swarm-comparison/mirrors") },
    only: { type: "string" },
    work: { type: "string" },
  },
});
if (!values.study || !values.out) throw new Error("usage: --study <dir> --out <file>");
const stage = resolve(values.study);
const manifest = JSON.parse(readFileSync(join(stage, "manifest.json"), "utf8"));
const runs = join(stage, "runs");
const records = JSON.parse(readFileSync(join(runs, "revealed.json"), "utf8"));
const work = values.work ?? mkdtempSync(join(tmpdir(), "swarm-audit-"));

/**
 * Each task's own static tools, as separate commands so every one is observed whole (a `&&`
 * script stops at its first failure and hides the rest), its test runner with a structured
 * report, and, for a feature whose API the base lacks, a deliberately wrong implementation.
 */
const tasks = {
  "ufo-feature-filter-query": {
    statics: [
      ["eslint", ["npx", "eslint", "."]],
      ["prettier", ["npx", "prettier", "-c", "src", "test"]],
    ],
    tests: "vitest-typecheck",
    wrong: {
      file: "src/utils.ts",
      append:
        "\nexport function filterQuery(input: string, _predicate?: unknown): string {\n  return input;\n}\n",
    },
  },
  "ufo-bugfix-base-prefix-boundary": {
    statics: [
      ["eslint", ["npx", "eslint", "."]],
      ["prettier", ["npx", "prettier", "-c", "src", "test"]],
    ],
    tests: "vitest-typecheck",
    wrong: null,
  },
  "nanoid-refactor-module-subdirectories": {
    statics: [["eslint", ["npx", "eslint", "."]]],
    tests: "jest",
    wrong: null,
    noRequestedTests: "the task moves modules and asks for no new test",
  },
  "p-limit-bugfix-limit-function-clear-queue": {
    statics: [["xo", ["npx", "xo"]]],
    tests: "ava",
    wrong: null,
  },
  "markdown-it-feature-reference-definition-token": {
    statics: [
      ["eslint", ["npx", "eslint", "."]],
      ["tsc", ["npx", "tsc", "--noEmit"]],
    ],
    tests: "node-markdown-it",
    // A strip_references rule that strips nothing: the option exists and is wrong.
    wrong: {
      file: "src/parser_core.ts",
      replace: [/(\['inline', r_inline\],)/, "$1\n  ['strip_references', () => {}],"],
    },
  },
  "svgo-bugfix-remove-scripts-anchor-bypass": {
    statics: [
      ["eslint", ["npx", "eslint", "."]],
      ["prettier", ["npx", "prettier", "--check", "."]],
    ],
    tests: "vitest",
    wrong: null,
  },
};

const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const colour = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");

function run(argv, cwd, options = {}) {
  const ran = spawnSync(argv[0], argv.slice(1), {
    cwd,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    timeout: options.timeout ?? 600_000,
    env: { ...process.env, CI: "true", FORCE_COLOR: "0", NO_COLOR: "1", ...(options.env ?? {}) },
    ...(options.input === undefined ? {} : { input: options.input }),
  });
  return {
    status: ran.status,
    signal: ran.signal,
    stdout: (ran.stdout ?? "").replace(colour, ""),
    stderr: (ran.stderr ?? "").replace(colour, ""),
  };
}
function must(argv, cwd, options) {
  const ran = run(argv, cwd, options);
  if (ran.status !== 0) throw new Error(`${argv.join(" ")}: ${ran.stdout}${ran.stderr}`.slice(-3000));
  return ran;
}

/** A prepared base checkout of a task, made once: the visible check and harness lockfile in. */
const prepared = new Map();
function base(task) {
  if (prepared.has(task.id)) return prepared.get(task.id);
  const directory = join(work, task.id, "base");
  if (!existsSync(join(directory, ".git"))) {
    mkdirSync(dirname(directory), { recursive: true });
    const mirror = join(values.mirrors, `${task.repository.replace("/", "__")}.git`);
    must(["git", "clone", "--quiet", "--no-checkout", mirror, directory], dirname(directory));
    must(["git", "checkout", "--quiet", "-b", "work", task.baseCommit], directory);
    mkdirSync(dirname(join(directory, task.visible.path)), { recursive: true });
    writeFileSync(join(directory, task.visible.path), task.visible.source);
    const lock = manifest.harnessLockfiles?.[task.id];
    if (lock !== undefined)
      for (const root of manifest.inputRoots ?? [])
        if (existsSync(join(root, lock.name))) {
          writeFileSync(join(directory, "package-lock.json"), readFileSync(join(root, lock.name)));
          break;
        }
    must(["git", "add", "--force", "-A"], directory);
    must(["git", "-c", "user.name=a", "-c", "user.email=a@a", "commit", "-qm", "visible", "--allow-empty"], directory);
    for (const argv of task.install) must(argv, directory);
  }
  prepared.set(task.id, directory);
  return directory;
}

/** A copy of the prepared base, its installed dependencies linked, with the patch applied. */
function tree(task, patch, name) {
  const directory = join(work, task.id, name);
  rmSync(directory, { recursive: true, force: true });
  must(["git", "clone", "--quiet", base(task), directory], work);
  // Linked, not copied: the same installed dependencies the base reading used.
  if (existsSync(join(base(task), "node_modules")))
    symlinkSync(join(base(task), "node_modules"), join(directory, "node_modules"));
  if (patch.length > 0) {
    const applied = run(["git", "apply", "--whitespace=nowarn", "-"], directory, { input: patch });
    if (applied.status !== 0) return { directory, applied: false, detail: applied.stderr.slice(-600) };
  }
  return { directory, applied: true, detail: "" };
}

/** A hidden evaluator file run over a tree: pass, or fail with what it printed. */
function hiddenFile(task, directory, path) {
  const file = task.hidden.files.find((one) => one.path.endsWith(path));
  if (file === undefined) return null;
  mkdirSync(dirname(join(directory, file.path)), { recursive: true });
  writeFileSync(join(directory, file.path), file.source);
  const ran = run(["node", file.path], directory, { timeout: 300_000 });
  return {
    pass: ran.status === 0,
    detail: `${ran.stdout}${ran.stderr}`.trim().split("\n").slice(-6).join(" | ").slice(0, 800),
  };
}

// ---- failure identities, this script's own -------------------------------------------------

function counted(ids) {
  const found = new Map();
  for (const id of ids) found.set(id, (found.get(id) ?? 0) + 1);
  return found;
}

/** Identities the delivered run fails more often than the base run does. */
function added(baseIds, deliveredIds) {
  const before = counted(baseIds);
  return [...counted(deliveredIds)]
    .filter(([id, count]) => count > (before.get(id) ?? 0))
    .map(([id, count]) => `${id}${count > 1 ? ` (x${count})` : ""}`)
    .sort();
}

/** One static tool's findings as identities, or null where its output was not read whole. */
function staticFindings(tool, ran, root) {
  const text = `${ran.stdout}\n${ran.stderr}`;
  if (ran.signal !== null || ran.status === null) return null;
  if (ran.status === 0) return [];
  const lines = text.split("\n");
  if (tool === "prettier") {
    const named = lines
      .map((line) => /^\[(warn|error)\] (\S.*?)\s*$/.exec(line))
      .filter((match) => match !== null && !/^Code style issues/.test(match[2]))
      .map((match) => `prettier ${match[2].split(":")[0]}`);
    return named.length > 0 ? named : null;
  }
  if (tool === "tsc") {
    const named = lines
      .map((line) => /^(\S.*?)\(\d+,\d+\): error (TS\d+): (.*)$/.exec(line))
      .filter((match) => match !== null)
      .map((match) => `tsc ${match[1]} ${match[2]} ${match[3]}`);
    return named.length > 0 ? named : null;
  }
  // ESLint's and xo's stylish-like reports: a file line, then indented problems.
  const named = [];
  let file = null;
  for (const line of lines) {
    const header = /^(\/\S+|[\w./-]+\.\w+)\s*$/.exec(line);
    if (header !== null) {
      file = header[1].startsWith(root) ? header[1].slice(root.length + 1) : header[1];
      continue;
    }
    const problem = /^\s+\d+:\d+\s+(?:error|✖)\s+(.+?)\s{2,}(\S+)\s*$/.exec(line);
    if (problem !== null && file !== null) named.push(`${tool} ${file} ${problem[2]} ${problem[1]}`);
  }
  return named.length > 0 ? named : null;
}

/** The project's tests run whole with a structured report: failing identities and counts. */
function projectTests(kind, directory) {
  const report = join(directory, ".audit-report.json");
  rmSync(report, { force: true });
  const argv = {
    "vitest-typecheck": ["npx", "vitest", "run", "--typecheck", "--reporter=json", `--outputFile=${report}`],
    vitest: ["npx", "vitest", "run", "--reporter=json", `--outputFile=${report}`],
    jest: ["npx", "jest", "--json", `--outputFile=${report}`],
    ava: ["npx", "ava", "--tap"],
    "node-markdown-it": ["node", "--test", "--test-reporter=tap", "test/markdown-it/"],
  }[kind];
  const ran = run(argv, directory, { timeout: 900_000 });
  return readTestReport(kind, ran, report);
}

/** Executed tests, failed identities and whether the suite loaded, from a runner's report. */
function readTestReport(kind, ran, report) {
  if (kind === "ava" || kind === "node-markdown-it") {
    const text = `${ran.stdout}\n${ran.stderr}`;
    const points = [...text.matchAll(/^(\s*)(not ok|ok) \d+ - (.+?)(?:\s+#\s*(SKIP|TODO).*)?$/gm)];
    const executed = points.filter((one) => one[4] === undefined);
    const failed = executed.filter((one) => one[2] === "not ok").map((one) => `${one[1].length}:${one[3]}`);
    const loadFailed = /Error \[ERR_|SyntaxError|Cannot find module|Uncaught exception|does not provide an export/.test(text) && executed.length === 0;
    return { executed: executed.length, failed, loadFailed, complete: /^1\.\.\d+/m.test(text) };
  }
  if (!existsSync(report)) return { executed: 0, failed: [], loadFailed: true, complete: false };
  const json = JSON.parse(readFileSync(report, "utf8"));
  const files = json.testResults ?? [];
  const failed = [];
  let executed = 0;
  let loadFailed = false;
  for (const file of files) {
    const assertions = file.assertionResults ?? file.testResults ?? [];
    const name = (file.name ?? file.testFilePath ?? "").split("/").slice(-2).join("/");
    if (assertions.length === 0 && (file.status === "failed" || file.message)) loadFailed = true;
    for (const one of assertions) {
      if (one.status === "pending" || one.status === "skipped" || one.status === "todo") continue;
      executed++;
      if (one.status === "failed") failed.push(`${name} › ${one.fullName ?? one.title}`);
    }
  }
  return { executed, failed, loadFailed, complete: true };
}

/** The patch's test files over a tree: what the run shows about them. */
function requestedTestRun(kind, directory, files) {
  if (files.length === 0) return { reading: "no test file changed", executed: 0, failed: 0 };
  const report = join(directory, ".audit-requested.json");
  rmSync(report, { force: true });
  const argv = {
    "vitest-typecheck": ["npx", "vitest", "run", ...files, "--reporter=json", `--outputFile=${report}`],
    vitest: ["npx", "vitest", "run", ...files, "--reporter=json", `--outputFile=${report}`],
    jest: ["npx", "jest", ...files, "--json", `--outputFile=${report}`],
    ava: ["npx", "ava", "--tap", ...files],
    "node-markdown-it": ["node", "--test", "--test-reporter=tap", ...files],
  }[kind];
  const ran = run(argv, directory, { timeout: 600_000 });
  const read = readTestReport(kind, ran, report);
  const reading = read.loadFailed
    ? "the test files did not load"
    : read.executed === 0
      ? "no test executed"
      : read.failed.length > 0
        ? "executed assertions failed"
        : "every executed test passed";
  return { reading, executed: read.executed, failed: read.failed.length, exit: ran.status };
}

const patchFiles = (patch) =>
  [...patch.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].map((match) => match[2]);
const isTest = (path) =>
  /(^|\/)(test|tests|__tests__)\//.test(path) ||
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) ||
  /^test\.[cm]?js$/.test(path);
const blob = (digest) => readFileSync(join(runs, "blobs", digest.slice("sha256:".length)), "utf8");

// ---- the audit --------------------------------------------------------------------------------

const baseline = new Map();
function baseReadings(task, config) {
  if (baseline.has(task.id)) return baseline.get(task.id);
  const { directory } = tree(task, "", "base-reading");
  const statics = Object.fromEntries(
    config.statics.map(([tool, argv]) => [tool, staticFindings(tool, run(argv, directory), directory)]),
  );
  const tests = projectTests(config.tests, directory);
  const read = { statics, tests };
  baseline.set(task.id, read);
  return read;
}

const out = [];
for (const record of records) {
  const task = manifest.tasks.find((one) => one.id === record.task);
  if (task === undefined || (values.only !== undefined && task.id !== values.only)) continue;
  const config = tasks[task.id];
  const name = `${record.task}${record.sample === 2 ? "~2" : ""}.${record.arm}`;
  const entry = {
    launch: name,
    task: record.task,
    sample: record.sample ?? 1,
    arm: record.arm,
    outcome: record.outcome,
    frozenHidden: record.scores?.hidden?.verdict ?? null,
    productAcceptable: record.invocation?.productVerdict?.acceptable ?? null,
    cost: {
      wallMs: record.invocation?.wallMs ?? null,
      tokens: record.invocation?.tokens ?? null,
      unknownUsageCalls: record.invocation?.usage?.unknownCalls ?? null,
    },
  };
  if (record.finalPatchDigest === undefined || record.finalPatchDigest === null) {
    out.push({ ...entry, audit: "no delivered patch was recorded" });
    continue;
  }
  const patch = blob(record.finalPatchDigest);
  entry.patchDigest = sha(patch);
  const delivered = tree(task, patch, `delivered-${name}`);
  if (!delivered.applied) {
    out.push({ ...entry, audit: `the delivered patch did not apply: ${delivered.detail}` });
    continue;
  }
  const before = baseReadings(task, config);
  const statics = Object.fromEntries(
    config.statics.map(([tool, argv]) => {
      const now = staticFindings(tool, run(argv, delivered.directory), delivered.directory);
      const was = before.statics[tool];
      return [
        tool,
        now === null || was === null
          ? { reading: "unreadable", added: null }
          : { reading: added(was, now).length > 0 ? "new findings" : "no new findings", added: added(was, now) },
      ];
    }),
  );
  const tests = projectTests(config.tests, delivered.directory);
  const newTestFailures = added(before.tests.failed, tests.failed);
  const testFiles = patchFiles(patch).filter(isTest).filter((path) => existsSync(join(delivered.directory, path)));
  let sensitivity;
  if (config.noRequestedTests !== undefined)
    sensitivity = { reading: "not requested", detail: config.noRequestedTests };
  else {
    const onDelivered = requestedTestRun(config.tests, delivered.directory, testFiles);
    const control = tree(task, "", `control-${name}`);
    for (const path of testFiles) {
      mkdirSync(dirname(join(control.directory, path)), { recursive: true });
      cpSync(join(delivered.directory, path), join(control.directory, path));
    }
    let wrongApplied = config.wrong === null;
    if (config.wrong !== null && existsSync(join(control.directory, config.wrong.file))) {
      const target = join(control.directory, config.wrong.file);
      const source = readFileSync(target, "utf8");
      const changed =
        config.wrong.append !== undefined
          ? source + config.wrong.append
          : source.replace(config.wrong.replace[0], config.wrong.replace[1]);
      wrongApplied = changed !== source;
      writeFileSync(target, changed);
    }
    if (!wrongApplied) throw new Error(`the wrong implementation of ${task.id} did not apply`);
    const onControl = requestedTestRun(config.tests, control.directory, testFiles);
    sensitivity = {
      control: config.wrong === null ? "the base source" : "the base source with a deliberately wrong implementation of the new API",
      onDelivered,
      onControl,
      reading:
        testFiles.length === 0
          ? "no test file changed"
          : onDelivered.reading === "every executed test passed" && onControl.reading === "executed assertions failed"
            ? "sensitive: executed assertions fail on the control and pass on the delivered tree"
            : `not shown sensitive (delivered: ${onDelivered.reading}; control: ${onControl.reading})`,
    };
    rmSync(control.directory, { recursive: true, force: true });
  }
  // The hidden evaluator's files go in last, after every static tool and test run has read the
  // tree, so none of them reads the evaluator's own files as part of the change.
  const requested = hiddenFile(task, delivered.directory, "behaviour-check.mjs");
  const kept = hiddenFile(task, delivered.directory, "kept-check.mjs");
  const staticAdded = Object.values(statics).some((one) => (one.added ?? []).length > 0);
  const staticUnreadable = Object.values(statics).some((one) => one.added === null);
  entry.requestedBehaviour = requested;
  entry.preservedBehaviour = kept ?? { pass: null, detail: "not separately measured: this task's hidden evaluator has one combined file" };
  entry.requestedTests = sensitivity;
  entry.statics = statics;
  entry.tests = { executed: tests.executed, newFailures: newTestFailures, loadFailed: tests.loadFailed };
  // Correct under the stricter reading: everything the frozen hidden verdict required, and
  // besides it the requested and the kept behaviour hold, the requested tests are shown sensitive
  // (where tests were requested), and nothing new fails.
  entry.strictComplete =
    entry.frozenHidden === "pass" &&
    requested?.pass === true &&
    (kept === null || kept.pass === true) &&
    (sensitivity.reading === "not requested" || sensitivity.reading.startsWith("sensitive")) &&
    !staticAdded &&
    !staticUnreadable &&
    newTestFailures.length === 0;
  entry.verdictAccuracy =
    entry.productAcceptable === null
      ? "no product verdict"
      : entry.productAcceptable === entry.strictComplete
        ? entry.productAcceptable
          ? "correct accept"
          : "correct refusal"
        : entry.productAcceptable
          ? "false accept"
          : "false refusal";
  out.push(entry);
  rmSync(delivered.directory, { recursive: true, force: true });
  console.log(
    `${name}: requested ${requested?.pass}, kept ${kept?.pass ?? "n/a"}, tests ${sensitivity.reading.split(":")[0]}, statics ${staticAdded ? "added" : staticUnreadable ? "unreadable" : "none added"}, test failures added ${newTestFailures.length}, strict ${entry.strictComplete}, product ${entry.productAcceptable} (${entry.verdictAccuracy})`,
  );
}
writeFileSync(values.out, `${JSON.stringify({ study: stage, base: Object.fromEntries(baseline), launches: out }, null, 2)}\n`);
