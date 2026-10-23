/**
 * Audit of one held-out evaluator rule after the block was complete, with no model. The fastify
 * rename's "nothing still points at an old file name" rule matches any quoted old file name, so a
 * test asserting that the old file no longer exists (`existsSync(join(base, 'types',
 * 'serverFactory.d.ts'))` expected false) counts as a reference to it. The amended rule ignores a
 * line whose match sits inside an `existsSync(` call; everything else in the sealed check is
 * unchanged. Both rules then read the reference, every faulty and alternative control and every
 * delivered patch through the runner's own hidden scorer, so the audit shows exactly which
 * verdicts the amendment changes.
 *
 *   node evaluator-audit.mjs --manifest <manifest.json> --sealed <sealed-directory> \
 *     --runs <runs-directory> --out <json>
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { commandLog } from "../../../scripts/campaign/exec.mjs";
import { hiddenVerdict } from "../../../scripts/comparison/checks.mjs";

const { values } = parseArgs({ options: Object.fromEntries(["manifest", "sealed", "runs", "out"].map((name) => [name, { type: "string" }])) });
if (existsSync(values.out)) throw new Error(`${values.out} exists; results are never overwritten`);
const manifest = JSON.parse(readFileSync(values.manifest, "utf8"));
const registered = manifest.tasks.find((task) => task.id === "fastify-refactor-kebab-case-file-names");

const original = "if (patterns.some((pattern) => pattern.test(line))) hits.push";
const amended = "if (patterns.some((pattern) => pattern.test(line)) && !/existsSync\\(/.test(line)) hits.push";
const source = registered.hidden.files[0].source;
if (source.split(original).length !== 2) throw new Error("the registered rule's line is not found exactly once");
const amendedTask = {
  ...registered,
  hidden: { ...registered.hidden, files: [{ ...registered.hidden.files[0], source: source.replace(original, amended) }] },
};

const subjects = [
  { name: "reference", patch: join(values.sealed, "fastify-rename", "reference.patch") },
  ...readdirSync(join(values.sealed, "fastify-rename", "controls"))
    .sort()
    .map((file) => ({ name: `control ${file.replace(/\.patch$/, "")}`, patch: join(values.sealed, "fastify-rename", "controls", file) })),
  ...["swarm", "swarm-control", "swarm-direct", "opencode"].map((arm) => {
    const record = JSON.parse(readFileSync(join(values.runs, `${registered.id}.${arm}.json`), "utf8"));
    return { name: `delivered ${arm}`, patch: join(values.runs, "blobs", record.finalPatchDigest.slice(7)) };
  }),
];

const log = commandLog(join(values.out, "..", "audit-blobs"));
const rows = [];
for (const subject of subjects) {
  const patch = readFileSync(subject.patch, "utf8");
  const row = { subject: subject.name, patchBytes: Buffer.byteLength(patch) };
  for (const [label, task] of [["registered", registered], ["amended", amendedTask]]) {
    const verdict = await hiddenVerdict(log, task, task.baseCommit, task.upstreamCommit, patch);
    row[label] = { verdict: verdict.verdict, basis: verdict.basis, failing: (verdict.detail ?? "").split("\n").filter((line) => line.startsWith("not ok")) };
  }
  rows.push(row);
  console.log(JSON.stringify({ subject: row.subject, registered: row.registered.verdict, amended: row.amended.verdict }));
}
writeFileSync(values.out, `${JSON.stringify({ rule: { original, amended }, rows }, null, 2)}\n`, { flag: "wx" });
