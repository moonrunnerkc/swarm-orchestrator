// What the candidate review did in each Swarm launch of a study, read from the kept session
// ledgers with no model: whether it examined or was withheld and why, the probes it admitted and
// dropped, every case reading, the attempt its findings were owed and the ratchet's decision on
// it, and what the review cost. Order on the chain only; nothing here says a notice caused an edit.
//
// usage: node review-account.mjs --runs <study runs directory> --out <file>
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { runs: { type: "string" }, out: { type: "string" } } });
if (!values.runs || !values.out) throw new Error("usage: --runs <directory> --out <file>");

function payloads(session) {
  return readFileSync(join(session, "ledger.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
    .map((record) => ({
      record,
      payload: JSON.parse(
        readFileSync(join(session, "blobs", `${record.payloadDigest.slice(7)}.json`), "utf8"),
      ),
    }));
}

const accounts = [];
for (const name of readdirSync(values.runs).filter((file) => /\.json$/.test(file))) {
  if (!/\.swarm(-[a-z]+)?\.json$/.test(name) || /setup-|preflight-|revealed/.test(name)) continue;
  const study = JSON.parse(readFileSync(join(values.runs, name), "utf8"));
  if (study.evidence === undefined || !existsSync(study.evidence)) continue;
  const sessions = existsSync(join(study.evidence, "ledger.jsonl"))
    ? [study.evidence]
    : readdirSync(study.evidence).map((one) => join(study.evidence, one));
  for (const session of sessions) {
    if (!existsSync(join(session, "ledger.jsonl"))) continue;
    const all = payloads(session);
    const review = all.filter(({ payload }) => payload.rule === "candidate-review-v1");
    const declared = review.find(({ payload }) => payload.phase === "declared")?.payload;
    if (declared === undefined) continue;
    const examined = review.find(({ payload }) => payload.phase === "examined")?.payload;
    const withheld = review.find(({ payload }) => payload.phase === "withheld")?.payload;
    const remeasured = review.filter(({ payload }) => payload.phase === "remeasured").map(({ payload }) => payload);
    const attempt = all.find(({ payload }) => payload.rule === "candidate-review-attempt-v1")?.payload;
    const tally = (classified) =>
      Object.fromEntries(
        Object.entries(
          (classified ?? []).reduce((counts, one) => ({ ...counts, [one.reading]: (counts[one.reading] ?? 0) + 1 }), {}),
        ),
      );
    accounts.push({
      record: name,
      task: study.task,
      sample: study.sample ?? 1,
      arm: study.arm,
      mode: declared.mode,
      examined: examined !== undefined,
      withheld: withheld?.reason ?? null,
      answerError: examined?.answerError ?? null,
      probes: (examined?.probes ?? []).map((one) => ({ id: one.id, basis: one.basis, cases: one.cases.length })),
      objections: examined?.objections?.length ?? null,
      dropped: examined?.dropped ?? [],
      readings: tally(examined?.classified),
      established: (examined?.classified ?? []).filter((one) =>
        ["preservation-regression", "missed-requirement"].includes(one.reading),
      ).length,
      finalReadings: remeasured.length === 0 ? null : tally(remeasured.at(-1).classified),
      attempt:
        attempt === undefined
          ? null
          : { attempt: attempt.attempt, state: attempt.state, accepted: attempt.accepted, reason: attempt.reason },
      cost: examined?.charge === undefined ? null : { tokens: examined.charge.tokensUsed, steps: examined.charge.steps, wallMs: examined.wallMs ?? null },
    });
  }
}
writeFileSync(values.out, `${JSON.stringify(accounts, null, 2)}\n`);
for (const one of accounts)
  console.log(
    `${one.task} s${one.sample} ${one.arm} (${one.mode}): ${one.examined ? `examined, ${one.probes.length || one.objections || 0} probe(s)/objection(s), ${one.established} established, readings ${JSON.stringify(one.readings)}` : `withheld: ${one.withheld}`}; attempt ${one.attempt === null ? "none" : `${one.attempt.attempt} ${one.attempt.state} accepted=${one.attempt.accepted}`}`,
  );
