#!/usr/bin/env node
/**
 * The external evaluation of every candidate of one launch, after the launch has finished: the
 * frozen evaluator (`../../2026-10-17/repair-trust-live/score.mjs`) and the expanded audit
 * (`../../2026-10-18/checking-semantics/validate-expanded-audit.mjs --patch`), each run unchanged
 * on each candidate's exact patch, apart. This is evaluation evidence only: it runs after the
 * product has delivered, it never reaches a model or a launch's workspace, and nothing it finds
 * is given to the product or decides what the product delivered.
 *
 *   node score-candidates.mjs --candidates <dir with *.patch> --out <dir>
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { candidates: { type: "string" }, out: { type: "string" } } });
if (values.candidates === undefined || values.out === undefined)
  throw new Error("usage: score-candidates.mjs --candidates <dir> --out <dir>");
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
if (readdirSync(out).length > 0) throw new Error(`${out} is not empty; a record is never overwritten`);
const here = new URL(".", import.meta.url).pathname;
const evaluator = join(here, "../../2026-10-17/repair-trust-live/score.mjs");
const audit = join(here, "../../2026-10-18/checking-semantics/validate-expanded-audit.mjs");

const rows = [];
for (const name of readdirSync(values.candidates).filter((one) => one.endsWith(".patch")).sort()) {
  const label = name.replace(/\.patch$/, "");
  const patch = resolve(values.candidates, name);
  const verdictFile = join(out, `${label}.final-verdict.json`);
  const auditFile = join(out, `${label}.expanded-audit.json`);
  const scored = spawnSync(process.execPath, [evaluator, "--task", "mime", "--patch", patch, "--out", verdictFile], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (scored.status !== 0) throw new Error(`${label}: the evaluator did not run: ${scored.stderr.slice(-800)}`);
  const audited = spawnSync(process.execPath, [audit, "--out", auditFile, "--patch", patch, "--name", label], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (audited.status !== 0) throw new Error(`${label}: the expanded audit did not run: ${audited.stderr.slice(-800)}`);
  const verdict = JSON.parse(readFileSync(verdictFile, "utf8"));
  const expanded = JSON.parse(readFileSync(auditFile, "utf8"));
  const [row] = expanded.rows;
  rows.push({
    candidate: label,
    patchDigest: verdict.patchDigest,
    evaluator: verdict.verdict,
    evaluatorBasis: verdict.basis,
    developmentContract: row.originalDevelopmentContract,
    customExtension: row.customExtension,
    relationBound: row.relationBound,
    projectSuite: row.projectSuite,
    expandedPasses: verdict.verdict === "pass" && row.customExtension === "passes",
  });
}
writeFileSync(join(out, "scores.json"), `${JSON.stringify({ schema: "swarm-candidate-scores.v1", rows }, null, 2)}\n`);
console.table(rows.map(({ evaluatorBasis, ...row }) => ({ ...row, patchDigest: row.patchDigest.slice(0, 19) })));
