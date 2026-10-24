// The offline assessor of the review's findings (candidate-review-v1 and v2), copied from the
// October 23 stage's assess-findings.mjs with two changes: it reads v2 records, and it judges every
// case that differs from the base, established or not (v2's `difference` and `base-raised` cases
// too), so a real regression the review left unacted on is counted as missed. References are used
// here and nowhere else, and never reach a model. Each such case is run again on the task's
// reference tree (the upstream commit), and judged:
//
// - a preservation finding is valid where the reference answers as the base does, so the
//   candidate's difference is one the correct change does not make;
// - a requirement finding, and a preservation finding whose expectation is the reviewer's, is
//   valid where the reference gives the expected answer;
// - otherwise it is a false accusation: the reference does what the candidate was faulted for.
//
// It also names each finding whose candidate the hidden evaluator passes, which is a false
// accusation by that evaluator's reading.
//
// usage: node assess-findings.mjs --manifest <study manifest.json> --out <file> [--revealed <runs/revealed.json>]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { plannedCheckRunner } from "../../../src/workers/planned-check-program.ts";

const { values } = parseArgs({
  options: {
    manifest: { type: "string" },
    out: { type: "string" },
    revealed: { type: "string" },
    mirrors: { type: "string", default: join(homedir(), ".cache/swarm-comparison/mirrors") },
  },
});
if (!values.manifest || !values.out) throw new Error("usage: --manifest <file> --out <file>");
const manifest = JSON.parse(readFileSync(values.manifest, "utf8"));
const runs = join(dirname(resolve(values.manifest)), "runs");
const revealed = values.revealed === undefined ? [] : JSON.parse(readFileSync(values.revealed, "utf8"));
const recordName = (one) => `${one.task}${(one.sample ?? 1) > 1 ? `~${one.sample}` : ""}.${one.arm}`;
const hiddenOf = (name) =>
  revealed.find((one) => one.task !== undefined && recordName(one) === name)?.scores?.hidden
    ?.verdict ?? null;

function must(argv, cwd) {
  const ran = spawnSync(argv[0], argv.slice(1), { cwd, encoding: "utf8", maxBuffer: 1 << 28 });
  if (ran.status !== 0) throw new Error(`${argv.join(" ")}: ${ran.stderr.slice(-1000)}`);
  return ran.stdout;
}

/** The reference tree of a task, checked out and installed once. */
const references = new Map();
function referenceTree(task) {
  const known = references.get(task.id);
  if (known !== undefined) return known;
  const root = join(dirname(resolve(values.out)), "reference-trees", task.id);
  if (!existsSync(join(root, ".git"))) {
    mkdirSync(dirname(root), { recursive: true });
    const mirror = join(values.mirrors, `${task.repository.replace("/", "__")}.git`);
    must(["git", "clone", "--quiet", "--no-checkout", mirror, root], dirname(root));
    must(["git", "checkout", "--quiet", task.upstreamCommit], root);
    for (const argv of task.install) must(argv, root);
  }
  references.set(task.id, root);
  return root;
}

/** One probe's answers on a tree, through the same runner the product uses. */
function answersOn(tree, probe) {
  const ran = spawnSync("node", ["--input-type=module", "-e", plannedCheckRunner], {
    cwd: tree,
    input: JSON.stringify({ program: probe.program, inputs: probe.cases.map((one) => one.input) }),
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 1 << 24,
  });
  if (ran.status !== 0) return { error: `runner exited ${ran.status}: ${(ran.stderr ?? "").slice(-400)}` };
  const canonical = (value) =>
    Array.isArray(value)
      ? value.map(canonical)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
        : value;
  return {
    answers: ran.stdout
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const read = JSON.parse(line);
        return read.threw === true ? '{"threw":true}' : JSON.stringify(canonical(read.result));
      }),
  };
}

function examinations(sessionDirectory) {
  const ledger = join(sessionDirectory, "ledger.jsonl");
  if (!existsSync(ledger)) return [];
  return readFileSync(ledger, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
    .filter((record) => record.type === "verification-command")
    .map((record) =>
      JSON.parse(
        readFileSync(join(sessionDirectory, "blobs", `${record.payloadDigest.slice(7)}.json`), "utf8"),
      ),
    )
    .filter(
      (payload) =>
        (payload.rule === "candidate-review-v1" || payload.rule === "candidate-review-v2") &&
        payload.phase === "examined",
    );
}

const assessed = [];
for (const name of readdirSync(runs).filter((file) => /\.json$/.test(file) && !/setup-|preflight-|revealed|correction-|stopped/.test(file))) {
  const record = JSON.parse(readFileSync(join(runs, name), "utf8"));
  if (record.evidence === undefined || record.arm === undefined || !record.arm.startsWith("swarm")) continue;
  const task = manifest.tasks.find((one) => one.id === record.task);
  const sessionDirectories = existsSync(join(record.evidence, "ledger.jsonl"))
    ? [record.evidence]
    : readdirSync(record.evidence).map((one) => join(record.evidence, one));
  for (const session of sessionDirectories)
    for (const examination of examinations(session))
      for (const finding of (examination.classified ?? []).filter((one) =>
        ["preservation-regression", "missed-requirement", "difference", "base-raised"].includes(
          one.reading,
        ),
      )) {
        const probe = examination.probes.find((one) => one.id === finding.probe);
        const onReference = answersOn(referenceTree(task), probe);
        const reference = onReference.answers?.[finding.index - 1] ?? null;
        // A preservation case's expectation is the base's answer, whatever it was read as.
        const expectation = probe.basis === "preserve" ? finding.base : finding.expected;
        assessed.push({
          record: name,
          arm: record.arm,
          task: record.task,
          probe: probe.id,
          case: finding.index,
          reading: finding.reading,
          established: finding.reading === "preservation-regression",
          authority: finding.authority ?? null,
          basis: probe.basis,
          expectation,
          base: finding.base,
          candidate: finding.candidate,
          reference,
          referenceError: onReference.error ?? null,
          verdict:
            reference === null
              ? "unjudged"
              : reference === expectation
                ? "valid"
                : "false-accusation",
          candidateHidden: hiddenOf(name.replace(/\.json$/, "")),
        });
      }
}
writeFileSync(values.out, `${JSON.stringify(assessed, null, 2)}\n`);
const count = (verdict) => assessed.filter((one) => one.verdict === verdict).length;
console.log(
  `${assessed.length} finding(s): ${count("valid")} valid, ${count("false-accusation")} false accusations, ${count("unjudged")} unjudged`,
);
