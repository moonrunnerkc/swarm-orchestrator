/**
 * Each launch of a block that started from a retained candidate, read after the block has ended
 * and its hidden verdicts are revealed: what the review established, the attempt it was owed,
 * what was delivered, the hidden verdict on the start (from the development set's validation) and
 * on the delivered tree, the product's verdict, and the cost.
 *
 *   node read-launches.mjs --stage <study stage> --validation <validation.json> --out <file.json>
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    stage: { type: "string" },
    validation: { type: "string" },
    candidates: { type: "string" },
    out: { type: "string" },
  },
});
const manifest = JSON.parse(readFileSync(join(values.stage, "manifest.json"), "utf8"));
const runs = join(values.stage, "runs");
const revealed = JSON.parse(readFileSync(join(runs, "revealed.json"), "utf8"));
const validation = JSON.parse(readFileSync(values.validation, "utf8")).results;
const blob = (digest) => readFileSync(join(runs, "blobs", digest.slice("sha256:".length)), "utf8");
const established = new Set(["preservation-regression", "requested-unmet", "relation-violated"]);

/** The review's examination and its attempt records, read from the launch's kept session. */
function examination(evidence) {
  if (typeof evidence !== "string" || !existsSync(join(evidence, "ledger.jsonl"))) return null;
  const payloads = readFileSync(join(evidence, "ledger.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
    .filter((one) => one.type === "verification-command")
    .map((one) => JSON.parse(readFileSync(join(evidence, "blobs", `${one.payloadDigest.slice(7)}.json`), "utf8")));
  const examined = payloads.find((one) => one.rule === "candidate-review-v3" && one.phase === "examined");
  const withheld = payloads.find((one) => one.rule === "candidate-review-v3" && one.phase === "withheld");
  if (examined === undefined) return withheld === undefined ? null : { withheld: withheld.reason ?? "" };
  return {
    loader: examined.grounding?.loader ?? null,
    reviewerProbes: (examined.probes ?? []).filter((one) => one.origin !== "task").map((one) => one.id),
    dropped: examined.dropped ?? [],
    validation: examined.validation ?? [],
    established: (examined.classified ?? [])
      .filter((one) => established.has(one.reading))
      .map((one) => ({ probe: one.probe, index: one.index, input: one.input, expected: one.expected, candidate: one.candidate, reading: one.reading, authority: one.authority })),
    readings: Object.fromEntries(
      Object.entries(
        (examined.classified ?? []).reduce((all, one) => ({ ...all, [one.reading]: (all[one.reading] ?? 0) + 1 }), {}),
      ),
    ),
    charge: examined.charge ?? null,
    wallMs: examined.wallMs ?? null,
  };
}

/** A patch's changed lines, by file, which two renderings of one change share. */
function changedLines(patch) {
  const out = [];
  let file = "";
  for (const line of patch.split("\n")) {
    const named = /^diff --git a\/\S+ b\/(\S+)$/.exec(line);
    if (named !== null) file = named[1];
    else if (/^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line)) out.push(`${file}\t${line}`);
  }
  return out.sort().join("\n");
}

const rows = [];
for (const record of revealed) {
  const launch = manifest.launches.find(
    (one) => one.task === record.task && one.arm === record.arm && (one.sample ?? 1) === (record.sample ?? 1),
  );
  const stdout = record.invocation?.stdoutDigest ? blob(record.invocation.stdoutDigest) : "";
  const result = stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return {};
      }
    })
    .find((line) => line.schema === "swarm.result.v1" || line.bundleDirectory !== undefined);
  const review = result?.outcome?.review ?? null;
  const readings = review?.readings ?? [];
  const counts = {};
  for (const one of readings) counts[one.reading] = (counts[one.reading] ?? 0) + 1;
  const start = validation.find((one) => one.id === launch?.candidate);
  rows.push({
    candidate: launch?.candidate ?? null,
    task: record.task,
    arm: record.arm,
    sample: record.sample ?? 1,
    outcome: record.outcome,
    review: review === null ? null : review.examination === null ? "not examined" : "examined",
    examination: examination(record.evidence),
    probes: review?.probes ?? [],
    readings: counts,
    findingsOnDelivered: readings
      .filter((one) => established.has(one.reading))
      .map((one) => ({
        probe: one.probe,
        index: one.index,
        input: one.input,
        expected: one.expected,
        candidate: one.candidate,
        reading: one.reading,
      })),
    attempt: review?.attempt ?? null,
    deliveredPatch: record.finalPatchDigest,
    startDigest: start?.digest ?? null,
    deliveredIsStart:
      start === undefined || record.finalPatchDigest === undefined
        ? null
        : changedLines(blob(record.finalPatchDigest)) ===
          changedLines(readFileSync(join(values.candidates, start.patch), "utf8")),
    hiddenOnStart: start?.verdict ?? null,
    hiddenOnDelivered: record.scores?.hidden?.verdict ?? null,
    hiddenBasis: record.scores?.hidden?.basis ?? null,
    productAcceptable: record.invocation?.productVerdict?.acceptable ?? null,
    status: result?.outcome?.status ?? null,
    requested: (result?.outcome?.preservation ?? [])
      .filter((one) => one.id.startsWith("code-") || one.category === "requested")
      .map((one) => `${one.id}:${one.status}`),
    wallMs: record.invocation?.wallMs ?? null,
    tokens: record.invocation?.tokens ?? null,
    unknownUsageCalls: record.invocation?.usage?.unknownCalls ?? null,
    replay: record.startingCandidate ?? null,
  });
}
writeFileSync(values.out, `${JSON.stringify({ stage: values.stage, rows }, null, 2)}\n`);
for (const row of rows)
  console.log(
    `${row.candidate} ${row.arm}#${row.sample}: ${row.review ?? "no review"}, findings ${row.findingsOnDelivered.length}, attempt ${row.attempt?.state ?? "none"}/${row.attempt?.accepted ?? "-"}, hidden ${row.hiddenOnStart} -> ${row.hiddenOnDelivered}, product ${row.productAcceptable}, ${Math.round((row.wallMs ?? 0) / 1000)} s, ${row.tokens} tokens`,
  );
