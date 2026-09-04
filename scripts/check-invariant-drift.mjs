/**
 * CLAUDE.md and AGENTS.md carry the same numbered invariant block for two different
 * readers. They have drifted before, and the drift is not cosmetic: invariant 9 promised
 * known-pattern scrubbing in one file while the other had already been amended, so which
 * file an agent read decided what guarantee it thought it was holding to.
 *
 * Compares the block line by line and names the first invariant that differs.
 *
 * Run over this repository with no arguments, it also holds the predicate catalogue the
 * system prompt carries to the ledger's record types and to the verifier a bundle ships: a
 * record type the catalogue does not name, or an example the verifier does not read as true
 * of its sample, is the same drift one layer down, a prompt describing a language the
 * verifier does not evaluate.
 *
 *   node scripts/check-invariant-drift.mjs
 */
import { readFileSync } from "node:fs";
import { argv, exit, stdout } from "node:process";

const heading = "## Invariants";
const files = argv.slice(2);
const [first, second] = files.length === 2 ? files : ["CLAUDE.md", "AGENTS.md"];

/** The numbered lines under the invariants heading, in order, as written. */
function invariantsOf(path) {
  const lines = readFileSync(path, "utf8").split("\n");
  const start = lines.findIndex((line) => line.startsWith(heading));
  if (start === -1) {
    throw new Error(`${path} has no "${heading}" heading`);
  }
  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) {
      break;
    }
    if (/^\d+\. /.test(line)) {
      block.push(line);
    }
  }
  if (block.length === 0) {
    throw new Error(`${path} lists no invariants under "${heading}"`);
  }
  return block;
}

const left = invariantsOf(first);
const right = invariantsOf(second);
const problems = [];

if (left.length !== right.length) {
  problems.push(`${first} lists ${left.length} invariants and ${second} lists ${right.length}`);
}

for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
  if (left[index] !== right[index]) {
    const number = /^(\d+)\./.exec(left[index])?.[1] ?? String(index + 1);
    problems.push(`invariant ${number} differs between ${first} and ${second}`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) {
    process.stderr.write(`invariant drift: ${problem}\n`);
  }
  process.stderr.write(
    `\nThe two files carry one block for two readers. Copy the amended invariant across ` +
      `rather than editing one of them.\n`,
  );
  exit(1);
}

stdout.write(`invariant block matches across ${first} and ${second}: ${left.length} invariants\n`);

if (files.length === 0) {
  const { catalogueDrift, predicateCatalogue } = await import(
    "../src/evidence/predicate-catalogue.ts"
  );
  const drift = catalogueDrift();
  if (drift.length > 0) {
    for (const problem of drift) {
      process.stderr.write(`catalogue drift: ${problem}\n`);
    }
    process.stderr.write(
      "\nThe prompt's predicate catalogue is rendered from src/evidence/predicate-catalogue.ts, " +
        "and every entry is held to the ledger's record types and the shipped verifier.\n",
    );
    exit(1);
  }
  stdout.write(
    `predicate catalogue matches the ledger and the verifier: ${predicateCatalogue.length} record kinds\n`,
  );
}
