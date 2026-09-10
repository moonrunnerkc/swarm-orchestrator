#!/usr/bin/env node
/**
 * How often the lexical rule behind `delete-statement` would be wrong without the parse check.
 *
 * The operator proposes a deletion where a line reads as a whole statement, and that reading is
 * lexical because the planner has one line and no parser. A line can balance, start and end on a
 * token that looks final, and still be the middle of an expression the line below it continues.
 * `mutant-parse.ts` catches those with `node --check` and discards them, because a file that no
 * longer compiles is refused by every oracle and crediting that refusal would be crediting a
 * syntax error.
 *
 * That is the argument. This is the number: every deletion the planner proposes over real
 * JavaScript, checked, with the ones the check throws away named.
 *
 *   node scripts/deletion-parse-rate.mjs <directory> [<directory> ...]
 *
 * Runs no model and judges nothing. Files `node --check` cannot read are skipped, since the
 * operator proposes nothing for them either.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { mutantsOfChangedLines } from "../dist/gates/oracle-mutants.js";

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.log("name at least one directory of JavaScript to read");
  process.exit(1);
}

/** Big generated bundles say nothing about hand-written statements and cost minutes. */
const largestFileBytes = 400_000;

function javascriptUnder(root, found = []) {
  for (const name of readdirSync(root)) {
    if (name === "node_modules" || name === ".git" || name.startsWith(".")) {
      continue;
    }
    const path = join(root, name);
    const info = statSync(path);
    if (info.isDirectory()) {
      javascriptUnder(path, found);
    } else if (/\.(js|mjs|cjs)$/.test(name) && info.size < largestFileBytes) {
      found.push(path);
    }
  }
  return found;
}

function parses(path) {
  try {
    execFileSync(process.execPath, ["--check", path], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const scratch = mkdtempSync(join(tmpdir(), "swarm-deletion-"));
const mutantPath = join(scratch, "mutant.js");
let read = 0;
let proposed = 0;
let discarded = 0;
const named = [];

try {
  for (const root of roots) {
    for (const file of javascriptUnder(root)) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("\n") || !parses(file)) {
        continue;
      }
      read += 1;
      const lines = source.split("\n");
      // Every line offered as an added line, which is the strongest version of the question: what
      // the operator would do given the whole file rather than one patch's worth of it.
      const deletions = mutantsOfChangedLines({
        changed: [
          { path: "probe.js", addedLines: lines.map((text, at) => ({ line: at + 1, text })) },
        ],
        limit: Number.MAX_SAFE_INTEGER,
        perOperatorLimit: Number.MAX_SAFE_INTEGER,
      }).filter((one) => one.operator === "delete-statement");

      for (const mutant of deletions) {
        proposed += 1;
        const mutated = [...lines];
        mutated[mutant.line - 1] = mutant.after;
        writeFileSync(mutantPath, mutated.join("\n"));
        if (!parses(mutantPath)) {
          discarded += 1;
          if (named.length < 10) {
            named.push(`${file}:${mutant.line}  ${mutant.before.trim().slice(0, 90)}`);
          }
        }
      }
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`${read} file(s) node --check reads, ${proposed} deletion(s) proposed`);
console.log(
  proposed === 0
    ? "nothing proposed, so there is no rate here rather than a rate of zero"
    : `${discarded} discarded as a syntax error: ${((discarded / proposed) * 100).toFixed(2)}%`,
);
for (const one of named) {
  console.log(`  discarded ${one}`);
}
console.log(
  "\nEach discarded line is the middle of an expression the line below it continues, which is what" +
    " one line of context cannot see. The check is what makes the operator safe rather than the" +
    " lexical rule, and this is the share of the work it does.",
);
