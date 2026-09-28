#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { loadRows, rowsDigest as rowsDigestOf } from "./rows.mjs";

const [rowsDirectory, out] = process.argv.slice(2);
if (!rowsDirectory || !out) {
  console.error("usage: ablations.mjs <rows directory> <out.md>");
  process.exit(2);
}
const rows = loadRows(rowsDirectory);
const rowsDigest = rowsDigestOf(rowsDirectory);

const truthOf = (row) => row.adjudication?.status;
const judged = rows.filter((row) =>
  ["requirement-met", "requirement-violated"].includes(truthOf(row)),
);
const failedChecks = (row) =>
  Object.entries(row.verdict?.checks ?? {})
    .filter(([, status]) => status === "failed")
    .map(([id]) => id);

/** The verifier's recorded regression-only decision, as Comparison A's A1 reads it. */
const verifierDecision = (row) => {
  if (row.outcome !== "executed") return "unmeasured";
  if (row.verdict?.refusal) return "refuse";
  if (row.verdict?.verified === true || row.verdict?.regression === "pass") return "accept";
  if (failedChecks(row).length > 0) return "refuse";
  return "unmeasured";
};

const rungs = {
  S0: (row) => {
    if (row.outcome !== "executed") return "unmeasured";
    const tests = row.verdict?.checks?.tests;
    return tests === "passed" ? "accept" : tests === "failed" ? "refuse" : "unmeasured";
  },
  // The registered S1: the verifier's own regression-only decision (A1) with the coverage
  // dimension masked. Without a contract, coverage and mutation feed the unmeasured and reach
  // readings, never accept or refuse, so the masked decision is the recorded one. An earlier
  // version re-derived the inherited-failure rule here instead and dropped the rule that a
  // required check which stood down leaves regression unmeasured, which accepted a row the
  // verifier itself left unmeasured (felixrieseberg/claude-coach#18).
  S1: (row) => verifierDecision(row),
  S2: (row) => {
    const oracle = row.comparisonA2;
    if (oracle !== undefined && oracle.outcome === "executed")
      return oracle.verified === true
        ? "accept"
        : oracle.refusal || oracle.task === "rejected"
          ? "refuse"
          : "unmeasured";
    return verifierDecision(row);
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

Derived from ${rows.length} row(s) in \`${rowsDirectory}\` (digest ${rowsDigest}) under the
frozen decision rule; ${judged.length} rows carry adjudicated truth and are the denominator of every
count. Read as what each addition changed, never as a ranking.

| Rung | What it adds | Agreement | False green | False red | Unmeasured |
| --- | --- | --- | --- | --- | --- |
${[
  ["S0", "the repository's own test command, exit code only"],
  [
    "S1",
    "the base control and the identity, isolation, install and output refusals, as the verifier version in these rows applies them",
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
