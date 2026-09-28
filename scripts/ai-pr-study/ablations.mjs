#!/usr/bin/env node
/**
 * The ablation ladder S0, S1, S2 of docs/verifier-first/comparison-protocol.md, read off the
 * study rows under the frozen decision rule: S0 the suite alone (the A0 decision), S1 the
 * verifier with its base control and refusals but the coverage and mutation dimensions
 * masked, S2 the verifier in full and, where a row carries an A2 pass, with the held-back
 * check as oracle. Each rung reports the same decision counts against the adjudicated truth.
 *
 *   node scripts/ai-pr-study/ablations.mjs <rows directory> <out.md>
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [rowsDirectory, out] = process.argv.slice(2);
if (!rowsDirectory || !out) {
  console.error("usage: ablations.mjs <rows directory> <out.md>");
  process.exit(2);
}
const files = readdirSync(rowsDirectory)
  .filter((name) => /^\d+\.json$/.test(name))
  .sort();
const rows = files.map((name) => JSON.parse(readFileSync(join(rowsDirectory, name), "utf8")));
const digest = createHash("sha256");
for (const name of files) digest.update(readFileSync(join(rowsDirectory, name)));

const truthOf = (row) => row.adjudication?.status;
const judged = rows.filter((row) =>
  ["requirement-met", "requirement-violated"].includes(truthOf(row)),
);
const failedChecks = (row) =>
  Object.entries(row.verdict?.checks ?? {})
    .filter(([, status]) => status === "failed")
    .map(([id]) => id);
const inherited = (row) => new Set(Object.keys(row.verdict?.inherited ?? {}));

const rungs = {
  S0: (row) => {
    if (row.outcome !== "executed") return "unmeasured";
    const tests = row.verdict?.checks?.tests;
    return tests === "passed" ? "accept" : tests === "failed" ? "refuse" : "unmeasured";
  },
  // The base control and the refusal paths, and nothing from coverage or mutation: a failure
  // the base carried is inherited and not charged; a failure the base did not have refuses.
  S1: (row) => {
    if (row.outcome !== "executed") return "unmeasured";
    if (row.verdict?.refusal) return "refuse";
    const own = failedChecks(row).filter((id) => !inherited(row).has(id));
    if (own.length > 0) return "refuse";
    const passed = Object.values(row.verdict?.checks ?? {}).some((status) => status === "passed");
    return passed ? "accept" : "unmeasured";
  },
  S2: (row) => {
    const oracle = row.comparisonA2;
    if (oracle !== undefined && oracle.outcome === "executed")
      return oracle.verified === true
        ? "accept"
        : oracle.refusal || oracle.task === "rejected"
          ? "refuse"
          : "unmeasured";
    if (row.outcome !== "executed") return "unmeasured";
    if (row.verdict?.refusal) return "refuse";
    if (row.verdict?.verified === true || row.verdict?.regression === "pass") return "accept";
    if (failedChecks(row).length > 0) return "refuse";
    return "unmeasured";
  },
};
function wilson(k, n) {
  if (n === 0) return "";
  const z = 1.959964;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return ` [${(Math.max(0, c - h) * 100).toFixed(1)}, ${(Math.min(1, c + h) * 100).toFixed(1)}]`;
}
const share = (k, n) =>
  n === 0 ? "n/a" : `${k} / ${n} = ${((100 * k) / n).toFixed(1)}%${wilson(k, n)}`;
function tally(rung) {
  const t = { agree: 0, falseGreen: 0, falseRed: 0, unmeasured: 0, n: judged.length };
  for (const row of judged) {
    const d = rungs[rung](row);
    const truth = truthOf(row);
    if (d === "unmeasured") t.unmeasured += 1;
    else if (
      (d === "accept" && truth === "requirement-met") ||
      (d === "refuse" && truth === "requirement-violated")
    )
      t.agree += 1;
    else if (d === "accept") t.falseGreen += 1;
    else t.falseRed += 1;
  }
  return t;
}
const page = `# Ablations S0, S1, S2

Derived from ${rows.length} row(s) in \`${rowsDirectory}\` (digest sha256:${digest.digest("hex")}) under the
frozen decision rule; ${judged.length} rows carry adjudicated truth and are the denominator of every
count. Read as what each addition changed, never as a ranking.

| Rung | What it adds | Agreement | False green | False red | Unmeasured |
| --- | --- | --- | --- | --- | --- |
${[
  ["S0", "the repository's own test command, exit code only"],
  [
    "S1",
    "the base control (an inherited failure is not charged to the patch) and the identity, isolation, install and output refusals",
  ],
  [
    "S2",
    "changed-line coverage and mutation witnesses, and the held-back check as oracle where an A2 pass exists",
  ],
]
  .map(([rung, adds]) => {
    const t = tally(rung);
    return `| ${rung} | ${adds} | ${share(t.agree, t.n)} | ${share(t.falseGreen, t.n)} | ${share(t.falseRed, t.n)} | ${share(t.unmeasured, t.n)} |`;
  })
  .join("\n")}

S1 is read off the same rows as the verifier's verdict with the coverage and mutation
dimensions masked, which on these rows changes no decision: those dimensions feed the
unmeasured and oracle-reach readings, not the accept or refuse decision, when no contract is
supplied. S2 differs from S1 only on rows with an A2 pass.

## Rows

| # | Pull request | Truth | S0 | S1 | S2 |
| --- | --- | --- | --- | --- | --- |
${judged.map((row) => `| ${row.index} | [${row.repository}#${row.number}](${row.url}) | ${truthOf(row)} | ${rungs.S0(row)} | ${rungs.S1(row)} | ${rungs.S2(row)} |`).join("\n")}
`;
writeFileSync(out, page);
console.log(`ablations written to ${out}: ${judged.length} judged rows`);
