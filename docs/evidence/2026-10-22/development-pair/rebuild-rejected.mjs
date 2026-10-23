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
    "diff-records": { type: "string" },
    "expect-digest": { type: "string" },
    out: { type: "string" },
  },
});
for (const name of ["session", "checkout", "out"])
  if (values[name] === undefined) throw new Error(`--${name} is required`);
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const records = readFileSync(join(values.session, "ledger.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
if ((values.until === undefined) === (values["diff-records"] === undefined))
  throw new Error("choose exactly one of --until or --diff-records");
const selected = values["diff-records"]?.split(",").map(Number);
if (selected?.some(sequence => !Number.isSafeInteger(sequence) || sequence < 0))
  throw new Error("diff record sequences must be nonnegative integers");
const replayed = [];
for (const record of records) {
  if (record.type !== "tool-call" || (selected === undefined
    ? record.sequence > Number(values.until)
    : !selected.includes(record.sequence))) continue;
  const bytes = readFileSync(join(values.session, "blobs", `${record.payloadDigest.slice(7)}.json`));
  if (digest(bytes) !== record.payloadDigest) throw new Error(`blob of ${record.sequence} differs`);
  const call = JSON.parse(bytes.toString());
  if (selected !== undefined) {
    if (call.decision !== "allowed" || call.toolName !== "shell" ||
      call.facts?.exitCode !== 0 || call.facts?.truncated !== false ||
      !/^git diff [a-zA-Z0-9_./-]+$/.test(call.input?.command))
      throw new Error(`record ${record.sequence} is not a complete successful file diff`);
    const patch = String(call.output).split("stdout:\n")[1];
    if (!patch?.startsWith("diff --git ")) throw new Error(`record ${record.sequence} has no diff`);
    // Shell output trimming can remove final blank context lines. Recount the hunk;
    // the independently recorded full patch digest below must still match exactly.
    execFileSync("git", ["-C", values.checkout, "apply", "--recount", "-"], {input: `${patch}\n`});
    replayed.push(`${record.sequence}: ${call.input.command}`);
    continue;
  }
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
if (selected !== undefined && replayed.length !== selected.length)
  throw new Error("one or more selected records were absent");
// The product's own patch shape (patchAgainstBase), so its digest can be compared with the
// appliedPatchDigest the attempt's independent verification recorded.
execFileSync("git", ["-C", values.checkout, "add", "--all"]);
const patch = execFileSync(
  "git",
  ["-C", values.checkout, "diff", "--no-color", "--no-ext-diff", "--binary", "--full-index", "--cached", "HEAD", "--"],
  { encoding: "utf8" },
);
if (values["expect-digest"] !== undefined && digest(patch) !== values["expect-digest"])
  throw new Error(`reconstructed digest differs: ${digest(patch)}`);
writeFileSync(values.out, patch);
console.log(JSON.stringify({ replayed, patchDigest: digest(patch) }, null, 1));
