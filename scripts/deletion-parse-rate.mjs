#!/usr/bin/env node
/**
 * How often each mutation operator produces a file that does not parse.
 *
 * The operator proposes a deletion where a line reads as a whole statement, and that reading is
 * lexical because the planner has one line and no parser. A line can balance, start and end on a
 * token that looks final, and still be the middle of an expression the line below it continues.
 * `mutant-parse.ts` catches those with `node --check` and discards them, because a file that no
 * longer compiles is refused by every oracle and crediting that refusal would be crediting a
 * syntax error.
 *
 * The other seven are claimed to be incapable of it, because each replaces a token with a token of
 * the same shape, wraps a balanced region in a negation, or removes a balanced one. That claim is
 * the reason only one operator is checked at runtime, so it is measured here rather than asserted:
 * every operator, every line of every file, checked.
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
const proposed = new Map();
const discarded = new Map();
const named = [];
const count = (into, key) => into.set(key, (into.get(key) ?? 0) + 1);

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
      const mutants = mutantsOfChangedLines({
        changed: [
          { path: "probe.js", addedLines: lines.map((text, at) => ({ line: at + 1, text })) },
        ],
        limit: Number.MAX_SAFE_INTEGER,
        perOperatorLimit: Number.MAX_SAFE_INTEGER,
      });

      for (const mutant of mutants) {
        count(proposed, mutant.operator);
        const mutated = [...lines];
        mutated[mutant.line - 1] = mutant.after;
        writeFileSync(mutantPath, mutated.join("\n"));
        if (!parses(mutantPath)) {
          count(discarded, mutant.operator);
          if (named.length < 12) {
            named.push(
              `${mutant.operator}  ${file}:${mutant.line}  ${mutant.before.trim().slice(0, 80)}`,
            );
          }
        }
      }
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const total = [...proposed.values()].reduce((sum, one) => sum + one, 0);
console.log(`${read} file(s) node --check reads, ${total} mutant(s) proposed\n`);
for (const [operator, count] of [...proposed].sort((one, other) => other[1] - one[1])) {
  const broke = discarded.get(operator) ?? 0;
  console.log(
    `  ${operator.padEnd(24)} ${String(count).padStart(5)} proposed  ` +
      `${String(broke).padStart(4)} do not parse  ${((broke / count) * 100).toFixed(2)}%`,
  );
}
for (const one of named) {
  console.log(`\n  discarded ${one}`);
}
console.log(
  "\nOnly `delete-statement` is checked at runtime, because only it can unbalance a file: the" +
    " others replace a token with a token of the same shape, wrap a balanced region, or remove a" +
    " balanced one. A non-zero rate on any other row would mean that claim is wrong and the check" +
    " belongs on that operator too.",
);
console.log(
  "Each discarded deletion is the middle of an expression the line below it continues, which one" +
    " line of context cannot see. The check is what makes the operator safe rather than the" +
    " lexical rule, and this is the share of the work it does.",
);
