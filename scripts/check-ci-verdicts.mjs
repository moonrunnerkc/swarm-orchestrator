#!/usr/bin/env node
/**
 * Gate 3a: across every `swarm ci` verdict this repository records, the tool reports `verified`
 * zero times where its own record holds a reason to refuse.
 *
 * The bar is zero and the gate is tool-owned: it asks nothing of a model, an oracle or a corpus,
 * only whether the tool's green claims follow from the fields it wrote beside them. That is the
 * one part of gate 3 whose denominator the tool does not choose.
 *
 * The rule is not reimplemented here. It comes from `rederiveCiVerdict` in the dependency-free
 * verifier a bundle carries, which is the same code a third party runs on evidence this project
 * never sees, and a parity test holds that code to `src/gates/certification.ts`, where `swarm ci`
 * computes `verified` in the first place. A second checker would agree with the tool by
 * coincidence.
 *
 *   node scripts/check-ci-verdicts.mjs                # every recorded corpus
 *   node scripts/check-ci-verdicts.mjs <file.json>    # one file, for a fixture
 *
 * Exit 0 at zero violations. Exit 1 otherwise, each one named with the record that carries it.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { rederiveCiVerdict } from "../src/evidence/verifier/rederive.mjs";

const repositoryRoot = new URL("..", import.meta.url).pathname;

/**
 * Every file holding recorded `swarm ci` verdicts, with what a row in it is called.
 *
 * All of them, not the ones a published number quotes. A green claim nobody re-derives is the
 * thing this gate exists to bar, and a corpus left off the list is a set of claims nothing checks.
 */
const corpora = [
  ["campaign/pr-tasks/scored.json", "mined from merged pull requests"],
  ["campaign/pr-tasks/scored.attack.json", "mined, model shown the sealed oracle"],
  ["campaign/pr-tasks/scored.qwen38.json", "mined, second model arm"],
  ["docs/evidence/2026-09-06/second-oracle/scored.json", "hand-authored, two oracles per task"],
];

/**
 * The fields the verdict policy reads, out of a row whichever pass wrote it.
 *
 * The two passes named the task verdict differently, `sealedOracle` in the mined pass and
 * `firstOracle` in the hand-authored one, and both are the same field: what the oracle the tool
 * was handed said. A row carrying neither spelling names no task verdict and cannot be
 * re-derived, which is what the checker then reports.
 */
function verdictOf(row) {
  return {
    regression: row.regression,
    task: row.sealedOracle ?? row.firstOracle ?? row.task,
    oracleReach: row.oracleReach,
    oracleBond: row.oracleBond,
  };
}

function nameOf(row) {
  if (row.repository !== undefined) {
    return `${row.repository}#${row.pull}`;
  }
  return `${row.name}/${row.arm}/run-${row.run}`;
}

/**
 * What one file's rows say, and whether the tool's own record supports each of them.
 *
 * Three findings, and only the first two are about a green claim. A record that claims `verified`
 * with a reason to refuse recorded beside it is the gate's subject. A record that claims
 * `verified` and is missing a field the policy reads is the same claim with nothing to check it
 * against, which is not a lesser finding: it is a green nobody can re-derive. A record that
 * refuses with no reason recorded is the writer having dropped the reason, which is a defect in
 * the record rather than in the verdict, and it is named rather than passed over.
 */
export function judgeRecordedVerdicts(rows, label) {
  const violations = [];
  let agreed = 0;
  let notRederived = 0;

  for (const row of rows) {
    const judged = rederiveCiVerdict(verdictOf(row));
    const claimed = row.verified === true;
    if (!judged.rederived) {
      if (claimed) {
        violations.push(
          `${label}: ${nameOf(row)} claims verified and its record has no ` +
            `${judged.missing.join(", ")}, so nothing here can re-derive that claim`,
        );
      } else {
        notRederived += 1;
      }
      continue;
    }
    if (judged.verified === claimed) {
      agreed += 1;
      continue;
    }
    violations.push(
      claimed
        ? `${label}: ${nameOf(row)} claims verified and its own record holds ` +
          `${judged.reasons.join(", ")}`
        : `${label}: ${nameOf(row)} refuses and its own record holds no reason to refuse`,
    );
  }

  return { violations, agreed, notRederived };
}

/** Every violation across the named files, or across the project's own corpora where none are. */
export function checkRecordedVerdicts(named = [], log = console.log) {
  const files = named.length > 0 ? named.map((path) => [path, path]) : corpora;
  let violations = 0;
  let agreed = 0;
  let notRederived = 0;

  for (const [path, label] of files) {
    const absolute = resolve(repositoryRoot, path);
    if (!existsSync(absolute)) {
      log(`  SKIP      ${label}: no file at ${path}`);
      continue;
    }
    const parsed = JSON.parse(readFileSync(absolute, "utf8"));
    const rows = Array.isArray(parsed) ? parsed : (parsed.runs ?? []);
    const judged = judgeRecordedVerdicts(rows, label);
    violations += judged.violations.length;
    agreed += judged.agreed;
    notRederived += judged.notRederived;
    log(
      `  ${judged.violations.length === 0 ? "zero    " : "VIOLATES"}  ${label}: ` +
        `${rows.length} verdict(s), ${judged.agreed} re-derived and agreeing, ` +
        `${judged.notRederived} refusal(s) not re-derivable, ` +
        `${judged.violations.length} violation(s)`,
    );
    for (const violation of judged.violations) {
      log(`            ${violation}`);
    }
  }

  log(
    violations === 0
      ? `\ngate 3a: zero. ${agreed} recorded verdict(s) re-derive to what the tool claimed, ` +
          `${notRederived} refusal(s) name a field the record does not carry and are reported ` +
          "rather than agreed with."
      : `\ngate 3a FAILS: ${violations} verdict(s) the tool's own record does not support.`,
  );
  return violations;
}

if (import.meta.filename === process.argv[1]) {
  process.exit(checkRecordedVerdicts(process.argv.slice(2)) === 0 ? 0 : 1);
}
