// Scores a finished study's revealed records under the registered definition of complete
// delivery, and measures what the review's attempt changed, with no model:
//
// - requested tests: the patch's test files written over the base source (the visible check and
//   lockfile committed as the arm had them) must fail, and over the delivered tree must pass, with
//   the task's own runner. File level: a changed test file that fails on base source is taken as
//   carrying a test that fails without the change.
// - complete: hidden pass, visible check and project tests pass, lint passes where the base passes
//   it (the runner's static reading), and requested tests as above.
// - the review's attempt: the runner's own snapshot of the candidate before the attempt the
//   product recorded as the review's (`candidate-review-attempt-v1`), and the delivered patch, each
//   scored by the hidden evaluator through rescore.mjs, so a gain, damage or no change is measured.
// - the corrected scorer: every delivered patch scored again through rescore.mjs, whose trees
//   commit the frozen harness lockfile as the launch's did (amendment 9). It is reported beside
//   the runner's own scores. A launch the runner's scorer could not judge is scored by it alone.
//
// usage: node score-study.mjs --manifest <manifest.json> --revealed <runs/revealed.json> --out <file>
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    manifest: { type: "string" },
    revealed: { type: "string" },
    out: { type: "string" },
    mirrors: { type: "string", default: join(homedir(), ".cache/swarm-comparison/mirrors") },
  },
});
if (!values.manifest || !values.revealed || !values.out)
  throw new Error("usage: --manifest <file> --revealed <file> --out <file>");
const manifestPath = resolve(values.manifest);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const stage = dirname(manifestPath);
const runs = join(stage, "runs");
const records = JSON.parse(readFileSync(values.revealed, "utf8"));
const work = join(dirname(resolve(values.out)), "score-work");
mkdirSync(work, { recursive: true });
const here = dirname(new URL(import.meta.url).pathname);
const repository = resolve(here, "../../..");

/** Each task's runner for named test files, as its project runs them. */
const testRunner = {
  "svgo-bugfix-remove-scripts-anchor-bypass": (files) => ["npx", "vitest", "run", ...files],
  "markdown-it-feature-reference-definition-token": (files) => ["node", "--test", ...files],
  "p-limit-bugfix-limit-function-clear-queue": (files) => ["npx", "ava", ...files],
  "ufo-feature-filter-query": (files) => ["npx", "vitest", "run", ...files],
  "ufo-bugfix-base-prefix-boundary": (files) => ["npx", "vitest", "run", ...files],
  "nanoid-refactor-module-subdirectories": (files) => ["npx", "jest", ...files],
};
const isTest = (path) =>
  /(^|\/)(test|tests|__tests__)\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || /^test\.[cm]?js$/.test(path);

function run(argv, cwd, input) {
  const ran = spawnSync(argv[0], argv.slice(1), {
    cwd,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    timeout: 600_000,
    ...(input === undefined ? {} : { input }),
  });
  return { status: ran.status, out: `${ran.stdout ?? ""}${ran.stderr ?? ""}`.slice(-3000) };
}
function must(argv, cwd, input) {
  const ran = run(argv, cwd, input);
  if (ran.status !== 0) throw new Error(`${argv.join(" ")}: ${ran.out}`);
  return ran;
}

/** A prepared checkout of a task's base, as the runner prepared every arm's, made once. */
const prepared = new Map();
function base(task) {
  if (prepared.has(task.id)) return prepared.get(task.id);
  const directory = join(work, task.id, "base");
  if (!existsSync(join(directory, ".git"))) {
    mkdirSync(dirname(directory), { recursive: true });
    must(["git", "clone", "--quiet", "--no-checkout", join(values.mirrors, `${task.repository.replace("/", "__")}.git`), directory], dirname(directory));
    must(["git", "checkout", "--quiet", "-b", "work", task.baseCommit], directory);
    mkdirSync(dirname(join(directory, task.visible.path)), { recursive: true });
    writeFileSync(join(directory, task.visible.path), task.visible.source);
    must(["git", "add", "--force", task.visible.path], directory);
    must(["git", "-c", "user.name=s", "-c", "user.email=s@s", "commit", "-qm", "visible"], directory);
    const lock = manifest.harnessLockfiles?.[task.id];
    if (lock !== undefined)
      for (const root of manifest.inputRoots ?? [])
        if (existsSync(join(root, lock.name))) {
          writeFileSync(join(directory, "package-lock.json"), readFileSync(join(root, lock.name)));
          must(["git", "add", "--force", "package-lock.json"], directory);
          must(["git", "-c", "user.name=s", "-c", "user.email=s@s", "commit", "-qm", "lock"], directory);
          break;
        }
    for (const argv of task.install) must(argv, directory);
  }
  prepared.set(task.id, directory);
  return directory;
}

const blob = (digest) => readFileSync(join(runs, "blobs", digest.slice("sha256:".length)));
const patchFiles = (patch) =>
  [...patch.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].map((match) => match[2]);

/** Whether the patch's changed test files fail on base source and pass on the delivered tree. */
function requestedTests(task, patch) {
  const tests = patchFiles(patch).filter(isTest);
  if (tests.length === 0) return { tests: [], sensitive: false, detail: "no test file changed" };
  const directory = base(task);
  const reset = () => {
    must(["git", "checkout", "--quiet", "--", "."], directory);
    run(["git", "clean", "-fdq", "-e", "node_modules"], directory);
  };
  reset();
  const applied = run(["git", "apply", "--whitespace=nowarn", "--include", "*", "-"], directory, patch);
  if (applied.status !== 0) return { tests, sensitive: false, detail: `the patch did not apply: ${applied.out}` };
  const runner = testRunner[task.id];
  const existing = tests.filter((path) => existsSync(join(directory, path)));
  const delivered = run(runner(existing), directory);
  // The base source with the patch's test files only.
  const contents = new Map(existing.map((path) => [path, readFileSync(join(directory, path))]));
  reset();
  for (const [path, bytes] of contents) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), bytes);
  }
  const onBase = run(runner(existing), directory);
  reset();
  return {
    tests: existing,
    sensitive: onBase.status !== 0 && delivered.status === 0,
    onBase: onBase.status,
    delivered: delivered.status,
    detail: onBase.out.slice(-600),
  };
}

/** The corrected scorer's readings of a patch, through the comparison's rescore. */
function hidden(task, arm, patch, name) {
  const path = join(work, `${name}.patch`);
  writeFileSync(path, patch);
  const out = join(work, `${name}.rescore.json`);
  if (!existsSync(out))
    run([process.execPath, join(repository, "scripts/comparison/rescore.mjs"), "--stage", stage, "--task", task.id, "--arm", arm, "--patch", path, "--blobs", join(work, "rescore-blobs"), "--out", out], repository);
  if (!existsSync(out)) return null;
  const read = JSON.parse(readFileSync(out, "utf8"));
  return {
    hidden: read.hiddenOverlay?.verdict ?? null,
    delivered: read.deliveredTree?.passed ?? null,
    static: read.staticReading?.passed ?? null,
    harnessLockfile: read.harnessLockfile ?? null,
  };
}

/** The attempt the product recorded as the review's, from the kept session. */
function reviewAttempt(record) {
  if (record.evidence === undefined || !existsSync(record.evidence)) return null;
  const sessions = existsSync(join(record.evidence, "ledger.jsonl"))
    ? [record.evidence]
    : readdirSync(record.evidence).map((one) => join(record.evidence, one));
  for (const session of sessions) {
    const ledger = join(session, "ledger.jsonl");
    if (!existsSync(ledger)) continue;
    for (const line of readFileSync(ledger, "utf8").split("\n")) {
      if (line.length === 0) continue;
      const entry = JSON.parse(line);
      if (entry.type !== "verification-command") continue;
      const payload = JSON.parse(readFileSync(join(session, "blobs", `${entry.payloadDigest.slice(7)}.json`), "utf8"));
      if (payload.rule === "candidate-review-attempt-v1" && typeof payload.attempt === "number")
        return { attempt: payload.attempt, accepted: payload.accepted, state: payload.state };
    }
  }
  return null;
}

const scored = [];
for (const record of records) {
  if (record.finalPatchDigest === undefined || record.scores === undefined) {
    scored.push({ task: record.task, arm: record.arm, sample: record.sample ?? 1, outcome: record.outcome });
    continue;
  }
  const task = manifest.tasks.find((one) => one.id === record.task);
  const patch = blob(record.finalPatchDigest).toString("utf8");
  const tests = requestedTests(task, patch);
  const name = `${record.task}~${record.sample ?? 1}.${record.arm}`;
  const corrected = hidden(task, record.arm, patch, `${name}.delivered`);
  // The runner's own scores where it judged; the corrected scorer's where it could not.
  const judged =
    record.outcome === "scored" && ["pass", "fail"].includes(record.scores.hidden?.verdict);
  const scores = judged
    ? record.scores
    : {
        hidden: { verdict: corrected?.hidden ?? null },
        visible: { passed: corrected?.delivered ?? null },
        static: { passed: corrected?.static ?? null },
      };
  const isComplete = (reading) =>
    reading.hidden === "pass" && reading.visible === true && reading.static !== false && tests.sensitive;
  const complete = isComplete({
    hidden: scores.hidden.verdict,
    visible: scores.visible.passed,
    static: scores.static?.passed,
  });
  const review = record.arm.startsWith("swarm") ? reviewAttempt(record) : null;
  let reviewEffect = null;
  if (review !== null) {
    const before = record.attemptSnapshots?.find((one) => one.attempt === review.attempt);
    const initial = before?.patchDigest ? hidden(task, record.arm, blob(before.patchDigest).toString("utf8"), `${name}.before-review`) : null;
    reviewEffect = {
      ...review,
      before: initial,
      // Both through the corrected scorer, so the comparison is one scorer's.
      delivered: { hidden: corrected?.hidden ?? null },
      change:
        initial === null || corrected === null
          ? "unmeasured"
          : initial.hidden === corrected.hidden
            ? "no change"
            : initial.hidden === "fail" && corrected.hidden === "pass"
              ? "gain"
              : "damage",
    };
  }
  scored.push({
    task: record.task,
    arm: record.arm,
    sample: record.sample ?? 1,
    outcome: record.outcome,
    scoredBy: judged ? "runner" : "corrected scorer (the runner could not judge)",
    hidden: scores.hidden.verdict,
    visible: scores.visible.passed,
    static: scores.static?.passed ?? null,
    requestedTests: tests,
    complete,
    correctedScorer:
      corrected === null
        ? null
        : {
            ...corrected,
            complete: isComplete({
              hidden: corrected.hidden,
              visible: corrected.delivered,
              static: corrected.static,
            }),
          },
    productAcceptable: record.invocation?.productVerdict?.acceptable ?? null,
    claimed: record.invocation?.completion?.claim ?? null,
    wallMs: record.invocation?.wallMs ?? null,
    tokens: record.invocation?.tokens ?? null,
    unknownUsageCalls: record.invocation?.usage?.unknownCalls ?? null,
    reviewAttempt: reviewEffect,
  });
}
writeFileSync(values.out, `${JSON.stringify(scored, null, 2)}\n`);
for (const one of scored)
  console.log(
    `${one.task} s${one.sample} ${one.arm}: ${one.outcome}${one.hidden === undefined ? "" : `, hidden ${one.hidden}, complete ${one.complete}, product ${one.productAcceptable}${one.reviewAttempt ? `, review attempt ${one.reviewAttempt.attempt} ${one.reviewAttempt.change}` : ""}`}`,
  );
