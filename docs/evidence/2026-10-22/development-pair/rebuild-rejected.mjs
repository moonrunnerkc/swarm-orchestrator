#!/usr/bin/env node
/**
 * Rebuilds the tree a rolled-back repair attempt left, from the product's own ledger: every write
 * and edit the chokepoint allowed, up to the attempt's stop, replayed in order over a checkout of
 * the task's base, then written out as a patch against the base. The ledger keeps the inputs of
 * each call (a write's content, an edit's exact find and replace), not the files, so this is a
 * replay; an edit whose find text does not occur exactly once refuses rather than guesses.
 * The checkout must be the launch's own base commit (the task's base with the visible check
 * committed). Shell calls are not replayed: the attempt's workspace changes came through write and edit, and
 * a shell write would show here as a missing difference.
 *
 *   node rebuild-rejected.mjs --session <session dir> --checkout <base checkout> --until <sequence>
 *     --out <patch>
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    session: { type: "string" },
    checkout: { type: "string" },
    until: { type: "string" },
    out: { type: "string" },
  },
});
for (const name of ["session", "checkout", "until", "out"])
  if (values[name] === undefined) throw new Error(`--${name} is required`);
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const records = readFileSync(join(values.session, "ledger.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const replayed = [];
for (const record of records) {
  if (record.sequence > Number(values.until) || record.type !== "tool-call") continue;
  const bytes = readFileSync(join(values.session, "blobs", `${record.payloadDigest.slice(7)}.json`));
  if (digest(bytes) !== record.payloadDigest) throw new Error(`blob of ${record.sequence} differs`);
  const call = JSON.parse(bytes.toString());
  if (call.decision !== "allowed" || !["write", "edit"].includes(call.toolName)) continue;
  if (!String(call.output).match(/^(wrote|replaced|created)/)) continue;
  const path = join(values.checkout, call.input.path);
  if (call.toolName === "write") writeFileSync(path, call.input.content);
  else {
    const text = readFileSync(path, "utf8");
    const at = text.indexOf(call.input.find);
    if (at === -1 || text.indexOf(call.input.find, at + 1) !== -1)
      throw new Error(`edit ${record.sequence}: its find text does not occur exactly once`);
    writeFileSync(path, text.slice(0, at) + call.input.replace + text.slice(at + call.input.find.length));
  }
  replayed.push(`${record.sequence}: ${call.toolName} ${call.input.path}`);
}
// The product's own patch shape (patchAgainstBase), so its digest can be compared with the
// appliedPatchDigest the attempt's independent verification recorded.
execFileSync("git", ["-C", values.checkout, "add", "--all"]);
const patch = execFileSync(
  "git",
  ["-C", values.checkout, "diff", "--no-color", "--no-ext-diff", "--binary", "--full-index", "--cached", "HEAD", "--"],
  { encoding: "utf8" },
);
writeFileSync(values.out, patch);
console.log(JSON.stringify({ replayed, patchDigest: digest(patch) }, null, 1));
