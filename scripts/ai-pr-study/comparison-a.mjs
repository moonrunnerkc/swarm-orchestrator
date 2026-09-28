#!/usr/bin/env node
/**
 * Comparison A over the study rows, under the frozen decision rule of
 * docs/verifier-first/comparison-protocol.md: for each row with adjudicated truth, the decision
 * of A0 (the repository's own suite, exit code only), A1 (swarm-verify regression-only, its
 * verdict) and, where a row carries one, A2 (the held-back check as an oracle over the same
 * run). Agreement, false green, false red and unmeasured shares per arm with Wilson intervals,
 * and the paired difference in false greens with the count of discordant rows.
 *
 *   node scripts/ai-pr-study/comparison-a.mjs <rows directory> <out.md>
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [rowsDirectory, out] = process.argv.slice(2);
if (!rowsDirectory || !out) {
  console.error("usage: comparison-a.mjs <rows directory> <out.md>");
  process.exit(2);
}
const files = readdirSync(rowsDirectory)
  .filter((name) => /^\d+\.json$/.test(name))
  .sort();
const rows = files.map((name) => JSON.parse(readFileSync(join(rowsDirectory, name), "utf8")));
const digest = createHash("sha256");
for (const name of files) digest.update(readFileSync(join(rowsDirectory, name)));

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

/** The frozen rule's decision for each arm. */
const decisions = {
  A0: (row) => {
    if (row.outcome !== "executed") return "unmeasured";
    const tests = row.verdict?.checks?.tests;
    return tests === "passed" ? "accept" : tests === "failed" ? "refuse" : "unmeasured";
  },
  A1: (row) => {
    if (row.outcome !== "executed") return "unmeasured";
    if (row.verdict?.refusal) return "refuse";
    if (row.verdict?.verified === true || row.verdict?.regression === "pass") return "accept";
    if (Object.values(row.verdict?.checks ?? {}).some((status) => status === "failed"))
      return "refuse";
    return "unmeasured";
  },
  A2: (row) => {
    const oracle = row.comparisonA2;
    if (oracle === undefined) return "not-run";
    if (oracle.outcome !== "executed") return "unmeasured";
    return oracle.verified === true
      ? "accept"
      : oracle.refusal || oracle.task === "rejected"
        ? "refuse"
        : "unmeasured";
  },
};
const truthOf = (row) => row.adjudication?.status;
const judged = rows.filter((row) =>
  ["requirement-met", "requirement-violated"].includes(truthOf(row)),
);

function tally(arm) {
  const t = { agree: 0, falseGreen: 0, falseRed: 0, unmeasured: 0, notRun: 0, n: judged.length };
  for (const row of judged) {
    const d = decisions[arm](row);
    const truth = truthOf(row);
    if (d === "not-run") t.notRun += 1;
    else if (d === "unmeasured") t.unmeasured += 1;
    else if (d === "accept" && truth === "requirement-met") t.agree += 1;
    else if (d === "refuse" && truth === "requirement-violated") t.agree += 1;
    else if (d === "accept" && truth === "requirement-violated") t.falseGreen += 1;
    else if (d === "refuse" && truth === "requirement-met") t.falseRed += 1;
  }
  return t;
}
const arms = ["A0", "A1", "A2"].map((arm) => [arm, tally(arm)]);
const discordant = judged.filter((row) => {
  const a0 = decisions.A0(row) === "accept" && truthOf(row) === "requirement-violated";
  const a1 = decisions.A1(row) === "accept" && truthOf(row) === "requirement-violated";
  return a0 !== a1;
});
const rule = (t) =>
  `| agreement ${share(t.agree, t.n)} | false green ${share(t.falseGreen, t.n)} | false red ${share(t.falseRed, t.n)} | unmeasured ${share(t.unmeasured, t.n)}${t.notRun ? ` | not run ${t.notRun}` : ""} |`;

const page = `# Comparison A: identical-patch verifier decisions

Derived from ${rows.length} row(s) in \`${rowsDirectory}\` (digest sha256:${digest.digest("hex")}) under the
frozen decision rule of \`docs/verifier-first/comparison-protocol.md\`. Rows with adjudicated
truth: ${judged.length} of ${rows.length}; every other row is outside every denominator here.
${judged.length < 10 ? "Fewer than ten judged rows: no difference below is called meaningful, as the rule requires.\n" : ""}
| Arm | Agreement | False green | False red | Unmeasured |
| --- | --- | --- | --- | --- |
${arms.map(([arm, t]) => `| ${arm} ${rule(t)}`).join("\n")}

Paired false-green difference A0 minus A1: ${arms[0][1].falseGreen - arms[1][1].falseGreen}, over
${discordant.length} discordant row(s)${discordant.length < 10 ? " (below the ten the rule requires before a difference is called meaningful)" : ""}.

A0 is the repository's own test command, exit code only. A1 is swarm-verify's regression-only
verdict over the same run: the same suite, plus the base control and the refusal paths. A2 is
swarm-verify with the held-back check as an oracle; rows without an A2 pass read "not run".

## Rows

| # | Pull request | Truth | A0 | A1 | A2 |
| --- | --- | --- | --- | --- | --- |
${judged.map((row) => `| ${row.index} | [${row.repository}#${row.number}](${row.url}) | ${truthOf(row)} | ${decisions.A0(row)} | ${decisions.A1(row)} | ${decisions.A2(row)} |`).join("\n")}
`;
writeFileSync(out, page);
console.log(
  `comparison A written to ${out}: ${judged.length} judged rows, ${discordant.length} discordant`,
);
